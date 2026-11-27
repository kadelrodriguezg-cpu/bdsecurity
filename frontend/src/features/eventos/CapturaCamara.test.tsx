/**
 * Tests de la máquina de estados de CapturaCamara, con getUserMedia y
 * MediaRecorder simulados (jsdom no tiene cámara real). Sirven para iterar
 * rápido sobre la lógica sin depender del celular en cada ajuste — la
 * calidad real de imagen/encuadre igual necesita el dispositivo real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CapturaCamara } from './CapturaCamara';

function crearStreamFalso() {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track], _track: track } as unknown as MediaStream & { _track: typeof track };
}

class GrabadorFalso {
  static isTypeSupported = vi.fn(() => true);
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: MediaStream, public options?: MediaRecorderOptions) {}
  start = vi.fn();
  stop = vi.fn(() => {
    this.ondataavailable?.({ data: new Blob(['video-fake'], { type: 'video/webm' }) });
    this.onstop?.();
  });
}

let getUserMediaMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMediaMock = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: getUserMediaMock },
    writable: true,
    configurable: true,
  });
  vi.stubGlobal('MediaRecorder', GrabadorFalso);

  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() }) as never;
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (this: HTMLCanvasElement, cb: BlobCallback) {
    cb(new Blob(['foto-fake'], { type: 'image/jpeg' }));
  }) as never;

  // jsdom no implementa reproducción real de video; se simula para que el
  // .play() del componente no rompa el test (y para poder verificar que
  // efectivamente se llama).
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);

  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock-url'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CapturaCamara — foto', () => {
  it('captura, revisa y confirma una foto', async () => {
    const stream = crearStreamFalso();
    getUserMediaMock.mockResolvedValue(stream);
    const onCapturado = vi.fn();

    render(<CapturaCamara modo="foto" onCapturado={onCapturado} onUsarSelectorArchivo={vi.fn()} onCancelar={vi.fn()} />);

    const botonCapturar = await screen.findByRole('button', { name: /capturar foto/i });

    // Cierra el gap que dejamos pasar: el visor tiene que quedar realmente
    // conectado al stream (y reproduciéndose), no solo llegar a fase
    // 'en_vivo' con la pantalla en negro.
    const visor = screen.getByTestId('visor-camara') as HTMLVideoElement;
    await waitFor(() => {
      expect(visor.srcObject).toBe(stream);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });

    fireEvent.click(botonCapturar);

    const botonUsar = await screen.findByRole('button', { name: /usar esta foto/i });
    fireEvent.click(botonUsar);

    expect(onCapturado).toHaveBeenCalledTimes(1);
    const archivo = onCapturado.mock.calls[0][0] as File;
    expect(archivo.name).toMatch(/^foto-\d+\.jpg$/);
    expect(archivo.type).toBe('image/jpeg');
    // el stream se corta al confirmar
    expect((stream as unknown as { _track: { stop: () => void } })._track.stop).toHaveBeenCalled();
  });

  it('"Repetir" descarta la vista previa y vuelve al visor en vivo sin llamar onCapturado', async () => {
    getUserMediaMock.mockResolvedValue(crearStreamFalso());
    const onCapturado = vi.fn();

    render(<CapturaCamara modo="foto" onCapturado={onCapturado} onUsarSelectorArchivo={vi.fn()} onCancelar={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /capturar foto/i }));
    fireEvent.click(await screen.findByRole('button', { name: /repetir/i }));

    expect(await screen.findByRole('button', { name: /capturar foto/i })).toBeInTheDocument();
    expect(onCapturado).not.toHaveBeenCalled();
  });

  it('cancelar corta el stream y llama onCancelar', async () => {
    const stream = crearStreamFalso();
    getUserMediaMock.mockResolvedValue(stream);
    const onCancelar = vi.fn();

    render(<CapturaCamara modo="foto" onCapturado={vi.fn()} onUsarSelectorArchivo={vi.fn()} onCancelar={onCancelar} />);

    // Esperamos a que se asiente en "en_vivo" antes de cancelar, para no
    // clickear un botón "Cancelar" que quedó desmontado a mitad de la
    // transición de fase (mismo texto aparece en pidiendo_permiso y en_vivo).
    await screen.findByRole('button', { name: /capturar foto/i });
    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect((stream as unknown as { _track: { stop: () => void } })._track.stop).toHaveBeenCalled();
  });
});

describe('CapturaCamara — video', () => {
  it('graba, muestra el cronómetro, detiene y confirma un video', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stream = crearStreamFalso();
    getUserMediaMock.mockResolvedValue(stream);
    const onCapturado = vi.fn();

    render(<CapturaCamara modo="video" onCapturado={onCapturado} onUsarSelectorArchivo={vi.fn()} onCancelar={vi.fn()} />);

    const botonGrabar = await screen.findByRole('button', { name: /^grabar$/i });

    const visor = screen.getByTestId('visor-camara') as HTMLVideoElement;
    expect(visor.srcObject).toBe(stream);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    fireEvent.click(botonGrabar);

    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText(/Grabando… 00:02/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /detener/i }));

    const botonUsar = await screen.findByRole('button', { name: /usar este video/i });
    fireEvent.click(botonUsar);

    expect(onCapturado).toHaveBeenCalledTimes(1);
    const archivo = onCapturado.mock.calls[0][0] as File;
    expect(archivo.name).toMatch(/^video-\d+\.webm$/);
  });
});

describe('CapturaCamara — errores', () => {
  it('permiso denegado: ofrece el selector de archivo, sin botón de reintentar', async () => {
    getUserMediaMock.mockRejectedValue(new DOMException('sin permiso', 'NotAllowedError'));
    const onUsarSelectorArchivo = vi.fn();

    render(<CapturaCamara modo="foto" onCapturado={vi.fn()} onUsarSelectorArchivo={onUsarSelectorArchivo} onCancelar={vi.fn()} />);

    expect(await screen.findByText(/no diste permiso de cámara/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /elegir archivo existente/i }));
    expect(onUsarSelectorArchivo).toHaveBeenCalledTimes(1);
  });

  it('sin cámara disponible: mensaje específico', async () => {
    getUserMediaMock.mockRejectedValue(new DOMException('sin cámara', 'NotFoundError'));

    render(<CapturaCamara modo="foto" onCapturado={vi.fn()} onUsarSelectorArchivo={vi.fn()} onCancelar={vi.fn()} />);

    expect(await screen.findByText(/no se encontró una cámara/i)).toBeInTheDocument();
  });

  it('cámara ocupada: ofrece reintentar, y reintentar vuelve a pedir la cámara', async () => {
    getUserMediaMock.mockRejectedValueOnce(new DOMException('ocupada', 'NotReadableError'));
    getUserMediaMock.mockResolvedValueOnce(crearStreamFalso());

    render(<CapturaCamara modo="foto" onCapturado={vi.fn()} onUsarSelectorArchivo={vi.fn()} onCancelar={vi.fn()} />);

    expect(await screen.findByText(/la cámara está siendo usada por otra app/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByRole('button', { name: /capturar foto/i })).toBeInTheDocument();
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
  });

  it('resolución no soportada: reintenta una vez con constraints simples antes de fallar', async () => {
    getUserMediaMock
      .mockRejectedValueOnce(new DOMException('overconstrained', 'OverconstrainedError'))
      .mockResolvedValueOnce(crearStreamFalso());

    render(<CapturaCamara modo="foto" onCapturado={vi.fn()} onUsarSelectorArchivo={vi.fn()} onCancelar={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /capturar foto/i })).toBeInTheDocument();
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
  });
});
