/**
 * Agrega individuos a la selección escaneando sus etiquetas (QR
 * `/individuo/<uuid>` de B2). Solo agrega, nunca quita: el escáner lee el
 * mismo código varias veces seguidas. Un QR de otro cruce, de un cruce (UUID
 * pelado) o de un individuo de baja no se agrega, y se dice por qué.
 */
import { useState } from 'react';
import type { Individuo } from '@/api/individuos';
import { QRScanner, type ResultadoQR } from '@/components/shared/QRScanner';
import type { SeleccionMultiple } from '@/lib/useSeleccionMultiple';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';

export type MensajeEscaneo = { tipo: 'ok' | 'error'; texto: string };

/** Traduce una lectura a un cambio en la selección y al mensaje que ve el usuario. */
export function aplicarLecturaQR(resultado: ResultadoQR, seleccion: SeleccionMultiple<Individuo>, individuos: Individuo[]): MensajeEscaneo {
  if (resultado.tipo !== 'individuo') {
    return { tipo: 'error', texto: 'Ese QR no es de un individuo: escanea la etiqueta de la planta.' };
  }
  const codigo = individuos.find((i) => i.id === resultado.valor)?.codigo_display;
  switch (seleccion.agregar(resultado.valor)) {
    case 'agregado':
      return { tipo: 'ok', texto: `${codigo} agregado.` };
    case 'ya_estaba':
      return { tipo: 'ok', texto: `${codigo} ya estaba seleccionado.` };
    case 'no_seleccionable':
      return { tipo: 'error', texto: `${codigo} está de baja: no se puede seleccionar.` };
    case 'fuera_de_la_lista':
      return { tipo: 'error', texto: 'Ese individuo no es de este cruce.' };
  }
}

export function EscanearParaSeleccion({
  abierto,
  onCerrar,
  seleccion,
  individuos,
}: {
  abierto: boolean;
  onCerrar: () => void;
  seleccion: SeleccionMultiple<Individuo>;
  individuos: Individuo[];
}) {
  const [mensaje, setMensaje] = useState<MensajeEscaneo | null>(null);

  return (
    <Modal open={abierto} onClose={() => { setMensaje(null); onCerrar(); }} title="Agregar escaneando QR">
      <div className="space-y-3">
        <p className="text-small text-ink-3">
          Escanea las etiquetas de las plantas una tras otra. {seleccion.cantidad} seleccionado(s).
        </p>
        <QRScanner
          onResultado={(resultado) => setMensaje(aplicarLecturaQR(resultado, seleccion, individuos))}
          onNoReconocido={() => setMensaje({ tipo: 'error', texto: 'No se reconoce ese código.' })}
        />
        {mensaje && <Alert variant={mensaje.tipo === 'ok' ? 'success' : 'error'}>{mensaje.texto}</Alert>}
      </div>
    </Modal>
  );
}
