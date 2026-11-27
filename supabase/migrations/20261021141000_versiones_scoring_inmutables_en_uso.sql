-- =============================================================================
-- MIGRACIÓN 20261021141000 — UNA VERSIÓN DE SCORING EN USO NO SE MODIFICA
-- (brecha B6, paso 3)
--
-- Problema: los cambios de configuración del scoring se hacían con UPDATE en
-- sitio sobre la misma versión, sin rastro. Si una ronda ya se cerró con una
-- versión (20261021140000) o un ranking se congeló con ella, cambiarle las
-- métricas o los pesos cambia en silencio puntajes ya publicados.
--
-- Regla: una versión está EN USO si hay una ronda ligada a ella o un snapshot
-- de ranking que la usa. Una versión en uso no admite cambios en:
--   - sus métricas (scoring_metrica) ni sus pesos por categoría
--     (scoring_categoria_peso): ni INSERT, ni UPDATE, ni DELETE;
--   - los campos de scoring_version que cambian el cálculo (especie_id, fase,
--     vigente_desde, criterio_desempate, umbrales de delta);
--   - el mínimo/máximo esperado de un rango_referencia que use alguna de sus
--     métricas para normalizar.
-- Sí admite cambiar estado, vigente_hasta, nombre y nota (retirarla).
-- La regla vale también para service_role y migraciones: es integridad de
-- datos, no permiso.
--
-- Camino para cambiar la configuración:
--   1. nueva_version_scoring(base, nombre, vigente_desde): copia la versión
--      (métricas y pesos) como 'borrador'. Un borrador no está en uso, así que
--      el admin lo edita libremente.
--   2. activar_version_scoring(version): en una sola transacción retira la
--      versión activa del mismo alcance (estado 'inactiva', vigente_hasta) y
--      activa la nueva.
-- Las rondas ya cerradas siguen ligadas a su versión; el ranking las calcula
-- con ella (20261021142000).
-- =============================================================================

create or replace function scoring_version_en_uso(p_version_id uuid)
returns boolean
language sql
stable
security definer            -- ve todas las rondas y snapshots aunque el RLS
set search_path = public    -- del usuario no se los muestre
as $$
  select exists (select 1 from ronda_evaluacion_anual where scoring_version_id = p_version_id)
      or exists (select 1 from ranking_snapshot where scoring_version_id = p_version_id);
$$;

comment on function scoring_version_en_uso(uuid) is
  'true si alguna ronda quedó ligada a la versión o algún snapshot de ranking la usa. Una versión en uso no admite cambios de cálculo.';

revoke all on function scoring_version_en_uso(uuid) from public, anon;
grant execute on function scoring_version_en_uso(uuid) to authenticated, service_role;


-- Métricas y pesos por categoría: ninguna escritura sobre una versión en uso.
create or replace function bloquear_config_scoring_en_uso()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_version_id uuid;
begin
  foreach v_version_id in array array_remove(array[
    case when tg_op <> 'INSERT' then old.scoring_version_id end,
    case when tg_op <> 'DELETE' then new.scoring_version_id end
  ], null)
  loop
    if scoring_version_en_uso(v_version_id) then
      raise exception 'Esta versión de scoring ya está en uso (rondas cerradas o rankings congelados): sus métricas y pesos no se pueden modificar. Crea una versión nueva con nueva_version_scoring.'
        using errcode = '55000';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;

create trigger trg_scoring_metrica_inmutable_en_uso
  before insert or update or delete on scoring_metrica
  for each row execute function bloquear_config_scoring_en_uso();

create trigger trg_scoring_categoria_peso_inmutable_en_uso
  before insert or update or delete on scoring_categoria_peso
  for each row execute function bloquear_config_scoring_en_uso();


-- scoring_version: solo se bloquean los campos que cambian el cálculo.
create or replace function bloquear_version_scoring_en_uso()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.especie_id, new.fase, new.vigente_desde, new.criterio_desempate, new.umbral_delta_leve, new.umbral_delta_marcado)
     is distinct from
     (old.especie_id, old.fase, old.vigente_desde, old.criterio_desempate, old.umbral_delta_leve, old.umbral_delta_marcado)
     and scoring_version_en_uso(old.id) then
    raise exception 'Esta versión de scoring ya está en uso: su alcance, vigencia de inicio, desempate y umbrales no se pueden modificar. Crea una versión nueva con nueva_version_scoring.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger trg_scoring_version_inmutable_en_uso
  before update on scoring_version
  for each row execute function bloquear_version_scoring_en_uso();


