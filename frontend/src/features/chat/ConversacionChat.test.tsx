import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanalChat, MensajeChat } from '@/types/chat';

const mocks = vi.hoisted(() => ({
  listarMensajes: vi.fn(),
  observarCanal: vi.fn(),
  marcarLeido: vi.fn(),
  enviarMensaje: vi.fn(),
  listarParticipantes: vi.fn(),
  listarContextoMensaje: vi.fn(),
  limpiarCanal: vi.fn(),
}));

vi.mock('@/api/chat', async () => {
  const core = await vi.importActual<typeof import('@/api/chat-core')>('@/api/chat-core');
  return {
    prepararMensajeChat: core.prepararMensajeChat,
    combinarMensajesChat: core.combinarMensajesChat,
    chat: mocks,
  };
});

import { ConversacionChat } from './ConversacionChat';

const CANAL: CanalChat = {
  id: 'canal-general',
  tipo: 'general',
  entidad_id: null,
  entidad_nombre: null,
  ultima_posicion: 2,
  ultima_lectura: 0,
  no_leidos: 2,
  ultima_actividad_at: '2026-09-07T12:02:00.000Z',
  archivado: false,
  creado_por: null,
  oculto_desde: 0,
  puede_gestionar: false,
  creado_at: '2026-09-07T12:00:00.000Z',
};

function mensaje(id: string, posicion: number, autorId: string, contenido: string): MensajeChat {
  return {
    id,
    posicion,
    canal_id: CANAL.id,
    autor_id: autorId,
    autor_nombre: autorId === 'yo' ? 'Mi nombre' : 'Carolina Flores',
    contenido,
    clave_envio: `00000000-0000-4000-8000-${posicion.toString().padStart(12, '0')}`,
    creado_at: `2026-09-07T12:0${posicion}:00.000Z`,
  };
}

