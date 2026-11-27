-- =============================================================================
-- MIGRACIÓN 003 — ROW LEVEL SECURITY (RLS)
--
-- RLS = "seguridad a nivel de fila". Cuando está activado en una tabla, Postgres
-- NIEGA todo acceso por default y solo permite lo que una POLICY habilita
-- explícitamente. Es la red de seguridad central: aunque el frontend tenga un
-- bug, la base no deja pasar lo que la policy no autoriza.
--
-- Requisito no negociable: RLS activado en TODAS las tablas desde el inicio.
--
-- Recordatorio importante: RLS controla QUÉ FILAS ve cada usuario, NO qué
-- columnas. Ocultar las columnas de linaje (cruzamiento/mama/papa) se hace con
-- la VISTA de la migración 004, no acá.
-- =============================================================================


-- Activamos RLS en todas las tablas. A partir de acá, sin policy = sin acceso.
alter table perfiles          enable row level security;
alter table especies          enable row level security;
alter table plantas           enable row level security;
alter table registros_evento  enable row level security;
alter table evento_archivos   enable row level security;
alter table audit_log         enable row level security;


-- =============================================================================
-- PERFILES
-- =============================================================================

-- Cada usuario puede leer SU PROPIO perfil. (No queremos que un operario liste
-- los perfiles/roles de todos los demás.)
create policy perfiles_select_propio
  on perfiles for select
  using (id = auth.uid());

-- Un admin puede leer todos los perfiles (para administrar roles/permisos).
create policy perfiles_select_admin
  on perfiles for select
  using (es_admin());

-- Un usuario puede editar su propio nombre, pero NO su rol ni su permiso de
-- linaje (eso lo controla la app/admin; ver nota). Postgres no filtra columnas
-- en UPDATE con RLS, así que la restricción de "no cambiar tu propio rol" se
-- refuerza en la capa de app o con un trigger. Por ahora: solo su fila.
create policy perfiles_update_propio
  on perfiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Solo un admin puede crear o borrar perfiles y cambiar roles.
create policy perfiles_admin_todo
  on perfiles for all
  using (es_admin())
  with check (es_admin());


-- =============================================================================
-- ESPECIES (tabla de catálogo)
-- =============================================================================

-- Cualquier usuario autenticado puede LEER el catálogo de especies (no es sensible).
create policy especies_select_autenticados
  on especies for select
  using (auth.uid() is not null);

-- Solo admins pueden crear/editar/borrar especies.
create policy especies_admin_escribe
  on especies for all
  using (es_admin())
  with check (es_admin());


-- =============================================================================
-- PLANTAS
-- Ojo: estas policies dan acceso a las FILAS. Que un operario pueda leer la fila
-- NO significa que vea las columnas de linaje: para eso está la vista restringida.
-- El operario consulta la vista (sin linaje); el admin puede consultar la tabla.
-- =============================================================================

-- Cualquier usuario autenticado puede leer las filas de plantas (necesario para
-- que la vista operativa funcione). La protección del linaje es por columna (vista).
create policy plantas_select_autenticados
  on plantas for select
  using (auth.uid() is not null);

-- Operarios y admins pueden ACTUALIZAR el estado de una planta (trabajo de campo).
-- La restricción de que un operario no toque las columnas de linaje se maneja
-- por GRANT de columnas (ver más abajo) + la vista. Acá permitimos la fila.
create policy plantas_update_autenticados
  on plantas for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Solo admins pueden CREAR o BORRAR plantas (alta de planta = tarea de gestión).
create policy plantas_insert_admin
  on plantas for insert
  with check (es_admin());

create policy plantas_delete_admin
  on plantas for delete
  using (es_admin());


-- =============================================================================
-- REGISTROS_EVENTO
-- El operario de campo SÍ crea y lee eventos (polinizaciones, cosechas, notas).
-- =============================================================================

-- Cualquier autenticado puede leer los eventos de las plantas.
create policy registros_select_autenticados
  on registros_evento for select
  using (auth.uid() is not null);

