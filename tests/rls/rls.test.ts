/**
 * Tests EMPÍRICOS del modelo de seguridad (Fase 0.4).
 *
 * Corren contra la base LOCAL de Supabase (nunca producción: las credenciales
 * salen de `supabase status`, que solo responde si el stack local está arriba).
 *
 * Cada test loguea un usuario real con la anon key (sujeta a RLS) y verifica
 * que las policies, grants de columna, triggers y RPCs hacen lo que dicen.
 */
import { individualizarPlantas, guardarFichaEvecl, iniciarRondaAnual, psqlInterno } from './envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';
import { limpiarPrueba } from './limpieza-pruebas';
import { puntajeEsperado } from './scoring-esperado';

let service: SupabaseClient; // service_role: bypassa RLS, solo para preparar/verificar
let operario: SupabaseClient;
let admin: SupabaseClient;
let anon: SupabaseClient; // sin login
let operarioId: string;
let adminId: string;
let plantaId: string; // la planta 02-001 del seed
let inicioTests: string; // timestamp para filtrar audit_log de esta corrida
// Linaje del seed de 02-001 capturado antes de que ningún test lo mute. El test
// admin de actualizar_linaje escribe valores ficticios ('A x C') sobre esta
// misma fila; sin restaurar, dejaría datos de prueba pisando los del seed.
let linajeOriginal: { cruzamiento: string | null; mama: string | null; papa: string | null; mama_id: string | null; papa_id: string | null };
// Dos variedades de prueba (Bloque 3, Parte 3C: linaje estructurado) creadas
// en la especie real de 02-001, para probar actualizar_linaje con mama_id/
// papa_id. Se borran en afterAll, después de restaurar el linaje de 02-001
// (que las deja de referenciar).
let variedadMamaId: string;
let variedadPapaId: string;
let especieIdDe02001: string;

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  anon = createClient(creds.url, creds.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const op = await crearUsuarioDePrueba(creds, service, {
    email: 'operario@test.local',
    rol: 'operario',
  });
  operario = op.client;
  operarioId = op.userId;

  const ad = await crearUsuarioDePrueba(creds, service, {
    email: 'admin@test.local',
    rol: 'admin',
  });
  admin = ad.client;
  adminId = ad.userId;

  const { data: planta, error } = await service
    .from('plantas')
    .select('id, especie_id')
    .eq('codigo_sistema', '02-001')
    .single();
  if (error || !planta) throw new Error('No está la planta 02-001 del seed. ¿Corriste `npm run db:reset`?');
  plantaId = planta.id;
  especieIdDe02001 = planta.especie_id;

  // Captura el linaje del seed ANTES de que ningún test lo mute, para restaurarlo
  // en afterAll. Así el test destructivo de actualizar_linaje no deja datos
  // ficticios ('A x C') pisando los valores del seed en 02-001.
  const { data: linaje } = await service
    .from('plantas')
    .select('cruzamiento, mama, papa, mama_id, papa_id')
    .eq('id', plantaId)
    .single();
  linajeOriginal = linaje as typeof linajeOriginal;

  // Dos variedades de prueba en la misma especie de 02-001, para el test de
  // actualizar_linaje con mama_id/papa_id (Bloque 3, Parte 3C).
  const sufijo = Date.now();
  const { data: variedadMama } = await service
    .from('variedades')
    .insert({ especie_id: planta.especie_id, nombre: `Variedad A (test ${sufijo})`, created_by: adminId })
    .select('id')
    .single();
  const { data: variedadPapa } = await service
    .from('variedades')
    .insert({ especie_id: planta.especie_id, nombre: `Variedad C (test ${sufijo})`, created_by: adminId })
    .select('id')
    .single();
  variedadMamaId = variedadMama!.id;
  variedadPapaId = variedadPapa!.id;

  // Resetea el estado a 'polinizacion' para que el test de cambio_estado sea
  // idempotente entre corridas sin db:reset. El trigger de auditoría dispara
  // con usuario_id=null (service_role), lo cual es correcto para setup de test.
  // Se hace ANTES de inicioTests para que esa entrada no caiga en la ventana del test.
  await service.from('plantas').update({ estado: 'polinizacion' }).eq('id', plantaId);

  inicioTests = new Date().toISOString();
}, 60_000);

// Restaura el linaje original de 02-001 después de toda la suite. El test admin de
// actualizar_linaje lo sobreescribe con 'A x C' para verificar la RPC; sin esto,
// 02-001 quedaría con datos de prueba en vez de los del seed (sintéticos).
afterAll(async () => {
  if (linajeOriginal) {
    await service.from('plantas').update(linajeOriginal).eq('id', plantaId);
  }
  // Recién después de restaurar el linaje (que deja de referenciarlas):
  // limpia las variedades de prueba, no dejarlas acumulando entre corridas.
  await service.from('variedades').delete().in('id', [variedadMamaId, variedadPapaId].filter(Boolean));

  // Cruces de prueba que crean los describe de este archivo (todos con es_prueba = true). Se identifican por el
  // prefijo del código y por haberse creado después de `inicioTests`. Los que tienen emplazamientos (TERR, PROC,
  // MAPA, MAPAFALLBACK) no se pueden borrar por diseño (el historial territorial es append-only): quedan archivados
  // o con su individuo, pero ya marcados como prueba. Los usuarios de este archivo son fijos y no se borran.
  const prefijos = ['IND-', 'V4-', 'SPRINT1-', 'RANK-A-', 'RANK-B-', 'TERR-', 'PROC-', 'SIEMBRA-', 'RESTORE-', 'OBTPLANTA-', 'DESCARTAR-', 'MAPA-', 'MAPAFALLBACK-', 'REINICIO-'];
  const { data: cruces } = await service.from('plantas').select('id')
    .or(prefijos.map((p) => `codigo_sistema.like.${p}*`).join(','))
    .eq('es_prueba', true)
    .gte('created_at', inicioTests)
    .limit(1000);
  await limpiarPrueba(service, { plantaIds: (cruces ?? []).map((c) => c.id) }, 'rls');
}, 120_000);

/** Última fila del audit_log de esta corrida para una acción dada. */
/** S2-1: la ronda N+1 exige la N cerrada; se cierra con una evaluación completa creada con service_role. */
async function cerrarRonda(rondaId: string) {
  const { error } = await service.from('evaluaciones').insert({ ronda_id: rondaId, anio: 2026, fecha: '2026-07-19', estado: 'completa', created_by: operarioId, cantidad_frutos: 5, peso_total_g: 50 });
  if (error) throw new Error(`cerrarRonda: ${error.message}`);
}

async function ultimaAuditoria(accion: string) {
  const { data, error } = await service
    .from('audit_log')
    .select('*')
    .eq('accion', accion)
    .gte('ocurrido_en', inicioTests)
    .order('ocurrido_en', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0];
}

describe('usuario NO autenticado', () => {
  it('no puede leer plantas (ni filas ni columnas)', async () => {
    const { data, error } = await anon.from('plantas').select('id');
    // Según la vía que lo bloquee (RLS o grant) puede venir error o lista vacía;
    // lo que NO puede pasar es que devuelva filas.
    if (error) expect(error).toBeTruthy();
    else expect(data).toHaveLength(0);
  });
});

describe('operario', () => {
  it('NO puede leer cruzamiento/mama/papa con SELECT directo a plantas', async () => {
    const { error } = await operario.from('plantas').select('cruzamiento, mama, papa');
    expect(error).toBeTruthy(); // denegado por grant de columna (42501)
  });

  it('NO puede leer mama_id/papa_id (linaje estructurado) con SELECT directo a plantas', async () => {
    const { error } = await operario.from('plantas').select('mama_id, papa_id');
    expect(error).toBeTruthy(); // mismo allowlist de columnas que cruzamiento/mama/papa
  });

  it('SÍ puede leer la vista plantas_operativas, y no trae linaje', async () => {
    const { data, error } = await operario.from('plantas_operativas').select('*');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    const fila = data![0] as Record<string, unknown>;
    expect(fila).not.toHaveProperty('cruzamiento');
    expect(fila).not.toHaveProperty('mama');
    expect(fila).not.toHaveProperty('papa');
    expect(fila).toHaveProperty('codigo_sistema');
  });

  it('NO puede leer perfiles ajenos (solo el propio)', async () => {
    const { data, error } = await operario.from('perfiles').select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(operarioId);
  });

  it('SÍ puede insertar en registros_evento (a su propio nombre)', async () => {
    const { data, error } = await operario
      .from('registros_evento')
      .insert({
        planta_id: plantaId,
        tipo_evento: 'polinizacion',
        datos: { numero_polinizaciones: 3 },
        notas: 'test RLS',
        created_by: operarioId,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data!.id).toBeTruthy();
  });

  it('NO puede insertar eventos a nombre de otro usuario', async () => {
    const { error } = await operario.from('registros_evento').insert({
      planta_id: plantaId,
      tipo_evento: 'polinizacion',
      created_by: adminId, // suplantación → la policy lo rechaza
    });
    expect(error).toBeTruthy();
  });

  it('obtener_planta() le devuelve la ficha SIN linaje y queda auditado', async () => {
    const { data, error } = await operario.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(error).toBeNull();
    expect(data).toHaveProperty('codigo_sistema', '02-001');
    expect(data).not.toHaveProperty('cruzamiento');

    const audit = await ultimaAuditoria('lectura_ficha');
    expect(audit).toBeTruthy();
    expect(audit.usuario_id).toBe(operarioId);
    expect(audit.planta_id).toBe(plantaId);
    expect(audit.campos_expuestos).not.toContain('cruzamiento');
  });

  it('NO puede auto-ascenderse a admin (trigger 006)', async () => {
    const { error } = await operario
      .from('perfiles')
      .update({ rol: 'admin' })
      .eq('id', operarioId);
    expect(error?.code).toBe('42501');
    expect(error?.message).toBe('Solo un admin puede cambiar el rol de un perfil');

    // Verificación independiente: el rol NO cambió en la base.
    const { data } = await service.from('perfiles').select('rol').eq('id', operarioId).single();
    expect(data!.rol).toBe('operario');
  });

  it('NO puede auto-concederse puede_ver_linaje (trigger 006, alcance ampliado)', async () => {
    const { error } = await operario
      .from('perfiles')
      .update({ puede_ver_linaje: true })
      .eq('id', operarioId);
    expect(error?.code).toBe('42501');
    expect(error?.message).toBe('Solo un admin puede cambiar el permiso de linaje');

    const { data } = await service
      .from('perfiles')
      .select('puede_ver_linaje')
      .eq('id', operarioId)
      .single();
    expect(data!.puede_ver_linaje).toBe(false);
  });

  it('NO puede borrar su propio perfil', async () => {
    const { data, error } = await operario
      .from('perfiles')
      .delete()
      .eq('id', operarioId)
      .select('id');

    // RLS puede denegar con error o filtrar la fila y responder vacío.
    if (error) expect(error).toBeTruthy();
    else expect(data).toHaveLength(0);

    // Confirma que el perfil sigue presente aunque PostgREST responda sin filas.
    const { data: perfil, error: perfilError } = await service
      .from('perfiles')
      .select('id')
      .eq('id', operarioId)
      .single();
    expect(perfilError).toBeNull();
    expect(perfil!.id).toBe(operarioId);
  });

  it('crea el perfil operario al dar de alta un usuario Auth nuevo (handle_new_user)', async () => {
    let usuarioId: string | undefined;
    const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      // El registro público está cerrado (config.toml enable_signup = false, igual
      // que producción): las cuentas las crea un admin, acá con la API admin.
      const { data, error } = await service.auth.admin.createUser({
        email: `handle-new-user-${sufijo}@test.local`,
        password: `LocalTest-${sufijo}-Aa1!`,
        email_confirm: true,
        user_metadata: { nombre: 'Prueba handle_new_user' },
      });
      usuarioId = data.user?.id;
      expect(error).toBeNull();
      expect(usuarioId).toBeTruthy();

      const { data: perfil, error: perfilError } = await service
        .from('perfiles')
        .select('id, nombre, rol, puede_ver_linaje')
        .eq('id', usuarioId!)
        .single();
      expect(perfilError).toBeNull();
      expect(perfil).toMatchObject({
        id: usuarioId,
        nombre: 'Prueba handle_new_user',
        rol: 'operario',
        puede_ver_linaje: false,
      });
    } finally {
      if (usuarioId) {
        const { error: cleanupError } = await service.auth.admin.deleteUser(usuarioId);
        expect(cleanupError).toBeNull();
      }
    }
  });

  it('NO puede cambiar el estado de una planta (U-03); el admin sí, y el cambio queda auditado (trigger 007)', async () => {
    const rechazo = await operario.from('plantas').update({ estado: 'cosecha' }).eq('id', plantaId).select('id, estado');
    expect(rechazo.error?.code).toBe('42501');
    expect(rechazo.error?.message).toBe('Solo un admin puede cambiar la fase de un cruce.');

    const { data, error } = await admin
      .from('plantas')
      .update({ estado: 'cosecha' })
      .eq('id', plantaId)
      .select('id, estado'); // select explícito: pedir '*' fallaría por las columnas de linaje
    expect(error).toBeNull();
    expect(data![0].estado).toBe('cosecha');

    const audit = await ultimaAuditoria('cambio_estado');
    expect(audit).toBeTruthy();
    expect(audit.usuario_id).toBe(adminId);
    expect(audit.detalle.estado_nuevo).toBe('cosecha');
    expect(audit.detalle.estado_anterior).toBe('polinizacion');
  });

  it('NO puede escribir linaje vía actualizar_linaje (RPC 008)', async () => {
    const { error } = await operario.rpc('actualizar_linaje', {
      p_planta_id: plantaId,
      p_cruzamiento: 'HACKEADO',
      p_mama_id: variedadMamaId,
      p_papa_id: variedadPapaId,
    });
    expect(error).toBeTruthy();

    const { data } = await service.from('plantas').select('cruzamiento').eq('id', plantaId).single();
    expect(data!.cruzamiento).not.toBe('HACKEADO');
  });

  it('SÍ puede crear una variedad nueva en el catálogo (alta inline, Bloque 3 Parte 3C)', async () => {
    const nombre = `Variedad operario ${Date.now()}`;
    const { data, error } = await operario
      .from('variedades')
      .insert({ especie_id: especieIdDe02001, nombre, created_by: operarioId })
      .select('id, nombre, activo')
      .single();
    expect(error).toBeNull();
    expect(data!.nombre).toBe(nombre);
    expect(data!.activo).toBe(true);

    // Cualquier autenticado también puede LEER el catálogo (lo necesita el combobox).
    const { data: leido, error: errorLectura } = await operario.from('variedades').select('id').eq('id', data!.id).single();
    expect(errorLectura).toBeNull();
    expect(leido!.id).toBe(data!.id);

    await service.from('variedades').delete().eq('id', data!.id);
  });

  it('NO puede crear una variedad a nombre de otro usuario (created_by forzado a sí mismo)', async () => {
    const { error } = await operario
      .from('variedades')
      .insert({ especie_id: especieIdDe02001, nombre: `Variedad ajena ${Date.now()}`, created_by: adminId });
    expect(error).toBeTruthy();
  });

  it('NO puede editar ni desactivar una variedad existente (admin-only, mismo criterio que contenedor/insumo/predio)', async () => {
    // Mismo patrón que el test de audit_log más abajo: sin permiso, RLS
    // puede negarlo con error O dejar la fila fuera de USING (0 filas
    // afectadas, sin error) — .select() fuerza a PostgREST a devolver las
    // filas realmente tocadas para poder distinguir ambos casos.
    const { data: filasTocadas, error } = await operario
      .from('variedades')
      .update({ activo: false })
      .eq('id', variedadMamaId)
      .select('id');
    if (error) expect(error).toBeTruthy();
    else expect(filasTocadas).toHaveLength(0);

    const { data } = await service.from('variedades').select('activo').eq('id', variedadMamaId).single();
    expect(data!.activo).toBe(true);
  });
});

describe('admin', () => {
  it('obtener_planta() le devuelve el linaje completo y queda auditado como lectura_linaje', async () => {
    const { data, error } = await admin.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(error).toBeNull();
    expect(data).toHaveProperty('cruzamiento');
    expect(data).toHaveProperty('mama');
    expect(data).toHaveProperty('papa');
    expect(data).toHaveProperty('mama_id');
    expect(data).toHaveProperty('papa_id');
    expect(data).toHaveProperty('mama_nombre');
    expect(data).toHaveProperty('papa_nombre');

    const audit = await ultimaAuditoria('lectura_linaje');
    expect(audit).toBeTruthy();
    expect(audit.usuario_id).toBe(adminId);
    expect(audit.campos_expuestos).toContain('cruzamiento');
  });

  it('SÍ puede leer todos los perfiles', async () => {
    const { data, error } = await admin.from('perfiles').select('id');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });

  it('SÍ puede escribir linaje vía actualizar_linaje (mama_id/papa_id), y queda auditado con valores anterior/nuevo', async () => {
    const { error } = await admin.rpc('actualizar_linaje', {
      p_planta_id: plantaId,
      p_cruzamiento: 'A x C',
      p_mama_id: variedadMamaId,
      p_papa_id: variedadPapaId,
    });
    expect(error).toBeNull();

    const { data } = await service.from('plantas').select('cruzamiento, papa, mama_id, papa_id').eq('id', plantaId).single();
    expect(data!.cruzamiento).toBe('A x C');
    expect(data!.mama_id).toBe(variedadMamaId);
    expect(data!.papa_id).toBe(variedadPapaId);
    // La RPC ya no toca las columnas de texto (congeladas desde la
    // migración a variedades): el valor previo de `papa` (texto) sigue
    // intacto pese a que mama_id/papa_id sí cambiaron.
    expect(data!.papa).toBe(linajeOriginal.papa);

    const audit = await ultimaAuditoria('escritura_linaje');
    expect(audit).toBeTruthy();
    expect(audit.usuario_id).toBe(adminId);
    expect(audit.detalle.nuevo).not.toHaveProperty('cruzamiento');
    expect(audit.detalle.nuevo.mama_id).toBe(variedadMamaId);
    expect(audit.detalle.anterior).toBeTruthy();

    // obtener_planta resuelve el nombre real de la variedad, no solo el id.
    const { data: ficha } = await admin.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(ficha.mama_id).toBe(variedadMamaId);
    expect(ficha.papa_nombre).toContain('Variedad C');
  });

  it('SÍ puede editar/desactivar una variedad existente (Bloque 3 Parte 3C)', async () => {
    const { error } = await admin.from('variedades').update({ activo: false }).eq('id', variedadPapaId);
    expect(error).toBeNull();

    const { data } = await service.from('variedades').select('activo').eq('id', variedadPapaId).single();
    expect(data!.activo).toBe(false);

    // La deja como estaba para no afectar el resto de la suite ni el cleanup de afterAll.
    await service.from('variedades').update({ activo: true }).eq('id', variedadPapaId);
  });

  it('NADIE puede modificar el audit_log, ni siquiera un admin (append-only)', async () => {
    const { data, error } = await admin
      .from('audit_log')
      .update({ accion: 'adulterado' })
      .eq('accion', 'lectura_linaje')
      .select('id');
    // Sin policy de UPDATE, RLS lo niega: o da error o afecta 0 filas.
    if (error) expect(error).toBeTruthy();
    else expect(data).toHaveLength(0);
  });
});

describe('sentinel fecha_placeholder', () => {
  let placeholderEventId: string;

  beforeAll(async () => {
    // Limpia sentinels de corridas anteriores para que no acumulen entre runs.
    await service
      .from('registros_evento')
      .delete()
      .eq('planta_id', plantaId)
      .filter('datos->>migration_source', 'eq', 'test_placeholder');

    // Inserta un evento sentinel con fecha 1900-01-01 para validar el ordenamiento.
    const { data, error } = await service
      .from('registros_evento')
      .insert({
        planta_id: plantaId,
        tipo_evento: 'traslado',
        fecha: '1900-01-01',
        datos: { migration_source: 'test_placeholder', fecha_placeholder: true, destino: 'Test' },
        notas: 'evento sentinel para test de ordenamiento',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`No se pudo insertar el evento sentinel: ${error?.message}`);
    placeholderEventId = data.id;
  }, 10_000);

  it('el evento con fecha_placeholder no aparece primero al ordenar por fecha DESC (más reciente primero)', async () => {
    const { data, error } = await operario
      .from('registros_evento')
      .select('id, fecha, datos')
      .eq('planta_id', plantaId)
      .order('fecha', { ascending: false });

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);

    // Garantía clave: el primer resultado (más reciente) nunca es una fecha placeholder.
    expect(data![0].fecha).not.toBe('1900-01-01');

    // El sentinel de esta corrida existe en la lista.
    const sentinelIdx = data!.findIndex((e) => e.id === placeholderEventId);
    expect(sentinelIdx).toBeGreaterThan(-1); // existe

    // El sentinel no está primero — cualquier posición > 0 es correcta.
    // (No se verifica que sea el último: puede haber otros eventos con la misma
    // fecha sentinel, como el traslado real de Notion cuya fecha era ilegible.)
    expect(sentinelIdx).toBeGreaterThan(0);
  });
});

