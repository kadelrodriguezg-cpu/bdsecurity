import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buscarIdPorCodigoSistema: vi.fn(),
  resolverIndividuo: vi.fn(),
  resolverIndividuoPorCodigo: vi.fn(),
}));
vi.mock('@/api/plantas', () => ({ buscarIdPorCodigoSistema: mocks.buscarIdPorCodigoSistema }));
vi.mock('@/api/individuos', () => ({ resolverIndividuo: mocks.resolverIndividuo, resolverIndividuoPorCodigo: mocks.resolverIndividuoPorCodigo }));

import { lecturaDeTexto, resolverLectura } from './busquedaCodigo';

beforeEach(() => { vi.clearAllMocks(); });

describe('búsqueda por código: una sola lógica para el encabezado y la página del escáner (N13)', () => {
  it('lo escrito a mano: «-P<n>» al final es un individuo; lo demás, un cruce', () => {
    expect(lecturaDeTexto('02-502-P1')).toEqual({ tipo: 'codigo_individuo', valor: '02-502-P1' });
    expect(lecturaDeTexto('02-502-p12')).toEqual({ tipo: 'codigo_individuo', valor: '02-502-p12' });
    expect(lecturaDeTexto(' 02-502 ')).toEqual({ tipo: 'codigo_sistema', valor: '02-502' });
  });

  it('QR de un cruce (uuid): va directo a su ficha, sin consultar', async () => {
    expect(await resolverLectura({ tipo: 'id', valor: 'c1' })).toEqual({ ruta: '/planta/c1' });
    expect(mocks.buscarIdPorCodigoSistema).not.toHaveBeenCalled();
  });

  it('código de cruce (o QR viejo de Notion): se busca el id', async () => {
    mocks.buscarIdPorCodigoSistema.mockResolvedValue('c2');
    expect(await resolverLectura({ tipo: 'codigo_sistema', valor: '02-502' })).toEqual({ ruta: '/planta/c2' });
  });

  it('QR y código de individuo: la ficha del cruce posicionada en el individuo', async () => {
    mocks.resolverIndividuo.mockResolvedValue({ id: 'i1', planta_id: 'c3' });
    mocks.resolverIndividuoPorCodigo.mockResolvedValue({ id: 'i2', planta_id: 'c4' });
    expect(await resolverLectura({ tipo: 'individuo', valor: 'i1' })).toEqual({ ruta: '/planta/c3?individuo=i1' });
    expect(await resolverLectura({ tipo: 'codigo_individuo', valor: '02-502-P1' })).toEqual({ ruta: '/planta/c4?individuo=i2' });
  });

  it('no encontrado y error de red dan mensajes distintos', async () => {
    mocks.buscarIdPorCodigoSistema.mockResolvedValue(null);
    expect(await resolverLectura({ tipo: 'codigo_sistema', valor: '99-999' })).toEqual({ error: expect.stringContaining('No se encontró ningún cruce') });
    mocks.resolverIndividuoPorCodigo.mockResolvedValue(null);
    expect(await resolverLectura({ tipo: 'codigo_individuo', valor: '02-502-P9' })).toEqual({ error: expect.stringContaining('No se encontró ningún individuo') });
    mocks.buscarIdPorCodigoSistema.mockRejectedValue(new Error('red'));
    expect(await resolverLectura({ tipo: 'codigo_sistema', valor: '02-502' })).toEqual({ error: expect.stringContaining('No se pudo buscar') });
  });
});
