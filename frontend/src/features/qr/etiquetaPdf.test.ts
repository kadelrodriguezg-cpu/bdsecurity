/**
 * Contrato del generador de etiquetas compartido por la descarga individual y
 * la descarga en tanda. Lo que se prueba acá es lo que la tanda no puede
 * verificar a ojo: que N códigos produzcan N páginas, que la página mida los
 * mm físicos declarados para el tamaño elegido, y que cada página lleve
 * impreso el número corto de SU individuo y no el código del cruce.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generarPdfEtiqueta, generarPdfEtiquetas, MM_TO_PT, numeroCortoIndividuo, TAMANOS, unirPdfs } from './etiquetaPdf';
import { textosImpresos } from './textosImpresos';

// PNG 1x1 válido: alcanza para embeber, el bitmap real del QR lo produce el
// canvas del navegador (no hay canvas en jsdom).
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const ORIGIN = 'https://ejemplo.test';

describe('numeroCortoIndividuo', () => {
  it('imprime solo el número corto, nunca el código del cruce', () => {
    expect(numeroCortoIndividuo('02-001-P01')).toBe('P01');
    expect(numeroCortoIndividuo('02-001-P100')).toBe('P100');
  });

  it('devuelve el código tal cual si no tiene separador', () => {
    expect(numeroCortoIndividuo('P07')).toBe('P07');
  });
});

describe('generarPdfEtiquetas — tanda', () => {
  it('produce una página por código, en orden', async () => {
    const codigos = ['02-001-P01', '02-001-P02', '02-001-P03', '02-001-P04', '02-001-P05'];
    const bytes = await generarPdfEtiquetas({ spec: TAMANOS.mediana, qrDataUrl: PNG_1X1, origin: ORIGIN, codigos });

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(codigos.length);

    // Una etiqueta por individuo, en el mismo orden, con SU número corto y
    // nunca el código completo del cruce (postura anti-reconocimiento).
    expect(textosImpresos(bytes)).toEqual(['P01', 'P02', 'P03', 'P04', 'P05']);
  });

  it('cada página mide los mm físicos del tamaño elegido', async () => {
    for (const spec of Object.values(TAMANOS)) {
      if (spec.logo) continue; // el tamaño grande trae logo por fetch, se cubre aparte
      const bytes = await generarPdfEtiquetas({ spec, qrDataUrl: PNG_1X1, origin: ORIGIN, codigos: ['02-001-P01', '02-001-P02'] });
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(2);
      for (const page of pdf.getPages()) {
        expect(page.getWidth()).toBeCloseTo(spec.w * MM_TO_PT, 3);
        expect(page.getHeight()).toBeCloseTo(spec.h * MM_TO_PT, 3);
      }
    }
  });

  it('el tamaño pequeño no imprime texto (solo QR)', async () => {
    const bytes = await generarPdfEtiquetas({
      spec: TAMANOS.pequena,
      qrDataUrl: PNG_1X1,
      origin: ORIGIN,
      codigos: ['02-001-P01'],
    });
    expect(textosImpresos(bytes)).toEqual([]);
  });

  it('una etiqueta individual es una tanda de un solo código', async () => {
    const individual = await generarPdfEtiqueta(TAMANOS.mediana, PNG_1X1, ORIGIN, '02-001-P07');
    const tanda = await generarPdfEtiquetas({
      spec: TAMANOS.mediana,
      qrDataUrl: PNG_1X1,
      origin: ORIGIN,
      codigos: ['02-001-P07'],
    });

    const unaPagina = await PDFDocument.load(individual);
    expect(unaPagina.getPageCount()).toBe(1);
    expect(textosImpresos(individual)).toEqual(['P07']);
    expect(textosImpresos(tanda)).toEqual(['P07']);
    // Mismo tamaño de página y mismo texto: la tanda no reimplementa el layout.
    expect(unaPagina.getPage(0).getSize()).toEqual((await PDFDocument.load(tanda)).getPage(0).getSize());
  });

  it('sin código no imprime texto (etiqueta del cruce sin individualizar)', async () => {
    const bytes = await generarPdfEtiqueta(TAMANOS.mediana, PNG_1X1, ORIGIN);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });
});

// PNG 1x1 distinto (otro color) para probar que cada página puede llevar su propia imagen.
const PNG_1X1_OTRO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Cada PNG con canal alfa se guarda como DOS objetos Image (la imagen y su máscara SMask).
const OBJETOS_POR_IMAGEN = 2;
const imagenesEmbebidas = (bytes: Uint8Array) => (Buffer.from(bytes).toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;

describe('generarPdfEtiquetas — un QR distinto por página', () => {
  it('un arreglo de QR embebe una imagen por etiqueta y mantiene el orden y el texto', async () => {
    const qrs = [PNG_1X1, PNG_1X1_OTRO, PNG_1X1];
    const bytes = await generarPdfEtiquetas({
      spec: TAMANOS.mediana,
      qrDataUrl: qrs,
      origin: ORIGIN,
      codigos: ['02-001-P01', '02-001-P02', '02-001-P03'],
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    expect(textosImpresos(bytes)).toEqual(['P01', 'P02', 'P03']);
    // Una imagen por página (no una compartida): es lo que permite que cada individuo tenga su QR.
    expect(imagenesEmbebidas(bytes)).toBe(3 * OBJETOS_POR_IMAGEN);
  });

  it('un solo QR (string) se sigue compartiendo entre todas las páginas: una única imagen', async () => {
    const bytes = await generarPdfEtiquetas({
      spec: TAMANOS.mediana,
      qrDataUrl: PNG_1X1,
      origin: ORIGIN,
      codigos: ['02-001-P01', '02-001-P02', '02-001-P03'],
    });
    expect(imagenesEmbebidas(bytes)).toBe(1 * OBJETOS_POR_IMAGEN);
  });

  it('exige la misma cantidad de QR que de etiquetas', async () => {
    await expect(
      generarPdfEtiquetas({ spec: TAMANOS.mediana, qrDataUrl: [PNG_1X1, PNG_1X1_OTRO], origin: ORIGIN, codigos: ['a', 'b', 'c'] }),
    ).rejects.toThrow(/misma cantidad/);
  });
});

describe('unirPdfs', () => {
  it('une las partes página por página, en orden, sin perder texto ni imágenes', async () => {
    const a = await generarPdfEtiquetas({ spec: TAMANOS.mediana, qrDataUrl: [PNG_1X1, PNG_1X1_OTRO], origin: ORIGIN, codigos: ['x-P1', 'x-P2'] });
    const b = await generarPdfEtiquetas({ spec: TAMANOS.mediana, qrDataUrl: [PNG_1X1_OTRO], origin: ORIGIN, codigos: ['x-P3'] });
    const c = await generarPdfEtiquetas({ spec: TAMANOS.mediana, qrDataUrl: [PNG_1X1, PNG_1X1], origin: ORIGIN, codigos: ['x-P4', 'x-P5'] });

    const unido = await unirPdfs([a, b, c]);
    expect((await PDFDocument.load(unido)).getPageCount()).toBe(5);
    expect(textosImpresos(unido)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    expect(imagenesEmbebidas(unido)).toBe(5 * OBJETOS_POR_IMAGEN);
  });

  it('con una sola parte la devuelve tal cual', async () => {
    const a = await generarPdfEtiquetas({ spec: TAMANOS.mediana, qrDataUrl: PNG_1X1, origin: ORIGIN, codigos: ['x-P1'] });
    expect(await unirPdfs([a])).toBe(a);
  });
});
