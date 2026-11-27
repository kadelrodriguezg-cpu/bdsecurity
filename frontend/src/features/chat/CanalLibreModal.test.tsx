import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanalChat } from '@/types/chat';

const mocks = vi.hoisted(() => ({
  listarPerfiles: vi.fn(),
  listarParticipantes: vi.fn(),
  crearCanalLibre: vi.fn(),
  actualizarParticipantes: vi.fn(),
  archivarCanalLibre: vi.fn(),
}));

vi.mock('@/api/perfiles', () => ({ listarPerfiles: mocks.listarPerfiles }));
vi.mock('@/api/chat', () => ({ chat: mocks }));

import { CanalLibreModal } from './CanalLibreModal';

const PERFILES = [
  { id: 'admin-1', nombre: 'Ana Administradora', rol: 'admin', puede_ver_linaje: true },
  { id: 'operario-1', nombre: 'Bruno Operario', rol: 'operario', puede_ver_linaje: false },
  { id: 'operario-2', nombre: 'Carolina Operaria', rol: 'operario', puede_ver_linaje: false },
];

const CANAL: CanalChat = {
  id: 'canal-libre', tipo: 'libre', entidad_id: null, entidad_nombre: 'Equipo Norte',
  ultima_posicion: 0, ultima_lectura: 0, no_leidos: 0,
  ultima_actividad_at: '2026-09-07T12:00:00.000Z', archivado: false,
  creado_por: 'admin-1', oculto_desde: 0, puede_gestionar: true,
  creado_at: '2026-09-07T12:00:00.000Z',
};

function renderModal(props: Partial<React.ComponentProps<typeof CanalLibreModal>> = {}) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onGuardado = vi.fn();
  render(
    <QueryClientProvider client={cliente}>
      <CanalLibreModal
        open
        usuarioId="admin-1"
        onCerrar={vi.fn()}
        onGuardado={onGuardado}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onGuardado };
}

beforeEach(() => {
  mocks.listarPerfiles.mockResolvedValue(PERFILES);
  mocks.listarParticipantes.mockResolvedValue(PERFILES.slice(0, 2));
  mocks.crearCanalLibre.mockResolvedValue('canal-nuevo');
  mocks.actualizarParticipantes.mockResolvedValue(undefined);
  mocks.archivarCanalLibre.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('CanalLibreModal', () => {
  it('crea un canal con nombre y participantes explícitos, conservando al creador', async () => {
    const { onGuardado } = renderModal();
    fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Temporada 2027' } });
    const creador = await screen.findByRole('checkbox', { name: /Ana Administradora/ });
    expect(creador).toBeChecked();
    expect(creador).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Bruno Operario/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear canal' }));

    await waitFor(() => expect(mocks.crearCanalLibre).toHaveBeenCalledWith('Temporada 2027', ['admin-1', 'operario-1']));
    expect(onGuardado).toHaveBeenCalledWith('canal-nuevo');
  });

  it('actualiza membresía y archiva un canal solo tras confirmación', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onGuardado } = renderModal({ canal: CANAL });
    const invitado = await screen.findByRole('checkbox', { name: /Bruno Operario/ });
    // El control puede aparecer antes del efecto que copia los participantes.
    await waitFor(() => expect(invitado).toBeChecked());
    fireEvent.click(invitado);
    fireEvent.click(screen.getByRole('checkbox', { name: /Carolina Operaria/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar participantes' }));

    await waitFor(() => expect(mocks.actualizarParticipantes).toHaveBeenCalledWith('canal-libre', ['admin-1', 'operario-2']));
    expect(onGuardado).toHaveBeenCalledWith('canal-libre');

    fireEvent.click(screen.getByRole('button', { name: 'Archivar canal' }));
    expect(confirmar).toHaveBeenCalledOnce();
    await waitFor(() => expect(mocks.archivarCanalLibre).toHaveBeenCalledWith('canal-libre'));
  });
});
