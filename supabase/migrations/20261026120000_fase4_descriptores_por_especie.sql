-- Fase 4, paso 50 — qué descriptores usa cada especie (decisión 4 de Kadel, 25-10-2026).
--
-- «Configurar descriptores» = elegir, de los descriptores que ya existen en el esquema, cuáles usa cada especie, con etiquetas
-- por nivel propias si hace falta. Crear descriptores nuevos sigue siendo una migración. Hecho de partida: `esquema_fase_campo`
-- se define por (fase, clave), sin especie, y los valores son columnas de `evaluaciones`.
--
-- 1. `esquema_campo_especie` (fase, clave, especie, activo, etiquetas_nivel): solo guarda lo que CAMBIA para una especie. Sin fila,
--    el descriptor está activo y con sus etiquetas de siempre: por defecto todo sigue igual para todas las especies (también las
--    nuevas). RLS: lectura para quien tiene sesión; escritura solo admin. Cada cambio queda en `audit_log` (antes y después).
--    No se borra ningún dato: desactivar un descriptor no toca los valores ya cargados.
-- 2. `descriptor_activo_en_especie(fase, clave, especie)`.
-- 3. `definir_protocolo_ronda`: un protocolo no puede pedir un descriptor que la especie del cruce no usa.
-- 4. `estados_descriptores`: un descriptor que la especie no usa (o creado después de la fecha de la evaluación) solo aparece si la
--    evaluación trae valor; así no figura como «no evaluado» ni como «faltó».
-- 5. `calcular_ranking_nucleo`: un descriptor que la especie no usa no entra a su puntaje ni a su cobertura. El puntaje de la
--    categoría se reparte entre los demás descriptores (el promedio ponderado ya se calcula sobre las métricas presentes) y una
--    categoría sin ningún descriptor activo queda sin dato y fuera del grupo de comparación (K5). La versión de puntaje no cambia
--    (sigue siendo inmutable): lo que cambia es qué métricas de esa versión cuentan para la especie. Los rankings congelados no
--    cambian; el ranking en vivo de la especie sí.
-- 6. `contar_valores_descriptor(especie, clave)`: cuántas evaluaciones cerradas de la especie ya traen valor de ese descriptor, para
--    advertir antes de desactivarlo.
--
-- Rollback: docs/fase4/rollback/50_descriptores_por_especie.sql (se niega si ya hay filas de configuración).

create table public.esquema_campo_especie (
  fase text not null,
  clave text not null,
  especie_id uuid not null references public.especies(id) on delete cascade,
  activo boolean not null default true,
  etiquetas_nivel text[],
  updated_at timestamptz not null default now(),
  updated_by uuid references public.perfiles(id) on delete set null,
  primary key (fase, clave, especie_id),
  foreign key (fase, clave) references public.esquema_fase_campo (fase, clave) on delete restrict,
  check (etiquetas_nivel is null or (cardinality(etiquetas_nivel) >= 2 and array_position(etiquetas_nivel, null) is null))
);

comment on table public.esquema_campo_especie is
  'Fase 4: qué descriptores del esquema usa cada especie y sus etiquetas por nivel propias. Sin fila = activo y con las etiquetas del esquema.';

alter table public.esquema_campo_especie enable row level security;
create policy esquema_campo_especie_select_autenticados on public.esquema_campo_especie
  for select to authenticated using ((select auth.uid()) is not null);
create policy esquema_campo_especie_admin_inserta on public.esquema_campo_especie
  for insert to authenticated with check ((select es_admin()));
create policy esquema_campo_especie_admin_actualiza on public.esquema_campo_especie
  for update to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy esquema_campo_especie_admin_borra on public.esquema_campo_especie
  for delete to authenticated using ((select es_admin()));
revoke all on public.esquema_campo_especie from anon, authenticated;
grant select, delete on public.esquema_campo_especie to authenticated;
grant insert (fase, clave, especie_id, activo, etiquetas_nivel) on public.esquema_campo_especie to authenticated;
-- La clave también, para que «insertar o actualizar» (upsert) funcione; el disparador valida cada fila y el RLS exige admin.
grant update (fase, clave, especie_id, activo, etiquetas_nivel) on public.esquema_campo_especie to authenticated;
create index esquema_campo_especie_especie_idx on public.esquema_campo_especie (especie_id);

