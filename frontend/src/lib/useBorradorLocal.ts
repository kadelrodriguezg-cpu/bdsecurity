/** Borrador local con debounce de 1,5 s. No persiste valores iniciales intactos
 * ni vuelve a guardar al desmontar (la sesión puede estar cerrándose).
 * limpiar() conserva la memoria y cancela cualquier escritura pendiente. */
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

type EstadoBorrador = 'idle' | 'guardando' | 'guardado';
interface Estado<T> {
  generacion: symbol;
  clave: string;
  valor: T;
  inicial: T;
  revision: number;
  recuperadoEn: number | null;
  estado: EstadoBorrador;
  errorPersistencia: string | null;
}

function objeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function leer<T extends Record<string, unknown>>(clave: string, inicial: T, persistir = true): Estado<T> {
  const estado: Estado<T> = { generacion: Symbol(clave), clave, valor: inicial, inicial, revision: 0, recuperadoEn: null, estado: 'idle', errorPersistencia: null };
  if (!persistir) return estado;
  try {
    const raw = localStorage.getItem(clave);
    if (!raw) return estado;
    const dato: unknown = JSON.parse(raw);
    if (!objeto(dato) || !objeto(dato.valor) || typeof dato.guardadoEn !== 'number'
      || !Number.isFinite(dato.guardadoEn) || dato.guardadoEn < 0 || dato.guardadoEn > 8.64e15) {
      return estado;
    }
    return { ...estado, valor: { ...inicial, ...dato.valor }, recuperadoEn: dato.guardadoEn };
  } catch {
    return { ...estado, errorPersistencia: 'No se pudo recuperar el borrador local.' };
  }
}

function distinto(valor: Record<string, unknown>, inicial: Record<string, unknown>): boolean {
  return [...new Set([...Object.keys(valor), ...Object.keys(inicial)])]
    .some((campo) => JSON.stringify(valor[campo]) !== JSON.stringify(inicial[campo]));
}

