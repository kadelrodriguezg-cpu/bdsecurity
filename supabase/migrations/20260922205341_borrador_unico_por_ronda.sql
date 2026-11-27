-- D5: el formulario solo puede continuar/descartar un borrador por ronda.
-- La unicidad vive en PostgreSQL para cubrir pestañas, dispositivos y carreras
-- concurrentes; idempotency_key sigue resolviendo reintentos del mismo intento.
create unique index evaluaciones_un_borrador_activo_por_ronda_uidx
  on public.evaluaciones (ronda_id)
  where estado = 'borrador';

comment on index public.evaluaciones_un_borrador_activo_por_ronda_uidx is
  'Garantiza como maximo un borrador activo por ronda. Completa, corregida y anulada no participan.';
