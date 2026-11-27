-- Clase 4 (APLICAR): crea el evento de bitácora que faltó a cada sesión de polinización.
-- Ver informe_sesiones_sin_bitacora.sql para la definición. Corrige UNA fila por
-- cruce y fecha (si hay varias sesiones ese día, usa la más reciente), con los
-- mismos datos que escribe la app: tipo 'polinizacion', fecha de la sesión y
-- datos {fecha_polinizacion, n_flores_cruzadas}. Autor y created_at: los de la sesión.
--
-- NO ES PARA CORRER EN PRODUCCIÓN SIN respaldo previo (docs/respaldo_produccion.md)
-- y el OK escrito de Kadel. Probado solo en local.
--
-- Todo ocurre en UNA transacción: recalcula el conjunto, muestra el conteo y solo
-- aplica si confirmar=SI, esperado coincide con el conteo y operador no está
-- vacío; si no, hace rollback y no cambia nada. Deja una fila en audit_log por
-- evento creado (accion 'limpieza_datos') y una fila resumen.
--
-- Uso (siempre PRIMERO sin confirmar, para ver el conteo):
--   docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres \
--     -v operador="nombre de quien ejecuta" [-v filtro_codigo=LIMP-] \
--     [-v esperado=<n> -v confirmar=SI] < aplicar_sesiones_sin_bitacora.sql
-- Variables:
--   operador        (obligatoria para aplicar) quien ejecuta; queda en audit_log.
--   confirmar       ('NO') debe ser exactamente SI.
--   esperado        ('')   número de eventos a crear que mostró el modo sin confirmar.
--   filtro_codigo   ('')   limita a cruces cuyo codigo_sistema empieza con ese texto.
\set ON_ERROR_STOP on
\if :{?confirmar}
\else
  \set confirmar NO
\endif
\if :{?esperado}
\else
  \set esperado ''
\endif
\if :{?operador}
\else
  \set operador ''
\endif
\if :{?filtro_codigo}
\else
  \set filtro_codigo ''
\endif

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
lock table public.polinizacion_evento, public.registros_evento in share row exclusive mode;

-- Conjunto a corregir (se recalcula aquí, no se confía en un informe anterior).
create temp table _lim_sesiones on commit drop as
select distinct on (e.planta_id, e.fecha)
       e.id as sesion_id, e.planta_id, pl.codigo_sistema, e.fecha, e.n_flores_cruzadas, e.created_by, e.created_at
from public.polinizacion_evento e
join public.plantas pl on pl.id = e.planta_id
where pl.eliminado_at is null
  and starts_with(pl.codigo_sistema, :'filtro_codigo')
  and not exists (
    select 1 from public.registros_evento r
    where r.planta_id = e.planta_id and r.tipo_evento = 'polinizacion'
      and r.fecha = e.fecha and r.eliminado_at is null)
order by e.planta_id, e.fecha, e.created_at desc, e.id desc;

select count(*) as n from _lim_sesiones \gset
\echo 'Clase 4: eventos de bitácora a crear =' :n
select codigo_sistema, fecha, n_flores_cruzadas, sesion_id from _lim_sesiones order by codigo_sistema, fecha limit 50;

select (:'confirmar' = 'SI' and :'esperado' = :'n' and :'operador' <> '') as autorizado \gset
\if :autorizado
  with nuevos as (
    insert into public.registros_evento (planta_id, tipo_evento, fecha, datos, notas, created_by, created_at, updated_at)
    select planta_id, 'polinizacion', fecha,
           jsonb_build_object('fecha_polinizacion', fecha, 'n_flores_cruzadas', n_flores_cruzadas),
           null, created_by, created_at, created_at
    from _lim_sesiones
    returning id, planta_id, fecha
  )
  insert into public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  select null, nv.planta_id, 'limpieza_datos', array['registros_evento'],
         jsonb_build_object(
           'clase', 'sesion_sin_bitacora', 'script', 'aplicar_sesiones_sin_bitacora.sql',
           'cambio', 'crear_evento_bitacora', 'registro_id', nv.id, 'sesion_id', s.sesion_id, 'fecha', s.fecha,
           'motivo', 'La sesion de polinizacion no tenia evento de bitacora (A1-G2-06): se crea el evento que faltó.',
           'operador', :'operador')
  from nuevos nv join _lim_sesiones s on s.planta_id = nv.planta_id and s.fecha = nv.fecha;

  insert into public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (null, null, 'limpieza_datos_resumen', array['registros_evento'],
          jsonb_build_object('clase', 'sesion_sin_bitacora', 'script', 'aplicar_sesiones_sin_bitacora.sql',
                             'eventos_creados', :'n'::int, 'esperado', :'esperado', 'filtro_codigo', :'filtro_codigo',
                             'operador', :'operador'));

  -- Verificación: ninguna sesión del conjunto debe seguir sin evento.
  select count(*) as faltan from _lim_sesiones s
  where not exists (select 1 from public.registros_evento r
                    where r.planta_id = s.planta_id and r.tipo_evento = 'polinizacion'
                      and r.fecha = s.fecha and r.eliminado_at is null) \gset
  select (:faltan = 0) as verificado \gset
  \if :verificado
    commit;
    \echo 'APLICADO: eventos de bitácora creados =' :n
  \else
    rollback;
    \echo 'ERROR: la verificación posterior falló; se revirtió todo.'
  \endif
\else
  rollback;
  \echo 'NO SE APLICÓ NADA (rollback). Para aplicar: -v confirmar=SI -v esperado=' :n ' -v operador="..."'
\endif