// ===========================================================================
// INDIVIDUOS, EVALUACIÓN, PCR, BAJA (Prompt 2 — North Star v3, secciones 2.2/5)
//
// `individuos` cuelga de `plantas` (FK planta_id), nace vía la RPC
// individualizar_plantas cuando la planta está en 'trasplante'. evaluaciones/
// pcr_analisis/baja_motivo cuelgan de `individuos`, no de `plantas`.
//
// Regla de negocio: cualquier autenticado individualiza/evalúa/marca PCR/marca
// baja; el UPDATE de una evaluación/PCR/baja YA CARGADA es admin-only; NADIE
// hace hard-DELETE de nada de esto (policy `using (false)` + sin GRANT DELETE).
// individuos sí permite UPDATE al autor o admin (para poder marcar la baja de
// estado_vital/fecha_baja directamente sobre la fila).
// ===========================================================================
describe('individuos, evaluación, PCR y baja (Prompt 2)', () => {
  const R = Date.now();

  let plantaTrasplanteId: string;
  let individuoId: string;
  let evaluacionAdminId: string;

  beforeAll(async () => {
    const { data: esp, error: espErr } = await service
      .from('especies')
      .select('id')
      .eq('nombre', 'Arándano')
      .single();
    if (espErr || !esp) throw new Error('No está Arándano en especies. ¿Corriste db:reset?');

    // Planta de prueba propia (no se toca 02-001, que el resto de la suite ya
    // gestiona con cuidado), directamente en 'trasplante' vía service_role.
    const { data: planta, error } = await service
      .from('plantas')
      .insert({ codigo_sistema: `IND-${R}`, especie_id: esp.id, estado: 'trasplante', es_prueba: true })
      .select('id')
      .single();
    if (error || !planta) throw new Error(`No se pudo crear la planta de prueba: ${error?.message}`);
    plantaTrasplanteId = planta.id;
  }, 30_000);

  describe('individualizar_plantas (RPC)', () => {
    it('operario individualiza N plantas de un cruce en estado trasplante, con codigo_display correlativo', async () => {
      const { data, error } = await individualizarPlantas(operario, {
        p_planta_id: plantaTrasplanteId,
        p_cantidad: 2,
      });
      expect(error).toBeNull();
      const res = data as { cantidad: number; codigos: string[] };
      expect(res.cantidad).toBe(2);
      expect(res.codigos).toHaveLength(2);
      expect(res.codigos[0]).toMatch(new RegExp(`^IND-${R}-P\\d+$`));
      expect(new Set(res.codigos).size).toBe(2);

      const { data: filas } = await service.from('individuos').select('id').eq('planta_id', plantaTrasplanteId);
      expect(filas!.length).toBe(2);
      individuoId = filas![0].id;
    });

    it('es acumulativo: una segunda llamada agrega más individuos, no reemplaza', async () => {
      const { error } = await individualizarPlantas(operario, {
        p_planta_id: plantaTrasplanteId,
        p_cantidad: 1,
      });
      expect(error).toBeNull();
      const { data: filas } = await service.from('individuos').select('id').eq('planta_id', plantaTrasplanteId);
      expect(filas!.length).toBe(3);
    });

    it('rechaza individualizar una planta que NO está en estado trasplante', async () => {
      const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
      const { data: fueraDeFase } = await service
        .from('plantas')
        .insert({ codigo_sistema: `IND-FUERA-${R}`, especie_id: esp!.id, estado: 'cosecha', es_prueba: true })
        .select('id')
        .single();
      const { error } = await individualizarPlantas(operario, {
        p_planta_id: fueraDeFase!.id,
        p_cantidad: 1,
      });
      expect(error).toBeTruthy();
    });

    it('dos individualizaciones concurrentes del mismo cruce no generan codigo_display duplicado', async () => {
      const llamar = () =>
        individualizarPlantas(operario, { p_planta_id: plantaTrasplanteId, p_cantidad: 1 });
      const [a, b] = await Promise.all([llamar(), llamar()]);
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();

      const { data: todos } = await service.from('individuos').select('codigo_display').eq('planta_id', plantaTrasplanteId);
      const codigos = todos!.map((i) => i.codigo_display);
      expect(new Set(codigos).size).toBe(codigos.length);
    });

    it('queda auditado en audit_log (accion individualizacion)', async () => {
      const audit = await ultimaAuditoria('individualizacion');
      expect(audit).toBeTruthy();
      expect(audit.planta_id).toBe(plantaTrasplanteId);
      expect(audit.detalle.codigos.length).toBeGreaterThan(0);
    });
  });

  describe('individuos: RLS', () => {
    it('operario NO puede hacer hard-DELETE de un individuo', async () => {
      const { error } = await operario.from('individuos').delete().eq('id', individuoId);
      expect(error).toBeTruthy();
      const { data: sigue } = await service.from('individuos').select('id').eq('id', individuoId).single();
      expect(sigue).toBeTruthy();
    });

    it('admin TAMPOCO puede hacer hard-DELETE (nunca hay borrado físico, ni para admin)', async () => {
      const { error } = await admin.from('individuos').delete().eq('id', individuoId);
      expect(error).toBeTruthy();
      const { data: sigue } = await service.from('individuos').select('id').eq('id', individuoId).single();
      expect(sigue).toBeTruthy();
    });

    it('el autor (operario, vía la RPC) SÍ puede marcar baja actualizando estado_vital/fecha_baja', async () => {
      // Desde 20261021160000 la baja va por marcar_baja_individuo: el UPDATE
      // directo de estado_vital/fecha_baja ya no tiene grant.
      const { error: errDirecto } = await operario
        .from('individuos')
        .update({ estado_vital: 'descartado', fecha_baja: '2026-07-14' })
        .eq('id', individuoId);
      expect(errDirecto?.code).toBe('42501');

      const { error } = await operario.rpc('marcar_baja_individuo', {
        p_individuo_id: individuoId,
        p_estado: 'descartado',
        p_criterios: ['vigor', 'sanidad'],
        p_nota: 'Observación de baja persistida',
        p_fecha: '2026-07-14',
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(error).toBeNull();
      const { data } = await service.from('individuos').select('estado_vital, fecha_baja').eq('id', individuoId).single();
      expect(data).toEqual({ estado_vital: 'descartado', fecha_baja: '2026-07-14' });
    });
  });

  describe('ronda_evaluacion_anual (North Star v5 — sin fase_actual, valida plantas.estado + estado_vital)', () => {
    let rondaId: string;
    let individuoVivoId: string;

    it('resuelve un individuo vivo (distinto del ya dado de baja en el describe anterior) para los tests de rondas', async () => {
      const { data: filas } = await service.from('individuos').select('id, estado_vital').eq('planta_id', plantaTrasplanteId);
      const vivo = filas!.find((f) => f.id !== individuoId && f.estado_vital === 'vivo');
      expect(vivo).toBeTruthy();
      individuoVivoId = vivo!.id;
    });

    it('iniciar_ronda_evaluacion falla si el CRUCE no está en fase evaluacion_anual (individuos ya no tiene fase propia)', async () => {
      const { error } = await iniciarRondaAnual(operario, individuoVivoId);
      expect(error).toBeTruthy();
    });

    it('iniciar_ronda_evaluacion falla si el individuo NO está vivo, aunque el cruce esté en evaluacion_anual', async () => {
      await service.from('plantas').update({ estado: 'evaluacion_anual' }).eq('id', plantaTrasplanteId);
      const { error } = await iniciarRondaAnual(operario, individuoId); // ya descartado
      expect(error).toBeTruthy();
      expect(error!.message).toMatch(/no está vivo/);
    });

    it('iniciar_ronda_evaluacion crea la ronda 1 y queda auditada (cruce en evaluacion_anual, individuo vivo)', async () => {
      const { data, error } = await iniciarRondaAnual(operario, individuoVivoId);
      expect(error).toBeNull();
      const res = data as { ronda_id: string; numero_ronda: number };
      expect(res.numero_ronda).toBe(1);
      rondaId = res.ronda_id;

      const audit = await ultimaAuditoria('creacion_ronda_evaluacion_anual');
      expect(audit).toBeTruthy();
      expect(audit.detalle.numero_ronda).toBe(1);
    });

    it('iniciar_ronda_evaluacion rechaza una 4ª ronda', async () => {
      await cerrarRonda(rondaId);
      const r2 = await iniciarRondaAnual(operario, individuoVivoId); // ronda 2
      expect(r2.error).toBeNull();
      await cerrarRonda((r2.data as { ronda_id: string }).ronda_id);
      const r3 = await iniciarRondaAnual(operario, individuoVivoId); // ronda 3
      expect(r3.error).toBeNull();
      await cerrarRonda((r3.data as { ronda_id: string }).ronda_id);
      // La envoltura rechaza el número 4 (fuera de 1 a 3) con 22023; el tope de 3 de la firma
      // vieja sigue vigente y se comprueba con el permiso del dueño (paso 39).
      const { error } = await iniciarRondaAnual(operario, individuoVivoId); // rechazada
      expect(error?.code).toBe('22023');
      const interna = await psqlInterno(operarioId, `public.iniciar_ronda_evaluacion('${individuoVivoId}')`);
      expect(interna.error?.code).toBe('42501');
    });

    it('bloquea evaluación completa y PCR sobre la ronda de un individuo dado de baja (defecto bloqueante de North Star v5)', async () => {
      // Crea la ronda para el individuo YA descartado directo por service_role
      // (la RPC iniciar_ronda_evaluacion ya lo rechaza — acá se prueba la
      // segunda barrera, la policy de INSERT en evaluaciones/pcr_analisis).
      const { data: rondaBaja } = await service
        .from('ronda_evaluacion_anual')
        .insert({ individuo_id: individuoId, numero_ronda: 1, anio: 2026, created_by: adminId })
        .select('id')
        .single();

      const { error: errEval } = await operario
        .from('evaluaciones')
        .insert({ ronda_id: rondaBaja!.id, anio: 2026, fecha: '2026-07-14', created_by: operarioId });
      expect(errEval).toBeTruthy();

      const { error: errPcr } = await operario
        .from('pcr_analisis')
        .insert({ ronda_id: rondaBaja!.id, realizado: false, created_by: operarioId });
      expect(errPcr).toBeTruthy();
    });

    describe('evaluaciones: RLS (cuelga de ronda_id, no de individuo_id — Prompt 7)', () => {
      it('operario SÍ puede insertar una evaluación cerrada sin muestra (descriptores opcionales)', async () => {
        const { data, error } = await operario
          .from('evaluaciones')
          .insert({
            ronda_id: rondaId,
            anio: 2026,
            fecha: '2026-07-14',
            estado: 'completa',
            sin_muestra: true,
            created_by: operarioId,
          })
          .select('id')
          .single();
        expect(error).toBeNull();
        expect(data!.id).toBeTruthy();
      });

      it('un CHECK de rango rechaza un descriptor de escala fuera de 1-5', async () => {
        const { error } = await operario.from('evaluaciones').insert({
          ronda_id: rondaId, anio: 2026, fecha: '2026-07-14', created_by: operarioId, brotacion: 9,
        });
        expect(error).toBeTruthy();
      });

      it('Brix fuera de 10-18 se guarda como observación válida', async () => {
        const { data, error } = await operario.from('evaluaciones').insert({
          ronda_id: rondaId,
          anio: 2026,
          fecha: '2026-07-14',
          estado: 'completa',
          sin_muestra: true,
          created_by: operarioId,
          brix: 25,
        }).select('brix, requiere_revision').single();
        expect(error).toBeNull();
        expect(data).toMatchObject({ brix: 25, requiere_revision: false });
      });

      it('operario NO puede editar una evaluación ya cargada de otro usuario (admin): 0 filas, sin error', async () => {
        const { data: evalAdmin } = await admin
          .from('evaluaciones')
          .insert({
            ronda_id: rondaId,
            anio: 2026,
            fecha: '2026-07-14',
            estado: 'completa',
            sin_muestra: true,
            created_by: adminId,
          })
          .select('id')
          .single();
        evaluacionAdminId = evalAdmin!.id;

        const { data, error } = await operario
          .from('evaluaciones')
          .update({ evaluador: 'hackeado' })
          .eq('id', evaluacionAdminId)
          .select('id');
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });

      it('admin SÍ puede editar una evaluación ya cargada', async () => {
        const { data, error } = await admin
          .from('evaluaciones')
          .update({ evaluador: 'corregido-admin' })
          .eq('id', evaluacionAdminId)
          .select('id');
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it('NADIE puede hacer hard-DELETE de una evaluación, ni admin', async () => {
        const { error } = await admin.from('evaluaciones').delete().eq('id', evaluacionAdminId);
        expect(error).toBeTruthy();
      });
    });

    describe('pcr_analisis: RLS (cuelga de ronda_id, no de individuo_id — Prompt 7)', () => {
      it('operario SÍ puede marcar un PCR', async () => {
        const { data, error } = await operario
          .from('pcr_analisis')
          .insert({ ronda_id: rondaId, realizado: false, created_by: operarioId })
          .select('id')
          .single();
        expect(error).toBeNull();
        expect(data!.id).toBeTruthy();
      });

      it('operario NO puede editar un PCR ya cargado', async () => {
        const { data: pcr } = await service
          .from('pcr_analisis')
          .insert({ ronda_id: rondaId, realizado: false, created_by: adminId })
          .select('id')
          .single();
        const { data, error } = await operario.from('pcr_analisis').update({ realizado: true }).eq('id', pcr!.id).select('id');
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });

      it('NADIE puede hacer hard-DELETE de un PCR, ni admin', async () => {
        const { data: pcr } = await service
          .from('pcr_analisis')
          .insert({ ronda_id: rondaId, realizado: false, created_by: adminId })
          .select('id')
          .single();
        const { error } = await admin.from('pcr_analisis').delete().eq('id', pcr!.id);
        expect(error).toBeTruthy();
      });
    });
  });

  describe('baja_motivo: RLS', () => {
    // Los motivos los escribió marcar_baja_individuo en el test de baja de arriba.
    it('operario guarda y puede releer la observación de un motivo de baja', async () => {
      const { data, error } = await operario
        .from('baja_motivo')
        .select('id, nota, created_by')
        .eq('individuo_id', individuoId)
        .eq('criterio', 'vigor')
        .single();
      expect(error).toBeNull();
      expect(data!.nota).toBe('Observación de baja persistida');
      expect(data!.created_by).toBe(operarioId);
    });

    it('un individuo puede tener varios motivos de baja simultáneos', async () => {
      const { data: motivos } = await service.from('baja_motivo').select('criterio').eq('individuo_id', individuoId);
      expect(motivos!.map((m) => m.criterio).sort()).toEqual(['sanidad', 'vigor']);
    });

    it('nadie inserta motivos de baja directo (solo por las RPC de baja)', async () => {
      const { error } = await operario
        .from('baja_motivo')
        .insert({ individuo_id: individuoId, criterio: 'arquitectura', created_by: operarioId });
      expect(error?.code).toBe('42501');
      const { error: errAdmin } = await admin
        .from('baja_motivo')
        .insert({ individuo_id: individuoId, criterio: 'arquitectura', created_by: adminId });
      expect(errAdmin?.code).toBe('42501');
    });

    it('operario NO puede hacer hard-DELETE de un motivo de baja', async () => {
      const { data: fila } = await service
        .from('baja_motivo')
        .select('id')
        .eq('individuo_id', individuoId)
        .limit(1)
        .single();
      const { error } = await operario.from('baja_motivo').delete().eq('id', fila!.id);
      expect(error).toBeTruthy();
    });
  });
});

// ===========================================================================
// COSECHA_FRUTO, EVALUACION_REDUCIDA, MULTISITIO, REINICIAR/BORRAR CRUZAMIENTO
// (Prompt 7 — North Star v4)
// ===========================================================================
describe('cosecha_fruto, evaluacion_reducida, multisitio (Prompt 7)', () => {
  const R = Date.now();
  let plantaId: string;
  let individuoId: string;

  beforeAll(async () => {
    const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
    const { data: planta, error } = await service
      .from('plantas')
      .insert({ codigo_sistema: `V4-${R}`, especie_id: esp!.id, estado: 'trasplante', es_prueba: true })
      .select('id')
      .single();
    if (error || !planta) throw new Error(`setup planta: ${error?.message}`);
    plantaId = planta.id;

    const { data: rpcData, error: rpcErr } = await individualizarPlantas(operario, { p_planta_id: plantaId, p_cantidad: 1 });
    if (rpcErr) throw new Error(`setup individualizar: ${rpcErr.message}`);
    const { data: inds } = await service.from('individuos').select('id').eq('planta_id', plantaId);
    individuoId = inds![0].id;
    void rpcData;
  }, 30_000);

  describe('cosecha_fruto: RLS + correlativo', () => {
    it('operario inserta frutos y numero_fruto sale correlativo (1, 2) por planta', async () => {
      const { data: f1, error: e1 } = await operario
        .from('cosecha_fruto')
        .insert({ planta_id: plantaId, cantidad_semillas: 10, created_by: operarioId })
        .select('numero_fruto')
        .single();
      expect(e1).toBeNull();
      expect(f1!.numero_fruto).toBe(1);

      const { data: f2, error: e2 } = await operario
        .from('cosecha_fruto')
        .insert({ planta_id: plantaId, cantidad_semillas: 7, created_by: operarioId })
        .select('numero_fruto')
        .single();
      expect(e2).toBeNull();
      expect(f2!.numero_fruto).toBe(2);
    });

    it('operario (autor) puede borrar el último fruto; admin también puede', async () => {
      const { data: fila } = await service.from('cosecha_fruto').select('id').eq('planta_id', plantaId).eq('numero_fruto', 2).single();
      const { error } = await operario.from('cosecha_fruto').delete().eq('id', fila!.id);
      expect(error).toBeNull();
      const { data: sigue } = await service.from('cosecha_fruto').select('id').eq('id', fila!.id).maybeSingle();
      expect(sigue).toBeNull();
    });
  });

  describe('polinizacion_evento: RLS + suma por cruce (corrección de sobrescritura)', () => {
    it('operario inserta varias sesiones y todas persisten (no se sobrescriben entre sí)', async () => {
      const { error: e1 } = await operario
        .from('polinizacion_evento')
        .insert({ planta_id: plantaId, fecha: '2026-01-01', n_flores_cruzadas: 40, created_by: operarioId });
      expect(e1).toBeNull();

      const { error: e2 } = await operario
        .from('polinizacion_evento')
        .insert({ planta_id: plantaId, fecha: '2026-01-05', n_flores_cruzadas: 25, created_by: operarioId });
      expect(e2).toBeNull();

      const { data: sesiones, error: eLectura } = await service
        .from('polinizacion_evento')
        .select('n_flores_cruzadas')
        .eq('planta_id', plantaId);
      expect(eLectura).toBeNull();
      expect(sesiones).toHaveLength(2);
      const suma = sesiones!.reduce((acc, s) => acc + s.n_flores_cruzadas, 0);
      expect(suma).toBe(65); // 40 + 25: la corrección es justamente que esto ya no se pisa a 25
    });

    it('NO puede insertar una sesión a nombre de otro usuario', async () => {
      const { error } = await operario
        .from('polinizacion_evento')
        .insert({ planta_id: plantaId, fecha: '2026-01-10', n_flores_cruzadas: 5, created_by: adminId });
      expect(error).toBeTruthy();
    });

    it('operario (autor) puede borrar su propia sesión; admin también puede', async () => {
      const { data: fila } = await service.from('polinizacion_evento').select('id').eq('planta_id', plantaId).eq('fecha', '2026-01-05').single();
      const { error } = await operario.from('polinizacion_evento').delete().eq('id', fila!.id);
      expect(error).toBeNull();
      const { data: sigue } = await service.from('polinizacion_evento').select('id').eq('id', fila!.id).maybeSingle();
      expect(sigue).toBeNull();
    });
  });

  describe('obtener_ranking_polinizacion_varietal: agregado sensible por variedad', () => {
    let variedadAId: string;
    let variedadBId: string;
    let variedadCId: string;
    let plantaIds: string[] = [];
    let floresRealesEsperadas: number;

    beforeAll(async () => {
      const sufijo = Date.now();
      const { data: variedades, error: errorVariedades } = await service
        .from('variedades')
        .insert([
          { especie_id: especieIdDe02001, nombre: `Ranking A ${sufijo}`, created_by: adminId },
          { especie_id: especieIdDe02001, nombre: `Ranking B ${sufijo}`, created_by: adminId },
          { especie_id: especieIdDe02001, nombre: `Ranking C ${sufijo}`, created_by: adminId },
        ])
        .select('id, nombre');
      if (errorVariedades || !variedades || variedades.length !== 3) {
        throw errorVariedades ?? new Error('No se pudieron preparar variedades para el ranking de polinización.');
      }
      variedadAId = variedades.find((v) => v.nombre.startsWith('Ranking A'))!.id;
      variedadBId = variedades.find((v) => v.nombre.startsWith('Ranking B'))!.id;
      variedadCId = variedades.find((v) => v.nombre.startsWith('Ranking C'))!.id;

      const crearCruce = async (codigo: string, mama_id: string, papa_id: string) => {
        const { data, error } = await service
          .from('plantas')
          .insert({
            codigo_sistema: `${codigo}-${sufijo}`,
            especie_id: especieIdDe02001,
            estado: 'polinizacion',
            mama_id,
            papa_id,
            es_prueba: true,
          })
          .select('id')
          .single();
        if (error || !data) throw error ?? new Error(`No se creó ${codigo}.`);
        plantaIds.push(data.id);
        return data.id;
      };

      const cruceAB = await crearCruce('RANK-POL-AB', variedadAId, variedadBId);
      const cruceAC = await crearCruce('RANK-POL-AC', variedadAId, variedadCId);
      // Autopolinización: B ocupa ambos roles; UNION de la RPC debe impedir
      // que estas 7 flores/sesión se dupliquen en el agregado de B.
      const cruceBB = await crearCruce('RANK-POL-BB', variedadBId, variedadBId);
      const cruceEliminado = await crearCruce('RANK-POL-ELIM', variedadAId, variedadCId);

      const { error: errorEventos } = await service.from('polinizacion_evento').insert([
        { planta_id: cruceAB, fecha: '2026-09-01', n_flores_cruzadas: 40, created_by: adminId },
        { planta_id: cruceAB, fecha: '2026-09-02', n_flores_cruzadas: 10, created_by: adminId },
        { planta_id: cruceAC, fecha: '2026-09-03', n_flores_cruzadas: 25, created_by: adminId },
        { planta_id: cruceBB, fecha: '2026-09-04', n_flores_cruzadas: 7, created_by: adminId },
        { planta_id: cruceEliminado, fecha: '2026-09-05', n_flores_cruzadas: 99, created_by: adminId },
      ]);
      if (errorEventos) throw errorEventos;
      const { error: errorEliminar } = await service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', cruceEliminado);
      if (errorEliminar) throw errorEliminar;

      const { data: eventosActivos, error: errorEventosActivos } = await service
        .from('polinizacion_evento')
        .select('n_flores_cruzadas, plantas!inner(especie_id, eliminado_at)')
        .eq('plantas.especie_id', especieIdDe02001)
        .is('plantas.eliminado_at', null);
      if (errorEventosActivos) throw errorEventosActivos;
      floresRealesEsperadas = (eventosActivos ?? []).reduce(
        (total, evento) => total + evento.n_flores_cruzadas,
        0,
      );
    });

    afterAll(async () => {
      if (plantaIds.length > 0) {
        await service.from('polinizacion_evento').delete().in('planta_id', plantaIds);
        await service.from('plantas').delete().in('id', plantaIds);
      }
      await service.from('variedades').delete().in('id', [variedadAId, variedadBId, variedadCId].filter(Boolean));
    });

    it('admin obtiene las tres métricas, sin roles ni cruces individuales', async () => {
      const { data, error } = await admin.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especieIdDe02001 });
      expect(error).toBeNull();

      const filas = (data ?? []).filter((fila: { variedad_id: string }) =>
        [variedadAId, variedadBId, variedadCId].includes(fila.variedad_id),
      );
      const porVariedad = new Map(filas.map((fila: {
        variedad_id: string;
        flores_totales: number;
        sesiones_polinizacion: number;
        cruces_distintos: number;
      }) => [fila.variedad_id, fila]));

      expect(porVariedad.get(variedadAId)).toMatchObject({ flores_totales: 75, sesiones_polinizacion: 3, cruces_distintos: 2 });
      expect(porVariedad.get(variedadBId)).toMatchObject({ flores_totales: 57, sesiones_polinizacion: 3, cruces_distintos: 2 });
      expect(porVariedad.get(variedadCId)).toMatchObject({ flores_totales: 25, sesiones_polinizacion: 1, cruces_distintos: 1 });
      const resumen = (data ?? []).find((fila: { tipo_fila: string }) => fila.tipo_fila === 'resumen');
      expect(resumen).toMatchObject({ tipo_fila: 'resumen', flores_reales: floresRealesEsperadas });
      expect(resumen).toHaveProperty('variedad_id', null);
      expect(filas[0]).not.toHaveProperty('planta_id');
      expect(filas[0]).not.toHaveProperty('mama_id');
      expect(filas[0]).not.toHaveProperty('papa_id');
    });

    it('deja una sola auditoría agregada, no una lectura por cruce', async () => {
      const { data: auditorias, error } = await service
        .from('audit_log')
        .select('usuario_id, planta_id, campos_expuestos, detalle')
        .eq('accion', 'lectura_ranking_polinizacion_varietal')
        .eq('usuario_id', adminId)
        .gte('ocurrido_en', inicioTests);
      expect(error).toBeNull();
      expect(auditorias).toHaveLength(1);
      expect(auditorias![0].planta_id).toBeNull();
      expect(auditorias![0].campos_expuestos).toEqual(expect.arrayContaining(['flores_totales', 'sesiones_polinizacion', 'cruces_distintos', 'flores_reales']));
      expect(auditorias![0].detalle).toMatchObject({
        especie_id: especieIdDe02001,
        participacion_parental: 'ambos',
      });
    });

    it('admin puede separar la actividad por rol parental sin duplicar autopolinización', async () => {
      const obtenerPorRol = async (p_rol: 'mama' | 'papa') => {
        const { data, error } = await admin.rpc('obtener_ranking_polinizacion_varietal', {
          p_especie_id: especieIdDe02001,
          p_rol,
        });
        expect(error).toBeNull();
        const porVariedad = new Map((data ?? [])
          .filter((fila: { variedad_id: string }) => [variedadAId, variedadBId, variedadCId].includes(fila.variedad_id))
          .map((fila: { variedad_id: string; flores_totales: number; sesiones_polinizacion: number; cruces_distintos: number }) => [fila.variedad_id, fila]));
        const resumen = (data ?? []).find((fila: { tipo_fila: string }) => fila.tipo_fila === 'resumen');
        return { porVariedad, resumen };
      };

      const comoMama = await obtenerPorRol('mama');
      expect(comoMama.porVariedad.get(variedadAId)).toMatchObject({ flores_totales: 75, sesiones_polinizacion: 3, cruces_distintos: 2 });
      expect(comoMama.porVariedad.get(variedadBId)).toMatchObject({ flores_totales: 7, sesiones_polinizacion: 1, cruces_distintos: 1 });
      expect(comoMama.porVariedad.has(variedadCId)).toBe(false);
      expect(comoMama.resumen).toMatchObject({ flores_reales: floresRealesEsperadas });

      const comoPapa = await obtenerPorRol('papa');
      expect(comoPapa.porVariedad.get(variedadBId)).toMatchObject({ flores_totales: 57, sesiones_polinizacion: 3, cruces_distintos: 2 });
      expect(comoPapa.porVariedad.get(variedadCId)).toMatchObject({ flores_totales: 25, sesiones_polinizacion: 1, cruces_distintos: 1 });
      expect(comoPapa.porVariedad.has(variedadAId)).toBe(false);
      expect(comoPapa.resumen).toMatchObject({ flores_reales: floresRealesEsperadas });
    });

    it('rechaza un modo parental inválido antes de revelar datos', async () => {
      const { error } = await admin.rpc('obtener_ranking_polinizacion_varietal', {
        p_especie_id: especieIdDe02001,
        p_rol: 'otro',
      });
      expect(error).toBeTruthy();
      expect(error!.code).toBe('22023');
    });

    it('operario no puede consultar la estrategia varietal agregada', async () => {
      const { error } = await operario.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especieIdDe02001 });
      expect(error).toBeTruthy();
      expect(error!.code).toBe('42501');
    });

    it('anon no puede ejecutar la RPC', async () => {
      const { error } = await anon.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especieIdDe02001 });
      expect(error).toBeTruthy();
    });
  });

  describe('evaluacion_reducida: RLS', () => {
    let evalReducidaId: string;

    it('operario guarda y puede releer observaciones en Trasplante', async () => {
      const { data, error } = await operario
        .from('evaluacion_reducida')
        .insert({ individuo_id: individuoId, fase: 'trasplante', talla: 12.5, numero_entrenudos: 6, vigor: 4, observaciones: 'Observación Trasplante persistida', created_by: operarioId })
        .select('id, observaciones')
        .single();
      expect(error).toBeNull();
      evalReducidaId = data!.id;
      expect(data!.observaciones).toBe('Observación Trasplante persistida');
    });

    it('operario guarda y puede releer observaciones en Crecimiento', async () => {
      const { data, error } = await operario
        .from('evaluacion_reducida')
        .insert({ individuo_id: individuoId, fase: 'crecimiento', talla: 18, vigor: 3, multibrotes: 2, presencia_raices: 4, observaciones: 'Observación Crecimiento persistida', created_by: operarioId })
        .select('id, observaciones')
        .single();
      expect(error).toBeNull();
      expect(data!.observaciones).toBe('Observación Crecimiento persistida');
    });

    it('un CHECK de rango rechaza vigor fuera de 1-5', async () => {
      const { error } = await operario
        .from('evaluacion_reducida')
        .insert({ individuo_id: individuoId, fase: 'trasplante', vigor: 9, created_by: operarioId });
      expect(error).toBeTruthy();
    });

    it('operario NO puede editar una evaluación reducida ya cargada; admin sí', async () => {
      const { data, error } = await operario.from('evaluacion_reducida').update({ talla: 99 }).eq('id', evalReducidaId).select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(0);

      const { data: dataAdmin, error: errAdmin } = await admin.from('evaluacion_reducida').update({ talla: 15 }).eq('id', evalReducidaId).select('id');
      expect(errAdmin).toBeNull();
      expect(dataAdmin).toHaveLength(1);
    });

    it('NADIE puede hacer hard-DELETE de una evaluación reducida, ni admin', async () => {
      const { error } = await admin.from('evaluacion_reducida').delete().eq('id', evalReducidaId);
      expect(error).toBeTruthy();
    });

    it('bloquea evaluación reducida sobre un individuo dado de baja (North Star v5, defecto bloqueante)', async () => {
      const { data: indBaja } = await service
        .from('individuos')
        .insert({ planta_id: plantaId, codigo_display: `${R}-BAJA`, created_by: adminId, estado_vital: 'muerto' })
        .select('id')
        .single();

      const { error } = await operario
        .from('evaluacion_reducida')
        .insert({ individuo_id: indBaja!.id, fase: 'trasplante', talla: 10, created_by: operarioId });
      expect(error).toBeTruthy();
    });
  });

  describe('multisitio legacy: archivo solo-admin, sin escrituras operativas', () => {
    it('operario no puede leer ni escribir la tabla de traslado mutable deprecada', async () => {
      const { data: lectura, error: lecturaError } = await operario
        .from('multisitio')
        .select('id, individuo_id');
      expect(lecturaError).toBeNull();
      expect(lectura).toHaveLength(0);

      const { error: escrituraError } = await operario
        .from('multisitio')
        .insert({ individuo_id: individuoId, destino: 'No debe persistir', created_by: operarioId });
      expect(escrituraError).toBeTruthy();
    });

    it('admin conserva lectura del archivo legacy, pero tampoco escribe por la API', async () => {
      const { error: lecturaAdminError } = await admin.from('multisitio').select('id').limit(1);
      expect(lecturaAdminError).toBeNull();

      const { error: escrituraAdminError } = await admin
        .from('multisitio')
        .insert({ individuo_id: individuoId, destino: 'No debe persistir', created_by: adminId });
      expect(escrituraAdminError).toBeTruthy();
    });
  });
});

