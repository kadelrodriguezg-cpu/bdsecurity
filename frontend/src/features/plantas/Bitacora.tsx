/**
 * Bitácora científica de un cruce — reencuadra el antiguo AuditoriaPanel.tsx
 * de "log técnico de auditoría" a "historia legible del experimento". Mismos
 * datos de origen y mismo gate de admin (api/auditoria.ts, RLS
 * `audit_select_admin` — no se toca): rediseño de presentación, no de lógica.
 *
 * `ResumenBitacora` vive en Zona D (contexto, 3-5 eventos recientes en
 * lenguaje llano + link). `BitacoraCompleta` es el mismo contenido de
 * siempre (filtros fecha/usuario/tipo, agrupación de ráfagas repetidas)
 * dentro de un Sheet ancho.
 *
 * "Lectura con linaje"/"Lectura de ficha" dominan visualmente el log de hoy
 * pero no son la historia del experimento — se des-enfatizan (`sutil`) sin
 * eliminarlos: siguen siendo relevantes para el modelo de amenaza de
 * espionaje del proyecto.
 */
import { useMemo, useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, ChevronDown, ChevronRight } from 'lucide-react';
import { auditoriaDePlanta, type EntradaAuditoria } from '@/api/auditoria';
import { listarPerfiles } from '@/api/perfiles';
import { useAuth } from '@/features/auth/AuthContext';
import { ESTADO_LABEL, type EstadoPlanta } from '@/types/domain';
import { CRITERIO_BAJA_LABEL, type CriterioBaja } from '@/api/individuos';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ACCION_INFO, infoDeAccion } from './bitacoraLabels';
import { CampoFecha } from '@/components/ui/campo-fecha';
import { qk } from '@/lib/queryKeys';
import { formatearActividad } from '@/lib/v3/formatos';
import { etiquetaMotivoNoEvaluada } from '@/lib/etiquetas';

const VENTANA_AGRUPACION_MS = 3 * 60 * 1000;

/** "Dato relevante" a partir de lo que YA trae `detalle` (JSONB) de cada fila
 * — no se agregan joins nuevos a evaluaciones/pcr_analisis para enriquecerlo
 * (eso sería reescribir la lógica de auditoría, no rediseñar su presentación). */
function datoRelevante(item: EntradaAuditoria): string | null {
  const d = item.detalle as Record<string, unknown>;
  switch (item.accion) {
    case 'cambio_estado':
      if (d.estado_anterior && d.estado_nuevo) {
        const anterior = ESTADO_LABEL[d.estado_anterior as EstadoPlanta] ?? String(d.estado_anterior);
        const nuevo = ESTADO_LABEL[d.estado_nuevo as EstadoPlanta] ?? String(d.estado_nuevo);
        return `${anterior} → ${nuevo}`;
      }
      return null;
    case 'retroceso_fase':
      if (d.estado_anterior && d.estado_nuevo) {
        const anterior = ESTADO_LABEL[d.estado_anterior as EstadoPlanta] ?? String(d.estado_anterior);
        const nuevo = ESTADO_LABEL[d.estado_nuevo as EstadoPlanta] ?? String(d.estado_nuevo);
        return d.motivo ? `${anterior} → ${nuevo} · Motivo: ${String(d.motivo)}` : `${anterior} → ${nuevo}`;
      }
      return null;
    case 'ronda_no_evaluada':
      return d.numero_ronda ? `ronda ${String(d.numero_ronda)} · ${etiquetaMotivoNoEvaluada(String(d.motivo ?? ''), d.detalle as string | null)}` : null;
    case 'eliminacion_evento':
      return d.tipo_evento ? `registro «${String(d.tipo_evento)}»` : null;
    case 'creacion_evaluacion':
    case 'edicion_evaluacion':
      return d.anio ? `ronda del año ${d.anio}` : null;
    case 'creacion_pcr':
    case 'edicion_pcr':
      return typeof d.realizado === 'boolean' ? (d.realizado ? 'realizado' : 'no realizado') : null;
    case 'creacion_baja_motivo':
    case 'edicion_baja_motivo':
      return d.criterio ? CRITERIO_BAJA_LABEL[d.criterio as CriterioBaja] ?? String(d.criterio) : null;
    default:
      return null;
  }
}

