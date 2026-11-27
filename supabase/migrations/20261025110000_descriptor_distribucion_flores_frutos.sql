-- Scoring v2, paso 45 — descriptor «Distribución de flores y frutos en la vara» (decisión EF12).
--
-- Efraín: hoy lo anotan en un cuaderno, así que debe existir cuanto antes. Va en Brotes y varas (junto a la cobertura floral y la cuaja en varas basales; decisión S15), con 3 niveles:
--   1 = «Solo en la punta» · 2 = «Hasta la mitad» · 3 = «Toda la vara».
-- Es opcional y NO entra al puntaje (peso 0): `scoring_metrica` exige peso > 0, así que simplemente no tiene fila de métrica.
-- Un admin puede pedirlo obligatorio u opcional en el protocolo de una ronda (`validar_descriptores_protocolo` lee el esquema).
--
-- Qué hace:
--   1. `esquema_fase_campo.etiquetas_nivel`: una etiqueta por nivel de la escala (hasta ahora solo había etiquetas de los extremos, y una
--      escala de 3 niveles necesita nombrar el del medio). Nulo para los descriptores que ya existen.
--   2. Columna `evaluaciones.distribucion_flores_frutos` (smallint, 1 a 3, nula).
--   3. El campo en el esquema de fase (sección Brotes y varas, orden 16, justo después de color_follaje; los siguientes se corren un lugar).
--   4. `unificar_evaluacion_ronda`: el descriptor nuevo toma el valor no nulo más reciente entre las visitas cerradas de la ronda, como
--      los demás descriptores (sin esto tomaría el de la última visita aunque esté vacío).
--   5. `esquema_fase_campo.activo`: `rend_t_ha` se desactiva (EF11, S6): sale del formulario y de los protocolos nuevos, pero la columna y los
--      valores históricos se conservan y se siguen mostrando. `validar_descriptores_protocolo` y `estados_descriptores` respetan la marca.
--
-- Aditivo. La app que hoy está en producción no lee la columna nueva (usa listas de columnas propias) y no se rompe: ver
-- docs/scoring_v2/plan.md. Rollback: docs/scoring_v2/rollback/45_descriptor_distribucion.sql (se niega si ya hay valores cargados).

alter table public.esquema_fase_campo
  add column etiquetas_nivel text[];

alter table public.esquema_fase_campo
  add constraint esquema_fase_campo_etiquetas_nivel_check
  check (
    etiquetas_nivel is null
    or (
      tipo = 'escala'
      and cardinality(etiquetas_nivel) = escala_maximo - escala_minimo + 1
      and array_position(etiquetas_nivel, null) is null
    )
  );

comment on column public.esquema_fase_campo.etiquetas_nivel is
  'Etiqueta de cada nivel de una escala, de menor a mayor (opcional). Si es nula, solo se conocen las etiquetas de los extremos.';

alter table public.evaluaciones
  add column distribucion_flores_frutos smallint,
  add constraint evaluaciones_distribucion_flores_frutos_check
    check (distribucion_flores_frutos is null or distribucion_flores_frutos between 1 and 3);

comment on column public.evaluaciones.distribucion_flores_frutos is
  'Distribución de flores y frutos en la vara: 1 solo en la punta, 2 hasta la mitad, 3 toda la vara. Opcional; no entra al puntaje (EF12).';

-- orden es único por fase: se corren los campos siguientes en dos pasos para no chocar con la restricción.
update public.esquema_fase_campo set orden = orden + 1000 where fase = 'evaluacion_anual' and orden >= 16;
update public.esquema_fase_campo set orden = orden - 999 where fase = 'evaluacion_anual' and orden >= 1016;

insert into public.esquema_fase_campo
  (fase, clave, seccion, etiqueta, orden, rol, tipo, unidad, escala_minimo, escala_maximo, etiqueta_minimo, etiqueta_maximo, etiquetas_nivel, exige_muestra)
values
  ('evaluacion_anual', 'distribucion_flores_frutos', 'brotes', 'Distribución de flores y frutos en la vara', 16, 'descriptor', 'escala', null,
   1, 3, 'Solo en la punta', 'Toda la vara', array['Solo en la punta', 'Hasta la mitad', 'Toda la vara'], false);

