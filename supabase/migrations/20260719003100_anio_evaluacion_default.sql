-- Permite que clientes tipados omitan anio. Este default solo satisface el
-- contrato de INSERT; trg_evaluaciones_integridad lo reemplaza siempre por el
-- año de evaluaciones.fecha antes de validar la fila.
alter table evaluaciones
  alter column anio set default extract(year from current_date)::integer;

