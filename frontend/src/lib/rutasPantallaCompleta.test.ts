import { expect, it } from 'vitest';
import { rutaEvaluarCrecimiento, rutaEvaluarMultisitio, volverDeCruce } from './rutasIndividuo';

it('volverDeCruce acepta solo rutas de este cruce', () => {
  expect(volverDeCruce('p', '/planta/p')).toBe('/planta/p');
  expect(volverDeCruce('p', '/planta/p?pestana=individuos&individuo=i1')).toBe('/planta/p?pestana=individuos&individuo=i1');
  expect(volverDeCruce('p', '/planta/p/evaluacion/e1')).toBe('/planta/p/evaluacion/e1');
});

it.each([
  [null], [''], ['//ajeno.example'], ['https://ajeno.example/planta/p'], ['/planta/otro'], ['/planta/pirata'], ['/planta/p/../../login'],
  ['/planta/p\\..\\x'], ['/planta/p\n/x'],
])('volverDeCruce rechaza %s', (pedido) => {
  expect(volverDeCruce('p', pedido)).toBeNull();
});

it('las rutas de pantalla completa llevan el «volver» codificado', () => {
  expect(rutaEvaluarCrecimiento('p', 'i1')).toBe('/planta/p/crecimiento/i1');
  const volver = '/planta/p?pestana=individuos&individuo=i1';
  expect(rutaEvaluarCrecimiento('p', 'i1', volver)).toBe(`/planta/p/crecimiento/i1?volver=${encodeURIComponent(volver)}`);
  expect(rutaEvaluarMultisitio('p', 'i1')).toBe('/planta/p/multisitio/i1');
  expect(rutaEvaluarMultisitio('p', 'i1', { ronda: 2, volver })).toBe(`/planta/p/multisitio/i1?ronda=2&volver=${encodeURIComponent(volver)}`);
});