interface GrupoBitacora {
  clave: string;
  usuarioId: string | null;
  usuarioNombre: string | null;
  accion: string;
  items: EntradaAuditoria[];
  hasta: string;
}

function agruparBitacora(entradas: EntradaAuditoria[]): GrupoBitacora[] {
  const porClave = new Map<string, EntradaAuditoria[]>();
  for (const e of entradas) {
    const clave = `${e.usuario_id ?? 'sistema'}::${e.accion}`;
    const lista = porClave.get(clave) ?? [];
    lista.push(e);
    porClave.set(clave, lista);
  }

  const grupos: GrupoBitacora[] = [];
  for (const items of porClave.values()) {
    const ordenados = [...items].sort((a, b) => new Date(a.ocurrido_en).getTime() - new Date(b.ocurrido_en).getTime());
    let actual: EntradaAuditoria[] = [];
    for (const e of ordenados) {
      const anterior = actual[actual.length - 1];
      const gap = anterior ? new Date(e.ocurrido_en).getTime() - new Date(anterior.ocurrido_en).getTime() : 0;
      if (anterior && gap > VENTANA_AGRUPACION_MS) {
        grupos.push(construirGrupo(actual));
        actual = [];
      }
      actual.push(e);
    }
    if (actual.length > 0) grupos.push(construirGrupo(actual));
  }
  return grupos.sort((a, b) => new Date(b.hasta).getTime() - new Date(a.hasta).getTime());
}

function construirGrupo(items: EntradaAuditoria[]): GrupoBitacora {
  const primero = items[0];
  const ultimo = items[items.length - 1];
  return {
    clave: `${primero.usuario_id ?? 'sistema'}-${primero.accion}-${primero.id}`,
    usuarioId: primero.usuario_id,
    usuarioNombre: primero.usuario_nombre,
    accion: primero.accion,
    items,
    hasta: ultimo.ocurrido_en,
  };
}

