import type { ComponentProps } from 'react';
import { useVigenciaFormulario } from '@/lib/useVigenciaFormulario';
import { useAuth } from '@/features/auth/AuthContext';
import { EstadoBorradorLocal } from '@/components/shared/EstadoBorradorLocal';
/**
 * Registro append-only de traslado territorial. El nombre del componente se
 * conserva para no romper composición de la ficha, pero no consume la tabla
 * legacy `multisitio`: cada guardado usa registrar_traslado_individuo().
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { listarSectoresOperativos, registrarTraslado, type SectorOperativo } from '@/api/emplazamientos';
import { useBorradorLocal } from '@/lib/useBorradorLocal';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { CampoFecha } from '@/components/ui/campo-fecha';
import { hoyChileISO } from '@/lib/fechas';
import { qk } from '@/lib/queryKeys';
import { formatearActividad } from '@/lib/v3/formatos';

/**
 * Borrador local (hallazgo #3 de la auditoría pre-lanzamiento, 0.terdecies):
 * solo `fecha` -- deliberadamente NO se persiste `sectorId`. El destino de un
 * traslado es una decisión de negocio, no un dato neutro; revivir
 * automáticamente un sector elegido hace días arriesga proponer un destino
 * que ya no refleja la intención actual del operario, aunque el sector siga
 * técnicamente activo. El operario elige destino de nuevo siempre.
 */
interface MultisitioBorrador {
  fecha: string;
  [key: string]: unknown;
}

const VALOR_INICIAL_MULTISITIO: MultisitioBorrador = { fecha: hoyChileISO() };

// Sector auto-generado (trigger de Sprint 4 en predio nuevo, o el nombre
// legado de la migración de territorio) — sin valor informativo propio; solo
// se muestra si alguien lo subdividió manualmente con un nombre distinto.
const SECTOR_SIN_SUBDIVISION = new Set(['Sector principal', 'Sector legado sin clasificar']);

/**
 * DECISIÓN (mid-fix Sprint 7.5, Parte C): el operador solo administra
 * Predios (2.4.2 del documento maestro) — nunca debería tener que pensar en
 * Sitio. Hoy TODO predio cuelga del mismo "Sitio legado sin clasificar"
 * reutilizado (decisión de Sprint 4), así que anteponerlo en cada opción no
 * distingue nada y sepulta el único dato que el usuario necesita (el nombre
 * real del predio) al medio de una cadena "Sitio · Predio · Sector" —
 * confirmado con datos reales de producción (Prueba Predio Armerillo, San
 * Javier). Se muestra el predio como texto principal; el sector solo se
 * agrega si alguien lo subdividió manualmente (nombre distinto del
 * auto-generado) — en cuyo caso sí es información real que distingue destinos
 * dentro de un mismo predio.
 */
function etiquetaDestino(sector: SectorOperativo): string {
  return SECTOR_SIN_SUBDIVISION.has(sector.nombre) ? sector.predio_nombre : `${sector.predio_nombre} · ${sector.nombre}`;
}

