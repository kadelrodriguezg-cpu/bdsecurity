/**
 * Ruta protegida por autenticación: sin sesión válida, redirige a /login.
 * Mientras se resuelve la sesión muestra un estado de carga (evita el "flash"
 * de redirección a login en usuarios que sí están logueados).
 */
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/features/auth/AuthContext';
import { Loader2 } from 'lucide-react';
import { destinoLogin } from '@/lib/destinoInterno';

export function ProtectedRoute() {
  const { user, cargando } = useAuth();
  const location = useLocation();

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to={destinoLogin(`${location.pathname}${location.search}${location.hash}`)} replace />;
  return <Outlet />;
}