/** Zona D: 3-5 eventos recientes en lenguaje llano + link a la bitácora completa. */
export function ResumenBitacora({ plantaId }: { plantaId: string }) {
  const { esAdmin } = useAuth();
  const [abierta, setAbierta] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: qk.auditoria.resumen(plantaId),
    queryFn: () => auditoriaDePlanta(plantaId, {}, 5),
    enabled: esAdmin,
  });

  if (!esAdmin) return null;

  const grupos = agruparBitacora(data ?? []).slice(0, 4);

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-small font-semibold text-ink-2">
        <History className="h-3.5 w-3.5" /> Bitácora
      </div>
      {isLoading ? (
        <p className="text-small text-ink-3">Cargando…</p>
      ) : grupos.length === 0 ? (
        <p className="text-small text-ink-3">Sin registros todavía.</p>
      ) : (
        <ul className="space-y-2">
          {grupos.map((g) => {
            const info = infoDeAccion(g.accion);
            const dato = datoRelevante(g.items[g.items.length - 1]);
            return (
              <li key={g.clave} className={cn('text-body', info.sutil && 'text-ink-3')}>
                <span className={info.sutil ? '' : 'font-medium'}>{info.label}</span>
                {g.items.length > 1 && <span className="text-ink-3"> ×{g.items.length}</span>}
                {dato && <span className="text-ink-3"> — {dato}</span>}
                <div className="text-micro text-ink-3">
                  {g.usuarioNombre ?? (g.usuarioId ? 'Usuario' : 'Sistema')} · {formatearActividad(g.hasta)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={() => setAbierta(true)} className="mt-2.5 text-small font-medium text-primary hover:underline">
        Ver bitácora completa →
      </button>
      {abierta && <BitacoraCompleta plantaId={plantaId} onCerrar={() => setAbierta(false)} />}
    </div>
  );
}

function FilaGrupo({ grupo }: { grupo: GrupoBitacora }) {
  const [expandido, setExpandido] = useState(false);
  const info = infoDeAccion(grupo.accion);
  const esMultiple = grupo.items.length > 1;
  const dato = datoRelevante(grupo.items[grupo.items.length - 1]);

  return (
    <li className={cn('border-b border-line-soft py-2.5 last:border-0', info.sensible && 'border-l-4 border-l-danger bg-danger-l pl-2')}>
      <div className="flex flex-wrap items-center gap-2">
        {esMultiple && (
          <button type="button" onClick={() => setExpandido((v) => !v)} aria-expanded={expandido} className="text-ink-3">
            {expandido ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
        <span className={cn('text-body', info.sutil ? 'text-ink-3' : 'font-medium')}>{info.label}</span>
        <span className="text-body text-ink-2">{grupo.usuarioNombre ?? (grupo.usuarioId ? 'Usuario' : 'Sistema')}</span>
        {esMultiple ? (
          <span className="text-small text-ink-3">{grupo.items.length} eventos · {formatearActividad(grupo.hasta)}</span>
        ) : (
          <>
            <span className="text-small text-ink-3">{formatearActividad(grupo.hasta)}</span>
            {dato && <span className="text-small text-ink-2">{dato}</span>}
          </>
        )}
      </div>
      {esMultiple && expandido && (
        <ul className="mt-1.5 space-y-1 pl-6 text-small text-ink-2">
          {grupo.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <span className="text-ink-3">{formatearActividad(item.ocurrido_en)}</span>
              {datoRelevante(item) && <span>{datoRelevante(item)}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Sheet ancho con la bitácora completa: mismos filtros/datos que el AuditoriaPanel de siempre. */
export function BitacoraCompleta({ plantaId, onCerrar }: { plantaId: string; onCerrar: () => void }) {
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [accion, setAccion] = useState('');

  const filtro = { fechaDesde: fechaDesde || undefined, fechaHasta: fechaHasta || undefined, usuarioId: usuarioId || undefined, accion: accion || undefined };

  const { data, isLoading } = useQuery({
    queryKey: qk.auditoria.bitacora(plantaId, filtro),
    queryFn: () => auditoriaDePlanta(plantaId, filtro),
  });
  const { data: perfiles } = useQuery({ queryKey: qk.perfiles.all, queryFn: listarPerfiles, staleTime: 5 * 60 * 1000 });

  const grupos = useMemo(() => agruparBitacora(data ?? []), [data]);

  return (
    <Sheet titulo="Bitácora completa" subtitulo="Historia del experimento" onCerrar={onCerrar} size="ancho">
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <CampoFecha id="bitacora-desde" label="Desde" value={fechaDesde} onChange={setFechaDesde} advertirFuturo={false} />
        <CampoFecha id="bitacora-hasta" label="Hasta" value={fechaHasta} onChange={setFechaHasta} advertirFuturo={false} fechaMinimaContextual={fechaDesde} etiquetaFechaMinima="la fecha Desde" />
        <div className="space-y-1">
          <Label htmlFor="bitacora-usuario">Usuario</Label>
          <Select id="bitacora-usuario" value={usuarioId} onChange={(e: ChangeEvent<HTMLSelectElement>) => setUsuarioId(e.target.value)}>
            <option value="">Todos</option>
            {perfiles?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bitacora-tipo">Tipo de evento</Label>
          <Select id="bitacora-tipo" value={accion} onChange={(e: ChangeEvent<HTMLSelectElement>) => setAccion(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(ACCION_INFO).map(([valor, info]) => <option key={valor} value={valor}>{info.label}</option>)}
          </Select>
        </div>
      </div>

      {isLoading && <p className="text-body text-ink-3">Cargando…</p>}
      {!isLoading && grupos.length === 0 && <p className="text-body text-ink-3">Sin registros.</p>}
      <ul>{grupos.map((g) => <FilaGrupo key={g.clave} grupo={g} />)}</ul>
    </Sheet>
  );
}
