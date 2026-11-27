-- Defensa en profundidad: un texto libre puede contener accidentalmente una
-- indicación más precisa que predio/sector. Los autenticados solo reciben las
-- columnas agregadas del historial. La ubicación exacta sigue en su tabla
-- admin-only y `referencia_operativa` tampoco se concede al rol de API.

revoke select on emplazamiento_individuo from authenticated;

grant select (
  id,
  individuo_id,
  sector_id,
  fecha_inicio,
  fecha_fin,
  created_by,
  created_at
) on emplazamiento_individuo to authenticated;

comment on column emplazamiento_individuo.referencia_operativa is
  'Referencia potencialmente precisa. No tiene grant SELECT para authenticated; operarios consultan solo predio/sector y fechas.';

