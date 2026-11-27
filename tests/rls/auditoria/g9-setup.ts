/**
 * Preparación común de las pruebas del grupo G9 (auditoría integral, Corrida 1):
 * módulo EVECL y políticas de Storage de los dos buckets.
 *
 * Usuarios propios `aud-g9-...@test.local`. Ensayos con `codigo_parcela` y
 * fichas con `variedad` que empiezan con `AUD-G9-`. El cliente `service`
 * (service_role) solo se usa para preparar y limpiar; los permisos se prueban
 * siempre con clientes logueados con la clave anon (sujetos al RLS).
 */
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';

export const CONTENEDOR_DB = 'supabase_db_dbsecurity-frutales';

/** SQL como superusuario en la base local (solo lectura de catálogo o limpieza de lo propio). */
export function psqlRoot(sql: string): string {
  const r = spawnSync('docker', ['exec', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql falló: ${r.stderr}\n${sql}`);
  return r.stdout;
}

export interface UsuarioG9 {
  client: SupabaseClient;
  userId: string;
  email: string;
}

export interface DescriptorG9 {
  id: number;
  codigo_upov: number | null;
  nombre: string;
  tipo: 'estado' | 'valor';
  eje: string;
  rankeable: boolean;
  direccion_ranking: string | null;
  estados: { nota: number; label: string }[];
}

export class ContextoG9 {
  readonly creds: LocalCreds = getLocalCreds();
  readonly sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  readonly service: SupabaseClient = createClient(this.creds.url, this.creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  readonly anon: SupabaseClient = createClient(this.creds.url, this.creds.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  private usuarios: string[] = [];
  private ensayos: number[] = [];
  private objetos: { bucket: string; path: string }[] = [];
  private descriptoresCreados: number[] = [];
  private descriptoresReactivar: number[] = [];

  async usuario(tema: string, rol: 'admin' | 'operario'): Promise<UsuarioG9> {
    const email = `aud-g9-${tema}-${this.sufijo}@test.local`;
    const { client, userId } = await crearUsuarioDePrueba(this.creds, this.service, { email, rol });
    this.usuarios.push(userId);
    return { client, userId, email };
  }

  /** Código de parcela único y con prefijo de auditoría. */
  codigo(tema: string): string {
    return `AUD-G9-${tema}-${this.sufijo}`;
  }

  /** Ensayo creado por el RPC (como lo haría la UI) con el cliente indicado. */
  async ensayo(cliente: SupabaseClient, tema: string, extra: Record<string, unknown> = {}): Promise<number> {
    const { data, error } = await cliente.rpc('evecl_guardar_ensayo', { p_codigo_parcela: this.codigo(tema), ...extra });
    if (error || data == null) throw new Error(`setup ensayo ${tema}: ${error?.message}`);
    this.ensayos.push(Number(data));
    return Number(data);
  }

  registrarEnsayo(id: number) {
    this.ensayos.push(id);
  }

  registrarObjeto(bucket: string, path: string) {
    this.objetos.push({ bucket, path });
  }

  /** Catálogo completo (RPC) indexado por código UPOV o por nombre. */
  async catalogo(cliente: SupabaseClient): Promise<DescriptorG9[]> {
    const { data, error } = await cliente.rpc('evecl_obtener_catalogo');
    if (error || !data) throw new Error(`catálogo: ${error?.message}`);
    return data as DescriptorG9[];
  }

  /** Crea un descriptor propio con service_role (se borra al final). */
  async descriptorPropio(tipo: 'estado' | 'valor', tema: string, estados: number[] = [1, 2, 3], rankeable = false): Promise<number> {
    const { data, error } = await this.service
      .from('evecl_descriptor')
      .insert({ nombre: `AUD-G9 ${tema} ${this.sufijo}`, tipo, eje: 'calidad', orden: 9000 + this.descriptoresCreados.length, rankeable, direccion_ranking: rankeable ? 'mayor' : null })
      .select('id')
      .single();
    if (error || !data) throw new Error(`setup descriptor ${tema}: ${error?.message}`);
    this.descriptoresCreados.push(data.id as number);
    if (tipo === 'estado') {
      const { error: e2 } = await this.service
        .from('evecl_descriptor_estado')
        .insert(estados.map((nota, i) => ({ descriptor_id: data.id, nota, label: `n${nota}`, orden: i + 1 })));
      if (e2) throw new Error(`setup estados ${tema}: ${e2.message}`);
    }
    return data.id as number;
  }

  /** Marca un descriptor del catálogo real para volver a dejarlo activo al final. */
  reactivarAlFinal(descriptorId: number) {
    this.descriptoresReactivar.push(descriptorId);
  }

  /** Borra TODO lo creado por el contexto: objetos de Storage, fichas, ensayos, descriptores propios, usuarios. */
  async limpiar(): Promise<void> {
    for (const id of this.descriptoresReactivar) {
      await this.service.from('evecl_descriptor').update({ activo: true }).eq('id', id);
    }
    const porBucket = new Map<string, string[]>();
    for (const o of this.objetos) porBucket.set(o.bucket, [...(porBucket.get(o.bucket) ?? []), o.path]);
    for (const [bucket, paths] of porBucket) await this.service.storage.from(bucket).remove(paths);

    for (const ensayoId of this.ensayos) {
      // PostgREST corta en max_rows (1000): se borra por páginas hasta que no queden fichas.
      for (;;) {
        const { data: fichas } = await this.service.from('evecl_ficha').select('id').eq('ensayo_id', ensayoId).limit(500);
        const ids = (fichas ?? []).map((f) => f.id as number);
        if (ids.length === 0) break;
        await this.service.from('evecl_respuesta').delete().in('ficha_id', ids);
        await this.service.from('evecl_ficha').delete().in('id', ids);
      }
      await this.service.from('evecl_ensayo').delete().eq('id', ensayoId);
    }
    for (const id of this.descriptoresCreados) {
      await this.service.from('evecl_respuesta').delete().eq('descriptor_id', id);
      await this.service.from('evecl_descriptor_estado').delete().eq('descriptor_id', id);
      await this.service.from('evecl_descriptor').delete().eq('id', id);
    }
    for (const id of this.usuarios) {
      await this.service.from('perfiles').delete().eq('id', id);
      await this.service.auth.admin.deleteUser(id);
    }
  }
}
