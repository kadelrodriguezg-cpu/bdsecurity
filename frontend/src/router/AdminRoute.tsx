/**
 * Ruta protegida por ROL (variante que FoliarScan no tenía). Requiere sesión
 * Y rol admin. A un operario no le muestra un error críptico: le explica y le
 * da la vuelta al dashboard.
 *
 * Recordatorio: esto es UX, no seguridad. Aunque un operario llegara a esta
 * pantalla, el RLS del backend no le devolvería los datos de admin.
 */
import { Navigate, Link, Outlet } from 'react-router';
import { useAuth } from '@/features/auth/AuthContext';
import { ShieldAlert, Loader2 } from 'lucide-react';

export function AdminRoute() {
  const { user, esAdmin, cargando } = useAuth();

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!esAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <ShieldAlert className="h-12 w-12 text-ink-4" />
        <h1 className="text-xl font-semibold">No tienes permiso para ver esta sección</h1>
        <p className="max-w-md text-sm text-ink-3">
          Esta pantalla es solo para administradores. Si crees que deberías tener acceso,
          pídele a un administrador que revise tu rol.
        </p>
        <Link to="/" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          Volver al inicio
        </Link>
      </div>
    );
  }

  return <Outlet />;
}
