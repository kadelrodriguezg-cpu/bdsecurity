import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Regla = { source: string; headers: { key: string; value: string }[] };

describe('frontend/vercel.json', () => {
  const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as { headers: Regla[] };

  it('/version.json nunca se guarda en caché (la app lo consulta para saber si hay versión nueva)', () => {
    const regla = config.headers.find((r) => r.source === '/version.json');
    expect(regla).toBeDefined();
    const cache = regla!.headers.find((h) => h.key.toLowerCase() === 'cache-control');
    expect(cache).toBeDefined();
    expect(cache!.value).toContain('no-store');
  });
});
