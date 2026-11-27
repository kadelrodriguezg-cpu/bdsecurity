import { describe, expect, it } from 'vitest';
import {
  CLAVES_DESCRIPTORES_ANUAL,
  CLAVES_EXIGEN_MUESTRA,
  ESQUEMA_EVALUACION_ANUAL,
  exigeMuestraDeFrutos,
  exportableCalculado,
} from './evaluacionAnual';
import { contarDescriptoresConValor, descriptoresDe, esquemaVisibleDe, etiquetaDeNivel, formatearValorCampo } from './tipos';

describe('esquema de Evaluación anual', () => {
  it('tiene los 29 descriptores del formulario (con la cicatriz), sin claves repetidas', () => {
    expect(CLAVES_DESCRIPTORES_ANUAL).toHaveLength(29);
    const claves = ESQUEMA_EVALUACION_ANUAL.campos.map((c) => c.clave);
    expect(new Set(claves).size).toBe(claves.length);
    for (const clave of ['n_varas_basales', 'presencia_yemas_florales', 'fecha_inicio_floracion', 'precocidad', 'color_follaje']) {
      expect(CLAVES_DESCRIPTORES_ANUAL).toContain(clave);
    }
  });

  it('cada campo pertenece a una sección declarada', () => {
    const secciones = new Set(ESQUEMA_EVALUACION_ANUAL.secciones.map((s) => s.id));
    for (const campo of ESQUEMA_EVALUACION_ANUAL.campos) expect(secciones.has(campo.seccion)).toBe(true);
  });

  it('cuenta solo descriptores, no muestra ni derivados', () => {
    expect(contarDescriptoresConValor(ESQUEMA_EVALUACION_ANUAL, {
      brotacion: 3, n_varas_basales: 0, cantidad_frutos: 10, peso_promedio_g: 1.2, fecha_inicio_floracion: '',
    })).toBe(2);
  });

  it('formatea escalas, unidades y fechas', () => {
    const campo = (clave: string) => ESQUEMA_EVALUACION_ANUAL.campos.find((c) => c.clave === clave)!;
    expect(formatearValorCampo(campo('firmeza'), 4)).toBe('4 de 5');
    expect(formatearValorCampo(campo('calibre_mm'), 12.5)).toBe('12,5 mm');
    expect(formatearValorCampo(campo('pct_flores'), 33.3333)).toBe('33,33 %');
    expect(formatearValorCampo(campo('fecha_inicio_floracion'), '2026-09-15')).toBe('15-09-2026');
    expect(formatearValorCampo(campo('brix'), null)).toBe('—');
  });
});

describe('regla de frutos', () => {
  it('los descriptores de fruta y de muestra activan la exigencia', () => {
    expect([...CLAVES_EXIGEN_MUESTRA].sort()).toEqual(
      ['bloom', 'brix', 'calibre_mm', 'cantidad_frutos', 'cicatriz', 'color', 'firmeza', 'peso_total_g'],
    );
  });

  it('sin fruta no exige muestra', () => {
    expect(exigeMuestraDeFrutos({ brotacion: 3, n_varas_basales: 4, rend_kg_planta: 2 })).toBe(false);
  });

  it('con calibre exige muestra salvo «sin muestra»', () => {
    expect(exigeMuestraDeFrutos({ calibre_mm: 14 })).toBe(true);
    expect(exigeMuestraDeFrutos({ calibre_mm: 14, sin_muestra: true })).toBe(false);
  });

  it('cargar solo la cantidad también exige el peso', () => {
    expect(exigeMuestraDeFrutos({ cantidad_frutos: 10 })).toBe(true);
  });
});

