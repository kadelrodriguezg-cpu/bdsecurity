import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Mismos tamaños que tailwind.config.ts; no deben confundirse con colores.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['display', 'title', 'body-l', 'body', 'small', 'micro'] }] } },
});

/** Combina clases de Tailwind resolviendo conflictos (patrón estándar shadcn). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

