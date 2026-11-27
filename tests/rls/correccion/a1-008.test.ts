import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { contexto, especieArandano, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';

let ctx: Contexto;
let especie: string;
const plantas: string[] = [];
const variedades: string[] = [];
const cuentas: string[] = [];
const individuos: string[] = [];

beforeAll(async () => { ctx = contexto(); especie = await especieArandano(ctx); });
afterAll(async () => {
  if (individuos.length) expect((await ctx.service.from('individuos').delete().in('id', individuos)).error).toBeNull();
  if (plantas.length) expect((await ctx.service.from('plantas').delete().in('id', plantas)).error).toBeNull();
  if (variedades.length) expect((await ctx.service.from('variedades').delete().in('id', variedades)).error).toBeNull();
  for (const id of cuentas) expect((await ctx.service.auth.admin.deleteUser(id)).error).toBeNull();
});

async function preparar(etiqueta: string) {
  const u = await usuario(ctx, `fix008-${etiqueta}`, 'operario');
  cuentas.push(u.id);
  const pl = await ctx.service.from('plantas').insert({ codigo_sistema: `FIX008-${ctx.R}-${etiqueta}`, especie_id: especie, es_prueba: true }).select('id').single();
  expect(pl.error).toBeNull();
  plantas.push(pl.data!.id);
  return { u, planta: pl.data!.id };
}

describe('A1-008 identidad de bajas', () => {
  it.each(['perfil', 'auth'])('baja por %s preserva correo/nombre de lecturas y cuenta autoría sin alterar FK', async modo => {
    const { u, planta } = await preparar(modo);
    const variedad = await ctx.service.from('variedades').insert({ nombre: `FIX008-${ctx.R}-${modo}`, especie_id: especie, created_by: u.id }).select('id').single();
    expect(variedad.error).toBeNull();
    variedades.push(variedad.data!.id);
    const evento = await ctx.service.from('registros_evento').insert({ planta_id: planta, tipo_evento: 'otro', created_by: u.id }).select('id').single();
    expect(evento.error).toBeNull();
    expect((await u.client.rpc('obtener_planta', { p_planta_id: planta })).error).toBeNull();
    const antes = await ctx.service.from('audit_log').select('id, detalle').eq('usuario_id', u.id).eq('accion', 'lectura_ficha').single();
    expect(antes.error).toBeNull();
    const borrado = modo === 'auth' ? await ctx.service.auth.admin.deleteUser(u.id) : await ctx.service.from('perfiles').delete().eq('id', u.id);
    expect(borrado.error).toBeNull();
    if (modo === 'auth') cuentas.splice(cuentas.indexOf(u.id), 1);
    const despues = await ctx.service.from('audit_log').select('usuario_id, detalle').eq('id', antes.data!.id).single();
    expect(despues.error).toBeNull();
    expect(despues.data!.usuario_id).toBeNull();
    expect(despues.data!.detalle).toEqual({ ...antes.data!.detalle, usuario_eliminado: { id: u.id, correo: u.email, nombre: u.email } });
    const baja = await ctx.service.from('audit_log').select('detalle').eq('accion', 'baja_perfil').eq('detalle->>perfil_id', u.id).single();
    expect(baja.error).toBeNull();
    expect(baja.data!.detalle).toMatchObject({ perfil_id: u.id, correo: u.email, nombre: u.email, rol: 'operario', puede_ver_linaje: false,
      autoria_cientifica: { variedades: 1, registros_evento: 1 } });
    // 20 desde la fase 5 (paso 56): reactivacion_individuo.created_by también cuenta como autoría; 21 desde el paso 59 (pedido_correccion).
    expect(Object.keys(baja.data!.detalle.autoria_cientifica)).toHaveLength(21);
    expect((await ctx.service.from('variedades').select('created_by').eq('id', variedad.data!.id).single()).data!.created_by).toBeNull();
    expect((await ctx.service.from('registros_evento').select('created_by').eq('id', evento.data!.id).single()).data!.created_by).toBeNull();
  });

  it('una guarda RESTRICT existente conserva perfil y revierte toda la auditoría de baja', async () => {
    const { u, planta } = await preparar('restrict');
    const ind = await ctx.service.from('individuos').insert({ planta_id: planta, created_by: u.id, codigo_display: '' }).select('id').single();
    expect(ind.error).toBeNull();
    individuos.push(ind.data!.id);
    expect((await ctx.service.auth.admin.deleteUser(u.id)).error).not.toBeNull();
    expect((await ctx.service.from('perfiles').select('id').eq('id', u.id).single()).error).toBeNull();
    const baja = await ctx.service.from('audit_log').select('id').eq('accion', 'baja_perfil').eq('detalle->>perfil_id', u.id);
    expect(baja.error).toBeNull();
    expect(baja.data).toEqual([]);
  });

  it('enriquecer una auditoría histórica y aplicar SET NULL no redacta su detalle; un INSERT nuevo sí', () => {
    const sql = `begin;
      create temporary table prueba_audit_historico (id int, usuario_id uuid, detalle jsonb) on commit drop;
      alter table prueba_audit_historico enable row level security;
      insert into prueba_audit_historico values (1, gen_random_uuid(), '{"cruzamiento":"HISTORICO-SIN-DECISION","dato":7}');
      create trigger probar_redaccion before insert or update on prueba_audit_historico for each row execute function public.redactar_auditoria_linaje();
      update prueba_audit_historico set detalle = detalle || '{"usuario_eliminado":{"id":"id-local","correo":"local@test.local","nombre":"Local"}}';
      update prueba_audit_historico set usuario_id = null;
      insert into prueba_audit_historico values (2, null, '{"cruzamiento":"NUEVO-NO-DEBE-COPIARSE","dato":8}');
      do $$ begin
        if not exists (select 1 from prueba_audit_historico where id=1 and detalle->>'cruzamiento'='HISTORICO-SIN-DECISION' and detalle->>'dato'='7' and detalle->'usuario_eliminado'->>'nombre'='Local') then raise exception 'FAIL: histórico alterado'; end if;
        if exists (select 1 from prueba_audit_historico where id=2 and detalle ? 'cruzamiento') then raise exception 'FAIL: nuevo texto copiado'; end if;
      end $$;
      rollback;`;
    expect(() => execFileSync('docker', ['exec', '-i', 'supabase_db_dbsecurity-frutales', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql })).not.toThrow();
  });
});
