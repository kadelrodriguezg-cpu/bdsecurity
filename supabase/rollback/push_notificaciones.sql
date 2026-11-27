-- =============================================================================
-- Reversión de 20261030100000_push_notificaciones_menciones.sql
-- (notificaciones push del chat, fase 1).
--
-- Orden: jobs de cron → trigger → funciones → tablas → secretos de Vault →
-- registro de la migración. Idempotente: se puede correr más de una vez.
-- No toca chat_menciones ni ningún objeto anterior a la migración: el envío de
-- mensajes y menciones sigue igual que antes. El frontend no necesita
-- revertirse: sin el trigger, el botón de notificaciones queda inofensivo.
--
-- Uso (producción): psql "<conexión>" -v ON_ERROR_STOP=1 -f supabase/rollback/push_notificaciones.sql
-- =============================================================================
begin;

-- 1) Jobs de cron
select cron.unschedule(jobid) from cron.job where jobname in ('push-recoger', 'push-retencion');

-- 2) Trigger
drop trigger if exists trg_push_mencion on public.chat_menciones;

-- 3) Funciones nuevas
drop function if exists public.trigger_push_mencion();
drop function if exists public.recoger_respuestas_push();
drop function if exists public.limpiar_push_envio();
drop function if exists public.despachar_push_envio(bigint);
drop function if exists public.programar_reintento_push(bigint, text, uuid[], boolean);
drop function if exists public.registrar_suscripcion_push(text, text, text, text);
drop function if exists public.eliminar_suscripcion_push(text);

-- 4) Tablas nuevas (push_envio primero: depende de chat_menciones, no al revés)
drop table if exists public.push_envio;
drop table if exists public.push_suscripcion;

-- 5) Secretos de Vault nuevos
delete from vault.secrets where name in ('push_funcion_url', 'push_secreto');

-- 6) Registro de la migración, para que un `db push` futuro la vuelva a aplicar
delete from supabase_migrations.schema_migrations where version = '20261030100000';

notify pgrst, 'reload schema';
commit;
