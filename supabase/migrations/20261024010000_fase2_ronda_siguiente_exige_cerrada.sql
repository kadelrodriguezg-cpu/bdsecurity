-- Fase 2, Sprint 2 (S2-1) — la ronda N+1 solo se abre con la ronda N cerrada.
-- Desde el Sprint 1.2 el expediente no ofrece «Iniciar ronda N+1» hasta que la
-- ronda N tiene una evaluación completa o corregida, pero era solo frontend:
-- iniciar_ronda_esperada (y las dos RPC que delega) abrían la siguiente aunque
-- la anterior siguiera en borrador o sin evaluar.
--
-- La regla vive en un trigger BEFORE INSERT sobre ronda_evaluacion_anual, igual
-- que la guardia de cruce activo (A1-121): es el único punto por donde nace una
-- ronda, así que ninguna RPC (presente o futura) puede saltársela. Rige para
-- las dos series (anual y multisitio, que comparten tabla y estados).
--
-- No toca filas existentes. Sin sesión (auth.uid() is null: migraciones, seed,
-- service_role) no valida, como la guardia de A1-121. El reintento idempotente
-- de iniciar_ronda_esperada devuelve la ronda ya existente sin insertar, así
-- que no pasa por aquí. La evaluación reducida (trasplante/crecimiento) vive en
-- otra tabla, sin rondas, y no se ve afectada.
create function public.validar_ronda_anterior_cerrada()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_nombre text;
begin
  if auth.uid() is null then return new; end if;
  if new.numero_ronda <= 1 then return new; end if;
  if not exists (
    select 1
    from public.ronda_evaluacion_anual r
    join public.evaluaciones e on e.ronda_id = r.id
    where r.individuo_id = new.individuo_id
      and r.tipo_ronda = new.tipo_ronda
      and r.numero_ronda = new.numero_ronda - 1
      and e.estado in ('completa', 'corregida')
  ) then
    v_nombre := case when new.tipo_ronda = 'multisitio' then 'ronda multisitio ' else 'ronda ' end || (new.numero_ronda - 1);
    raise exception 'La % todavía no tiene una evaluación completa. Ciérrala antes de iniciar la siguiente.', v_nombre
      using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_ronda_anterior_cerrada() from public, anon, authenticated;
comment on function public.validar_ronda_anterior_cerrada() is
  'Fase 2 (S2-1): una ronda N+1 solo nace si la ronda N del mismo individuo y serie tiene una evaluación completa o corregida.';

-- El nombre ordena después de ronda_validar_cruce_activo (A1-121): si el cruce está
-- archivado, ese aviso tiene prioridad sobre este.
create trigger ronda_validar_secuencia_cerrada before insert on public.ronda_evaluacion_anual
for each row execute function public.validar_ronda_anterior_cerrada();
