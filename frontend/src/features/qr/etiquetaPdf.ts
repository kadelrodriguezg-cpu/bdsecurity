/**
 * Layout y generación de la etiqueta física en PDF (pdf-lib), extraído de
 * `QRGenerator.tsx` sin cambios de comportamiento.
 *
 * Motivo de la extracción: la descarga masiva de etiquetas necesita
 * exactamente el mismo layout, repetido N veces. Reimplementarlo en el flujo
 * en tanda dejaría dos definiciones del layout físico que se pueden
 * desincronizar en silencio — y la etiqueta es un objeto que se imprime y se
 * pega en terreno, así que una divergencia recién se descubre con la
 * impresora andando. Acá vive la única definición; `QRGenerator` y la
 * descarga en tanda son dos consumidores del mismo módulo.
 *
 * NO se usa window.print(): tanto iframe.contentWindow.print() como el print
 * top-level con @media print + @page fallan en Chrome/Brave Android — ese
 * motor rasteriza el viewport de la app en vez de aplicar @page (comportamiento
 * documentado en el tracker de Chromium y en react-to-print, ver historial de
 * QRGenerator.tsx). La única ruta confiable en todas las plataformas es generar
 * un PDF cuya página YA mide los mm exactos: la geometría viaja adentro del
 * archivo, así que cualquier visor/impresora la respeta sin depender del motor
 * de impresión del navegador.
 *
 * pdf-lib se carga con import() dinámico recién al generar, para no sumar peso
 * al bundle principal. Los `import type` de acá se borran en compilación, así
 * que no reintroducen esa dependencia estática.
 */
import type { PDFDocument, PDFFont, PDFImage } from 'pdf-lib';

export type TamanoEtiqueta = 'grande' | 'mediana' | 'pequena';

export interface SpecEtiqueta {
  label: string;
  w: number;
  h: number;
  qr: number;
  gap: number;
  codigo: boolean;
  especie: boolean;
  logo: boolean;
  fuenteCodigo: number;
  fuenteEspecie: number;
  usaUuid: boolean;
}

export const TAMANOS: Record<TamanoEtiqueta, SpecEtiqueta> = {
  grande:  { label: 'Grande 70×100', w: 70, h: 100, qr: 50, gap: 3, codigo: true,  especie: false, logo: true,  fuenteCodigo: 26, fuenteEspecie: 0,  usaUuid: false },
  mediana: { label: 'Mediana 50×60', w: 50, h: 60,  qr: 38, gap: 2, codigo: true,  especie: false, logo: false, fuenteCodigo: 18, fuenteEspecie: 0,  usaUuid: false },
  pequena: { label: 'Pequeña 13×40', w: 40, h: 13,  qr: 11, gap: 0, codigo: false, especie: false, logo: false, fuenteCodigo: 0,  fuenteEspecie: 0,  usaUuid: true },
};

export const MM_TO_PT = 2.834645669291339;
/** Resolución del PNG del QR embebido en el PDF; alcanza para el QR más grande (50mm). */
export const QR_CANVAS_PX = 600;

/**
 * Texto impreso en la etiqueta (North Star v5, sección 7 — postura
 * anti-reconocimiento): antes de individualizar, la etiqueta del cruce NUNCA
 * imprime el código del cruzamiento (nada legible sin escanear). Una vez
 * individualizado, la etiqueta de CADA individuo imprime únicamente su
 * número corto (ej. "P01"), nunca el código completo del cruce
 * (`{codigo_cruce}-P01`). El QR de la etiqueta de un individuo codifica la
 * identidad de ESE individuo (`/individuo/<uuid>`, ver qrContenido.ts), así que
 * la planta conserva su identidad aunque el número impreso se borre; el
 * texto visible sigue siendo solo el número corto.
 */
export function numeroCortoIndividuo(codigoDisplay: string): string {
  const i = codigoDisplay.lastIndexOf('-');
  return i === -1 ? codigoDisplay : codigoDisplay.slice(i + 1);
}

