/**
 * Auditoría integral, Corrida 1, grupo G1 — flujo C09 (abrir la ficha): el
 * mensaje que ve el usuario cuando obtener_planta lo frena por frecuencia.
 * Cada `it.fails` demuestra un hallazgo abierto (ID A1-G1-NN).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('@/types/chat', () => ({}));

import { tipoErrorApi, traducirError } from './client';

const RATE_LIMIT = { code: '58503', message: 'Rate limit excedido: máximo 20 lecturas por minuto por usuario' };

describe('traducirError ante el límite de frecuencia (58503)', () => {
  // A1-G1-18: 58503 no está entre los códigos con mensaje de negocio, así que
  // el texto de la RPC se descarta y el usuario ve «código 58503», sin saber
  // que debe esperar un minuto.
  it.fails('explica que hay que esperar, en vez del mensaje genérico con el código (A1-G1-18)', () => {
    const error = traducirError(RATE_LIMIT);
    expect(error.message).toMatch(/espera|minuto|demasiad/i);
    expect(error.message).not.toMatch(/58503/);
  });

  // A1-G1-18: la pantalla de la ficha decide su mensaje por tipoErrorApi; el
  // límite cae en «desconocido» («Hubo un problema al cargar la ficha») y el
  // botón «Reintentar» vuelve a fallar hasta que pasa el minuto.
  it.fails('se distingue del resto de los errores desconocidos para que la ficha pueda avisar (A1-G1-18)', () => {
    expect(tipoErrorApi(traducirError(RATE_LIMIT))).not.toBe('desconocido');
  });
});
