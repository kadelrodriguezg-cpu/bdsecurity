-- A1-003: los cruces se borran únicamente mediante borrar_cruzamiento.
-- La RPC SECURITY DEFINER conserva sus privilegios como dueña.
revoke delete on public.plantas from authenticated;
drop policy if exists plantas_delete_admin on public.plantas;

-- La bitácora se elimina lógicamente; no hay flujo de borrado físico directo.
revoke delete on public.registros_evento from authenticated;
drop policy if exists registros_delete_admin on public.registros_evento;

-- Sin pantallas ni necesidad de DELETE directo. La baja de cuentas por Auth
-- y la limpieza administrativa usan roles propios, no authenticated.
revoke delete on public.perfiles, public.especies from authenticated;

-- evento_archivos conserva DELETE: eliminarArchivoDeEvento lo usa para
-- quitar adjuntos; su policy limita el acceso al autor o admin.
