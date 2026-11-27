/**
 * Selección múltiple sobre una lista (checkboxes por fila) con una regla de
 * elegibilidad propia del dominio.
 *
 * Se construye como hook genérico y no como estado local del primer
 * componente que lo necesitó — mismo criterio que `useBorradorLocal`: un
 * patrón nuevo nace reutilizable. Hoy lo usa la descarga de etiquetas en
 * tanda del Explorador de individuos; cualquier otra lista que necesite
 * selección múltiple debe consumir este hook en vez de rehacerlo.
 *
 * La garantía central es que un item no elegible **nunca** forma parte de la
 * salida, por ningún camino: ni por `alternar` (lo ignora), ni por
 * `seleccionarTodos` (recorre solo los elegibles), ni por quedar seleccionado
 * de antes y volverse no elegible después (`seleccionados` se deriva
 * filtrando contra la elegibilidad vigente, no contra la del momento del
 * clic). Por eso la regla de negocio se pasa acá como `esSeleccionable` y no
 * se implementa deshabilitando el checkbox en la UI: el checkbox deshabilitado
 * es la señal visual, esta función es la regla.
 */
import { useCallback, useMemo, useState } from 'react';

export interface OpcionesSeleccionMultiple<T> {
  /** Universo completo que se muestra en la lista, elegibles y no elegibles. */
  items: T[];
  obtenerId: (item: T) => string;
  /** Regla de negocio de elegibilidad. Por defecto, todo item es seleccionable. */
  esSeleccionable?: (item: T) => boolean;
  /**
   * Subconjunto de `items` que el filtro/búsqueda vigente deja a la vista.
   * Por defecto, todos.
   *
   * Acota SOLO el alcance de `seleccionarTodos` (y de `todosSeleccionados`,
   * que es su reflejo): con un filtro puesto, "seleccionar todos" agrega lo
   * que se está viendo, no el universo entero — apretarlo después de buscar
   * un código puntual no puede terminar marcando la lista completa.
   *
   * NO cambia qué significa estar seleccionado: `seleccionados`, `cantidad` y
   * `estaSeleccionado` siguen calculándose sobre `items`, así que lo marcado
   * sobrevive a cambiar o borrar el filtro. Estar fuera de la vista no es
   * estar deseleccionado.
   */
  visibles?: T[];
}

export type ResultadoAgregar = 'agregado' | 'ya_estaba' | 'no_seleccionable' | 'fuera_de_la_lista';

export interface SeleccionMultiple<T> {
  /** Subconjunto de `items` que la regla admite. */
  seleccionables: T[];
  /** Los elegibles que además están a la vista — el alcance de `seleccionarTodos`. */
  seleccionablesVisibles: T[];
  /** true cuando el filtro deja fuera a algún elegible (hay menos a la vista que en total). */
  ambitoAcotado: boolean;
  /** Items seleccionados y todavía elegibles, en el orden de `items`. */
  seleccionados: T[];
  /** Ids de `seleccionados`, para pasarlos a una API sin remapear. */
  idsSeleccionados: string[];
  cantidad: number;
  estaSeleccionado: (id: string) => boolean;
  puedeSeleccionar: (id: string) => boolean;
  /** Agrega o quita un item. No hace nada si el item no es elegible. */
  alternar: (id: string) => void;
  /**
   * Agrega un item sin quitarlo nunca (a diferencia de `alternar`): el escáner
   * QR lee el mismo código varias veces seguidas y no debe deseleccionarlo.
   * Devuelve qué pasó, para que la UI lo diga.
   */
  agregar: (id: string) => ResultadoAgregar;
  /**
   * Agrega a la selección todos los elegibles que están a la vista. Es
   * acumulativo: no descarta lo que ya estaba marcado fuera del filtro, para
   * poder armar una tanda con varias búsquedas seguidas. Sin filtro equivale
   * a seleccionar todo el universo elegible.
   */
  seleccionarTodos: () => void;
  limpiar: () => void;
  /** true solo si hay al menos un elegible a la vista y están todos seleccionados. */
  todosSeleccionados: boolean;
  hayAlgunoSeleccionado: boolean;
}

