import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Mantener clases heredadas sin interpolar colores ni sombras.
      transitionProperty: {
        DEFAULT: 'color, background-color, border-color, text-decoration-color, fill, stroke, opacity, transform',
        colors: 'color, background-color, border-color, text-decoration-color, fill, stroke',
        shadow: 'transform, opacity',
      },
      transitionDuration: {
        DEFAULT: 'var(--dur-transition)',
        feedback: 'var(--dur-feedback)',
        motion: 'var(--dur-transition)',
        overlay: 'var(--dur-overlay)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease-standard)',
        enter: 'var(--ease-enter)',
        exit: 'var(--ease-exit)',
      },
      animation: {
        spin: 'spin calc(var(--dur-overlay) * 3) linear infinite',
        pulse: 'pulse calc(var(--dur-overlay) * 4) var(--ease-standard) 2',
      },
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        line: 'var(--line)',
        'line-soft': 'var(--line-soft)',
        'line-strong': 'var(--line-strong)',
        track: 'var(--track)',
        'neutral-l': 'var(--neutral-l)',

        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
        },

        // primary se mantiene por compatibilidad (~20 archivos ya la usan);
        // ahora apunta al token --brand en vez del verde original.
        primary: {
          DEFAULT: 'var(--brand)',
          foreground: '#ffffff',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          d: 'var(--brand-d)',
          l: 'var(--brand-l)',
          s: 'var(--brand-s)',
          c: 'var(--brand-c)',
          ink: 'var(--brand-ink)',
        },

        ok: { DEFAULT: 'var(--ok)', l: 'var(--ok-l)' },
        warn: { DEFAULT: 'var(--warn)', l: 'var(--warn-l)', t: 'var(--warn-t)' },
        danger: { DEFAULT: 'var(--danger)', l: 'var(--danger-l)' },
      },
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        mono: ['"JetBrains Mono"', ...defaultTheme.fontFamily.mono],
      },
      fontSize: {
        display: '22px',
        title: '18px',
        'body-l': '15px',
        body: '13px',
        // Piso de DESIGN.md: nada por debajo de 12 px. `micro` queda como alias de `small`
        // para no tocar los ~50 usos; los metadatos de 13 px usan `text-body`.
        small: '12px',
        micro: '12px',
      },
      spacing: {
        'space-1': 'var(--space-1)',
        'space-2': 'var(--space-2)',
        'space-3': 'var(--space-3)',
        'space-4': 'var(--space-4)',
        'space-5': 'var(--space-5)',
        'space-6': 'var(--space-6)',
        tap: 'var(--tap)',
      },
      borderRadius: {
        md: 'var(--r)', // controles
        lg: 'var(--r-l)', // superficies grandes
      },
      boxShadow: {
        sm: 'var(--shadow)',
        xl: 'var(--shadow-hi)',
      },
    },
  },
  plugins: [],
} satisfies Config;
