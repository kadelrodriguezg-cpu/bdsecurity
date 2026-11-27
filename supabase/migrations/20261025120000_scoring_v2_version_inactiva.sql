-- Scoring v2, paso 46 — la versión de puntaje v2, creada INACTIVA (estado `borrador`). Decisiones S1, S2, S6, EF8 a EF11.
--
-- Esta migración NO cambia ningún ranking: la versión activa sigue siendo la v1 y el motor solo usa versiones `activa`. La v2 se activa en un
-- paso aparte, al final de la ventana de despliegue y después del push del frontend (docs/migraciones_pendientes/scoring_v2_activar.sql).
-- Las versiones viejas, sus métricas y los rankings congelados no se tocan.
--
-- Pesos por categoría (EF9): Fruto/Calidad 0,40 · Producción 0,30 · Fenología 0,15 · Brotes y varas 0,10 · Estrés 0,05 (suma 1,00).
--
-- Pesos de cada métrica: el peso de las métricas de una categoría suma el peso de la categoría (el motor usa solo la proporción dentro de la
-- categoría: promedio ponderado de las métricas con valor).
--   · Fruto/Calidad: de 4-3-2-1 (suma 10) a 0,16 · 0,12 · 0,08 · 0,04 (cada peso × 0,04).
--   · Fenología: de 0,034/0,034/0,033×4 (suma 0,20) a 0,0255/0,0255/0,02475×4 (cada peso × 0,15/0,20 = 0,75).
--   · Estrés: sin vigor ni color (pasan a Brotes) quedan 3 métricas iguales de 0,02 (suma 0,06); × 0,05/0,06 = 1/60 → 0,05/3 cada una.
--   · Brotes (S2): cobertura floral y cuaja 75 % (0,0375 cada una), vigor y color 25 % (0,0125 cada uno). Son los mismos pesos relativos de hoy
--     (0,06 · 0,06 · 0,02 · 0,02).
--   · Producción (EF10): % fruta exportable 60 % = 0,18; rendimiento por planta 40 % = 0,12. `rend_t_ha` queda fuera (EF11).
-- Rangos y direcciones se copian de la v1, salvo `rend_kg_planta` (S7, provisional): piso 0 y techo 6 kg/planta (plantas de 4 años o más).
-- La distribución de flores y frutos en la vara (paso 45) no entra al puntaje (EF12, peso 0): no tiene fila en `scoring_metrica`.
--
-- Rollback: docs/scoring_v2/rollback/46_version_v2.sql (borra la versión v2 mientras esté inactiva y sin uso).

do $v2$
declare
  v_v1 uuid;
  v_v2 uuid;
begin
  select id into v_v1
  from public.scoring_version
  where nombre = 'Selección de fruto v1 provisional (4-3-2-1)';
  if v_v1 is null then
    raise exception 'No existe la versión de scoring v1 que sirve de base' using errcode = 'P0002';
  end if;

  insert into public.scoring_version (
    nombre, especie_id, fase, vigente_desde, estado, criterio_desempate, umbral_delta_leve, umbral_delta_marcado, nota
  )
  select
    'Selección v2 (5 categorías 40-30-15-10-5) provisional',
    v1.especie_id, v1.fase, v1.vigente_desde, 'borrador', v1.criterio_desempate, v1.umbral_delta_leve, v1.umbral_delta_marcado,
    'Versión v2 (decisiones S1, S2, EF8 a EF11, 25-10-2026): cinco categorías con pesos 40-30-15-10-5; rend_t_ha fuera. Rangos provisionales, '
    'pendientes de validación científica por Efraín. Nace inactiva (borrador); la activa un paso aparte del despliegue.'
  from public.scoring_version v1
  where v1.id = v_v1
  returning id into v_v2;

  insert into public.scoring_categoria_peso (scoring_version_id, categoria, peso) values
    (v_v2, 'fruto_calidad', 0.40),
    (v_v2, 'produccion',    0.30),
    (v_v2, 'fenologia',     0.15),
    (v_v2, 'brotes',        0.10),
    (v_v2, 'estres',        0.05);

  insert into public.scoring_metrica (
    scoring_version_id, categoria, metrica, peso, direccion_favorable, metodo_normalizacion,
    minimo_normalizacion, maximo_normalizacion, rango_referencia_id, tratamiento_nulos, orden
  )
  select
    v_v2,
    n.categoria::public.categoria_scoring,
    n.metrica,
    n.peso,
    m.direccion_favorable,
    case when n.maximo is not null then 'escala'::public.metodo_normalizacion_scoring else m.metodo_normalizacion end,
    case when n.maximo is not null then n.minimo else m.minimo_normalizacion end,
    coalesce(n.maximo, m.maximo_normalizacion),
    case when n.maximo is not null then null else m.rango_referencia_id end,
    m.tratamiento_nulos,
    n.orden
  from (values
    ('fruto_calidad', 'firmeza',                  0.16::numeric,        null::numeric, null::numeric,  1),
    ('fruto_calidad', 'calibre_mm',               0.12::numeric,        null,          null,           2),
    ('fruto_calidad', 'brix',                     0.08::numeric,        null,          null,           3),
    ('fruto_calidad', 'bloom',                    0.04::numeric,        null,          null,           4),
    ('fenologia',     'brotacion',                0.0255::numeric,      null,          null,           5),
    ('fenologia',     'floracion',                0.0255::numeric,      null,          null,           6),
    ('fenologia',     'cuaja',                    0.02475::numeric,     null,          null,           7),
    ('fenologia',     'concentracion_cosecha',    0.02475::numeric,     null,          null,           8),
    ('fenologia',     'presencia_yemas_florales', 0.02475::numeric,     null,          null,           9),
    ('fenologia',     'precocidad',               0.02475::numeric,     null,          null,          10),
    ('produccion',    'rend_kg_planta',           0.12::numeric,        0::numeric,    6::numeric,    11),
    ('produccion',    'pct_fruta_exportable',     0.18::numeric,        null,          null,          12),
    ('brotes',        'pct_flores',               0.0375::numeric,      null,          null,          13),
    ('brotes',        'pct_frutos',               0.0375::numeric,      null,          null,          14),
    ('brotes',        'vigor_vegetativo',         0.0125::numeric,      null,          null,          15),
    ('brotes',        'color_follaje',            0.0125::numeric,      null,          null,          16),
    ('estres',        'dano_calor',               (0.05 / 3)::numeric,  null,          null,          17),
    ('estres',        'golpe_sol',                (0.05 / 3)::numeric,  null,          null,          18),
    ('estres',        'caida_fruto',              (0.05 / 3)::numeric,  null,          null,          19)
  ) as n(categoria, metrica, peso, minimo, maximo, orden)
  join public.scoring_metrica m on m.scoring_version_id = v_v1 and m.metrica = n.metrica;

  -- Debe haber exactamente 19 métricas (las 20 de la v1 menos rend_t_ha) y las categorías deben sumar 1,00.
  if (select count(*) from public.scoring_metrica where scoring_version_id = v_v2) <> 19 then
    raise exception 'La versión v2 debe tener 19 métricas' using errcode = '23514';
  end if;
end;
$v2$;