describe('reiniciar_cruzamiento / borrar_cruzamiento (Prompt 7, Parte E)', () => {
  const R = Date.now();
  let plantaId: string;

  beforeAll(async () => {
    const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
    const { data: planta, error } = await service
      .from('plantas')
      .insert({
        codigo_sistema: `REINICIO-${R}`,
        especie_id: esp!.id,
        estado: 'siembra_semilla',
        es_prueba: true,
      })
      .select('id')
      .single();
    if (error || !planta) throw new Error(`setup planta: ${error?.message}`);
    plantaId = planta.id;
    await service.from('registros_evento').insert({ planta_id: plantaId, tipo_evento: 'polinizacion', created_by: adminId });
    await service.from('germinacion_evento').insert({ planta_id: plantaId, fecha: '2026-02-01', cantidad_nueva: 3, created_by: adminId });
    await service.from('polinizacion_evento').insert({ planta_id: plantaId, fecha: '2026-01-01', n_flores_cruzadas: 5, created_by: adminId });
  }, 30_000);

  it('operario NO puede llamar reiniciar_cruzamiento (admin-only)', async () => {
    const { error } = await operario.rpc('reiniciar_cruzamiento', { p_planta_id: plantaId });
    expect(error).toBeTruthy();
  });

  it('admin SÍ puede reiniciar: estado vuelve a sin_empezar, columnas de fase en NULL, satélites borrados', async () => {
    const { data, error } = await admin.rpc('reiniciar_cruzamiento', { p_planta_id: plantaId });
    expect(error).toBeNull();
    const res = data as { n_individuos_preexistentes: number };
    expect(res.n_individuos_preexistentes).toBe(0);

    const { data: plantaAfter } = await service.from('plantas').select('estado').eq('id', plantaId).single();
    expect(plantaAfter!.estado).toBe('sin_empezar');

    const { data: eventos } = await service.from('registros_evento').select('id').eq('planta_id', plantaId);
    expect(eventos).toHaveLength(0);
    const { data: germ } = await service.from('germinacion_evento').select('id').eq('planta_id', plantaId);
    expect(germ).toHaveLength(0);
    const { data: polinizacionEventos } = await service.from('polinizacion_evento').select('id').eq('planta_id', plantaId);
    expect(polinizacionEventos).toHaveLength(0);

    const audit = await ultimaAuditoria('reinicio_cruzamiento');
    expect(audit).toBeTruthy();
    expect(audit.detalle.n_registros_evento).toBe(1);
    expect(audit.detalle.n_germinacion_eventos).toBe(1);
    expect(audit.detalle.n_polinizacion_eventos).toBe(1);
  });

  it('operario NO puede llamar borrar_cruzamiento (admin-only)', async () => {
    const { error } = await operario.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'soft' });
    expect(error).toBeTruthy();
  });

  it('admin: soft delete marca eliminado_at y la planta desaparece de plantas_operativas, pero sigue en plantas', async () => {
    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'soft' });
    expect(error).toBeNull();

    const { data: enVista } = await operario.from('plantas_operativas').select('id').eq('id', plantaId).maybeSingle();
    expect(enVista).toBeNull();

    const { data: siguePlanta } = await service.from('plantas').select('id, eliminado_at').eq('id', plantaId).single();
    expect(siguePlanta!.eliminado_at).toBeTruthy();

    const audit = await ultimaAuditoria('borrado_cruzamiento_soft');
    expect(audit).toBeTruthy();
  });

  it('admin: hard delete elimina la planta y sus individuos/satélites por completo', async () => {
    const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
    const { data: plantaHard } = await service
      .from('plantas')
      // es_prueba: desde 20260907001000 el hard delete solo acepta cruces de
      // prueba. Estos cruces sintéticos lo son por definición.
      .insert({ codigo_sistema: `HARD-${R}`, especie_id: esp!.id, estado: 'trasplante', es_prueba: true })
      .select('id')
      .single();
    const plantaHardId = plantaHard!.id;

    await individualizarPlantas(operario, { p_planta_id: plantaHardId, p_cantidad: 1 });
    const { data: indsHard } = await service.from('individuos').select('id').eq('planta_id', plantaHardId);
    const individuoHardId = indsHard![0].id;

    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaHardId, p_tipo: 'hard' });
    expect(error).toBeNull();

    const { data: plantaSigue } = await service.from('plantas').select('id').eq('id', plantaHardId).maybeSingle();
    expect(plantaSigue).toBeNull();
    const { data: individuoSigue } = await service.from('individuos').select('id').eq('id', individuoHardId).maybeSingle();
    expect(individuoSigue).toBeNull();

    const audit = await ultimaAuditoria('borrado_cruzamiento_hard');
    expect(audit).toBeTruthy();
    expect(audit.detalle.n_individuos).toBe(1);
  });

  it('mid-fix: hard delete purga procedimiento_objetivos y ranking_snapshot_resultado (gaps reales encontrados en producción)', async () => {
    const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
    const { data: planta } = await service
      .from('plantas')
      .insert({ codigo_sistema: `HARDGAP-${R}`, especie_id: esp!.id, estado: 'evaluacion_anual', es_prueba: true })
      .select('id')
      .single();
    const plantaId2 = planta!.id;

    const { data: individuo } = await service
      .from('individuos')
      .insert({ planta_id: plantaId2, codigo_display: `HARDGAP-${R}-P01`, created_by: adminId })
      .select('id')
      .single();
    const individuoId2 = individuo!.id;

    const { data: ronda } = await service
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuoId2, numero_ronda: 1, anio: 2026, created_by: adminId })
      .select('id')
      .single();
    const { data: evaluacion } = await service
      .from('evaluaciones')
      .insert({
        // estado 'borrador' a propósito: una evaluación 'completa' es la señal
        // de dato real y bloquea la purga (PUERTA 2 de borrar_cruzamiento).
        // Ese caso se cubre aparte, en purga-cruce-prueba.test.ts.
        ronda_id: ronda!.id, fecha: '2026-07-19', estado: 'borrador', created_by: adminId,
        brotacion: 1, floracion: 1, cuaja: 1, concentracion_cosecha: 1, calibre_mm: 18, firmeza: 1, color: 1,
        bloom: 1, brix: 12, rend_kg_planta: 1, rend_t_ha: 1, pct_fruta_exportable: 50, dano_calor: 1, golpe_sol: 1,
        caida_fruto: 1, cantidad_frutos: 5, peso_total_g: 50,
      })
      .select('id')
      .single();

    // procedimiento_objetivos: objetivo directo tipo='cruzamiento' hacia esta planta.
    const { data: proc } = await service
      .from('procedimientos')
      .insert({ nombre: 'HARDGAP poda', tipo: 'poda', fecha_inicio: '2026-07-19', estado: 'planificado', responsable_id: adminId, created_by: adminId })
      .select('id')
      .single();
    await service.from('procedimiento_objetivos').insert({ procedimiento_id: proc!.id, tipo: 'cruzamiento', planta_id: plantaId2 });

    // ranking_snapshot_resultado: fila resultado para este individuo.
    const { data: scoringVersion } = await service.from('scoring_version').select('id').limit(1).single();
    const { data: snapshot } = await service
      .from('ranking_snapshot')
      .insert({
        nombre: 'HARDGAP snapshot', alcance: 'cruzamiento', planta_id: plantaId2, especie_id: esp!.id,
        scoring_version_id: scoringVersion!.id, poblacion_comparada: 1, criterios: [], created_by: adminId,
      })
      .select('id')
      .single();
    await service.from('ranking_snapshot_resultado').insert({
      snapshot_id: snapshot!.id, individuo_id: individuoId2, codigo_display: `HARDGAP-${R}-P01`,
      evaluacion_id: evaluacion!.id, posicion: 1, puntaje: 0.5, detalle: {},
    });

    // Sin emplazamiento_individuo: este caso SÍ debe poder hard-deletearse.
    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId2, p_tipo: 'hard' });
    expect(error).toBeNull();

    const { data: plantaSigue } = await service.from('plantas').select('id').eq('id', plantaId2).maybeSingle();
    expect(plantaSigue).toBeNull();
    // La cabecera ranking_snapshot NO se toca (puede ser compartida con otros cruces si fuera alcance especie) —
    // solo su fila resultado, que sí debe haberse ido junto con el individuo.
    const { data: resultadoSigue } = await service.from('ranking_snapshot_resultado').select('individuo_id').eq('individuo_id', individuoId2).maybeSingle();
    expect(resultadoSigue).toBeNull();
  });

  it('mid-fix: hard delete se rechaza limpio si el cruce tiene historial territorial — nunca deja estado a medio camino', async () => {
    const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
    const { data: planta } = await service
      .from('plantas')
      // es_prueba: true para que el rechazo que se prueba acá sea el
      // territorial (PUERTA 3) y no el de "no es cruce de prueba" (PUERTA 1).
      .insert({ codigo_sistema: `HARDTERR-${R}`, especie_id: esp!.id, estado: 'traslado_destino', es_prueba: true })
      .select('id')
      .single();
    const plantaId3 = planta!.id;
    const { data: individuo } = await service
      .from('individuos')
      .insert({ planta_id: plantaId3, codigo_display: `HARDTERR-${R}-P01`, created_by: adminId })
      .select('id')
      .single();
    const individuoId3 = individuo!.id;
    // Predio/sector propios del test (no depender de que algún otro test
    // haya dejado un sector activo disponible).
    const { data: predio, error: errPredio } = await service.from('predio').insert({ nombre: `HARDTERR-predio-${R}` }).select('id').single();
    if (errPredio || !predio) throw new Error(`setup predio: ${errPredio?.message}`);
    const { data: sector, error: errSector } = await service.from('sector').select('id').eq('predio_id', predio.id).eq('activo', true).limit(1).single();
    if (errSector || !sector) throw new Error(`setup sector: ${errSector?.message}`);
    const { error: errTraslado } = await admin.rpc('registrar_traslado_individuo', { p_individuo_id: individuoId3, p_sector_id: sector.id, p_fecha_inicio: '2026-07-19' });
    if (errTraslado) throw new Error(`setup traslado: ${errTraslado.message}`);

    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId3, p_tipo: 'hard' });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/historial territorial/i);
    expect(error!.message).toMatch(/borrado suave/i);

    // Nada a medio camino: la planta sigue intacta, sin eliminado_at, y sin
    // entrada de auditoría de borrado (el INSERT a audit_log también está
    // dentro de la misma transacción que el RAISE que abortó todo).
    const { data: plantaSigue } = await service.from('plantas').select('id, eliminado_at').eq('id', plantaId3).single();
    expect(plantaSigue.eliminado_at).toBeNull();
    const { data: individuoSigue } = await service.from('individuos').select('id').eq('id', individuoId3).maybeSingle();
    expect(individuoSigue).toBeTruthy();
    const { data: auditoriaBorrado } = await service.from('audit_log').select('id').eq('planta_id', plantaId3).ilike('accion', 'borrado_cruzamiento%');
    expect(auditoriaBorrado).toHaveLength(0);
  });
});