-- Valida contra el esquema, fija quién y cuándo, y deja el cambio en la auditoría (antes y después).
create function public.validar_auditar_campo_especie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campo esquema_fase_campo;
  v_autor uuid := auth.uid();
begin
  if tg_op <> 'DELETE' then
    select * into v_campo from esquema_fase_campo where fase = new.fase and clave = new.clave;
    if v_campo.rol <> 'descriptor' then
      raise exception 'Solo los descriptores se configuran por especie' using errcode = '23514';
    end if;
    if new.etiquetas_nivel is not null and (
      v_campo.tipo <> 'escala' or cardinality(new.etiquetas_nivel) <> v_campo.escala_maximo - v_campo.escala_minimo + 1
    ) then
      raise exception 'Las etiquetas por nivel deben ser una por nivel de la escala (%)', v_campo.etiqueta using errcode = '23514';
    end if;
    if new.etiquetas_nivel is not null and exists (select 1 from unnest(new.etiquetas_nivel) t where btrim(t) = '') then
      raise exception 'Ninguna etiqueta por nivel puede quedar vacía' using errcode = '23514';
    end if;
    new.updated_at := now();
    new.updated_by := v_autor;
  end if;
  if not exists (select 1 from perfiles where id = v_autor) then v_autor := null; end if;
  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_autor, null, 'cambio_descriptor_especie', array['activo', 'etiquetas_nivel'],
    jsonb_build_object(
      'operacion', tg_op,
      'fase', coalesce(new.fase, old.fase),
      'clave', coalesce(new.clave, old.clave),
      'especie_id', coalesce(new.especie_id, old.especie_id),
      'anterior', case when tg_op = 'INSERT' then null else jsonb_build_object('activo', old.activo, 'etiquetas_nivel', old.etiquetas_nivel) end,
      'nuevo', case when tg_op = 'DELETE' then null else jsonb_build_object('activo', new.activo, 'etiquetas_nivel', new.etiquetas_nivel) end));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.validar_auditar_campo_especie() from public, anon, authenticated;
create trigger esquema_campo_especie_validar_auditar
before insert or update or delete on public.esquema_campo_especie
for each row execute function public.validar_auditar_campo_especie();

