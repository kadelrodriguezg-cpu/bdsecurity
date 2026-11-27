-- Fase 2, Sprint 1 — esquema de fase: única fuente de descriptores.
--
-- Una fase (hoy evaluacion_anual; luego polinizacion y cosecha) declara sus
-- secciones y campos: etiqueta, rol, tipo, unidad, escala y si exigen muestra
-- de frutos. El frontend lo lee de acá (con su copia TS como respaldo sin
-- conexión, verificada por prueba) y la regla de frutos del trigger de
-- integridad deja de repetir la lista de columnas.
--
-- Solo lectura por API: se mantiene por migraciones. RLS desde el día uno.

create table public.esquema_fase_seccion (
  fase text not null check (btrim(fase) <> ''),
  id text not null check (id ~ '^[a-z][a-z0-9_]*$'),
  etiqueta text not null check (btrim(etiqueta) <> ''),
  orden smallint not null,
  primary key (fase, id),
  unique (fase, orden)
);

create table public.esquema_fase_campo (
  fase text not null,
  clave text not null check (clave ~ '^[a-z][a-z0-9_]*$'),
  seccion text not null,
  etiqueta text not null check (btrim(etiqueta) <> ''),
  orden smallint not null,
  rol text not null check (rol in ('descriptor', 'muestra', 'derivado')),
  tipo text not null check (tipo in ('escala', 'numero', 'entero', 'fecha')),
  unidad text,
  escala_minimo smallint,
  escala_maximo smallint,
  etiqueta_minimo text,
  etiqueta_maximo text,
  exige_muestra boolean not null default false,
  primary key (fase, clave),
  unique (fase, orden),
  foreign key (fase, seccion) references public.esquema_fase_seccion (fase, id),
  check (
    (tipo = 'escala' and escala_minimo is not null and escala_maximo > escala_minimo
      and etiqueta_minimo is not null and etiqueta_maximo is not null)
    or (tipo <> 'escala' and escala_minimo is null and escala_maximo is null
      and etiqueta_minimo is null and etiqueta_maximo is null)
  )
);

alter table public.esquema_fase_seccion enable row level security;
alter table public.esquema_fase_campo enable row level security;

create policy esquema_fase_seccion_select_autenticados on public.esquema_fase_seccion
  for select to authenticated using (auth.uid() is not null);
create policy esquema_fase_campo_select_autenticados on public.esquema_fase_campo
  for select to authenticated using (auth.uid() is not null);

revoke all on public.esquema_fase_seccion, public.esquema_fase_campo from anon, authenticated;
grant select on public.esquema_fase_seccion, public.esquema_fase_campo to authenticated;

comment on table public.esquema_fase_campo is
  'Esquema de fase (Fase 2): única definición de los campos de cada fase. Para evaluacion_anual, clave = columna de evaluaciones.';

insert into public.esquema_fase_seccion (fase, id, etiqueta, orden) values
  ('evaluacion_anual', 'fenologia', 'Fenología', 1),
  ('evaluacion_anual', 'brotes', 'Brotes y varas basales', 2),
  ('evaluacion_anual', 'fruto', 'Fruto / Calidad', 3),
  ('evaluacion_anual', 'muestra', 'Muestra de frutos', 4),
  ('evaluacion_anual', 'produccion', 'Producción', 5),
  ('evaluacion_anual', 'estres', 'Estrés climático', 6);

insert into public.esquema_fase_campo
  (fase, clave, seccion, etiqueta, orden, rol, tipo, unidad, escala_minimo, escala_maximo, etiqueta_minimo, etiqueta_maximo, exige_muestra)
