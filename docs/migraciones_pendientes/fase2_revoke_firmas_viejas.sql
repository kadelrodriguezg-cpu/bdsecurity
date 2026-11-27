-- PENDIENTE — Fase 2, Sprint 1: REVOKE de las firmas viejas de RPC.
--
-- NO está en supabase/migrations: entra a la cadena solo con el aviso de Kadel,
-- cuando confirme que todo el equipo recargó la app. El frontend del candidato
-- no llama a ninguna de estas firmas; la app vieja de producción sí a algunas.
--
-- Está empaquetado como el PASO 39 del despliegue del candidato 1 (Maestro, «Bitácora de despliegues»), con
-- precheck, aplicación, postcheck y rollback ensayados con la copia de
-- producción. Versión reservada: 20261024060000, nombre fase2_revoke_firmas_viejas
-- (lleva la base de producción de 170 a 171 versiones). Al incorporarla, copiar
-- las cinco sentencias de abajo a
-- supabase/migrations/20261024060000_fase2_revoke_firmas_viejas.sql, tal cual.
--
-- Firmas que se cierran para authenticated (siguen existiendo y las usan sus
-- envolturas SECURITY DEFINER):
--   individualizar_plantas(uuid, integer)        -> lo envuelve individualizar_plantas_una_vez (DEFINER)
--   iniciar_ronda_evaluacion(uuid)               -> lo envuelve iniciar_ronda_esperada
--   iniciar_ronda_multisitio(uuid, uuid)         -> lo envuelve iniciar_ronda_esperada
--   evecl_guardar_ficha(... 14 argumentos ...)   -> lo envuelve evecl_guardar_ficha_con_bajas (DEFINER)
--
-- iniciar_ronda_esperada era SECURITY INVOKER: llamaba a las de rondas con el
-- EXECUTE del usuario. Pasa a SECURITY DEFINER sin cambiar su cuerpo: sus
-- validaciones (sesión, serie y número, lock, número esperado) no dependen del
-- rol, y las funciones internas ya validan cruce activo, individuo vivo y
-- autoría con auth.uid(), que sigue disponible bajo DEFINER.
--
-- Al incorporarla: actualizar tests/rls/auditoria/g10-matriz-esperada.ts (esas
-- cuatro firmas pasan a INTERNA) y correr G4/G5/G9 (rondas, individualización,
-- EVECL).

alter function public.iniciar_ronda_esperada(uuid, text, integer) security definer;

revoke execute on function public.individualizar_plantas(uuid, integer) from public, anon, authenticated;
revoke execute on function public.iniciar_ronda_evaluacion(uuid) from public, anon, authenticated;
revoke execute on function public.iniciar_ronda_multisitio(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.evecl_guardar_ficha(bigint, bigint, text, text, text, public.evecl_tipo_ficha, integer, text, text, date, date, text, jsonb, uuid) from public, anon, authenticated;
