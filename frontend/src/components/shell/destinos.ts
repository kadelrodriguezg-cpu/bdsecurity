/** Destinos de la navegación principal del shell de v3 y las secciones de «Resultados» y «Administración» (docs/rediseno_v3/shell.md). */
import { Home, Leaf, ShieldCheck, Trophy, type LucideIcon } from 'lucide-react';
import { IMPORTADOR_CRUCES_VISIBLE } from '@/lib/funcionalidades';

export type DestinoId = 'inicio' | 'cruces' | 'resultados' | 'administracion';

export type Destino = {
  id: DestinoId;
  etiqueta: string;
  /** Ruta de entrada del destino. */
  to: string;
  icono: LucideIcon;
  soloAdmin?: boolean;
  /** ¿La ruta actual pertenece a este destino? */
  activo: (pathname: string) => boolean;
};

const empiezaCon = (pathname: string, ...bases: string[]) => bases.some((base) => pathname === base || pathname.startsWith(`${base}/`));

export const DESTINOS: Destino[] = [
  { id: 'inicio', etiqueta: 'Inicio', to: '/', icono: Home, activo: (p) => p === '/' },
  {
    id: 'cruces', etiqueta: 'Cruces', to: '/plantas', icono: Leaf,
    activo: (p) => empiezaCon(p, '/plantas', '/planta', '/individuo', '/nueva-planta'),
  },
  {
    id: 'resultados', etiqueta: 'Resultados', to: '/resultados', icono: Trophy,
    activo: (p) => empiezaCon(p, '/resultados', '/ranking', '/dashboard', '/visualizaciones'),
  },
  {
    id: 'administracion', etiqueta: 'Administración', to: '/administracion', icono: ShieldCheck, soloAdmin: true,
    activo: (p) => empiezaCon(p, '/administracion', '/usuarios', '/catalogos', '/cruzamientos', '/importar-cruces', '/nueva-especie'),
  },
];

export function destinosPara(esAdmin: boolean): Destino[] {
  return DESTINOS.filter((destino) => !destino.soloAdmin || esAdmin);
}

export type Seccion = { to: string; etiqueta: string };

/** Pantallas que ya existen, agrupadas por destino (sin fusionar nada; N3). */
export function seccionesDe(destino: 'resultados' | 'administracion'): Seccion[] {
  // Resultados v3 no tiene secciones: es una sola tabla con «otras vistas» enlazadas desde la propia pantalla (N19).
  if (destino === 'resultados') return [];
  // Administración entra a Administrar cruces (decisión N11).
  return [
    { to: '/cruzamientos', etiqueta: 'Administrar cruces' },
    { to: '/usuarios', etiqueta: 'Usuarios' },
    { to: '/catalogos', etiqueta: 'Catálogos' },
    ...(IMPORTADOR_CRUCES_VISIBLE ? [{ to: '/importar-cruces', etiqueta: 'Importar cruces' }] : []),
  ];
}

/** Vistas con tablas anchas: usan hasta 1600 px; el resto de las pantallas, 5xl (igual que antes del shell). */
export function anchoAmplio(pathname: string): boolean {
  return ['/resultados', '/resultados/polinizacion', '/resultados/mapa', '/resultados/tendencias', '/plantas', '/usuarios', '/catalogos', '/cruzamientos', '/evecl', '/evecl/comparar'].includes(pathname)
    || /^\/planta\/[^/]+\/evaluacion\/[^/]+$/.test(pathname);
}
