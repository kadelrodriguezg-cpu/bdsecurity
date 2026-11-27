import { describe, expect, it } from 'vitest';
import { destinoInterno, destinoLogin } from './destinoInterno';

describe('destino interno', () => {
  it('conserva pathname, búsqueda y ancla a través de una URL de login recargable', () => {
    const ruta = '/planta/123?etapa=siembra&codigo=02-001#historial';
    const login = new URL(destinoLogin(ruta), 'https://app.local');
    expect(destinoInterno(login.searchParams.get('next'))).toBe(ruta);
  });
  it.each([undefined, null, '//externo.cl', 'https://externo.cl', 'javascript:alert(1)', '/\\externo.cl', '/%2fexterno.cl', '/%255cexterno.cl', '/login?next=/plantas', '/LOGIN/', '/%6cogin', '/otra/../login', '/plantas\n', '/%00'])('rechaza %s', (ruta) => {
    expect(destinoInterno(ruta, '/plantas')).toBe('/plantas');
  });
  it('el QR de un individuo abierto sin sesión vuelve a /individuo/<uuid> tras iniciar sesión', () => {
    const ruta = '/individuo/11111111-2222-3333-4444-555555555555';
    const login = destinoLogin(ruta);
    expect(destinoInterno(new URLSearchParams(login.split('?')[1]).get('next'))).toBe(ruta);
  });

  it('admite rutas operativas y conserva filtros de retorno', () => {
    expect(destinoInterno('/plantas?especie=e1&pagina=2#lista')).toBe('/plantas?especie=e1&pagina=2#lista');
  });
});