-- unificar_evaluacion_ronda: igual que la vigente, más el descriptor nuevo en la lista de los que toman el valor no nulo más reciente.
create or replace function public.unificar_evaluacion_ronda(p_ronda_id uuid)
 RETURNS SETOF evaluaciones
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with cerradas as materialized (
    select e.*
    from evaluaciones e
    where e.ronda_id = p_ronda_id
      and e.estado in ('completa', 'corregida')
  ), representante as (
    select e as evaluacion
    from cerradas e
    order by e.fecha desc, e.capturada_at desc, e.id desc
    limit 1
  ), descriptores as (
    select
      (array_agg(e.brotacion order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.brotacion is not null))[1] as brotacion,
      (array_agg(e.floracion order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.floracion is not null))[1] as floracion,
      (array_agg(e.cuaja order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.cuaja is not null))[1] as cuaja,
      (array_agg(e.concentracion_cosecha order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.concentracion_cosecha is not null))[1] as concentracion_cosecha,
      (array_agg(e.calibre_mm order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.calibre_mm is not null))[1] as calibre_mm,
      (array_agg(e.firmeza order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.firmeza is not null))[1] as firmeza,
      (array_agg(e.color order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.color is not null))[1] as color,
      (array_agg(e.bloom order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.bloom is not null))[1] as bloom,
      (array_agg(e.brix order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.brix is not null))[1] as brix,
      (array_agg(e.rend_kg_planta order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.rend_kg_planta is not null))[1] as rend_kg_planta,
      (array_agg(e.rend_t_ha order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.rend_t_ha is not null))[1] as rend_t_ha,
      (array_agg(e.pct_fruta_exportable order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_fruta_exportable is not null))[1] as pct_fruta_exportable,
      (array_agg(e.dano_calor order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.dano_calor is not null))[1] as dano_calor,
      (array_agg(e.golpe_sol order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.golpe_sol is not null))[1] as golpe_sol,
      (array_agg(e.caida_fruto order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.caida_fruto is not null))[1] as caida_fruto,
      (array_agg(e.n_varas_basales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_varas_basales is not null))[1] as n_varas_basales,
      (array_agg(e.n_varas_con_flor order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_varas_con_flor is not null))[1] as n_varas_con_flor,
      (array_agg(e.n_flores_varas_basales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_flores_varas_basales is not null))[1] as n_flores_varas_basales,
      (array_agg(e.n_frutos_varas_basales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_frutos_varas_basales is not null))[1] as n_frutos_varas_basales,
      (array_agg(e.altura_brote_mm order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.altura_brote_mm is not null))[1] as altura_brote_mm,
      (array_agg(e.diametro_brote_mm order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.diametro_brote_mm is not null))[1] as diametro_brote_mm,
      (array_agg(e.vigor_vegetativo order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.vigor_vegetativo is not null))[1] as vigor_vegetativo,
      (array_agg(e.color_follaje order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.color_follaje is not null))[1] as color_follaje,
      (array_agg(e.presencia_yemas_florales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.presencia_yemas_florales is not null))[1] as presencia_yemas_florales,
      (array_agg(e.fecha_inicio_floracion order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.fecha_inicio_floracion is not null))[1] as fecha_inicio_floracion,
      (array_agg(e.precocidad order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.precocidad is not null))[1] as precocidad,
      (array_agg(e.distribucion_flores_frutos order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.distribucion_flores_frutos is not null))[1] as distribucion_flores_frutos,
      (array_agg(e.pct_flores order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_flores is not null))[1] as pct_flores,
      (array_agg(e.pct_frutos order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_frutos is not null))[1] as pct_frutos
    from cerradas e
  ), muestra as (
    select e.cantidad_frutos, e.peso_total_g, e.peso_promedio_g
    from cerradas e
    where e.cantidad_frutos is not null
      and e.peso_total_g is not null
    order by e.fecha desc, e.capturada_at desc, e.id desc
    limit 1
  )
  select jsonb_populate_record(
    null::evaluaciones,
    to_jsonb(rep.evaluacion) || to_jsonb(d) || jsonb_build_object(
      'cantidad_frutos', m.cantidad_frutos,
      'peso_total_g', m.peso_total_g,
      'peso_promedio_g', m.peso_promedio_g
    )
  )
  from representante rep
  cross join descriptores d
  left join muestra m on true;
