import { describe, expect, it } from 'vitest';
import { buscarPorCodigo, numeroBuscado, numeroDeCodigo } from './buscarCodigo';

const plantas = Array.from({ length: 180 }, (_, i) => ({ codigo: `02-001-P${i + 1}`, numero: i + 1 }));
const buscar = (texto: string) => buscarPorCodigo(plantas, texto, (p) => p).map((p) => p.codigo.split('-').pop());

describe('buscarPorCodigo (G14)', () => {
  it('el número exacto va primero: P78 antes que P178', () => {
    expect(buscar('78')).toEqual(['P78', 'P178']);
    // «P78» no está dentro de «P178»: coinciden las mismas plantas que antes, solo cambia el orden.
    expect(buscar('P78')).toEqual(['P78']);
  });

  it('un número que también está en el código del cruce: primero el exacto, luego los que lo contienen, luego el resto', () => {
    const r = buscar('2');
    expect(r[0]).toBe('P2');
    expect(r.slice(1, 4)).toEqual(['P12', 'P20', 'P21']);
    expect(r).toHaveLength(180); // «02-001» contiene el 2: coinciden todas, pero al final
    expect(r.indexOf('P1')).toBeGreaterThan(r.indexOf('P172'));
  });

  it('texto que no es número: coincide por el código', () => {
    expect(buscar('001-P10')).toEqual(['P10', 'P100', 'P101', 'P102', 'P103', 'P104', 'P105', 'P106', 'P107', 'P108', 'P109']);
    expect(buscar('')).toHaveLength(180);
    expect(buscar('xyz')).toEqual([]);
  });

  it('número buscado y número del código', () => {
    expect(numeroBuscado(' p78 ')).toBe(78);
    expect(numeroBuscado('02-001')).toBeNull();
    expect(numeroDeCodigo('02-001-P78')).toBe(78);
    expect(numeroDeCodigo('sin número')).toBeNull();
  });
});
