/**
 * Marco de la aplicación (v3, Paso 2): encabezado con navegación horizontal, búsqueda por código con escáner, campana, chat y menú de
 * cuenta; barra inferior con los mismos destinos en el celular. Reemplaza a `AppLayout` (docs/rediseno_v3/shell.md).
 */
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/features/auth/AuthContext';
import { ChatPanelProvider, ControlesChat } from '@/features/chat/ChatPanelContext';
import { contarBorradoresDe } from '@/lib/borradoresSesion';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { BusquedaCodigo } from './BusquedaCodigo';
import { MenuCuenta } from './MenuCuenta';
import { SelectorEspecie } from './SelectorEspecie';
import { NavEscritorio, NavMovil } from './NavegacionPrincipal';
import { anchoAmplio, destinosPara } from './destinos';
import { useTecladoAbierto } from './useTecladoAbierto';

export function AppShell() {
  const { pathname } = useLocation();
  const { user, esAdmin, logout, errorPerfil, reintentarPerfil } = useAuth();
  const tecladoAbierto = useTecladoAbierto();
  // U-01: cerrar sesión a mano borra los borradores de quien cierra; si hay, se confirma antes.
  const [borradoresAlSalir, setBorradoresAlSalir] = useState<number | null>(null);
  const salir = () => {
    const pendientes = user ? contarBorradoresDe(user.id) : 0;
    if (pendientes > 0) setBorradoresAlSalir(pendientes);
    else void logout();
  };
  const destinos = destinosPara(esAdmin);

  return (
    <ChatPanelProvider>
      {/* U-10: overflow-x-clip y no -hidden; -hidden convertía este contenedor en uno con scroll y el encabezado (sticky) dejaba de pegarse. */}
      <div className="min-h-screen overflow-x-clip pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-10">
        {/* Alto fijo de 69 px (12 + 44 + 12 + borde): PlanillaRonda pega sus barras a 69 y 135 px. */}
        <header className="sticky top-0 z-30 border-b border-line bg-surface">
          <div className="mx-auto flex max-w-[1600px] items-center gap-1.5 px-2 py-3 md:gap-3 md:px-4">
            <Link
              to="/"
              aria-label="BDSecurity, ir al inicio"
              // Fase 4: en el celular el logo cede su lugar al selector de especie (Inicio sigue en la barra inferior).
              className="hidden min-h-tap min-w-tap shrink-0 items-center justify-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:flex"
            >
              <img src="/brand-logo.png" alt="" className="h-7 w-7" />
              <span aria-hidden="true" className="hidden font-semibold xl:inline">BDSecurity</span>
            </Link>

            {/* Fase 4: la especie es el espacio de trabajo de toda la app. */}
            <SelectorEspecie />

            <NavEscritorio destinos={destinos} pathname={pathname} />

            <BusquedaCodigo className="min-w-0 flex-1 md:ml-auto md:max-w-sm" />
            <ControlesChat />
            <MenuCuenta onSalir={salir} />
          </div>
        </header>

        <main className={cn('mx-auto px-4 py-6', anchoAmplio(pathname) ? 'max-w-[1600px]' : 'max-w-5xl')}>
          {errorPerfil && (
            <Alert className="mb-4">
              {errorPerfil}{' '}
              <Button type="button" variant="outline" size="sm" onClick={reintentarPerfil}>Reintentar</Button>
            </Alert>
          )}
          <Outlet />
        </main>

        <NavMovil destinos={destinos} pathname={pathname} oculta={tecladoAbierto} />

        {borradoresAlSalir !== null && (
          <Sheet
            titulo="¿Cerrar sesión?"
            onCerrar={() => setBorradoresAlSalir(null)}
            footer={(
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setBorradoresAlSalir(null)}>Volver</Button>
                <Button type="button" variant="destructive" onClick={() => { setBorradoresAlSalir(null); void logout(); }}>
                  Cerrar sesión y borrar
                </Button>
              </div>
            )}
          >
            <p className="text-sm text-ink-2">
              Tienes {borradoresAlSalir} {borradoresAlSalir === 1 ? 'evaluación sin enviar' : 'evaluaciones sin enviar'} en este equipo.
              Si cierras sesión se borran.
            </p>
          </Sheet>
        )}
      </div>
    </ChatPanelProvider>
  );
}