$function$
;

comment on function public.unificar_evaluacion_ronda(uuid) is
  'Fotografia unificada de una ronda: cada descriptor usa el valor no NULL mas reciente por fecha/capturada_at/id DESC (A1-105: una correccion no reordena las visitas). Los porcentajes generados conservan numerador y denominador de una misma visita. La tripleta cantidad/peso/promedio tambien es atomica.';

-- 5. Campo activo/desactivado en el esquema (S6 y EF11): `rend_t_ha` sale del formulario y del puntaje, pero la columna y sus valores
--    se conservan. Un campo desactivado no se ofrece en formularios ni en protocolos nuevos; las evaluaciones que ya tienen valor lo siguen
--    mostrando (estados_descriptores lo informa como medido).
alter table public.esquema_fase_campo
  add column activo boolean not null default true;

comment on column public.esquema_fase_campo.activo is
  'false = campo desactivado: no se ofrece en formularios ni protocolos nuevos; los valores históricos se conservan y se siguen mostrando (EF11).';

update public.esquema_fase_campo set activo = false where fase = 'evaluacion_anual' and clave = 'rend_t_ha';

-- validar_descriptores_protocolo: un protocolo no puede incluir un campo desactivado.
create or replace function public.validar_descriptores_protocolo(p_descriptores jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- null si es válido; si no, el motivo.
  select case
    when p_descriptores is null or jsonb_typeof(p_descriptores) <> 'object' then 'El protocolo debe ser un objeto clave -> obligatorio | opcional'
    when not exists (select 1 from jsonb_each_text(p_descriptores)) then 'El protocolo no incluye ningún descriptor'
    when exists (
      select 1 from jsonb_each(p_descriptores) d
      where jsonb_typeof(d.value) <> 'string' or d.value #>> '{}' not in ('obligatorio', 'opcional')
    ) then 'Cada descriptor del protocolo debe ser obligatorio u opcional'
    when exists (
      select 1 from jsonb_object_keys(p_descriptores) k
      where not exists (
        select 1 from esquema_fase_campo c
        where c.fase = 'evaluacion_anual' and c.clave = k and c.rol in ('descriptor', 'muestra') and c.activo
      )
    ) then 'El protocolo incluye claves que no son descriptores del esquema: ' || (
      select string_agg(k, ', ' order by k) from jsonb_object_keys(p_descriptores) k
      where not exists (
        select 1 from esquema_fase_campo c
        where c.fase = 'evaluacion_anual' and c.clave = k and c.rol in ('descriptor', 'muestra') and c.activo
      ))
    else null
  end;
$function$
;

-- estados_descriptores: un campo desactivado solo aparece si la evaluación ya tiene valor (se informa como medido o marcado).
create or replace function public.estados_descriptores(p_evaluacion evaluaciones)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with proto as (
    select pr.descriptores from protocolo_ronda pr where pr.id = p_evaluacion.protocolo_id
  ), marcados as (
    select descriptores_fuera_de_revision(p_evaluacion) as claves
  )
  select coalesce(jsonb_object_agg(c.clave,
    case
      when (to_jsonb(p_evaluacion) -> c.clave) is not null and (to_jsonb(p_evaluacion) -> c.clave) <> 'null'::jsonb then
        case when c.clave = any(m.claves) then 'marcado' else 'medido' end
      when exists (select 1 from proto where proto.descriptores ->> c.clave = 'obligatorio') then 'falto'
      else 'no_evaluado'
    end
    order by c.orden), '{}'::jsonb)
  from esquema_fase_campo c
  cross join marcados m
  where c.fase = 'evaluacion_anual' and c.rol in ('descriptor', 'muestra')
    and (c.activo or ((to_jsonb(p_evaluacion) -> c.clave) is not null and (to_jsonb(p_evaluacion) -> c.clave) <> 'null'::jsonb));
$function$
;