-- rango_referencia: su mínimo/máximo normaliza métricas; si lo usa una
-- versión en uso, cambiarlo alteraría puntajes ya cerrados.
create or replace function bloquear_rango_scoring_en_uso()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.minimo_esperado, new.maximo_esperado) is distinct from (old.minimo_esperado, old.maximo_esperado)
     and exists (
       select 1 from scoring_metrica sm
        where sm.rango_referencia_id = old.id
          and scoring_version_en_uso(sm.scoring_version_id)
     ) then
    raise exception 'Este rango normaliza una métrica de una versión de scoring en uso: su mínimo y máximo no se pueden modificar. Crea un rango nuevo y una versión nueva.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger trg_rango_referencia_inmutable_en_uso
  before update on rango_referencia
  for each row execute function bloquear_rango_scoring_en_uso();


-- -----------------------------------------------------------------------------
-- nueva_version_scoring: copia una versión como borrador editable.
-- -----------------------------------------------------------------------------
create or replace function nueva_version_scoring(
  p_version_base_id uuid,
  p_nombre text,
  p_vigente_desde date,
  p_nota text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_base  scoring_version;
  v_nueva uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede crear versiones de scoring' using errcode = '42501';
  end if;
  if coalesce(btrim(p_nombre), '') = '' then
    raise exception 'La versión nueva requiere nombre' using errcode = '23514';
  end if;
  if p_vigente_desde is null then
    raise exception 'La versión nueva requiere fecha de vigencia' using errcode = '23514';
  end if;

  select * into v_base from scoring_version where id = p_version_base_id;
  if not found then
    raise exception 'Versión de scoring no encontrada' using errcode = 'P0002';
  end if;

  insert into scoring_version (
    nombre, especie_id, fase, vigente_desde, estado, criterio_desempate, nota,
    umbral_delta_leve, umbral_delta_marcado, created_by
  ) values (
    btrim(p_nombre), v_base.especie_id, v_base.fase, p_vigente_desde, 'borrador', v_base.criterio_desempate,
    coalesce(p_nota, v_base.nota), v_base.umbral_delta_leve, v_base.umbral_delta_marcado, v_uid
  ) returning id into v_nueva;

  insert into scoring_categoria_peso (scoring_version_id, categoria, peso)
  select v_nueva, categoria, peso
    from scoring_categoria_peso
   where scoring_version_id = p_version_base_id;

  insert into scoring_metrica (
    scoring_version_id, metrica, peso, direccion_favorable, metodo_normalizacion,
    minimo_normalizacion, maximo_normalizacion, rango_referencia_id, tratamiento_nulos,
    orden, categoria
  )
  select v_nueva, metrica, peso, direccion_favorable, metodo_normalizacion,
         minimo_normalizacion, maximo_normalizacion, rango_referencia_id, tratamiento_nulos,
         orden, categoria
    from scoring_metrica
   where scoring_version_id = p_version_base_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, null, 'nueva_version_scoring', array['scoring_version_id'],
          jsonb_build_object('version_base_id', p_version_base_id, 'version_nueva_id', v_nueva, 'nombre', btrim(p_nombre)));

  return v_nueva;
end;
$$;

comment on function nueva_version_scoring(uuid, text, date, text) is
  'Solo admin. Copia una versión de scoring (métricas y pesos) como borrador editable. Único camino para cambiar la configuración de una versión en uso.';

revoke all on function nueva_version_scoring(uuid, text, date, text) from public, anon;
grant execute on function nueva_version_scoring(uuid, text, date, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- activar_version_scoring: retira la activa del mismo alcance y activa otra,
-- en una sola transacción (nunca queda un alcance sin versión activa).
-- -----------------------------------------------------------------------------
create or replace function activar_version_scoring(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_version  scoring_version;
  v_anterior uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede activar versiones de scoring' using errcode = '42501';
  end if;

  select * into v_version from scoring_version where id = p_version_id for update;
  if not found then
    raise exception 'Versión de scoring no encontrada' using errcode = 'P0002';
  end if;
  if v_version.estado = 'activa' then
    return p_version_id;
  end if;
  if not exists (select 1 from scoring_metrica where scoring_version_id = p_version_id) then
    raise exception 'La versión no tiene métricas configuradas' using errcode = '23514';
  end if;

  update scoring_version
     set estado = 'inactiva',
         vigente_hasta = case
           when vigente_hasta is null and v_version.vigente_desde > vigente_desde
             then v_version.vigente_desde - 1
           else vigente_hasta
         end
   where estado = 'activa'
     and especie_id is not distinct from v_version.especie_id
     and fase is not distinct from v_version.fase
  returning id into v_anterior;

  update scoring_version
     set estado = 'activa', aprobado_by = v_uid, aprobado_at = now()
   where id = p_version_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, null, 'activacion_version_scoring', array['scoring_version_id'],
          jsonb_build_object('version_activada_id', p_version_id, 'version_retirada_id', v_anterior));

  return p_version_id;
end;
$$;

comment on function activar_version_scoring(uuid) is
  'Solo admin. Activa una versión de scoring y retira (inactiva, con vigente_hasta) la activa del mismo alcance, en una sola transacción.';

revoke all on function activar_version_scoring(uuid) from public, anon;
grant execute on function activar_version_scoring(uuid) to authenticated, service_role;
