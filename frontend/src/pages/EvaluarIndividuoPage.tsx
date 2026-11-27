/**
 * Evaluación anual a pantalla completa (Fase 2; referencia docs/diseno/v2/04
 * y 08). Se llega desde la planilla de ronda. La ronda, el protocolo y el
 * recorrido salen de la planilla: anterior/siguiente por número de planta y
 * «Finalizar y seguir» con el siguiente individuo sin evaluar.
 *
 * Sprint 2 (S2-6): la misma pantalla sirve a las rondas multisitio (`tipo="multisitio"`, ruta
 * `/planta/:id/multisitio/:individuoId`): su planilla, su protocolo y su contador son propios.
 *
 * Sprint 1.2: también se llega desde el expediente del individuo, con
 * `?ronda=N` (la ronda del individuo) y `?volver=` (la ficha en la pestaña
 * Individuos). En ese caso no hay recorrido: cerrar o finalizar vuelve ahí.
 *
 * Fase 5 (G11 a G13): desde la planilla llegan `?filtro=` (el filtro con que se abrió: «Siguiente» lo sigue) y `?planilla=`
 * (su URL, para volver igual que estaba y con `desde=` la planta de la que se volvió). Ver features/evaluaciones/recorrido.ts.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, ScanQrCode } from 'lucide-react';
import { obtenerPlanillaRonda, type FilaPlanilla } from '@/api/protocolo';
import { avisoSinSiguiente, conDesde, leerFiltroRecorrido, planillaSegura, vecinosEnRecorrido } from '@/features/evaluaciones/recorrido';
import { useAuth } from '@/features/auth/AuthContext';
import { EvaluacionForm } from '@/features/individuos/EvaluacionForm';
import { formatearFechaCivil } from '@/lib/fechas';
import { qk } from '@/lib/queryKeys';
import type { TipoRonda } from '@/api/rondas';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const corto = (f: FilaPlanilla) => f.codigo_display.split('-').pop() ?? f.codigo_display;

/** Cuánto dura el aviso «P11 guardada · 15/15» (U-19). */
const MS_AVISO_GUARDADA = 5000;