/**
 * Recursos embebidos UNA vez por documento y compartidos por todas sus
 * páginas. pdf-lib liga imágenes y fuentes al PDFDocument, así que embeberlos
 * por página duplicaría el logo y la fuente dentro del archivo.
 */
interface RecursosEtiqueta {
  logoImg: PDFImage | null;
  logoWidthPt: number;
  logoHeightPt: number;
  courier: PDFFont | null;
}

/**
 * Dibuja una etiqueta completa en una página nueva del documento.
 *
 * Mismo orden que el layout aprobado: logo -> QR -> texto, apilados y
 * centrados verticalmente en la página (equivalente al flex column +
 * justify-content:center que se usaba en el CSS de impresión).
 */
function agregarPaginaEtiqueta(
  pdfDoc: PDFDocument,
  spec: SpecEtiqueta,
  recursos: RecursosEtiqueta,
  /** Número corto ya resuelto, o null para no imprimir texto (etiqueta del cruce). */
  texto: string | null,
  /** QR de ESTA etiqueta. */
  qrImg: PDFImage,
): void {
  const pageW = spec.w * MM_TO_PT;
  const pageH = spec.h * MM_TO_PT;
  const page = pdfDoc.addPage([pageW, pageH]);

  const { logoImg, logoWidthPt, logoHeightPt, courier } = recursos;
  const qrSizePt = spec.qr * MM_TO_PT;
  const gapPt = spec.gap * MM_TO_PT;

  const dibujaTexto = courier !== null && texto !== null;
  const textoSizePt = spec.fuenteCodigo;
  const textoHeightPt = dibujaTexto ? courier.heightAtSize(textoSizePt, { descender: false }) : 0;
  const textoWidthPt = dibujaTexto ? courier.widthOfTextAtSize(texto, textoSizePt) : 0;

  const bloques = [
    ...(logoImg ? [logoHeightPt] : []),
    qrSizePt,
    ...(dibujaTexto ? [textoHeightPt] : []),
  ];
  const alturaTotal = bloques.reduce((s, h) => s + h, 0) + gapPt * (bloques.length - 1);
  let cursor = (pageH - alturaTotal) / 2; // distancia acumulada desde el borde superior

  const siguienteY = (alturaBloque: number) => {
    const y = pageH - cursor - alturaBloque; // pdf-lib mide y desde abajo de la página
    cursor += alturaBloque + gapPt;
    return y;
  };

  if (logoImg) {
    const y = siguienteY(logoHeightPt);
    page.drawImage(logoImg, { x: (pageW - logoWidthPt) / 2, y, width: logoWidthPt, height: logoHeightPt });
  }

  {
    const y = siguienteY(qrSizePt);
    page.drawImage(qrImg, { x: (pageW - qrSizePt) / 2, y, width: qrSizePt, height: qrSizePt });
  }

  if (dibujaTexto) {
    const y = siguienteY(textoHeightPt);
    page.drawText(texto, { x: (pageW - textoWidthPt) / 2, y, size: textoSizePt, font: courier });
  }
}

export interface OpcionesEtiquetas {
  spec: SpecEtiqueta;
  /**
   * PNG del QR como data URL. Un solo string = el mismo QR en todas las páginas
   * (etiqueta de un cruce). Un arreglo = un QR por página, en el mismo orden y
   * con la misma longitud que `codigos` (etiquetas de individuos: cada una
   * lleva el QR de SU individuo).
   */
  qrDataUrl: string | string[];
  /** window.location.origin — desde donde se trae el logo de marca. */
  origin: string;
  /**
   * Un `codigo_display` por página, en orden. `null` imprime la etiqueta sin
   * texto (cruce todavía sin individualizar).
   */
  codigos: (string | null)[];
}

/**
 * Un PDF con una etiqueta por página, todas del mismo tamaño físico. Con un
 * solo código es exactamente la etiqueta individual de siempre.
 */
