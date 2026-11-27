/*
 * Notificaciones push de menciones (docs/diseno_notificaciones_push.md).
 * No es un service worker propio: lo carga el que genera vite-plugin-pwa
 * (generateSW) con `workbox.importScripts: ['sw-push.js']`.
 *
 * El payload trae solo { titulo, cuerpo, url, tag }: nunca el texto del mensaje.
 */

/**
 * Safari (macOS e iOS) revoca la suscripción si un push no muestra
 * notificación, así que ahí se muestra siempre. Chrome, Edge y Firefox aceptan
 * omitirla cuando una ventana del sitio está a la vista (la app avisa con su
 * sonido). La app aplica la misma regla en src/lib/push/reglaNotificacion.ts.
 */
function muestraSiempre(userAgent) {
  return /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|Android/.test(userAgent);
}

function leerPayload(datos) {
  try {
    const valor = datos ? datos.json() : null;
    return valor && typeof valor === 'object' ? valor : {};
  } catch (_) {
    return {};
  }
}

/** Solo rutas internas: la notificación nunca abre otro sitio. */
function urlInterna(valor) {
  if (typeof valor !== 'string' || !valor.startsWith('/') || valor.startsWith('//')) return '/';
  return valor;
}

async function ventanasDeLaApp() {
  const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return ventanas.filter((ventana) => new URL(ventana.url).origin === self.location.origin);
}

self.addEventListener('push', (evento) => {
  evento.waitUntil((async () => {
    const datos = leerPayload(evento.data);
    const tag = typeof datos.tag === 'string' ? datos.tag : 'mencion';
    const ventanas = await ventanasDeLaApp();
    const visible = ventanas.some((ventana) => ventana.visibilityState === 'visible');
    if (visible && !muestraSiempre(self.navigator.userAgent)) return;
    await self.registration.showNotification(
      typeof datos.titulo === 'string' ? datos.titulo : 'BDSecurity',
      {
        body: typeof datos.cuerpo === 'string' ? datos.cuerpo : 'Tienes una mención nueva. Abre la app para verla.',
        icon: '/pwa-192x192.png',
        badge: '/badge-96x96.png',
        tag,
        renotify: true,
        requireInteraction: true,
        silent: false,
        data: { url: urlInterna(datos.url) },
      },
    );
  })());
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const url = new URL(urlInterna(evento.notification.data && evento.notification.data.url), self.location.origin);
  evento.waitUntil((async () => {
    const ventanas = await ventanasDeLaApp();
    const ventana = ventanas.find((v) => v.focused) || ventanas[0];
    if (ventana) {
      // La app abre el chat en ese canal sin recargar (ChatPanelContext escucha este mensaje).
      await ventana.focus();
      ventana.postMessage({
        tipo: 'abrir-chat',
        canalId: url.searchParams.get('chat'),
        mensajeId: url.searchParams.get('mensaje'),
      });
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});
