-- =============================================================================
-- MIGRACIÓN 20261026180000 — FASE 5, PASO 56: REACTIVAR UNA PLANTA DADA DE BAJA (decisión G4)
--
-- Hallazgo 6 de la guía del administrador: una baja por error no tenía vuelta atrás desde la app (había que pedirlo al
-- soporte). La baja sigue siendo irreversible por cualquier camino EXCEPTO esta función, que solo puede usar un admin, con
-- motivo obligatorio:
--
--   reactivacion_individuo         historial de reactivaciones (estado y fecha de baja anteriores, motivo, quién, cuándo).
--                                  Nace con RLS: la leen los usuarios autenticados (no tiene linaje); nadie escribe directo.
--   reactivar_individuo(planta, motivo)   solo admin; la planta debe estar de baja y su cruce no archivado. Vuelve a
--                                  «vivo», borra la fecha de baja, guarda el historial y audita «reactivacion_individuo».
--   bloquear_rebaja_individuo      el disparador que hace irreversible la baja deja pasar SOLO la reactivación que hace
--                                  esta función en la misma transacción (marca local app.reactivacion_individuo).
-- Los motivos de la baja (baja_motivo) se conservan: son parte del historial de la planta.
-- Rollback: docs/fase5/rollback/56_reactivar.sql (se niega si ya hay reactivaciones).
-- =============================================================================

create table public.reactivacion_individuo (
  id uuid primary key default gen_random_uuid(),
  -- En cascada: un individuo solo se borra de verdad al purgar un cruce de prueba; su historial de reactivaciones se va con él.
  individuo_id uuid not null references public.individuos(id) on delete cascade,
  estado_anterior public.estado_vital not null check (estado_anterior <> 'vivo'),
  fecha_baja_anterior date,
  motivo text not null check (length(btrim(motivo)) between 1 and 500),
  created_by uuid references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_reactivacion_individuo on public.reactivacion_individuo (individuo_id, created_at desc);
comment on table public.reactivacion_individuo is
  'Fase 5 (G4): historial de plantas dadas de baja que un admin reactivó, con motivo. Solo se escribe con reactivar_individuo.';

alter table public.reactivacion_individuo enable row level security;
create policy reactivacion_individuo_select_autenticados on public.reactivacion_individuo
  for select to authenticated using ((select auth.uid()) is not null);
revoke all on public.reactivacion_individuo from public, anon, authenticated;
grant select on public.reactivacion_individuo to authenticated;

create function public.reactivar_individuo(p_individuo_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ind record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not es_admin() then
    raise exception 'Solo un admin puede reactivar una planta dada de baja.' using errcode = '42501';
  end if;
  if v_motivo is null then
    raise exception 'Escribe el motivo para reactivar la planta.' using errcode = '22023';
  end if;
  if length(v_motivo) > 500 then
    raise exception 'El motivo puede tener hasta 500 caracteres.' using errcode = '22023';
  end if;

  select i.id, i.planta_id, i.estado_vital, i.fecha_baja, p.eliminado_at
    into v_ind
  from individuos i join plantas p on p.id = i.planta_id
  where i.id = p_individuo_id
  for update of i;
  if not found then
    raise exception 'La planta no existe.' using errcode = 'P0002';
  end if;
  if v_ind.eliminado_at is not null then
    raise exception 'El cruce está archivado: restáuralo en Administrar cruces antes de reactivar la planta.' using errcode = '23514';
  end if;
  if v_ind.estado_vital = 'vivo' then
    raise exception 'La planta está viva: no hay una baja que revertir.' using errcode = '23514';
  end if;

  insert into reactivacion_individuo (individuo_id, estado_anterior, fecha_baja_anterior, motivo, created_by)
  values (p_individuo_id, v_ind.estado_vital, v_ind.fecha_baja, v_motivo, auth.uid());

  -- Única excepción a la baja irreversible: el disparador la reconoce por esta marca local de la transacción.
  perform set_config('app.reactivacion_individuo', p_individuo_id::text, true);
  update individuos set estado_vital = 'vivo', fecha_baja = null where id = p_individuo_id;
  perform set_config('app.reactivacion_individuo', '', true);

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (auth.uid(), v_ind.planta_id, 'reactivacion_individuo', array['estado_vital', 'fecha_baja'],
          jsonb_build_object('individuo_id', p_individuo_id, 'estado_anterior', v_ind.estado_vital,
                             'fecha_baja_anterior', v_ind.fecha_baja, 'motivo', v_motivo));
end;
$$;
comment on function public.reactivar_individuo(uuid, text) is
  'Fase 5 (G4): el admin reactiva una planta dada de baja, con motivo obligatorio; guarda el historial (reactivacion_individuo) y audita «reactivacion_individuo».';
revoke all on function public.reactivar_individuo(uuid, text) from public, anon;
grant execute on function public.reactivar_individuo(uuid, text) to authenticated;

create or replace function bloquear_rebaja_individuo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fase 5 (G4): la única excepción es la reactivación que hace reactivar_individuo en esta misma transacción.
  if old.estado_vital <> 'vivo' and new.estado_vital = 'vivo' and new.fecha_baja is null
     and current_setting('app.reactivacion_individuo', true) = old.id::text then
    return new;
  end if;
  if old.estado_vital <> 'vivo'
     and (new.estado_vital is distinct from old.estado_vital or new.fecha_baja is distinct from old.fecha_baja)
  then
    raise exception 'Este individuo ya fue dado de baja (%) el % — no se puede volver a dar de baja', old.estado_vital, old.fecha_baja
      using errcode = '42501';
  end if;
  return new;
end;
$$;
