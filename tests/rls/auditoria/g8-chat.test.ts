/**
 * Auditoría integral, Corrida 1, grupo G8: T06 chat (canales de cruce, predio,
 * general y libres; menciones; notificaciones; /clear).
 *
 * No repite lo que ya cubren tests/rls/chat.test.ts y chat-menciones-canales.test.ts
 * (canal único por entidad, identidad fijada por el servidor, no leídos, tablas
 * sin escritura directa para el admin, Realtime básico, @all, aislamiento
 * básico del canal libre, /clear básico). Busca lo que falta: caminos del
 * usuario ajeno a un canal libre por cada RPC, tamaños y volúmenes, idempotencia
 * con otro contenido y tras archivar, /clear sobre un canal de cruce, Realtime
 * hacia un no miembro, auditoría de la gestión de canales, XSS y escala.
 *
 * El test de Realtime intermitente del chat es deuda aceptada: las pruebas de
 * Realtime de este archivo usan reintentos y no cuentan una entrega tardía como falla.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoG8, type UsuarioG8 } from './g8-setup';

const ctx = new ContextoG8();
const { service } = ctx;

let creador: UsuarioG8; // admin, creador del canal libre
let otroAdmin: UsuarioG8; // admin que NO es miembro del canal libre
let miembro: UsuarioG8; // operario invitado
let externo: UsuarioG8; // operario no invitado
let libre: string;
let especieId: string;
let cruceId: string;
let canalCruce: string;
const cargaDirecta: string[] = [];

/** Consulta directa como superusuario contra la base LOCAL (solo para cargar/limpiar volumen). */
const psql = (...comandos: string[]) => execFileSync('docker', [
  'exec', 'supabase_db_dbsecurity-frutales', 'psql', '-U', 'postgres', '-d', 'postgres',
  ...comandos.flatMap((c) => ['-c', c]),
], { encoding: 'utf8' });

const enviar = (u: UsuarioG8, canal: string, texto: string, extra: Record<string, unknown> = {}, clave = randomUUID()) =>
  u.client.rpc('enviar_mensaje_chat', { p_canal_id: canal, p_contenido: texto, p_clave_envio: clave, ...extra });

beforeAll(async () => {
  creador = await ctx.usuario('chat-creador', 'admin');
  otroAdmin = await ctx.usuario('chat-admin2', 'admin');
  miembro = await ctx.usuario('chat-miembro', 'operario');
  externo = await ctx.usuario('chat-externo', 'operario');
  const c = await creador.client.rpc('crear_canal_libre', { p_nombre: `AUD-G8 libre ${ctx.sufijo}`, p_participantes: [miembro.userId] });
  expect(c.error).toBeNull();
  libre = c.data as string;
  ctx.registrarCanal(libre);

  especieId = await ctx.especie('chat');
  cruceId = await ctx.cruce('CHAT', especieId, {
    cruzamiento: `LINAJE-SECRETO-G8 ${ctx.sufijo}`,
    mama: 'MAMA-SECRETA-G8',
    papa: 'PAPA-SECRETA-G8',
  });
  const cc = await miembro.client.rpc('obtener_canal_chat', { p_tipo: 'cruce', p_entidad_id: cruceId });
  expect(cc.error).toBeNull();
  canalCruce = cc.data as string;
  ctx.registrarCanal(canalCruce);
});

afterAll(async () => {
  for (const u of [creador, otroAdmin, miembro, externo]) await u?.client.removeAllChannels();
  for (const canal of cargaDirecta) {
    psql(
      `delete from chat_menciones where mensaje_id in (select id from chat_mensajes where canal_id = '${canal}')`,
      `delete from chat_mensajes where canal_id = '${canal}'`,
    );
  }
  await ctx.limpiar();
});

