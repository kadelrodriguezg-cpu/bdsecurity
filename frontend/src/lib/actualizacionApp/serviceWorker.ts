/**
 * Antes de recargar por una versión nueva hay que dejar que el service worker
 * nuevo se instale y se active: si no, la recarga sale del precache del worker
 * viejo y la pestaña vuelve a cargar el código antiguo. El worker de la app se
 * activa solo (skipWaiting + clientsClaim), así que basta con pedir la revisión
 * y esperar, con un tope, a que termine de instalarse.
 */
const TOPE_MS = 10_000;

type Contenedor = Pick<ServiceWorkerContainer, 'getRegistration'>;

function contenedorDelNavegador(): Contenedor | undefined {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
}

export async function actualizarServiceWorker(
  contenedor: Contenedor | undefined = contenedorDelNavegador(),
  topeMs: number = TOPE_MS,
): Promise<void> {
  if (!contenedor) return;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<void>((resolver) => { temporizador = setTimeout(resolver, topeMs); });
  const trabajo = (async () => {
    const registro = await contenedor.getRegistration();
    if (!registro) return;
    await registro.update();
    const nuevo = registro.installing ?? registro.waiting;
    if (!nuevo || nuevo.state === 'activated') return;
    await new Promise<void>((resolver) => {
      const alCambiar = () => {
        if (nuevo.state === 'activated' || nuevo.state === 'redundant') {
          nuevo.removeEventListener('statechange', alCambiar);
          resolver();
        }
      };
      nuevo.addEventListener('statechange', alCambiar);
    });
  })().catch(() => undefined);
  try {
    await Promise.race([trabajo, tope]);
  } finally {
    clearTimeout(temporizador);
  }
}
