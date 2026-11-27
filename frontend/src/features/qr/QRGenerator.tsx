/**
 * Genera el QR de una planta (lado admin) y arma un PDF descargable para
 * imprimir la etiqueta en 3 tamaños físicos fijos, agnóstico de marca de
 * impresora.
 *
 * El layout de la etiqueta y el mecanismo de descarga viven en
 * `etiquetaPdf.ts` (extraídos de acá sin cambios de comportamiento, para que
 * la descarga en tanda reutilice exactamente la misma definición en vez de
 * duplicarla). Este componente aporta lo que sí es suyo: el QR renderizado en
 * pantalla y los canvas ocultos que producen el PNG en alta resolución.
 *
 * Qué codifica cada QR vive en qrContenido.ts (única definición, comprobada
 * contra el escáner): la etiqueta de un individuo codifica `/individuo/<uuid>`
 * — con origen en grande/mediana, sin origen en la pequeña (QR ~11mm) para
 * mantenerse escaneable —; la de un cruce sin individualizar codifica la URL
 * /planta/<uuid>, o el UUID pelado en la pequeña. Un UUID pelado significa
 * «cruce» para siempre (etiquetas ya impresas), nunca «individuo».
 */
import { useRef, useState } from 'react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  descargarBlob,
  generarPdfEtiqueta,
  numeroCortoIndividuo,
  QR_CANVAS_PX,
  TAMANOS,
  type TamanoEtiqueta,
} from './etiquetaPdf';
import { contenidoQr } from './qrContenido';

export function QRGenerator({
  plantaId,
  codigoSistema,
  individuo,
  compacto = false,
}: {
  plantaId: string;
  codigoSistema: string;
  /** Cuando se imprime la etiqueta de UN individuo puntual (no del cruce
   * completo): su id y su `codigo_display` (ej. "02-001-P01"). El QR codifica
   * la identidad de ESE individuo (`/individuo/<id>`); la etiqueta imprime solo
   * el número corto ("P01"), nunca el código completo del cruce (North Star v5,
   * sección 7). Se pasan juntos a propósito: no se puede imprimir el texto de un
   * individuo con el QR de otra cosa. */
  individuo?: { id: string; codigo: string };
  /** Zona D (Ronda 2b): QR más chico + botones de descarga apilados, para caber en una columna angosta. */
  compacto?: boolean;
}) {
  const destino = individuo ? { individuoId: individuo.id } : { plantaId };
  const url = contenidoQr(destino, false, window.location.origin);
  const contenidoCorto = contenidoQr(destino, true, window.location.origin);
  const individuoCodigo = individuo?.codigo;
  const qrUrlCanvasRef = useRef<HTMLCanvasElement>(null);
  const qrUuidCanvasRef = useRef<HTMLCanvasElement>(null);
  const [generando, setGenerando] = useState<TamanoEtiqueta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generar = async (tamano: TamanoEtiqueta) => {
    const spec = TAMANOS[tamano];
    const canvas = spec.usaUuid ? qrUuidCanvasRef.current : qrUrlCanvasRef.current;
    if (!canvas) return;

    setError(null);
    setGenerando(tamano);
    try {
      const qrDataUrl = canvas.toDataURL('image/png');
      const pdfBytes = await generarPdfEtiqueta(spec, qrDataUrl, window.location.origin, individuoCodigo);
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      descargarBlob(blob, `etiqueta-${individuoCodigo ?? codigoSistema}-${tamano}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar la etiqueta.');
    } finally {
      setGenerando(null);
    }
  };

  return (
    <div className={compacto ? 'space-y-2.5' : 'space-y-3'}>
      <div className="flex flex-col items-center gap-3">
        <QRCodeSVG value={url} size={compacto ? 104 : 192} marginSize={2} />
        {individuoCodigo && <p className="font-mono text-lg font-semibold">{numeroCortoIndividuo(individuoCodigo)}</p>}
      </div>

      {/* Canvas ocultos en alta resolución, solo para embeber el QR como PNG en el PDF. */}
      <div className="hidden">
        <QRCodeCanvas ref={qrUrlCanvasRef} value={url} size={QR_CANVAS_PX} marginSize={2} />
        <QRCodeCanvas ref={qrUuidCanvasRef} value={contenidoCorto} size={QR_CANVAS_PX} marginSize={2} />
      </div>

      <div className="space-y-2">
        {!compacto && <p className="text-xs text-ink-3">Descargar etiqueta (PDF):</p>}
        <div className={compacto ? 'flex flex-col gap-1.5' : 'flex flex-wrap gap-2'}>
          {(Object.keys(TAMANOS) as TamanoEtiqueta[]).map((t) => (
            <Button
              key={t}
              variant="outline"
              size="sm"
              className={compacto ? 'justify-start' : undefined}
              onClick={() => generar(t)}
              disabled={generando !== null}
            >
              <Download className="h-4 w-4" /> {generando === t ? 'Generando…' : TAMANOS[t].label}
            </Button>
          ))}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
