-- Rollback del paso 56 (reactivar una planta dada de baja). Se niega si ya hay reactivaciones: borrar su historial
-- perdería quién reactivó qué y por qué. Vuelve al disparador anterior (baja sin excepciones) y quita la función y la tabla.
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reactivacion_individuo) THEN
    RAISE EXCEPTION 'FAIL: rollback 56: ya hay plantas reactivadas';
  END IF;
END;
$chk$;

create or replace function bloquear_rebaja_individuo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estado_vital <> 'vivo'
     and (new.estado_vital is distinct from old.estado_vital or new.fecha_baja is distinct from old.fecha_baja)
  then
    raise exception 'Este individuo ya fue dado de baja (%) el % — no se puede volver a dar de baja', old.estado_vital, old.fecha_baja
      using errcode = '42501';
  end if;
  return new;
end;
$$;

DROP FUNCTION public.reactivar_individuo(uuid, text);
DROP TABLE public.reactivacion_individuo;