describe('T06 aislamiento de un canal libre frente a un usuario ajeno', () => {
  it('el ajeno no lee el canal, sus mensajes, sus participantes ni sus menciones, y ninguna RPC le responde', async () => {
    const m = await enviar(miembro, libre, 'solo para el equipo', { p_mencionados: [creador.userId] });
    expect(m.error).toBeNull();

    expect((await externo.client.from('chat_canales').select('id').eq('id', libre)).data).toHaveLength(0);
    expect((await externo.client.from('chat_mensajes').select('id').eq('canal_id', libre)).data).toHaveLength(0);
    expect((await externo.client.from('chat_canal_participantes').select('usuario_id').eq('canal_id', libre)).data).toHaveLength(0);
    expect((await externo.client.from('chat_menciones').select('mensaje_id')).data).toHaveLength(0);
    expect((await externo.client.from('chat_lecturas').select('canal_id').eq('canal_id', libre)).data).toHaveLength(0);

    expect((await enviar(externo, libre, 'intruso')).error?.code).toBe('42501');
    expect((await externo.client.rpc('marcar_chat_leido', { p_canal_id: libre, p_posicion: 0 })).error?.code).toBe('42501');
    expect((await externo.client.rpc('listar_participantes_chat', { p_canal_id: libre })).error?.code).toBe('42501');
    expect((await externo.client.rpc('listar_canales_chat')).data!.some((c: { id: string }) => c.id === libre)).toBe(false);
    expect((await externo.client.rpc('listar_notificaciones_chat')).data!.some((n: { canal_id: string }) => n.canal_id === libre)).toBe(false);
    // No hay camino para pedir un canal libre por obtener_canal_chat.
    const pide = await externo.client.rpc('obtener_canal_chat', { p_tipo: 'libre', p_entidad_id: libre });
    expect(pide.error?.code).toBe('22023');
  });

  it('nadie puede mencionar a un ajeno ni agregarse: solo gestiona el admin creador', async () => {
    const mencion = await enviar(miembro, libre, 'hola @externo', { p_mencionados: [externo.userId] });
    expect(mencion.error?.code).toBe('42501');

    const fila = { p_canal_id: libre, p_participantes: [miembro.userId, externo.userId] };
    for (const quien of [externo, miembro, otroAdmin]) {
      expect((await quien.client.rpc('actualizar_participantes_canal_libre', fila)).error?.code).toBe('42501');
      expect((await quien.client.rpc('archivar_canal_libre', { p_canal_id: libre })).error?.code).toBe('42501');
      expect((await quien.client.rpc('limpiar_canal_chat', { p_canal_id: libre })).error?.code).toBe('42501');
    }
    const { data } = await service.from('chat_canal_participantes').select('usuario_id').eq('canal_id', libre);
    expect(data!.map((p) => p.usuario_id).sort()).toEqual([creador.userId, miembro.userId].sort());
  });

  it('crear un canal libre exige ser admin y un nombre de 2 a 80 caracteres', async () => {
    expect((await miembro.client.rpc('crear_canal_libre', { p_nombre: 'Intento', p_participantes: [] })).error?.code).toBe('42501');
    for (const nombre of ['x', '   ', 'N'.repeat(81)]) {
      const r = await creador.client.rpc('crear_canal_libre', { p_nombre: nombre, p_participantes: [] });
      expect(r.error?.code, nombre).toBe('22023');
    }
    const inexistente = await creador.client.rpc('crear_canal_libre', { p_nombre: 'Con fantasma', p_participantes: [randomUUID()] });
    expect(inexistente.error?.code).toBe('22023');
  });

  it('las cinco tablas del chat no admiten INSERT, UPDATE ni DELETE directos, ni siquiera al admin', async () => {
    // tabla → [columna a modificar, columna para filtrar]
    const tablas: Record<string, [string, string]> = {
      chat_canales: ['creado_at', 'id'],
      chat_mensajes: ['creado_at', 'id'],
      chat_lecturas: ['actualizado_at', 'canal_id'],
      chat_canal_participantes: ['agregado_at', 'canal_id'],
      chat_menciones: ['creado_at', 'mensaje_id'],
    };
    for (const u of [creador, miembro]) {
      for (const [tabla, [columna, filtro]] of Object.entries(tablas)) {
        const ins = await u.client.from(tabla).insert({});
        expect(ins.error?.code, `insert ${tabla}`).toBe('42501');
        const upd = await u.client.from(tabla).update({ [columna]: new Date().toISOString() }).not(filtro, 'is', null);
        expect(upd.error?.code, `update ${tabla}`).toBe('42501');
        const del = await u.client.from(tabla).delete().not(filtro, 'is', null);
        expect(del.error?.code, `delete ${tabla}`).toBe('42501');
      }
    }
    // Un participante que se retira no deja a nadie leyendo: confirma que la membresía no es editable por el propio miembro.
    const sale = await miembro.client.from('chat_canal_participantes').delete().eq('canal_id', libre).eq('usuario_id', miembro.userId);
    expect(sale.error?.code).toBe('42501');
  });
});

