/**
 * Contrato v3 §3 (decisiones N9 y N23): toda fecha que lee el usuario es `dd-mm-aaaa`; con hora, `dd-mm-aaaa, HH:MM` (24 h); «hoy» y «ayer»
 * solo en listas de actividad. Nunca ISO crudo, nunca una fecha sin año, nunca hora de 12 horas, nunca «hace X».
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { civilADdMmAaaa, formatearFechaCivil, formatearFechaHora, formatearHoraChile } from './fechas';
import { formatearActividad, formatearFecha, formatearFechaHoraChile, formatearMesAnio } from './v3/formatos';

const ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const DD_MM_AAAA = /\b\d{2}-\d{2}-\d{4}\b/;
const DOCE_HORAS = /\b\d{1,2}:\d{2}\s?[ap]\.?\s?m\.?/i;

// «Ahora» fijo: sábado 24-10-2026, 11:30 en Chile (UTC-3 en horario de verano).
const AHORA = new Date('2026-10-24T14:30:00Z');

const INSTANTES = {
  hoy: '2026-10-24T14:30:00Z',
  ayer: '2026-10-23T22:45:00Z',
  pasado: '2026-07-17T12:00:00Z',
  // Cerca de la medianoche UTC: en Chile todavía (o ya) es otro día.
  antesDeMedianocheChile: '2026-10-10T02:59:00Z', // 09-10 23:59 en Chile
  despuesDeMedianocheChile: '2026-10-10T03:01:00Z', // 10-10 00:01 en Chile
  medianocheUtc: '2026-10-10T00:30:00Z', // 09-10 21:30 en Chile
};
const CIVIL = '2026-10-10';

type Muestra = { nombre: string; salida: string; esperaDdMmAaaa: boolean };

function muestras(): Muestra[] {
  const salidas: Muestra[] = [];
  const poner = (nombre: string, salida: string, esperaDdMmAaaa = true) => salidas.push({ nombre, salida, esperaDdMmAaaa });
  poner('formatearFecha(civil)', formatearFecha(CIVIL));
  poner('formatearFechaCivil(civil)', formatearFechaCivil(CIVIL));
  poner('civilADdMmAaaa(civil)', civilADdMmAaaa(CIVIL));
  for (const [clave, instante] of Object.entries(INSTANTES)) {
    poner(`formatearFecha(${clave})`, formatearFecha(instante));
    poner(`formatearFechaCivil(${clave})`, formatearFechaCivil(instante));
    poner(`formatearFechaHora(${clave})`, formatearFechaHora(instante));
    poner(`formatearFechaHoraChile(${clave})`, formatearFechaHoraChile(instante));
    // Hoy y ayer salen como «hoy HH:MM» / «ayer HH:MM» (permitido en listas de actividad); lo anterior, fecha absoluta.
    poner(`formatearActividad(${clave})`, formatearActividad(instante, AHORA), clave !== 'hoy' && clave !== 'ayer');
    poner(`formatearHoraChile(${clave})`, formatearHoraChile(new Date(instante)), false);
  }
  poner('formatearMesAnio', formatearMesAnio(2026, 10), false);
  return salidas;
}

describe('formatos de fecha del contrato', () => {
  it('ningún formateador compartido produce una fecha ISO (aaaa-mm-dd) ni una hora de 12 horas', () => {
    for (const { nombre, salida } of muestras()) {
      expect(salida, nombre).not.toMatch(ISO);
      expect(salida, nombre).not.toMatch(DOCE_HORAS);
      expect(salida, nombre).not.toMatch(/\bhace\b/i);
    }
  });

  it('toda fecha que no es «hoy» ni «ayer» lleva día, mes y año completos (dd-mm-aaaa)', () => {
    for (const { nombre, salida, esperaDdMmAaaa } of muestras()) {
      if (esperaDdMmAaaa) expect(salida, nombre).toMatch(DD_MM_AAAA);
    }
  });

  it('una fecha civil no se corre de día por la zona horaria', () => {
    expect(formatearFecha('2026-10-10')).toBe('10-10-2026');
    expect(formatearFecha('2026-01-01')).toBe('01-01-2026');
    expect(formatearFecha('2026-12-31')).toBe('31-12-2026');
    expect(civilADdMmAaaa('2026-10-10')).toBe('10-10-2026');
  });

  it('un instante cerca de medianoche cae en el día de Chile, no en el de UTC', () => {
    expect(formatearFechaCivil(INSTANTES.antesDeMedianocheChile)).toBe('09-10-2026');
    expect(formatearFechaCivil(INSTANTES.despuesDeMedianocheChile)).toBe('10-10-2026');
    expect(formatearFechaCivil(INSTANTES.medianocheUtc)).toBe('09-10-2026');
  });

  it('fecha y hora: dd-mm-aaaa, HH:MM en 24 horas, y la medianoche es 00:00 (no 24:00)', () => {
    expect(formatearFechaHora('2026-10-23T19:39:00Z')).toBe('23-10-2026, 16:39');
    expect(formatearFechaHora('2026-10-23T22:05:00Z')).toBe('23-10-2026, 19:05');
    expect(formatearFechaHora(INSTANTES.despuesDeMedianocheChile)).toBe('10-10-2026, 00:01');
    expect(formatearFechaHora(INSTANTES.antesDeMedianocheChile)).toBe('09-10-2026, 23:59');
    expect(formatearFechaHora('2026-07-01T04:00:00Z')).toBe('01-07-2026, 00:00'); // invierno: UTC-4
    expect(formatearFechaHoraChile).toBe(formatearFechaHora); // una sola fuente de verdad
  });

  it('actividad: «hoy» y «ayer» con la hora; antes, la fecha absoluta con hora', () => {
    expect(formatearActividad(INSTANTES.hoy, AHORA)).toBe('hoy 11:30');
    expect(formatearActividad(INSTANTES.ayer, AHORA)).toBe('ayer 19:45');
    expect(formatearActividad(INSTANTES.pasado, AHORA)).toBe('17-07-2026, 08:00');
  });

  it('un valor ausente o inválido dice «Sin fecha registrada», nunca un texto crudo', () => {
    for (const f of [formatearFecha, formatearFechaCivil, formatearFechaHora, formatearFechaHoraChile]) {
      expect(f(null)).toBe('Sin fecha registrada');
      expect(f(undefined)).toBe('Sin fecha registrada');
      expect(f('no es una fecha')).toBe('Sin fecha registrada');
    }
  });

  it('el mes de un gráfico es mm-aaaa', () => {
    expect(formatearMesAnio(2026, 10)).toBe('10-2026');
    expect(formatearMesAnio(2026, 3)).toBe('03-2026');
  });
});

describe('el código no formatea fechas por su cuenta', () => {
  const RAIZ = join(process.cwd(), 'src'); // vitest corre con frontend/ como carpeta de trabajo
  const PROHIBIDO = [
    { patron: /toLocale(Date|Time)String\(/, motivo: 'toLocaleDateString/toLocaleTimeString dan formatos que dependen del navegador' },
    { patron: /\b(dateStyle|timeStyle)\s*:/, motivo: 'dateStyle/timeStyle dan nombres de mes u horas de 12 horas' },
    { patron: /\bmonth\s*:\s*['"](short|long|numeric)['"]/, motivo: 'el mes se escribe con dos cifras (dd-mm-aaaa)' },
    { patron: /hour12\s*:\s*true/, motivo: 'la hora es de 24 horas' },
  ];

  function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) return archivos(ruta);
      return /\.(ts|tsx)$/.test(nombre) && !/\.test\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
    });
  }

  it('ninguna pantalla usa dateStyle, nombres de mes, hora de 12 horas ni toLocaleDateString', () => {
    const infracciones: string[] = [];
    const todos = archivos(RAIZ);
    expect(todos.length).toBeGreaterThan(100); // el recorrido encuentra el código de verdad
    for (const ruta of todos) {
      const texto = readFileSync(ruta, 'utf8');
      for (const { patron, motivo } of PROHIBIDO) {
        if (patron.test(texto)) infracciones.push(`${ruta.slice(RAIZ.length)}: ${motivo}`);
      }
    }
    expect(infracciones).toEqual([]);
  });
});
