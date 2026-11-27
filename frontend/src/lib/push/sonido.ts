/**
 * Aviso sonoro de mención dentro de la app (Web Audio, sin archivos de audio).
 * Directa: dos notas ascendentes cortas. @all: una nota más suave.
 * Suena solo con la página a la vista. prefers-reduced-motion no lo afecta:
 * esa preferencia es visual.
 */
import { notificacionSiempreVisible } from './reglaNotificacion';

const CLAVE_PREFERENCIA = 'bds.sonidoApp';

export function sonidoActivado(): boolean {
  try {
    return localStorage.getItem(CLAVE_PREFERENCIA) !== 'no';
  } catch {
    return true;
  }
}

export function guardarSonidoActivado(activo: boolean): void {
  try {
    localStorage.setItem(CLAVE_PREFERENCIA, activo ? 'si' : 'no');
  } catch {
    // Sin almacenamiento (modo privado): vale para esta sesión por defecto.
  }
}

type ConstructorAudio = typeof AudioContext;
let contexto: AudioContext | null = null;

function constructorAudio(): ConstructorAudio | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: ConstructorAudio }).webkitAudioContext;
}

/** Crea o reanuda el AudioContext. Por la política de autoplay, solo dentro de un gesto. */
function prepararAudio(): void {
  const Ctor = constructorAudio();
  if (!Ctor) return;
  try {
    contexto ??= new Ctor();
    if (contexto.state === 'suspended') void contexto.resume();
  } catch {
    contexto = null;
  }
}

/** Escucha la primera interacción con la página para habilitar el audio. */
export function instalarDesbloqueoAudio(): () => void {
  const eventos = ['pointerdown', 'keydown', 'touchend'] as const;
  const alInteractuar = () => {
    prepararAudio();
    if (contexto?.state === 'running') quitar();
  };
  const quitar = () => eventos.forEach((nombre) => document.removeEventListener(nombre, alInteractuar, true));
  eventos.forEach((nombre) => document.addEventListener(nombre, alInteractuar, true));
  return quitar;
}

function nota(ctx: AudioContext, frecuencia: number, inicio: number, duracion: number, volumen: number): void {
  const oscilador = ctx.createOscillator();
  const ganancia = ctx.createGain();
  oscilador.type = 'sine';
  oscilador.frequency.setValueAtTime(frecuencia, inicio);
  ganancia.gain.setValueAtTime(0.0001, inicio);
  ganancia.gain.exponentialRampToValueAtTime(volumen, inicio + 0.012);
  ganancia.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
  oscilador.connect(ganancia).connect(ctx.destination);
  oscilador.start(inicio);
  oscilador.stop(inicio + duracion + 0.02);
}

export interface CondicionesSonido {
  visible: boolean;
  activado: boolean;
  /** ¿Este dispositivo tiene push activo? */
  pushActivo: boolean;
  userAgent: string;
}

/**
 * ¿Debe sonar? Solo con la página a la vista y la preferencia activa. Si el
 * navegador muestra siempre la notificación del sistema (Safari) y este
 * dispositivo tiene push, ya avisa el sistema: no se duplica.
 */
export function debeSonar(c: CondicionesSonido): boolean {
  if (!c.visible || !c.activado) return false;
  return !(c.pushActivo && notificacionSiempreVisible(c.userAgent));
}

/** Toca el tono. Devuelve false si el audio todavía no está habilitado. */
export function tocarTonoMencion(tipo: 'directa' | 'todos'): boolean {
  const ctx = contexto;
  if (!ctx || ctx.state !== 'running') return false;
  const ahora = ctx.currentTime + 0.01;
  if (tipo === 'directa') {
    nota(ctx, 880, ahora, 0.11, 0.18);
    nota(ctx, 1318.5, ahora + 0.12, 0.16, 0.18);
  } else {
    nota(ctx, 659.25, ahora, 0.22, 0.09);
  }
  return true;
}
