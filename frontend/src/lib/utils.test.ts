import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn — tamaños del sistema de diseño', () => {
  it.each(['display', 'title', 'body-l', 'body', 'small', 'micro'])('conserva text-%s junto al color', (size) => {
    expect(cn(`text-${size}`, 'text-ink-3')).toBe(`text-${size} text-ink-3`);
    expect(cn('text-white', `text-${size}`)).toBe(`text-white text-${size}`);
  });
  it('resuelve tamaños y colores independientemente, también por breakpoint', () => {
    expect(cn('text-body text-ink', 'text-small text-primary')).toBe('text-small text-primary');
    expect(cn('md:text-body md:text-ink', 'md:text-small md:text-primary')).toBe('md:text-small md:text-primary');
    expect(cn('text-small', 'text-lg')).toBe('text-lg');
  });
});
