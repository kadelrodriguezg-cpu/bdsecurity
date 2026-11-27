-- Fase 2, Sprint 1 — A1-105 (G11-02): la unificación de una ronda desempata por
-- un instante de captura inmutable, no por updated_at.
--
-- Antes: unificar_evaluacion_ronda y obtener_procedencia_calidad_ronda tomaban
-- para cada descriptor el valor más reciente por fecha/updated_at/id. Corregir
-- una evaluación movía su updated_at y la volvía «la más reciente» para TODOS
-- sus descriptores: un dato que nadie corrigió podía volver a un valor viejo.
--
-- Ahora: columna evaluaciones.capturada_at = instante en que se insertó la
-- evaluación. La fija el trigger al insertar (ignora lo que mande el cliente) y
-- no cambia nunca después. Las dos funciones ordenan por fecha/capturada_at/id.
-- Una corrección cambia solo lo corregido.
--
-- Relleno: las filas existentes toman created_at. Medido en producción el
-- 22-10-2026 (docs/a1_105_impacto_produccion.md): ninguna ronda, planta ni
-- puntaje cambia. El relleno se hace con los triggers de usuario apagados para
-- no mover updated_at ni escribir auditoría de edición por un cambio de esquema.
--
-- De paso: obtener_procedencia_calidad_ronda deja de contar como «descriptor»
-- las columnas de metadata capturada_at y protocolo_id (esta llegó en el
-- Sprint 1). Sus dos consumidores no cambian: cruzan el resultado con las
-- métricas del scoring.

alter table public.evaluaciones add column capturada_at timestamptz;

alter table public.evaluaciones disable trigger user;
update public.evaluaciones set capturada_at = created_at;
alter table public.evaluaciones enable trigger user;

alter table public.evaluaciones
  alter column capturada_at set default now(),
  alter column capturada_at set not null;

comment on column public.evaluaciones.capturada_at is
  'Instante de captura (inserción) de la evaluación. Inmutable. Desempata la unificación de una ronda entre visitas de la misma fecha (A1-105).';

create function public.fijar_capturada_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.capturada_at := now();
  else
    new.capturada_at := old.capturada_at;
  end if;
  return new;
end;
$$;

comment on function public.fijar_capturada_at() is
  'A1-105: capturada_at se fija al insertar y no cambia después, venga lo que venga del cliente.';
revoke all on function public.fijar_capturada_at() from public, anon, authenticated;

create trigger evaluaciones_fijar_capturada_at
  before insert or update on public.evaluaciones
  for each row execute function public.fijar_capturada_at();


CREATE OR REPLACE FUNCTION public.unificar_evaluacion_ronda(p_ronda_id uuid)
 RETURNS SETOF evaluaciones
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with cerradas as materialized (
    select e.*
    from evaluaciones e
    where e.ronda_id = p_ronda_id
      and e.estado in ('completa', 'corregida')
  ), representante as (
    select e as evaluacion
    from cerradas e
    order by e.fecha desc, e.capturada_at desc, e.id desc
    limit 1
  ), descriptores as (
    select
      (array_agg(e.brotacion order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.brotacion is not null))[1] as brotacion,
      (array_agg(e.floracion order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.floracion is not null))[1] as floracion,
      (array_agg(e.cuaja order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.cuaja is not null))[1] as cuaja,
      (array_agg(e.concentracion_cosecha order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.concentracion_cosecha is not null))[1] as concentracion_cosecha,
      (array_agg(e.calibre_mm order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.calibre_mm is not null))[1] as calibre_mm,
      (array_agg(e.firmeza order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.firmeza is not null))[1] as firmeza,
      (array_agg(e.color order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.color is not null))[1] as color,
      (array_agg(e.bloom order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.bloom is not null))[1] as bloom,
      (array_agg(e.brix order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.brix is not null))[1] as brix,
      (array_agg(e.rend_kg_planta order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.rend_kg_planta is not null))[1] as rend_kg_planta,
      (array_agg(e.rend_t_ha order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.rend_t_ha is not null))[1] as rend_t_ha,
      (array_agg(e.pct_fruta_exportable order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_fruta_exportable is not null))[1] as pct_fruta_exportable,
      (array_agg(e.dano_calor order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.dano_calor is not null))[1] as dano_calor,
      (array_agg(e.golpe_sol order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.golpe_sol is not null))[1] as golpe_sol,
      (array_agg(e.caida_fruto order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.caida_fruto is not null))[1] as caida_fruto,
      (array_agg(e.n_varas_basales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_varas_basales is not null))[1] as n_varas_basales,
      (array_agg(e.n_varas_con_flor order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_varas_con_flor is not null))[1] as n_varas_con_flor,
      (array_agg(e.n_flores_varas_basales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_flores_varas_basales is not null))[1] as n_flores_varas_basales,
      (array_agg(e.n_frutos_varas_basales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_frutos_varas_basales is not null))[1] as n_frutos_varas_basales,
      (array_agg(e.altura_brote_mm order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.altura_brote_mm is not null))[1] as altura_brote_mm,
      (array_agg(e.diametro_brote_mm order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.diametro_brote_mm is not null))[1] as diametro_brote_mm,
      (array_agg(e.vigor_vegetativo order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.vigor_vegetativo is not null))[1] as vigor_vegetativo,
      (array_agg(e.color_follaje order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.color_follaje is not null))[1] as color_follaje,
      (array_agg(e.presencia_yemas_florales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.presencia_yemas_florales is not null))[1] as presencia_yemas_florales,
      (array_agg(e.fecha_inicio_floracion order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.fecha_inicio_floracion is not null))[1] as fecha_inicio_floracion,
      (array_agg(e.precocidad order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.precocidad is not null))[1] as precocidad,
      (array_agg(e.pct_flores order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_flores is not null))[1] as pct_flores,
      (array_agg(e.pct_frutos order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_frutos is not null))[1] as pct_frutos
    from cerradas e
  ), muestra as (
    select e.cantidad_frutos, e.peso_total_g, e.peso_promedio_g
    from cerradas e
    where e.cantidad_frutos is not null
      and e.peso_total_g is not null
    order by e.fecha desc, e.capturada_at desc, e.id desc
    limit 1
  )
  select jsonb_populate_record(
    null::evaluaciones,
    to_jsonb(rep.evaluacion) || to_jsonb(d) || jsonb_build_object(
      'cantidad_frutos', m.cantidad_frutos,
      'peso_total_g', m.peso_total_g,
      'peso_promedio_g', m.peso_promedio_g
    )
  )
  from representante rep
  cross join descriptores d
  left join muestra m on true;