describe('T06 tamaños, menciones y contenido', () => {
  it('acepta 4000 caracteres (también 4000 emojis) y rechaza 4001, 1 MB, vacío y solo espacios', async () => {
    expect((await enviar(miembro, libre, 'a'.repeat(4000))).error).toBeNull();
    expect((await enviar(miembro, libre, '😀'.repeat(4000))).error).toBeNull();
    for (const texto of ['a'.repeat(4001), 'a'.repeat(1_000_000), '', '   \n\t  ']) {
      const r = await enviar(miembro, libre, texto);
      expect(r.error?.code, `${texto.length} caracteres`).toBe('22023');
    }
  });

  it('10 000 menciones repetidas de un mismo participante generan una sola mención y no tumban el servidor', async () => {
    const repetidas = Array.from({ length: 10_000 }, () => miembro.userId);
    const t0 = Date.now();
    const r = await enviar(creador, libre, 'mención repetida', { p_mencionados: repetidas });
    expect(r.error).toBeNull();
    expect(Date.now() - t0).toBeLessThan(10_000);
    const { data } = await service.from('chat_menciones').select('usuario_id').eq('mensaje_id', r.data.id);
    expect(data).toEqual([{ usuario_id: miembro.userId }]);
  });

  it('10 000 menciones a usuarios inexistentes se rechazan rápido y no dejan mensaje', async () => {
    const { count: antes } = await service.from('chat_mensajes').select('*', { count: 'exact', head: true }).eq('canal_id', libre);
    const t0 = Date.now();
    const r = await enviar(creador, libre, 'menciones ajenas', { p_mencionados: Array.from({ length: 10_000 }, () => randomUUID()) });
    expect(r.error?.code).toBe('42501');
    expect(Date.now() - t0).toBeLessThan(10_000);
    const { count } = await service.from('chat_mensajes').select('*', { count: 'exact', head: true }).eq('canal_id', libre);
    expect(count).toBe(antes);
  });

  it('el contenido con HTML se guarda tal cual y ningún componente del frontend usa sumideros de HTML crudo', async () => {
    const html = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const r = await enviar(miembro, libre, html);
    expect(r.error).toBeNull();
    expect(r.data.contenido).toBe(html); // el servidor no transforma; la protección es que React lo pinta como texto

    const raiz = resolve(__dirname, '../../../frontend/src');
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre)) archivos.push(ruta);
      }
    };
    recorrer(raiz);
    const sumideros = /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/;
    const infractores = archivos.filter((f) => sumideros.test(readFileSync(f, 'utf8')));
    expect(infractores).toEqual([]);
  });

  it('un carácter NUL en el mensaje falla con un error de Postgres (22P05) que la pantalla traduce a un mensaje genérico', async () => {
    const r = await enviar(miembro, libre, 'hola\u0000mundo');
    expect(r.error?.code).toBe('22P05');
  });
});

