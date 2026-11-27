-- Ejecutar scripts/fusionar_variedades_duplicadas.sql ANTES si hay duplicados.
-- Índice completo: también reserva los nombres de variedades inactivas.
CREATE UNIQUE INDEX variedades_especie_clave_nombre_uniq
ON public.variedades (especie_id, public.clave_nombre_variedad(nombre));
