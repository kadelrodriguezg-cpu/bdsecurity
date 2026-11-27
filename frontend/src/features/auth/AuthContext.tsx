/**
 * Contexto de autenticación.
 *
 * Expone el usuario de Supabase Auth + su PERFIL de negocio (rol y permiso de
 * linaje, leídos de la tabla perfiles — nunca asumidos desde el frontend).
 * El rol acá se usa SOLO para decidir qué UI mostrar; la seguridad real la
 * imponen el RLS y los triggers del backend. Si alguien manipulara este
 * contexto en su navegador, vería pantallas de admin vacías: la base no le
 * devolvería los datos igual.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { supabase } from '@/api/client';
import { miPerfil, type Perfil } from '@/api/perfiles';
import { push } from '@/api/push';
import { borrarBorradoresDe, marcarSesionExpirada, olvidarSesionExpirada } from '@/lib/borradoresSesion';
import { olvidarPushAlCerrarSesion } from '@/lib/push/dispositivo';

interface AuthState {
  generacionSesion: number;
  capturarVigenciaSesion: () => () => boolean;
  user: User | null;
  perfil: Perfil | null;
  esAdmin: boolean;
  cargando: boolean;
  /** Mensaje seguro si la carga del perfil falló; la sesión sigue abierta. */
  errorPerfil: string | null;
  /** Repite la carga del perfil de la sesión actual. */
  reintentarPerfil: () => void;
  recargarPerfil: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  /** Cierre manual: solo esta sesión (scope local) y borra los borradores de quien cierra. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);
  const [intentoPerfil, setIntentoPerfil] = useState(0);
  const identidad = useRef<string | null>(null);
  const generacion = useRef(0);
  // Distingue el cierre manual (logout) de una sesión que caduca o se revoca.
  const cierreManual = useRef(false);
  const [generacionSesion, setGeneracionSesion] = useState(0);

  useEffect(() => {
    let activo = true;
    let huboEvento = false;
    const aplicarSesion = (siguiente: User | null) => {
      if (!activo) return;
      const id = siguiente?.id ?? null;
      if (siguiente && identidad.current === id) return;
      identidad.current = id;
      generacion.current += 1;
      // A→B→A puede terminar con la misma referencia de user en un solo batch.
      // La generación reactiva obliga a cargar el perfil de esta nueva sesión.
      setGeneracionSesion(generacion.current);
      queryClient.clear();
      setPerfil(null);
      setErrorPerfil(null);
      setCargando(Boolean(siguiente));
      setUser(siguiente);
      if (siguiente) olvidarSesionExpirada();
    };
    supabase.auth.getSession().then(({ data }) => {
      if (!huboEvento) aplicarSesion(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, session) => {
      huboEvento = true;
      // U-01: una sesión que caduca o se revoca NO borra los borradores (son por
      // usuario); el login avisa que siguen guardados en este equipo.
      if (!session && identidad.current && !cierreManual.current) marcarSesionExpirada(identidad.current);
      aplicarSesion(session?.user ?? null);
    });
    return () => {
      activo = false;
      generacion.current += 1;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  // Cada vez que hay usuario, cargamos su perfil (rol real desde la base).
  useEffect(() => {
    if (!user) return;
    let cancelado = false;
    const solicitud = generacion.current;
    const vigente = () => !cancelado && solicitud === generacion.current;
    setCargando(true);
    miPerfil()
      .then((p) => {
        if (!vigente()) return;
        setPerfil(p);
        setErrorPerfil(null);
      })
      .catch(() => {
        if (!vigente()) return;
        // traducirError (api/client.ts) ya registró código y constraint en
        // consola y Sentry. Acá solo se evita que el usuario quede como
        // "no admin" en silencio: la UI muestra el aviso y permite reintentar.
        setPerfil(null);
        setErrorPerfil('No se pudo cargar tu perfil. Las opciones según tu rol pueden no aparecer hasta reintentar.');
      })
      .finally(() => { if (vigente()) setCargando(false); });
    return () => { cancelado = true; };
  }, [user, generacionSesion, intentoPerfil]);

  const reintentarPerfil = useCallback(() => setIntentoPerfil((n) => n + 1), []);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[Auth error]', error);
      Sentry.captureException(error, {
        tags: { auth_action: 'login' },
      });
      throw new Error(
        error.message === 'Invalid login credentials'
          ? 'Email o contraseña incorrectos.'
          : 'No se pudo iniciar sesión. Intenta de nuevo.',
      );
    }
  };

  const logout = async () => {
    const id = identidad.current;
    cierreManual.current = true;
    try {
      // Push: en un PC compartido nadie sigue recibiendo las menciones de esta persona.
      // Va antes del signOut porque borrar la suscripción en la base necesita la sesión.
      await olvidarPushAlCerrarSesion(push);
      // U-45: scope local cierra solo este equipo. Con scope local, supabase-js
      // quita la sesión local aunque falle la llamada de red.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) Sentry.captureException(error, { tags: { auth_action: 'logout' } });
      if (id) borrarBorradoresDe(id);
      olvidarSesionExpirada();
    } finally {
      cierreManual.current = false;
    }
  };

  const recargarPerfil = async () => {
    if (!user) {
      setPerfil(null);
      return;
    }
    const solicitud = generacion.current;
    const siguientePerfil = await miPerfil();
    if (solicitud === generacion.current) setPerfil(siguientePerfil);
  };

  const capturarVigenciaSesion = useCallback(() => {
    const id = identidad.current;
    const version = generacion.current;
    return () => id !== null && identidad.current === id && generacion.current === version;
  }, []);

  return (
    <AuthContext.Provider
      value={{ generacionSesion, capturarVigenciaSesion, user, perfil, esAdmin: perfil?.rol === 'admin', cargando, errorPerfil, reintentarPerfil, recargarPerfil, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
