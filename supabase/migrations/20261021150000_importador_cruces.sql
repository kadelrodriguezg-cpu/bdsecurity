-- =============================================================================
-- MIGRACIÓN 20261021150000 — IMPORTADOR MASIVO DE CRUZAMIENTOS (brecha B1)
--
-- Problema: la carga de ~2000 cruzamientos no tenía camino. El alta es un
-- INSERT por cruce desde la interfaz, y la RPC de linaje acepta 10 escrituras
-- por minuto. Patrón de DeltaBreed/Germinate/Breedbase: validar, previsualizar
-- con errores por fila, confirmar en bloque y poder revertir el lote.
--
-- Independiente del formato del archivo: el navegador lee el CSV y asigna las
-- columnas; acá llegan filas normalizadas como jsonb:
--   [{"codigo_sistema", "especie", "cruzamiento", "mama", "papa", "es_prueba"}]
-- (especie por nombre o id; mama/papa por nombre de variedad).
--
-- Piezas:
--   - importacion_lote: un lote por archivo (autor, archivo, filas, estado
--     previsualizado/confirmado/revertido, conteos). RLS solo admin: las filas
--     traen linaje.
--   - plantas.lote_importacion_id: de qué lote salió cada cruce.
--   - previsualizar_importacion_cruces: valida y guarda el lote; NO toca
--     plantas ni variedades. Devuelve errores fila por fila.
--   - confirmar_importacion_cruces: todo en una transacción (si una fila
--     falla, no entra ninguna), idempotente por clave, con límite de
--     frecuencia por lote (no por fila: no choca con los 10/min de
--     actualizar_linaje). Cada alta queda auditada por el trigger de B3
--     (alta_cruce) y el lote deja una fila de resumen.
--   - revertir_importacion: soft-delete de los cruces del lote si ninguno
--     tiene individuos todavía.
-- Todas solo para admin, SECURITY DEFINER.
-- =============================================================================

create table importacion_lote (
  id                   uuid primary key default gen_random_uuid(),
  created_by           uuid not null references perfiles (id) on delete restrict,
  archivo_nombre       text not null check (btrim(archivo_nombre) <> ''),
  estado               text not null default 'previsualizado'
                         check (estado in ('previsualizado', 'confirmado', 'revertido')),
  filas                jsonb not null check (jsonb_typeof(filas) = 'array'),
  filas_total          integer not null,
  filas_con_error      integer not null default 0,
  cruces_creados       integer not null default 0,
  variedades_creadas   integer not null default 0,
  idempotency_key      uuid unique,
  created_at           timestamptz not null default now(),
  confirmado_at        timestamptz,
  revertido_at         timestamptz
);

comment on table importacion_lote is 'Lote de importación masiva de cruces (B1). Guarda las filas normalizadas (con linaje: solo admin) y el estado del lote.';

alter table importacion_lote enable row level security;

create policy importacion_lote_select_admin on importacion_lote
  for select using (es_admin());
-- Sin policies de INSERT/UPDATE/DELETE: solo se escribe por las RPC.

revoke all on importacion_lote from anon, authenticated;
grant select on importacion_lote to authenticated;
grant all on importacion_lote to service_role;


alter table plantas
  add column lote_importacion_id uuid references importacion_lote (id) on delete restrict;

comment on column plantas.lote_importacion_id is 'Lote de importación masiva del que salió el cruce (null si se creó a mano).';

create index plantas_lote_importacion_idx on plantas (lote_importacion_id) where lote_importacion_id is not null;


