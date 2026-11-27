import { inflateSync } from 'node:zlib';

/**
 * Lee lo que el PDF realmente imprime, en orden de página. Hay que hacer dos
 * cosas: inflar los streams de contenido (pdf-lib los guarda con Flate) y
 * decodificar el operador de texto, que para las fuentes estándar queda como
 * cadena hexadecimal (`<503031> Tj` = "P01"), no como literal.
 */
export function textosImpresos(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  const crudo = buffer.toString('latin1');
  let contenido = '';
  let cursor = 0;
  for (;;) {
    const inicio = crudo.indexOf('stream', cursor);
    if (inicio === -1) break;
    let datos = inicio + 'stream'.length;
    if (crudo[datos] === '\r') datos++;
    if (crudo[datos] === '\n') datos++;
    const fin = crudo.indexOf('endstream', datos);
    if (fin === -1) break;
    try {
      contenido += `\n${inflateSync(buffer.subarray(datos, fin)).toString('latin1')}`;
    } catch {
      contenido += `\n${crudo.slice(datos, fin)}`; // stream sin comprimir (imagen): se ignora solo
    }
    cursor = fin + 'endstream'.length;
  }

  const impresos: string[] = [];
  for (const [, hex] of contenido.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    impresos.push(Buffer.from(hex, 'hex').toString('latin1'));
  }
  for (const [, literal] of contenido.matchAll(/\(([^)]*)\)\s*Tj/g)) impresos.push(literal);
  return impresos;
}