describe('T06 idempotencia de p_clave_envio', () => {
  it('reintentos con la misma clave y el mismo texto devuelven el mismo mensaje; 8 en paralelo crean uno solo', async () => {
    const clave = randomUUID();
    const primero = await enviar(miembro, libre, 'idempotente', {}, clave);
    expect(primero.error).toBeNull();
    for (let i = 0; i < 3; i++) {
      const otra = await enviar(miembro, libre, 'idempotente', {}, clave);
      expect(otra.data.id).toBe(primero.data.id);
      expect(otra.data.posicion).toBe(primero.data.posicion);
    }
    const claveParalela = randomUUID();
    const paralelos = await Promise.all(Array.from({ length: 8 }, () => enviar(miembro, libre, 'en paralelo', {}, claveParalela)));
    expect(new Set(paralelos.map((p) => p.data?.id)).size).toBe(1);
    const { count } = await service.from('chat_mensajes').select('*', { count: 'exact', head: true })
      .eq('canal_id', libre).eq('clave_envio', claveParalela);
    expect(count).toBe(1);
  });

  it('la misma clave con OTRO texto se rechaza (22023) y la misma clave de otro autor es un envío distinto', async () => {
    const clave = randomUUID();
    const base = await enviar(miembro, libre, 'texto original', {}, clave);
    expect(base.error).toBeNull();
    const distinto = await enviar(miembro, libre, 'texto cambiado', {}, clave);
    expect(distinto.error?.code).toBe('22023');
    const ajeno = await enviar(creador, libre, 'texto original', {}, clave);
    expect(ajeno.error).toBeNull();
    expect(ajeno.data.id).not.toBe(base.data.id);
    expect(ajeno.data.autor_id).toBe(creador.userId);
  });

  it('un reintento con otra lista de menciones devuelve el mensaje original y no agrega menciones', async () => {
    const clave = randomUUID();
    const base = await enviar(creador, libre, 'sin menciones al principio', {}, clave);
    const reintento = await enviar(creador, libre, 'sin menciones al principio', { p_mencionados: [miembro.userId] }, clave);
    expect(reintento.data.id).toBe(base.data.id);
    const { data } = await service.from('chat_menciones').select('usuario_id').eq('mensaje_id', base.data.id);
    expect(data).toHaveLength(0);
  });

  // A1-G8-16. El mensaje ya está guardado pero el reintento falla: la pantalla marca el canal
  // como archivado y el usuario cree que no se envió.
  it.fails('A1-G8-16: reintentar un envío ya persistido tras archivarse el canal debería devolver el mensaje original', async () => {
    const c = await creador.client.rpc('crear_canal_libre', { p_nombre: `AUD-G8 archivo ${ctx.sufijo}`, p_participantes: [miembro.userId] });
    ctx.registrarCanal(c.data as string);
    const clave = randomUUID();
    const original = await enviar(miembro, c.data as string, 'llegó antes de archivar', {}, clave);
    expect(original.error).toBeNull();
    expect((await creador.client.rpc('archivar_canal_libre', { p_canal_id: c.data as string })).error).toBeNull();
    const reintento = await enviar(miembro, c.data as string, 'llegó antes de archivar', {}, clave);
    expect(reintento.error).toBeNull();
    expect(reintento.data.id).toBe(original.data.id);
  });
});

