-- A1-007: las rondas nacen únicamente de las RPC que validan vivo, fase,
-- correlativo, año, contexto y máximo de tres por serie.
-- Ambas son SECURITY DEFINER; no requieren INSERT de authenticated.
revoke insert on public.ronda_evaluacion_anual from authenticated;