export function EvaluarIndividuoPage({ tipo = 'anual' }: { tipo?: TipoRonda } = {}) {
  const { id: plantaId = '', individuoId = '' } = useParams();
  const navigate = useNavigate();
  const ubicacion = useLocation();
  const { esAdmin } = useAuth();
  const [busqueda] = useSearchParams();
  // U-19: tras «Finalizar y seguir» el formulario siguiente se abre con un aviso breve de lo que se guardó.
  const avisoGuardada = (ubicacion.state as { avisoGuardada?: string } | null)?.avisoGuardada ?? null;
  const [avisoOculto, setAvisoOculto] = useState<string | null>(null);
  useEffect(() => {
    if (!avisoGuardada) return undefined;
    const temporizador = setTimeout(() => setAvisoOculto(ubicacion.key), MS_AVISO_GUARDADA);
    return () => clearTimeout(temporizador);
  }, [avisoGuardada, ubicacion.key]);
  const avisoVisible = avisoGuardada !== null && avisoOculto !== ubicacion.key;
  const rondaPedida = Number(busqueda.get('ronda'));
  const numeroRonda = Number.isInteger(rondaPedida) && rondaPedida >= 1 && rondaPedida <= 3 ? rondaPedida : undefined;
  // Solo rutas internas de este cruce (nada de redirecciones a otro sitio).
  const volverPedido = busqueda.get('volver');
  const volver = volverPedido && volverPedido.startsWith(`/planta/${plantaId}`) && !volverPedido.startsWith('//') ? volverPedido : null;
  // Fase 5 (G11, G13): el filtro de origen y la planilla a la que se vuelve (solo si es de este cruce).
  const filtro = volver ? null : leerFiltroRecorrido(busqueda.get('filtro'));
  const planillaOrigen = volver ? null : planillaSegura(busqueda.get('planilla'), plantaId);
  // Fase 5 (G3): si se evalúa una ronda pedida (las plantas atrasadas de la ronda anterior), el recorrido sigue en esa ronda.
  const rutaPantalla = (individuo: string) => {
    const q = new URLSearchParams();
    if (numeroRonda && !volver) q.set('ronda', String(numeroRonda));
    if (filtro) q.set('filtro', filtro);
    if (planillaOrigen) q.set('planilla', planillaOrigen);
    return `/planta/${plantaId}/${tipo === 'multisitio' ? 'multisitio' : 'evaluar'}/${individuo}${q.toString() ? `?${q.toString()}` : ''}`;
  };
  const planillaQuery = useQuery({ queryKey: qk.protocolo.planilla(plantaId, numeroRonda, tipo), queryFn: () => (tipo === 'anual' ? obtenerPlanillaRonda(plantaId, numeroRonda) : obtenerPlanillaRonda(plantaId, numeroRonda, tipo)) });
  const planilla = planillaQuery.data;
  const filas = planilla?.individuos ?? [];
  const indice = filas.findIndex((f) => f.individuo_id === individuoId);
  const fila = indice >= 0 ? filas[indice] : null;
  // U-09: las flechas recorren solo lo que se puede evaluar. Una ronda puede tener varias evaluaciones cerradas del mismo
  // individuo (visitas espaciadas): abrir una cerrada agrega una nueva, no la reemplaza. G11: con filtro, siguen el filtro.
  const vecinos = vecinosEnRecorrido(filas, individuoId, filtro, esAdmin);
  const { anterior, posterior } = vecinos;
  const siguiente = volver ? null : vecinos.siguiente;
  const destinoVolver = volver ?? conDesde(planillaOrigen ?? `/planta/${plantaId}`, individuoId);
  const volverAPlanilla = (aviso?: string) => navigate(destinoVolver, aviso ? { state: { aviso } } : undefined);

  const contenedor = 'mx-auto min-h-dvh max-w-[1360px] bg-bg px-4 sm:px-6';
  if (planillaQuery.isPending) return <div className={contenedor}><p role="status" className="py-10 text-small text-ink-3">Cargando la ronda…</p></div>;
  if (planillaQuery.isError || !planilla) {
    return (
      <div className={`${contenedor} space-y-3 py-6`}>
        <Alert>No se pudo cargar la ronda. <Button variant="outline" size="sm" onClick={() => void planillaQuery.refetch()}>Reintentar</Button></Alert>
        <Link to={destinoVolver} className="text-small text-brand">Volver al cruce</Link>
      </div>
    );
  }
  if (!fila || !fila.ronda_id || planilla.numero_ronda === null) {
    return (
      <div className={`${contenedor} space-y-3 py-6`}>
        <Alert>Este individuo no tiene la ronda {planilla.numero_ronda ?? ''} iniciada. Iníciala desde su expediente en la ficha del cruce.</Alert>
        <Link to={destinoVolver} className="text-small text-brand">{volver ? 'Volver al individuo' : 'Volver a la planilla'}</Link>
      </div>
    );
  }

  // U-09: la ronda ya tiene una evaluación cerrada; este formulario agrega una visita nueva y lo avisa arriba.
  const avisoVisitaNueva = fila.estado === 'completa' && fila.evaluacion_id
    ? `Esta ronda ya tiene una evaluación cerrada (${formatearFechaCivil(fila.fecha)}). Estás agregando una nueva.`
    : undefined;

  const navegacion = (
    <div className="flex gap-2">
      {!volver && anterior && (
        <Button variant="outline" size="sm" onClick={() => navigate(rutaPantalla(anterior.individuo_id))} aria-label={`Anterior: ${anterior.codigo_display}`}>
          <ChevronLeft className="h-4 w-4" /> {corto(anterior)}
        </Button>
      )}
      {!volver && posterior && (
        <Button variant="outline" size="sm" onClick={() => navigate(rutaPantalla(posterior.individuo_id))} aria-label={`Siguiente: ${posterior.codigo_display}`}>
          {corto(posterior)} <ChevronRight className="h-4 w-4" />
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => navigate('/escanear')}>
        <ScanQrCode className="h-4 w-4" /> Escanear QR
      </Button>
    </div>
  );

  return (
    <div className={contenedor}>
      <div
        role="status"
        aria-live="polite"
        className={avisoVisible ? 'fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md rounded-lg border border-ok bg-ok-l px-4 py-2 text-small font-semibold text-ok md:bottom-24' : 'sr-only'}
      >
        {avisoVisible ? avisoGuardada : null}
      </div>
      <EvaluacionForm
        key={fila.ronda_id}
        variante="pantalla"
        rondaId={fila.ronda_id}
        plantaId={plantaId}
        codigoIndividuo={fila.codigo_display}
        numeroRonda={planilla.numero_ronda}
        tipoRonda={tipo}
        siguiente={siguiente ? corto(siguiente) : undefined}
        textoVolver={siguiente && !volver ? 'Finalizar y volver a la planilla' : undefined}
        avisoVisitaNueva={avisoVisitaNueva}
        barraIzquierda={(
          <Link to={destinoVolver} className="inline-flex min-h-tap min-w-tap items-center gap-1 text-xs text-brand">
            <ChevronLeft className="h-4 w-4" /> {volver ? 'Individuo' : 'Planilla'}
          </Link>
        )}
        barraDerecha={<span className="hidden md:block">{navegacion}</span>}
        onCerrar={() => volverAPlanilla()}
        onGuardado={(estado, resumen, destino) => {
          if (estado === 'completa' && destino !== 'volver' && siguiente) {
            const avisoSiguiente = `${corto(fila)} guardada${resumen ? ` · ${resumen.llenos}/${resumen.total}` : ''}`;
            navigate(rutaPantalla(siguiente.individuo_id), { state: { avisoGuardada: avisoSiguiente } });
          } else if (estado === 'completa' && destino !== 'volver' && filtro) {
            // G11: no queda ninguno después de esta con el filtro de origen: se vuelve a la planilla y se dice, sin saltar al principio.
            volverAPlanilla(avisoSinSiguiente(filtro, fila));
          } else volverAPlanilla();
        }}
      />
    </div>
  );
}
