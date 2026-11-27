import { describe, expect, it } from 'vitest';
import { esConflictoDeBorradorActivo } from './rondas';

describe('conflicto de borrador activo', () => {
  it('reconoce solo el 23505 del indice parcial de borrador por ronda', () => {
    expect(esConflictoDeBorradorActivo({
      code: '23505',
      message: 'duplicate key value violates unique constraint "evaluaciones_un_borrador_activo_por_ronda_uidx"',
    })).toBe(true);
    expect(esConflictoDeBorradorActivo({
      code: '23505',
      message: 'duplicate key value violates unique constraint "evaluaciones_idempotency_key_key"',
    })).toBe(false);
    expect(esConflictoDeBorradorActivo({ code: '23514', message: 'otro error' })).toBe(false);
  });
});