beforeEach(() => {
  mocks.listarMensajes.mockResolvedValue([
    mensaje('m1', 1, 'otra', 'Revisión de campo terminada'),
    mensaje('m2', 2, 'yo', 'Datos cargados'),
  ]);
  mocks.marcarLeido.mockResolvedValue(undefined);
  mocks.observarCanal.mockImplementation(async (_canalId, opciones) => {
    opciones.onEstado('conectado');
    return { cerrar: vi.fn(), resincronizar: vi.fn() };
  });
  mocks.enviarMensaje.mockImplementation(async (envio) => mensaje('m3', 3, 'yo', envio.contenido));
  mocks.listarParticipantes.mockResolvedValue([
    { id: 'yo', nombre: 'Mi nombre' },
    { id: 'otra', nombre: 'Carolina Flores' },
  ]);
  mocks.listarContextoMensaje.mockResolvedValue([]);
  mocks.limpiarCanal.mockResolvedValue(2);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConversacionChat', () => {
  it('carga el historial, marca la última posición y confirma un envío', async () => {
    const alActualizarLectura = vi.fn();
    render(<ConversacionChat canal={CANAL} usuarioId="yo" onLecturaActualizada={alActualizarLectura} />);

    expect(await screen.findByText('Revisión de campo terminada')).toBeInTheDocument();
    expect(screen.getByText('Datos cargados')).toBeInTheDocument();
    await waitFor(() => expect(mocks.marcarLeido).toHaveBeenCalledWith(CANAL.id, 2));
    await waitFor(() => expect(alActualizarLectura).toHaveBeenCalledWith(CANAL.id, 2));

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: '  Nueva actualización  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));

    await waitFor(() => expect(mocks.enviarMensaje).toHaveBeenCalledOnce());
    expect(mocks.enviarMensaje.mock.calls[0][0]).toMatchObject({ canalId: CANAL.id, contenido: 'Nueva actualización' });
    expect(await screen.findByText('Nueva actualización')).toBeInTheDocument();
    expect(screen.getByLabelText('Mensaje')).toHaveValue('');
    await waitFor(() => expect(mocks.marcarLeido).toHaveBeenCalledWith(CANAL.id, 3));
  });

  it('el separador de día y la hora de cada mensaje usan el formato del contrato (N23)', async () => {
    render(<ConversacionChat canal={CANAL} usuarioId="yo" />);
    await screen.findByText('Datos cargados');
    // 2026-09-07T12:01Z es el 07-09-2026 a las 09:01 en Chile (UTC-3, horario de verano): ni nombre de mes ni hora de 12 horas.
    expect(screen.getByText('07-09-2026')).toBeInTheDocument();
    expect(screen.getByText('09:01')).toBeInTheDocument();
    expect(screen.queryByText(/septiembre/i)).not.toBeInTheDocument();
  });

  it('incorpora mensajes entrantes sin duplicar los ya confirmados', async () => {
    let recibir: ((mensajes: MensajeChat[]) => void) | undefined;
    mocks.observarCanal.mockImplementationOnce(async (_canalId, opciones) => {
      recibir = opciones.onMensajes;
      opciones.onEstado('conectado');
      return { cerrar: vi.fn(), resincronizar: vi.fn() };
    });
    render(<ConversacionChat canal={CANAL} usuarioId="yo" />);
    await screen.findByText('Datos cargados');

    recibir?.([
      mensaje('m2', 2, 'yo', 'Datos cargados'),
      mensaje('m3', 3, 'otra', 'Riego verificado'),
    ]);

    expect(await screen.findByText('Riego verificado')).toBeInTheDocument();
    expect(screen.getAllByText('Datos cargados')).toHaveLength(1);
    await waitFor(() => expect(mocks.marcarLeido).toHaveBeenCalledWith(CANAL.id, 3));
  });

  it('mantiene los canales archivados disponibles como historial de solo lectura', async () => {
    render(<ConversacionChat canal={{ ...CANAL, archivado: true }} usuarioId="yo" />);
    await screen.findByText('Datos cargados');

    expect(screen.getByText(/se conserva como historial/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Mensaje')).not.toBeInTheDocument();
    expect(screen.getByText('Archivado')).toBeInTheDocument();
    expect(mocks.observarCanal).not.toHaveBeenCalled();
  });

  it('envía una mención elegida como referencia estructurada', async () => {
    render(<ConversacionChat canal={CANAL} usuarioId="yo" esAdmin />);
    await screen.findByText('Datos cargados');

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: '@Caro' } });
    fireEvent.click(await screen.findByRole('button', { name: /Carolina Flores/ }));
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: '@Carolina Flores revisa el bloque' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));

    await waitFor(() => expect(mocks.enviarMensaje).toHaveBeenCalledOnce());
    expect(mocks.enviarMensaje.mock.calls[0][0]).toMatchObject({
      mencionados: ['otra'],
      mencionarTodos: false,
    });
  });

  it('muestra ayuda según el rol y bloquea /clear al operario', async () => {
    render(<ConversacionChat canal={CANAL} usuarioId="yo" />);
    await screen.findByText('Datos cargados');

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: '/ayuda' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByText(/muestra esta guía/i)).toBeInTheDocument();
    expect(screen.queryByText(/oculta el historial visible/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: '/clear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('solo para administradores');
    expect(mocks.limpiarCanal).not.toHaveBeenCalled();
  });

  it('exige confirmación explícita antes de ejecutar /clear como admin', async () => {
    render(<ConversacionChat canal={CANAL} usuarioId="yo" esAdmin />);
    await screen.findByText('Datos cargados');

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: '/clear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByRole('dialog', { name: 'Confirmar /clear' })).toBeInTheDocument();
    expect(mocks.limpiarCanal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar /clear' }));
    await waitFor(() => expect(mocks.limpiarCanal).toHaveBeenCalledWith(CANAL.id));
    expect(screen.queryByText('Datos cargados')).not.toBeInTheDocument();
  });

  it('carga y resalta el contexto de un mensaje abierto desde notificaciones', async () => {
    const objetivo = mensaje('m1', 1, 'otra', 'Revisión de campo terminada');
    mocks.listarContextoMensaje.mockResolvedValueOnce([objetivo, mensaje('m2', 2, 'yo', 'Datos cargados')]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });

    render(<ConversacionChat canal={CANAL} usuarioId="yo" mensajeInicialId="m1" />);

    expect(await screen.findByText('Revisión de campo terminada')).toBeInTheDocument();
    expect(mocks.listarContextoMensaje).toHaveBeenCalledWith(CANAL.id, 'm1');
    expect(document.getElementById('mensaje-chat-m1')?.firstElementChild).toHaveClass('ring-2', 'ring-brand');
    await waitFor(() => expect(mocks.marcarLeido).toHaveBeenCalledWith(CANAL.id, 1));
  });

  it('mantiene el compositor visible si un envío falla en un canal vacío', async () => {
    mocks.listarMensajes.mockResolvedValueOnce([]);
    mocks.enviarMensaje.mockRejectedValueOnce(new Error('Solo un administrador puede usar @all en General.'));
    render(<ConversacionChat canal={{ ...CANAL, ultima_posicion: 0, no_leidos: 0 }} usuarioId="yo" />);
    await screen.findByText('Aún no hay mensajes');

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: '@all intento operario' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Solo un administrador');
    expect(screen.getByLabelText('Mensaje')).toHaveValue('@all intento operario');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });
});
