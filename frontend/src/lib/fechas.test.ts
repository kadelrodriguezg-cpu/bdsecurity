import { describe, expect, it } from 'vitest';
import { formatearFechaCivil, formatearFechaHora, hoyChileISO } from './fechas';

describe('hoyChileISO', () => {
  it('usa el calendario de Chile aunque UTC ya esté en el día siguiente', () => {
    expect(hoyChileISO(new Date('2026-07-17T00:00:00.000Z'))).toBe('2026-07-16');
  });

  it('reconoce medianoche civil chilena aunque UTC ya sea las 04:00', () => {
    expect(hoyChileISO(new Date('2026-07-17T04:00:00.000Z'))).toBe('2026-07-17');
  });

  it('respeta el cambio de horario de verano de Chile', () => {
    expect(hoyChileISO(new Date('2026-12-01T02:30:00.000Z'))).toBe('2026-11-30');
  });
});

describe('formateadores de fecha', () => {
  it('mantiene una fecha civil en el día indicado en Chile', () => {
    expect(formatearFechaCivil('2026-07-17')).toBe('17-07-2026');
  });

  it('explicita la ausencia de fecha en vez de mostrar un guion ambiguo', () => {
    expect(formatearFechaCivil(null)).toBe('Sin fecha registrada');
    expect(formatearFechaHora(undefined)).toBe('Sin fecha registrada');
  });

  it('formatea fecha y hora con la zona de Chile', () => {
    expect(formatearFechaHora('2026-07-17T01:00:00.000Z')).toContain('16-07-2026');
  });
});
