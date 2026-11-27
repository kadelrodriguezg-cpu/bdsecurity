/**
 * Barra de acciones + sus paneles (etiquetas, escaneo, baja en lote) para una
 * lista de individuos de un cruce. Las dos listas (IndividuosSeccion y el
 * Explorador) la montan igual; cada una conserva su propio estado de selección
 * (useSeleccionMultiple), que no se pierde al filtrar ni al desplazar la lista.
 */
import { useState } from 'react';
import type { Individuo } from '@/api/individuos';
import type { SeleccionMultiple } from '@/lib/useSeleccionMultiple';
import { useAuth } from '@/features/auth/AuthContext';
import { DescargaEtiquetasEnTanda } from '@/features/qr/DescargaEtiquetasEnTanda';
import { Alert } from '@/components/ui/alert';
import { BarraSeleccionIndividuos } from './BarraSeleccionIndividuos';
import { EscanearParaSeleccion } from './EscanearParaSeleccion';
import { RevisionBajaLote } from './RevisionBajaLote';

type Panel = 'etiquetas' | 'escaneo' | 'baja' | null;

export function AccionesSeleccionIndividuos({
  seleccion,
  individuos,
  codigoSistema,
  onSalir,
}: {
  seleccion: SeleccionMultiple<Individuo>;
  /** Cruce completo (para resolver los QR escaneados). */
  individuos: Individuo[];
  codigoSistema: string;
  onSalir: () => void;
}) {
  const { esAdmin } = useAuth();
  const [panel, setPanel] = useState<Panel>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const cerrar = () => setPanel(null);

  return (
    <>
      {aviso && (
        <Alert variant="success" className="mb-2">{aviso}</Alert>
      )}
      {/* Reserva el alto de la barra fija: sin esto tapa las últimas filas. */}
      <div aria-hidden className="h-28" />

      <BarraSeleccionIndividuos
        seleccion={seleccion}
        esAdmin={esAdmin}
        onEtiquetas={() => setPanel('etiquetas')}
        onEscanear={() => setPanel('escaneo')}
        onDarBaja={() => { setAviso(null); setPanel('baja'); }}
        onSalir={onSalir}
      />

      <DescargaEtiquetasEnTanda
        abierto={panel === 'etiquetas'}
        onCerrar={cerrar}
        codigoSistema={codigoSistema}
        individuos={seleccion.seleccionados}
      />
      <EscanearParaSeleccion abierto={panel === 'escaneo'} onCerrar={cerrar} seleccion={seleccion} individuos={individuos} />
      {esAdmin && (
        <RevisionBajaLote
          abierto={panel === 'baja'}
          onCerrar={cerrar}
          ids={seleccion.idsSeleccionados}
          onConfirmado={(procesados) => {
            cerrar();
            seleccion.limpiar();
            setAviso(`Se dieron de baja ${procesados} individuo(s).`);
          }}
        />
      )}
    </>
  );
}
