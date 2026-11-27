/**
 * Lista de PCR ya cargados de una ronda (más reciente primero). Antes de esta
 * corrección no existía ningún componente que mostrara los PCR guardados —
 * solo el formulario de carga (PcrForm) — violando el principio 12 del North
 * Star v5: "toda acción de registro sobre un individuo debe tener su
 * contraparte de consulta inmediatamente visible".
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FlaskConical, FileDown } from 'lucide-react';
import { listarPcrDeRonda, urlFirmadaPdfPcr, type PcrRow } from '@/api/rondas';
import { formatearFechaCivil } from '@/lib/fechas';
import { qk } from '@/lib/queryKeys';

function FilaPcr({ pcr }: { pcr: PcrRow }) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abrirPdf = async () => {
    if (!pcr.informe_pdf_url) return;
    try {
      const url = await urlFirmadaPdfPcr(pcr.informe_pdf_url);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el PDF.');
    }
  };

  return (
    <li className="rounded-md border">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center justify-between gap-2 p-2 text-left text-xs"
      >
        <span className="flex items-center gap-1.5">
          {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span className="font-medium">{pcr.realizado ? 'PCR realizado' : 'PCR no realizado'}</span>
        </span>
        {pcr.fecha && <span className="text-ink-3">{formatearFechaCivil(pcr.fecha)}</span>}
      </button>
      {abierto && (
        <div className="space-y-2 border-t bg-surface-2 p-3 text-xs">
          <p><span className="text-ink-3">Cargado el:</span> {formatearFechaCivil(pcr.created_at)}</p>
          {pcr.informe_pdf_url ? (
            <button type="button" onClick={abrirPdf} className="flex items-center gap-1.5 text-primary hover:underline">
              <FileDown className="h-3.5 w-3.5" /> Ver informe PDF
            </button>
          ) : (
            <p className="text-ink-3">Sin informe PDF adjunto.</p>
          )}
          {error && <p className="text-danger">{error}</p>}
        </div>
      )}
    </li>
  );
}

export function PcrLista({ rondaId }: { rondaId: string }) {
  const { data: pcrs, isLoading } = useQuery({
    queryKey: qk.pcr.ronda(rondaId),
    queryFn: () => listarPcrDeRonda(rondaId),
  });

  if (isLoading) return <p className="text-xs text-ink-3">Cargando PCR…</p>;

  if (!pcrs || pcrs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed py-4 text-center">
        <FlaskConical className="h-5 w-5 text-ink-3" />
        <p className="text-xs text-ink-3">Esta ronda todavía no tiene PCR cargado.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {pcrs.map((p) => <FilaPcr key={p.id} pcr={p} />)}
    </ul>
  );
}
