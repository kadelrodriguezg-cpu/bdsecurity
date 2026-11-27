-- =============================================================================
-- MIGRACIÓN 001 — SCHEMA INICIAL
-- Sistema de trazabilidad genética de frutales.
--
-- Esta migración crea SOLO las tablas, tipos (enums) y relaciones.
-- El RLS, las vistas, el audit log y las políticas de Storage viven en
-- migraciones posteriores (002, 003, 004, 005) para que cada pieza sea
-- fácil de encontrar y revisar por separado.
--
-- Convención de nombres: tablas y columnas en español, snake_case, singular
-- para columnas y plural para tablas (especies, plantas, registros_evento).
-- Los identificadores primarios son UUID salvo el audit_log (bigint autoincremental).
-- =============================================================================

-- Extensiones necesarias -------------------------------------------------------
-- pgcrypto nos da gen_random_uuid() para generar UUIDs como valor por defecto.
create extension if not exists pgcrypto;


-- =============================================================================
-- TIPOS ENUMERADOS (ENUM)
-- Un ENUM es una lista cerrada de valores válidos. Usarlos en vez de texto
-- libre evita que alguien escriba "Polinizacion", "polinización" y "POLIN" y
-- terminen siendo tres estados distintos. Si el negocio agrega un estado nuevo,
-- se hace con ALTER TYPE ... ADD VALUE en una migración futura.
-- =============================================================================

-- Rol del usuario dentro del sistema.
create type rol_usuario as enum ('admin', 'operario');

-- Estado del ciclo de vida de una planta. El ORDEN de declaración refleja el
-- orden secuencial de las etapas del proceso de mejoramiento.
create type estado_planta as enum (
  'sin_empezar',
  'polinizacion',
  'cosecha',
  'siembra_semilla',
  'germinacion',
  'trasplante',
  'traslado_destino',
  'proceso_finalizado'
);

-- Tipo de evento/registro que se acumula en el historial de cada planta.
-- Es parecido a estado_planta pero conceptualmente distinto: el estado es
-- "dónde está la planta ahora", el tipo_evento es "qué se le hizo en este
-- registro puntual". 'otro' es un comodín para eventos no previstos.
create type tipo_evento as enum (
  'polinizacion',
  'cosecha',
  'siembra_semilla',
  'germinacion',
  'trasplante',
  'traslado',
  'otro'
);

-- Tipo de archivo adjunto a un registro de evento.
create type tipo_archivo as enum ('foto', 'video');


-- =============================================================================
-- TABLA: perfiles
-- Extiende a auth.users (la tabla que gestiona Supabase Auth). NUNCA guardamos
-- contraseñas ni tokens acá: eso lo maneja Supabase. Esta tabla solo agrega
-- los datos de NEGOCIO del usuario: su nombre visible, su rol y si tiene el
-- permiso explícito de ver el linaje genético completo.
--
-- La relación 1:1 con auth.users se logra usando el mismo UUID como PK y FK.
-- El ON DELETE CASCADE hace que si se borra el usuario de Auth, se borre su perfil.
-- =============================================================================
create table perfiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  nombre             text not null,
  rol                rol_usuario not null default 'operario',
  -- Permiso adicional GRANULAR: un operario de confianza puede tener acceso al
  -- linaje sin ser admin. Por default está en false (principio de menor privilegio).
  puede_ver_linaje   boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table perfiles is 'Datos de negocio del usuario. Extiende auth.users 1:1. El rol y puede_ver_linaje gobiernan el acceso al linaje genético.';
comment on column perfiles.puede_ver_linaje is 'Permiso explícito para ver cruzamiento/mama/papa sin ser admin. Default false por menor privilegio.';


-- =============================================================================
-- TABLA: especies
-- Catálogo de especies de frutales. Se agregan con el tiempo (arándano, mora,
-- frambuesa, ...). Es una tabla chica de referencia.
-- =============================================================================
create table especies (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null unique,          -- "Arándano", "Mora", ...
  nombre_cientifico  text,                          -- opcional: "Vaccinium corymbosum"
  created_at         timestamptz not null default now()
);

comment on table especies is 'Catálogo escalable de especies de frutales. Referenciado por plantas.';


