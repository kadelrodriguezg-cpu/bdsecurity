/**
 * traducirError: los mensajes de negocio explícitos de nuestras RPC (RAISE
 * EXCEPTION con texto propio en español) deben llegar al usuario tal cual;
 * los mensajes crudos generados por Postgres siguen filtrándose (pueden
 * exponer nombres de tablas/columnas o, en el DETAIL, valores de linaje).
 */
import { describe, expect, it, vi } from 'vitest';
import { ErrorApi, traducirError } from './client';
const diagnosticos = vi.hoisted(() => ({ capturar: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@sentry/react', () => ({ captureException: diagnosticos.capturar }));

describe('metadatos seguros de errores API', () => {
  it.each([
    ['P0002', 'no_encontrado'], ['42501', 'sin_permiso'], ['28000', 'sin_sesion'],
    ['PGRST301', 'sin_sesion'], ['23514', 'desconocido'],
  ])('conserva la categoría de %s aunque traduzca el mensaje', (code, tipo) => {
    const error = traducirError({ code, message: 'permission denied for table plantas' });
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ code, tipo });
  });
  it('reconoce fallas de transporte sin exponer el mensaje crudo en logs', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = traducirError({ code: '', message: 'TypeError: Failed to fetch; linaje-secreto' });
    expect(error).toMatchObject({ tipo: 'red' });
    expect(error.message).not.toContain('linaje-secreto');
    expect(JSON.stringify(log.mock.calls)).not.toContain('linaje-secreto');
    expect(JSON.stringify(diagnosticos.capturar.mock.calls)).not.toContain('linaje-secreto');
    log.mockRestore();
  });
  it('no propaga códigos o nombres de constraint arbitrarios a diagnósticos', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = traducirError({ code: 'linaje secreto', message: 'private-data' });
    expect(error.message).not.toContain('linaje secreto');
    traducirError({ code: '23514', message: 'violates check constraint "private-data"' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-data');
    expect(JSON.stringify(diagnosticos.capturar.mock.calls)).not.toContain('private-data');
    log.mockRestore();
  });
  it('un HTTP 503 sin código queda recuperable y no se confunde con ausencia o permiso', () => {
    const respuesta = { code: '', message: 'Service Unavailable: datos privados', status: 503 };
    expect(traducirError(respuesta)).toMatchObject({ tipo: 'desconocido', code: undefined });
    expect(traducirError(respuesta).message).not.toContain('datos privados');
  });
});

describe('traducirError — mensajes de negocio de RPC', () => {
  it('deja pasar el mensaje de destino inactivo del traslado (Sprint 5)', () => {
    const error = { code: '23514', message: 'Este predio está inactivo, elige otro destino' };
    expect(traducirError(error).message).toBe('Este predio está inactivo, elige otro destino');
  });

  it('deja pasar mensajes de permiso con explicación propia', () => {
    const error = { code: '42501', message: 'Solo un admin puede congelar un ranking' };
    expect(traducirError(error).message).toBe('Solo un admin puede congelar un ranking');
  });

  it('deja pasar "no encontrado" con contexto propio', () => {
    const error = { code: 'P0002', message: 'Snapshot no encontrado' };
    expect(traducirError(error).message).toBe('Snapshot no encontrado');
  });

  it('sigue filtrando el mensaje crudo de un CHECK de Postgres', () => {
    const error = {
      code: '23514',
      message: 'new row for relation "evaluaciones" violates check constraint "evaluaciones_brix_tecnico_check"',
    };
    expect(traducirError(error).message).toBe('Brix debe ser un valor numérico no negativo.');
  });

  it('sigue filtrando el "permission denied" crudo de un grant', () => {
    const error = { code: '42501', message: 'permission denied for table plantas' };
    expect(traducirError(error).message).not.toContain('plantas');
    expect(traducirError(error).message).toContain('No tienes permiso');
  });

  it('sigue filtrando violaciones crudas de FK aunque el código esté en la lista de negocio', () => {
    const error = {
      code: '23503',
      message: 'insert or update on table "x" violates foreign key constraint "x_fkey"',
    };
    expect(traducirError(error).message).not.toContain('x_fkey');
  });

  it('sigue filtrando el duplicate key crudo (23505 no está en la lista de negocio)', () => {
    const error = { code: '23505', message: 'duplicate key value violates unique constraint "plantas_codigo_sistema_key"' };
    expect(traducirError(error).message).not.toContain('plantas_codigo_sistema_key');
  });

  it('A1-030: un conflicto de número de fruto tiene mensaje propio sin divulgar el error crudo', () => {
    const error = { code: '23505', message: 'duplicate key value violates unique constraint "cosecha_fruto_planta_id_numero_fruto_key"; LINAJE-SENSIBLE' };
    expect(traducirError(error).message).toBe('Otro registro de fruto ocupó ese número. Recarga los frutos e intenta de nuevo.');
    expect(traducirError(error).message).not.toContain('LINAJE-SENSIBLE');
  });

  it.each([
    ['evecl_ficha_fecha_chk', 'La fecha de evaluación no puede ser futura.'],
    ['evecl_ficha_rep_chk', 'La repetición debe estar entre 1 y 20.'],
    ['evecl_respuesta_valor_chk', 'El valor numérico debe ser mayor o igual a cero.'],
    ['evecl_respuesta_algo_chk', 'La respuesta debe incluir al menos un dato.'],
    ['evecl_ensayo_lat_chk', 'La latitud debe estar entre -90 y 90.'],
    ['evecl_ensayo_lon_chk', 'La longitud debe estar entre -180 y 180.'],
    ['evaluaciones_rend_kg_tecnico_check', 'El rendimiento por planta debe ser un valor numérico no negativo.'],
    ['evaluaciones_rend_tha_tecnico_check', 'El rendimiento por hectárea debe ser un valor numérico no negativo.'],
    ['evaluaciones_distribucion_flores_frutos_check', 'La distribución de flores y frutos debe ser uno de los 3 niveles.'],
    ['scoring_version_umbrales_delta_check', 'Los umbrales de delta deben estar entre 0 y 1 y en orden creciente.'],
  ])('traduce el CHECK %s sin exponer el mensaje crudo', (constraint, mensaje) => {
    const error = { code: '23514', message: `new row violates check constraint "${constraint}"` };
    expect(traducirError(error).message).toBe(mensaje);
  });
});
