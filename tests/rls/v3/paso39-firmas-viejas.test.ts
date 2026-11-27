/**
 * Paso 39 — REVOKE de las firmas viejas de RPC.
 *
 * Con el paso aplicado (docs/migraciones_pendientes/fase2_revoke_firmas_viejas.sql,
 * versión reservada 20261024060000), `authenticated` y `anon` no pueden ejecutar:
 *   - individualizar_plantas(uuid, integer)
 *   - iniciar_ronda_evaluacion(uuid)
 *   - iniciar_ronda_multisitio(uuid, uuid)
 *   - evecl_guardar_ficha (14 argumentos)
 * y sus envolturas SECURITY DEFINER siguen funcionando para `authenticated`:
 *   - individualizar_plantas_una_vez
 *   - iniciar_ronda_esperada (pasa a SECURITY DEFINER)
 *   - evecl_guardar_ficha_con_bajas
 *
 * Esta prueba solo tiene sentido con el REVOKE aplicado. Si la base local todavía
 * no lo tiene (hoy el paso 39 está fuera de supabase/migrations), la prueba se
 * SALTA y lo dice en la consola; se activa sola cuando el REVOKE entra a la base.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoG9, type UsuarioG9 } from '../auditoria/g9-setup';
import { crearCruce, crearIndividuo, prepararContexto, purgarCruces, type ContextoG5 } from '../auditoria/g5-setup';
import { guardarFichaEvecl, individualizarPlantas, iniciarRondaAnual, iniciarRondaMultisitio, psqlInterno } from '../envolturas';

const CONTENEDOR = 'supabase_db_dbsecurity-frutales';

/** Las cuatro firmas viejas, tal como las muestra `regprocedure`. */
const FIRMAS_VIEJAS = [
  'public.individualizar_plantas(uuid,integer)',
  'public.iniciar_ronda_evaluacion(uuid)',
  'public.iniciar_ronda_multisitio(uuid,uuid)',
  'public.evecl_guardar_ficha(bigint,bigint,text,text,text,public.evecl_tipo_ficha,integer,text,text,date,date,text,jsonb,uuid)',
] as const;