-- -----------------------------------------------------------------------------
-- Clave de comparación de nombres de variedad para SUGERIR (no para resolver):
-- sin mayúsculas, tildes, espacios ni signos. «O'Neal» y «ONeal» coinciden.
-- -----------------------------------------------------------------------------
create or replace function clave_nombre_variedad(p_nombre text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(lower(coalesce(p_nombre, '')), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
    '[^a-z0-9]', '', 'g'
  );
$$;


-- -----------------------------------------------------------------------------
-- Validación compartida por previsualizar y confirmar. Solo lee.
-- -----------------------------------------------------------------------------
create or replace function validar_filas_importacion_cruces(p_filas jsonb)
returns table (
  n                     integer,
  codigo_sistema        text,
  especie_id            uuid,
  cruzamiento           text,
  mama                  text,
  papa                  text,
  mama_id               uuid,
  papa_id               uuid,
  es_prueba             boolean,
  errores               text[],
  variedades_faltantes  text[],
  sugerencias           jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with filas as (
    select
      t.ord::integer as n,
      nullif(btrim(t.f->>'codigo_sistema'), '') as codigo,
      nullif(btrim(t.f->>'especie'), '') as especie_txt,
      nullif(btrim(t.f->>'cruzamiento'), '') as cruzamiento,
      nullif(regexp_replace(btrim(coalesce(t.f->>'mama', '')), '\s+', ' ', 'g'), '') as mama,
      nullif(regexp_replace(btrim(coalesce(t.f->>'papa', '')), '\s+', ' ', 'g'), '') as papa,
      lower(btrim(coalesce(t.f->>'es_prueba', ''))) in ('true', 't', '1', 'si', 'sí', 'x') as es_prueba
    from jsonb_array_elements(p_filas) with ordinality as t(f, ord)
  ), con_especie as (
    select f.*,
      (select e.id from especies e
        where lower(btrim(e.nombre)) = lower(f.especie_txt) or e.id::text = f.especie_txt
        limit 1) as especie_id,
      count(*) over (partition by f.codigo) as repeticiones
    from filas f
  ), resuelto as (
    select c.*,
      (select v.id from variedades v
        where v.especie_id = c.especie_id and lower(btrim(v.nombre)) = lower(c.mama)) as mama_id,
      (select v.id from variedades v
        where v.especie_id = c.especie_id and lower(btrim(v.nombre)) = lower(c.papa)) as papa_id
    from con_especie c
  ), con_sugerencias as (
    select r.*,
      case when r.mama is not null and r.mama_id is null then
        (select v.nombre from variedades v
          where v.especie_id = r.especie_id and clave_nombre_variedad(v.nombre) = clave_nombre_variedad(r.mama)
          order by v.nombre limit 1) end as sugerencia_mama,
      case when r.papa is not null and r.papa_id is null then
        (select v.nombre from variedades v
          where v.especie_id = r.especie_id and clave_nombre_variedad(v.nombre) = clave_nombre_variedad(r.papa)
          order by v.nombre limit 1) end as sugerencia_papa
    from resuelto r
  )
  select
    s.n,
    s.codigo,
    s.especie_id,
    s.cruzamiento,
    s.mama,
    s.papa,
    s.mama_id,
    s.papa_id,
    s.es_prueba,
    array_remove(array[
      case when s.codigo is null then 'codigo_vacio' end,
      case when s.codigo is not null and s.repeticiones > 1 then 'codigo_repetido_en_archivo' end,
      case when s.codigo is not null and exists (select 1 from plantas p where p.codigo_sistema = s.codigo) then 'codigo_existente' end,
      case when s.especie_txt is null then 'especie_vacia'
           when s.especie_id is null then 'especie_inexistente' end,
      -- Hay una variedad casi igual: no se crea un casi-duplicado, se corrige el archivo.
      case when s.sugerencia_mama is not null then 'mama_parecida_a_existente' end,
      case when s.sugerencia_papa is not null then 'papa_parecida_a_existente' end
    ], null) as errores,
    array_remove(array[
      case when s.especie_id is not null and s.mama is not null and s.mama_id is null and s.sugerencia_mama is null then s.mama end,
      case when s.especie_id is not null and s.papa is not null and s.papa_id is null and s.sugerencia_papa is null then s.papa end
    ], null) as variedades_faltantes,
    jsonb_strip_nulls(jsonb_build_object('mama', s.sugerencia_mama, 'papa', s.sugerencia_papa)) as sugerencias
  from con_sugerencias s
  order by s.n;
$$;

revoke all on function validar_filas_importacion_cruces(jsonb) from public, anon, authenticated;
grant execute on function validar_filas_importacion_cruces(jsonb) to service_role;


-- -----------------------------------------------------------------------------
-- previsualizar_importacion_cruces
-- -----------------------------------------------------------------------------
create or replace function previsualizar_importacion_cruces(p_filas jsonb, p_archivo_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_lote_id   uuid;
  v_total     integer;
  v_resultado jsonb;
  v_errores   integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede importar cruces' using errcode = '42501';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Las filas deben ser una lista' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_filas);
  if v_total = 0 then
    raise exception 'El archivo no trae filas' using errcode = '22023';
  end if;
  if v_total > 5000 then
    raise exception 'Máximo 5000 filas por archivo (trae %). Divídelo en varios lotes.', v_total using errcode = '22023';
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'n', v.n,
      'codigo_sistema', v.codigo_sistema,
      'errores', to_jsonb(v.errores),
      'variedades_faltantes', to_jsonb(v.variedades_faltantes),
      'sugerencias', v.sugerencias
    ) order by v.n), '[]'::jsonb),
    count(*) filter (where cardinality(v.errores) > 0)
  into v_resultado, v_errores
  from validar_filas_importacion_cruces(p_filas) v;

  insert into importacion_lote (created_by, archivo_nombre, filas, filas_total, filas_con_error)
  values (v_uid, coalesce(nullif(btrim(p_archivo_nombre), ''), 'sin_nombre'), p_filas, v_total, v_errores)
  returning id into v_lote_id;

  return jsonb_build_object(
    'lote_id', v_lote_id,
    'filas_total', v_total,
    'filas_con_error', v_errores,
    'variedades_nuevas', (
      select coalesce(jsonb_agg(distinct nombre), '[]'::jsonb)
      from validar_filas_importacion_cruces(p_filas) v, unnest(v.variedades_faltantes) nombre
    ),
    'filas', v_resultado
  );
