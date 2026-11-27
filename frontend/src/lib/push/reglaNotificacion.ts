/**
 * Misma regla que public/sw-push.js: Safari (macOS e iOS) muestra siempre la
 * notificación del sistema, porque revoca la suscripción si un push no la
 * muestra. En Chrome, Edge y Firefox el service worker la omite cuando la app
 * está a la vista, y entonces avisa el sonido de la app.
 */
export function notificacionSiempreVisible(userAgent: string): boolean {
  return /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|Android/.test(userAgent);
}

export function esIOS(userAgent: string, plataforma = '', puntosTactiles = 0): boolean {
  // iPadOS se presenta como Mac; se distingue por la pantalla táctil.
  return /iPad|iPhone|iPod/.test(userAgent) || (plataforma === 'MacIntel' && puntosTactiles > 1);
}