-- =============================================================================
-- TABLA: plantas
-- Entidad central. Cada planta física tiene un QR que apunta a su ficha.
-- Contiene los CAMPOS SENSIBLES de linaje genético (cruzamiento, mama, papa),
-- que son el activo de alto valor que la seguridad del sistema debe proteger.
-- =============================================================================
create table plantas (
  id                 uuid primary key default gen_random_uuid(),
  -- Código legible impreso en el QR físico, ej "02-001". Único en todo el sistema.
  codigo_sistema     text not null unique,
  especie_id         uuid not null references especies (id) on delete restrict,

  -- >>> CAMPOS DE LINAJE GENÉTICO — INFORMACIÓN SENSIBLE <<<
  -- Estos tres campos son el objetivo del espionaje industrial. El acceso a
  -- ellos se restringe por RLS + vista (ver migraciones 002 y 003).
  cruzamiento        text,
  mama               text,
  papa               text,
  -- <<< FIN CAMPOS DE LINAJE >>>

  estado             estado_planta not null default 'sin_empezar',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table plantas is 'Entidad central. Cada fila = una planta física con QR. Contiene linaje genético SENSIBLE.';
comment on column plantas.codigo_sistema is 'Código único legible impreso en el QR físico, ej "02-001".';
comment on column plantas.cruzamiento is 'SENSIBLE. Info de linaje genético protegida por RLS y vista restringida.';
comment on column plantas.mama is 'SENSIBLE. Planta madre del cruzamiento genético.';
comment on column plantas.papa is 'SENSIBLE. Planta padre del cruzamiento genético.';


-- =============================================================================
-- TABLA: registros_evento
-- Historial de eventos de cada planta. Una planta acumula MUCHOS registros a lo
-- largo del tiempo (relación 1:N con plantas).
--
-- Los datos específicos de cada etapa VARÍAN según el tipo de evento
-- (polinización tiene "número de polinizaciones"; cosecha tiene "frutos F1/F2").
-- Modelar eso con columnas fijas obligaría a una columna por cada dato posible
-- de cada tipo de evento → tabla gigante llena de NULLs. Por eso usamos JSONB:
-- un campo flexible que guarda un objeto {clave: valor} distinto por tipo.
-- Trade-off: la base no valida la forma del JSON; esa validación la hace la app.
-- =============================================================================
create table registros_evento (
  id                 uuid primary key default gen_random_uuid(),
  planta_id          uuid not null references plantas (id) on delete cascade,
  tipo_evento        tipo_evento not null,
  fecha              date not null default current_date,  -- día del evento (sin hora)
  -- Datos variables por tipo de evento. Ej para 'cosecha':
  --   {"frutos_cuajados": 12, "f1": 8, "f2": 3}
  datos              jsonb not null default '{}'::jsonb,
  notas              text,                                -- texto libre del operario
  created_by         uuid references perfiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table registros_evento is 'Historial 1:N de eventos por planta. Datos variables por etapa en columna JSONB.';
comment on column registros_evento.datos is 'JSONB con los datos específicos de la etapa. La app valida la forma según tipo_evento.';
comment on column registros_evento.fecha is 'Fecha del evento como DATE (sin hora). created_at guarda el timestamp de carga.';

-- Índice para acelerar "traeme todos los eventos de esta planta ordenados por fecha".
create index idx_registros_evento_planta on registros_evento (planta_id, fecha desc);


-- =============================================================================
-- TABLA: evento_archivos
-- Metadatos de las fotos/videos. LOS ARCHIVOS BINARIOS NO VAN ACÁ: viven en
-- Supabase Storage (object storage). Esta tabla solo guarda el PUNTERO (la ruta
-- dentro del bucket) más metadatos. Guardar binarios en columnas SQL es una
-- mala práctica: infla la base, encarece backups y no sirve CDN.
-- =============================================================================
create table evento_archivos (
  id                 uuid primary key default gen_random_uuid(),
  registro_id        uuid not null references registros_evento (id) on delete cascade,
  -- Ruta del objeto dentro del bucket de Storage, ej "plantas/02-001/foto1.jpg".
  storage_path       text not null unique,
  tipo               tipo_archivo not null,
  created_by         uuid references perfiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

comment on table evento_archivos is 'Metadatos de fotos/videos. El binario vive en Supabase Storage; acá solo el storage_path.';
comment on column evento_archivos.storage_path is 'Ruta del objeto dentro del bucket de Storage. El binario NUNCA se guarda en la DB.';

create index idx_evento_archivos_registro on evento_archivos (registro_id);


-- =============================================================================
-- TRIGGER util: mantener updated_at al día automáticamente.
-- Este SÍ es válido porque se dispara en UPDATE (no en SELECT).
-- =============================================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_perfiles_updated_at
  before update on perfiles
  for each row execute function set_updated_at();

create trigger trg_plantas_updated_at
  before update on plantas
  for each row execute function set_updated_at();

create trigger trg_registros_evento_updated_at
  before update on registros_evento
  for each row execute function set_updated_at();
