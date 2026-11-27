-- A1-063: la intención identifica individuo + serie + número esperado.
-- INVOKER conserva RLS de lectura y delega las reglas de alta en las RPC
-- existentes. Un reintento recupera esa ronda, nunca consume la siguiente.
create or replace function public.iniciar_ronda_esperada(p_individuo_id uuid, p_tipo text, p_numero_esperado integer)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_id uuid;
  v_siguiente integer;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if p_tipo is null or p_tipo not in ('anual', 'multisitio')
    or p_numero_esperado is null or p_numero_esperado not between 1 and 3 then
    raise exception 'Serie o número de ronda inválido' using errcode = '22023';
  end if;
  perform id from public.individuos where id = p_individuo_id;
  if not found then raise exception 'Individuo inexistente o sin acceso' using errcode = 'P0002'; end if;
  -- FOR UPDATE aplicaría RLS de edición del individuo (solo autor/admin).
  -- Crear rondas tiene otro permiso; serializar sin ampliar esa policy.
  perform pg_advisory_xact_lock(hashtextextended('ronda:' || p_individuo_id::text || ':' || p_tipo, 0));
  select id into v_id from public.ronda_evaluacion_anual
    where individuo_id = p_individuo_id and tipo_ronda::text = p_tipo and numero_ronda = p_numero_esperado;
  if found then return jsonb_build_object('ronda_id', v_id, 'numero_ronda', p_numero_esperado); end if;
  select coalesce(max(numero_ronda), 0) + 1 into v_siguiente from public.ronda_evaluacion_anual
    where individuo_id = p_individuo_id and tipo_ronda::text = p_tipo;
  if v_siguiente <> p_numero_esperado then
    -- Requiere nueva decisión del usuario; no es un fallo transitorio de
    -- serialización (40001): repetir el mismo número no resuelve el conflicto.
    raise exception 'Las rondas cambiaron. Recarga el listado antes de iniciar otra.' using errcode = '55000';
  end if;
  if p_tipo = 'anual' then return public.iniciar_ronda_evaluacion(p_individuo_id); end if;
  return public.iniciar_ronda_multisitio(p_individuo_id);
end;
$$;
revoke all on function public.iniciar_ronda_esperada(uuid,text,integer) from public, anon;
grant execute on function public.iniciar_ronda_esperada(uuid,text,integer) to authenticated;
