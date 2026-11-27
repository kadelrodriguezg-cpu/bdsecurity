import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EveclDescriptor, EveclFicha } from '@/api/evecl';
import { Sheet } from '@/components/ui/sheet';
import { fechaEvaluacionNoEsFutura, FichaForm } from './FichaForm';
import { guardarFichaEvecl, obtenerUrlFirmadaFotoEvecl } from '@/api/evecl';

vi.mock('@/api/evecl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/evecl')>();
  return {
    ...actual,
    guardarFichaEvecl: vi.fn(),
    obtenerUrlFirmadaFotoEvecl: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const CATALOGO: EveclDescriptor[] = [
  { id: 1, codigo_upov: 1, nombre: 'Vigor', tipo: 'estado', eje: 'adaptabilidad', unidad: null, nota_especial: null, rankeable: false, direccion_ranking: null, orden: 1, estados: [{ nota: 3, label: 'Débil', orden: 1 }, { nota: 5, label: 'Medio', orden: 2 }, { nota: 7, label: 'Fuerte', orden: 3 }] },
  { id: 2, codigo_upov: 29, nombre: 'Dulzor', tipo: 'valor', eje: 'calidad', unidad: '°Brix', nota_especial: null, rankeable: true, direccion_ranking: 'mayor', orden: 2, estados: [] },
];

function FormularioEnSheet({ alCerrar }: { alCerrar: () => void }) {
  const [tocado, setTocado] = useState(false);
  return (
    <Sheet titulo="Nueva ficha" hayContenido={tocado} onCerrar={alCerrar} size="evaluacion">
      <span data-testid="estado-tocado">{String(tocado)}</span>
      <FichaForm ensayoId={3} catalogo={CATALOGO} alTocadoChange={setTocado} alCancelar={alCerrar} alGuardado={vi.fn()} />
    </Sheet>
  );
}

describe('FichaForm EVECL', () => {
  const fichaServidor: EveclFicha = {
    id: 41, ensayo_id: 3, variedad: 'Sintética', codigo_genotipo: null,
    origen_cruza: 'Origen sintético servidor', tipo: 'evaluacion', numero_repeticion: 1,
    codigo_planta: null, encargado: null, fecha_siembra: null, fecha_evaluacion: '2020-01-01',
    notas: null, created_by: 'usuario-prueba', created_at: '2020-01-01', updated_at: '2020-01-01',
    ensayo: { id: 3, codigo_parcela: 'Sintética', nombre_productor: null, empresa: null, localidad: null }, respuestas: [],
  };
  function renderPrivacidad(ficha?: EveclFicha) {
    const cliente = new QueryClient();
    render(<QueryClientProvider client={cliente}><FichaForm ensayoId={3} ficha={ficha} catalogo={CATALOGO} alCancelar={vi.fn()} alGuardado={vi.fn()} /></QueryClientProvider>);
  }
  it('muestra respuesta retirada y foto en solo lectura, sin enviarla como editable al guardar', async () => {
    vi.mocked(guardarFichaEvecl).mockClear();
    vi.mocked(guardarFichaEvecl).mockResolvedValueOnce(41);
    vi.mocked(obtenerUrlFirmadaFotoEvecl).mockResolvedValue('/foto-retirada-local.jpg');
    const retirada: EveclFicha = { ...fichaServidor, respuestas: [{
      // El catálogo aún contiene Dulzor: simula un catálogo cacheado antes de retirarlo.
      descriptor_id: 2, nota: null, valor_numerico: 12, valor_texto: null,
      foto_path: 'evecl/3/41/99.jpg', fecha_observada: '2020-01-01',
      descriptor: { nombre: 'Histórico', tipo: 'valor', eje: 'calidad', unidad: 'g', orden: 9, activo: false },
    }] };
    renderPrivacidad(retirada);
    const historico = screen.getByRole('region', { name: 'Descriptores retirados' });
    expect(within(historico).getByText('Histórico (descriptor retirado)')).toBeInTheDocument();
    expect(within(historico).getByText('12 g')).toBeInTheDocument();
    expect(await within(historico).findByRole('img', { name: 'Foto del descriptor' })).toBeInTheDocument();
    expect(historico.querySelector('input, button, select, textarea')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ficha' }));
    await waitFor(() => expect(guardarFichaEvecl).toHaveBeenCalledWith(
      expect.objectContaining({ respuestas: [] }), [], new Map(),
    ));
  });
  async function borradorPersistido(clave: string) {
    await waitFor(() => expect(localStorage.getItem(clave)).toBeTruthy(), { timeout: 2200 });
    return JSON.parse(JSON.parse(localStorage.getItem(clave)!).valor.contenido);
  }

  it('editar origen no lo serializa y guardar conserva el origen actual en la API', async () => {
    vi.mocked(guardarFichaEvecl).mockClear();
    vi.mocked(guardarFichaEvecl).mockResolvedValueOnce(42);
    renderPrivacidad();
    fireEvent.change(screen.getByLabelText('Origen de cruza'), { target: { value: 'Origen sintético editado' } });
    const local = await borradorPersistido('borrador:usuario:usuario-prueba:evecl:ficha:nueva-3');
    expect(local).not.toHaveProperty('origen_cruza');
    expect(JSON.stringify(local)).not.toContain('Origen sintético editado');
    fireEvent.change(screen.getByLabelText('Variedad *'), { target: { value: 'Sintética' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar ficha/i }));
    await waitFor(() => expect(guardarFichaEvecl).toHaveBeenCalledWith(expect.objectContaining({ origen_cruza: 'Origen sintético editado' }), [], expect.any(Map)));
  });

  it('editar otro campo no copia el origen del servidor al borrador', async () => {
    renderPrivacidad(fichaServidor);
    expect(screen.getByLabelText('Origen de cruza')).toHaveValue('Origen sintético servidor');
    fireEvent.change(screen.getByLabelText('Variedad *'), { target: { value: 'Otra sintética' } });
    const local = await borradorPersistido('borrador:usuario:usuario-prueba:evecl:ficha:41');
    expect(local.variedad).toBe('Otra sintética');
    expect(local).not.toHaveProperty('origen_cruza');
    expect(JSON.stringify(local)).not.toContain('Origen sintético servidor');
  });

  it.each([false, true])('un borrador anterior no restaura origen y conserva respaldo servidor/nueva (%s)', (existente) => {
    const clave = `borrador:usuario:usuario-prueba:evecl:ficha:${existente ? '41' : 'nueva-3'}`;
    const anterior = JSON.stringify({ guardadoEn: Date.now(), valor: { contenido: JSON.stringify({ variedad: 'Variedad recuperada', origen_cruza: 'Origen sintético anterior' }) } });
    localStorage.setItem(clave, anterior);
    renderPrivacidad(existente ? fichaServidor : undefined);
    expect(screen.getByLabelText('Variedad *')).toHaveValue('Variedad recuperada');
    expect(screen.getByLabelText('Origen de cruza')).toHaveValue(existente ? 'Origen sintético servidor' : '');
    // No se limpia ni reescribe el almacenamiento anterior al montar.
    expect(localStorage.getItem(clave)).toBe(anterior);
  });

  it('asocia errores, enfoca el primero y retira la asociación al corregir sin guardar datos inválidos', async () => {
    vi.mocked(guardarFichaEvecl).mockClear();
    const cliente = new QueryClient();
    render(<QueryClientProvider client={cliente}><FichaForm ensayoId={3} catalogo={CATALOGO} alCancelar={vi.fn()} alGuardado={vi.fn()} /></QueryClientProvider>);
    const variedad = screen.getByLabelText('Variedad *');
    const guardar = screen.getByRole('button', { name: /guardar ficha/i });
    fireEvent.click(guardar);
    await waitFor(() => expect(variedad).toHaveFocus());
    expect(variedad).toHaveAccessibleDescription('Ingresa la variedad.');
    expect(variedad).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(variedad, { target: { value: 'Prueba' } });
    await waitFor(() => expect(variedad).not.toHaveAttribute('aria-invalid'));
    const repeticion = screen.getByLabelText('Repetición *');
    fireEvent.change(repeticion, { target: { value: '0' } });
    fireEvent.click(guardar);
    await waitFor(() => expect(repeticion).toHaveFocus());
    expect(repeticion).toHaveAccessibleDescription('La repetición debe ser un entero entre 1 y 20.');
    fireEvent.change(repeticion, { target: { value: '1' } });
    const fecha = screen.getByLabelText('Fecha de evaluación *');
    fireEvent.change(fecha, { target: { value: '2099-01-01' } });
    fireEvent.click(guardar);
    await waitFor(() => expect(fecha).toHaveFocus());
    expect(fecha).toHaveAccessibleDescription('La fecha de evaluación no puede ser futura.');
    fireEvent.change(fecha, { target: { value: '2020-01-01' } });
    const descriptor = screen.getByLabelText('Dulzor');
    fireEvent.change(descriptor, { target: { value: '-1' } });
    fireEvent.click(guardar);
    await waitFor(() => expect(descriptor).toHaveFocus());
    expect(descriptor).toHaveAccessibleDescription('Ingresa un número mayor o igual a cero.');
    expect(guardarFichaEvecl).not.toHaveBeenCalled();
    fireEvent.change(descriptor, { target: { value: '0' } });
    await waitFor(() => expect(descriptor).not.toHaveAttribute('aria-invalid'));
    expect(descriptor).not.toHaveAttribute('aria-describedby');
  });
  it('renueva la suscripción del borrador cuando cambia la clave del ensayo', async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const vista = (ensayoId: number) => <QueryClientProvider client={cliente}><FichaForm ensayoId={ensayoId} catalogo={CATALOGO} alCancelar={vi.fn()} alGuardado={vi.fn()} /></QueryClientProvider>;
    const { rerender } = render(vista(3));
    rerender(vista(4));
    fireEvent.change(screen.getByLabelText('Variedad *'), { target: { value: 'Variedad ensayo B' } });
    await waitFor(() => expect(localStorage.getItem('borrador:usuario:usuario-prueba:evecl:ficha:nueva-4')).toBeTruthy(), { timeout: 2200 });
    const envelope = JSON.parse(localStorage.getItem('borrador:usuario:usuario-prueba:evecl:ficha:nueva-4')!);
    expect(JSON.parse(envelope.valor.contenido).variedad).toBe('Variedad ensayo B');
    expect(localStorage.getItem('borrador:usuario:usuario-prueba:evecl:ficha:nueva-3')).toBeNull();
  });

  it('evalúa el límite de fecha al validar aunque la sesión cruce medianoche chilena', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-07-17T03:59:00.000Z')); // 23:59 en Chile
      expect(fechaEvaluacionNoEsFutura('2026-07-17')).toBe(false);

      vi.setSystemTime(new Date('2026-07-17T04:01:00.000Z')); // 00:01 en Chile
      expect(fechaEvaluacionNoEsFutura('2026-07-17')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mantiene el layout móvil/escritorio y protege Escape cuando hay cambios', async () => {
    const alCerrar = vi.fn();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={cliente}><FormularioEnSheet alCerrar={alCerrar} /></QueryClientProvider>);

    expect([...document.querySelectorAll('div')].some((elemento) => elemento.classList.contains('min-[900px]:grid-cols-[280px_minmax(0,1fr)]'))).toBe(true);
    expect(screen.getByText('0/2 descriptores con dato · se permite guardar parcialmente')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Variedad *'), { target: { value: 'Legacy' } });
    await waitFor(() => expect(screen.getByTestId('estado-tocado')).toHaveTextContent('true'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirmar).toHaveBeenCalled();
    expect(alCerrar).not.toHaveBeenCalled();
  });
});

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ generacionSesion: 0, capturarVigenciaSesion: () => () => true, user: { id: 'usuario-prueba' } }) }));

it('RHF conserva edición en misma identidad y reinicia metadata al cambiar ensayo', () => {
  const qc = new QueryClient({defaultOptions:{queries:{retry:false}}});
  const vista = (ensayoId: number) => <QueryClientProvider client={qc}><FichaForm ensayoId={ensayoId} catalogo={[...CATALOGO]} alCancelar={vi.fn()} alGuardado={vi.fn()}/></QueryClientProvider>;
  const {rerender} = render(vista(3));
  const variedad = screen.getByLabelText('Variedad *');
  fireEvent.change(variedad,{target:{value:'Edición A'}});
  rerender(vista(3));
  expect(screen.getByLabelText('Variedad *')).toBe(variedad);
  expect(variedad).toHaveValue('Edición A');
  rerender(vista(4));
  expect(screen.getByLabelText('Variedad *')).not.toBe(variedad);
  expect(screen.getByLabelText('Variedad *')).toHaveValue('');
});