describe('distribución de flores y frutos, descriptores activos y niveles con texto (EF11, EF12)', () => {
  const campo = (clave: string) => ESQUEMA_EVALUACION_ANUAL.campos.find((c) => c.clave === clave)!;

  it('la distribución va en Brotes y varas, justo después de «Color del follaje», con 3 niveles escritos', () => {
    const claves = ESQUEMA_EVALUACION_ANUAL.campos.map((c) => c.clave);
    expect(claves[claves.indexOf('color_follaje') + 1]).toBe('distribucion_flores_frutos');
    expect(claves.indexOf('distribucion_flores_frutos')).toBe(15); // orden 16 del esquema (base 0)
    const d = campo('distribucion_flores_frutos');
    expect(d).toMatchObject({ seccion: 'brotes', rol: 'descriptor', tipo: 'escala', etiqueta: 'Distribución de flores y frutos en la vara' });
    expect(d.escala).toEqual({
      minimo: 1, maximo: 3, etiquetaMinimo: 'Solo en la punta', etiquetaMaximo: 'Toda la vara',
      etiquetasNivel: ['Solo en la punta', 'Hasta la mitad', 'Toda la vara'],
    });
    expect(d.exigeMuestra).toBeUndefined(); // no es dato de fruta: no exige muestra
  });

  it('rend_t_ha queda desactivado: no cuenta como descriptor ni sale entre los protocolizables', () => {
    expect(campo('rend_t_ha').activo).toBe(false);
    expect(CLAVES_DESCRIPTORES_ANUAL).not.toContain('rend_t_ha');
    expect(CLAVES_DESCRIPTORES_ANUAL).toContain('distribucion_flores_frutos');
    expect(descriptoresDe(ESQUEMA_EVALUACION_ANUAL)).toHaveLength(29);
    expect(ESQUEMA_EVALUACION_ANUAL.campos.filter((c) => c.activo === false).map((c) => c.clave)).toEqual(['rend_t_ha']);
  });

  it('el valor se escribe con el texto de su nivel, no con el número', () => {
    const d = campo('distribucion_flores_frutos');
    expect(formatearValorCampo(d, 1)).toBe('Solo en la punta');
    expect(formatearValorCampo(d, 2)).toBe('Hasta la mitad');
    expect(formatearValorCampo(d, '3')).toBe('Toda la vara');
    expect(formatearValorCampo(d, null)).toBe('—');
    expect(etiquetaDeNivel(d, 2)).toBe('Hasta la mitad');
    expect(etiquetaDeNivel(d, 4)).toBeNull(); // fuera de la escala
    expect(etiquetaDeNivel(campo('firmeza'), 3)).toBeNull(); // escala 1-5 sin texto por nivel
    expect(formatearValorCampo(campo('firmeza'), 3)).toBe('3 de 5');
  });

  it('cuenta solo descriptores activos: un rend_t_ha histórico no suma a la cobertura', () => {
    expect(contarDescriptoresConValor(ESQUEMA_EVALUACION_ANUAL, { brotacion: 3, distribucion_flores_frutos: 2, rend_t_ha: 12 })).toBe(2);
  });

  it('un campo desactivado solo se ve en una evaluación que ya trae su valor', () => {
    const sin = esquemaVisibleDe(ESQUEMA_EVALUACION_ANUAL, { brotacion: 3 });
    expect(sin.campos.some((c) => c.clave === 'rend_t_ha')).toBe(false);
    const con = esquemaVisibleDe(ESQUEMA_EVALUACION_ANUAL, { rend_t_ha: 12.5 });
    expect(con.campos.some((c) => c.clave === 'rend_t_ha')).toBe(true);
    expect(esquemaVisibleDe(ESQUEMA_EVALUACION_ANUAL, { rend_t_ha: 0 }).campos.some((c) => c.clave === 'rend_t_ha')).toBe(true); // cero es un valor
    expect(sin.campos).toHaveLength(ESQUEMA_EVALUACION_ANUAL.campos.length - 1);
  });
});

describe('poscosecha: % exportable calculado (decisión 5)', () => {
  it('es el valor a los 45 días', () => {
    expect(exportableCalculado({ pct_buen_estado_15d: 95, pct_buen_estado_30d: 88, pct_buen_estado_45d: 72 })).toBe(72);
  });
  it('es 0 si una lectura anterior dio 0 %, aunque falte la de 45 días', () => {
    expect(exportableCalculado({ pct_buen_estado_15d: 60, pct_buen_estado_30d: 0 })).toBe(0);
    expect(exportableCalculado({ pct_buen_estado_15d: 0 })).toBe(0);
  });
  it('sin la lectura de 45 días queda sin dato (no 0)', () => {
    expect(exportableCalculado({ pct_buen_estado_15d: 95, pct_buen_estado_30d: 80 })).toBeNull();
  });
  it('sin ninguna lectura conserva el valor histórico escrito a mano', () => {
    expect(exportableCalculado({ pct_fruta_exportable: 64 })).toBe(64);
    expect(exportableCalculado({})).toBeNull();
  });
  it('las tres lecturas son descriptores de Producción desde el 26-10-2026 y el exportable es calculado', () => {
    const produccion = ESQUEMA_EVALUACION_ANUAL.campos.filter((c) => c.seccion === 'produccion');
    expect(produccion.map((c) => [c.clave, c.rol])).toEqual([
      ['pct_flores', 'derivado'], ['pct_frutos', 'derivado'], ['rend_kg_planta', 'descriptor'], ['rend_t_ha', 'descriptor'],
      ['pct_buen_estado_15d', 'descriptor'], ['pct_buen_estado_30d', 'descriptor'], ['pct_buen_estado_45d', 'descriptor'],
      ['pct_fruta_exportable', 'derivado'],
    ]);
    expect(produccion.filter((c) => c.clave.startsWith('pct_buen')).every((c) => c.vigenteDesde === '2026-10-26')).toBe(true);
  });
});
