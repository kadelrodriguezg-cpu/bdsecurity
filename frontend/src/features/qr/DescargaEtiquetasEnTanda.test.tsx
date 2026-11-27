/**
 * Descarga de etiquetas en tanda — cada etiqueta lleva el QR de SU individuo.
 *
 * jsdom no tiene canvas, así que el QR real no se puede dibujar acá: se sustituye
 * `qrcode.react` por un canvas falso que devuelve un PNG válido y DISTINTO por
 * contenido. Eso permite comprobar lo que importa de este componente: qué
 * contenido se pide para cada etiqueta (y en qué orden), que N individuos
 * produzcan N páginas / N archivos, que el armado por bloques no pierda ni
 * reordene nada, y que nunca se impriman dos QR iguales. La legibilidad del QR
 * real se verifica aparte, en el navegador (ver informe de la Fase 2).
 */
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

const mocks = vi.hoisted(() => ({
  pedidos: [] as string[],
  descargas: [] as { blob: Blob; nombre: string }[],
  pngPara: null as null | ((contenido: string) => string),
}));

vi.mock('qrcode.react', async () => {
  const React = await import('react');
  return {
    QRCodeCanvas: React.forwardRef<HTMLCanvasElement, { value: string }>(function QRCodeCanvasFalso({ value }, ref) {
      React.useImperativeHandle(ref, () => ({
        toDataURL: () => {
          mocks.pedidos.push(value);
          return mocks.pngPara!(value);
        },
      }) as unknown as HTMLCanvasElement);
      return <canvas data-value={value} />;
    }),
  };
});

vi.mock('./etiquetaPdf', async () => {
  const actual = await vi.importActual<typeof import('./etiquetaPdf')>('./etiquetaPdf');
  return {
    ...actual,
    descargarBlob: (blob: Blob, nombre: string) => {
      mocks.descargas.push({ blob, nombre });
    },
  };
});

import { DescargaEtiquetasEnTanda } from './DescargaEtiquetasEnTanda';
import { textosImpresos } from './textosImpresos';

// ---------- PNG 1x1 válido, de un color que depende del contenido ----------
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(tipo: string, datos: Buffer): Buffer {
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}
function png1x1(r: number, g: number, b: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  const fila = Buffer.from([0, r, g, b]); // filtro 0 + píxel
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(fila)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}
function pngSegunContenido(contenido: string): string {
  let h = 0;
  for (const ch of contenido) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return png1x1(h & 255, (h >>> 8) & 255, (h >>> 16) & 255);
}

// ---------- fixtures ----------
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const individuos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: uuid(i + 1), codigo_display: `02-001-P${i + 1}` }));

