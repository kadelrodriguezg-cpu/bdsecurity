/** Identidad durable para los dos flujos acumulativos de individuos.
 * Solo UUID y parámetros operativos; nunca linaje ni credenciales. */
export async function conIntentoCreacion<T>(usuarioId: string, entidad: string, solicitud: Record<string, unknown>, ejecutar: (id: string) => Promise<T>): Promise<T> {
  const clave = `intento:usuario:${encodeURIComponent(usuarioId)}:${entidad}`;
  let id: string;
  try {
    const raw = localStorage.getItem(clave);
    const previo = raw ? JSON.parse(raw) as { id: string; solicitud: Record<string, unknown> } : null;
    if (previo && JSON.stringify(previo.solicitud) !== JSON.stringify(solicitud)) {
      const cantidad = typeof previo.solicitud?.cantidad === 'number' ? ` La cantidad original es ${previo.solicitud.cantidad}.` : '';
      throw new Error(`Hay un envío pendiente con otros datos.${cantidad} Reintenta los datos originales para confirmar su resultado antes de crear otro lote.`);
    }
    id = previo?.id ?? crypto.randomUUID();
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error('El intento guardado no es válido.');
    localStorage.setItem(clave, JSON.stringify({ id, solicitud }));
  } catch (e) {
    throw new Error(e instanceof Error && e.message.startsWith('Hay un envío pendiente') ? e.message
      : 'No se pudo conservar el intento en este dispositivo. No se envió la creación; revisa el almacenamiento local.');
  }
  const resultado = await ejecutar(id);
  try {
    const actual = localStorage.getItem(clave);
    if (actual && (JSON.parse(actual) as { id: string }).id === id) localStorage.removeItem(clave);
  } catch {
    throw new Error('La creación se confirmó, pero no se pudo cerrar el intento local. Reintenta los mismos datos para recuperar su resultado sin duplicarlo.');
  }
  return resultado;
}