function consultaSql(sql: string): string {
  const r = spawnSync('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`psql: ${r.stderr || r.error?.message}`);
  return r.stdout.trim();
}

/** ¿Está aplicado el REVOKE? Lee el privilegio real de `authenticated` en las cuatro firmas. */
function revokeAplicado(): boolean {
  try {
    const sql = `select bool_or(has_function_privilege('authenticated', f, 'EXECUTE'))::text from unnest(array[${FIRMAS_VIEJAS.map((f) => `'${f}'::regprocedure`).join(',')}]) as f;`;
    return consultaSql(sql) === 'false';
  } catch (e) {
    console.warn(`[paso39] no pude leer los privilegios de la base local: ${(e as Error).message}`);
    return false;
  }
}

const aplicado = revokeAplicado();
if (!aplicado) {
  console.warn('[paso39] SALTADA: el REVOKE de las firmas viejas (paso 39) no está aplicado en la base local; estas pruebas solo valen con el REVOKE aplicado.');
}

describe.skipIf(!aplicado)('paso 39: firmas viejas cerradas y envolturas operativas', () => {
  let g5: ContextoG5;
  let g9: ContextoG9;
  let autor: UsuarioG9;
  let cruceTras: string;
  let cruceEval: string;
  let cruceMulti: string;
  let individuoEval: string;
  let individuoMulti: string;

  beforeAll(async () => {
    g5 = await prepararContexto('paso39', { especiePropia: true });
    g9 = new ContextoG9();
    autor = await g9.usuario('paso39', 'operario');
    cruceTras = await crearCruce(g5, 'P39-TRAS', 'trasplante');
    cruceEval = await crearCruce(g5, 'P39-EVAL', 'evaluacion_anual');
    cruceMulti = await crearCruce(g5, 'P39-MULTI', 'traslado_destino');
    individuoEval = await crearIndividuo(g5, cruceEval, 'P39-E');
    individuoMulti = await crearIndividuo(g5, cruceMulti, 'P39-M');
  }, 60_000);

  afterAll(async () => {
    if (g5) {
      await purgarCruces(g5, [cruceTras, cruceEval, cruceMulti].filter(Boolean), { especieIds: [g5.especieId] });
      for (const id of [g5.operario2Id, g5.operarioId, g5.adminId]) await g5.service.auth.admin.deleteUser(id);
    }
    if (g9) await g9.limpiar();
  }, 120_000);

  describe('catálogo de privilegios', () => {
    it('authenticated y anon no tienen EXECUTE en ninguna de las cuatro firmas; service_role sí', () => {
      for (const firma of FIRMAS_VIEJAS) {
        const fila = consultaSql(
          `select has_function_privilege('authenticated', '${firma}', 'EXECUTE')::text || ',' ||
                  has_function_privilege('anon', '${firma}', 'EXECUTE')::text || ',' ||
                  has_function_privilege('service_role', '${firma}', 'EXECUTE')::text;`,
        );
        expect(fila, firma).toBe('false,false,true');
      }
    });

    it('PUBLIC tampoco tiene EXECUTE: ninguna ACL de las cuatro firmas lo concede', () => {
      for (const firma of FIRMAS_VIEJAS) {
        const aPublic = consultaSql(
          `select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where p.oid = '${firma}'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE';`,
        );
        expect(aPublic, firma).toBe('0');
      }
    });

    it('las tres envolturas siguen ejecutables por authenticated y no por anon, y las tres son SECURITY DEFINER', () => {
      for (const firma of [
        'public.individualizar_plantas_una_vez(uuid,integer,uuid)',
        'public.iniciar_ronda_esperada(uuid,text,integer)',
        'public.evecl_guardar_ficha_con_bajas(jsonb,bigint[])',
      ]) {
        const fila = consultaSql(
          `select has_function_privilege('authenticated', '${firma}', 'EXECUTE')::text || ',' ||
                  has_function_privilege('anon', '${firma}', 'EXECUTE')::text || ',' ||
                  (select prosecdef from pg_proc where oid = '${firma}'::regprocedure)::text;`,
        );
        expect(fila, firma).toBe('true,false,true');
      }
    });
  });

  describe('las cuatro firmas viejas dan 42501 (permiso denegado) a authenticated y a anon', () => {
    const llamadas: Array<[string, Record<string, unknown>]> = [
      ['individualizar_plantas', { p_planta_id: randomUUID(), p_cantidad: 1 }],
      ['iniciar_ronda_evaluacion', { p_individuo_id: randomUUID() }],
      ['iniciar_ronda_multisitio', { p_individuo_id: randomUUID(), p_predio_id: null }],
      ['evecl_guardar_ficha', { p_ensayo_id: 1, p_variedad: 'x', p_numero_repeticion: 1 }],
    ];

    it.each(llamadas)('%s: operario autenticado', async (fn, args) => {
      const { error } = await g5.operario.rpc(fn, args);
      expect(error?.code).toBe('42501');
    });

    it.each(llamadas)('%s: admin autenticado (el rol admin tampoco la conserva)', async (fn, args) => {
      const { error } = await g5.admin.rpc(fn, args);
      expect(error?.code).toBe('42501');
    });

    it.each(llamadas)('%s: anon', async (fn, args) => {
      const { error } = await g5.anon.rpc(fn, args);
      expect(error?.code).toBe('42501');
    });

    it('con datos válidos tampoco hacen efecto: no se crean individuos ni rondas por la firma vieja', async () => {
      const antesInd = await g5.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', cruceTras);
      const a = await g5.operario.rpc('individualizar_plantas', { p_planta_id: cruceTras, p_cantidad: 2 });
      expect(a.error?.code).toBe('42501');
      const despuesInd = await g5.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', cruceTras);
      expect(despuesInd.count).toBe(antesInd.count);

      const b = await g5.operario.rpc('iniciar_ronda_evaluacion', { p_individuo_id: individuoEval });
      expect(b.error?.code).toBe('42501');
      const c = await g5.operario.rpc('iniciar_ronda_multisitio', { p_individuo_id: individuoMulti });
      expect(c.error?.code).toBe('42501');
      const rondas = await g5.service.from('ronda_evaluacion_anual').select('id').in('individuo_id', [individuoEval, individuoMulti]);
      expect(rondas.data).toEqual([]);
    });

    it('la firma vieja sigue existiendo y la ejecuta el dueño (la usan las envolturas): con el JWT del operario responde por sus reglas de negocio, no por permiso', async () => {
      // El cruce está en evaluación anual, no en trasplante: la regla de fase responde con su mensaje de
      // NEGOCIO, distinto del «permission denied» que da la API a authenticated.
      const interna = await psqlInterno(g5.operarioId, `public.individualizar_plantas('${cruceEval}', 1)`);
      expect(interna.error?.code).toBe('42501');
      expect(interna.error?.message).toMatch(/trasplante/);
      expect(interna.error?.message).not.toMatch(/permission denied/);
    });
  });

  describe('las envolturas siguen funcionando para authenticated', () => {
    it('individualizar_plantas_una_vez crea el lote y reintentar con la misma clave devuelve el mismo resultado sin duplicar', async () => {
      const clave = randomUUID();
      const primera = await individualizarPlantas(g5.operario, { p_planta_id: cruceTras, p_cantidad: 2 }, clave);
      expect(primera.error).toBeNull();
      expect((primera.data as { cantidad: number }).cantidad).toBe(2);
      const repetida = await individualizarPlantas(g5.operario, { p_planta_id: cruceTras, p_cantidad: 2 }, clave);
      expect(repetida.error).toBeNull();
      expect(repetida.data).toEqual(primera.data);
      const { count } = await g5.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', cruceTras);
      expect(count).toBe(2);
    });

    it('iniciar_ronda_esperada (anual): crea la ronda 1, repetir el número la recupera y un número futuro se rechaza', async () => {
      const primera = await iniciarRondaAnual(g5.operario, individuoEval);
      expect(primera.error).toBeNull();
      expect((primera.data as { numero_ronda: number }).numero_ronda).toBe(1);
      const repetida = await iniciarRondaAnual(g5.operario, individuoEval, 1);
      expect(repetida.data).toEqual(primera.data);
      const futura = await iniciarRondaAnual(g5.operario, individuoEval, 3);
      expect(futura.error?.code).toBe('55000');
      const filas = await g5.service.from('ronda_evaluacion_anual').select('id').eq('individuo_id', individuoEval);
      expect(filas.data).toHaveLength(1);
    });

    it('iniciar_ronda_esperada (multisitio): crea la ronda 1 de la serie multisitio', async () => {
      const r = await iniciarRondaMultisitio(g5.operario, individuoMulti);
      expect(r.error).toBeNull();
      expect((r.data as { numero_ronda: number }).numero_ronda).toBe(1);
    });

    it('iniciar_ronda_esperada conserva las validaciones de negocio bajo SECURITY DEFINER: fase equivocada y individuo inexistente', async () => {
      const fase = await iniciarRondaAnual(g5.operario, individuoMulti, 1);
      expect(fase.error?.code).toBe('42501');
      const inexistente = await g5.operario.rpc('iniciar_ronda_esperada', { p_individuo_id: randomUUID(), p_tipo: 'anual', p_numero_esperado: 1 });
      expect(inexistente.error?.code).toBe('P0002');
      const anon = await g5.anon.rpc('iniciar_ronda_esperada', { p_individuo_id: individuoEval, p_tipo: 'anual', p_numero_esperado: 1 });
      expect(anon.error?.code).toBe('42501');
    });

    it('evecl_guardar_ficha_con_bajas guarda la ficha con sus respuestas; otro operario no la edita (42501) y el autor sí', async () => {
      const ensayo = await g9.ensayo(autor.client, 'P39');
      const descriptor = await g9.descriptorPropio('valor', 'P39');
      const creada = await guardarFichaEvecl(autor.client, {
        p_ensayo_id: ensayo, p_variedad: g9.codigo('P39'), p_numero_repeticion: 1,
        p_respuestas: [{ descriptor_id: descriptor, valor_numerico: 7 }],
      });
      expect(creada.error).toBeNull();
      const ficha = Number(creada.data);
      const filas = await g9.service.from('evecl_respuesta').select('descriptor_id,valor_numerico').eq('ficha_id', ficha);
      expect(filas.data).toHaveLength(1);

      const otro = await g9.usuario('paso39-otro', 'operario');
      const ajena = await guardarFichaEvecl(otro.client, { p_id: ficha, p_notas: 'x' });
      expect(ajena.error?.code).toBe('42501');
      const propia = await guardarFichaEvecl(autor.client, { p_id: ficha, p_notas: 'propia', p_respuestas: [] }, [descriptor]);
      expect(propia.error).toBeNull();
      const tras = await g9.service.from('evecl_respuesta').select('descriptor_id').eq('ficha_id', ficha);
      expect(tras.data).toEqual([]);
    });
  });
});
