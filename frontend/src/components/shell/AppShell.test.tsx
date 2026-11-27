import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

const mocks = vi.hoisted(() => ({ esAdmin: false, logout: vi.fn() }));
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'usuario-1' },
    perfil: { nombre: mocks.esAdmin ? 'Ana Admin' : 'Omar Operario' },
    esAdmin: mocks.esAdmin,
    logout: mocks.logout,
  }),
}));
vi.mock('@/features/chat/ChatPanelContext', () => ({
  ChatPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ControlesChat: () => (
    <div>
      <button type="button" aria-label="Abrir notificaciones" />
      <button type="button" aria-label="Abrir chat del equipo, 3 sin leer" />
    </div>
  ),
}));
vi.mock('@/api/plantas', () => ({ buscarIdPorCodigoSistema: vi.fn() }));
vi.mock('@/api/individuos', () => ({ resolverIndividuo: vi.fn(), resolverIndividuoPorCodigo: vi.fn() }));

import { AppShell } from './AppShell';

afterEach(() => { cleanup(); mocks.esAdmin = false; });

function montar(ruta = '/') {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<p>Contenido</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const navEscritorio = () => document.querySelector('nav[data-nav="escritorio"]') as HTMLElement;
const navMovil = () => document.querySelector('nav[data-nav="movil"]') as HTMLElement;
const etiquetas = (nav: HTMLElement) => within(nav).getAllByRole('link').map((enlace) => enlace.textContent);

describe('AppShell: navegación por rol', () => {
  it('operario: Inicio, Cruces y Resultados; sin Administración', () => {
    montar();
    expect(etiquetas(navEscritorio())).toEqual(['Inicio', 'Cruces', 'Resultados']);
    expect(etiquetas(navMovil())).toEqual(['Inicio', 'Cruces', 'Resultados']);
    expect(screen.queryByRole('link', { name: 'Administración' })).not.toBeInTheDocument();
  });

  it('admin: suma Administración en las dos navegaciones', () => {
    mocks.esAdmin = true;
    montar();
    expect(etiquetas(navEscritorio())).toEqual(['Inicio', 'Cruces', 'Resultados', 'Administración']);
    expect(etiquetas(navMovil())).toEqual(['Inicio', 'Cruces', 'Resultados', 'Administración']);
  });

  it('ya no existe «Más», ni el enlace Escanear en la navegación, ni EVECL fuera del menú de cuenta', () => {
    mocks.esAdmin = true;
    montar();
    expect(screen.queryByRole('button', { name: /más/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Más opciones' })).not.toBeInTheDocument();
    for (const nav of [navEscritorio(), navMovil()]) {
      expect(within(nav).queryByRole('link', { name: /escanear/i })).not.toBeInTheDocument();
      expect(within(nav).queryByRole('link', { name: /evecl/i })).not.toBeInTheDocument();
    }
  });

  it('el destino de las navegaciones apunta a su ruta de entrada', () => {
    mocks.esAdmin = true;
    montar();
    const destinos = within(navEscritorio()).getAllByRole('link').map((enlace) => enlace.getAttribute('href'));
    expect(destinos).toEqual(['/', '/plantas', '/resultados', '/administracion']);
  });
});

describe('AppShell: destino activo (aria-current)', () => {
  it.each([
    ['/', 'Inicio'],
    ['/plantas', 'Cruces'],
    ['/planta/0fefd6f5-e839-462a-8875-08ad45a3d468', 'Cruces'],
    ['/individuo/0fefd6f5-e839-462a-8875-08ad45a3d468', 'Cruces'],
    ['/ranking', 'Resultados'],
    ['/dashboard', 'Resultados'],
    ['/visualizaciones', 'Resultados'],
    ['/usuarios', 'Administración'],
    ['/catalogos', 'Administración'],
    ['/cruzamientos', 'Administración'],
  ])('en %s se marca «%s» y solo ese', (ruta, activo) => {
    mocks.esAdmin = true;
    montar(ruta);
    for (const nav of [navEscritorio(), navMovil()]) {
      const marcados = within(nav).getAllByRole('link').filter((enlace) => enlace.getAttribute('aria-current') === 'page');
      expect(marcados.map((enlace) => enlace.textContent)).toEqual([activo]);
    }
  });

  it.each(['/perfil', '/evecl', '/escanear', '/chat'])('en %s ningún destino principal queda marcado', (ruta) => {
    montar(ruta);
    expect(document.querySelectorAll('nav [aria-current="page"]')).toHaveLength(0);
  });
});

describe('AppShell: tamaño', () => {
  it('la navegación horizontal es de escritorio y la barra inferior solo de celular', () => {
    montar();
    expect(navEscritorio()).toHaveClass('hidden', 'md:flex');
    expect(navMovil()).toHaveClass('fixed', 'bottom-0', 'md:hidden');
  });

  it('la barra inferior usa 3 columnas para el operario y 4 para el admin', () => {
    montar();
    expect(navMovil()).toHaveClass('grid-cols-3');
    cleanup();
    mocks.esAdmin = true;
    montar();
    expect(navMovil()).toHaveClass('grid-cols-4');
  });

  it('reserva espacio inferior para la barra y respeta el área segura', () => {
    montar();
    const raiz = navMovil().parentElement as HTMLElement;
    expect(raiz.className).toContain('pb-[calc(6rem+env(safe-area-inset-bottom))]');
    expect(navMovil().className).toContain('pb-[env(safe-area-inset-bottom)]');
  });

  it('la barra inferior se oculta mientras hay un campo de texto enfocado (teclado abierto) y vuelve al salir', () => {
    montar();
    const campo = screen.getByRole('textbox', { name: /buscar por código/i });
    expect(navMovil()).toBeVisible();
    fireEvent.focusIn(campo);
    expect(navMovil()).not.toBeVisible();
    fireEvent.focusOut(campo);
    expect(navMovil()).toBeVisible();
  });
});

describe('AppShell: encabezado', () => {
  it('tiene la búsqueda con escáner, la campana, el chat con su contador y el menú de cuenta', () => {
    montar();
    const encabezado = screen.getByRole('banner');
    expect(within(encabezado).getByRole('search', { name: 'Buscar por código' })).toBeInTheDocument();
    expect(within(encabezado).getByRole('button', { name: 'Escanear código QR' })).toBeInTheDocument();
    expect(within(encabezado).getByRole('button', { name: 'Abrir notificaciones' })).toBeInTheDocument();
    expect(within(encabezado).getByRole('button', { name: 'Abrir chat del equipo, 3 sin leer' })).toBeInTheDocument();
    expect(within(encabezado).getByRole('button', { name: 'Menú de cuenta, Omar Operario' })).toBeInTheDocument();
  });

  it('el logo es un enlace al inicio con nombre accesible', () => {
    montar('/plantas');
    expect(screen.getByRole('link', { name: 'BDSecurity, ir al inicio' })).toHaveAttribute('href', '/');
  });

  it('todos los controles del encabezado son botones o enlaces con nombre accesible', () => {
    mocks.esAdmin = true;
    montar();
    const encabezado = screen.getByRole('banner');
    for (const control of within(encabezado).getAllByRole('button')) {
      expect(control).toHaveAccessibleName();
    }
    for (const enlace of within(encabezado).getAllByRole('link')) {
      expect(enlace).toHaveAccessibleName();
    }
  });
});

describe('AppShell: menú de cuenta', () => {
  it('muestra nombre y rol; Mi perfil, EVECL (Externo) y Cerrar sesión', () => {
    montar();
    expect(screen.queryByRole('group', { name: 'Cuenta' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Menú de cuenta, Omar Operario' }));
    const menu = screen.getByRole('group', { name: 'Cuenta' });
    expect(menu).toHaveTextContent('Omar Operario');
    expect(menu).toHaveTextContent('Operario');
    expect(within(menu).getByRole('link', { name: 'Mi perfil' })).toHaveAttribute('href', '/perfil');
    expect(within(menu).getByRole('link', { name: /evecl\s*externo/i })).toHaveAttribute('href', '/evecl');
    expect(within(menu).getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('el admin se identifica como Administrador', () => {
    mocks.esAdmin = true;
    montar();
    fireEvent.click(screen.getByRole('button', { name: /menú de cuenta/i }));
    expect(screen.getByRole('group', { name: 'Cuenta' })).toHaveTextContent('Administrador');
  });

  it('se abre y se cierra con el teclado: Escape cierra y devuelve el foco al botón', () => {
    montar();
    const boton = screen.getByRole('button', { name: /menú de cuenta/i });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Cuenta' })).not.toBeInTheDocument();
    expect(boton).toHaveFocus();
  });

  it('se cierra al pulsar fuera', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /menú de cuenta/i }));
    fireEvent.mouseDown(screen.getByText('Contenido'));
    expect(screen.queryByRole('group', { name: 'Cuenta' })).not.toBeInTheDocument();
  });

  it('se cierra al navegar a Mi perfil', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /menú de cuenta/i }));
    fireEvent.click(screen.getByRole('link', { name: 'Mi perfil' }));
    expect(screen.queryByRole('group', { name: 'Cuenta' })).not.toBeInTheDocument();
  });
});

describe('AppShell: opción global «Incluir cruces de prueba» (N4)', () => {
  it('solo el admin la ve en el menú de cuenta, y se guarda en el equipo', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /menú de cuenta/i }));
    expect(screen.queryByRole('checkbox', { name: 'Incluir cruces de prueba' })).not.toBeInTheDocument();
    cleanup();
    mocks.esAdmin = true;
    montar();
    fireEvent.click(screen.getByRole('button', { name: /menú de cuenta/i }));
    const opcion = screen.getByRole('checkbox', { name: 'Incluir cruces de prueba' });
    expect(opcion).not.toBeChecked();
    fireEvent.click(opcion);
    expect(opcion).toBeChecked();
    expect(localStorage.getItem('bds:incluir-cruces-prueba')).toBe('1');
    fireEvent.click(opcion);
    expect(localStorage.getItem('bds:incluir-cruces-prueba')).toBeNull();
  });
});