values
  ('evaluacion_anual', 'brotacion', 'fenologia', 'Brotación', 1, 'descriptor', 'escala', null, 1, 5, 'nula', 'muy vigorosa', false),
  ('evaluacion_anual', 'presencia_yemas_florales', 'fenologia', 'Presencia de yemas florales', 2, 'descriptor', 'escala', null, 0, 5, 'ausentes', 'muy abundantes', false),
  ('evaluacion_anual', 'floracion', 'fenologia', 'Floración', 3, 'descriptor', 'escala', null, 1, 5, 'nula', 'abundante', false),
  ('evaluacion_anual', 'fecha_inicio_floracion', 'fenologia', 'Inicio de floración', 4, 'descriptor', 'fecha', null, null, null, null, null, false),
  ('evaluacion_anual', 'precocidad', 'fenologia', 'Precocidad', 5, 'descriptor', 'escala', null, 1, 5, 'muy tardía', 'muy precoz', false),
  ('evaluacion_anual', 'cuaja', 'fenologia', 'Cuaja', 6, 'descriptor', 'escala', null, 1, 5, 'mala', 'excelente', false),
  ('evaluacion_anual', 'concentracion_cosecha', 'fenologia', 'Concentración cosecha', 7, 'descriptor', 'escala', null, 1, 5, 'muy dispersa', 'muy concentrada', false),
  ('evaluacion_anual', 'n_varas_basales', 'brotes', 'Varas basales', 8, 'descriptor', 'entero', null, null, null, null, null, false),
  ('evaluacion_anual', 'n_varas_con_flor', 'brotes', 'Varas basales con flor', 9, 'descriptor', 'entero', null, null, null, null, null, false),
  ('evaluacion_anual', 'n_flores_varas_basales', 'brotes', 'Flores en varas basales', 10, 'descriptor', 'entero', null, null, null, null, null, false),
  ('evaluacion_anual', 'n_frutos_varas_basales', 'brotes', 'Frutos en varas basales', 11, 'descriptor', 'entero', null, null, null, null, null, false),
  ('evaluacion_anual', 'altura_brote_mm', 'brotes', 'Altura del brote', 12, 'descriptor', 'numero', 'mm', null, null, null, null, false),
  ('evaluacion_anual', 'diametro_brote_mm', 'brotes', 'Diámetro del brote', 13, 'descriptor', 'numero', 'mm', null, null, null, null, false),
  ('evaluacion_anual', 'vigor_vegetativo', 'brotes', 'Vigor vegetativo', 14, 'descriptor', 'escala', null, 1, 5, 'muy bajo', 'muy alto', false),
  ('evaluacion_anual', 'color_follaje', 'brotes', 'Color del follaje', 15, 'descriptor', 'escala', null, 1, 5, 'muy pálido', 'muy intenso', false),
  ('evaluacion_anual', 'calibre_mm', 'fruto', 'Calibre', 16, 'descriptor', 'numero', 'mm', null, null, null, null, true),
  ('evaluacion_anual', 'firmeza', 'fruto', 'Firmeza', 17, 'descriptor', 'escala', null, 1, 5, 'muy blando', 'muy firme', true),
  ('evaluacion_anual', 'color', 'fruto', 'Color', 18, 'descriptor', 'escala', null, 1, 5, 'pálido', 'azul intenso', true),
  ('evaluacion_anual', 'bloom', 'fruto', 'Bloom', 19, 'descriptor', 'escala', null, 1, 5, 'ausente', 'máximo', true),
  ('evaluacion_anual', 'brix', 'fruto', 'Brix', 20, 'descriptor', 'numero', '°Bx', null, null, null, null, true),
  ('evaluacion_anual', 'cantidad_frutos', 'muestra', 'Cantidad de frutos', 21, 'muestra', 'entero', null, null, null, null, null, true),
  ('evaluacion_anual', 'peso_total_g', 'muestra', 'Peso total', 22, 'muestra', 'numero', 'g', null, null, null, null, true),
  ('evaluacion_anual', 'peso_promedio_g', 'muestra', 'Peso promedio', 23, 'derivado', 'numero', 'g', null, null, null, null, false),
  ('evaluacion_anual', 'pct_flores', 'produccion', 'Cobertura floral', 24, 'derivado', 'numero', '%', null, null, null, null, false),
  ('evaluacion_anual', 'pct_frutos', 'produccion', 'Cuaja en varas basales', 25, 'derivado', 'numero', '%', null, null, null, null, false),
  ('evaluacion_anual', 'rend_kg_planta', 'produccion', 'Rendimiento por planta', 26, 'descriptor', 'numero', 'kg/planta', null, null, null, null, false),
  ('evaluacion_anual', 'rend_t_ha', 'produccion', 'Rendimiento por hectárea', 27, 'descriptor', 'numero', 't/ha', null, null, null, null, false),
  ('evaluacion_anual', 'pct_fruta_exportable', 'produccion', 'Fruta exportable', 28, 'descriptor', 'numero', '%', null, null, null, null, false),
  ('evaluacion_anual', 'dano_calor', 'estres', 'Daño por calor', 29, 'descriptor', 'escala', null, 1, 5, 'ninguno', 'severo', false),
  ('evaluacion_anual', 'golpe_sol', 'estres', 'Golpe de sol', 30, 'descriptor', 'escala', null, 1, 5, 'ninguno', 'severo', false),
  ('evaluacion_anual', 'caida_fruto', 'estres', 'Caída de fruto', 31, 'descriptor', 'escala', null, 1, 5, 'ninguna', 'severa', false);

-- Cada clave de evaluacion_anual debe ser una columna real de evaluaciones.
do $verificar$
declare
  v_faltantes text;
begin
  select string_agg(c.clave, ', ' order by c.orden) into v_faltantes
  from public.esquema_fase_campo c
  where c.fase = 'evaluacion_anual'
    and not exists (
      select 1 from information_schema.columns ic
      where ic.table_schema = 'public' and ic.table_name = 'evaluaciones' and ic.column_name = c.clave
    );
  if v_faltantes is not null then
    raise exception 'esquema_fase_campo: claves sin columna en evaluaciones: %', v_faltantes;
  end if;
