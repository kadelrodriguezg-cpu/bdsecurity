-- Fecha semántica para priorizar cruces por avance científico, sin confundir
-- ediciones de metadatos (`updated_at`) con cambios reales de fase.
alter table plantas add column fecha_cambio_estado timestamptz;

update plantas p
set fecha_cambio_estado = coalesce(
  (
    select max(a.ocurrido_en)
    from audit_log a
    where a.planta_id = p.id and a.accion = 'cambio_estado'
  ),
  p.created_at
);

alter table plantas
  alter column fecha_cambio_estado set default now(),
  alter column fecha_cambio_estado set not null;

create or replace function actualizar_fecha_cambio_estado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado is distinct from old.estado then
    new.fecha_cambio_estado = now();
  end if;
  return new;
end;
$$;

create trigger trg_plantas_fecha_cambio_estado
  before update of estado on plantas
  for each row execute function actualizar_fecha_cambio_estado();

create or replace view plantas_operativas
  with (security_invoker = on)
as
  select
    p.id,
    p.codigo_sistema,
    p.especie_id,
    e.nombre as especie_nombre,
    p.estado,
    p.created_at,
    p.updated_at,
    p.genetica_a,
    p.genetica_b,
    p.numero_notion_legacy,
    p.fecha_cambio_estado
  from plantas p
  join especies e on e.id = p.especie_id
  where p.eliminado_at is null;

grant select (fecha_cambio_estado) on plantas to authenticated;
grant select on plantas_operativas to authenticated;

comment on column plantas.fecha_cambio_estado is
  'Último cambio real de fase. No cambia al editar otros datos del cruce.';

