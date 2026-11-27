-- =============================================================================
-- MIGRACIÓN 20260811000000 — EVECL: esquema (Sprint E1, commit 1/3)
--
-- Módulo EVECL (Evaluación Varietal Externa en Condiciones Locales), sección 9
-- del Documento Maestro (docs/BDSecurity_Documento_Maestro.md). Evalúa
-- variedades foráneas plantadas en predios de terceros, en contraste con el
-- pipeline genético propio de BDS (secciones 1-8).
--
-- INVARIANTE DEL MÓDULO (9.1): cero FK desde evecl_* hacia el núcleo genético
-- (plantas, individuos, predio, ronda_evaluacion_anual, scoring_*). La única
-- dependencia compartida es auth.users, referenciada directo (no vía
-- perfiles) porque EVECL es un universo de datos deliberadamente separado del
-- resto del proyecto — ver 9.2.3 del Documento Maestro.
--
-- DDL tomado literal de la sección 9.2. No se crea RLS ni grants acá (van en
-- el commit 2) para poder revertir el esquema y la seguridad por separado.
-- =============================================================================

create type evecl_eje as enum ('fenologia', 'adaptabilidad', 'calidad', 'productividad');
create type evecl_tipo_descriptor as enum ('estado', 'valor');
create type evecl_tipo_ficha as enum ('evaluacion', 'testigo');


-- =============================================================================
-- TABLA: evecl_descriptor — catálogo de descriptores UPOV (9.2.1)
-- =============================================================================
create table evecl_descriptor (
  id                 bigint generated always as identity primary key,
  codigo_upov        int,                       -- null en los que no tienen ID UPOV
  nombre             text not null,
  tipo               evecl_tipo_descriptor not null,
  eje                evecl_eje not null,
  unidad             text,                      -- solo tipo='valor'
  nota_especial      text,                      -- "Solo variedades con hoja verde", etc.
  rankeable          boolean not null default false,
  direccion_ranking  text,                      -- 'mayor' | 'menor' | 'distancia_18' | null
  orden              int not null,
  activo             boolean not null default true,
  constraint evecl_descriptor_direccion_chk
    check (direccion_ranking is null or direccion_ranking in ('mayor', 'menor', 'distancia_18')),
  constraint evecl_descriptor_rankeable_chk
    check (not rankeable or direccion_ranking is not null)
);
create unique index on evecl_descriptor (codigo_upov) where codigo_upov is not null;

comment on table evecl_descriptor is 'Catálogo de los 27 descriptores UPOV que captura EVECL. Vive en base, no hardcodeado en frontend (invariante 8 del Documento Maestro).';
comment on column evecl_descriptor.rankeable is 'True solo en los 8 descriptores de 9.4.3 (Calidad/Productividad con dirección definida). Fenología y Adaptabilidad nunca son rankeable.';


-- =============================================================================
-- TABLA: evecl_descriptor_estado — estados nominales con nota UPOV (9.2.2)
--
-- Las notas UPOV NO son una escala 1-5 uniforme: cada descriptor trae su
-- propio conjunto (3/5/7, o 1/2/3, o 1/3/5/7/9, o 1/2). Se siembran tal cual
-- en el commit 3, sin normalizar ni completar huecos.
-- =============================================================================
create table evecl_descriptor_estado (
  id             bigint generated always as identity primary key,
  descriptor_id  bigint not null references evecl_descriptor(id) on delete cascade,
  nota           int not null,
  label          text not null,
  orden          int not null,
  unique (descriptor_id, nota)
);


-- =============================================================================
-- TABLA: evecl_ensayo — predio/parcela del productor foráneo (9.2.3)
-- =============================================================================
create table evecl_ensayo (
  id                bigint generated always as identity primary key,
  codigo_parcela    text not null,        -- clave de agrupación explícita
  nombre_productor  text,
  empresa           text,
  encargado_predio  text,
  localidad         text,
  direccion         text,
  latitud           numeric(9, 6),
  longitud          numeric(9, 6),
  area_evaluada     text,                 -- texto libre: "0.5 ha", "200 m²"
  notas             text,
  activo            boolean not null default true,
  created_by        uuid not null default auth.uid() references auth.users(id),
  created_at        timestamptz not null default now(),
  eliminado_at      timestamptz,
  constraint evecl_ensayo_lat_chk check (latitud is null or latitud between -90 and 90),
  constraint evecl_ensayo_lon_chk check (longitud is null or longitud between -180 and 180)
);
create unique index on evecl_ensayo (lower(trim(codigo_parcela))) where eliminado_at is null;

