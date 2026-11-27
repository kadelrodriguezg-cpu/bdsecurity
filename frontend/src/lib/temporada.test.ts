import { describe, expect, it } from 'vitest';
import { etiquetaTemporada, temporadaDeRonda } from './temporada';

describe('hallazgo 2 (G2): etiqueta de temporada de una ronda', () => {
  it.each([
    ['2026-07-01', '2026-2027'],
    ['2026-12-31', '2026-2027'],
    ['2027-01-01', '2026-2027'],
    ['2026-06-30', '2025-2026'],
  ])('iniciada el %s → %s', (fecha, etiqueta) => {
    expect(etiquetaTemporada(fecha)).toBe(etiqueta);
  });

  it('sin fecha de inicio usa el día (en Chile) en que se creó la ronda', () => {
    expect(temporadaDeRonda({ fecha_inicio: null, created_at: '2026-07-01T02:00:00Z' })).toBe('2025-2026'); // 30-06 en Chile
    expect(temporadaDeRonda({ fecha_inicio: null, created_at: '2026-07-01T15:00:00Z' })).toBe('2026-2027');
    expect(temporadaDeRonda({ fecha_inicio: '2026-05-10', created_at: '2026-09-01T15:00:00Z' })).toBe('2025-2026');
  });

  it('sin ninguna fecha no inventa una temporada', () => {
    expect(etiquetaTemporada(null)).toBeNull();
    expect(temporadaDeRonda({ fecha_inicio: null, created_at: null })).toBeNull();
  });
});