-- Cualquier autenticado (operario o admin) puede INSERTAR eventos. Se fuerza que
-- created_by sea el propio usuario para que nadie cargue eventos "a nombre de otro".
create policy registros_insert_autenticados
  on registros_evento for insert
  with check (auth.uid() is not null and created_by = auth.uid());

-- El autor de un evento puede editar su propio registro; un admin puede editar cualquiera.
create policy registros_update_autor_o_admin
  on registros_evento for update
  using (created_by = auth.uid() or es_admin())
  with check (created_by = auth.uid() or es_admin());

-- Solo admins pueden borrar eventos (evita que se borre historial de campo).
create policy registros_delete_admin
  on registros_evento for delete
  using (es_admin());


-- =============================================================================
-- EVENTO_ARCHIVOS (metadatos de fotos/videos)
-- =============================================================================

-- Cualquier autenticado puede leer los metadatos de archivos.
create policy archivos_select_autenticados
  on evento_archivos for select
  using (auth.uid() is not null);

-- Cualquier autenticado puede registrar un archivo que él mismo subió.
create policy archivos_insert_autenticados
  on evento_archivos for insert
  with check (auth.uid() is not null and created_by = auth.uid());

-- El autor o un admin pueden borrar el metadato del archivo.
create policy archivos_delete_autor_o_admin
  on evento_archivos for delete
  using (created_by = auth.uid() or es_admin());


-- =============================================================================
-- AUDIT_LOG
-- Append-only: se puede INSERTAR, pero nadie edita ni borra. Solo admins leen.
-- =============================================================================

-- Solo admins pueden LEER el log de auditoría (es información de control interno).
create policy audit_select_admin
  on audit_log for select
  using (es_admin());

-- NO creamos policies de UPDATE ni DELETE: al no existir, RLS las niega a todos.
-- Esto hace el log inmutable desde la API. (La función RPC de la migración 004
-- inserta con SECURITY DEFINER, así que no necesita una policy de INSERT abierta.)


-- =============================================================================
-- GRANTS DE COLUMNA — refuerzo extra sobre el linaje en la TABLA plantas
-- El rol 'authenticated' es el rol de Postgres que Supabase asigna a los usuarios
-- logueados. Queremos que NO pueda leer cruzamiento/mama/papa directamente.
--
-- OJO (detalle clave de Postgres): un REVOKE a nivel de COLUMNA no sirve si ya
-- existe un GRANT SELECT a nivel de TABLA — y Supabase concede ese grant de tabla
-- al rol authenticated por default. Por eso primero revocamos el SELECT de la
-- tabla ENTERA y después concedemos SELECT solo sobre las columnas NO sensibles.
-- Resultado: 'select cruzamiento from plantas' queda denegado a nivel de permiso.
--
-- El acceso legítimo al linaje pasa por la RPC obtener_planta (migración 004),
-- que corre con SECURITY DEFINER y valida el permiso antes de exponerlo.
-- Esto es "defensa en profundidad": la vista operativa ya no muestra el linaje,
-- y este grant cierra además el camino directo a la tabla.
-- =============================================================================

-- 1) Quitamos el SELECT sobre la tabla completa (anula el grant default de Supabase).
revoke select on plantas from authenticated;

-- 2) Concedemos SELECT SOLO sobre las columnas no sensibles.
grant select (id, codigo_sistema, especie_id, estado, created_at, updated_at)
  on plantas to authenticated;

-- 3) Mismo criterio para la ESCRITURA: un operario NO debe poder sobrescribir el
-- linaje al editar una planta. Revocamos el UPDATE de tabla completa y concedemos
-- UPDATE solo sobre 'estado' (el campo que el operario cambia en el campo).
-- IMPORTANTE: en Supabase TODOS los usuarios logueados comparten el rol Postgres
-- 'authenticated' (admin vs operario se distingue en el RLS con perfiles, no con
-- roles de Postgres). Por eso este grant también impide que un admin edite el
-- linaje con un UPDATE directo: la edición de linaje por admin se hará con una
-- RPC SECURITY DEFINER dedicada (Fase 3, ver PLAN.md), igual que la lectura.
revoke update on plantas from authenticated;
grant update (estado) on plantas to authenticated;