end;
$verificar$;

-- Regla de frutos desde el esquema (mismo comportamiento que 20261022204000).
create or replace function public.evaluacion_exige_muestra(p_evaluacion public.evaluaciones)
returns boolean
language sql
stable
set search_path = public
as $$
  select not coalesce(p_evaluacion.sin_muestra, false)
    and exists (
      select 1
      from public.esquema_fase_campo c
      where c.fase = 'evaluacion_anual'
        and c.exige_muestra
        and to_jsonb(p_evaluacion) -> c.clave is not null
        and to_jsonb(p_evaluacion) -> c.clave <> 'null'::jsonb
    );
$$;

-- Uso interno del trigger de integridad (SECURITY DEFINER); no se expone por RPC.
revoke all on function public.evaluacion_exige_muestra(public.evaluaciones) from public, anon, authenticated;

comment on function public.evaluacion_exige_muestra(public.evaluaciones) is
  'Regla de frutos (Fase 2): true si la evaluación trae algún campo con exige_muestra en esquema_fase_campo y no marcó sin_muestra.';

create or replace function public.validar_evaluacion_integridad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_especie_id uuid;
  v_revision boolean := false;
  v_rango rango_referencia;
begin
  -- Fuente temporal unica: fecha efectiva.
  new.anio := extract(year from new.fecha)::integer;
  new.updated_at := now();

  if tg_op = 'INSERT' and new.estado in ('corregida', 'anulada') and not es_admin() then
    raise exception 'Solo un admin puede crear una correccion o anulacion' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if old.estado in ('completa', 'corregida', 'anulada') and not es_admin() then
      raise exception 'Solo un admin puede modificar una evaluacion cerrada' using errcode = '42501';
    end if;
    if new.estado in ('corregida', 'anulada')
       and new.estado is distinct from old.estado
       and not es_admin()
       and not (new.estado = 'anulada' and old.estado = 'borrador' and old.created_by = auth.uid()) then
      raise exception 'Solo un admin puede corregir o anular una evaluacion' using errcode = '42501';
    end if;
    if old.estado in ('completa', 'corregida')
       and new.estado = 'borrador'
       and not es_admin() then
      raise exception 'Solo un admin puede reabrir una evaluacion' using errcode = '42501';
    end if;
  end if;

  if new.estado in ('corregida', 'anulada')
     and coalesce(btrim(new.motivo_cambio), '') = '' then
    raise exception 'Una correccion o anulacion requiere motivo' using errcode = '23514';
  end if;

  -- Regla de frutos: solo con datos de fruta o de muestra (lista en esquema_fase_campo).
  if new.estado in ('completa', 'corregida') and evaluacion_exige_muestra(new) then
    if coalesce(new.cantidad_frutos, 0) <= 0 then
      raise exception 'Hay datos de fruta o de muestra: cantidad de frutos debe ser mayor que cero para finalizar. Si no se tomo muestra, marca Sin muestra de frutos'
        using errcode = '23514';
    end if;
    if coalesce(new.peso_total_g, 0) <= 0 then
      raise exception 'Hay datos de fruta o de muestra: peso total debe ser mayor que cero para finalizar. Si no se tomo muestra, marca Sin muestra de frutos'
        using errcode = '23514';
    end if;
  end if;

  select p.especie_id into v_especie_id
  from ronda_evaluacion_anual r
  join individuos i on i.id = r.individuo_id
  join plantas p on p.id = i.planta_id
  where r.id = new.ronda_id;

  for v_rango in
    select distinct on (rr.metrica) rr.*
    from rango_referencia rr
    where rr.activo
      and rr.metrica in ('brix', 'calibre_mm')
      and (rr.especie_id = v_especie_id or rr.especie_id is null)
      and (rr.fase = 'evaluacion_anual' or rr.fase is null)
      and rr.vigente_desde <= new.fecha
      and (rr.vigente_hasta is null or rr.vigente_hasta >= new.fecha)
    order by
      rr.metrica,
      (rr.especie_id is not null) desc,
      (rr.fase is not null) desc,
      rr.vigente_desde desc,
      rr.created_at desc
  loop
    if v_rango.metrica = 'brix' and new.brix is not null then
      v_revision := v_revision
        or (v_rango.limite_revision_inferior is not null and new.brix <= v_rango.limite_revision_inferior)
        or (v_rango.limite_revision_superior is not null and new.brix >= v_rango.limite_revision_superior);
    elsif v_rango.metrica = 'calibre_mm' and new.calibre_mm is not null then
      v_revision := v_revision
        or (v_rango.limite_revision_inferior is not null and new.calibre_mm <= v_rango.limite_revision_inferior)
        or (v_rango.limite_revision_superior is not null and new.calibre_mm >= v_rango.limite_revision_superior);
    end if;
  end loop;

  new.requiere_revision := v_revision;
  return new;
end;
$$;