end;
$$;

comment on function previsualizar_importacion_cruces(jsonb, text) is
  'Solo admin. Valida las filas de un archivo de cruces (código repetido o existente, especie, progenitores), guarda el lote como previsualizado y devuelve los errores fila por fila. No crea cruces.';

revoke all on function previsualizar_importacion_cruces(jsonb, text) from public, anon;
grant execute on function previsualizar_importacion_cruces(jsonb, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- confirmar_importacion_cruces
-- -----------------------------------------------------------------------------
create or replace function confirmar_importacion_cruces(
  p_lote_id uuid,
  p_crear_variedades boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_lote        importacion_lote;
  v_recientes   integer;
  v_con_error   integer;
  v_faltantes   integer;
  v_variedades  integer;
  v_cruces      integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede importar cruces' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Falta la clave de idempotencia' using errcode = '22023';
  end if;

  select * into v_lote from importacion_lote where id = p_lote_id for update;
  if not found then
    raise exception 'Lote de importación no encontrado' using errcode = 'P0002';
  end if;

  -- Reintento del mismo pedido (doble clic, red que se cortó): mismo resultado.
  if v_lote.estado = 'confirmado' and v_lote.idempotency_key = p_idempotency_key then
    return jsonb_build_object('lote_id', v_lote.id, 'cruces_creados', v_lote.cruces_creados,
                              'variedades_creadas', v_lote.variedades_creadas, 'repetido', true);
  end if;
  if v_lote.estado <> 'previsualizado' then
    raise exception 'Este lote ya está %: no se puede confirmar de nuevo', v_lote.estado using errcode = '55000';
  end if;

  -- Límite de frecuencia por LOTE (no por fila).
  select count(*) into v_recientes
  from audit_log
  where usuario_id = v_uid
    and accion = 'importacion_cruces'
    and ocurrido_en > now() - interval '60 seconds';
  if v_recientes >= 3 then
    raise exception 'Rate limit excedido: máximo 3 importaciones por minuto por usuario' using errcode = '58503';
  end if;

  -- Se revalida: entre la previsualización y la confirmación pudo cambiar la base.
  create temporary table _filas_import on commit drop as
    select * from validar_filas_importacion_cruces(v_lote.filas);

  select count(*) filter (where cardinality(errores) > 0),
         count(*) filter (where cardinality(variedades_faltantes) > 0)
    into v_con_error, v_faltantes
  from _filas_import;

  if v_con_error > 0 then
    raise exception 'El archivo tiene % fila(s) con errores. Corrígelas y vuelve a previsualizar.', v_con_error
      using errcode = '23514';
  end if;
  if v_faltantes > 0 and not coalesce(p_crear_variedades, false) then
    raise exception 'Hay % fila(s) con progenitores que no existen como variedades. Confirma creando las variedades nuevas o corrige el archivo.', v_faltantes
      using errcode = '23514';
  end if;

  insert into variedades (especie_id, nombre, created_by)
  select distinct on (f.especie_id, lower(nombre)) f.especie_id, nombre, v_uid
  from _filas_import f, unnest(f.variedades_faltantes) nombre
  on conflict (especie_id, lower(btrim(nombre))) do nothing;
  get diagnostics v_variedades = row_count;

  insert into plantas (codigo_sistema, especie_id, cruzamiento, mama_id, papa_id, es_prueba, lote_importacion_id)
  select
    f.codigo_sistema,
    f.especie_id,
    f.cruzamiento,
    coalesce(f.mama_id, (select v.id from variedades v where v.especie_id = f.especie_id and lower(btrim(v.nombre)) = lower(f.mama))),
    coalesce(f.papa_id, (select v.id from variedades v where v.especie_id = f.especie_id and lower(btrim(v.nombre)) = lower(f.papa))),
    f.es_prueba,
    v_lote.id
  from _filas_import f
  order by f.n;
  get diagnostics v_cruces = row_count;

  update importacion_lote
     set estado = 'confirmado', confirmado_at = now(), idempotency_key = p_idempotency_key,
         cruces_creados = v_cruces, variedades_creadas = v_variedades
   where id = v_lote.id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, null, 'importacion_cruces', array['cruzamiento', 'mama_id', 'papa_id'],
          jsonb_build_object('lote_id', v_lote.id, 'archivo', v_lote.archivo_nombre,
                             'cruces_creados', v_cruces, 'variedades_creadas', v_variedades));

  return jsonb_build_object('lote_id', v_lote.id, 'cruces_creados', v_cruces,
                            'variedades_creadas', v_variedades, 'repetido', false);
end;
$$;

comment on function confirmar_importacion_cruces(uuid, boolean, uuid) is
  'Solo admin. Crea todos los cruces de un lote previsualizado en una sola transacción (si una fila falla, no entra ninguna). Idempotente por clave. Límite: 3 lotes por minuto. Cada alta queda auditada como alta_cruce.';

revoke all on function confirmar_importacion_cruces(uuid, boolean, uuid) from public, anon;
grant execute on function confirmar_importacion_cruces(uuid, boolean, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- revertir_importacion
-- -----------------------------------------------------------------------------
create or replace function revertir_importacion(p_lote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_lote         importacion_lote;
  v_con_avance   integer;
  v_archivados   integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede revertir una importación' using errcode = '42501';
  end if;

  select * into v_lote from importacion_lote where id = p_lote_id for update;
  if not found then
    raise exception 'Lote de importación no encontrado' using errcode = 'P0002';
  end if;
  if v_lote.estado <> 'confirmado' then
    raise exception 'Solo se puede revertir un lote confirmado (este está %)', v_lote.estado using errcode = '55000';
  end if;

  -- Con individuos ya hay trabajo de terreno (y quizás evaluaciones) colgando del cruce.
  select count(distinct p.id) into v_con_avance
  from plantas p
  join individuos i on i.planta_id = p.id
  where p.lote_importacion_id = p_lote_id;
  if v_con_avance > 0 then
    raise exception 'No se puede revertir: % cruce(s) del lote ya tienen individuos.', v_con_avance using errcode = '55000';
  end if;

  update plantas set eliminado_at = now()
   where lote_importacion_id = p_lote_id and eliminado_at is null;
  get diagnostics v_archivados = row_count;

  update importacion_lote set estado = 'revertido', revertido_at = now() where id = p_lote_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, null, 'reversion_importacion', array[]::text[],
          jsonb_build_object('lote_id', p_lote_id, 'cruces_archivados', v_archivados));

  return jsonb_build_object('lote_id', p_lote_id, 'cruces_archivados', v_archivados);
end;
$$;

comment on function revertir_importacion(uuid) is
  'Solo admin. Archiva (soft-delete) los cruces de un lote confirmado si ninguno tiene individuos. Los códigos siguen ocupados: un cruce archivado se recupera con restaurar_cruzamiento.';

revoke all on function revertir_importacion(uuid) from public, anon;
grant execute on function revertir_importacion(uuid) to authenticated, service_role;