create function public.descriptor_activo_en_especie(p_fase text, p_clave text, p_especie_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select not exists (
    select 1 from esquema_campo_especie x
    where x.fase = p_fase and x.clave = p_clave and x.especie_id = p_especie_id and not x.activo
  );
$$;
comment on function public.descriptor_activo_en_especie(text, text, uuid) is
  'Fase 4: el descriptor está activo para la especie (sin fila de configuración, lo está).';
revoke all on function public.descriptor_activo_en_especie(text, text, uuid) from public, anon;
grant execute on function public.descriptor_activo_en_especie(text, text, uuid) to authenticated, service_role;

create function public.contar_valores_descriptor(p_especie_id uuid, p_clave text)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not exists (select 1 from esquema_fase_campo where fase = 'evaluacion_anual' and clave = p_clave and rol = 'descriptor') then
    raise exception 'Descriptor desconocido' using errcode = '22023';
  end if;
  -- La clave ya se validó contra el esquema (cada clave es una columna de evaluaciones): el SQL dinámico solo usa ese nombre.
  execute format(
    'select count(*)::integer from evaluaciones e
       join ronda_evaluacion_anual r on r.id = e.ronda_id
       join individuos i on i.id = r.individuo_id
       join plantas p on p.id = i.planta_id
     where p.especie_id = $1 and p.eliminado_at is null and e.estado in (''completa'', ''corregida'') and e.%I is not null',
    p_clave)
  into v_total using p_especie_id;
  return v_total;
end;
$$;
comment on function public.contar_valores_descriptor(uuid, text) is
  'Fase 4: evaluaciones cerradas de la especie que ya traen valor de ese descriptor (para advertir antes de desactivarlo).';
revoke all on function public.contar_valores_descriptor(uuid, text) from public, anon;
grant execute on function public.contar_valores_descriptor(uuid, text) to authenticated, service_role;

-- 3. Protocolo de ronda: igual que el de 20261023110000, más la comprobación de la especie.
create or replace function public.definir_protocolo_ronda(
  p_planta_id uuid,
  p_tipo_ronda public.tipo_ronda,
  p_numero_ronda smallint,
  p_nombre text,
  p_descriptores jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_motivo text;
  v_version integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin define el protocolo de una ronda' using errcode = '42501';
  end if;
  if p_numero_ronda is null or p_numero_ronda not between 1 and 3 then
    raise exception 'Número de ronda inválido' using errcode = '22023';
  end if;
  if coalesce(btrim(p_nombre), '') = '' then
    raise exception 'El protocolo requiere nombre' using errcode = '23514';
  end if;
  if not exists (select 1 from plantas where id = p_planta_id and eliminado_at is null) then
    raise exception 'Cruce no encontrado o archivado' using errcode = 'P0002';
  end if;
  v_motivo := validar_descriptores_protocolo(p_descriptores);
  if v_motivo is not null then
    raise exception '%', v_motivo using errcode = '23514';
  end if;
  -- Fase 4: un protocolo no puede pedir un descriptor que la especie del cruce no usa.
  select 'El protocolo incluye descriptores que esta especie no usa: ' || string_agg(c.etiqueta, ', ' order by c.orden)
  into v_motivo
  from jsonb_object_keys(p_descriptores) k
  join esquema_fase_campo c on c.fase = 'evaluacion_anual' and c.clave = k
  join plantas p on p.id = p_planta_id
  where not descriptor_activo_en_especie('evaluacion_anual', k, p.especie_id);
  if v_motivo is not null then
    raise exception '%', v_motivo using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('protocolo:' || p_planta_id::text || ':' || p_tipo_ronda::text || ':' || p_numero_ronda::text, 0));
  select coalesce(max(version), 0) + 1 into v_version
  from protocolo_ronda
  where planta_id = p_planta_id and tipo_ronda = p_tipo_ronda and numero_ronda = p_numero_ronda;

  insert into protocolo_ronda (planta_id, tipo_ronda, numero_ronda, version, nombre, descriptores, created_by)
  values (p_planta_id, p_tipo_ronda, p_numero_ronda, v_version, btrim(p_nombre), p_descriptores, v_uid)
  returning id into v_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'definicion_protocolo_ronda', array['descriptores'],
    jsonb_build_object('protocolo_id', v_id, 'tipo_ronda', p_tipo_ronda, 'numero_ronda', p_numero_ronda,
      'version', v_version, 'nombre', btrim(p_nombre), 'descriptores', p_descriptores));

  return v_id;
end;
$$;

-- 4. Estados por descriptor: igual que el de 20261025110000, más la especie y la fecha desde la que existe cada descriptor.
create or replace function public.estados_descriptores(p_evaluacion evaluaciones)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with proto as (
    select pr.descriptores from protocolo_ronda pr where pr.id = p_evaluacion.protocolo_id
  ), marcados as (
    select descriptores_fuera_de_revision(p_evaluacion) as claves
  ), especie as (
    select p.especie_id
    from ronda_evaluacion_anual r
    join individuos i on i.id = r.individuo_id
    join plantas p on p.id = i.planta_id
    where r.id = p_evaluacion.ronda_id
  )
  select coalesce(jsonb_object_agg(c.clave,
    case
      when (to_jsonb(p_evaluacion) -> c.clave) is not null and (to_jsonb(p_evaluacion) -> c.clave) <> 'null'::jsonb then
        case when c.clave = any(m.claves) then 'marcado' else 'medido' end
      when exists (select 1 from proto where proto.descriptores ->> c.clave = 'obligatorio') then 'falto'
      else 'no_evaluado'
    end
    order by c.orden), '{}'::jsonb)
  from esquema_fase_campo c
  cross join marcados m
  left join especie es on true
  where c.fase = 'evaluacion_anual' and c.rol in ('descriptor', 'muestra')
    -- Desactivado en el esquema (EF11), que la especie no usa (fase 4) o creado después de la fecha de la evaluación
    -- (fase 4, paso 48): solo aparece si la evaluación ya trae un valor.
    and (
      (c.activo
        and (es.especie_id is null or descriptor_activo_en_especie('evaluacion_anual', c.clave, es.especie_id))
        and (c.vigente_desde is null or p_evaluacion.fecha >= c.vigente_desde))
      or ((to_jsonb(p_evaluacion) -> c.clave) is not null and (to_jsonb(p_evaluacion) -> c.clave) <> 'null'::jsonb)
    );
