/** Conserva rutas de la app sin permitir redirecciones externas ni bucles de login. */
export function destinoInterno(valor: unknown, respaldo = '/'): string {
  if (typeof valor !== 'string' || !valor.startsWith('/') || valor.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(valor)) return respaldo;
  try {
    const url = new URL(valor, 'https://destino.local');
    if (url.origin !== 'https://destino.local') return respaldo;
    let pathname = url.pathname;
    // También rechazamos rutas codificadas que escondan barras, controles o /login.
    for (let intento = 0; intento < 3; intento++) {
      const decodificado = decodeURIComponent(pathname);
      if (decodificado === pathname) break;
      pathname = decodificado;
    }
    if (pathname.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(pathname) || /^\/login(?:\/|$)/i.test(pathname)) return respaldo;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return respaldo;
  }
}

export function destinoLogin(destino: string): string {
  return `/login?${new URLSearchParams({ next: destinoInterno(destino) }).toString()}`;
}