// ===========================================================================
// CATÁLOGO SUSTRATO + PLANTAS_SUSTRATO (D3 — pulido UI post-Prompt 7)
//
// `sustrato` sigue EXACTO el mismo patrón que contenedor/insumo/predio:
// SELECT abierto a cualquier autenticado, INSERT/UPDATE/DELETE solo admin.
// `plantas_sustrato` sigue el patrón de `plantas_insumo`: cualquier
// autenticado arma/edita el set de SU registro de siembra (sin columna
// created_by, N:M simple), reemplazo de set completo (delete+insert), sin
// policy de UPDATE.
// ===========================================================================
describe('catálogo sustrato + plantas_sustrato (D3)', () => {
  const R = Date.now();
  let sustratoId: string;

  describe('sustrato: RLS', () => {
    it('operario SÍ puede leer el catálogo', async () => {
      const { data, error } = await operario.from('sustrato').select('id, nombre, activo');
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it('operario NO puede insertar un sustrato nuevo', async () => {
      const { error } = await operario.from('sustrato').insert({ nombre: `sustrato-operario-${R}` });
      expect(error).toBeTruthy();
    });

    it('admin SÍ puede insertar, actualizar y desactivar un sustrato', async () => {
      const { data: creado, error: errCrear } = await admin
        .from('sustrato')
        .insert({ nombre: `sustrato-test-${R}` })
        .select('id, activo')
        .single();
      expect(errCrear).toBeNull();
      expect(creado!.activo).toBe(true);
      sustratoId = creado!.id;

      const { error: errUpdate } = await admin.from('sustrato').update({ activo: false }).eq('id', sustratoId);
      expect(errUpdate).toBeNull();
      const { data: actualizado } = await service.from('sustrato').select('activo').eq('id', sustratoId).single();
      expect(actualizado!.activo).toBe(false);

      // Reactivarlo: el resto de esta suite usa sustratoId como catálogo activo.
      await admin.from('sustrato').update({ activo: true }).eq('id', sustratoId);
    });

    it('operario NO puede desactivar/editar un sustrato existente', async () => {
      const { data, error } = await operario.from('sustrato').update({ activo: false }).eq('id', sustratoId).select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(0); // RLS niega en silencio (0 filas), no error
    });
  });

  describe('plantas_sustrato: RLS + CHECK de porcentaje', () => {
    // A1-028: los materiales de siembra solo se registran con la etapa alcanzada.
    beforeAll(async () => {
      await service.from('plantas').update({ estado: 'siembra_semilla' }).eq('id', plantaId);
    });
    afterAll(async () => {
      await service.from('plantas').update({ estado: 'polinizacion' }).eq('id', plantaId);
    });

    it('operario SÍ puede insertar un sustrato con porcentaje en su registro de siembra', async () => {
      const { data, error } = await operario
        .from('plantas_sustrato')
        .insert({ planta_id: plantaId, sustrato_id: sustratoId, porcentaje: 60 })
        .select('planta_id, sustrato_id, porcentaje')
        .single();
      expect(error).toBeNull();
      expect(data!.porcentaje).toBe(60);
    });

    it('un CHECK rechaza porcentaje <= 0 o > 100', async () => {
      const { data: otroSustrato } = await admin.from('sustrato').insert({ nombre: `sustrato-check-${R}` }).select('id').single();
      const { error: errCero } = await operario
        .from('plantas_sustrato')
        .insert({ planta_id: plantaId, sustrato_id: otroSustrato!.id, porcentaje: 0 });
      expect(errCero).toBeTruthy();

      const { error: errExceso } = await operario
        .from('plantas_sustrato')
        .insert({ planta_id: plantaId, sustrato_id: otroSustrato!.id, porcentaje: 150 });
      expect(errExceso).toBeTruthy();
    });

    it('cualquier autenticado puede borrar (reemplazo de set completo, mismo patrón que plantas_insumo)', async () => {
      const { error } = await operario
        .from('plantas_sustrato')
        .delete()
        .eq('planta_id', plantaId)
        .eq('sustrato_id', sustratoId);
      expect(error).toBeNull();
      const { data: sigue } = await service
        .from('plantas_sustrato')
        .select('planta_id')
        .eq('planta_id', plantaId)
        .eq('sustrato_id', sustratoId)
        .maybeSingle();
      expect(sigue).toBeNull();
    });

    it('no hay policy de UPDATE: editar porcentaje in place no afecta filas', async () => {
      await service.from('plantas_sustrato').insert({ planta_id: plantaId, sustrato_id: sustratoId, porcentaje: 40 });
      const { data, error } = await operario
        .from('plantas_sustrato')
        .update({ porcentaje: 80 })
        .eq('planta_id', plantaId)
        .eq('sustrato_id', sustratoId)
        .select('porcentaje');
      expect(error).toBeTruthy(); // sin GRANT UPDATE en la tabla: PostgREST lo rechaza (42501)
      expect(data).toBeFalsy();
      const { data: intacto } = await service
        .from('plantas_sustrato')
        .select('porcentaje')
        .eq('planta_id', plantaId)
        .eq('sustrato_id', sustratoId)
        .single();
      expect(intacto!.porcentaje).toBe(40);
    });
  });
});

// =============================================================================
// SPRINT 6 — visualización agregada, viewport y aislamiento de coordenadas
// =============================================================================

describe('sprint 6: gráficos y mapa respetan comparabilidad y precisión territorial', () => {
  const sufijo = Date.now();
  let especieId: string;
  let predioAId: string;
  let predioBId: string;
  let sectorAId: string;
  let sectorBId: string;
  const plantaIds: string[] = [];

  beforeAll(async () => {
    const { data: especie, error: especieError } = await service.from('especies').select('id').limit(1).single();
    if (especieError || !especie) throw especieError ?? new Error('Sin especie para pruebas Sprint 6');
    especieId = especie.id;

    const { data: sitio, error: sitioError } = await admin.from('sitio').insert({ nombre: `Sitio mapa ${sufijo}`, created_by: adminId }).select('id').single();
    if (sitioError || !sitio) throw sitioError ?? new Error('No se creó sitio para mapa');
    const { data: predios, error: prediosError } = await admin.from('predio').insert([
      { nombre: `Predio mapa A ${sufijo}`, sitio_id: sitio.id },
      { nombre: `Predio mapa B ${sufijo}`, sitio_id: sitio.id },
    ]).select('id, nombre');
    if (prediosError || !predios) throw prediosError ?? new Error('No se crearon predios para mapa');
    predioAId = predios.find((predio) => predio.nombre.startsWith('Predio mapa A'))!.id;
    predioBId = predios.find((predio) => predio.nombre.startsWith('Predio mapa B'))!.id;
    const { data: sectores, error: sectoresError } = await admin.from('sector').insert([
      { nombre: `Sector mapa A ${sufijo}`, predio_id: predioAId, created_by: adminId },
      { nombre: `Sector mapa B ${sufijo}`, predio_id: predioBId, created_by: adminId },
    ]).select('id, nombre');
    if (sectoresError || !sectores) throw sectoresError ?? new Error('No se crearon sectores para mapa');
    sectorAId = sectores.find((sector) => sector.nombre.startsWith('Sector mapa A'))!.id;
    sectorBId = sectores.find((sector) => sector.nombre.startsWith('Sector mapa B'))!.id;

    const { data: planta, error: plantaError } = await service.from('plantas').insert({ codigo_sistema: `MAPA-${sufijo}`, especie_id: especieId, estado: 'traslado_destino', es_prueba: true }).select('id').single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se creó cruce para mapa');
    plantaIds.push(planta.id);
    const { data: individuos, error: individuosError } = await service.from('individuos').insert([
      { planta_id: planta.id, codigo_display: `MAPA-${sufijo}-P01`, estado_vital: 'vivo', created_by: adminId },
      { planta_id: planta.id, codigo_display: `MAPA-${sufijo}-P02`, estado_vital: 'vivo', created_by: adminId },
    ]).select('id');
    if (individuosError || !individuos) throw individuosError ?? new Error('No se crearon individuos para mapa');

    const [primero, segundo] = await Promise.all([
      admin.rpc('registrar_traslado_individuo', { p_individuo_id: individuos[0].id, p_sector_id: sectorAId, p_fecha_inicio: '2027-06-01', p_latitud: -35.4261, p_longitud: -71.6654, p_precision_metros: 3, p_ubicacion_exacta: 'Hilera A' }),
      admin.rpc('registrar_traslado_individuo', { p_individuo_id: individuos[1].id, p_sector_id: sectorBId, p_fecha_inicio: '2027-06-01', p_latitud: -34.2, p_longitud: -70.2, p_precision_metros: 5, p_ubicacion_exacta: 'Hilera B' }),
    ]);
    if (primero.error || segundo.error) throw primero.error ?? segundo.error;
  }, 60_000);

  it('exige especie para series históricas, por lo que no mezcla especies por defecto', async () => {
    const { error: sinEspecie } = await operario.rpc('obtener_series_historicas_cientificas', { p_especie_id: null });
    expect(sinEspecie).toBeTruthy();
    expect(sinEspecie!.message).toMatch(/especie/i);
    const { data, error } = await operario.rpc('obtener_series_historicas_cientificas', { p_especie_id: especieId });
    expect(error).toBeNull();
    expect(data).toMatchObject({ especie_id: especieId });
    expect(JSON.stringify(data)).not.toMatch(/cruzamiento|mama|papa/);
  });

  it('operario recibe clusters agregados con coordenada de PREDIO (no fina) y no puede invocar viewport de coordenadas', async () => {
    // N35 (v3 paso 8): el mapa excluye los cruces de prueba; la lectura se hace con el cruce fixture como real.
    await service.from('plantas').update({ es_prueba: false }).in('id', plantaIds);
    const { data: agregado, error: agregadoError } = await operario.rpc('obtener_resumen_mapa_territorial', { p_especie_id: especieId, p_limite: 500, p_offset: 0 })
      .then((r) => r, (e) => ({ data: null, error: e }))
      .finally(() => service.from('plantas').update({ es_prueba: true }).in('id', plantaIds));
    expect(agregadoError).toBeNull();
    // Mid-fix Sprint 7.5 (Parte D): predio.latitud/longitud SÍ se expone acá
    // a propósito (mismo dato no sensible que ya entrega obtener_mapa_cruce a
    // cualquier autenticado). Lo que sigue vedado es la coordenada FINA
    // (emplazamiento_coordenada) y sus metadatos — precision_metros,
    // ubicacion_exacta, referencia_operativa siguen siendo admin-only.
    expect(JSON.stringify(agregado)).not.toMatch(/precision_metros|ubicacion_exacta|referencia_operativa/);
    const clusters = (agregado as { clusters: Array<{ sector_id: string; predio_id: string; individuos: number; latitud: number | null; longitud: number | null; tiene_coordenada: boolean }> }).clusters;
    expect(clusters).toEqual(expect.arrayContaining([
      expect.objectContaining({ sector_id: sectorAId, predio_id: predioAId, individuos: 1, latitud: null, tiene_coordenada: false }),
      expect.objectContaining({ sector_id: sectorBId, predio_id: predioBId, individuos: 1, latitud: null, tiene_coordenada: false }),
    ]));

    const { data: exacta, error: exactaError } = await operario.rpc('consultar_mapa_viewport', {
      p_latitud_minima: -36, p_latitud_maxima: -35, p_longitud_minima: -72, p_longitud_maxima: -71, p_limite: 20, p_offset: 0,
    });
    expect(exactaError).toBeTruthy();
    expect(exacta).toBeNull();
    expect(exactaError!.message).toMatch(/admin/i);
  });

  it('viewport admin devuelve solo el punto dentro de los límites solicitados', async () => {
    // N35: el cruce fixture es de prueba; el admin lo ve pidiéndolo.
    const { data, error } = await admin.rpc('consultar_mapa_viewport', {
      p_latitud_minima: -36, p_latitud_maxima: -35, p_longitud_minima: -72, p_longitud_maxima: -71, p_especie_id: especieId, p_limite: 500, p_offset: 0, p_incluir_pruebas: true,
    });
    expect(error).toBeNull();
    const respuesta = data as { total: number; puntos: Array<{ sector_id: string; latitud: number; longitud: number; fuente: string }> };
    expect(respuesta.puntos).toEqual(expect.arrayContaining([expect.objectContaining({ sector_id: sectorAId, latitud: -35.4261, longitud: -71.6654, fuente: 'exacta' })]));
    expect(respuesta.puntos.some((punto) => punto.sector_id === sectorBId)).toBe(false);
  });

  it('mid-fix Sprint 7.5 (Parte D): viewport admin cae a la coordenada del PREDIO cuando no hay override fino', async () => {
    // Root cause real del hallazgo: la UI de traslado no captura coordenada
    // fina, así que emplazamiento_coordenada queda vacía en la práctica.
    // Este caso reproduce exactamente eso — traslado SIN p_latitud/p_longitud
    // a un predio que sí tiene su propia coordenada (Sprint 4 + selector de
    // mapa de Catálogos) — y confirma que el punto ahora aparece igual.
    const { data: predioC, error: predioCError } = await admin
      .from('predio')
      .insert({ nombre: `Predio mapa C ${sufijo}`, sitio_id: (await admin.from('predio').select('sitio_id').eq('id', predioAId).single()).data!.sitio_id, latitud: -35.5, longitud: -71.5 })
      .select('id')
      .single();
    if (predioCError || !predioC) throw predioCError ?? new Error('No se creó predio C con coordenada propia');
    const { data: sectorC, error: sectorCError } = await admin.from('sector').select('id').eq('predio_id', predioC.id).single();
    if (sectorCError || !sectorC) throw sectorCError ?? new Error('Predio C sin sector auto-provisto');

    const { data: planta, error: plantaError } = await service.from('plantas').insert({ codigo_sistema: `MAPAFALLBACK-${sufijo}`, especie_id: especieId, estado: 'traslado_destino', es_prueba: true }).select('id').single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se creó cruce para fallback de mapa');
    plantaIds.push(planta.id);
    const { data: individuo, error: individuoError } = await service.from('individuos').insert({ planta_id: planta.id, codigo_display: `MAPAFALLBACK-${sufijo}-P01`, estado_vital: 'vivo', created_by: adminId }).select('id').single();
    if (individuoError || !individuo) throw individuoError ?? new Error('No se creó individuo para fallback de mapa');

    // Traslado SIN coordenada fina — el caso real de la UI actual.
    const traslado = await admin.rpc('registrar_traslado_individuo', { p_individuo_id: individuo.id, p_sector_id: sectorC.id, p_fecha_inicio: '2027-06-01' });
    if (traslado.error) throw traslado.error;

    const { data, error } = await admin.rpc('consultar_mapa_viewport', {
      p_latitud_minima: -36, p_latitud_maxima: -35, p_longitud_minima: -72, p_longitud_maxima: -71, p_especie_id: especieId, p_limite: 500, p_offset: 0, p_incluir_pruebas: true,
    });
    expect(error).toBeNull();
    const respuesta = data as { puntos: Array<{ sector_id: string; latitud: number; longitud: number; fuente: string }> };
    expect(respuesta.puntos).toEqual(expect.arrayContaining([
      expect.objectContaining({ sector_id: sectorC.id, latitud: -35.5, longitud: -71.5, fuente: 'predio' }),
    ]));
  });

  afterAll(async () => {
    // El historial territorial es append-only: sus emplazamientos no se
    // borran ni siquiera en tests. Se archivan los cruces fixture, por lo que
    // consultar_mapa_viewport deja de verlos sin violar ese invariante.
    if (plantaIds.length > 0) {
      const { error } = await service.from('plantas').update({ eliminado_at: new Date().toISOString() }).in('id', plantaIds);
      if (error) throw error;
    }
  });
});

// ===========================================================================
// SPRINT 1 / BLOQUES B-C-D — integridad de evaluaciones y rangos
// ===========================================================================
describe('integridad de evaluaciones y rangos configurables', () => {
  const sufijo = Date.now();
  let plantaSprintId: string;
  let individuoSprintId: string;
  let rondaSprintId: string;

  const evaluacionCompleta = (fecha: string) => ({
    ronda_id: rondaSprintId,
    fecha,
    anio: 1900, // el trigger debe ignorarlo y derivarlo desde fecha
    estado: 'completa',
    cantidad_frutos: 10,
    peso_total_g: 125,
    brotacion: 3,
    floracion: 3,
    cuaja: 3,
    concentracion_cosecha: 3,
    calibre_mm: 20,
    firmeza: 4,
    color: 3,
    bloom: 4,
    brix: 14,
    rend_kg_planta: 5,
    rend_t_ha: 10,
    pct_fruta_exportable: 80,
    dano_calor: 1,
    golpe_sol: 1,
    caida_fruto: 1,
    created_by: operarioId,
  });

  beforeAll(async () => {
    const { data: especie, error: especieError } = await service
      .from('especies')
      .select('id')
      .limit(1)
      .single();
    if (especieError || !especie) throw especieError ?? new Error('Falta especie de prueba');

    const { data: planta, error: plantaError } = await service
      .from('plantas')
      .insert({
        codigo_sistema: `SPRINT1-${sufijo}`,
        especie_id: especie.id,
        estado: 'evaluacion_anual',
        es_prueba: true,
      })
      .select('id')
      .single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se creó planta de prueba');
    plantaSprintId = planta.id;

    const { data: individuo, error: individuoError } = await service
      .from('individuos')
      .insert({
        planta_id: plantaSprintId,
        codigo_display: 'GENERADO-POR-TRIGGER',
        created_by: operarioId,
        fecha_individualizacion: '2026-07-01',
      })
      .select('id, codigo_display')
      .single();
    if (individuoError || !individuo) throw individuoError ?? new Error('No se creó individuo de prueba');
    individuoSprintId = individuo.id;
    expect(individuo.codigo_display).toMatch(/-P\d+$/);

    const { data: ronda, error: rondaError } = await service
      .from('ronda_evaluacion_anual')
      .insert({
        individuo_id: individuoSprintId,
        numero_ronda: 1,
        anio: 2026,
        fecha_inicio: '2026-07-01',
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (rondaError || !ronda) throw rondaError ?? new Error('No se creó ronda de prueba');
    rondaSprintId = ronda.id;
  });

  it('conserva rangos heredados como provisionales en el catálogo visible', async () => {
    const { data, error } = await service
      .from('rango_referencia')
      .select('metrica, limite_revision_superior, nota')
      .in('metrica', ['brix', 'calibre_mm'])
      .eq('activo', true)
      .order('metrica');
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.find((r) => r.metrica === 'calibre_mm')!.limite_revision_superior).toBe(40);
    expect(data!.map((r) => r.nota)).toEqual([
      'Rango heredado del comportamiento anterior del sistema — pendiente de confirmación científica por Efraín',
      'Rango heredado del comportamiento anterior del sistema — pendiente de confirmación científica por Efraín',
    ]);
  });

  it('RLS permite leer rangos al operario, pero no modificarlos', async () => {
    const { data: visibles, error: lecturaError } = await operario
      .from('rango_referencia')
      .select('id, metrica');
    expect(lecturaError).toBeNull();
    expect(visibles!.length).toBeGreaterThanOrEqual(2);

    const { data: actualizados, error: updateError } = await operario
      .from('rango_referencia')
      .update({ nota: 'cambio no autorizado' })
      .eq('metrica', 'calibre_mm')
      .select('id');
    expect(updateError).toBeNull();
    expect(actualizados).toHaveLength(0);
  });

  it('un operario no puede atravesar individuos/evaluaciones para leer linaje', async () => {
    const { error: crearEvaluacion } = await operario.from('evaluaciones').insert({
      ronda_id: rondaSprintId,
      fecha: '2027-01-10',
      estado: 'completa',
      sin_muestra: true,
      created_by: operarioId,
    });
    expect(crearEvaluacion).toBeNull();

    const { error: porIndividuo } = await operario
      .from('individuos')
      .select('id, plantas(cruzamiento, mama, papa)')
      .eq('id', individuoSprintId)
      .single();
    expect(porIndividuo).toBeTruthy();

    const { error: porEvaluacion } = await operario
      .from('evaluaciones')
      .select('id, ronda_evaluacion_anual(individuos(plantas(cruzamiento, mama, papa)))')
      .eq('ronda_id', rondaSprintId)
      .limit(1);
    expect(porEvaluacion).toBeTruthy();
  });

  it('guarda Brix/calibre fuera del esperado, deriva año, promedio y revisión desde catálogo', async () => {
    const { data, error } = await operario
      .from('evaluaciones')
      .insert({
        ronda_id: rondaSprintId,
        fecha: '2027-01-15',
        anio: 1999,
        estado: 'completa',
        calibre_mm: 40,
        brix: 25,
        cantidad_frutos: 10,
        peso_total_g: 125,
        created_by: operarioId,
      })
      .select('anio, calibre_mm, brix, requiere_revision, peso_promedio_g')
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      anio: 2027,
      calibre_mm: 40,
      brix: 25,
      requiere_revision: true,
      peso_promedio_g: 12.5,
    });
  });

  it('rechaza valores negativos y permite múltiples evaluaciones cerradas por ronda', async () => {
    const { error: negativo } = await operario.from('evaluaciones').insert({
      ronda_id: rondaSprintId,
      fecha: '2027-01-16',
      estado: 'borrador',
      calibre_mm: -1,
      created_by: operarioId,
    });
    expect(negativo).toBeTruthy();

    const { error: primera } = await operario.from('evaluaciones').insert({
      ronda_id: rondaSprintId,
      fecha: '2027-01-17',
      estado: 'completa',
      sin_muestra: true,
      created_by: operarioId,
    });
    const { error: segunda } = await operario.from('evaluaciones').insert({
      ronda_id: rondaSprintId,
      fecha: '2027-01-18',
      estado: 'completa',
      sin_muestra: true,
      created_by: operarioId,
    });
    expect(primera).toBeNull();
    expect(segunda).toBeNull();
  });

  it('permite cerrar con solo fenologia cuando la visita no tuvo muestra', async () => {
    const { data, error } = await operario
      .from('evaluaciones')
      .insert({
        ronda_id: rondaSprintId,
        fecha: '2027-02-01',
        estado: 'completa',
        sin_muestra: true,
        brotacion: 4,
        floracion: 3,
        cuaja: 2,
        concentracion_cosecha: 1,
        created_by: operarioId,
      })
      .select('estado, sin_muestra, cantidad_frutos, peso_total_g, brotacion, floracion, cuaja, concentracion_cosecha')
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      estado: 'completa',
      sin_muestra: true,
      cantidad_frutos: null,
      peso_total_g: null,
      brotacion: 4,
      floracion: 3,
      cuaja: 2,
      concentracion_cosecha: 1,
    });
  });

  it('si hay muestra exige frutos y peso, y conserva el flujo completo anterior', async () => {
    // Fase 2 (regla de frutos): la exigencia nace de un dato de fruta; sin
    // ninguno la evaluación finaliza (tests/rls/fase2/regla-frutos.test.ts).
    const { error: sinFrutos } = await operario.from('evaluaciones').insert({
      ronda_id: rondaSprintId,
      fecha: '2027-02-02',
      estado: 'completa',
      calibre_mm: 18,
      created_by: operarioId,
    });
    expect(sinFrutos).toBeTruthy();
    expect(sinFrutos!.message).toMatch(/Cantidad de frutos/i);

    const { error: sinPeso } = await operario.from('evaluaciones').insert({
      ...evaluacionCompleta('2027-02-03'),
      peso_total_g: null,
    });
    expect(sinPeso).toBeTruthy();
    expect(sinPeso!.message).toMatch(/Peso total/i);

    const { error: ceroConPeso } = await operario.from('evaluaciones').insert({
      ...evaluacionCompleta('2027-02-04'),
      cantidad_frutos: 0,
      peso_total_g: 100,
    });
    expect(ceroConPeso).toBeTruthy();

    const { data: completa, error: completaError } = await operario
      .from('evaluaciones')
      .insert(evaluacionCompleta('2027-02-05'))
      .select('estado, sin_muestra, cantidad_frutos, peso_total_g, peso_promedio_g')
      .single();
    expect(completaError).toBeNull();
    expect(completa).toMatchObject({
      estado: 'completa',
      sin_muestra: false,
      cantidad_frutos: 10,
      peso_total_g: 125,
      peso_promedio_g: 12.5,
    });
  });

  it('un operario finaliza su borrador pero no puede editarlo después de cerrado', async () => {
    const { data: borrador, error: crearError } = await operario
      .from('evaluaciones')
      .insert({
        ronda_id: rondaSprintId,
        fecha: '2027-03-01',
        estado: 'borrador',
        created_by: operarioId,
      })
      .select('id')
      .single();
    expect(crearError).toBeNull();

    const { data: cerrada, error: cerrarError } = await operario
      .from('evaluaciones')
      .update(evaluacionCompleta('2027-03-01'))
      .eq('id', borrador!.id)
      .select('id, estado')
      .single();
    expect(cerrarError).toBeNull();
    expect(cerrada!.estado).toBe('completa');

    const { data: editadas, error: editarError } = await operario
      .from('evaluaciones')
      .update({ observaciones: 'edición no autorizada' })
      .eq('id', borrador!.id)
      .select('id');
    expect(editarError).toBeNull();
    expect(editadas).toHaveLength(0);

    const { error: anularError } = await admin
      .from('evaluaciones')
      .update({ estado: 'anulada', motivo_cambio: 'Dato de prueba anulado' })
      .eq('id', borrador!.id);
    expect(anularError).toBeNull();
    const audit = await ultimaAuditoria('cambio_estado_evaluacion');
    expect(audit.detalle.motivo).toBe('Dato de prueba anulado');
  });

  it('impide cambiar cruce, código o fecha de identidad y nunca permite hard-delete', async () => {
    const { data: identidadEditada, error: identidadError } = await operario
      .from('individuos')
      .update({ fecha_individualizacion: '2026-07-02' })
      .eq('id', individuoSprintId)
      .select('id');
    expect(identidadError).toBeTruthy();
    expect(identidadEditada).toBeNull();

    const { data: eliminados, error: deleteError } = await operario
      .from('individuos')
      .delete()
      .eq('id', individuoSprintId)
      .select('id');
    expect(deleteError).toBeTruthy();
    expect(eliminados).toBeNull();
  });
});