$function$
;

-- 5. Motor de puntaje: igual que el de 20261024090000, más la especie en las entradas y el filtro de descriptores activos.
CREATE OR REPLACE FUNCTION public.calcular_ranking_nucleo(p_scoring_version_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid, p_por_ronda boolean DEFAULT false, p_incluir_pruebas boolean DEFAULT true, p_con_grupo boolean DEFAULT true, p_numero_ronda smallint DEFAULT NULL::smallint)
 RETURNS TABLE(individuo_id uuid, codigo_display text, planta_id uuid, codigo_sistema text, especie_id uuid, es_prueba boolean, evaluacion_id uuid, fecha_evaluacion date, evaluacion_updated_at timestamp with time zone, numero_ronda smallint, estado_evaluacion estado_evaluacion, requiere_revision boolean, no_comparable boolean, scoring_version_id uuid, scoring_version_nombre text, configuradas integer, disponibles integer, puntaje_bruto numeric, tiene_metrica_marcada boolean, detalle_metricas jsonb, detalle_categorias jsonb, cobertura jsonb, grupo text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with alcance as (
    select
      i.id as individuo_id,
      i.codigo_display,
      i.planta_id,
      p.codigo_sistema,
      p.especie_id,
      p.es_prueba
    from individuos i
    join plantas p on p.id = i.planta_id
    where i.estado_vital = 'vivo'
      and p.eliminado_at is null
      and (p_planta_id is null or p.id = p_planta_id)
      and (p_especie_id is null or p.especie_id = p_especie_id)
      and (p_incluir_pruebas or not p.es_prueba)
  ), ultima_ronda as (
    select distinct on (r.individuo_id)
      r.individuo_id,
      r.id as ronda_id,
      r.numero_ronda,
      r.scoring_version_id as ronda_scoring_version_id,
      -- Misma condición con que unificar_evaluacion_ronda y
      -- obtener_procedencia_calidad_ronda eligen las visitas cerradas.
      exists (
        select 1 from evaluaciones ev
        where ev.ronda_id = r.id and ev.estado in ('completa', 'corregida')
      ) as con_cerrada
    from ronda_evaluacion_anual r
    join alcance a on a.individuo_id = r.individuo_id
    where r.tipo_ronda = 'anual'
      -- v3 paso 8 (N38): con p_numero_ronda se toma la ronda de esa temporada; sin él, la última de cada individuo.
      and (p_numero_ronda is null or r.numero_ronda = p_numero_ronda)
    order by r.individuo_id, r.numero_ronda desc, r.created_at desc, r.id desc
  ), con_evaluacion as (
    -- Solo estas rondas pagan la unificación de visitas y la procedencia.
    select
      a.*,
      ur.numero_ronda,
      ur.ronda_scoring_version_id,
      e.id as evaluacion_id,
      e.fecha as fecha_evaluacion,
      e.updated_at as evaluacion_updated_at,
      e.estado as estado_evaluacion,
      e.requiere_revision,
      e.no_comparable,
      to_jsonb(e) as evaluacion_json,
      proc.descriptores_con_revision,
      proc.descriptores_no_comparables
    from alcance a
    join ultima_ronda ur on ur.individuo_id = a.individuo_id and ur.con_cerrada
    cross join lateral unificar_evaluacion_ronda(ur.ronda_id) e
    cross join lateral obtener_procedencia_calidad_ronda(ur.ronda_id) proc
  ), sin_evaluacion as (
    -- Sin ronda, o con la ronda más reciente sin visita completa/corregida:
    -- sin evaluación y sin descriptores marcados.
    select
      a.*,
      ur.numero_ronda,
      ur.ronda_scoring_version_id,
      null::uuid as evaluacion_id,
      null::date as fecha_evaluacion,
      null::timestamptz as evaluacion_updated_at,
      null::estado_evaluacion as estado_evaluacion,
      null::boolean as requiere_revision,
      null::boolean as no_comparable,
      null::jsonb as evaluacion_json,
      null::text[] as descriptores_con_revision,
      null::text[] as descriptores_no_comparables
    from alcance a
    left join ultima_ronda ur on ur.individuo_id = a.individuo_id
    where ur.individuo_id is null or not ur.con_cerrada
  ), base as (
    select
      b0.*,
      sv.id as scoring_version_id,
      sv.nombre as scoring_version_nombre
    from (
      select * from con_evaluacion
      union all
      select * from sin_evaluacion
    ) b0
    -- B6: con p_por_ronda, cada ronda se calcula con la versión con que se
    -- cerró; p_scoring_version_id solo cubre las rondas sin cerrar. Sin
    -- p_por_ronda, todas con p_scoring_version_id (versión elegida).
    left join scoring_version sv on sv.id = case
      when p_por_ronda then coalesce(b0.ronda_scoring_version_id, p_scoring_version_id)
      else p_scoring_version_id
    end
  ), entradas as (
    -- Una entrada por individuo con evaluación, más UNA «vacía» por versión de
    -- scoring para los individuos sin evaluación: su resultado depende solo de
    -- la versión (todas las métricas sin valor, sin descriptores marcados).
    select
      b.individuo_id::text as clave,
      b.scoring_version_id,
      b.especie_id,
      b.evaluacion_json as ej,
      coalesce(b.descriptores_con_revision, '{}'::text[]) as con_revision,
      coalesce(b.descriptores_no_comparables, '{}'::text[]) as no_comparables
    from base b
    where b.evaluacion_id is not null
    union all
    select
      -- Fase 4: la entrada vacía también es por especie (cada especie puede no usar algunos descriptores).
      'v:' || coalesce(v.scoring_version_id::text, '') || ':' || v.especie_id::text,
      v.scoring_version_id,
      v.especie_id,
      null::jsonb,
      '{}'::text[],
      '{}'::text[]
    from (select distinct b.scoring_version_id, b.especie_id from base b where b.evaluacion_id is null) v
  ), con_clave as (
    select row_number() over () as k, e.* from entradas e
  ), met0 as materialized (
    select
      c.k,
      sm.id as metrica_id,
      sm.metrica,
      sm.categoria,
      sm.peso,
      sm.direccion_favorable,
      coalesce(rr.minimo_esperado, sm.minimo_normalizacion) as minimo,
      coalesce(rr.maximo_esperado, sm.maximo_normalizacion) as maximo,
      rr.minimo_esperado as rr_minimo,
      rr.maximo_esperado as rr_maximo,
      -- Equivale a extraer_metrica_evaluacion(evaluacion, metrica), con la
      -- evaluación ya convertida a jsonb una sola vez.
      (c.ej ->> sm.metrica)::numeric as valor,
      (
        sm.metrica = any(c.con_revision)
        or sm.metrica = any(c.no_comparables)
      ) as marcada
    from con_clave c
    join scoring_metrica sm on sm.scoring_version_id = c.scoring_version_id
    left join rango_referencia rr on rr.id = sm.rango_referencia_id
    -- Fase 4: un descriptor que la especie no usa no entra a su puntaje ni a su cobertura (los pesos se reparten entre los demás).
    where not exists (
      select 1 from esquema_campo_especie ece
      where ece.fase = 'evaluacion_anual' and ece.clave = sm.metrica and ece.especie_id = c.especie_id and not ece.activo
    )
  ), m as (
    select
      m0.*,
      normalizar_metrica_scoring(m0.valor, m0.minimo, m0.maximo, m0.direccion_favorable) as normalizado,
      case
        when m0.rr_maximo is not null and m0.valor is not null then m0.valor > m0.rr_maximo
        else null
      end as fuera_rango_superior,
      case
        when m0.rr_minimo is not null and m0.valor is not null then m0.valor < m0.rr_minimo
        else null
      end as fuera_rango_inferior
    from met0 m0
  ), por_cat as (
    select
      m.k,
      m.categoria,
      case
        when sum(m.peso) filter (where m.valor is not null) > 0 then
          sum(m.normalizado * m.peso) filter (where m.valor is not null)
          / sum(m.peso) filter (where m.valor is not null)
        else null
      end as subpuntaje,
      count(*) filter (where m.valor is not null) as con_valor,
      count(*) as total
    from m
    group by m.k, m.categoria
  ), cat as (
    -- Las cuatro categorías para cada entrada, con o sin métricas.
    select c.k, c.scoring_version_id, todas.categoria, pc.subpuntaje
    from con_clave c
    cross join unnest(enum_range(null::categoria_scoring)) as todas(categoria)
    left join por_cat pc on pc.k = c.k and pc.categoria = todas.categoria
  ), puntaje_categorias as (
    select
      cat.k,
      case
        when sum(scp.peso) filter (where cat.subpuntaje is not null) > 0 then
          sum(cat.subpuntaje * scp.peso) filter (where cat.subpuntaje is not null)
          / sum(scp.peso) filter (where cat.subpuntaje is not null)
        else null
      end as puntaje
    from cat
    join scoring_categoria_peso scp
      on scp.categoria = cat.categoria
     and scp.scoring_version_id = cat.scoring_version_id
    group by cat.k
  ), puntaje_metricas as (
    select
      m.k,
      case
        when sum(m.peso) filter (where m.valor is not null) > 0 then
          sum(m.normalizado * m.peso) filter (where m.valor is not null)
          / sum(m.peso) filter (where m.valor is not null)
        else null
      end as puntaje
    from m
    group by m.k
  ), agregado_metricas as (
    select
      m.k,
      count(*)::integer as configuradas,
      (count(*) filter (where m.valor is not null))::integer as disponibles,
      jsonb_object_agg(
        m.metrica,
        jsonb_build_object(
          'valor', m.valor,
          'peso', m.peso,
          'normalizado', m.normalizado,
          'fuera_rango_superior', m.fuera_rango_superior,
          'fuera_rango_inferior', m.fuera_rango_inferior
        )
      ) as detalle,
      bool_or(m.marcada) as marcada
    from m
    group by m.k
  ), agregado_categorias as (
    select cat.k, jsonb_object_agg(cat.categoria, cat.subpuntaje) as detalle_categorias
    from cat
    group by cat.k
  ), agregado_grupo as (
    -- Fase 2: cobertura por categoría (métricas con valor / métricas de la
    -- versión) y grupo = categorías con subpuntaje, en orden del enum. Solo si se piden.
    select
      pc.k,
      jsonb_object_agg(pc.categoria, jsonb_build_object('con_valor', pc.con_valor, 'total', pc.total)) as cobertura,
      coalesce(
        array_agg(pc.categoria::text order by pc.categoria) filter (where pc.subpuntaje is not null),
        '{}'::text[]
      ) as grupo
    from por_cat pc
    where p_con_grupo
    group by pc.k
  ), resultado as (
    select
      c.clave,
      coalesce(am.configuradas, 0) as configuradas,
      coalesce(am.disponibles, 0) as disponibles,
      case
        when exists (
          select 1 from scoring_categoria_peso scp0
          where scp0.scoring_version_id = c.scoring_version_id
        ) then pcat.puntaje
        else pmet.puntaje
      end as puntaje,
      coalesce(am.detalle, '{}'::jsonb) as detalle,
      coalesce(ac.detalle_categorias, '{}'::jsonb) as detalle_categorias,
      coalesce(am.marcada, false) as tiene_metrica_marcada,
      case when p_con_grupo then coalesce(ag.cobertura, '{}'::jsonb) end as cobertura,
      case when p_con_grupo then coalesce(ag.grupo, '{}'::text[]) end as grupo
    from con_clave c
    left join agregado_metricas am on am.k = c.k
    left join agregado_categorias ac on ac.k = c.k
    left join puntaje_categorias pcat on pcat.k = c.k
    left join puntaje_metricas pmet on pmet.k = c.k
    left join agregado_grupo ag on ag.k = c.k
  )
  select
    b.individuo_id,
    b.codigo_display,
    b.planta_id,
    b.codigo_sistema,
    b.especie_id,
    b.es_prueba,
    b.evaluacion_id,
    b.fecha_evaluacion,
    b.evaluacion_updated_at,
    b.numero_ronda,
    b.estado_evaluacion,
    b.requiere_revision,
    b.no_comparable,
    b.scoring_version_id,
    b.scoring_version_nombre,
    r.configuradas,
    r.disponibles,
    r.puntaje,
    r.tiene_metrica_marcada,
    r.detalle,
    r.detalle_categorias,
    r.cobertura,
    r.grupo
  from base b
  left join resultado r on r.clave = case
    when b.evaluacion_id is not null then b.individuo_id::text
    else 'v:' || coalesce(b.scoring_version_id::text, '') || ':' || b.especie_id::text
  end;
$function$;

