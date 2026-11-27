/**
 * Escáner de QR con la cámara del dispositivo (@yudiel/react-qr-scanner).
 * Acepta tanto la URL completa (https://app/planta/<uuid>) como el path
 * (/planta/<uuid>) como un UUID pelado (cruce) — así los QR impresos siguen
 * sirviendo aunque cambie el dominio de la app. Acepta también el QR de un
 * individuo (/individuo/<uuid>, con o sin origen). También acepta el formato viejo de los
 * QR físicos migrados desde Notion (notion.so/{codigo_sistema}-{hash}), que
 * no se pueden reimprimir: se extrae el codigo_sistema y quien procese el
 * resultado lo resuelve a UUID (ver ResultadoQR).
 */
import { useState } from 'react';
import {
  Scanner,
  type IDetectedBarcode,
  type IScannerError,
  setZXingModuleOverrides,
} from '@yudiel/react-qr-scanner';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import * as Sentry from '@sentry/react';

// El decoder (zxing-wasm, vía barcode-detector/ponyfill) por default trae el
// .wasm desde jsDelivr en runtime. La CSP de producción (vercel.json) no abre
// ningún CDN externo en connect-src/script-src a propósito, así que ese fetch
// queda bloqueado y el escáner nunca decodifica nada (la cámara prende igual,
// porque eso no depende de la CSP). Servimos el binario como asset propio:
// Vite lo copia a dist/ con `?url` y así no hace falta tocar la CSP.
setZXingModuleOverrides({
  locateFile: (path: string) => (path.endsWith('.wasm') ? zxingReaderWasmUrl : path),
});

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// QR de un INDIVIDUO: `/individuo/<uuid>`, con o sin origen delante (la etiqueta
// pequeña no lleva origen). Exige el segmento completo y que el UUID termine ahí,
// para no confundirlo con un UUID cualquiera que aparezca más adelante.
const INDIVIDUO_RE = /(?:^|\/)individuo\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

// El id de página de Notion es siempre 32 hex sin guiones, pegado con un "-"
// al final de la URL. Todo lo anterior es el codigo_sistema tal cual se
// escribió en Notion (ej. "02-002"), sea cual sea su forma exacta.
const NOTION_RE = /notion\.so\/(.+)-[0-9a-f]{32}(?:[/?#]|$)/i;

// Mensaje accionable por tipo de falla que reporta la librería. El celular es
// una caja negra sin cable a DevTools, así que el error se muestra EN PANTALLA
// además de ir a Sentry. `message`/`kind` no contienen datos de negocio, así
// que es seguro mostrarlos (a diferencia de errores de Supabase con linaje).
const HINT_POR_KIND: Record<IScannerError['kind'], string> = {
  'permission-denied': 'Diste "bloquear" al permiso de cámara. Habilita la cámara para este sitio en los ajustes del navegador y recarga.',
  'no-camera': 'No se encontró ninguna cámara en el dispositivo.',
  'in-use': 'La cámara está ocupada por otra app. Cierra la otra app y recarga.',
  'overconstrained': 'No se pudo usar la cámara trasera de este dispositivo.',
  'insecure-context': 'La cámara solo funciona en una conexión segura (HTTPS). Abre la app desde su dirección habitual.',
  'unsupported': 'Este navegador no permite usar la cámara para leer códigos QR.',
  'aborted': 'El arranque de la cámara se canceló. Reintenta.',
  'security': 'El navegador bloqueó el acceso a la cámara por seguridad.',
  'type-error': 'El escáner no se pudo iniciar. Recarga la página.',
  'unknown': 'El escáner falló. Recarga la página e intenta de nuevo.',
};

export type ResultadoQR =
  | { tipo: 'id'; valor: string }
  | { tipo: 'individuo'; valor: string }
  | { tipo: 'codigo_sistema'; valor: string };

/**
 * Interpreta lo que codifique el QR. El orden de las reglas es parte del
 * contrato y no se debe alterar:
 *
 *   1. `/individuo/<uuid>` (con o sin origen) -> { tipo: 'individuo' }.
 *   2. Cualquier otro texto que contenga un UUID -> { tipo: 'id' }, que es el
 *      CRUCE. INVARIANTE: un UUID pelado significa "cruce" PARA SIEMPRE. Las
 *      etiquetas pequeñas ya impresas lo codifican así y no se reimprimen en
 *      bloque; un QR de individuo nunca se emite como UUID pelado.
 *   3. QR viejo de Notion -> { tipo: 'codigo_sistema' }.
 *   4. Nada reconocible -> null.
 *
 * La regla 1 va antes que la 2 porque la URL de un individuo también contiene
 * un UUID: si se evaluara después, un QR de individuo se leería como un cruce
 * y la ficha respondería «Cruce no encontrado».
 */
export function interpretarQR(contenido: string): ResultadoQR | null {
  const individuo = contenido.match(INDIVIDUO_RE);
  if (individuo) return { tipo: 'individuo', valor: individuo[1].toLowerCase() };

  const uuid = contenido.match(UUID_RE);
  if (uuid) return { tipo: 'id', valor: uuid[0].toLowerCase() };

  const notion = contenido.match(NOTION_RE);
  if (notion) return { tipo: 'codigo_sistema', valor: notion[1] };

  return null;
}

export function QRScanner({
  onResultado,
  onNoReconocido,
}: {
  onResultado: (resultado: ResultadoQR) => void;
  onNoReconocido: (contenido: string) => void;
}) {
  const [fallo, setFallo] = useState<IScannerError | null>(null);

  const handleScan = (codes: IDetectedBarcode[]) => {
    const raw = codes[0]?.rawValue;
    if (!raw) return;
    const resultado = interpretarQR(raw);
    if (resultado) onResultado(resultado);
    else onNoReconocido(raw);
  };

  const handleError = (err: IScannerError) => {
    setFallo(err);
    // Solo kind + message; nunca `cause` crudo (puede traer detalle del entorno).
    Sentry.captureException(new Error(`Scanner error: ${err.kind}`), {
      tags: { scanner_error_kind: err.kind },
    });
  };

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border">
        <Scanner
          onScan={handleScan}
          onError={handleError}
          constraints={{ facingMode: 'environment' }} // cámara trasera
          components={{ torch: true }}                // linterna si el equipo la tiene
        />
      </div>
      {fallo && (
        <div className="rounded-lg border border-danger bg-danger-l p-3 text-sm text-danger">
          <p className="font-medium">No se pudo escanear ({fallo.kind})</p>
          <p>{HINT_POR_KIND[fallo.kind]}</p>
          <p className="mt-1 break-words font-mono text-xs text-danger">{fallo.message}</p>
        </div>
      )}
    </div>
  );
}
