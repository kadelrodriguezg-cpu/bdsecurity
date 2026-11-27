-- Fase 2, Sprint 1 — estados de una evaluación para la vista «evaluación pasada».
-- Devuelve el protocolo congelado de la evaluación (o null si es anterior a
-- los protocolos) y el estado de cada descriptor (estados_descriptores).
-- SECURITY INVOKER: respeta el RLS de evaluaciones y protocolo_ronda.

create function public.obtener_estados_evaluacion(p_evaluacion_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_evaluacion evaluaciones;
  v_protocolo protocolo_ronda;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  select * into v_evaluacion from evaluaciones where id = p_evaluacion_id;
  if not found then
    raise exception 'Evaluación no encontrada' using errcode = 'P0002';
  end if;
  select * into v_protocolo from protocolo_ronda where id = v_evaluacion.protocolo_id;
  return jsonb_build_object(
    'evaluacion_id', v_evaluacion.id,
    'protocolo', case when v_protocolo.id is null then null else jsonb_build_object(
      'id', v_protocolo.id, 'version', v_protocolo.version, 'nombre', v_protocolo.nombre,
      'descriptores', v_protocolo.descriptores, 'created_at', v_protocolo.created_at) end,
    'estados', estados_descriptores(v_evaluacion)
  );
end;
$$;

revoke all on function public.obtener_estados_evaluacion(uuid) from public, anon;
grant execute on function public.obtener_estados_evaluacion(uuid) to authenticated;
comment on function public.obtener_estados_evaluacion(uuid) is
  'Fase 2: protocolo congelado y estado de cada descriptor (medido | falto | no_evaluado | marcado) de una evaluación.';
