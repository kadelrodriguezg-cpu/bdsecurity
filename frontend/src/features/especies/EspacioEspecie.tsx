/**
 * La especie como espacio de trabajo (fase 4, decisiones del 25-10-2026; patrón de Slack, Linear o Vercel): toda la app
 * trabaja en la especie elegida en el encabezado, o en «Todas las especies» (el panorama). Todos los roles pueden cambiarla.
 *
 * - Se recuerda la última por usuario y equipo (localStorage, con try/catch: en una ventana privada puede no estar).
 * - En Inicio, Cruces y Resultados va en la URL (`?especie=arandano`, o `todas`) para que un enlace compartido abra el mismo
 *   contexto; en esas rutas la URL manda. Los enlaces viejos con el id de la especie siguen funcionando.
 * - Al abrir un cruce o un individuo de otra especie (búsqueda por código, QR o enlace), el espacio cambia solo y se avisa
 *   («Ahora estás en Frutilla»): `useCambioAutomaticoEspecie`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { listarEspecies, obtenerPanoramaEspecies, type Especie, type PanoramaEspecie } from '@/api/especies';
import { useAuth } from '@/features/auth/AuthContext';
import { colorEspecie, resolverParametroEspecie, slugEspecie, TODAS } from '@/lib/especies';
import { useIncluirPruebas } from '@/lib/preferencias';
import { qk } from '@/lib/queryKeys';

/** Rutas cuya URL lleva la especie. */
const RUTAS_CON_ESPECIE = ['/', '/plantas', '/resultados', '/resultados/mapa', '/resultados/tendencias', '/resultados/polinizacion'];
export const llevaEspecieEnUrl = (pathname: string) => RUTAS_CON_ESPECIE.includes(pathname);
/** Pantallas de un cruce concreto: al cambiar de especie desde el encabezado se vuelve a la lista de Cruces. */
const esDeUnCruce = (pathname: string) => /^\/(planta|individuo)\//.test(pathname);

const claveMemoria = (usuarioId: string) => `bds:especie:${usuarioId}`;

function leerMemoria(usuarioId: string): string | null | undefined {
  try {
    const valor = window.localStorage.getItem(claveMemoria(usuarioId));
    if (valor === null) return undefined;
    return valor === TODAS ? null : valor;
  } catch {
    return undefined;
  }
}

function guardarMemoria(usuarioId: string, especieId: string | null): void {
  try {
    window.localStorage.setItem(claveMemoria(usuarioId), especieId ?? TODAS);
  } catch {
    // Sin almacenamiento (ventana privada): la elección vale mientras dure la visita.
  }
}

export interface EspacioEspecie {
  especies: Especie[];
  /** Cifras por especie (cruces, vivos, pendientes…); se cuentan como la planilla. */
  panorama: PanoramaEspecie[] | undefined;
  panoramaError: boolean;
  reintentarPanorama: () => void;
  /** La especie activa; `null` = «Todas las especies». */
  activa: Especie | null;
  /** Ya se sabe cuál es el espacio (especies cargadas y elección resuelta). */
  listo: boolean;
  /** `null` = «Todas las especies». `quedarse`: no cambia de pantalla (cambio automático desde una ficha). */
  cambiar: (especieId: string | null, opciones?: { aviso?: boolean; quedarse?: boolean }) => void;
  /** Valor del parámetro `especie` de la URL para el espacio actual (`arandano` o `todas`). */
  parametro: string;
}

const Contexto = createContext<EspacioEspecie | null>(null);

export function useEspacioEspecie(): EspacioEspecie {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useEspacioEspecie fuera de EspacioEspecieProvider');
  return valor;
}

/** Igual que `useEspacioEspecie`, pero sin proveedor devuelve null (componentes que también viven fuera del shell). */
export function useEspacioEspecieOpcional(): EspacioEspecie | null {
  return useContext(Contexto);
}

export const parametroDe = (especies: readonly Especie[], especieId: string | null): string => {
  if (especieId === null) return TODAS;
  const especie = especies.find((e) => e.id === especieId);
  return especie ? slugEspecie(especie.nombre) : TODAS;
};

/** Lleva al espacio de la especie de lo que se está mirando (un cruce o un individuo) y avisa si cambió. */
export function useCambioAutomaticoEspecie(especieId: string | null | undefined): void {
  const espacio = useEspacioEspecieOpcional();
  const listo = espacio?.listo ?? false;
  const activaId = espacio?.activa?.id ?? null;
  const cambiar = espacio?.cambiar;
  useEffect(() => {
    if (!listo || !especieId || !cambiar || activaId === especieId) return;
    cambiar(especieId, { aviso: true, quedarse: true });
  }, [listo, especieId, activaId, cambiar]);
}

