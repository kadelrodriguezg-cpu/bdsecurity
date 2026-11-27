import { expect, it } from 'vitest';
import { claveNombreVariedad } from './claveNombreVariedad';

it.each([
  [' BCH-1 ', 'bch1'], ['BCH 1', 'bch1'], ["O’Néàl", 'oneal'],
  ['ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛ', 'aeiouunaeiouaeiou'], ['çå', ''],
])('clave SQL del importador: %s', (nombre, clave) => expect(claveNombreVariedad(nombre)).toBe(clave));
