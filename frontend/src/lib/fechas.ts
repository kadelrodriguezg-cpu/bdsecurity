const ZONA_HORARIA_CHILE = 'America/Santiago';
const FORMATO_PARTES_CHILE = new Intl.DateTimeFormat('en', {
  timeZone: ZONA_HORARIA_CHILE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Partes (año, mes, día, hora, minuto) de un instante en la zona de Chile, todas con dos dígitos (el año con cuatro). */
function partesChile(instante: Date): { anio: string; mes: string; dia: string; hora: string; minuto: string } {
  const partes = FORMATO_PARTES_CHILE.formatToParts(instante);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((parte) => parte.type === tipo)?.value ?? '';
  // Algunos motores devuelven «24» a medianoche con h23 mal soportado: se normaliza a «00».
  const hora = valor('hour') === '24' ? '00' : valor('hour');
  return { anio: valor('year'), mes: valor('month'), dia: valor('day'), hora, minuto: valor('minute') };
}

/** Fecha civil `aaaa-mm-dd` → `dd-mm-aaaa`, reordenando el texto: sin pasar por `Date`, así no hay corrimiento de día por UTC. */
export function civilADdMmAaaa(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return `${dia}-${mes}-${anio}`;
}

/**
 * Fecha civil de hoy en Chile en formato ISO (YYYY-MM-DD).
 *
 * No usa `toISOString()`: ese método convierte a UTC y puede devolver el día
 * anterior/siguiente cerca de medianoche, algo inaceptable para registros de
 * campo que representan una fecha civil y no un instante.
 */
export function hoyChileISO(ahora = new Date()): string {
  const partes = new Intl.DateTimeFormat('en', {
    timeZone: ZONA_HORARIA_CHILE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ahora);

  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value;

  const anio = valor('year');
  const mes = valor('month');
  const dia = valor('day');
  if (!anio || !mes || !dia) throw new Error('No se pudo calcular la fecha local de Chile.');
  return `${anio}-${mes}-${dia}`;
}

/**
 * Presenta una fecha en el formato del contrato (`dd-mm-aaaa`, decisión N9/N23) sin desplazarla al día anterior por conversión UTC.
 * Una fecha civil `aaaa-mm-dd` se reordena tal cual; un instante con hora se lleva al día de Chile.
 */
export function formatearFechaCivil(fecha: string | null | undefined, vacio = 'Sin fecha registrada'): string {
  if (!fecha) return vacio;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return civilADdMmAaaa(fecha);
  const instante = new Date(fecha);
  if (Number.isNaN(instante.getTime())) return vacio;
  const { anio, mes, dia } = partesChile(instante);
  return `${dia}-${mes}-${anio}`;
}

/** Presenta un instante con fecha y hora de Chile en el formato del contrato: «23-10-2026, 16:39» (`dd-mm-aaaa`, hora de 24 h). */
export function formatearFechaHora(fecha: string | null | undefined, vacio = 'Sin fecha registrada'): string {
  if (!fecha) return vacio;
  const instante = new Date(fecha);
  if (Number.isNaN(instante.getTime())) return vacio;
  const { anio, mes, dia, hora, minuto } = partesChile(instante);
  return `${dia}-${mes}-${anio}, ${hora}:${minuto}`;
}

/** Hora de Chile de un instante en 24 h: «16:39». «» si no es un instante válido. */
export function formatearHoraChile(instante: Date): string {
  if (Number.isNaN(instante.getTime())) return '';
  const { hora, minuto } = partesChile(instante);
  return `${hora}:${minuto}`;
}