// ===========================================================================
// SPRINT 2 / BLOQUE E — scoring, ranking y snapshots reproducibles
// ===========================================================================
describe('scoring versionado, ranking seguro y snapshots', () => {
  const sufijo = Date.now();
  let especieAId: string;
  let especieBId: string;
  let plantaAId: string;
  let plantaBId: string;
  let individuoElegibleId: string;
  let individuoBorradorId: string;
  let individuoAnuladoId: string;
  let individuoRevisionId: string;
  let individuoNoComparableId: string;
  let individuoOtraEspecieId: string;
  let rondaElegible2Id: string;
  let snapshotId: string;
  let snapshotAntes: Array<Record<string, unknown>>;

  const camposCompletos = (override: Record<string, unknown> = {}) => ({
    estado: 'completa',
    cantidad_frutos: 10,
    peso_total_g: 100,
    brotacion: 3,
    floracion: 3,
    cuaja: 3,
    concentracion_cosecha: 3,
    calibre_mm: 19,
    firmeza: 3,
    color: 3,
    bloom: 3,
    brix: 14,
    rend_kg_planta: 5,
    rend_t_ha: 10,
    pct_fruta_exportable: 80,
    dano_calor: 1,
    golpe_sol: 1,
    caida_fruto: 1,
    // Descriptores de Fase 5 (20260922225105): sin ellos la versión de 20
    // métricas deja la ronda en evaluacion_parcial_en_curso.
    presencia_yemas_florales: 3,
    precocidad: 3,
    vigor_vegetativo: 5,
    color_follaje: 5,
    n_varas_basales: 10, // pct_flores = 10/10 = 100 %
    n_varas_con_flor: 10,
    n_flores_varas_basales: 20, // pct_frutos = 20/20 = 100 %
    n_frutos_varas_basales: 20,
    created_by: operarioId,
    ...override,
  });

  /**
   * Normalizados a mano de camposCompletos (dominios de la versión activa):
   * fenología 1-5 → (3-1)/4 = 0.5 para brotación, floración, cuaja,
   * concentración y precocidad; presencia_yemas_florales 0-5 → 3/5 = 0.6.
   * Producción: rend_kg_planta 1-5 → 5 → 1; rend_t_ha 1-5 → 10 → 1 (recortado);
   * pct_fruta_exportable 0-100 → 0.8; pct_flores y pct_frutos 0-100 → 1.
   * Estrés: daño, golpe y caída (dirección menor, 1-5) → (5-1)/4 = 1; vigor y
   * color de follaje (mayor) → 5 → 1.
   * Subpuntajes: fenología = (0.5·0.167 + 0.6·0.033)/0.2 = 0.1033/0.2 = 0.5165;
   * producción = (1+1+0.8+1+1)·0.06/0.30 = 0.96; estrés = 1.
   */
  const normalizadosBase = {
    brotacion: 0.5, floracion: 0.5, cuaja: 0.5, concentracion_cosecha: 0.5,
    presencia_yemas_florales: 0.6, precocidad: 0.5,
    rend_kg_planta: 1, rend_t_ha: 1, pct_fruta_exportable: 0.8, pct_flores: 1, pct_frutos: 1,
    dano_calor: 1, golpe_sol: 1, caida_fruto: 1, vigor_vegetativo: 1, color_follaje: 1,
  };
  // Fruto/calidad al máximo (firmeza 5, calibre 24 en 14-24, brix 18 en 10-18,
  // bloom 5): subpuntaje 1. Puntaje = 0.5165·0.2 + 1·0.4 + 0.96·0.3 + 1·0.1 = 0.8913.
  const puntajeFrutoMaximo = puntajeEsperado({ ...normalizadosBase, firmeza: 1, calibre_mm: 1, brix: 1, bloom: 1 });
  // Fruto/calidad al mínimo (firmeza 1, calibre 14, brix 10, bloom 1): subpuntaje 0.
  // Puntaje = 0.5165·0.2 + 0 + 0.96·0.3 + 1·0.1 = 0.4913.
  const puntajeFrutoMinimo = puntajeEsperado({ ...normalizadosBase, firmeza: 0, calibre_mm: 0, brix: 0, bloom: 0 });

  async function crearPlanta(especieId: string, codigo: string) {
    const { data, error } = await service
      .from('plantas')
      .insert({ codigo_sistema: codigo, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true })
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('No se creó planta para ranking');
    return data.id as string;
  }

  async function crearIndividuo(plantaIdLocal: string) {
    const { data, error } = await service
      .from('individuos')
      .insert({
        planta_id: plantaIdLocal,
        codigo_display: 'GENERADO-POR-TRIGGER',
        created_by: operarioId,
        fecha_individualizacion: '2026-07-01',
      })
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('No se creó individuo para ranking');
    return data.id as string;
  }

  async function crearRonda(individuoId: string, numero: number) {
    const { data, error } = await service
      .from('ronda_evaluacion_anual')
      .insert({
        individuo_id: individuoId,
        numero_ronda: numero,
        anio: 2027,
        fecha_inicio: `2027-0${numero}-01`,
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('No se creó ronda para ranking');
    return data.id as string;
  }

  async function insertarEvaluacion(rondaId: string, fecha: string, override: Record<string, unknown> = {}) {
    const { data, error } = await operario
      .from('evaluaciones')
      .insert({ ronda_id: rondaId, fecha, ...camposCompletos(override) })
      .select('id, requiere_revision, updated_at')
      .single();
    if (error || !data) throw error ?? new Error('No se creó evaluación para ranking');
    return data as { id: string; requiere_revision: boolean; updated_at: string };
  }

  beforeAll(async () => {
    const { data: especieA, error: errorA } = await service
      .from('especies')
      .insert({ nombre: `Ranking A ${sufijo}` })
      .select('id')
      .single();
    const { data: especieB, error: errorB } = await service
      .from('especies')
      .insert({ nombre: `Ranking B ${sufijo}` })
      .select('id')
      .single();
    if (errorA || errorB || !especieA || !especieB) throw errorA ?? errorB ?? new Error('No se crearon especies');
    especieAId = especieA.id;
    especieBId = especieB.id;

    plantaAId = await crearPlanta(especieAId, `RANK-A-${sufijo}`);
    plantaBId = await crearPlanta(especieBId, `RANK-B-${sufijo}`);

    individuoElegibleId = await crearIndividuo(plantaAId);
    individuoBorradorId = await crearIndividuo(plantaAId);
    individuoAnuladoId = await crearIndividuo(plantaAId);
    individuoRevisionId = await crearIndividuo(plantaAId);
    individuoNoComparableId = await crearIndividuo(plantaAId);
    individuoOtraEspecieId = await crearIndividuo(plantaBId);

    const rondaElegible1 = await crearRonda(individuoElegibleId, 1);
    rondaElegible2Id = await crearRonda(individuoElegibleId, 2);
    await insertarEvaluacion(rondaElegible1, '2027-01-10', {
      firmeza: 1, calibre_mm: 14, brix: 10, bloom: 1,
    });
    await insertarEvaluacion(rondaElegible2Id, '2027-02-10', {
      firmeza: 3, calibre_mm: 19, brix: 14, bloom: 3,
    });
    // Misma fecha: updated_at de esta segunda completa debe desempatar.
    await insertarEvaluacion(rondaElegible2Id, '2027-02-10', {
      firmeza: 5, calibre_mm: 24, brix: 18, bloom: 5,
    });
    await operario.from('evaluaciones').insert({
      ronda_id: rondaElegible2Id,
      fecha: '2027-03-01',
      estado: 'borrador',
      created_by: operarioId,
    });

    const rondaBorrador = await crearRonda(individuoBorradorId, 1);
    await operario.from('evaluaciones').insert({
      ronda_id: rondaBorrador,
      fecha: '2027-01-01',
      estado: 'borrador',
      created_by: operarioId,
    });

    const rondaAnulado = await crearRonda(individuoAnuladoId, 1);
    const evaluacionAnulada = await insertarEvaluacion(rondaAnulado, '2027-01-02');
    const { error: anularError } = await admin
      .from('evaluaciones')
      .update({ estado: 'anulada', motivo_cambio: 'Anulada para prueba de ranking' })
      .eq('id', evaluacionAnulada.id);
    if (anularError) throw anularError;

    const rondaRevision = await crearRonda(individuoRevisionId, 1);
    const revision = await insertarEvaluacion(rondaRevision, '2027-01-03', { calibre_mm: 40 });
    expect(revision.requiere_revision).toBe(true);

    const rondaNoComparable = await crearRonda(individuoNoComparableId, 1);
    await insertarEvaluacion(rondaNoComparable, '2027-01-04', { no_comparable: true });

    const rondaOtraEspecie = await crearRonda(individuoOtraEspecieId, 1);
    await insertarEvaluacion(rondaOtraEspecie, '2027-01-05', {
      firmeza: 5, calibre_mm: 24, brix: 18, bloom: 5,
    });
  }, 60_000);

  it('expone una versión activa y sus pesos desde tablas configurables', async () => {
    const { data: versiones, error: errorVersion } = await operario
      .from('scoring_version')
      .select('id, nombre, estado, nota')
      .eq('estado', 'activa')
      .is('especie_id', null)
      .eq('fase', 'evaluacion_anual');
    expect(errorVersion).toBeNull();
    expect(versiones).toHaveLength(1);
    expect(versiones![0].nombre).toContain('provisional (4-3-2-1)');
    expect(versiones![0].nota).toContain('pendientes de validación científica por Efraín');

    const { data: metricas, error: errorMetricas } = await operario
      .from('scoring_metrica')
      .select('metrica, peso, metodo_normalizacion')
      .eq('scoring_version_id', versiones![0].id)
      .order('orden');
    expect(errorMetricas).toBeNull();
    // Fase 5 agrega 6 metricas y redistribuye pesos dentro de
    // Fenologia/Produccion/Estres sin cambiar el peso global de cada
    // categoria (ver 20260922225105_configurar_scoring_descriptores_fenotipicos.sql).
    // fruto_calidad (firmeza/calibre_mm/brix/bloom) queda identica.
    expect(metricas!.map((metrica) => [metrica.metrica, metrica.peso])).toEqual([
      ['firmeza', 4],
      ['calibre_mm', 3],
      ['brix', 2],
      ['bloom', 1],
      ['brotacion', 0.034],
      ['floracion', 0.034],
      ['cuaja', 0.033],
      ['concentracion_cosecha', 0.033],
      ['rend_kg_planta', 0.06],
      ['rend_t_ha', 0.06],
      ['pct_fruta_exportable', 0.06],
      ['dano_calor', 0.02],
      ['golpe_sol', 0.02],
      ['caida_fruto', 0.02],
      ['presencia_yemas_florales', 0.033],
      ['precocidad', 0.033],
      ['vigor_vegetativo', 0.02],
      ['color_follaje', 0.02],
      ['pct_flores', 0.06],
      ['pct_frutos', 0.06],
    ]);
  });

  it('usa la última completa de la ronda más reciente y desempata por updated_at', async () => {
    const { data, error } = await operario.rpc('obtener_ranking_operativo', {
      p_planta_id: plantaAId,
      p_limite: 25,
      p_offset: 0,
      p_orden: 'puntaje_desc',
    });
    expect(error).toBeNull();
    const ranking = data as unknown as {
      items: Array<Record<string, unknown>>;
      poblacion_comparada: number;
      scoring_version_nombre: string;
    };
    const elegible = ranking.items.find((item) => item.individuo_id === individuoElegibleId)!;
    expect(elegible.numero_ronda).toBe(2);
    expect(elegible.fecha_evaluacion).toBe('2027-02-10');
    // Cálculo a mano (ver normalizadosBase) y con la función independiente.
    expect(puntajeFrutoMaximo).toBe(0.8913);
    expect(elegible.puntaje_ponderado).toBe(puntajeFrutoMaximo);
    expect(elegible.posicion).toBe(1);
    expect(ranking.poblacion_comparada).toBe(1);
    expect(ranking.scoring_version_nombre).toContain('provisional');
  });

  it('excluye borradores, anuladas, revisión y no comparables explicando el motivo', async () => {
    const { data, error } = await operario.rpc('obtener_ranking_operativo', {
      p_planta_id: plantaAId,
      p_limite: 25,
      p_offset: 0,
      p_orden: 'codigo_asc',
    });
    expect(error).toBeNull();
    const items = (data as unknown as { items: Array<Record<string, unknown>> }).items;
    const porId = new Map(items.map((item) => [item.individuo_id, item]));
    expect(porId.get(individuoBorradorId)!.motivo_exclusion).toBe('sin_evaluacion_completa_en_ronda_actual');
    expect(porId.get(individuoAnuladoId)!.motivo_exclusion).toBe('sin_evaluacion_completa_en_ronda_actual');
    expect(porId.get(individuoRevisionId)!.motivo_exclusion).toBe('requiere_revision');
    expect(porId.get(individuoNoComparableId)!.motivo_exclusion).toBe('no_comparable');
  });

  it('exige filtro global por especie, pagina y rechaza órdenes no permitidos', async () => {
    const { error: sinFiltro } = await operario.rpc('obtener_ranking_operativo', {
      p_limite: 5,
      p_offset: 0,
      p_orden: 'puntaje_desc',
    });
    expect(sinFiltro).toBeTruthy();

    const { data, error } = await operario.rpc('obtener_ranking_operativo', {
      p_especie_id: especieAId,
      p_limite: 1,
      p_offset: 0,
      p_orden: 'puntaje_desc',
    });
    expect(error).toBeNull();
    const ranking = data as unknown as { items: Array<Record<string, unknown>>; total: number; limite: number };
    expect(ranking.items).toHaveLength(1);
    expect(ranking.total).toBe(5);
    expect(ranking.limite).toBe(1);
    expect(ranking.items.every((item) => item.especie_id === especieAId)).toBe(true);
    expect(ranking.items.every((item) => item.individuo_id !== individuoOtraEspecieId)).toBe(true);

    const { error: ordenInvalido } = await operario.rpc('obtener_ranking_operativo', {
      p_especie_id: especieAId,
      p_limite: 5,
      p_offset: 0,
      p_orden: 'drop table',
    });
    expect(ordenInvalido).toBeTruthy();
  });

  it('el payload de ranking no expone linaje', async () => {
    const { data, error } = await operario.rpc('obtener_ranking_operativo', {
      p_planta_id: plantaAId,
      p_limite: 25,
      p_offset: 0,
      p_orden: 'puntaje_desc',
    });
    expect(error).toBeNull();
    const serializado = JSON.stringify(data);
    expect(serializado).not.toMatch(/"(?:cruzamiento|mama|papa)":/);
    const items = (data as { items: Array<Record<string, unknown>> }).items;
    for (const item of items) {
      expect(Object.keys(item)).not.toEqual(
        expect.arrayContaining(['cruzamiento', 'mama', 'papa']),
      );
    }
  });

  it('solo admin congela y el snapshot conserva versión, evaluación y resultados', async () => {
    const { error: operarioError } = await operario.rpc('congelar_ranking', {
      p_nombre: 'No autorizado',
      p_planta_id: plantaAId,
    });
    expect(operarioError).toBeTruthy();

    const { data, error } = await admin.rpc('congelar_ranking', {
      p_nombre: `Snapshot de prueba · cruzamiento · ${new Date().toISOString().slice(0, 10)} · ${sufijo}`,
      p_planta_id: plantaAId,
    });
    expect(error).toBeNull();
    snapshotId = data as string;

    const { data: cabecera } = await operario
      .from('ranking_snapshot')
      .select('id, alcance, scoring_version_id, poblacion_comparada, criterios')
      .eq('id', snapshotId)
      .single();
    expect(cabecera!.alcance).toBe('cruzamiento');
    expect(cabecera!.poblacion_comparada).toBe(1);
    expect(cabecera!.scoring_version_id).toBeTruthy();

    const { data: resultados } = await operario
      .from('ranking_snapshot_resultado')
      .select('individuo_id, evaluacion_id, posicion, puntaje, detalle')
      .eq('snapshot_id', snapshotId)
      .order('posicion');
    snapshotAntes = resultados as unknown as Array<Record<string, unknown>>;
    expect(snapshotAntes).toHaveLength(1);
    expect(snapshotAntes[0].individuo_id).toBe(individuoElegibleId);
    expect(snapshotAntes[0].puntaje).toBe(puntajeFrutoMaximo);

    const audit = await ultimaAuditoria('congelacion_ranking');
    expect(audit.detalle.snapshot_id).toBe(snapshotId);
  });

  it('el snapshot no cambia al agregar una evaluación posterior', async () => {
    await insertarEvaluacion(rondaElegible2Id, '2027-04-01', {
      firmeza: 1, calibre_mm: 14, brix: 10, bloom: 1,
    });

    const { data: rankingVivo, error: rankingError } = await operario.rpc('obtener_ranking_operativo', {
      p_planta_id: plantaAId,
      p_limite: 25,
      p_offset: 0,
      p_orden: 'puntaje_desc',
    });
    expect(rankingError).toBeNull();
    const itemVivo = (rankingVivo as unknown as { items: Array<Record<string, unknown>> }).items
      .find((item) => item.individuo_id === individuoElegibleId)!;
    // La evaluación posterior deja fruto/calidad al mínimo: 0.4913 (ver arriba).
    expect(puntajeFrutoMinimo).toBe(0.4913);
    expect(itemVivo.puntaje_ponderado).toBe(puntajeFrutoMinimo);

    const { data: snapshotDespues } = await operario
      .from('ranking_snapshot_resultado')
      .select('individuo_id, evaluacion_id, posicion, puntaje, detalle')
      .eq('snapshot_id', snapshotId)
      .order('posicion');
    expect(snapshotDespues).toEqual(snapshotAntes);

    const { data: editados, error: editarError } = await admin
      .from('ranking_snapshot_resultado')
      .update({ puntaje: 999 })
      .eq('snapshot_id', snapshotId)
      .select('snapshot_id');
    if (editarError) expect(editarError).toBeTruthy();
    else expect(editados).toHaveLength(0);
  });
});

// =============================================================================
// SPRINT 3 / BLOQUE B — territorio e historial de emplazamientos
// =============================================================================

describe('territorio: jerarquía, historial append-only y coordenadas protegidas', () => {
  const sufijo = Date.now();
  let individuoTerritorialId: string;
  let plantaTerritorialId: string;
  let sitioId: string;
  let predioAId: string;
  let predioBId: string;
  let sectorAId: string;
  let sectorBId: string;
  let primerEmplazamientoId: string;

  beforeAll(async () => {
    const { data: especie, error: especieError } = await service
      .from('especies')
      .select('id')
      .limit(1)
      .single();
    if (especieError || !especie) throw especieError ?? new Error('Sin especie para fixture territorial');

    const { data: sitio, error: sitioError } = await admin
      .from('sitio')
      .insert({ nombre: `Sitio operativo ${sufijo}`, created_by: adminId })
      .select('id')
      .single();
    if (sitioError || !sitio) throw sitioError ?? new Error('No se creó sitio');
    sitioId = sitio.id;

    const { data: predios, error: prediosError } = await admin
      .from('predio')
      .insert([
        { nombre: `Predio A ${sufijo}`, sitio_id: sitioId },
        { nombre: `Predio B ${sufijo}`, sitio_id: sitioId },
      ])
      .select('id, nombre');
    if (prediosError || !predios) throw prediosError ?? new Error('No se crearon predios');
    predioAId = predios.find((predio) => predio.nombre.startsWith('Predio A'))!.id;
    predioBId = predios.find((predio) => predio.nombre.startsWith('Predio B'))!.id;

    const { data: sectores, error: sectoresError } = await admin
      .from('sector')
      .insert([
        { nombre: `Sector A ${sufijo}`, predio_id: predioAId, created_by: adminId },
        { nombre: `Sector B ${sufijo}`, predio_id: predioBId, created_by: adminId },
      ])
      .select('id, nombre');
    if (sectoresError || !sectores) throw sectoresError ?? new Error('No se crearon sectores');
    sectorAId = sectores.find((sector) => sector.nombre.startsWith('Sector A'))!.id;
    sectorBId = sectores.find((sector) => sector.nombre.startsWith('Sector B'))!.id;

    const { data: planta, error: plantaError } = await service
      .from('plantas')
      .insert({
        codigo_sistema: `TERR-${sufijo}`,
        especie_id: especie.id,
        estado: 'traslado_destino',
        es_prueba: true,
      })
      .select('id')
      .single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se creó cruce territorial');
    plantaTerritorialId = planta.id;

    const { data: individuo, error: individuoError } = await service
      .from('individuos')
      .insert({
        planta_id: plantaTerritorialId,
        codigo_display: `TERR-${sufijo}-P01`,
        estado_vital: 'vivo',
        created_by: adminId,
      })
      .select('id')
      .single();
    if (individuoError || !individuo) throw individuoError ?? new Error('No se creó individuo territorial');
    individuoTerritorialId = individuo.id;
  }, 60_000);

  it('conserva la jerarquía sitio → predio → sector y el operario puede leerla', async () => {
    const { data, error } = await operario
      .from('sector')
      .select('id, nombre, predio:predio_id(id, nombre, sitio:sitio_id(id, nombre))')
      .in('id', [sectorAId, sectorBId]);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.every((sector) => sector.predio?.sitio?.id === sitioId)).toBe(true);
  });

  it('por decisión conservadora, operario no registra traslados y admin sí', async () => {
    const { error: errorOperario } = await operario.rpc('registrar_traslado_individuo', {
      p_individuo_id: individuoTerritorialId,
      p_sector_id: sectorAId,
      p_fecha_inicio: '2027-01-10',
      p_referencia_operativa: 'Bloque norte',
    });
    expect(errorOperario).toBeTruthy();

    const { data, error } = await admin.rpc('registrar_traslado_individuo', {
      p_individuo_id: individuoTerritorialId,
      p_sector_id: sectorAId,
      p_fecha_inicio: '2027-01-10',
      p_referencia_operativa: 'Bloque norte',
      p_latitud: -35.4261,
      p_longitud: -71.6654,
      p_precision_metros: 3,
      p_ubicacion_exacta: 'Hilera 4, posición 12',
    });
    expect(error).toBeNull();
    primerEmplazamientoId = data as string;
  });

  it('la base impide dos emplazamientos activos incluso usando service_role', async () => {
    const { error } = await service.from('emplazamiento_individuo').insert({
      individuo_id: individuoTerritorialId,
      sector_id: sectorBId,
      fecha_inicio: '2027-01-11',
      created_by: adminId,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/emplazamiento_individuo_un_activo|duplicate key/i);
  });

  it('operario ve ubicación agregada pero no puede leer coordenadas exactas', async () => {
    const { data: agregado, error: agregadoError } = await operario
      .from('emplazamiento_individuo')
      .select('id, individuo_id, sector_id, fecha_inicio, fecha_fin')
      .eq('id', primerEmplazamientoId)
      .single();
    expect(agregadoError).toBeNull();
    expect(agregado!.sector_id).toBe(sectorAId);

    const { data: exacta, error: exactaError } = await operario
      .from('emplazamiento_coordenada')
      .select('emplazamiento_id, latitud, longitud, precision_metros, ubicacion_exacta')
      .eq('emplazamiento_id', primerEmplazamientoId);
    expect(exactaError).toBeNull();
    expect(exacta).toHaveLength(0);

    const { error: referenciaError } = await operario
      .from('emplazamiento_individuo')
      .select('referencia_operativa')
      .eq('id', primerEmplazamientoId);
    expect(referenciaError).toBeTruthy();

    const { data: exactaAdmin, error: exactaAdminError } = await admin
      .from('emplazamiento_coordenada')
      .select('latitud, longitud, precision_metros, ubicacion_exacta')
      .eq('emplazamiento_id', primerEmplazamientoId)
      .single();
    expect(exactaAdminError).toBeNull();
    expect(exactaAdmin).toMatchObject({
      latitud: -35.4261,
      longitud: -71.6654,
      precision_metros: 3,
      ubicacion_exacta: 'Hilera 4, posición 12',
    });
  });

  it('trasladar cierra el activo y crea una fila nueva sin sobrescribir historial', async () => {
    const { data: segundoId, error } = await admin.rpc('registrar_traslado_individuo', {
      p_individuo_id: individuoTerritorialId,
      p_sector_id: sectorBId,
      p_fecha_inicio: '2027-02-01',
      p_referencia_operativa: 'Bloque sur',
    });
    expect(error).toBeNull();
    expect(segundoId).not.toBe(primerEmplazamientoId);

    const { data: historial, error: historialError } = await operario
      .from('emplazamiento_individuo')
      .select('id, sector_id, fecha_inicio, fecha_fin')
      .eq('individuo_id', individuoTerritorialId)
      .order('fecha_inicio');
    expect(historialError).toBeNull();
    expect(historial).toEqual([
      { id: primerEmplazamientoId, sector_id: sectorAId, fecha_inicio: '2027-01-10', fecha_fin: '2027-02-01' },
      { id: segundoId, sector_id: sectorBId, fecha_inicio: '2027-02-01', fecha_fin: null },
    ]);
  });

  it('un retorno crea un tercer emplazamiento y no reutiliza el primero', async () => {
    const { data: retornoId, error } = await admin.rpc('registrar_traslado_individuo', {
      p_individuo_id: individuoTerritorialId,
      p_sector_id: sectorAId,
      p_fecha_inicio: '2027-03-15',
      p_referencia_operativa: 'Retorno estacional',
    });
    expect(error).toBeNull();
    expect(retornoId).not.toBe(primerEmplazamientoId);

    const { data: historial } = await operario
      .from('emplazamiento_individuo')
      .select('id, sector_id, fecha_inicio, fecha_fin')
      .eq('individuo_id', individuoTerritorialId)
      .order('fecha_inicio');
    expect(historial).toHaveLength(3);
    expect(historial![0]).toMatchObject({ id: primerEmplazamientoId, sector_id: sectorAId });
    expect(historial![2]).toMatchObject({ id: retornoId, sector_id: sectorAId, fecha_fin: null });
  });

  it('ni operario ni admin pueden editar o borrar directamente el historial', async () => {
    const { data: editadoOperario, error: editarOperarioError } = await operario
      .from('emplazamiento_individuo')
      .update({ referencia_operativa: 'Alteración' })
      .eq('id', primerEmplazamientoId)
      .select('id');
    if (editarOperarioError) expect(editarOperarioError).toBeTruthy();
    else expect(editadoOperario).toHaveLength(0);

    const { error: editarAdminError } = await admin
      .from('emplazamiento_individuo')
      .update({ sector_id: sectorBId })
      .eq('id', primerEmplazamientoId);
    expect(editarAdminError).toBeTruthy();

    const { error: borrarAdminError } = await admin
      .from('emplazamiento_individuo')
      .delete()
      .eq('id', primerEmplazamientoId);
    expect(borrarAdminError).toBeTruthy();

    const { error: sobrescribirServiceError } = await service
      .from('emplazamiento_individuo')
      .update({ sector_id: sectorBId })
      .eq('id', primerEmplazamientoId);
    expect(sobrescribirServiceError).toBeTruthy();
    expect(sobrescribirServiceError!.message).toMatch(/append-only/i);

    const { error: borrarServiceError } = await service
      .from('emplazamiento_individuo')
      .delete()
      .eq('id', primerEmplazamientoId);
    expect(borrarServiceError).toBeTruthy();
    expect(borrarServiceError!.message).toMatch(/no se eliminan/i);
  });

  it('cada alta y traslado queda auditado sin exponer coordenadas', async () => {
    const audit = await ultimaAuditoria('traslado_individuo');
    expect(audit.usuario_id).toBe(adminId);
    expect(audit.planta_id).toBe(plantaTerritorialId);
    expect(audit.detalle.individuo_id).toBe(individuoTerritorialId);
    expect(JSON.stringify(audit.detalle)).not.toMatch(/latitud|longitud|ubicacion_exacta/);
  });
});

// =============================================================================
// SPRINT 4 / BLOQUE C — procedimientos multiobjetivo y reasignación
// =============================================================================

describe('procedimientos: objetivos múltiples, contexto multisitio y responsables', () => {
  const sufijo = Date.now();
  let plantaProcedimientoId: string;
  let predioAId: string;
  let predioBId: string;
  let sectorAId: string;
  let sectorBId: string;
  let individuoAId: string;
  let individuoBId: string;
  let procedimientoId: string;

  beforeAll(async () => {
    const { data: especie, error: especieError } = await service.from('especies').select('id').limit(1).single();
    if (especieError || !especie) throw especieError ?? new Error('Sin especie para procedimiento');
    const { data: sitio, error: sitioError } = await admin
      .from('sitio')
      .insert({ nombre: `Sitio procedimientos ${sufijo}`, created_by: adminId })
      .select('id')
      .single();
    if (sitioError || !sitio) throw sitioError ?? new Error('Sin sitio de procedimiento');

    const { data: predios, error: prediosError } = await admin
      .from('predio')
      .insert([
        { nombre: `Predio procedimiento A ${sufijo}`, sitio_id: sitio.id },
        { nombre: `Predio procedimiento B ${sufijo}`, sitio_id: sitio.id },
      ])
      .select('id, nombre');
    if (prediosError || !predios) throw prediosError ?? new Error('Sin predios de procedimiento');
    predioAId = predios.find((predio) => predio.nombre.startsWith('Predio procedimiento A'))!.id;
    predioBId = predios.find((predio) => predio.nombre.startsWith('Predio procedimiento B'))!.id;

    const { data: sectores, error: sectoresError } = await admin
      .from('sector')
      .insert([
        { nombre: `Sector procedimiento A ${sufijo}`, predio_id: predioAId, created_by: adminId },
        { nombre: `Sector procedimiento B ${sufijo}`, predio_id: predioBId, created_by: adminId },
      ])
      .select('id, nombre');
    if (sectoresError || !sectores) throw sectoresError ?? new Error('Sin sectores de procedimiento');
    sectorAId = sectores.find((sector) => sector.nombre.startsWith('Sector procedimiento A'))!.id;
    sectorBId = sectores.find((sector) => sector.nombre.startsWith('Sector procedimiento B'))!.id;

    const { data: planta, error: plantaError } = await service
      .from('plantas')
      .insert({ codigo_sistema: `PROC-${sufijo}`, especie_id: especie.id, estado: 'traslado_destino', es_prueba: true })
      .select('id')
      .single();
    if (plantaError || !planta) throw plantaError ?? new Error('Sin cruce para procedimiento');
    plantaProcedimientoId = planta.id;

    const { data: individuos, error: individuosError } = await service
      .from('individuos')
      .insert([
        { planta_id: plantaProcedimientoId, codigo_display: `PROC-${sufijo}-P01`, created_by: adminId },
        { planta_id: plantaProcedimientoId, codigo_display: `PROC-${sufijo}-P02`, created_by: adminId },
      ])
      .select('id, codigo_display');
    if (individuosError || !individuos) throw individuosError ?? new Error('Sin individuos de procedimiento');
    individuoAId = individuos.find((individuo) => individuo.codigo_display.endsWith('P1'))!.id;
    individuoBId = individuos.find((individuo) => individuo.codigo_display.endsWith('P2'))!.id;

    const [emplazamientoA, emplazamientoB] = await Promise.all([
      admin.rpc('registrar_traslado_individuo', { p_individuo_id: individuoAId, p_sector_id: sectorAId, p_fecha_inicio: '2027-04-01' }),
      admin.rpc('registrar_traslado_individuo', { p_individuo_id: individuoBId, p_sector_id: sectorBId, p_fecha_inicio: '2027-04-01' }),
    ]);
    if (emplazamientoA.error || emplazamientoB.error) throw emplazamientoA.error ?? emplazamientoB.error;
  }, 60_000);

  const objetivosMultisitio = () => [
    { tipo: 'cruzamiento', id: plantaProcedimientoId },
    { tipo: 'predio', id: predioAId },
  ];

  it('operario crea un procedimiento con múltiples objetivos sin duplicar el procedimiento', async () => {
    const { data, error } = await operario.rpc('crear_procedimiento', {
      p_nombre: 'Aplicación sector A',
      p_tipo: 'aplicacion',
      p_fecha_inicio: '2027-04-02',
      p_objetivos: objetivosMultisitio(),
      p_insumos: [],
    });
    expect(error).toBeNull();
    procedimientoId = data as string;

    const { data: procedimientos, error: procedimientosError } = await operario
      .from('procedimientos')
      .select('id, nombre, responsable_id, created_by, estado')
      .eq('id', procedimientoId);
    expect(procedimientosError).toBeNull();
    expect(procedimientos).toEqual([
      expect.objectContaining({ id: procedimientoId, responsable_id: operarioId, created_by: operarioId, estado: 'planificado' }),
    ]);

    const { data: objetivos, error: objetivosError } = await operario
      .from('procedimiento_objetivos')
      .select('tipo, planta_id, predio_id')
      .eq('procedimiento_id', procedimientoId)
      .order('tipo');
    expect(objetivosError).toBeNull();
    expect(objetivos).toHaveLength(2);
    expect(objetivos).toEqual(expect.arrayContaining([
      expect.objectContaining({ tipo: 'cruzamiento', planta_id: plantaProcedimientoId }),
      expect.objectContaining({ tipo: 'predio', predio_id: predioAId }),
    ]));
  });

  it('mid-fix: la nota del objetivo individuo se persiste y se lee de vuelta (sin afectar la nota general del procedimiento)', async () => {
    const { data: nuevoId, error } = await operario.rpc('crear_procedimiento', {
      p_nombre: 'Poda con nota de individuo',
      p_tipo: 'poda',
      p_fecha_inicio: '2027-04-03',
      p_notas: 'Nota general del procedimiento',
      p_objetivos: [
        { tipo: 'cruzamiento', id: plantaProcedimientoId },
        { tipo: 'individuo', id: individuoAId, nota: 'Rama sur dañada, revisar en la próxima ronda' },
      ],
      p_insumos: [],
    });
    expect(error).toBeNull();

    const { data: objetivos, error: objetivosError } = await operario
      .from('procedimiento_objetivos')
      .select('tipo, individuo_id, nota')
      .eq('procedimiento_id', nuevoId as string)
      .order('tipo');
    expect(objetivosError).toBeNull();
    expect(objetivos).toEqual(expect.arrayContaining([
      expect.objectContaining({ tipo: 'cruzamiento', individuo_id: null, nota: null }),
      expect.objectContaining({ tipo: 'individuo', individuo_id: individuoAId, nota: 'Rama sur dañada, revisar en la próxima ronda' }),
    ]));

    const { data: procedimiento } = await operario
      .from('procedimientos')
      .select('notas')
      .eq('id', nuevoId as string)
      .single();
    expect(procedimiento?.notas).toBe('Nota general del procedimiento');
  });

  it('idempotencia de submit: un reintento con la misma idempotency_key devuelve el mismo procedimiento en vez de duplicarlo, y una key distinta sí crea uno nuevo', async () => {
    const key = crypto.randomUUID();
    const objetivos = [{ tipo: 'cruzamiento', id: plantaProcedimientoId }];

    const { data: id1, error: error1 } = await operario.rpc('crear_procedimiento', {
      p_nombre: 'Poda idempotencia RLS',
      p_tipo: 'poda',
      p_fecha_inicio: '2027-04-04',
      p_objetivos: objetivos,
      p_insumos: [],
      p_idempotency_key: key,
    });
    expect(error1).toBeNull();

    // Reintento exacto (misma key): no debe fallar ni duplicar, debe devolver el mismo id.
    const { data: id2, error: error2 } = await operario.rpc('crear_procedimiento', {
      p_nombre: 'Poda idempotencia RLS',
      p_tipo: 'poda',
      p_fecha_inicio: '2027-04-04',
      p_objetivos: objetivos,
      p_insumos: [],
      p_idempotency_key: key,
    });
    expect(error2).toBeNull();
    expect(id2).toBe(id1);

    const { count } = await service
      .from('procedimientos')
      .select('*', { count: 'exact', head: true })
      .eq('idempotency_key', key);
    expect(count).toBe(1);

    // Key distinta: debe crear un procedimiento nuevo y distinto, sin bloquear.
    const { data: id3, error: error3 } = await operario.rpc('crear_procedimiento', {
      p_nombre: 'Poda idempotencia RLS 2',
      p_tipo: 'poda',
      p_fecha_inicio: '2027-04-04',
      p_objetivos: objetivos,
      p_insumos: [],
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(error3).toBeNull();
    expect(id3).not.toBe(id1);
  });

  it('el procedimiento_cultivo legacy queda solo como archivo admin y sin escritura operativa', async () => {
    const { data: lecturaOperario, error: lecturaOperarioError } = await operario
      .from('procedimiento_cultivo')
      .select('id');
    expect(lecturaOperarioError).toBeNull();
    expect(lecturaOperario).toHaveLength(0);

    const { error: escrituraOperarioError } = await operario
      .from('procedimiento_cultivo')
      .insert({ planta_id: plantaProcedimientoId, tipo: 'poda', fecha: '2027-04-02', created_by: operarioId });
    expect(escrituraOperarioError).toBeTruthy();

    const { error: lecturaAdminError } = await admin.from('procedimiento_cultivo').select('id').limit(1);
    expect(lecturaAdminError).toBeNull();
  });

  it('rechaza procedimiento por predio si el cruce no está realmente en más de un predio', async () => {
    const { data: especie } = await service.from('especies').select('id').limit(1).single();
    const { data: planta } = await service
      .from('plantas')
      .insert({ codigo_sistema: `PROC-SINGLE-${sufijo}`, especie_id: especie!.id, estado: 'traslado_destino', es_prueba: true })
      .select('id')
      .single();
    const { error } = await operario.rpc('crear_procedimiento', {
      p_nombre: 'No multisitio',
      p_tipo: 'aplicacion',
      p_fecha_inicio: '2027-04-02',
      p_objetivos: [{ tipo: 'cruzamiento', id: planta!.id }, { tipo: 'predio', id: predioAId }],
      p_insumos: [],
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/multisitio/i);
  });

  it('consulta solo individuos con emplazamiento vigente en el predio objetivo, no su historial', async () => {
    const { data, error } = await operario.rpc('listar_individuos_procedimiento_predio', {
      p_procedimiento_id: procedimientoId,
      p_predio_id: predioAId,
    });
    expect(error).toBeNull();
    expect(data).toEqual([
      expect.objectContaining({ individuo_id: individuoAId, sector_id: sectorAId }),
    ]);
    expect(data!.some((individuo) => individuo.individuo_id === individuoBId)).toBe(false);

    // El individuo A estuvo en predio A, pero ya no debe aparecer si su
    // emplazamiento vigente se mueve al predio B. Esto prueba que la consulta
    // usa emplazamiento_individuo.fecha_fin IS NULL y no una copia histórica.
    const { error: trasladoError } = await admin.rpc('registrar_traslado_individuo', {
      p_individuo_id: individuoAId,
      p_sector_id: sectorBId,
      p_fecha_inicio: '2027-04-03',
    });
    expect(trasladoError).toBeNull();

    const { data: despuesDelTraslado, error: despuesDelTrasladoError } = await operario.rpc('listar_individuos_procedimiento_predio', {
      p_procedimiento_id: procedimientoId,
      p_predio_id: predioAId,
    });
    expect(despuesDelTrasladoError).toBeNull();
    expect(despuesDelTraslado).toEqual([]);

    // Se devuelve al predio objetivo para que el resto de los casos use el
    // mismo contexto multisitio inicial, sin alterar la evidencia anterior.
    const { error: retornoError } = await admin.rpc('registrar_traslado_individuo', {
      p_individuo_id: individuoAId,
      p_sector_id: sectorAId,
      p_fecha_inicio: '2027-04-04',
    });
    expect(retornoError).toBeNull();

    const { data: historialA, error: historialAError } = await operario
      .from('emplazamiento_individuo')
      .select('sector_id, fecha_fin')
      .eq('individuo_id', individuoAId)
      .order('fecha_inicio');
    expect(historialAError).toBeNull();
    expect(historialA).toEqual([
      { sector_id: sectorAId, fecha_fin: '2027-04-03' },
      { sector_id: sectorBId, fecha_fin: '2027-04-04' },
      { sector_id: sectorAId, fecha_fin: null },
    ]);
  });

  it('operario edita su procedimiento en estados tempranos, pero no puede cerrarlo ni editarlo una vez completado', async () => {
    const { error: editarTempranoError } = await operario.rpc('actualizar_procedimiento', {
      p_procedimiento_id: procedimientoId,
      p_nombre: 'Aplicación sector A en curso',
      p_tipo: 'aplicacion',
      p_estado: 'en_curso',
      p_fecha_inicio: '2027-04-02',
      p_objetivos: objetivosMultisitio(),
      p_insumos: [],
    });
    expect(editarTempranoError).toBeNull();

    const { error: cerrarOperarioError } = await operario.rpc('actualizar_procedimiento', {
      p_procedimiento_id: procedimientoId,
      p_nombre: 'Intento de cierre',
      p_tipo: 'aplicacion',
      p_estado: 'completado',
      p_fecha_inicio: '2027-04-02',
      p_fecha_fin: '2027-04-02',
      p_objetivos: objetivosMultisitio(),
      p_insumos: [],
    });
    expect(cerrarOperarioError).toBeTruthy();
    expect(cerrarOperarioError!.message).toMatch(/Solo admin puede cerrar o cancelar/i);

    const { error: completarAdminError } = await admin.rpc('actualizar_procedimiento', {
      p_procedimiento_id: procedimientoId,
      p_nombre: 'Aplicación sector A completada por admin',
      p_tipo: 'aplicacion',
      p_estado: 'completado',
      p_fecha_inicio: '2027-04-02',
      p_fecha_fin: '2027-04-02',
      p_objetivos: objetivosMultisitio(),
      p_insumos: [],
    });
    expect(completarAdminError).toBeNull();

    const { error: editarCompletadoError } = await operario.rpc('actualizar_procedimiento', {
      p_procedimiento_id: procedimientoId,
      p_nombre: 'Intento de editar completado',
      p_tipo: 'aplicacion',
      p_estado: 'completado',
      p_fecha_inicio: '2027-04-02',
      p_fecha_fin: '2027-04-02',
      p_objetivos: objetivosMultisitio(),
      p_insumos: [],
    });
    expect(editarCompletadoError).toBeTruthy();
    expect(editarCompletadoError!.message).toMatch(/Solo el responsable puede editar un procedimiento temprano/i);
  });

  it('operario no puede asignar otro responsable ni reasignar el procedimiento', async () => {
    const { error: crearConOtroResponsable } = await operario.rpc('crear_procedimiento', {
      p_nombre: 'Intento de asignación',
      p_tipo: 'poda',
      p_fecha_inicio: '2027-04-03',
      p_objetivos: [{ tipo: 'individuo', id: individuoAId }],
      p_insumos: [],
      p_responsable_id: adminId,
    });
    expect(crearConOtroResponsable).toBeTruthy();

    const { error: reasignarError } = await operario.rpc('reasignar_procedimiento', {
      p_procedimiento_id: procedimientoId,
      p_responsable_nuevo_id: adminId,
      p_motivo: 'Intento no autorizado',
    });
    expect(reasignarError).toBeTruthy();
    expect(reasignarError!.message).toMatch(/Solo admin puede reasignar procedimientos/i);

    const { error: cambioDirectoAdminError } = await admin
      .from('procedimientos')
      .update({ responsable_id: adminId })
      .eq('id', procedimientoId);
    expect(cambioDirectoAdminError).toBeTruthy();

    const { error: helperObjetivosError } = await operario.rpc('reemplazar_objetivos_procedimiento', {
      p_procedimiento_id: procedimientoId,
      p_objetivos: [{ tipo: 'cruzamiento', id: plantaProcedimientoId }],
    });
    expect(helperObjetivosError).toBeTruthy();
  });

  it('admin reasigna, conserva historial auditable y el responsable anterior pierde edición', async () => {
    const antesDeReasignar = new Date();
    const { error } = await admin.rpc('reasignar_procedimiento', {
      p_procedimiento_id: procedimientoId,
      p_responsable_nuevo_id: adminId,
      p_motivo: 'Cambio de responsable de prueba',
    });
    expect(error).toBeNull();

    const { data: historial, error: historialError } = await admin
      .from('procedimiento_reasignaciones')
      .select('responsable_anterior_id, responsable_nuevo_id, reasignado_por_id, motivo, created_at')
      .eq('procedimiento_id', procedimientoId);
    expect(historialError).toBeNull();
    expect(historial).toEqual([
      expect.objectContaining({
        responsable_anterior_id: operarioId,
        responsable_nuevo_id: adminId,
        reasignado_por_id: adminId,
        motivo: 'Cambio de responsable de prueba',
      }),
    ]);
    expect(historial![0].created_at).toBeTruthy();
    expect(new Date(historial![0].created_at).getTime()).toBeGreaterThanOrEqual(antesDeReasignar.getTime() - 1_000);

    const { error: editarOperarioError } = await operario.rpc('actualizar_procedimiento', {
      p_procedimiento_id: procedimientoId,
      p_nombre: 'Edición indebida',
      p_tipo: 'aplicacion',
      p_estado: 'planificado',
      p_fecha_inicio: '2027-04-02',
      p_objetivos: objetivosMultisitio(),
      p_insumos: [],
    });
    expect(editarOperarioError).toBeTruthy();

    const { error: editarAdminError } = await admin.rpc('actualizar_procedimiento', {
      p_procedimiento_id: procedimientoId,
      p_nombre: 'Aplicación sector A completada',
      p_tipo: 'aplicacion',
      p_estado: 'completado',
      p_fecha_inicio: '2027-04-02',
      p_fecha_fin: '2027-04-02',
      p_objetivos: objetivosMultisitio(),
      p_insumos: [],
    });
    expect(editarAdminError).toBeNull();

    const audit = await ultimaAuditoria('reasignacion_procedimiento');
    expect(audit.usuario_id).toBe(adminId);
    expect(audit.planta_id).toBe(plantaProcedimientoId);
    expect(audit.detalle).toMatchObject({
      procedimiento_id: procedimientoId,
      de_responsable_id: operarioId,
      a_responsable_id: adminId,
    });
    expect(audit.ocurrido_en).toBeTruthy();
    expect(new Date(audit.ocurrido_en).getTime()).toBeGreaterThanOrEqual(antesDeReasignar.getTime() - 1_000);
  });
});

describe('Siembra: escritura operativa completa', () => {
  const sufijo = Date.now();
  let siembraPlantaId: string;
  let insumoId: string;
  let sustratoId: string;

  beforeAll(async () => {
    const { data: especie } = await service.from('especies').select('id').limit(1).single();
    const { data: planta, error: plantaError } = await service
      .from('plantas')
      .insert({ codigo_sistema: `SIEMBRA-${sufijo}`, especie_id: especie!.id, estado: 'siembra_semilla', es_prueba: true })
      .select('id')
      .single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se pudo preparar el cruce de Siembra');
    siembraPlantaId = planta.id;

    const { data: insumo, error: insumoError } = await admin
      .from('insumo')
      .insert({ nombre: `Insumo siembra ${sufijo}`, tipo: 'otro' })
      .select('id')
      .single();
    if (insumoError || !insumo) throw insumoError ?? new Error('No se pudo preparar el insumo');
    insumoId = insumo.id;

    const { data: sustrato, error: sustratoError } = await admin
      .from('sustrato')
      .insert({ nombre: `Sustrato siembra ${sufijo}` })
      .select('id')
      .single();
    if (sustratoError || !sustrato) throw sustratoError ?? new Error('No se pudo preparar el sustrato');
    sustratoId = sustrato.id;
  }, 60_000);

  it('operario guarda columnas, relaciones y observación de Siembra sin error genérico', async () => {
    const { error: actualizarError } = await operario
      .from('plantas')
      .update({ semillas_sembradas: 24, escarificacion_subtipo: 'fisica' })
      .eq('id', siembraPlantaId);
    expect(actualizarError).toBeNull();

    const { error: insumoError } = await operario
      .from('plantas_insumo')
      .insert({ planta_id: siembraPlantaId, insumo_id: insumoId });
    expect(insumoError).toBeNull();

    const { error: sustratoError } = await operario
      .from('plantas_sustrato')
      .insert({ planta_id: siembraPlantaId, sustrato_id: sustratoId, porcentaje: 100 });
    expect(sustratoError).toBeNull();

    const { data: evento, error: eventoError } = await operario
      .from('registros_evento')
      .insert({
        planta_id: siembraPlantaId,
        tipo_evento: 'siembra_semilla',
        fecha: '2027-05-01',
        datos: { semillas_sembradas: 24 },
        notas: 'Observación de Siembra persistida',
        created_by: operarioId,
      })
      .select('notas, datos')
      .single();
    expect(eventoError).toBeNull();
    expect(evento).toMatchObject({ notas: 'Observación de Siembra persistida' });

    const { data: verificacion } = await operario
      .from('plantas')
      .select('semillas_sembradas, escarificacion_subtipo')
      .eq('id', siembraPlantaId)
      .single();
    expect(verificacion).toEqual({ semillas_sembradas: 24, escarificacion_subtipo: 'fisica' });
  });
});

// =============================================================================
// SPRINT 5 — consultas analíticas y restauración de soft delete
// =============================================================================
describe('Sprint 5: contratos analíticos y restauración auditada', () => {
  const sufijo = Date.now();
  let especieId: string;
  let cruceRestaurableId: string;
  let individuoRestaurableId: string;
  let rondaRestaurableId: string;
  let emplazamientoRestaurableId: string;

  beforeAll(async () => {
    const { data: especie, error: especieError } = await service.from('especies').select('id').eq('nombre', 'Arándano').limit(1).single();
    if (especieError || !especie) throw especieError ?? new Error('Sin especie para Sprint 5');
    especieId = especie.id;

    const { data: cruce, error: cruceError } = await service
      .from('plantas')
      .insert({ codigo_sistema: `RESTORE-${sufijo}`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true })
      .select('id')
      .single();
    if (cruceError || !cruce) throw cruceError ?? new Error('No se creó cruce restaurable');
    cruceRestaurableId = cruce.id;

    const { data: individuo, error: individuoError } = await service
      .from('individuos')
      .insert({ planta_id: cruceRestaurableId, codigo_display: `RESTORE-${sufijo}-P01`, created_by: adminId })
      .select('id')
      .single();
    if (individuoError || !individuo) throw individuoError ?? new Error('No se creó individuo restaurable');
    individuoRestaurableId = individuo.id;

    const { data: ronda, error: rondaError } = await service
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuoRestaurableId, numero_ronda: 1, anio: 2026, created_by: adminId })
      .select('id')
      .single();
    if (rondaError || !ronda) throw rondaError ?? new Error('No se creó ronda restaurable');
    rondaRestaurableId = ronda.id;

    const { error: evaluacionError } = await service.from('evaluaciones').insert({
      ronda_id: rondaRestaurableId,
      fecha: '2026-07-01',
      anio: 2026,
      estado: 'borrador',
      created_by: adminId,
    });
    if (evaluacionError) throw evaluacionError;

    const { data: sector, error: sectorError } = await service.from('sector').select('id').eq('activo', true).limit(1).single();
    if (sectorError || !sector) throw sectorError ?? new Error('Sin sector para restauración');
    const { data: emplazamiento, error: emplazamientoError } = await admin.rpc('registrar_traslado_individuo', {
      p_individuo_id: individuoRestaurableId,
      p_sector_id: sector.id,
      p_fecha_inicio: '2026-07-01',
    });
    if (emplazamientoError || !emplazamiento) throw emplazamientoError ?? new Error('No se creó emplazamiento restaurable');
    emplazamientoRestaurableId = emplazamiento as string;

    const { error: borrarError } = await admin.rpc('borrar_cruzamiento', { p_planta_id: cruceRestaurableId, p_tipo: 'soft' });
    if (borrarError) throw borrarError;
  }, 60_000);

  it('ranking global exige especie, pagina en backend y no expone linaje', async () => {
    const { error: sinEspecieError } = await operario.rpc('obtener_ranking_global_filtrado', {
      p_especie_id: null,
      p_limite: 1,
      p_offset: 0,
    });
    expect(sinEspecieError).toBeTruthy();
    expect(sinEspecieError!.message).toMatch(/especie.*obligatoria/i);

    const { data: paginaUno, error: paginaUnoError } = await operario.rpc('obtener_ranking_global_filtrado', {
      p_especie_id: especieId,
      p_estado_vital: 'vivo',
      p_limite: 1,
      p_offset: 0,
      p_orden: 'codigo_asc',
    });
    const { data: paginaDos, error: paginaDosError } = await operario.rpc('obtener_ranking_global_filtrado', {
      p_especie_id: especieId,
      p_estado_vital: 'vivo',
      p_limite: 1,
      p_offset: 1,
      p_orden: 'codigo_asc',
    });
    expect(paginaUnoError).toBeNull();
    expect(paginaDosError).toBeNull();
    const primera = paginaUno as { items: Array<Record<string, unknown>>; total: number; limite: number; offset: number };
    const segunda = paginaDos as typeof primera;
    expect(primera.limite).toBe(1);
    expect(primera.offset).toBe(0);
    expect(segunda.offset).toBe(1);
    expect(primera.total).toBeGreaterThan(1);
    expect(primera.items[0].individuo_id).not.toBe(segunda.items[0].individuo_id);
    expect(JSON.stringify(primera)).not.toMatch(/cruzamiento|mama|papa/);
  });

  it('ranking global filtra por cruce, fecha y estado vital en PostgreSQL', async () => {
    const { data: porCruce, error: porCruceError } = await operario.rpc('obtener_ranking_global_filtrado', {
      p_especie_id: especieId,
      p_planta_id: cruceRestaurableId,
      p_estado_vital: 'vivo',
      p_limite: 25,
      p_offset: 0,
    });
    // El cruce sigue soft-deleted en este punto: el backend debe rechazarlo,
    // no devolverlo indirectamente a través del filtro.
    expect(porCruceError).toBeTruthy();
    expect(porCruce).toBeNull();

    const { data: fechaFutura, error: fechaError } = await operario.rpc('obtener_ranking_global_filtrado', {
      p_especie_id: especieId,
      p_fecha_desde: '2099-01-01',
      p_estado_vital: 'vivo',
      p_limite: 25,
      p_offset: 0,
    });
    expect(fechaError).toBeNull();
    expect((fechaFutura as { total: number }).total).toBe(0);

    const { data: descartados, error: descartadosError } = await operario.rpc('obtener_ranking_global_filtrado', {
      p_especie_id: especieId,
      p_estado_vital: 'descartado',
      p_limite: 100,
      p_offset: 0,
    });
    expect(descartadosError).toBeNull();
    const items = (descartados as { items: Array<{ estado_vital: string; motivo_exclusion: string }> }).items;
    expect(items.every((item) => item.estado_vital === 'descartado' && item.motivo_exclusion === 'individuo_descartado')).toBe(true);
  });

  it('dashboard y tabla de cruces agregan, filtran y ordenan en RPC sin linaje', async () => {
    const { data: dashboard, error: dashboardError } = await operario.rpc('obtener_dashboard_cientifico', { p_especie_id: especieId, p_limite: 3 });
    expect(dashboardError).toBeNull();
    expect(dashboard).toHaveProperty('resumen');
    expect(dashboard).toHaveProperty('cambios_recientes');
    expect(dashboard).toHaveProperty('pendientes');
    expect(JSON.stringify(dashboard)).not.toMatch(/cruzamiento|mama|papa/);

    const { data: cruces, error: crucesError } = await operario.rpc('listar_cruces_analiticos', {
      p_especie_id: especieId,
      p_estado: 'evaluacion_anual',
      p_orden: 'codigo_asc',
      p_limite: 2,
      p_offset: 0,
    });
    expect(crucesError).toBeNull();
    const respuesta = cruces as { items: Array<{ especie_id: string; estado: string; codigo_sistema: string }>; limite: number };
    expect(respuesta.limite).toBe(2);
    expect(respuesta.items.every((item) => item.especie_id === especieId && item.estado === 'evaluacion_anual')).toBe(true);
    expect([...respuesta.items].map((item) => item.codigo_sistema)).toEqual([...respuesta.items].map((item) => item.codigo_sistema).sort());

    const { error: ordenError } = await operario.rpc('listar_cruces_analiticos', {
      p_orden: 'sql_inyectado',
      p_limite: 2,
      p_offset: 0,
    });
    expect(ordenError).toBeTruthy();
    expect(ordenError!.message).toMatch(/orden no permitido/i);
  });

  it('operario no restaura; admin restaura, audita y conserva todas las relaciones', async () => {
    const { error: operarioError } = await operario.rpc('restaurar_cruzamiento', { p_planta_id: cruceRestaurableId });
    expect(operarioError).toBeTruthy();
    expect(operarioError!.message).toMatch(/solo un admin/i);

    const { data, error } = await admin.rpc('restaurar_cruzamiento', { p_planta_id: cruceRestaurableId });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      planta_id: cruceRestaurableId,
      n_individuos: 1,
      n_evaluaciones: 1,
      n_emplazamientos: 1,
    });

    const [{ data: visible }, { count: individuos }, { count: evaluaciones }, { data: emplazamiento }] = await Promise.all([
      operario.from('plantas_operativas').select('id').eq('id', cruceRestaurableId).single(),
      service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', cruceRestaurableId),
      service.from('evaluaciones').select('id', { count: 'exact', head: true }).eq('ronda_id', rondaRestaurableId),
      service.from('emplazamiento_individuo').select('id, individuo_id, fecha_fin').eq('id', emplazamientoRestaurableId).single(),
    ]);
    expect(visible?.id).toBe(cruceRestaurableId);
    expect(individuos).toBe(1);
    expect(evaluaciones).toBe(1);
    expect(emplazamiento).toEqual({ id: emplazamientoRestaurableId, individuo_id: individuoRestaurableId, fecha_fin: null });

    const audit = await ultimaAuditoria('restauracion_cruzamiento');
    expect(audit.usuario_id).toBe(adminId);
    expect(audit.planta_id).toBe(cruceRestaurableId);
    expect(audit.detalle).toMatchObject({ n_individuos: 1, n_evaluaciones: 1, n_emplazamientos: 1 });
    expect(audit.ocurrido_en).toBeTruthy();
  });
});

describe('Sprint 9: obtener_planta excluye eliminados', () => {
  let cruceId: string;

  beforeAll(async () => {
    const { data: especie } = await service.from('especies').select('id').eq('nombre', 'Arándano').limit(1).single();
    const { data: cruce, error } = await service
      .from('plantas')
      .insert({ codigo_sistema: `OBTPLANTA-${Date.now()}`, especie_id: especie!.id, estado: 'polinizacion', es_prueba: true })
      .select('id')
      .single();
    if (error || !cruce) throw error ?? new Error('No se creó cruce para el test de obtener_planta');
    cruceId = cruce.id;
  });

  it('mientras el cruce está activo, obtener_planta lo devuelve normalmente', async () => {
    const { data, error } = await operario.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(error).toBeNull();
    expect((data as { id: string }).id).toBe(cruceId);
  });

  it('tras soft-delete, obtener_planta lo rechaza con P0002 en vez de devolverlo completo y editable', async () => {
    await service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', cruceId);
    const { data: operarioData, error: operarioError } = await operario.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(operarioData).toBeNull();
    expect(operarioError).toBeTruthy();
    expect(operarioError!.message).toMatch(/no encontrada/i);

    // Tampoco para admin: Administrar cruces ya opera desde su propia lista
    // (listarTodosLosCruces), no necesita la ficha para restaurar.
    const { data: adminData, error: adminError } = await admin.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(adminData).toBeNull();
    expect(adminError).toBeTruthy();

    await service.from('plantas').update({ eliminado_at: null }).eq('id', cruceId);
  });
});

describe('Sprint 9: el autor descarta su propio borrador de evaluación (nunca DELETE)', () => {
  let individuoId: string;
  let rondaId: string;
  let borradorId: string;

  beforeAll(async () => {
    const { data: especie } = await service.from('especies').select('id').eq('nombre', 'Arándano').limit(1).single();
    const { data: cruce } = await service
      .from('plantas')
      .insert({ codigo_sistema: `DESCARTAR-${Date.now()}`, especie_id: especie!.id, estado: 'evaluacion_anual', es_prueba: true })
      .select('id')
      .single();
    const { data: individuo } = await service
      .from('individuos')
      .insert({ planta_id: cruce!.id, codigo_display: `DESCARTAR-${Date.now()}-P01`, created_by: adminId })
      .select('id')
      .single();
    individuoId = individuo!.id;
    const { data: ronda } = await iniciarRondaAnual(operario, individuoId);
    rondaId = (ronda as { ronda_id: string }).ronda_id;

    const { data: borrador, error } = await operario
      .from('evaluaciones')
      .insert({ ronda_id: rondaId, anio: 2026, fecha: '2026-07-19', estado: 'borrador', created_by: operarioId })
      .select('id')
      .single();
    if (error || !borrador) throw error ?? new Error('No se creó el borrador de prueba');
    borradorId = borrador.id;
  }, 30_000);

  it('el autor puede transicionar su propio borrador a anulada (nunca un DELETE real: la fila sigue existiendo)', async () => {
    const { data, error } = await operario
      .from('evaluaciones')
      .update({ estado: 'anulada', motivo_cambio: 'Borrador descartado por el autor' })
      .eq('id', borradorId)
      .select('id, estado')
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: borradorId, estado: 'anulada' });

    // Sigue existiendo (soft, no DELETE) — evaluaciones_delete_nadie nunca se tocó.
    const { data: sigueExistiendo } = await service.from('evaluaciones').select('id, estado').eq('id', borradorId).single();
    expect(sigueExistiendo).toMatchObject({ id: borradorId, estado: 'anulada' });

    const { error: deleteError } = await operario.from('evaluaciones').delete().eq('id', borradorId);
    expect(deleteError).toBeTruthy();
  });

  it('el autor NO puede reabrir/anular una evaluación ya cerrada (completa) propia — el using clause exige estado=borrador', async () => {
    await cerrarRonda(rondaId);
    const { data: ronda2 } = await iniciarRondaAnual(operario, individuoId);
    const rondaId2 = (ronda2 as { ronda_id: string }).ronda_id;
    const { data: completa } = await operario
      .from('evaluaciones')
      .insert({
        ronda_id: rondaId2, anio: 2026, fecha: '2026-07-19', estado: 'completa', created_by: operarioId,
        brotacion: 1, floracion: 1, cuaja: 1, concentracion_cosecha: 1, calibre_mm: 18, firmeza: 1, color: 1,
        bloom: 1, brix: 12, rend_kg_planta: 1, rend_t_ha: 1, pct_fruta_exportable: 50, dano_calor: 1, golpe_sol: 1,
        caida_fruto: 1, cantidad_frutos: 5, peso_total_g: 50,
      })
      .select('id')
      .single();
    expect(completa).toBeTruthy();

    const { data, error } = await operario
      .from('evaluaciones')
      .update({ estado: 'anulada' })
      .eq('id', completa!.id)
      .select('id')
      .single();
    // RLS silenciosamente no afecta filas (0 rows), no un error explícito.
    expect(data).toBeNull();
    expect(error).toBeTruthy();

    const { data: sigueCompleta } = await service.from('evaluaciones').select('estado').eq('id', completa!.id).single();
    expect(sigueCompleta?.estado).toBe('completa');
  });
});

