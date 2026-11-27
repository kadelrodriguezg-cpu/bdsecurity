/**
 * Descarga de etiquetas en tanda para varios individuos de un mismo cruce.
 *
 * Etiquetar en terreno significa imprimir hasta ~300 etiquetas de un
 * cruzamiento; hacerlo de a una es inviable a ese volumen. Este panel toma la
 * selección hecha en el Explorador de individuos y genera todo en el
 * navegador — sin servidor ni Edge Function — reutilizando el mismo layout
 * de `etiquetaPdf.ts` que produce la etiqueta individual. Acá no hay ninguna
 * definición de layout propia.
 *
 * Dos decisiones se toman al momento de descargar, y aplican a toda la tanda:
 * el tamaño físico (no se mezclan tamaños en una misma descarga: la impresora
 * está cargada con un solo tipo de etiqueta) y el formato de salida.
 *
 * Cada etiqueta lleva el QR de SU individuo (`/individuo/<uuid>`, ver
 * qrContenido.ts): abre directo a ese individuo y la planta conserva su
 * identidad aunque el número corto impreso (ej. "P01") se borre. Como los QR
 * son todos distintos, ya no alcanza con un par de canvas fijos: se usa un
 * único canvas oculto cuyo contenido se cambia de a uno, y se captura su PNG
 * antes de pasar al siguiente. Un canvas por etiqueta (300 de 600x600 px)
 * costaría cientos de MB de memoria.
 *
 * Memoria: pdf-lib conserva decodificada cada imagen embebida hasta guardar el
 * documento. Por eso la tanda se arma en bloques de ETIQUETAS_POR_BLOQUE (25), se
 * guarda cada bloque y los PDF se unen al final (unirPdfs): el pico de memoria
 * es el de un bloque, no el de toda la tanda.
 *
 * Formato: ZIP, nunca RAR. RAR es propietario y no tiene forma viable de
 * generarse en el navegador.
 */
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { Download, FileArchive, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import {
  descargarBlob,
  ETIQUETAS_POR_BLOQUE,
  generarPdfEtiqueta,
  generarPdfEtiquetas,
  QR_CANVAS_PX,
  TAMANOS,
  unirPdfs,
  type TamanoEtiqueta,
} from './etiquetaPdf';
import { contenidoQr } from './qrContenido';

type FormatoSalida = 'pdf_unico' | 'zip';

const FORMATOS: { valor: FormatoSalida; titulo: string; detalle: string; icono: typeof FileText }[] = [
  {
    valor: 'pdf_unico',
    titulo: 'PDF único, una etiqueta por página',
    detalle: 'Un solo archivo listo para mandar a la impresora de corrido.',
    icono: FileText,
  },
  {
    valor: 'zip',
    titulo: 'ZIP con un PDF por individuo',
    detalle: 'Un archivo por etiqueta, para reimprimir individuos sueltos después.',
    icono: FileArchive,
  },
];

/**
 * Cada cuántas etiquetas se le devuelve el control al navegador durante la
 * tanda. Sin esto el contador "Generando N de M" quedaría congelado hasta el
 * final: el loop ocuparía el hilo principal completo y React no alcanzaría a
 * repintar. No es procesamiento en background — es solo dejar respirar a la UI.
 */
const ETIQUETAS_POR_RESPIRO = 20;

const cederHilo = () => new Promise<void>((resolver) => setTimeout(resolver, 0));

export function DescargaEtiquetasEnTanda({
  abierto,
  onCerrar,
  codigoSistema,
  individuos,
}: {
  abierto: boolean;
  onCerrar: () => void;
  codigoSistema: string;
  /** Individuos seleccionados, en el orden de la lista: cada uno recibe una etiqueta con SU QR. */
  individuos: { id: string; codigo_display: string }[];
}) {
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const [contenidoQrActual, setContenidoQrActual] = useState('');
  const [tamano, setTamano] = useState<TamanoEtiqueta>('mediana');
  const [formato, setFormato] = useState<FormatoSalida>('pdf_unico');
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = individuos.length;
  const generando = progreso !== null;

  /**
   * PNG del QR con el contenido pedido. qrcode.react dibuja en un efecto, así
   * que se fuerza el render y se cede el hilo antes de leer el canvas. Si dos
   * contenidos distintos dieran el mismo PNG, el canvas no se actualizó y se
   * imprimirían dos etiquetas con el mismo QR: se aborta en vez de seguir.
   */
  const ultimo = useRef<{ contenido: string; png: string } | null>(null);
  const generarQrPng = async (contenido: string): Promise<string> => {
    flushSync(() => setContenidoQrActual(contenido));
    await cederHilo();
    const canvas = qrCanvasRef.current;
    if (!canvas) throw new Error('No se pudo generar el QR de la etiqueta.');
    const png = canvas.toDataURL('image/png');
    const previo = ultimo.current;
    if (previo && previo.contenido !== contenido && previo.png === png) {
      throw new Error('El QR no se actualizó entre dos etiquetas; se canceló la descarga para no imprimir QR repetidos.');
    }
    ultimo.current = { contenido, png };
    return png;
  };

  const descargar = async () => {
    const spec = TAMANOS[tamano];
    if (total === 0) return;

    setError(null);
    setProgreso({ hechas: 0, total });
    ultimo.current = null;
    const origin = window.location.origin;
    try {
      // Valida todos los ids antes de generar nada: un id inválido no debe descubrirse a la mitad.
      const contenidos = individuos.map((individuo) => contenidoQr({ individuoId: individuo.id }, spec.usaUuid, origin));

      if (formato === 'pdf_unico') {
        const partes: Uint8Array[] = [];
        for (let desde = 0; desde < total; desde += ETIQUETAS_POR_BLOQUE) {
          const hasta = Math.min(desde + ETIQUETAS_POR_BLOQUE, total);
          const qrs: string[] = [];
          for (let i = desde; i < hasta; i++) qrs.push(await generarQrPng(contenidos[i]));
          partes.push(
            await generarPdfEtiquetas({
              spec,
              qrDataUrl: qrs,
              origin,
              codigos: individuos.slice(desde, hasta).map((individuo) => individuo.codigo_display),
            }),
          );
          setProgreso({ hechas: hasta, total });
          await cederHilo();
        }
        const pdfBytes = await unirPdfs(partes);
        descargarBlob(
          new Blob([pdfBytes as BlobPart], { type: 'application/pdf' }),
          `etiquetas-${codigoSistema}-${tamano}-${total}.pdf`,
        );
      } else {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        for (let i = 0; i < total; i++) {
          const codigo = individuos[i].codigo_display;
          const pdfBytes = await generarPdfEtiqueta(spec, await generarQrPng(contenidos[i]), origin, codigo);
          // Mismo nombre que la descarga individual, para que un PDF sacado
          // del ZIP sea indistinguible de uno bajado de a uno.
          zip.file(`etiqueta-${codigo}-${tamano}.pdf`, pdfBytes);
          if ((i + 1) % ETIQUETAS_POR_RESPIRO === 0 || i + 1 === total) {
            setProgreso({ hechas: i + 1, total });
            await cederHilo();
          }
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        descargarBlob(blob, `etiquetas-${codigoSistema}-${tamano}-${total}.zip`);
      }

      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron generar las etiquetas.');
    } finally {
      setProgreso(null);
    }
  };

  return (
    <Modal open={abierto} onClose={onCerrar} title={`Descargar etiquetas (${total})`}>
      <div className="space-y-5">
        <p className="text-small text-ink-3">
          Se generarán {total} {total === 1 ? 'etiqueta' : 'etiquetas'} del cruce {codigoSistema}, todas del mismo
          tamaño. Cada etiqueta imprime solo el número corto del individuo; su QR es único: abre directo la ficha
          de ese individuo.
        </p>

        <fieldset className="space-y-2" disabled={generando}>
          <legend className="mb-1.5 text-small font-semibold text-ink-2">Tamaño de etiqueta</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(TAMANOS) as TamanoEtiqueta[]).map((t) => (
              <label
                key={t}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5 text-body',
                  tamano === t ? 'border-primary bg-brand-l text-brand-ink' : 'border-line-strong bg-surface-2 text-ink-2',
                  generando && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="tamano-etiqueta"
                  value={t}
                  checked={tamano === t}
                  onChange={() => setTamano(t)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="font-semibold">{TAMANOS[t].label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2" disabled={generando}>
          <legend className="mb-1.5 text-small font-semibold text-ink-2">Formato de salida</legend>
          <div className="space-y-2">
            {FORMATOS.map(({ valor, titulo, detalle, icono: Icono }) => (
              <label
                key={valor}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5',
                  formato === valor ? 'border-primary bg-brand-l' : 'border-line-strong bg-surface-2',
                  generando && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="formato-etiquetas"
                  value={valor}
                  checked={formato === valor}
                  onChange={() => setFormato(valor)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <Icono className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                <span className="min-w-0">
                  <span className="block text-body font-semibold text-ink">{titulo}</span>
                  <span className="block text-small text-ink-3">{detalle}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <Alert>{error}</Alert>}

        {generando && (
          <p className="text-small text-ink-2" role="status">
            Generando {progreso.hechas} de {progreso.total}…
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCerrar} disabled={generando}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void descargar()} disabled={generando || total === 0}>
            <Download className="h-4 w-4" />
            {generando ? 'Generando…' : `Descargar ${total} ${total === 1 ? 'etiqueta' : 'etiquetas'}`}
          </Button>
        </div>

        {/* Un solo canvas oculto en alta resolución: se le cambia el contenido y se captura su PNG, de a uno. */}
        <div className="hidden">
          <QRCodeCanvas ref={qrCanvasRef} value={contenidoQrActual || ' '} size={QR_CANVAS_PX} marginSize={2} />
        </div>
      </div>
    </Modal>
  );
}
