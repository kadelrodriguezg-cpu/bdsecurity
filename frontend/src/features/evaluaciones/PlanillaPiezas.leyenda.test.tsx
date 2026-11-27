/** Leyenda de la planilla (D14): una partición de los vivos; «por revisar» va dentro de «cerradas» y «pendientes» pasa a «sin empezar» (E16). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('@/api/client', () => ({ supabase: {}, traducirError: (e: { message: string }) => new Error(e.message) }));

import { BarraAvance } from './PlanillaPiezas';
import { nombreOFallback, NOMBRE_NO_VISIBLE } from '@/api/actividad';

afterEach(cleanup);

describe('BarraAvance: leyenda que suma el total', () => {
  it('149 cerradas (de ellas, 3 por revisar) · 25 borradores · 205 sin empezar = 379', () => {
    render(<BarraAvance avance={{ vivos: 379, completas: 149, porRevisar: 3, borradores: 25, pendientes: 205, sinRonda: 0 }} />);
    const items = within(screen.getByRole('list', { name: 'Detalle del avance' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['149 cerradas(de ellas,3 por revisar)', '25 borradores', '205 sin empezar']);
    const suma = items.reduce((total, texto) => total + Number(texto!.match(/^\d+/)![0]), 0);
    expect(suma).toBe(379);
    expect(screen.queryByText(/pendiente/i)).not.toBeInTheDocument();
  });

  it('sin nada por revisar no aparece el paréntesis; «sin ronda» suma aparte', () => {
    render(<BarraAvance avance={{ vivos: 10, completas: 4, porRevisar: 0, borradores: 1, pendientes: 3, sinRonda: 2 }} />);
    const items = within(screen.getByRole('list', { name: 'Detalle del avance' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['4 cerradas', '1 borrador', '3 sin empezar', '2 sin ronda']);
  });
});

describe('Actividad reciente: quién (D13)', () => {
  const fila = (nombre: string | null, createdBy: string | null = 'u1') => ({ created_at: '2026-10-24T12:00:00Z', created_by: createdBy, perfiles: nombre ? { nombre } : null });

  it('con el perfil legible, su nombre', () => {
    expect(nombreOFallback(fila('Ana Rojas'), 'M. Soto')).toBe('Ana Rojas');
  });

  it('sin perfil legible (RLS de un operario), el evaluador de la evaluación', () => {
    expect(nombreOFallback(fila(null), 'M. Soto')).toBe('M. Soto');
  });

  it('sin perfil ni evaluador: «otra persona», nunca «Usuario»', () => {
    expect(nombreOFallback(fila(null), '  ')).toBe(NOMBRE_NO_VISIBLE);
    expect(NOMBRE_NO_VISIBLE).toBe('otra persona');
    expect(nombreOFallback(fila(null, null))).toBeNull();
  });
});
