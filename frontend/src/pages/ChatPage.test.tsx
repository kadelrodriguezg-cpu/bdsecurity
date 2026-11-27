import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { CanalChat } from '@/types/chat';

const mocks = vi.hoisted(() => ({
  listarCanales: vi.fn(),
  obtenerCanal: vi.fn(),
}));

vi.mock('@/api/chat', () => ({ chat: mocks }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'usuario-1' } }) }));
vi.mock('@/features/chat/CanalLibreModal', () => ({ CanalLibreModal: () => null }));
vi.mock('@/features/chat/ConversacionChat', () => ({
  ConversacionChat: ({ canal }: { canal: CanalChat }) => <div>Conversación activa: {canal.entidad_nombre ?? 'General'}</div>,
}));

import { ChatPage } from './ChatPage';

const GENERAL: CanalChat = {
  id: 'general', tipo: 'general', entidad_id: null, entidad_nombre: null,
  ultima_posicion: 0, ultima_lectura: 0, no_leidos: 0,
  ultima_actividad_at: '2026-09-07T12:00:00.000Z', archivado: false, creado_por: null,
  oculto_desde: 0, puede_gestionar: false, creado_at: '2026-09-07T12:00:00.000Z',
};
const CRUCE: CanalChat = {
  id: 'canal-cruce', tipo: 'cruce', entidad_id: 'planta-1', entidad_nombre: '02-145',
  ultima_posicion: 3, ultima_lectura: 0, no_leidos: 3,
  ultima_actividad_at: '2026-09-07T12:03:00.000Z', archivado: false, creado_por: null,
  oculto_desde: 0, puede_gestionar: false, creado_at: '2026-09-07T12:00:00.000Z',
};

function Ubicacion() {
  return <output aria-label="ubicación">{useLocation().pathname}{useLocation().search}</output>;
}

function renderChat(ruta: string) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/chat" element={<><ChatPage /><Ubicacion /></>} />
          <Route path="/chat/planta/:plantaId" element={<><ChatPage /><Ubicacion /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.listarCanales.mockResolvedValue([GENERAL, CRUCE]);
  mocks.obtenerCanal.mockResolvedValue(CRUCE.id);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatPage', () => {
  it('abre desde la ficha el canal del cruce y deja una URL estable', async () => {
    renderChat('/chat/planta/planta-1');

    expect(await screen.findByText('Conversación activa: 02-145')).toBeInTheDocument();
    expect(mocks.obtenerCanal).toHaveBeenCalledWith({ tipo: 'cruce', entidadId: 'planta-1' });
    await waitFor(() => expect(screen.getByLabelText('ubicación')).toHaveTextContent('/chat?canal=canal-cruce'));
  });

  it('muestra una salida recuperable si el cruce solicitado ya no está disponible', async () => {
    mocks.obtenerCanal.mockRejectedValueOnce(new Error('La entidad no está disponible.'));
    renderChat('/chat/planta/planta-inexistente');

    expect(await screen.findByText('No se pudo abrir el chat')).toBeInTheDocument();
    expect(screen.getByText('La entidad no está disponible.')).toBeInTheDocument();
  });

  it('conserva el mensaje objetivo de una notificación en la URL', async () => {
    renderChat('/chat?canal=canal-cruce&mensaje=mensaje-7');

    expect(await screen.findByText('Conversación activa: 02-145')).toBeInTheDocument();
    expect(screen.getByLabelText('ubicación')).toHaveTextContent('/chat?canal=canal-cruce&mensaje=mensaje-7');
  });
});
