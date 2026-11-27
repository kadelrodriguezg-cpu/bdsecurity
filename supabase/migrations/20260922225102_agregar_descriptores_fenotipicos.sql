-- Fase 5: once descriptores capturables y dos derivados. Todos los insumos
-- siguen siendo opcionales; cerrar una visita no exige completitud.
--
-- La fecha usa un rango civil estable (2000-2100), no current_date: evita
-- errores tipograficos evidentes sin rechazar una observacion reciente o una
-- fecha planificada por depender del dia en que se ejecuta la validacion.
alter table public.evaluaciones
  add column n_varas_basales integer,
  add column n_varas_con_flor integer,
  add column n_flores_varas_basales integer,
  add column n_frutos_varas_basales integer,
  add column altura_brote_mm numeric,
  add column diametro_brote_mm numeric,
  add column vigor_vegetativo smallint,
  add column color_follaje smallint,
  add column presencia_yemas_florales smallint,
  add column fecha_inicio_floracion date,
  add column precocidad smallint,
  add column pct_flores numeric generated always as (
    n_varas_con_flor::numeric / nullif(n_varas_basales, 0)::numeric * 100::numeric
  ) stored,
  add column pct_frutos numeric generated always as (
    n_frutos_varas_basales::numeric / nullif(n_flores_varas_basales, 0)::numeric * 100::numeric
  ) stored,
  add constraint evaluaciones_n_varas_basales_check
    check (n_varas_basales is null or n_varas_basales >= 0),
  add constraint evaluaciones_n_varas_con_flor_check
    check (n_varas_con_flor is null or n_varas_con_flor >= 0),
  add constraint evaluaciones_n_flores_varas_basales_check
    check (n_flores_varas_basales is null or n_flores_varas_basales >= 0),
  add constraint evaluaciones_n_frutos_varas_basales_check
    check (n_frutos_varas_basales is null or n_frutos_varas_basales >= 0),
  add constraint evaluaciones_altura_brote_mm_check
    check (
      altura_brote_mm is null
      or (
        altura_brote_mm >= 0
        and altura_brote_mm <> all (array['NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric])
      )
    ),
  add constraint evaluaciones_diametro_brote_mm_check
    check (
      diametro_brote_mm is null
      or (
        diametro_brote_mm >= 0
        and diametro_brote_mm <> all (array['NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric])
      )
    ),
  add constraint evaluaciones_vigor_vegetativo_check
    check (vigor_vegetativo is null or vigor_vegetativo between 1 and 5),
  add constraint evaluaciones_color_follaje_check
    check (color_follaje is null or color_follaje between 1 and 5),
  add constraint evaluaciones_presencia_yemas_florales_check
    check (presencia_yemas_florales is null or presencia_yemas_florales between 0 and 5),
  add constraint evaluaciones_fecha_inicio_floracion_check
    check (
      fecha_inicio_floracion is null
      or fecha_inicio_floracion between date '2000-01-01' and date '2100-12-31'
    ),
  add constraint evaluaciones_precocidad_check
    check (precocidad is null or precocidad between 1 and 5);

comment on column public.evaluaciones.pct_flores is
  'Cobertura floral calculada: n_varas_con_flor / n_varas_basales * 100. NULL si el denominador es NULL o cero.';
comment on column public.evaluaciones.pct_frutos is
  'Cuaja calculada: n_frutos_varas_basales / n_flores_varas_basales * 100. NULL si el denominador es NULL o cero.';
comment on column public.evaluaciones.fecha_inicio_floracion is
  'Fecha fenologica opcional. Rango civil 2000-2100 para detectar errores de digitacion sin compararla con hoy.';
