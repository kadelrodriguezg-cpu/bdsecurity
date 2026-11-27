/** U-01: el login avisa que la sesión expiró y, si quedó un borrador de esa persona, que sigue guardado; luego vuelve a la ruta donde estaba. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { marcarSesionExpirada, prefijoBorradoresDe } from '@/lib/borradoresSesion';

const mocks = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ login: mocks.login }) }));
import { LoginPage } from './LoginPage';

function Destino() { const l = useLocation(); return <output>{l.pathname}</output>; }
function montar(next: string) {
  render(
    <MemoryRouter initialEntries={[`/login?${new URLSearchParams({ next })}`]}>
      <Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={<Destino />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); mocks.login.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

it('con un borrador guardado dice que la evaluación sigue en este equipo y tras entrar vuelve al formulario', async () => {
  marcarSesionExpirada('usuario-a');
  localStorage.setItem(prefijoBorradoresDe('usuario-a') + 'evaluacion:r1', '{}');
  montar('/planta/p1/evaluar/i1');

  expect(screen.getByRole('status')).toHaveTextContent('Tu sesión expiró; tu evaluación sigue guardada en este equipo.');

  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sintetico@ejemplo.cl' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'solo-test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
  expect(await screen.findByText('/planta/p1/evaluar/i1')).toBeInTheDocument();
});

it('sin borrador solo avisa que la sesión expiró', () => {
  marcarSesionExpirada('usuario-a');
  localStorage.setItem(prefijoBorradoresDe('usuario-b') + 'evaluacion:r1', '{}');
  montar('/plantas');
  expect(screen.getByRole('status')).toHaveTextContent('Tu sesión expiró. Vuelve a iniciar sesión.');
  expect(screen.queryByText(/sigue guardada/)).not.toBeInTheDocument();
});

it('sin aviso de sesión expirada (cierre manual o primera entrada) no muestra nada', () => {
  montar('/plantas');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
