-- Rollback del paso 48 (vigente_desde y etiquetas de la precocidad). Sin datos de terreno en juego: solo metadatos del esquema.
UPDATE public.esquema_fase_campo
SET etiqueta_minimo = 'muy tardía', etiqueta_maximo = 'muy precoz', etiquetas_nivel = NULL
WHERE fase = 'evaluacion_anual' AND clave = 'precocidad';
ALTER TABLE public.esquema_fase_campo DROP COLUMN vigente_desde;