export function useSeleccionMultiple<T>({
  items,
  obtenerId,
  esSeleccionable,
  visibles,
}: OpcionesSeleccionMultiple<T>): SeleccionMultiple<T> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  const seleccionables = useMemo(
    () => (esSeleccionable ? items.filter(esSeleccionable) : items),
    [items, esSeleccionable],
  );

  const idsSeleccionables = useMemo(
    () => new Set(seleccionables.map(obtenerId)),
    [seleccionables, obtenerId],
  );

  // El filtro se aplica DESPUÉS de la elegibilidad y solo para el alcance de
  // "seleccionar todos". Si en cambio se filtrara `items` antes de entrar al
  // hook, un item marcado dejaría de contarse apenas sale de la vista.
  const seleccionablesVisibles = useMemo(() => {
    if (!visibles) return seleccionables;
    const aLaVista = new Set(visibles.map(obtenerId));
    return seleccionables.filter((item) => aLaVista.has(obtenerId(item)));
  }, [visibles, seleccionables, obtenerId]);

  // Se deriva contra la elegibilidad vigente: un item que se seleccionó y
  // después dejó de ser elegible (o desapareció de la lista) sale solo, sin
  // depender de que alguien recuerde limpiarlo.
  const seleccionados = useMemo(
    () => seleccionables.filter((item) => ids.has(obtenerId(item))),
    [seleccionables, ids, obtenerId],
  );

  const puedeSeleccionar = useCallback((id: string) => idsSeleccionables.has(id), [idsSeleccionables]);

  const estaSeleccionado = useCallback(
    (id: string) => ids.has(id) && idsSeleccionables.has(id),
    [ids, idsSeleccionables],
  );

  const alternar = useCallback(
    (id: string) => {
      if (!idsSeleccionables.has(id)) return;
      setIds((previos) => {
        const siguiente = new Set(previos);
        if (siguiente.has(id)) siguiente.delete(id);
        else siguiente.add(id);
        return siguiente;
      });
    },
    [idsSeleccionables],
  );

  const idsItems = useMemo(() => new Set(items.map(obtenerId)), [items, obtenerId]);

  const agregar = useCallback(
    (id: string): ResultadoAgregar => {
      if (!idsItems.has(id)) return 'fuera_de_la_lista';
      if (!idsSeleccionables.has(id)) return 'no_seleccionable';
      if (ids.has(id)) return 'ya_estaba';
      setIds((previos) => new Set(previos).add(id));
      return 'agregado';
    },
    [idsItems, idsSeleccionables, ids],
  );

  const seleccionarTodos = useCallback(() => {
    // Acumulativo, no reemplazo: con un filtro puesto, agregar lo visible no
    // puede borrar lo que se marcó en una búsqueda anterior. Sin filtro el
    // resultado es el mismo de siempre (el universo elegible completo).
    setIds((previos) => {
      const siguiente = new Set(previos);
      for (const item of seleccionablesVisibles) siguiente.add(obtenerId(item));
      return siguiente;
    });
  }, [seleccionablesVisibles, obtenerId]);

  const limpiar = useCallback(() => setIds(new Set()), []);

  const visiblesSeleccionados = seleccionablesVisibles.filter((item) => ids.has(obtenerId(item))).length;

  return {
    seleccionables,
    seleccionablesVisibles,
    ambitoAcotado: seleccionablesVisibles.length < seleccionables.length,
    seleccionados,
    idsSeleccionados: seleccionados.map(obtenerId),
    cantidad: seleccionados.length,
    estaSeleccionado,
    puedeSeleccionar,
    alternar,
    agregar,
    seleccionarTodos,
    limpiar,
    todosSeleccionados: seleccionablesVisibles.length > 0 && visiblesSeleccionados === seleccionablesVisibles.length,
    hayAlgunoSeleccionado: seleccionados.length > 0,
  };
}