comment on column evecl_ensayo.codigo_parcela is 'Unicidad normalizada (lower/trim) para evitar que "P-01"/"P1"/"Parcela 1" partan el agrupamiento sin avisar — corrección respecto al instrumento original (PWA IndexedDB), que usaba texto libre sin esta protección.';


-- =============================================================================
-- TABLA: evecl_ficha — una por planta evaluada (9.2.4)
-- =============================================================================
create table evecl_ficha (
  id                bigint generated always as identity primary key,
  ensayo_id         bigint not null references evecl_ensayo(id),
  variedad          text not null,
  codigo_genotipo   text,
  origen_cruza      text,
  tipo              evecl_tipo_ficha not null default 'evaluacion',
  numero_repeticion int not null,
  codigo_planta     text,
  encargado         text,
  fecha_siembra     date,
  fecha_evaluacion  date not null default current_date,
  notas             text,
  created_by        uuid not null default auth.uid() references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  eliminado_at      timestamptz,
  constraint evecl_ficha_rep_chk check (numero_repeticion between 1 and 20),
  constraint evecl_ficha_fecha_chk check (fecha_evaluacion <= current_date)
);
create unique index on evecl_ficha (ensayo_id, lower(trim(variedad)), numero_repeticion)
  where eliminado_at is null;

comment on column evecl_ficha.numero_repeticion is 'Acepta 1-20, no 1-5: el diseño experimental actual es 5 plantas por variedad, pero cablear ese límite en un CHECK repite el error de ronda_evaluacion_anual (nombre/CHECK anual hoy imposibles de cambiar sin tocar 12+ funciones). El frontend ofrece 1-5 por defecto; la base no lo impone.';
comment on column evecl_ficha.variedad is 'Texto libre, no catálogo: son variedades comerciales de terceros, sin lista cerrada conocida. La unicidad normalizada (ensayo_id, lower(trim(variedad)), numero_repeticion) evita duplicados por tipeo.';


-- =============================================================================
-- TABLA: evecl_respuesta — valores capturados (9.2.5)
-- =============================================================================
create table evecl_respuesta (
  id             bigint generated always as identity primary key,
  ficha_id       bigint not null references evecl_ficha(id) on delete cascade,
  descriptor_id  bigint not null references evecl_descriptor(id),
  nota           int,                -- descriptores tipo 'estado'
  valor_numerico numeric,            -- descriptores tipo 'valor'
  valor_texto    text,               -- solo "% frutos por calibre"
  foto_path      text,               -- ruta en Supabase Storage, no la imagen
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ficha_id, descriptor_id),
  constraint evecl_respuesta_algo_chk check (
    nota is not null or valor_numerico is not null
    or valor_texto is not null or foto_path is not null
  ),
  constraint evecl_respuesta_valor_chk check (valor_numerico is null or valor_numerico >= 0)
);

comment on table evecl_respuesta is 'Sin CHECK de rango superior sobre valor_numerico — misma decisión que la sección 2.5 del Documento Maestro: un valor excepcional se destaca, no se bloquea.';


-- =============================================================================
-- TRIGGER: coherencia tipo ↔ respuesta (9.2.6)
--
-- Sin esto, un bug de frontend puede escribir una nota inválida (ej. nota 4
-- en un descriptor que solo define 3/5/7) y el scoring la arrastra
-- silenciosamente.
-- =============================================================================
create or replace function evecl_validar_respuesta()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tipo evecl_tipo_descriptor;
begin
  select tipo into v_tipo from evecl_descriptor where id = new.descriptor_id;

  if v_tipo = 'estado' then
    if new.nota is null then
      raise exception 'evecl_respuesta: descriptor % es de tipo estado y requiere nota', new.descriptor_id;
    end if;
    if not exists (
      select 1 from evecl_descriptor_estado
      where descriptor_id = new.descriptor_id and nota = new.nota
    ) then
      raise exception 'evecl_respuesta: nota % no es un estado válido para el descriptor %', new.nota, new.descriptor_id;
    end if;
  elsif v_tipo = 'valor' then
    if new.nota is not null then
      raise exception 'evecl_respuesta: descriptor % es de tipo valor y no admite nota', new.descriptor_id;
    end if;
  end if;

  return new;
end;
$$;

comment on function evecl_validar_respuesta is 'Valida coherencia tipo↔respuesta antes de insert/update en evecl_respuesta (9.2.6). Evita que una nota UPOV inválida para el descriptor quede persistida y contamine el scoring en silencio.';

create trigger evecl_respuesta_validar
  before insert or update on evecl_respuesta
  for each row execute function evecl_validar_respuesta();