export async function generarPdfEtiquetas({ spec, qrDataUrl, origin, codigos }: OpcionesEtiquetas): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();

  if (Array.isArray(qrDataUrl) && qrDataUrl.length !== codigos.length) {
    throw new Error(`Hay ${qrDataUrl.length} QR para ${codigos.length} etiquetas: deben ser la misma cantidad.`);
  }
  // pdf-lib conserva en memoria los canales decodificados de cada PNG hasta
  // `save()`: embeber muchos QR distintos en un solo documento es lo que más
  // memoria cuesta. Por eso la tanda se arma por bloques (ver unirPdfs).
  const qrImgs: PDFImage[] = [];
  for (const url of Array.isArray(qrDataUrl) ? qrDataUrl : [qrDataUrl]) qrImgs.push(await pdfDoc.embedPng(url));

  let logoImg: PDFImage | null = null;
  let logoWidthPt = 0;
  let logoHeightPt = 0;
  if (spec.logo) {
    const bytes = await fetch(`${origin}/brand-logo.png`).then((r) => r.arrayBuffer());
    logoImg = await pdfDoc.embedPng(bytes);
    logoHeightPt = 10 * MM_TO_PT;
    logoWidthPt = logoImg.scale(logoHeightPt / logoImg.height).width;
  }

  // Solo se imprime el número corto del individuo (ej. "P01") — nunca el
  // código del cruce. Si ninguna etiqueta lleva texto, no se embebe la fuente.
  const textos = codigos.map((c) => (spec.codigo && c ? numeroCortoIndividuo(c) : null));
  const courier = textos.some((t) => t !== null) ? await pdfDoc.embedFont(StandardFonts.CourierBold) : null;

  const recursos: RecursosEtiqueta = { logoImg, logoWidthPt, logoHeightPt, courier };
  textos.forEach((texto, i) => agregarPaginaEtiqueta(pdfDoc, spec, recursos, texto, qrImgs[Array.isArray(qrDataUrl) ? i : 0]));

  return pdfDoc.save();
}

/**
 * Cuántas etiquetas se arman en un mismo documento antes de guardarlo. Acota el
 * pico de memoria del navegador (sobre todo en un celular): con QR distintos,
 * cada imagen embebida pesa ~1,4 MB decodificada hasta guardar el documento.
 * Medido en Chromium con CPU 4x más lenta y 300 etiquetas medianas (memoria
 * adicional del navegador, mismo tiempo en todos los casos, ~29 s): sin bloques
 * +492 MB; bloques de 50 +298 MB; de 25 +200 MB; de 10 +161 MB. Se eligió 25.
 */
export const ETIQUETAS_POR_BLOQUE = 25;

/**
 * Une varios PDF en uno, página por página y en orden. Las partes ya están
 * guardadas (sus imágenes quedan comprimidas), así que unirlas no vuelve a
 * decodificar los PNG: el pico de memoria es el de UN bloque, no el de la tanda.
 */
export async function unirPdfs(partes: Uint8Array[]): Promise<Uint8Array> {
  if (partes.length === 1) return partes[0];
  const { PDFDocument } = await import('pdf-lib');
  const unido = await PDFDocument.create();
  for (const parte of partes) {
    const origen = await PDFDocument.load(parte);
    const paginas = await unido.copyPages(origen, origen.getPageIndices());
    for (const pagina of paginas) unido.addPage(pagina);
  }
  return unido.save();
}

/** Etiqueta de un solo individuo (o del cruce, si no se pasa código). */
export async function generarPdfEtiqueta(
  spec: SpecEtiqueta,
  qrDataUrl: string,
  origin: string,
  individuoCodigo?: string,
): Promise<Uint8Array> {
  return generarPdfEtiquetas({ spec, qrDataUrl, origin, codigos: [individuoCodigo ?? null] });
}

/**
 * Descarga un blob con `<a download>`. Mismo mecanismo que usaba QRGenerator
 * en línea: el objectURL se revoca con retraso porque revocarlo de inmediato
 * cancela la descarga en algunos navegadores.
 */
export function descargarBlob(blob: Blob, nombreArchivo: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
}
