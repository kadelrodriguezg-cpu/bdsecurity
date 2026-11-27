-- =============================================================================
-- MIGRACIÓN 009 — GRANTS EXPLÍCITOS PARA LOS ROLES DE LA API
--
-- Bug encontrado por los tests de RLS (Fase 0.4): las versiones recientes del
-- stack de Supabase YA NO conceden privilegios DML (SELECT/INSERT/UPDATE/DELETE)
-- por default a anon/authenticated/service_role sobre las tablas nuevas. Las
-- policies de RLS estaban bien, pero RLS decide QUÉ FILAS ves DESPUÉS de que el
-- GRANT te dejó entrar a la tabla: sin grants, todo daba "permission denied".
--
-- Este archivo declara EXPLÍCITAMENTE el mínimo que cada rol necesita. Es mejor
-- práctica que depender de defaults: el modelo de permisos queda versionado y
-- legible acá, y un cambio de defaults de Supabase no nos vuelve a romper.
--
-- Capas, para no confundirse:
--   GRANT  = a qué tablas/columnas puede entrar el ROL de Postgres (grueso).
--   RLS    = qué filas ve/toca cada USUARIO según las policies (fino).
--   Triggers/RPCs = reglas de negocio (rol/linaje/auditoría).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- service_role: la clave administrativa del servidor (bypassa RLS pero también
-- necesita grants). Acceso total: la protegen fuera de la base (nunca en el
-- frontend). La usan los scripts de administración y los tests.
-- ---------------------------------------------------------------------------
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- authenticated: cualquier usuario logueado. El grant abre la puerta gruesa;
-- las policies de RLS deciden las filas y los triggers el resto.
-- ---------------------------------------------------------------------------

-- perfiles: leer (RLS: el propio, o todos si admin), editar (RLS: el propio o
-- admin; el trigger 006 protege rol/puede_ver_linaje), crear/borrar (RLS: admin).
grant select, insert, update, delete on perfiles to authenticated;

-- especies: catálogo legible por todos; escritura la limita el RLS a admin.
grant select, insert, update, delete on especies to authenticated;

-- plantas: SIN grant de tabla completa a propósito (el linaje se protege por
-- columna). La migración 003 ya concedió SELECT y UPDATE por COLUMNA; acá solo
-- agregamos INSERT y DELETE a nivel de tabla (el RLS los limita a admin).
-- Se re-declaran los grants de columna por claridad y por idempotencia.
grant select (id, codigo_sistema, especie_id, estado, created_at, updated_at)
  on plantas to authenticated;
grant update (estado) on plantas to authenticated;
grant insert, delete on plantas to authenticated;

-- registros_evento: el corazón del trabajo de campo (RLS: insertar a nombre
-- propio, editar lo propio o admin, borrar solo admin).
grant select, insert, update, delete on registros_evento to authenticated;

-- evento_archivos: metadatos de fotos/videos (RLS: insertar propio, borrar
-- propio o admin). No hay UPDATE: los archivos son inmutables.
grant select, insert, delete on evento_archivos to authenticated;

-- audit_log: SOLO lectura (RLS la limita a admin). Sin INSERT/UPDATE/DELETE:
-- las escrituras las hacen únicamente las funciones SECURITY DEFINER, que
-- corren como el dueño de la tabla. Append-only real.
grant select on audit_log to authenticated;

-- ---------------------------------------------------------------------------
-- anon: usuarios SIN login. No se concede NADA sobre las tablas del dominio.
-- (Se deja escrito explícitamente para que la intención quede documentada.)
-- ---------------------------------------------------------------------------
-- Sin grants para anon: correcto y deliberado.
