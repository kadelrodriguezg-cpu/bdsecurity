/**
 * Regresión del bug Calibre/Brix (ver sheet.test.tsx para el detalle de
 * causa raíz del robo de foco). Ese test usa un arnés con un <input>
 * genérico; este cubre el caso real end-to-end — Sheet + EvaluacionForm +
 * CampoNumerico juntos, tecleando carácter a carácter — para no depender
 * solo del arnés simplificado.
 *
 * Hubo un SEGUNDO bug real, distinto del de foco: el input interno de
 * CampoNumerico se renderizaba visualmente colapsado a ~43px (container de
 * 100px, celda de un grid `sm:grid-cols-4`, competía por espacio con el
 * span de rango "14–24" que no se achica). El valor se aceptaba igual
 * (por eso los tests de arriba pasaban en verde) pero era ilegible al
 * escribir. jsdom no tiene motor de layout real — no puede medir
 * getBoundingClientRect() de forma significativa — así que no puede
 * verificar el ancho renderizado directamente. Los tests de abajo son un
 * proxy: chequean que las clases responsables del fix (flex-1/min-w-0 en
 * el input, flex-shrink-0 en el span, y el grid a como mucho 3 columnas)
 * sigan presentes. La medición real en navegador (82px de input en vez de
 * 43px, confirmada con captura) queda documentada en la conversación, no
 * en este archivo — para eso hace falta un navegador real, no jsdom.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sheet } from '@/components/ui/sheet';
import { EvaluacionForm } from './EvaluacionForm';
import type { EvaluacionRow } from '@/api/rondas';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const { crearEvaluacionMock, actualizarEvaluacionMock, buscarBorradorDeRondaMock, sesionPrueba } = vi.hoisted(() => ({
  sesionPrueba: { version: 0, esAdmin: false },
  crearEvaluacionMock: vi.fn(async () => ({ id: 'e1' })),
  actualizarEvaluacionMock: vi.fn(async () => ({ id: 'e1' })),
  // null por defecto: sin borrador previo, el gate de "continuar/descartar"
  // (Sprint 9) no debe interponerse en estos tests, que ya cubren el
  // formulario en blanco.
  buscarBorradorDeRondaMock: vi.fn(async (): Promise<EvaluacionRow | null> => null),
}));

vi.mock('@/api/rondas', () => ({
  crearEvaluacion: crearEvaluacionMock,
  actualizarEvaluacion: actualizarEvaluacionMock,
  buscarBorradorDeRonda: buscarBorradorDeRondaMock,
  obtenerReferenciasEvaluacion: vi.fn(async () => ({
    calibre_mm: {
      id: 'calibre-ref', metrica: 'calibre_mm', especie_id: null, fase: 'evaluacion_anual',
      minimo_esperado: 14, maximo_esperado: 24, limite_revision_inferior: null,
      limite_revision_superior: 40, vigente_desde: '2026-01-01', vigente_hasta: null,
      activo: true, nota: 'Rango heredado del comportamiento anterior del sistema — pendiente de confirmación científica por Efraín',
      created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    brix: {
      id: 'brix-ref', metrica: 'brix', especie_id: null, fase: 'evaluacion_anual',
      minimo_esperado: 10, maximo_esperado: 18, limite_revision_inferior: null,
      limite_revision_superior: null, vigente_desde: '2026-01-01', vigente_hasta: null,
      activo: true, nota: 'Rango heredado del comportamiento anterior del sistema — pendiente de confirmación científica por Efraín',
      created_at: '2026-01-01', updated_at: '2026-01-01',
    },
  })),
}));

function renderSheetConForm() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <Sheet titulo="Nueva evaluación" onCerrar={() => {}}>
        <EvaluacionForm rondaId="r1" plantaId="p1" />
      </Sheet>
    </QueryClientProvider>,
  );
  return qc;
}

function escribir(input: HTMLInputElement, texto: string) {
  input.focus();
  let acumulado = '';
  for (const char of texto) {
    acumulado += char;
    fireEvent.change(input, { target: { value: acumulado } });
  }
}

describe('EvaluacionForm sin conexión (U-04)', () => {
  it('muestra «Sin conexión», ofrece Reintentar y el reintento usa la misma clave de idempotencia', async () => {
    const { ErrorApi } = await import('@/api/client');
    crearEvaluacionMock.mockClear();
    crearEvaluacionMock
      .mockRejectedValueOnce(new ErrorApi('Sin conexión: tu evaluación sigue aquí.', 'red'))
      .mockResolvedValueOnce({ id: 'e1' });
    renderSheetConForm();
    const cantidad = await screen.findByLabelText('Cantidad de frutos');
    fireEvent.change(cantidad, { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Peso total (g)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));

    expect(await screen.findByText('Sin conexión: tu evaluación sigue aquí.')).toBeInTheDocument();
    expect(screen.queryByText(/sesión expiró/)).not.toBeInTheDocument();
    expect(cantidad).toHaveValue(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledTimes(2));
    const [, claveIntento1] = crearEvaluacionMock.mock.calls[0] as unknown as [unknown, string];
    const [, claveIntento2] = crearEvaluacionMock.mock.calls[1] as unknown as [unknown, string];
    expect(claveIntento2).toBe(claveIntento1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument());
  });

  it('con el teléfono sin conexión el guardado queda en pausa, lo avisa y se envía una sola vez al volver la red', async () => {
    const { onlineManager } = await import('@tanstack/react-query');
    crearEvaluacionMock.mockClear();
    crearEvaluacionMock.mockResolvedValue({ id: 'e1' });
    onlineManager.setOnline(false);
    try {
      renderSheetConForm();
      const cantidad = await screen.findByLabelText('Cantidad de frutos');
      fireEvent.change(cantidad, { target: { value: '0' } });
      fireEvent.change(screen.getByLabelText('Peso total (g)'), { target: { value: '0' } });
      fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
      expect(await screen.findByText(/Sin conexión: tu evaluación sigue aquí. Se enviará sola/)).toBeInTheDocument();
      expect(crearEvaluacionMock).not.toHaveBeenCalled();
      act(() => onlineManager.setOnline(true));
      await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByText(/Se enviará sola/)).not.toBeInTheDocument());
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('un error que no es de red no ofrece Reintentar', async () => {
    crearEvaluacionMock.mockClear();
    crearEvaluacionMock.mockRejectedValueOnce(new Error('Esta ronda ya tiene un borrador abierto.'));
    renderSheetConForm();
    const cantidad = await screen.findByLabelText('Cantidad de frutos');
    fireEvent.change(cantidad, { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Peso total (g)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    expect(await screen.findByText('Esta ronda ya tiene un borrador abierto.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });
});

describe('EvaluacionForm dentro de Sheet real — Calibre/Brix aceptan tecleo', () => {
  it('conserva el orden de validación y exige muestra positiva solamente al finalizar', async () => {
    crearEvaluacionMock.mockClear();
    actualizarEvaluacionMock.mockClear();
    renderSheetConForm();
    const cantidad = await screen.findByLabelText('Cantidad de frutos');
    const peso = screen.getByLabelText('Peso total (g)');
    const produccion = screen.getByLabelText('Rendimiento (kg/planta)');
    const finalizar = screen.getByRole('button', { name: /finalizar evaluación/i });
    fireEvent.change(produccion, { target: { value: '-1' } });
    fireEvent.change(cantidad, { target: { value: '-1' } });
    fireEvent.click(finalizar);
    expect(produccion).toHaveFocus();
    expect(produccion).toHaveAttribute('aria-invalid', 'true');
    expect(cantidad).toHaveAttribute('aria-invalid', 'true'); // U-08: cada valor inválido se marca en su campo, no solo el primero
    fireEvent.change(produccion, { target: { value: '0' } });
    fireEvent.change(cantidad, { target: { value: '0' } });
    fireEvent.change(peso, { target: { value: '0' } });
    for (const grupo of screen.getAllByRole('group').filter((elemento) => elemento.getAttribute('role') === 'group')) {
      // La distribución de flores y frutos tiene 3 niveles con texto (no «3»): se elige «Hasta la mitad» (nivel 2).
      // La precocidad anuncia cada número con su mes de cosecha: «3 · Media (dic)».
      const boton = within(grupo).queryByRole('button', { name: 'Hasta la mitad' }) ?? within(grupo).getByRole('button', { name: /^3( · .+)?$/ });
      fireEvent.click(boton);
    }
    fireEvent.change(screen.getByPlaceholderText('14–24'), { target: { value: '18' } });
    fireEvent.change(screen.getByPlaceholderText('10–18'), { target: { value: '12' } });
    expect(screen.queryByLabelText('Rendimiento (t/ha)')).not.toBeInTheDocument(); // desactivado (EF11): ya no se pide
    expect(screen.queryByRole('spinbutton', { name: /Fruta exportable/ })).not.toBeInTheDocument(); // calculado con la poscosecha: ya no se escribe
    fireEvent.change(screen.getByRole('spinbutton', { name: /A los 45 días/ }), { target: { value: '0' } });
    fireEvent.click(finalizar);
    expect(cantidad).toHaveFocus();
    expect(cantidad).toHaveAccessibleDescription('Hay datos de fruta o de muestra: la cantidad de frutos debe ser mayor que cero para finalizar. Si no se tomó muestra, marca «Sin muestra de frutos».');
    fireEvent.change(cantidad, { target: { value: '1' } });
    expect(cantidad).not.toHaveAttribute('aria-invalid');
    fireEvent.click(finalizar);
    expect(peso).toHaveFocus();
    expect(peso).toHaveAccessibleDescription('Hay datos de fruta o de muestra: el peso total debe ser mayor que cero para finalizar. Si no se tomó muestra, marca «Sin muestra de frutos».');
    expect(crearEvaluacionMock).not.toHaveBeenCalled();
    expect(actualizarEvaluacionMock).not.toHaveBeenCalled();
    fireEvent.change(peso, { target: { value: '1' } });
    fireEvent.click(finalizar);
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledWith(expect.objectContaining({ estado: 'completa', cantidad_frutos: 1, peso_total_g: 1, rend_kg_planta: 0, distribucion_flores_frutos: 2 }), expect.any(String)));
    expect((crearEvaluacionMock.mock.calls[0] as unknown as [Record<string, unknown>])[0]).not.toHaveProperty('rend_t_ha');
  });

  it('asocia el error técnico de muestra tras intentar, enfoca y corrige; cero sigue válido en borrador', async () => {
    crearEvaluacionMock.mockClear();
    actualizarEvaluacionMock.mockClear();
    renderSheetConForm();
    const cantidad = await screen.findByLabelText('Cantidad de frutos');
    expect(cantidad).not.toHaveAttribute('aria-invalid');
    fireEvent.change(cantidad, { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    expect(cantidad).toHaveFocus();
    expect(cantidad).toHaveAttribute('aria-invalid', 'true');
    expect(cantidad).toHaveAccessibleDescription(/Cantidad de frutos/);
    expect(crearEvaluacionMock).not.toHaveBeenCalled();
    expect(actualizarEvaluacionMock).not.toHaveBeenCalled();
    fireEvent.change(cantidad, { target: { value: '0' } });
    expect(cantidad).not.toHaveAttribute('aria-invalid');
    expect(cantidad).not.toHaveAttribute('aria-describedby');
    fireEvent.change(screen.getByLabelText('Peso total (g)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledWith(expect.objectContaining({ estado: 'borrador', cantidad_frutos: 0, peso_total_g: 0 }), expect.any(String)));
  });

  it('enfoca el resumen cuando el campo con error no tiene id enfocable, sin marcar otros controles como inválidos', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    const calibre = await screen.findByPlaceholderText('14–24') as HTMLInputElement;
    fireEvent.change(calibre, { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    expect(document.getElementById('evaluacion-error-validacion')).toHaveFocus();
    expect(screen.getByLabelText('Cantidad de frutos')).not.toHaveAttribute('aria-invalid');
    expect(crearEvaluacionMock).not.toHaveBeenCalled();
  });

  it('Calibre retiene "18" tras escribir carácter a carácter', async () => {
    renderSheetConForm();
    const calibre = await screen.findByPlaceholderText('14–24') as HTMLInputElement;
    escribir(calibre, '18');
    expect(calibre.value).toBe('18');
    expect(document.activeElement).toBe(calibre);
  });

  it('Brix retiene "14" tras escribir carácter a carácter', async () => {
    renderSheetConForm();
    const brix = await screen.findByPlaceholderText('10–18') as HTMLInputElement;
    escribir(brix, '14');
    expect(brix.value).toBe('14');
    expect(document.activeElement).toBe(brix);
  });

  it('control: Rendimiento (kg/planta), un Input genérico, retiene "5"', async () => {
    renderSheetConForm();
    const rend = await screen.findByLabelText(/Rendimiento \(kg\/planta\)/i) as HTMLInputElement;
    escribir(rend, '5');
    expect(rend.value).toBe('5');
  });

  it('Calibre no vuelve a colapsar visualmente: el input reparte espacio con flex-1/min-w-0 y el badge de rango no se lo come (flex-shrink-0)', async () => {
    renderSheetConForm();
    const calibre = await screen.findByPlaceholderText('14–24') as HTMLInputElement;
    expect(calibre.className).toContain('flex-1');
    expect(calibre.className).toContain('min-w-0');
    expect(calibre.className).not.toContain('w-full');

    const badge = calibre.nextElementSibling as HTMLElement;
    expect(badge.textContent).toBe('14–24');
    expect(badge.className).toContain('flex-shrink-0');
  });

  it('la fila "Fruto / Calidad" no vuelve a apretarse a 4 columnas (la celda de 100px fue la causa real del colapso)', async () => {
    renderSheetConForm();
    const calibre = await screen.findByPlaceholderText('14–24') as HTMLInputElement;
    const grid = calibre.closest('.grid') as HTMLElement;
    expect(grid.className).not.toMatch(/sm:grid-cols-4\b/);
  });

  it('muestra progreso e índice de secciones dentro del encabezado persistente', async () => {
    renderSheetConForm();
    const progreso = await screen.findByRole('progressbar', { name: /completitud de la evaluación/i });
    expect(progreso).toHaveAttribute('aria-valuenow', '0');
    expect(progreso).toHaveAttribute('aria-valuemax', '29');
    expect(screen.getByRole('navigation', { name: /secciones de la evaluación/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fenología' })).toHaveAttribute('href', '#evaluacion-fenologia');
    expect(screen.getByRole('link', { name: 'Brotes y varas' })).toHaveAttribute('href', '#evaluacion-brotes');
  });

  it('invalida scoring, dashboard y series al guardar para refrescar todas las vistas dependientes', async () => {
    const qc = renderSheetConForm();
    const invalidar = vi.spyOn(qc, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: /guardar borrador/i }));

    await waitFor(() => {
      expect(invalidar).toHaveBeenCalledWith({ queryKey: ['scoring', 'p1'] });
      expect(invalidar).toHaveBeenCalledWith({ queryKey: ['dashboard-cientifico'] });
      expect(invalidar).toHaveBeenCalledWith({ queryKey: ['visualizacion', 'series'] });
    });
  });

  it('deriva el año de la fecha y no muestra un input editable de año', async () => {
    renderSheetConForm();
    await screen.findByText('Se deriva automáticamente de la fecha.');
    expect(screen.queryByRole('spinbutton', { name: /año/i })).not.toBeInTheDocument();
  });

  it('calcula peso promedio sin permitir editarlo', async () => {
    renderSheetConForm();
    fireEvent.change(await screen.findByLabelText('Cantidad de frutos'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Peso total (g)'), { target: { value: '125' } });
    expect(screen.getByText('12.50 g')).toBeInTheDocument();
  });

  it('permite guardar como borrador un calibre sobre el rango esperado', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    const calibre = await screen.findByPlaceholderText('14–24') as HTMLInputElement;
    fireEvent.change(calibre, { target: { value: '30' } });
    expect(screen.getAllByText(/fuera del rango esperado: revisa/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledWith(expect.objectContaining({
      estado: 'borrador',
      calibre_mm: 30,
    }), expect.any(String)));
  });

  it('marca revisión usando el límite recibido del catálogo', async () => {
    renderSheetConForm();
    const calibre = await screen.findByPlaceholderText('14–24') as HTMLInputElement;
    fireEvent.change(calibre, { target: { value: '40' } });
    // U-07: un solo texto para el valor en el límite de revisión, en el campo y en «Antes de finalizar».
    expect(screen.getAllByText('Calibre 40 mm está en el límite de revisión: quedará marcado y no entrará al ranking hasta revisarse.')).toHaveLength(2);
    // La nota interna del catálogo no se le muestra al operario (ver la prueba de admin más abajo).
    expect(screen.queryByText(/pendiente de confirmación científica por Efraín/)).not.toBeInTheDocument();
  });

  it('la nota «pendiente de confirmación científica por Efraín» solo se ve a un admin, junto a Calibre y Brix', async () => {
    sesionPrueba.esAdmin = true;
    try {
      renderSheetConForm();
      await screen.findByPlaceholderText('14–24');
      expect(screen.getAllByText('Rango heredado del comportamiento anterior del sistema — pendiente de confirmación científica por Efraín')).toHaveLength(2);
    } finally {
      sesionPrueba.esAdmin = false;
    }
  });

  it('un operario no ve la nota «pendiente de confirmación científica por Efraín» ni sin tocar el campo', async () => {
    renderSheetConForm();
    await screen.findByPlaceholderText('14–24');
    expect(screen.queryByText(/Rango heredado/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Efraín/)).not.toBeInTheDocument();
  });

  it('permite finalizar sin muestra aunque no estén los 26 descriptores', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    fireEvent.click(await screen.findByRole('checkbox', { name: /sin muestra de frutos/i }));
    fireEvent.click(await screen.findByRole('button', { name: /finalizar evaluación/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledWith(expect.objectContaining({
      estado: 'completa',
      sin_muestra: true,
      cantidad_frutos: undefined,
      peso_total_g: undefined,
    }), expect.any(String)));
    expect(screen.queryByText(/Faltan .* descriptores científicos/i)).not.toBeInTheDocument();
  });

  it('calcula cobertura floral y cuaja sin permitir editarlas', async () => {
    renderSheetConForm();
    fireEvent.change(await screen.findByLabelText('Varas basales'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Varas basales con flor'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Flores en varas basales'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Frutos en varas basales'), { target: { value: '2' } });
    expect(screen.getByText('40.00 %')).toBeInTheDocument();
    expect(screen.getByText('25.00 %')).toBeInTheDocument();
  });

  it('advierte relaciones sospechosas sin bloquear el guardado', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    fireEvent.change(await screen.findByLabelText('Varas basales'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Varas basales con flor'), { target: { value: '3' } });
    expect(screen.getAllByRole('status').some((nodo) => /varas con flor superan/i.test(nodo.textContent ?? ''))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalled());
  });

  it('permite cerrar con solo descriptores nuevos y presencia de yemas igual a cero', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    fireEvent.click(await screen.findByRole('button', { name: '0' }));
    fireEvent.change(screen.getByLabelText('Varas basales'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Inicio de floración'), { target: { value: '2027-08-01' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /sin muestra de frutos/i }));
    fireEvent.click(screen.getByRole('button', { name: /finalizar evaluación/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledWith(expect.objectContaining({
      estado: 'completa',
      sin_muestra: true,
      presencia_yemas_florales: 0,
      n_varas_basales: 8,
      fecha_inicio_floracion: '2027-08-01',
    }), expect.any(String)));
  });

  it('permite finalizar con muestra y cero descriptores si trae cantidad y peso', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    fireEvent.change(await screen.findByLabelText('Cantidad de frutos'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Peso total (g)'), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: /finalizar evaluación/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledWith(expect.objectContaining({
      estado: 'completa',
      sin_muestra: false,
      cantidad_frutos: 10,
      peso_total_g: 125,
    }), expect.any(String)));
    expect(screen.queryByText(/Faltan .* descriptores científicos/i)).not.toBeInTheDocument();
  });

  // Regla de frutos (Fase 2, Sprint 0): la muestra solo se exige con datos de fruta o de muestra.
  it('sin datos de fruta finaliza sin pedir muestra', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    fireEvent.change(await screen.findByLabelText('Varas basales'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Rendimiento (kg/planta)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /finalizar evaluación/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledWith(expect.objectContaining({
      estado: 'completa',
      sin_muestra: false,
      cantidad_frutos: undefined,
      peso_total_g: undefined,
      n_varas_basales: 6,
    }), expect.any(String)));
  });

  it('con calibre y sin muestra rechaza con un mensaje claro', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    fireEvent.change(await screen.findByPlaceholderText('14–24'), { target: { value: '18' } });
    fireEvent.click(screen.getByRole('button', { name: /finalizar evaluación/i }));
    // U-08: el mensaje está bajo el campo y también en el panel «Antes de finalizar».
    expect((await screen.findAllByText(/Hay datos de fruta o de muestra: la cantidad de frutos debe ser mayor que cero/i)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Cantidad de frutos')).toHaveFocus();
    expect(crearEvaluacionMock).not.toHaveBeenCalled();
  });

  it('con calibre y «Sin muestra de frutos» finaliza', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    fireEvent.change(await screen.findByPlaceholderText('14–24'), { target: { value: '18' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /sin muestra de frutos/i }));
    fireEvent.click(screen.getByRole('button', { name: /finalizar evaluación/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledWith(expect.objectContaining({
      estado: 'completa', sin_muestra: true, calibre_mm: 18,
    }), expect.any(String)));
  });
});

describe('EvaluacionForm — borrador huérfano (Sprint 9, Fase 4 hallazgo Grave)', () => {
  const borradorExistente = {
    id: 'ev-borrador-1',
    ronda_id: 'r1',
    anio: 2026,
    fecha: '2026-06-01',
    estado: 'borrador' as const,
    evaluador: 'Juan',
    observaciones: 'nota previa',
    sin_muestra: false,
    no_comparable: false,
    cantidad_frutos: 5,
    peso_total_g: 50,
    peso_promedio_g: 10,
    pct_flores: null,
    pct_frutos: null,
    brotacion: 3,
    floracion: undefined,
    cuaja: undefined,
    concentracion_cosecha: undefined,
    calibre_mm: 18,
    firmeza: undefined,
    color: undefined,
    bloom: undefined,
    brix: 12,
    rend_kg_planta: undefined,
    rend_t_ha: undefined,
    pct_fruta_exportable: undefined,
    dano_calor: undefined,
    golpe_sol: undefined,
    caida_fruto: undefined,
    requiere_revision: false,
    motivo_cambio: null,
    updated_at: '2026-06-01T10:00:00.000Z',
    created_at: '2026-06-01T10:00:00.000Z',
  };

  it('ofrece continuar o descartar en vez de abrir un formulario en blanco cuando ya hay un borrador', async () => {
    buscarBorradorDeRondaMock.mockResolvedValueOnce(borradorExistente);
    renderSheetConForm();
    expect(await screen.findByText(/ya tiene un borrador sin terminar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continuar borrador/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descartar y empezar de nuevo/i })).toBeInTheDocument();
    // El formulario en blanco no debe estar montado todavía.
    expect(screen.queryByLabelText(/Rendimiento \(kg\/planta\)/i)).not.toBeInTheDocument();
  });

  it('"Continuar borrador" carga los valores guardados en el formulario, sin crear una fila nueva', async () => {
    crearEvaluacionMock.mockClear();
    buscarBorradorDeRondaMock.mockResolvedValueOnce(borradorExistente);
    renderSheetConForm();
    fireEvent.click(await screen.findByRole('button', { name: /continuar borrador/i }));

    const calibre = await screen.findByPlaceholderText('14–24') as HTMLInputElement;
    expect(calibre.value).toBe('18');
    expect(screen.getByLabelText(/Evaluador/i)).toHaveValue('Juan');

    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await waitFor(() => expect(actualizarEvaluacionMock).toHaveBeenCalledWith(
      'ev-borrador-1',
      expect.objectContaining({ estado: 'borrador', calibre_mm: 18 }),
      borradorExistente.updated_at,
    ));
    expect(crearEvaluacionMock).not.toHaveBeenCalled();
  });

  it('"Descartar y empezar de nuevo" anula el borrador (nunca DELETE) y deja el formulario en blanco', async () => {
    buscarBorradorDeRondaMock.mockResolvedValueOnce(borradorExistente);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSheetConForm();
    fireEvent.click(await screen.findByRole('button', { name: /descartar y empezar de nuevo/i }));

    await waitFor(() => expect(actualizarEvaluacionMock).toHaveBeenCalledWith('ev-borrador-1', { estado: 'anulada', motivo_cambio: 'Borrador descartado por el autor' }, borradorExistente.updated_at));
    const evaluador = await screen.findByLabelText(/Evaluador/i) as HTMLInputElement;
    expect(evaluador.value).toBe('');
  });

  it('un conflicto de versión conserva la entrada local y explica que no se guardó', async () => {
    actualizarEvaluacionMock.mockClear();
    actualizarEvaluacionMock.mockRejectedValueOnce(Object.assign(new Error('El borrador cambió en otra sesión. Tus cambios no se guardaron.'), { name: 'ConflictoVersionEvaluacionError' }));
    buscarBorradorDeRondaMock.mockResolvedValueOnce(borradorExistente);
    renderSheetConForm();
    fireEvent.click(await screen.findByRole('button', { name: /continuar borrador/i }));
    const calibre = await screen.findByPlaceholderText('14–24');
    fireEvent.change(calibre, { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    expect(await screen.findByText(/Tus cambios no se guardaron/)).toBeInTheDocument();
    expect(calibre).toHaveValue(21);
    expect(actualizarEvaluacionMock).toHaveBeenCalledWith('ev-borrador-1', expect.objectContaining({ calibre_mm: 21 }), borradorExistente.updated_at);
  });

  it('ante la carrera 23505 muestra el mensaje útil y refresca el borrador ganador', async () => {
    const conflicto = new Error(
      'Esta ronda ya tiene un borrador abierto. Continúalo o descártalo antes de empezar otro.',
    );
    conflicto.name = 'ConflictoBorradorActivoError';
    crearEvaluacionMock.mockRejectedValueOnce(conflicto);
    buscarBorradorDeRondaMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(borradorExistente);

    renderSheetConForm();
    fireEvent.click(await screen.findByRole('button', { name: /guardar borrador/i }));

    expect(await screen.findByText(/ya tiene un borrador sin terminar/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /continuar borrador/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descartar y empezar de nuevo/i })).toBeInTheDocument();
    expect(screen.queryByText(/unique constraint|23505/i)).not.toBeInTheDocument();
    expect(buscarBorradorDeRondaMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('EvaluacionForm — guardado en vuelo con la hoja cerrada', () => {
  const clavesBorrador = () => Object.keys(localStorage).filter((clave) => clave.startsWith('borrador:'));

  async function guardarYCerrarAntesDeResponder(onGuardado: () => void) {
    let resolver!: (valor: { id: string }) => void;
    crearEvaluacionMock.mockReset();
    crearEvaluacionMock.mockReturnValueOnce(new Promise<{ id: string }>((resolve) => { resolver = resolve; }));
    const qc = new QueryClient();
    const invalidar = vi.spyOn(qc, 'invalidateQueries');
    const vista = render(
      <QueryClientProvider client={qc}>
        <EvaluacionForm rondaId="r-cierre" plantaId="p1" onGuardado={onGuardado} />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Cantidad de frutos'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Peso total (g)'), { target: { value: '50' } });
    await waitFor(() => expect(clavesBorrador()).toEqual(['borrador:usuario:usuario-prueba:evaluacion:r-cierre']), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /finalizar evaluación/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalled());
    vista.unmount();
    return { resolver, invalidar };
  }

  it('si el guardado se confirma con la hoja ya cerrada y la misma sesión, limpia el borrador local y avisa al padre', async () => {
    const onGuardado = vi.fn();
    const { resolver, invalidar } = await guardarYCerrarAntesDeResponder(onGuardado);
    await act(async () => resolver({ id: 'e1' }));
    expect(clavesBorrador()).toEqual([]);
    expect(onGuardado).toHaveBeenCalledTimes(1);
    expect(invalidar).toHaveBeenCalled();
  });

  it('si la sesión cambió mientras el guardado estaba en vuelo, no limpia, no avisa ni invalida', async () => {
    const onGuardado = vi.fn();
    const { resolver, invalidar } = await guardarYCerrarAntesDeResponder(onGuardado);
    sesionPrueba.version += 1;
    await act(async () => resolver({ id: 'e1' }));
    expect(clavesBorrador()).toEqual(['borrador:usuario:usuario-prueba:evaluacion:r-cierre']);
    expect(onGuardado).not.toHaveBeenCalled();
    expect(invalidar).not.toHaveBeenCalled();
    sesionPrueba.version = 0;
  });
});

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    generacionSesion: 0,
    capturarVigenciaSesion: () => { const version = sesionPrueba.version; return () => sesionPrueba.version === version; },
    user: { id: 'usuario-prueba' },
    esAdmin: sesionPrueba.esAdmin,
  }),
}));

describe('EvaluacionForm: valores fuera del rango esperado y valores inválidos (U-07)', () => {
  it('Brix 999 °Bx avisa en ámbar, con un solo texto, no es «Valor destacado» en verde y no bloquea', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    const brix = await screen.findByPlaceholderText('10–18') as HTMLInputElement;
    fireEvent.change(brix, { target: { value: '999' } });
    // No es un error: el campo no queda inválido.
    expect(brix).toHaveAttribute('aria-invalid', 'false');
    // Campo y panel «Antes de finalizar» dicen lo mismo, una vez cada uno.
    const avisos = screen.getAllByText('Brix 999 °Bx: fuera del rango esperado: revisa (10–18 °Bx). Se puede guardar.');
    expect(avisos).toHaveLength(2);
    expect(screen.getByText('Brix 999 °Bx: fuera del rango esperado: revisa (10–18 °Bx). Se puede guardar.', { selector: 'span' }).closest('li')).toHaveClass('text-warn');
    expect(avisos.some((aviso) => aviso.closest('div')?.classList.contains('text-warn'))).toBe(true);
    for (const aviso of avisos) expect(aviso.closest('div, li')).not.toHaveClass('text-ok');
    expect(screen.queryByText(/Valor destacado/)).not.toBeInTheDocument();
    expect(screen.queryByText('Sin valores fuera de rango.')).not.toBeInTheDocument();
    // No bloquea el guardado.
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledWith(expect.objectContaining({ estado: 'borrador', brix: 999 }), expect.any(String)));
  });

  it('un calibre raro pero posible (30 mm) avisa en ámbar y no es verde', async () => {
    renderSheetConForm();
    const calibre = await screen.findByPlaceholderText('14–24') as HTMLInputElement;
    fireEvent.change(calibre, { target: { value: '30' } });
    expect(calibre).toHaveAttribute('aria-invalid', 'false');
    const aviso = screen.getAllByText(/Calibre 30 mm: fuera del rango esperado: revisa \(14–24 mm\)/)[0];
    expect(aviso.closest('div, li')).not.toHaveClass('text-ok');
  });

  it('por debajo del mínimo esperado también avisa', async () => {
    renderSheetConForm();
    fireEvent.change(await screen.findByPlaceholderText('10–18'), { target: { value: '4' } });
    expect(screen.getAllByText(/Brix 4 °Bx: fuera del rango esperado: revisa/)).toHaveLength(2);
  });

  it('un valor dentro del rango esperado no avisa', async () => {
    renderSheetConForm();
    fireEvent.change(await screen.findByPlaceholderText('10–18'), { target: { value: '12' } });
    expect(screen.queryByText(/fuera del rango esperado/)).not.toBeInTheDocument();
  });

  it('un descriptor sin rango de referencia no avisa por grande que sea el valor y no bloquea', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    const rendimiento = await screen.findByLabelText('Rendimiento (kg/planta)') as HTMLInputElement;
    fireEvent.change(rendimiento, { target: { value: '99999' } });
    expect(rendimiento).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(/fuera del rango esperado/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await waitFor(() => expect(crearEvaluacionMock).toHaveBeenCalledWith(expect.objectContaining({ estado: 'borrador', rend_kg_planta: 99999 }), expect.any(String)));
  });

  it('un calibre negativo es un error técnico: campo inválido, un solo texto, impide guardar', async () => {
    crearEvaluacionMock.mockClear();
    renderSheetConForm();
    const calibre = await screen.findByPlaceholderText('14–24') as HTMLInputElement;
    fireEvent.change(calibre, { target: { value: '-5' } });
    expect(calibre).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText(/Calibre no puede ser negativo\./)).toHaveLength(2);
    expect(screen.queryByText(/fuera del rango esperado/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await waitFor(() => expect(screen.getAllByText(/Calibre no puede ser negativo\./).length).toBeGreaterThan(2));
    expect(crearEvaluacionMock).not.toHaveBeenCalled();
  });

  it('un valor no entero en un descriptor que cuenta cosas es un error técnico', async () => {
    renderSheetConForm();
    const varas = await screen.findByLabelText('Varas basales');
    fireEvent.change(varas, { target: { value: '3.5' } });
    expect(varas).toHaveAttribute('aria-invalid', 'true');
    expect(varas).toHaveAccessibleDescription('Varas basales debe ser un entero.');
  });
});

describe('EvaluacionForm: errores bajo el campo (U-08)', () => {
  it('un valor inválido en Brotes y varas se pinta y se describe bajo su campo', async () => {
    renderSheetConForm();
    const varas = await screen.findByLabelText('Varas basales');
    expect(varas).not.toHaveAttribute('aria-invalid');
    fireEvent.change(varas, { target: { value: '-3' } });
    expect(varas).toHaveAttribute('aria-invalid', 'true');
    expect(varas).toHaveClass('border-danger');
    expect(varas).toHaveAccessibleDescription('Varas basales no puede ser negativo.');
    fireEvent.change(varas, { target: { value: '12' } });
    expect(varas).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Varas basales no puede ser negativo.')).not.toBeInTheDocument();
  });

  it('tras intentar finalizar, el campo con el error recibe el foco y muestra su mensaje', async () => {
    renderSheetConForm();
    const altura = await screen.findByLabelText('Altura del brote (mm)');
    fireEvent.change(altura, { target: { value: '-7' } });
    fireEvent.click(screen.getByRole('button', { name: /finalizar evaluación/i }));
    expect(altura).toHaveFocus();
    expect(altura).toHaveAccessibleDescription('Altura del brote no puede ser negativo.');
  });
});