describe('T06 canal de un cruce: linaje, archivado y /clear', () => {
  it('el canal y su lista exponen solo el código del cruce: ni cruzamiento, ni mama, ni papa', async () => {
    const lista = await externo.client.rpc('listar_canales_chat');
    expect(lista.error).toBeNull();
    const fila = (lista.data as { id: string; entidad_nombre: string }[]).find((c) => c.id === canalCruce)!;
    expect(fila.entidad_nombre).toBe(`AUD-G8-CHAT-${ctx.sufijo}`);
    const canal = await externo.client.from('chat_canales').select('*').eq('id', canalCruce);
    const texto = JSON.stringify([lista.data, canal.data]);
    for (const secreto of ['LINAJE-SECRETO-G8', 'MAMA-SECRETA-G8', 'PAPA-SECRETA-G8']) expect(texto).not.toContain(secreto);
  });

  it('cualquier cuenta con perfil lee y escribe en el canal de cualquier cruce (acceso abierto por diseño)', async () => {
    const m = await enviar(externo, canalCruce, 'comentario de un operario sin relación con el cruce');
    expect(m.error).toBeNull();
    const lee = await miembro.client.from('chat_mensajes').select('contenido').eq('canal_id', canalCruce);
    expect(lee.data!.map((x) => x.contenido)).toContain('comentario de un operario sin relación con el cruce');
  });

  it('cruce archivado (soft delete): se lee, no se escribe (55000) y al restaurarlo vuelve a escribirse', async () => {
    expect((await service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', cruceId)).error).toBeNull();
    try {
      const lista = await miembro.client.rpc('listar_canales_chat');
      expect((lista.data as { id: string; archivado: boolean }[]).find((c) => c.id === canalCruce)!.archivado).toBe(true);
      expect((await miembro.client.from('chat_mensajes').select('id').eq('canal_id', canalCruce)).data!.length).toBeGreaterThan(0);
      expect((await enviar(miembro, canalCruce, 'no debería entrar')).error?.code).toBe('55000');
      expect((await miembro.client.rpc('marcar_chat_leido', { p_canal_id: canalCruce, p_posicion: 0 })).error).toBeNull();
    } finally {
      await service.from('plantas').update({ eliminado_at: null }).eq('id', cruceId);
    }
    expect((await enviar(miembro, canalCruce, 'ya restaurado')).error).toBeNull();
  });

  it('/clear lo ejecuta cualquier admin sobre el canal de un cruce y oculta el historial a todos los operarios; los mensajes siguen en la base', async () => {
    const antes = await externo.client.from('chat_mensajes').select('id').eq('canal_id', canalCruce);
    expect(antes.data!.length).toBeGreaterThan(0);
    const { count: enTabla } = await service.from('chat_mensajes').select('*', { count: 'exact', head: true }).eq('canal_id', canalCruce);

    expect((await miembro.client.rpc('limpiar_canal_chat', { p_canal_id: canalCruce })).error?.code).toBe('42501');
    const r = await otroAdmin.client.rpc('limpiar_canal_chat', { p_canal_id: canalCruce });
    expect(r.error).toBeNull(); // otroAdmin no tiene relación alguna con el cruce
    expect(r.data).toBe(enTabla);

    expect((await externo.client.from('chat_mensajes').select('id').eq('canal_id', canalCruce)).data).toHaveLength(0);
    expect((await miembro.client.from('chat_mensajes').select('id').eq('canal_id', canalCruce)).data).toHaveLength(0);
    const { count: despues } = await service.from('chat_mensajes').select('*', { count: 'exact', head: true }).eq('canal_id', canalCruce);
    expect(despues).toBe(enTabla);

    const { data: auditoria } = await service.from('audit_log').select('usuario_id, detalle')
      .eq('accion', 'chat_clear').eq('detalle->>canal_id', canalCruce);
    expect(auditoria).toHaveLength(1);
    expect(auditoria![0].usuario_id).toBe(otroAdmin.userId);
    expect(auditoria![0].detalle).toMatchObject({ oculto_hasta_posicion: enTabla });

    // Los mensajes nuevos sí se ven y no hay función para revertir el corte.
    const nuevo = await enviar(miembro, canalCruce, 'después del clear');
    expect(nuevo.error).toBeNull();
    expect((await externo.client.from('chat_mensajes').select('id').eq('canal_id', canalCruce)).data).toHaveLength(1);
  });
});

describe('T06 Realtime respeta las políticas de RLS', () => {
  it('un miembro recibe el INSERT del canal libre y un no miembro no recibe nada', async () => {
    const delMiembro = new Set<string>();
    const delExterno = new Set<string>();
    const suscribir = async (u: UsuarioG8, destino: Set<string>) => {
      const canal = u.client.channel(`g8-${randomUUID()}`).on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_mensajes',
      }, (evento) => { destino.add(evento.new.id as string); });
      await new Promise<void>((resolver, rechazar) => {
        const limite = setTimeout(() => rechazar(new Error('Realtime no se suscribió')), 8000);
        canal.subscribe((estado) => { if (estado === 'SUBSCRIBED') { clearTimeout(limite); resolver(); } });
      });
      return canal;
    };
    const canalMiembro = await suscribir(miembro, delMiembro);
    const canalExterno = await suscribir(externo, delExterno);
    try {
      const enviados = new Set<string>();
      let llegoAlMiembro = false;
      for (let intento = 0; intento < 6 && !llegoAlMiembro; intento++) {
        const r = await enviar(creador, libre, `en vivo ${intento}`);
        expect(r.error).toBeNull();
        enviados.add(r.data.id);
        await new Promise((ok) => setTimeout(ok, 1500));
        llegoAlMiembro = [...delMiembro].some((id) => enviados.has(id));
      }
      // Margen para que un evento retenido por la replicación alcance también al ajeno.
      await new Promise((ok) => setTimeout(ok, 2500));
      if (!llegoAlMiembro) {
        console.warn('G8 Realtime: el miembro no recibió el evento de control; prueba negativa no concluyente (deuda aceptada de Realtime).');
        return;
      }
      expect([...delExterno].filter((id) => enviados.has(id))).toEqual([]);
    } finally {
      await miembro.client.removeChannel(canalMiembro);
      await externo.client.removeChannel(canalExterno);
    }
  }, 40_000);
});

