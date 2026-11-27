/**
 * Punto 6 del checklist: la ruta admin-only (Selección final va detrás de
 * AdminRoute) NO es alcanzable por un operario, aunque escriba la URL. AdminRoute
 * le muestra "sin permiso" en vez del contenido.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Routes, Route } from 'react-router';

const authState = { user: { id: 'u1' }, esAdmin: false, cargando: false };
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => authState }));

import { AdminRoute } from './AdminRoute';

afterEach(cleanup);

function montar() {
  render(
    <MemoryRouter initialEntries={['/seleccion']}>
      <Routes>
        <Route element={<AdminRoute />}>
          <Route path="/seleccion" element={<div>CONTENIDO ADMIN SECRETO</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRoute — protección de ruta admin-only', () => {
  it('un operario NO ve el contenido admin (aunque entre por URL)', () => {
    authState.esAdmin = false;
    montar();
    expect(screen.queryByText('CONTENIDO ADMIN SECRETO')).not.toBeInTheDocument();
    expect(screen.getByText(/No tienes permiso/)).toBeInTheDocument();
  });

  it('un admin sí ve el contenido', () => {
    authState.esAdmin = true;
    montar();
    expect(screen.getByText('CONTENIDO ADMIN SECRETO')).toBeInTheDocument();
  });
});