$function$;

comment on function public.unificar_evaluacion_ronda(uuid) is
  'Fotografia unificada de una ronda: cada descriptor usa el valor no NULL mas reciente por fecha/capturada_at/id DESC (A1-105: una correccion no reordena las visitas). Los porcentajes generados conservan numerador y denominador de una misma visita. La tripleta cantidad/peso/promedio tambien es atomica.';

CREATE OR REPLACE FUNCTION public.obtener_procedencia_calidad_ronda(p_ronda_id uuid)
 RETURNS TABLE(descriptores_con_revision text[], descriptores_no_comparables text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with cerradas as materialized (
    select e.*
    from evaluaciones e
    where e.ronda_id = p_ronda_id
      and e.estado in ('completa', 'corregida')
  ), columnas_descriptor as (
    -- Toda columna de evaluaciones que no sea metadata de la fila ni la
    -- tripleta cantidad/peso/promedio (que tiene su propia regla de
    -- atomicidad, resuelta abajo por separado).
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'evaluaciones'
      and column_name not in (
        'id', 'ronda_id', 'estado', 'fecha', 'anio', 'evaluador', 'observaciones',
        'sin_muestra', 'requiere_revision', 'no_comparable', 'motivo_cambio',
        'created_by', 'created_at', 'updated_at', 'idempotency_key', 'predio_id',
        'capturada_at', 'protocolo_id',
        'cantidad_frutos', 'peso_total_g', 'peso_promedio_g'
      )
  ), desplegado as (
    select
      c.id, c.fecha, c.capturada_at, c.requiere_revision, c.no_comparable,
      cd.column_name as descriptor,
      (to_jsonb(c) ->> cd.column_name) as valor_texto
    from cerradas c
    cross join columnas_descriptor cd
  ), ganador_por_descriptor as (
    -- Mismo criterio de desempate que el array_agg(...)[1] de
    -- unificar_evaluacion_ronda: entre las visitas donde ESE descriptor
    -- tiene valor, la mas reciente por fecha/capturada_at/id (A1-105).
    select distinct on (descriptor)
      descriptor, requiere_revision, no_comparable
    from desplegado
    where valor_texto is not null
    order by descriptor, fecha desc, capturada_at desc, id desc
  ), ganador_muestra as (
    -- Misma regla que la CTE "muestra" de unificar_evaluacion_ronda: la
    -- tripleta viaja junta desde una sola visita, su bandera es la de esa
    -- visita, no la de cada columna por separado.
    select 'cantidad_frutos'::text as descriptor, e.requiere_revision, e.no_comparable
    from cerradas e
    where e.cantidad_frutos is not null and e.peso_total_g is not null
    order by e.fecha desc, e.capturada_at desc, e.id desc
    limit 1
  ), todos as (
    select * from ganador_por_descriptor
    union all
    select * from ganador_muestra
  )
  select
    coalesce(array_agg(descriptor order by descriptor) filter (where requiere_revision), '{}'::text[]),
    coalesce(array_agg(descriptor order by descriptor) filter (where no_comparable), '{}'::text[])
  from todos;
$function$;
