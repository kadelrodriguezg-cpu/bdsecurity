import { describe, expect, it } from 'vitest';
import type { EveclComparacion } from '@/api/evecl';
import { crearCsvComparacion, gruposExportables } from './exportCsv';

const COMPARACION: EveclComparacion = {
  modo: 'entre_fichas',
  conjunto: null,
  nota_metodologica: 'Relativo.',
  ranking_calidad: [
    { grupo_key: '1', grupo_label: 'Repetición 1', variedad: 'Duke', ensayo_id: 3, tipo: 'evaluacion', puntaje: 100, n_con_dato: 1, n_total: 1 },
    { grupo_key: '2', grupo_label: 'Repetición 2', variedad: 'Duke', ensayo_id: 3, tipo: 'evaluacion', puntaje: 0, n_con_dato: 1, n_total: 1 },
  ],
  ranking_productividad: [],
  perfil_fenologia: [
    { grupo_key: '1', grupo_label: 'Repetición 1', descriptor: 'Floración', nota_moda: 5, label_moda: 'Media, uniforme', divergente: false, n_con_dato: 1, n_total: 1 },
  ],
  perfil_adaptabilidad: [],
};

describe('export CSV EVECL', () => {
  it('exporta todo con encabezado estable y escaping CSV', () => {
    const lineas = crearCsvComparacion(COMPARACION).split('\r\n');
    expect(lineas).toHaveLength(4);
    expect(lineas[0]).toContain('modo,conjunto,eje,tipo_resultado');
    expect(lineas[2]).toContain('Repetición 2');
    expect(lineas[3]).toContain('"Media, uniforme"');
  });

  it('permite limitar a una ficha o una selección sin cambiar valores', () => {
    const csv = crearCsvComparacion(COMPARACION, new Set(['1']));
    expect(csv).toContain('Repetición 1');
    expect(csv).not.toContain('Repetición 2');
    expect(gruposExportables(COMPARACION)).toEqual([
      { key: '1', label: 'Repetición 1' },
      { key: '2', label: 'Repetición 2' },
    ]);
  });
});
