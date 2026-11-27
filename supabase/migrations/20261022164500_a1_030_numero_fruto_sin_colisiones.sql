-- A1-030: borrar un número intermedio no bloquea los siguientes frutos.
create or replace function public.generar_numero_fruto()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform pg_advisory_xact_lock(hashtext('cosecha_fruto:' || new.planta_id::text));
  select coalesce(max(numero_fruto), 0) + 1 into new.numero_fruto
    from public.cosecha_fruto where planta_id = new.planta_id;
  return new;
end;
$$;
revoke all on function public.generar_numero_fruto() from public, anon, authenticated;
comment on function public.generar_numero_fruto is 'Asigna max(numero_fruto)+1 por cruce bajo advisory lock; borrar un fruto intermedio no provoca colisión.';