function MultisitioFormContenido({ individuoId, plantaId, onGuardado, onTocadoChange }: { individuoId: string; plantaId: string; onGuardado?: () => void; onTocadoChange?: (tocado: boolean) => void }) {
  const queryClient = useQueryClient();
  const ciclo = useVigenciaFormulario();
  const { user } = useAuth();
  const { data: sectores } = useQuery({ queryKey: qk.territorio.sectores, queryFn: listarSectoresOperativos });
  const claveBorrador = `borrador:multisitio:${individuoId}`;
  const {
    valor: form,
    setValor: setForm,
    estado: estadoBorrador,
    errorPersistencia,
    recuperadoEn,
    limpiar,
    descartarRecuperado,
  } = useBorradorLocal<MultisitioBorrador>(claveBorrador, VALOR_INICIAL_MULTISITIO, { usuarioId: user?.id ?? null });
  const [sectorId, setSectorId] = useState('');
  const [tocado, setTocado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDestino, setErrorDestino] = useState(false);
  const destinoRef = useRef<HTMLSelectElement>(null);

  useEffect(() => onTocadoChange?.(tocado), [onTocadoChange, tocado]);

  const mutacion = useMutation({
    mutationFn: () => registrarTraslado({ individuoId, sectorId, fechaInicio: form.fecha }),
    onSuccess: () => {
      if (!ciclo.sesionVigente()) return;
      void queryClient.invalidateQueries({ queryKey: qk.territorio.emplazamientos(individuoId) });
      void queryClient.invalidateQueries({ queryKey: qk.territorio.mapaCruce(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.territorio.mapaAgregadoAll });
      void queryClient.invalidateQueries({ queryKey: qk.territorio.viewportAll });
      void queryClient.invalidateQueries({ queryKey: qk.procedimientoPredios.activos(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.territorio.climaCruce(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.individuos.resumen(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.resumenFinal.all });
      if (!ciclo.uiVigente()) return;
      setError(null);
      setTocado(false);
      limpiar();
      setForm(VALOR_INICIAL_MULTISITIO);
      // Sin esta invalidación el mapa de la ficha seguía mostrando el estado
      // anterior hasta recargar la página — mismo patrón del hallazgo Grave
      // "linaje no refresca tras guardar" (query sin invalidar tras mutación).
      // Un traslado a un predio recién geolocalizado puede disparar su primera
      // sincronización de clima (2.8) — sin invalidar este bloque quedaría
      // mostrando "sin emplazamiento" pese a que el mapa ya se actualizó.
      onGuardado?.();
    },
    onError: (e) => {
      if (!ciclo.uiVigente()) return;
      setError(e instanceof Error ? e.message : 'No se pudo registrar el traslado.');
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!sectorId) {
          setErrorDestino(true);
          destinoRef.current?.focus();
          return;
        }
        mutacion.mutate();
      }}
      className="space-y-3"
    >
      <p className="text-xs text-ink-3">El emplazamiento actual se cerrará y quedará conservado en el historial.</p>
      {recuperadoEn && (
        <Alert variant="success">
          Se recuperó la fecha de un borrador sin guardar de {formatearActividad(new Date(recuperadoEn).toISOString())} --
          elige el destino de nuevo.{' '}
          <button type="button" className="font-semibold underline" onClick={descartarRecuperado}>
            Descartar
          </button>
        </Alert>
      )}
      <CampoFecha id="fecha_traslado" label="Fecha de traslado" value={form.fecha} onChange={(value) => { setTocado(true); setForm((actual) => ({ ...actual, fecha: value })); }} required />

      <div className="space-y-1.5">
        <Label htmlFor="sector_traslado">Predio de destino</Label>
        {!sectores || sectores.length === 0 ? (
          // DECISIÓN (Sprint 7): el dropdown solo ofrece cadenas 100% activas
          // (sitio+predio+sector). Si no queda ninguna — el estado real de
          // producción hoy: los 4 predios están inactivos — se explica qué
          // hacer en vez de mostrar un selector vacío sin motivo.
          <p className="rounded-md border border-dashed p-3 text-xs text-ink-3">
            No hay predios activos disponibles como destino. Un admin debe activar un predio existente (o crear uno
            nuevo) en <span className="font-medium">Catálogos</span> — cada predio nuevo queda listo como destino de
            inmediato, con su sector creado automáticamente.
          </p>
        ) : (
          <Select id="sector_traslado" ref={destinoRef} aria-invalid={errorDestino ? true : undefined} aria-describedby={errorDestino ? 'sector-traslado-error' : undefined} value={sectorId} onInvalid={() => setErrorDestino(true)} onChange={(event) => { setErrorDestino(false); setTocado(true); setSectorId(event.target.value); }} required>
            <option value="">Seleccionar predio…</option>
            {sectores.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {etiquetaDestino(sector)}
              </option>
            ))}
          </Select>
        )}
      </div>

      {errorDestino && <Alert id="sector-traslado-error">Selecciona un sector de destino.</Alert>}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={mutacion.isPending || !sectores || sectores.length === 0}>
          <MapPin className="h-4 w-4" />
          {mutacion.isPending ? 'Registrando…' : 'Registrar traslado'}
        </Button>
        <EstadoBorradorLocal estado={estadoBorrador} errorPersistencia={errorPersistencia} />
      </div>
    </form>
  );
}

export function MultisitioForm(props: ComponentProps<typeof MultisitioFormContenido>) {
  const { user, generacionSesion } = useAuth();
  return <MultisitioFormContenido key={JSON.stringify([user?.id ?? null, generacionSesion, props.plantaId, props.individuoId])} {...props} />;
}
