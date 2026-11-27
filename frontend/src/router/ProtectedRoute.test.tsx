import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
const auth = vi.hoisted(() => ({ user: null as null | { id: string }, cargando: false }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => auth }));
import { ProtectedRoute } from './ProtectedRoute';
afterEach(() => { cleanup(); auth.user = null; auth.cargando = false; });
function LoginDestino() {
  const location = useLocation();
  return <output>{new URLSearchParams(location.search).get('next')}</output>;
}
function montar() {
  render(<MemoryRouter initialEntries={['/planta/uuid?etapa=siembra#historial']}><Routes>
    <Route path="/login" element={<LoginDestino />} />
    <Route element={<ProtectedRoute />}><Route path="/planta/:id" element={<div>Ficha protegida</div>} /></Route>
  </Routes></MemoryRouter>);
}
describe('ProtectedRoute — destino tras autenticar', () => {
  it('transporta pathname, filtros y ancla al query de login', () => {
    montar();
    expect(screen.getByRole('status')).toHaveTextContent('/planta/uuid?etapa=siembra#historial');
    expect(screen.queryByText('Ficha protegida')).not.toBeInTheDocument();
  });
  it('no redirige mientras resuelve la sesión', () => {
    auth.cargando = true;
    montar();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('conserva la ficha cuando existe sesión', () => {
    auth.user = { id: 'sintetico' };
    montar();
    expect(screen.getByText('Ficha protegida')).toBeInTheDocument();
  });
});
