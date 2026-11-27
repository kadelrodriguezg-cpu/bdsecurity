/** U-01: los borradores son por usuario y otra persona en el mismo equipo nunca los ve ni los carga. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBorradorLocal } from './useBorradorLocal';
import { borrarBorradoresDe, contarBorradoresDe, leerSesionExpirada, marcarSesionExpirada, olvidarSesionExpirada, prefijoBorradoresDe } from './borradoresSesion';

const INICIAL = { brix: '' };

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('borradores por usuario en un mismo equipo', () => {
  it('un borrador de A solo se restaura para A; B entra y ve el formulario vacío', () => {
    localStorage.setItem(prefijoBorradoresDe('usuario-a') + 'evaluacion:r1', JSON.stringify({ valor: { brix: '12' }, guardadoEn: 1 }));

    const deA = renderHook(() => useBorradorLocal('borrador:evaluacion:r1', INICIAL, { usuarioId: 'usuario-a' }));
    expect(deA.result.current.valor).toEqual({ brix: '12' });
    expect(deA.result.current.recuperadoEn).toBe(1);

    const deB = renderHook(() => useBorradorLocal('borrador:evaluacion:r1', INICIAL, { usuarioId: 'usuario-b' }));
    expect(deB.result.current.valor).toEqual(INICIAL);
    expect(deB.result.current.recuperadoEn).toBeNull();
  });

  it('sin usuario (sesión caída) el formulario no lee ni escribe borradores', () => {
    localStorage.setItem(prefijoBorradoresDe('usuario-a') + 'evaluacion:r1', JSON.stringify({ valor: { brix: '12' }, guardadoEn: 1 }));
    const sinSesion = renderHook(() => useBorradorLocal('borrador:evaluacion:r1', INICIAL, { usuarioId: null }));
    expect(sinSesion.result.current.valor).toEqual(INICIAL);
    expect(sinSesion.result.current.persistenciaHabilitada).toBe(false);
  });

  it('cuenta solo los borradores del usuario y borrarBorradoresDe no toca los de otra persona', () => {
    localStorage.setItem(prefijoBorradoresDe('usuario-a') + 'evaluacion:r1', '{}');
    localStorage.setItem(prefijoBorradoresDe('usuario-a') + 'cosecha:p1', '{}');
    localStorage.setItem(prefijoBorradoresDe('usuario-b') + 'evaluacion:r1', '{}');
    localStorage.setItem('borrador:legado', '{}');
    expect(contarBorradoresDe('usuario-a')).toBe(2);
    expect(contarBorradoresDe('usuario-b')).toBe(1);

    borrarBorradoresDe('usuario-a');

    expect(contarBorradoresDe('usuario-a')).toBe(0);
    expect(contarBorradoresDe('usuario-b')).toBe(1);
    expect(localStorage.getItem('borrador:legado')).toBeNull();
  });

  it('un id con «:» no confunde el prefijo de otra persona', () => {
    localStorage.setItem(prefijoBorradoresDe('a:b') + 'x', '{}');
    expect(contarBorradoresDe('a')).toBe(0);
    expect(contarBorradoresDe('a:b')).toBe(1);
  });

  it('el aviso de sesión expirada se guarda, se lee y se olvida', () => {
    expect(leerSesionExpirada()).toBeNull();
    marcarSesionExpirada('usuario-a');
    expect(leerSesionExpirada()).toEqual({ usuarioId: 'usuario-a' });
    olvidarSesionExpirada();
    expect(leerSesionExpirada()).toBeNull();
  });
});