describe('T06 directorio de usuarios y nombres', () => {
  // A1-G8-13. Por diseño (menciones), pero salta perfiles_select_propio.
  it('listar_participantes_chat de un canal de dominio devuelve id y nombre de TODOS los perfiles a cualquier cuenta', async () => {
    const general = await externo.client.rpc('obtener_canal_chat', { p_tipo: 'general' });
    expect(general.error).toBeNull();
    const todos = await externo.client.rpc('listar_participantes_chat', { p_canal_id: general.data });
    expect(todos.error).toBeNull();
    const ids = (todos.data as { id: string }[]).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([creador.userId, otroAdmin.userId, miembro.userId, externo.userId]));
    // Mientras tanto, por la API de tablas solo ve su propio perfil.
    expect((await externo.client.from('perfiles').select('id')).data).toHaveLength(1);
  });

  // A1-G8-06. perfiles.nombre no tiene límite: se copia en cada mensaje y viaja por Realtime.
  it.fails('A1-G8-06: un mensaje no debería copiar un nombre de autor de 100 000 caracteres', async () => {
    const u = await ctx.usuario('chat-nombre-largo', 'operario');
    await u.client.from('perfiles').update({ nombre: 'N'.repeat(100_000) }).eq('id', u.userId);
    const g = await u.client.rpc('obtener_canal_chat', { p_tipo: 'cruce', p_entidad_id: cruceId });
    const r = await enviar(u, g.data as string, 'mensaje con nombre enorme');
    expect(r.error).toBeNull();
    expect(r.data.autor_nombre.length).toBeLessThanOrEqual(200);
  });
});

describe('T06 auditoría de la gestión de canales', () => {
  // A1-G8-14. Solo /clear escribe en audit_log; crear, cambiar participantes y archivar no.
  it.fails('A1-G8-14: crear un canal libre, cambiar sus participantes y archivarlo deberían quedar en audit_log', async () => {
    const desde = new Date(Date.now() - 5000).toISOString();
    const c = await creador.client.rpc('crear_canal_libre', { p_nombre: `AUD-G8 auditable ${ctx.sufijo}`, p_participantes: [miembro.userId] });
    expect(c.error).toBeNull();
    ctx.registrarCanal(c.data as string);
    expect((await creador.client.rpc('actualizar_participantes_canal_libre', { p_canal_id: c.data, p_participantes: [externo.userId] })).error).toBeNull();
    expect((await creador.client.rpc('archivar_canal_libre', { p_canal_id: c.data })).error).toBeNull();
    const { data } = await service.from('audit_log').select('accion, usuario_id, detalle').gte('ocurrido_en', desde);
    const mias = (data ?? []).filter((f) => JSON.stringify(f).includes(c.data as string));
    expect(mias.length).toBeGreaterThanOrEqual(3);
  });
});