export function EspacioEspecieProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const usuarioId = user?.id ?? 'anonimo';
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [incluirPruebas] = useIncluirPruebas();
  const especiesQuery = useQuery({ queryKey: qk.especies.all, queryFn: listarEspecies });
  const panoramaQuery = useQuery({
    queryKey: qk.plantas.panorama({ incluirPruebas }),
    queryFn: () => obtenerPanoramaEspecies({ incluirPruebas }),
    staleTime: 60_000,
  });
  const especies = useMemo(() => especiesQuery.data ?? [], [especiesQuery.data]);
  const [seleccion, setSeleccion] = useState<string | null | undefined>(() => leerMemoria(usuarioId));
  const [aviso, setAviso] = useState<Especie | null>(null);
  const temporizador = useRef<number | undefined>(undefined);

  const enRutaConEspecie = llevaEspecieEnUrl(pathname);
  const valorUrl = new URLSearchParams(search).get('especie');
  const desdeUrl = enRutaConEspecie && especiesQuery.isSuccess ? resolverParametroEspecie(valorUrl, especies) : undefined;
  // Lo recordado puede ser una especie que ya no existe: entonces se elige de nuevo.
  const recordadaValida = seleccion === null || (seleccion !== undefined && especies.some((e) => e.id === seleccion));
  const efectiva: string | null | undefined = desdeUrl !== undefined ? desdeUrl : (especiesQuery.isSuccess && recordadaValida ? seleccion : undefined);

  // Sin URL ni memoria: la especie con más cruces activos (si ninguna tiene cruces, el panorama).
  useEffect(() => {
    if (!especiesQuery.isSuccess || desdeUrl !== undefined || recordadaValida) return;
    if (panoramaQuery.isSuccess) {
      const conCruces = [...panoramaQuery.data].filter((p) => p.cruces > 0).sort((a, b) => b.cruces_activos - a.cruces_activos || a.nombre.localeCompare(b.nombre));
      setSeleccion(conCruces[0]?.id ?? null);
    } else if (panoramaQuery.isError) {
      setSeleccion(especies[0]?.id ?? null);
    }
  }, [especiesQuery.isSuccess, desdeUrl, recordadaValida, panoramaQuery.isSuccess, panoramaQuery.isError, panoramaQuery.data, especies]);

  // La URL manda en Inicio, Cruces y Resultados (enlace compartido, atrás del navegador): se recuerda lo que dice.
  useEffect(() => {
    if (desdeUrl === undefined || desdeUrl === seleccion) return;
    setSeleccion(desdeUrl);
    guardarMemoria(usuarioId, desdeUrl);
  }, [desdeUrl, seleccion, usuarioId]);

  // En esas rutas la URL siempre dice el espacio, con el nombre (no el id).
  useEffect(() => {
    if (!enRutaConEspecie || efectiva === undefined) return;
    const esperado = parametroDe(especies, efectiva);
    if (valorUrl === esperado) return;
    const parametros = new URLSearchParams(search);
    parametros.set('especie', esperado);
    navigate({ pathname, search: `?${parametros.toString()}` }, { replace: true });
  }, [enRutaConEspecie, efectiva, especies, valorUrl, search, pathname, navigate]);

  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  const cambiar = useCallback<EspacioEspecie['cambiar']>((especieId, opciones = {}) => {
    guardarMemoria(usuarioId, especieId);
    // Donde la URL lleva la especie, la URL manda: basta con navegar (si no, un render intermedio la vería distinta).
    if (opciones.quedarse || !llevaEspecieEnUrl(pathname)) setSeleccion(especieId);
    const especie = especieId ? especies.find((e) => e.id === especieId) ?? null : null;
    if (opciones.aviso && especie) {
      setAviso(especie);
      window.clearTimeout(temporizador.current);
      temporizador.current = window.setTimeout(() => setAviso(null), 5000);
    }
    if (opciones.quedarse) return;
    const parametro = parametroDe(especies, especieId);
    if (llevaEspecieEnUrl(pathname)) {
      // Cambiar de especie no arrastra los filtros de la otra (cruce, fase, página…).
      navigate({ pathname, search: `?especie=${parametro}` });
    } else if (esDeUnCruce(pathname)) {
      navigate(`/plantas?especie=${parametro}`);
    }
  }, [especies, usuarioId, pathname, navigate]);

  const activa = efectiva ? especies.find((e) => e.id === efectiva) ?? null : null;
  const valor = useMemo<EspacioEspecie>(() => ({
    especies,
    panorama: panoramaQuery.data,
    panoramaError: panoramaQuery.isError,
    reintentarPanorama: () => { void panoramaQuery.refetch(); },
    activa,
    listo: especiesQuery.isSuccess && efectiva !== undefined,
    cambiar,
    parametro: parametroDe(especies, efectiva ?? null),
  }), [especies, panoramaQuery, activa, especiesQuery.isSuccess, efectiva, cambiar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {aviso && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-small text-ink shadow-lg md:bottom-6"
        >
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorEspecie(aviso) }} />
          Ahora estás en {aviso.nombre}
        </div>
      )}
    </Contexto.Provider>
  );
}

/** Ruta de diseño: todo lo que requiere sesión vive dentro del espacio de especie (también las pantallas completas). */
export function EspacioEspecieLayout() {
  const { user } = useAuth();
  return (
    <EspacioEspecieProvider key={user?.id ?? 'anonimo'}>
      <Outlet />
    </EspacioEspecieProvider>
  );
}
