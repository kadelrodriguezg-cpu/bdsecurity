import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { conIntentoCreacion } from './intentoCreacion';
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it('conserva identidad tras perder respuesta, sobrevive otro llamado y solo la retira al confirmar', async () => {
  let inicial = '';
  await expect(conIntentoCreacion('A', 'individualizar:p1', { cantidad: 5 }, async id => {
    inicial = id; expect(localStorage.length).toBe(1); throw new Error('Respuesta perdida');
  })).rejects.toThrow('Respuesta perdida');
  const otro = vi.fn();
  await expect(conIntentoCreacion('A', 'individualizar:p1', { cantidad: 6 }, otro)).rejects.toThrow('cantidad original es 5');
  expect(otro).not.toHaveBeenCalled();
  await expect(conIntentoCreacion('A', 'individualizar:p1', { cantidad: 5 }, async id => {
    expect(id).toBe(inicial); return 'recuperado';
  })).resolves.toBe('recuperado');
  expect(localStorage.length).toBe(0);
});
it('si no puede persistir no ejecuta la creación', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
  const crear = vi.fn();
  await expect(conIntentoCreacion('A', 'clonar:i1', {}, crear)).rejects.toThrow('No se envió la creación');
  expect(crear).not.toHaveBeenCalled();
});
it('un intento de otra cuenta no se recupera ni elimina', async () => {
  let idA = '';
  await expect(conIntentoCreacion('A', 'clonar:i1', {}, async id => { idA = id; throw new Error('perdida'); })).rejects.toThrow();
  await conIntentoCreacion('B', 'clonar:i1', {}, async id => { expect(id).not.toBe(idA); });
  expect(localStorage.length).toBe(1);
  await conIntentoCreacion('A', 'clonar:i1', {}, async id => { expect(id).toBe(idA); });
  expect(localStorage.length).toBe(0);
});
