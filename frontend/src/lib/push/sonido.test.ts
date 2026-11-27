import { afterEach, describe, expect, it, vi } from 'vitest';
import { debeSonar, guardarSonidoActivado, sonidoActivado, tocarTonoMencion } from './sonido';
import { notificacionSiempreVisible } from './reglaNotificacion';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const EDGE = `${CHROME} Edg/141.0`;
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; rv:144.0) Gecko/20100101 Firefox/144.0';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('sonido de mención dentro de la app', () => {
  it('suena solo con la página a la vista', () => {
    const base = { activado: true, pushActivo: false, userAgent: CHROME };
    expect(debeSonar({ ...base, visible: true })).toBe(true);
    expect(debeSonar({ ...base, visible: false })).toBe(false);
  });

  it('respeta el interruptor «Sonido en la app»', () => {
    expect(debeSonar({ visible: true, activado: false, pushActivo: false, userAgent: CHROME })).toBe(false);
  });

  it('en Safari con push activo no suena: ya avisa la notificación del sistema', () => {
    expect(debeSonar({ visible: true, activado: true, pushActivo: true, userAgent: SAFARI_IOS })).toBe(false);
    expect(debeSonar({ visible: true, activado: true, pushActivo: false, userAgent: SAFARI_IOS })).toBe(true);
    for (const ua of [CHROME, EDGE, FIREFOX, ANDROID]) {
      expect(debeSonar({ visible: true, activado: true, pushActivo: true, userAgent: ua }), ua).toBe(true);
    }
  });

  it('la regla de «mostrar siempre» coincide con la del service worker', () => {
    expect(notificacionSiempreVisible(SAFARI_IOS)).toBe(true);
    expect(notificacionSiempreVisible('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe(true);
    for (const ua of [CHROME, EDGE, FIREFOX, ANDROID]) expect(notificacionSiempreVisible(ua), ua).toBe(false);
  });

  it('la preferencia está activada por defecto, se guarda y sobrevive a un localStorage que falla', () => {
    expect(sonidoActivado()).toBe(true);
    guardarSonidoActivado(false);
    expect(sonidoActivado()).toBe(false);
    guardarSonidoActivado(true);
    expect(sonidoActivado()).toBe(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    expect(() => guardarSonidoActivado(false)).not.toThrow();
    expect(sonidoActivado()).toBe(true);
  });

  it('sin interacción previa (audio no habilitado) no intenta sonar', () => {
    expect(tocarTonoMencion('directa')).toBe(false);
  });
});
