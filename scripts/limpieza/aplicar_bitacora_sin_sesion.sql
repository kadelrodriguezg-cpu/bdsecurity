-- Clase 5 (APLICAR): marca como eliminados (borrado lógico, REVERSIBLE) los eventos de
-- bitácora de polinización sin sesión. Ver informe_bitacora_sin_sesion.sql.
-- Solo los AUTOMATIZABLES: sin archivos adjuntos, cruce activo y fuera de
-- proceso_finalizado. Restaurar un evento: update registros_evento set eliminado_at = null.
--
-- NO ES PARA CORRER EN PRODUCCIÓN SIN respaldo previo (docs/respaldo_produccion.md)
-- y el OK escrito de Kadel. Probado solo en local.
--
-- El borrado lógico exige ser administrador (trigger bloquear_borrado_no_admin), así que el
-- script actúa «como» el admin indicado en admin_id: fija request.jwt.claim.sub SOLO para
-- el UPDATE y comprueba antes que ese perfil sea realmente admin. admin_id es quien
-- autoriza (Kadel); queda como usuario_id en las filas de audit_log, junto con operador.
--
-- Una transacción: recalcula el conjunto, muestra el conteo y solo aplica si
-- confirmar=SI, esperado coincide y operador/admin_id son válidos; si no, rollback.
-- Cada evento marcado deja su fila 'eliminacion_evento' (trigger) y una 'limpieza_datos'.
--
-- Uso (siempre PRIMERO sin confirmar):
--   docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres \
--     -v operador="nombre de quien ejecuta" -v admin_id=<uuid de un admin> [-v filtro_codigo=LIMP-] \
--     [-v esperado=<n> -v confirmar=SI] < aplicar_bitacora_sin_sesion.sql
-- Variables: operador, admin_id (obligatorias para aplicar), confirmar ('NO'), esperado (''),
--            filtro_codigo ('') como en los demás scripts.
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
\if :{?admin_id}
\else
  \set admin_id ''
\endif
\if :{?filtro_codigo}
\else
  \set filtro_codigo ''
\endif

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
lock table public.polinizacion_evento, public.registros_evento in share row exclusive mode;

create temp table _lim_eventos on commit drop as
select r.id as registro_id, r.planta_id, pl.codigo_sistema, r.fecha, r.created_by
from public.registros_evento r
join public.plantas pl on pl.id = r.planta_id
where r.tipo_evento = 'polinizacion' and r.eliminado_at is null
  and pl.eliminado_at is null and pl.estado <> 'proceso_finalizado'
  and starts_with(pl.codigo_sistema, :'filtro_codigo')
  and not exists (select 1 from public.polinizacion_evento e where e.planta_id = r.planta_id and e.fecha = r.fecha)
  and not exists (select 1 from public.evento_archivos a where a.registro_id = r.id);

select count(*) as n from _lim_eventos \gset
\echo 'Clase 5: eventos de bitácora a marcar como eliminados =' :n
select codigo_sistema, fecha, registro_id from _lim_eventos order by codigo_sistema, fecha limit 50;

-- admin_id debe ser un perfil admin existente (si no, no se aplica).
select (:'admin_id' ~ '^[0-9a-fA-F-]{36}$'
        and exists (select 1 from public.perfiles p where p.id::text = lower(:'admin_id') and p.rol = 'admin')) as admin_valido \gset
select (:'confirmar' = 'SI' and :'esperado' = :'n' and :'operador' <> '' and :'admin_valido'::boolean) as autorizado \gset
\if :autorizado
  select set_config('request.jwt.claim.sub', lower(:'admin_id'), true);
  update public.registros_evento r set eliminado_at = now()
  from _lim_eventos l where r.id = l.registro_id;
  select set_config('request.jwt.claim.sub', '', true);

  insert into public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  select lower(:'admin_id')::uuid, l.planta_id, 'limpieza_datos', array['registros_evento'],
         jsonb_build_object(
           'clase', 'bitacora_sin_sesion', 'script', 'aplicar_bitacora_sin_sesion.sql',
           'cambio', 'eliminacion_logica_evento', 'registro_id', l.registro_id, 'fecha', l.fecha,
           'motivo', 'El evento de bitacora no tenia sesion de polinizacion del mismo cruce y fecha (A1-G2-06). Reversible: eliminado_at = null.',
           'operador', :'operador')
  from _lim_eventos l;

  insert into public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (lower(:'admin_id')::uuid, null, 'limpieza_datos_resumen', array['registros_evento'],
          jsonb_build_object('clase', 'bitacora_sin_sesion', 'script', 'aplicar_bitacora_sin_sesion.sql',
                             'eventos_marcados', :'n'::int, 'esperado', :'esperado', 'filtro_codigo', :'filtro_codigo',
                             'operador', :'operador'));

  select count(*) as faltan from _lim_eventos l
  join public.registros_evento r on r.id = l.registro_id where r.eliminado_at is null \gset
  select (:faltan = 0) as verificado \gset
  \if :verificado
    commit;
    \echo 'APLICADO: eventos de bitácora marcados como eliminados =' :n
  \else
    rollback;
    \echo 'ERROR: la verificación posterior falló; se revirtió todo.'
  \endif
\else
  rollback;
  \echo 'NO SE APLICÓ NADA (rollback). Para aplicar: -v confirmar=SI -v esperado=' :n ' -v operador="..." -v admin_id=<uuid admin>'
\endif
