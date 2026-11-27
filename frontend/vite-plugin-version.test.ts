import { describe, expect, it } from 'vitest';
import { calcularIdVersion, contenidoVersionJson, pluginVersion } from './vite-plugin-version';

const SHA = '14380a1f5c2d9e8b7a6f5e4d3c2b1a0987654321';
const sinGit = () => { throw new Error('no es un repositorio git'); };

describe('calcularIdVersion', () => {
  it('prefiere el SHA de Vercel y lo acorta a 8 caracteres', () => {
    expect(calcularIdVersion({ env: { VERCEL_GIT_COMMIT_SHA: SHA }, leerGit: sinGit })).toBe('14380a1f');
  });

  it('sin Vercel usa el SHA de git local', () => {
    expect(calcularIdVersion({ env: {}, leerGit: () => SHA + '\n' })).toBe('14380a1f');
  });

  it('sin git usa la marca de tiempo del build', () => {
    const id = calcularIdVersion({ env: {}, leerGit: sinGit, ahora: () => new Date('2026-10-25T12:00:00Z') });
    expect(id).toMatch(/^t[0-9a-z]+$/);
    const otro = calcularIdVersion({ env: {}, leerGit: sinGit, ahora: () => new Date('2026-10-25T12:00:01Z') });
    expect(otro).not.toBe(id);
  });

  it('ignora un SHA con formato inválido', () => {
    expect(calcularIdVersion({ env: { VERCEL_GIT_COMMIT_SHA: 'no-es-un-sha' }, leerGit: () => 'tampoco', ahora: () => new Date(0) })).toBe('t0');
  });
});

describe('version.json', () => {
  it('lleva el id y la fecha de construcción', () => {
    const contenido = JSON.parse(contenidoVersionJson('14380a1f', new Date('2026-10-25T12:00:00Z')));
    expect(contenido).toEqual({ id: '14380a1f', construidoEn: '2026-10-25T12:00:00.000Z' });
  });
});

describe('pluginVersion', () => {
  it('inyecta __BUILD_ID__ y emite version.json con el MISMO id', () => {
    const plugin = pluginVersion({ env: { VERCEL_GIT_COMMIT_SHA: SHA }, leerGit: sinGit, ahora: () => new Date('2026-10-25T12:00:00Z') });
    const config = (plugin.config as () => { define: Record<string, string> })();
    expect(config.define.__BUILD_ID__).toBe('"14380a1f"');

    const emitidos: { fileName: string; source: string }[] = [];
    (plugin.generateBundle as unknown as (this: { emitFile: (a: { fileName: string; source: string }) => void }) => void)
      .call({ emitFile: (archivo) => emitidos.push(archivo) });
    expect(emitidos).toHaveLength(1);
    expect(emitidos[0].fileName).toBe('version.json');
    expect(JSON.parse(emitidos[0].source).id).toBe(JSON.parse(config.define.__BUILD_ID__));
  });
});