function montar(lista: { id: string; codigo_display: string }[]) {
  return render(<DescargaEtiquetasEnTanda abierto onCerrar={vi.fn()} codigoSistema="02-001" individuos={lista} />);
}
function elegir(tamano: RegExp, formato?: RegExp) {
  fireEvent.click(screen.getByRole('radio', { name: tamano }));
  if (formato) fireEvent.click(screen.getByRole('radio', { name: formato }));
}
async function descargar(n: number) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Descargar ${n} etiqueta`) }));
  await waitFor(() => expect(mocks.descargas.length + (screen.queryByRole('alert') ? 1 : 0)).toBeGreaterThan(0), { timeout: 8000 });
}

beforeEach(() => {
  mocks.pedidos = [];
  mocks.descargas = [];
  mocks.pngPara = pngSegunContenido;
});
afterEach(cleanup);

const ORIGIN = window.location.origin;

describe('DescargaEtiquetasEnTanda — un QR por individuo', () => {
  it('PDF único: pide el QR de cada individuo, en orden, con origen (tamaño mediana) y arma una página por individuo', async () => {
    montar(individuos(3));
    elegir(/Mediana/);
    await descargar(3);

    // Sin el canvas de reserva inicial: solo los contenidos de las 3 etiquetas, en orden.
    expect(mocks.pedidos).toEqual([1, 2, 3].map((n) => `${ORIGIN}/individuo/${uuid(n)}`));

    const { blob, nombre } = mocks.descargas[0];
    expect(nombre).toBe('etiquetas-02-001-mediana-3.pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    expect(textosImpresos(bytes)).toEqual(['P1', 'P2', 'P3']);
  });

  it('tamaño pequeño: el QR lleva solo la ruta /individuo/<uuid>, sin origen y nunca el UUID pelado', async () => {
    montar(individuos(2));
    elegir(/Pequeña/);
    await descargar(2);
    expect(mocks.pedidos).toEqual([`/individuo/${uuid(1)}`, `/individuo/${uuid(2)}`]);
    for (const pedido of mocks.pedidos) {
      expect(pedido).not.toBe(uuid(1));
      expect(pedido).not.toBe(uuid(2));
    }
  });

  it('ZIP: un PDF por individuo, cada uno con SU QR y su número corto', async () => {
    montar(individuos(3));
    elegir(/Mediana/, /ZIP con un PDF por individuo/);
    await descargar(3);

    expect(mocks.pedidos).toEqual([1, 2, 3].map((n) => `${ORIGIN}/individuo/${uuid(n)}`));
    const { blob, nombre } = mocks.descargas[0];
    expect(nombre).toBe('etiquetas-02-001-mediana-3.zip');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual([
      'etiqueta-02-001-P1-mediana.pdf',
      'etiqueta-02-001-P2-mediana.pdf',
      'etiqueta-02-001-P3-mediana.pdf',
    ]);
    for (const [i, archivo] of Object.values(zip.files).entries()) {
      const bytes = await archivo.async('uint8array');
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
      expect(textosImpresos(bytes)).toEqual([`P${i + 1}`]);
    }
  });

  it('una tanda larga se arma por bloques y el PDF final conserva TODAS las páginas, en orden', async () => {
    const N = 120; // 5 bloques (4 de 25 + 1 de 20)
    montar(individuos(N));
    elegir(/Mediana/);
    await descargar(N);

    expect(mocks.pedidos).toHaveLength(N);
    expect(new Set(mocks.pedidos).size).toBe(N); // ningún QR repetido
    const bytes = new Uint8Array(await mocks.descargas[0].blob.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(N);
    expect(textosImpresos(bytes)).toEqual(Array.from({ length: N }, (_, i) => `P${i + 1}`));
  }, 30000);

  it('si el canvas no se actualiza entre dos etiquetas, aborta: nunca imprime QR repetidos', async () => {
    mocks.pngPara = () => png1x1(1, 2, 3); // siempre el mismo PNG, aunque cambie el contenido
    montar(individuos(3));
    elegir(/Mediana/);
    await descargar(3);
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se actualizó/i);
    expect(mocks.descargas).toHaveLength(0);
  });

  it('un individuo con id inválido aborta ANTES de generar ninguna etiqueta', async () => {
    montar([...individuos(2), { id: 'P3', codigo_display: '02-001-P3' }]);
    elegir(/Mediana/);
    await descargar(3);
    expect(await screen.findByRole('alert')).toHaveTextContent(/id válido/);
    expect(mocks.pedidos).toEqual([]);
    expect(mocks.descargas).toHaveLength(0);
  });

  it('sin individuos seleccionados el botón de descarga está deshabilitado', () => {
    montar([]);
    expect(screen.getByRole('button', { name: /Descargar 0 etiquetas/ })).toBeDisabled();
  });

  it('explica que cada QR abre la ficha de su individuo (ya no «lleva la identidad completa» del cruce)', () => {
    montar(individuos(1));
    expect(screen.getByText(/su QR es único/)).toBeInTheDocument();
    expect(screen.queryByText(/identidad completa/)).not.toBeInTheDocument();
  });
});