export function useBorradorLocal<T extends Record<string, unknown>>(
  claveBase: string, valorInicial: T, opciones?: { usuarioId: string | null },
) {
  const persistir = opciones === undefined || Boolean(opciones.usuarioId);
  // Las claves legadas no acreditan propietario: nunca se adoptan.
  const clave = opciones === undefined ? claveBase : opciones.usuarioId
    ? 'borrador:usuario:' + encodeURIComponent(opciones.usuarioId) + ':' + claveBase.replace(/^borrador:/, '')
    : 'memoria:' + claveBase;
  const [datos, setDatos] = useState(() => leer(clave, valorInicial, persistir));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);
  const generacion = datos.generacion;
  const generacionActual = useRef(generacion);
  generacionActual.current = generacion;
  // Último valor que ESTA instancia sabe que está en el almacenamiento bajo su
  // clave (recuperado al montar o escrito por su propio autosave).
  const propio = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    propio.current = datos.recuperadoEn !== null ? datos.valor : null;
    // Solo al cambiar de entidad: los cambios posteriores los registra el autosave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos.generacion]);

  // Ajuste de estado durante render: React repite este render antes de que los
  // consumidores puedan confirmar efectos con el valor de la entidad anterior.
  if (datos.clave !== clave) setDatos(leer(clave, valorInicial, persistir));

  const setValor = useCallback((accion: SetStateAction<T>) => {
    if (!montado.current || generacionActual.current !== generacion) return;
    setDatos((actual) => {
      if (actual.generacion !== generacion) return actual;
      const valor = typeof accion === 'function' ? accion(actual.valor) : accion;
      if (!distinto(valor, actual.valor)) return actual;
      return { ...actual, valor, revision: actual.revision + 1 };
    });
  }, [generacion]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!persistir || datos.clave !== clave || datos.revision === 0) return;
    if (!distinto(datos.valor, datos.inicial)) {
      try {
        localStorage.removeItem(clave);
        propio.current = null;
        setDatos((actual) => ({ ...actual, estado: 'idle', recuperadoEn: null, errorPersistencia: null }));
      } catch {
        setDatos((actual) => ({ ...actual, estado: 'idle', errorPersistencia: 'No se pudo eliminar el borrador local.' }));
      }
      return;
    }
    setDatos((actual) => ({ ...actual, estado: 'guardando', errorPersistencia: null }));
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(clave, JSON.stringify({ valor: datos.valor, guardadoEn: Date.now() }));
        propio.current = datos.valor;
        setDatos((actual) => ({ ...actual, estado: 'guardado', errorPersistencia: null }));
      } catch {
        setDatos((actual) => ({ ...actual, estado: 'idle', errorPersistencia: 'No se pudo guardar el borrador local. Los cambios siguen en este formulario.' }));
      }
    }, 1500);
    return () => clearTimeout(timer.current);
  }, [clave, persistir, datos.clave, datos.valor, datos.inicial, datos.revision]);

  // Instancia ya desmontada (p. ej. hoja cerrada con el guardado en vuelo): solo
  // se retira del almacenamiento el borrador que esta misma instancia recuperó o
  // escribió. Si otra instancia de la misma clave lo reescribió con otro
  // contenido, se respeta. No toca estado de React.
  const retirarBorradorPropio = () => {
    const mio = propio.current;
    if (!persistir || mio === null) return;
    try {
      const raw = localStorage.getItem(clave);
      if (!raw) return;
      const dato: unknown = JSON.parse(raw);
      if (objeto(dato) && objeto(dato.valor) && !distinto({ ...datos.inicial, ...dato.valor }, mio)) {
        localStorage.removeItem(clave);
        propio.current = null;
      }
    } catch {
      // Almacenamiento bloqueado o corrupto: el formulario ya no existe, no hay a quién avisar.
    }
  };

  const limpiar = () => {
    // Un guardado de A puede terminar después de navegar a B. No debe
    // cancelar el timer ni modificar el estado del nuevo formulario.
    if (generacionActual.current !== generacion) return;
    if (!montado.current) { retirarBorradorPropio(); return; }
    clearTimeout(timer.current);
    let errorPersistencia: string | null = null;
    try { if (persistir) localStorage.removeItem(clave); }
    catch { errorPersistencia = 'No se pudo eliminar el borrador local.'; }
    setDatos((actual) => actual.generacion === generacion
      ? { ...actual, revision: 0, recuperadoEn: null, estado: 'idle', errorPersistencia } : actual);
  };

  const descartarRecuperado = () => {
    if (!montado.current || generacionActual.current !== generacion) return;
    limpiar();
    setDatos((actual) => actual.generacion === generacion ? { ...actual, valor: actual.inicial } : actual);
  };

  // Una creación debe conservar su identidad ANTES de enviar la petición,
  // sin depender del debounce. Respeta las mismas fronteras de propietario.
  const guardarAhora = (valor: T): boolean => {
    if (!persistir || !montado.current || generacionActual.current !== generacion) return false;
    clearTimeout(timer.current);
    try {
      localStorage.setItem(clave, JSON.stringify({ valor, guardadoEn: Date.now() }));
      propio.current = valor;
      setDatos(actual => actual.generacion === generacion
        ? { ...actual, valor, revision: 0, estado: 'guardado', errorPersistencia: null } : actual);
      return true;
    } catch {
      setDatos(actual => actual.generacion === generacion
        ? { ...actual, estado: 'idle', errorPersistencia: 'No se pudo guardar el borrador local. Los cambios siguen en este formulario.' } : actual);
      return false;
    }
  };

  return {
    persistenciaHabilitada: persistir,
    valor: datos.valor,
    setValor,
    estado: datos.estado,
    errorPersistencia: datos.errorPersistencia,
    hayContenido: distinto(datos.valor, datos.inicial),
    recuperadoEn: datos.recuperadoEn,
    limpiar,
    descartarRecuperado,
    guardarAhora,
  };
}