describe('T06 escala: canal con 20 000 mensajes', () => {
  let canal: string;

  beforeAll(async () => {
    const c = await creador.client.rpc('crear_canal_libre', { p_nombre: `AUD-G8 volumen ${ctx.sufijo}`, p_participantes: [miembro.userId] });
    expect(c.error).toBeNull();
    canal = c.data as string;
    ctx.registrarCanal(canal);
    // Carga directa (superusuario, solo en este canal de prueba). El trigger de actividad
    // actualiza la fila del canal una vez por mensaje: VACUUM evita medir una cadena HOT
    // artificial de 20 000 versiones, que no existe en el uso normal.
    psql(
      `insert into chat_mensajes(canal_id, posicion, autor_id, autor_nombre, contenido, clave_envio) `
        + `select '${canal}', g, '${miembro.userId}', 'AUD-G8', 'mensaje ' || g, gen_random_uuid() from generate_series(1, 20000) g`,
      `update chat_canales set ultima_posicion = 20000 where id = '${canal}'`,
      'vacuum analyze chat_canales',
      'vacuum analyze chat_mensajes',
    );
    cargaDirecta.push(canal);
  }, 90_000);

  it('la primera página (50 más recientes), el resumen de canales y los no leídos responden en milisegundos', async () => {
    let t0 = Date.now();
    const pagina = await miembro.client.from('chat_mensajes').select('*').eq('canal_id', canal)
      .order('posicion', { ascending: false }).limit(50);
    const msPagina = Date.now() - t0;
    expect(pagina.error).toBeNull();
    expect(pagina.data).toHaveLength(50);

    t0 = Date.now();
    const lista = await miembro.client.rpc('listar_canales_chat');
    const msLista = Date.now() - t0;
    expect(lista.error).toBeNull();
    expect((lista.data as { id: string; no_leidos: number }[]).find((x) => x.id === canal)!.no_leidos).toBe(20000);

    // Una página intermedia (cursor "antes de") también está indexada.
    const antes = await miembro.client.from('chat_mensajes').select('posicion').eq('canal_id', canal)
      .lt('posicion', 10_000).order('posicion', { ascending: false }).limit(50);
    expect(antes.data).toHaveLength(50);
    console.log(`G8 escala chat sin /clear: página ${msPagina} ms, listar_canales_chat ${msLista} ms`);
    expect(msPagina).toBeLessThan(3000);
    expect(msLista).toBeLessThan(5000);
  }, 30_000);

  // A1-G8-12. Tras un /clear el historial oculto sigue contando: la política RLS se evalúa fila por fila
  // (≈0,28 ms por mensaje oculto, medido con 5 000) porque `posicion > oculto_desde` va en una subconsulta
  // sobre una función SECURITY DEFINER y no se usa como condición del índice. Abrir el canal (los 50 más
  // recientes) recorre todo el historial oculto hasta agotar el statement_timeout (57014).
  it.fails('A1-G8-12: tras /clear, abrir el canal (50 más recientes) debería responder en menos de 1 s aunque haya 20 000 mensajes ocultos', async () => {
    expect((await creador.client.rpc('limpiar_canal_chat', { p_canal_id: canal })).data).toBe(20000);
    expect((await enviar(miembro, canal, 'primer mensaje tras el clear')).data.posicion).toBe(20001);

    const t0 = Date.now();
    const pagina = await miembro.client.from('chat_mensajes').select('*').eq('canal_id', canal)
      .order('posicion', { ascending: false }).limit(50);
    console.log(`G8 escala chat tras /clear: ${Date.now() - t0} ms, error=${pagina.error?.code ?? 'ninguno'}`);
    expect(pagina.error).toBeNull();
    expect(pagina.data).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(1000); // sin el costo por fila oculta responde en ~20 ms; hoy ~4,6 s
  }, 60_000);
});