describe('EVECL: RPC de consulta, scoring y mutación (Sprint E2)', () => {
  const sufijo = Date.now();
  let ensayoId: number;
  let idFirmeza: number;
  let idVigor: number;
  let fichaOperarioId: number;
  let operario2: SupabaseClient;

  beforeAll(async () => {
    const creds = getLocalCreds();
    const op2 = await crearUsuarioDePrueba(creds, service, {
      email: 'operario2-evecl@test.local',
      rol: 'operario',
    });
    operario2 = op2.client;

    const { data: ensayo, error } = await operario.rpc('evecl_guardar_ensayo', {
      p_codigo_parcela: `EVECL-TEST-${sufijo}`,
      p_nombre_productor: 'Productor Test',
    });
    if (error || !ensayo) throw error ?? new Error('No se creó el ensayo de prueba EVECL');
    ensayoId = ensayo as number;

    const { data: catalogo, error: catalogoError } = await operario.rpc('evecl_obtener_catalogo');
    if (catalogoError || !catalogo) throw catalogoError ?? new Error('Sin catálogo EVECL');
    const porUpov = Object.fromEntries(
      (catalogo as { codigo_upov: number | null; id: number }[]).filter((d) => d.codigo_upov).map((d) => [d.codigo_upov, d.id]),
    );
    idFirmeza = porUpov[28];
    idVigor = porUpov[1];
  }, 30_000);

  afterAll(async () => {
    const { data: fichas } = await service.from('evecl_ficha').select('id').eq('ensayo_id', ensayoId);
    const fichaIds = (fichas ?? []).map((f) => f.id);
    if (fichaIds.length) await service.from('evecl_respuesta').delete().in('ficha_id', fichaIds);
    await service.from('evecl_ficha').delete().eq('ensayo_id', ensayoId);
    await service.from('evecl_ensayo').delete().eq('id', ensayoId);
  });

  it('evecl_obtener_catalogo: 20 estado + 7 valor, 7 rankeable, estados UPOV anidados por descriptor', async () => {
    const { data, error } = await operario.rpc('evecl_obtener_catalogo');
    expect(error).toBeNull();
    const catalogo = data as { tipo: string; rankeable: boolean; codigo_upov: number | null; estados: { nota: number }[] }[];
    expect(catalogo.filter((d) => d.tipo === 'estado')).toHaveLength(20);
    expect(catalogo.filter((d) => d.tipo === 'valor')).toHaveLength(7);
    expect(catalogo.filter((d) => d.rankeable)).toHaveLength(7);
    const vigor = catalogo.find((d) => d.codigo_upov === 1)!;
    expect(vigor.estados.map((e) => e.nota)).toEqual([3, 5, 7]);
  });

  it('evecl_obtener_ensayos: exige autenticación y lista el ensayo recién creado con conteos en 0', async () => {
    const { error: anonError } = await anon.rpc('evecl_obtener_ensayos');
    expect(anonError).toBeTruthy();

    const { data, error } = await operario.rpc('evecl_obtener_ensayos');
    expect(error).toBeNull();
    const propio = (data as { id: number; total_fichas: number; total_variedades: number }[]).find((e) => e.id === ensayoId);
    expect(propio).toMatchObject({ total_fichas: 0, total_variedades: 0 });
  });

  it('evecl_guardar_ficha crea ficha+respuestas y evecl_obtener_ficha la devuelve completa (con ensayo y descriptor resuelto)', async () => {
    const { data: fichaId, error } = await guardarFichaEvecl(operario, {
      p_ensayo_id: ensayoId,
      p_variedad: 'VariedadContrato',
      p_numero_repeticion: 1,
      p_respuestas: [
        { descriptor_id: idFirmeza, valor_numerico: 7 },
        { descriptor_id: idVigor, nota: 5 },
      ],
    });
    expect(error).toBeNull();
    fichaOperarioId = fichaId as number;

    const { data, error: fichaError } = await operario.rpc('evecl_obtener_ficha', { p_ficha_id: fichaOperarioId });
    expect(fichaError).toBeNull();
    const ficha = data as { variedad: string; respuestas: { descriptor: { nombre: string } }[]; ensayo: { codigo_parcela: string } };
    expect(ficha.variedad).toBe('VariedadContrato');
    expect(ficha.respuestas).toHaveLength(2);
    expect(ficha.respuestas.map((r) => r.descriptor.nombre)).toContain('Vigor');
    expect(ficha.ensayo.codigo_parcela).toBe(`EVECL-TEST-${sufijo}`);
  });

  it('evecl_guardar_ficha es idempotente: la misma idempotency_key no duplica la ficha', async () => {
    const key = crypto.randomUUID();
    const { data: id1, error: e1 } = await guardarFichaEvecl(operario, {
      p_ensayo_id: ensayoId,
      p_variedad: 'VariedadIdemp',
      p_numero_repeticion: 1,
      p_idempotency_key: key,
    });
    expect(e1).toBeNull();
    const { data: id2, error: e2 } = await guardarFichaEvecl(operario, {
      p_ensayo_id: ensayoId,
      p_variedad: 'VariedadIdemp',
      p_numero_repeticion: 1,
      p_idempotency_key: key,
    });
    expect(e2).toBeNull();
    expect(id2).toBe(id1);

    const { count } = await service
      .from('evecl_ficha')
      .select('*', { count: 'exact', head: true })
      .eq('idempotency_key', key);
    expect(count).toBe(1);
  });

  it('evecl_obtener_fichas calcula completitud respondidos/total_descriptores', async () => {
    const { data, error } = await operario.rpc('evecl_obtener_fichas', {
      p_ensayo_id: ensayoId,
      p_variedad: 'VariedadContrato',
    });
    expect(error).toBeNull();
    const fila = (data as { respondidos: number; total_descriptores: number }[])[0];
    expect(fila).toMatchObject({ respondidos: 2, total_descriptores: 27 });
  });

  it('permisos: admin puede editar/eliminar la ficha de otro usuario; un operario distinto del autor NO puede', async () => {
    const { error: adminEditError } = await guardarFichaEvecl(admin, {
      p_id: fichaOperarioId,
      p_ensayo_id: ensayoId,
      p_variedad: 'VariedadContrato',
      p_numero_repeticion: 1,
      p_notas: 'Editado por admin',
    });
    expect(adminEditError).toBeNull();

    const { error: ajenoEditError } = await guardarFichaEvecl(operario2, {
      p_id: fichaOperarioId,
      p_ensayo_id: ensayoId,
      p_variedad: 'VariedadContrato',
      p_numero_repeticion: 1,
      p_notas: 'Intento ajeno',
    });
    expect(ajenoEditError).toBeTruthy();

    const { error: ajenoDeleteError } = await operario2.rpc('evecl_eliminar_ficha', { p_ficha_id: fichaOperarioId });
    expect(ajenoDeleteError).toBeTruthy();

    const { data: sigueActiva } = await service.from('evecl_ficha').select('eliminado_at').eq('id', fichaOperarioId).single();
    expect(sigueActiva?.eliminado_at).toBeNull();
  });

  it('permisos: un operario distinto del autor NO puede editar el ensayo; admin sí puede', async () => {
    const { error: ajenoError } = await operario2.rpc('evecl_guardar_ensayo', {
      p_id: ensayoId,
      p_codigo_parcela: `EVECL-TEST-${sufijo}`,
      p_notas: 'Intento ajeno',
    });
    expect(ajenoError).toBeTruthy();

    const { error: adminError } = await admin.rpc('evecl_guardar_ensayo', {
      p_id: ensayoId,
      p_codigo_parcela: `EVECL-TEST-${sufijo}`,
      p_notas: 'Editado por admin',
    });
    expect(adminError).toBeNull();
  });

  it('evecl_obtener_ficha filtra eliminado_at is null: tras eliminar, deja de encontrarla (P0002)', async () => {
    const { data: fichaId, error: crearError } = await guardarFichaEvecl(operario, {
      p_ensayo_id: ensayoId,
      p_variedad: 'VariedadEliminar',
      p_numero_repeticion: 1,
    });
    expect(crearError).toBeNull();

    const { error: delError } = await operario.rpc('evecl_eliminar_ficha', { p_ficha_id: fichaId });
    expect(delError).toBeNull();

    const { error: getError } = await operario.rpc('evecl_obtener_ficha', { p_ficha_id: fichaId });
    expect(getError).toBeTruthy();
    expect(getError!.message).toContain('no encontrada');
  });

  it('evecl_comparar valida el modo y exige ensayo+variedad en entre_fichas', async () => {
    const { error: modoError } = await operario.rpc('evecl_comparar', { p_modo: 'invalido' });
    expect(modoError).toBeTruthy();

    const { error: entreFichasError } = await operario.rpc('evecl_comparar', { p_modo: 'entre_fichas' });
    expect(entreFichasError).toBeTruthy();

    const { error: anonError } = await anon.rpc('evecl_comparar', { p_modo: 'entre_grupos' });
    expect(anonError).toBeTruthy();
  });

  it('evecl_comparar entre_grupos devuelve la forma esperada: rankings y perfiles como arrays', async () => {
    const { data, error } = await operario.rpc('evecl_comparar', {
      p_modo: 'entre_grupos',
      p_ensayo_id: ensayoId,
      p_conjunto: 'todos',
    });
    expect(error).toBeNull();
    const cmp = data as {
      modo: string;
      conjunto: string;
      ranking_calidad: unknown[];
      ranking_productividad: unknown[];
      perfil_fenologia: unknown[];
      perfil_adaptabilidad: unknown[];
    };
    expect(cmp.modo).toBe('entre_grupos');
    expect(cmp.conjunto).toBe('todos');
    expect(Array.isArray(cmp.ranking_calidad)).toBe(true);
    expect(Array.isArray(cmp.ranking_productividad)).toBe(true);
    expect(Array.isArray(cmp.perfil_fenologia)).toBe(true);
    expect(Array.isArray(cmp.perfil_adaptabilidad)).toBe(true);
  });

  it('evecl_comparar: un único grupo con dato en un eje da puntaje=100 (max=min de un solo elemento), no error ni división por cero', async () => {
    // Ensayo aislado propio: el ensayo compartido del describe ya tiene datos
    // de Calidad en otras fichas (VariedadContrato), lo que rompería la
    // premisa "un solo grupo con dato" de este caso.
    const { data: ensayoAisladoId, error: ensayoError } = await operario.rpc('evecl_guardar_ensayo', {
      p_codigo_parcela: `EVECL-UNICO-${sufijo}`,
    });
    expect(ensayoError).toBeNull();

    const { data: fichaConDatoId } = await guardarFichaEvecl(operario, {
      p_ensayo_id: ensayoAisladoId,
      p_variedad: 'VariedadUnica',
      p_numero_repeticion: 1,
      p_respuestas: [{ descriptor_id: idFirmeza, valor_numerico: 7 }],
    });
    // Grupo hermano sin ningún dato de Calidad: debe quedar fuera del ranking,
    // no arrastrar al único grupo con dato hacia un promedio con nulls.
    await guardarFichaEvecl(operario, {
      p_ensayo_id: ensayoAisladoId,
      p_variedad: 'VariedadSinDato',
      p_numero_repeticion: 1,
      p_respuestas: [],
    });

    const { data, error } = await operario.rpc('evecl_comparar', {
      p_modo: 'entre_grupos',
      p_ensayo_id: ensayoAisladoId,
      p_conjunto: 'todos',
    });
    expect(error).toBeNull();
    const cmp = data as { ranking_calidad: { variedad: string; puntaje: number; n_con_dato: number; grupo_label: string }[] };
    expect(cmp.ranking_calidad).toHaveLength(1);
    expect(cmp.ranking_calidad[0]).toMatchObject({ variedad: 'VariedadUnica', puntaje: 100, n_con_dato: 1 });
    // grupo_label usa codigo_parcela, nunca el id crudo del ensayo.
    expect(cmp.ranking_calidad[0].grupo_label).toBe(`VariedadUnica — EVECL-UNICO-${sufijo}`);

    // Limpieza propia de este ensayo aislado.
    const { data: fichasAisladas } = await service.from('evecl_ficha').select('id').eq('ensayo_id', ensayoAisladoId);
    const idsAislados = (fichasAisladas ?? []).map((f) => f.id);
    if (idsAislados.length) await service.from('evecl_respuesta').delete().in('ficha_id', idsAislados);
    await service.from('evecl_ficha').delete().eq('ensayo_id', ensayoAisladoId);
    await service.from('evecl_ensayo').delete().eq('id', ensayoAisladoId);
    expect(fichaConDatoId).toBeTruthy();
  });
});
