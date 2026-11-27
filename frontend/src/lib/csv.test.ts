import { describe, expect, it } from 'vitest';
import { leerCsv } from './csv';

describe('leerCsv', () => {
  it('lee cabecera y filas separadas por coma', () => {
    expect(leerCsv('codigo,mama\n02-001,Duke\n02-002,Legacy\n')).toEqual({
      columnas: ['codigo', 'mama'],
      filas: [['02-001', 'Duke'], ['02-002', 'Legacy']],
    });
  });

  it('detecta el punto y coma de Excel en español y quita el BOM', () => {
    expect(leerCsv('﻿código;especie\r\n02-001;Arándano\r\n')).toEqual({
      columnas: ['código', 'especie'],
      filas: [['02-001', 'Arándano']],
    });
  });

  it('respeta comillas con separadores, comillas escapadas y saltos de línea adentro', () => {
    const { filas } = leerCsv('codigo,cruzamiento\n02-001,"Duke x ""O\'Neal"", lote 2"\n02-002,"línea 1\nlínea 2"\n');
    expect(filas).toEqual([
      ['02-001', 'Duke x "O\'Neal", lote 2'],
      ['02-002', 'línea 1\nlínea 2'],
    ]);
  });

  it('ignora líneas vacías y acepta un archivo sin salto final', () => {
    expect(leerCsv('a,b\n\n1,2\n,\n  ,  \n3,4').filas).toEqual([['1', '2'], ['3', '4']]);
  });

  it('un archivo vacío no tiene columnas ni filas', () => {
    expect(leerCsv('')).toEqual({ columnas: [], filas: [] });
  });
});
