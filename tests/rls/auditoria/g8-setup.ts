/**
 * Preparación común de las pruebas del grupo G8 (auditoría integral, Corrida 1):
 * transversales (sesión, perfil, usuarios, catálogos, chat).
 *
 * Usuarios propios `aud-g8-...@test.local`, especies `AUD-G8 ...` y cruces
 * `es_prueba = true` con código `AUD-G8-...`. El cliente `service` (service_role)
 * solo se usa para preparar y limpiar; los permisos se prueban siempre con
 * clientes logueados con la clave anon (sujetos al RLS).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';

export interface UsuarioG8 {
  client: SupabaseClient;
  userId: string;
  email: string;
}

export const PASSWORD_G8 = 'test-password-123';

export function clienteSinSesion(creds: LocalCreds): SupabaseClient {
  return createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class ContextoG8 {
  readonly creds: LocalCreds = getLocalCreds();
  readonly sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  readonly service: SupabaseClient = createClient(this.creds.url, this.creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  readonly anon: SupabaseClient = clienteSinSesion(this.creds);

  private usuarios: string[] = [];
  private especies: string[] = [];
  private plantas: string[] = [];
  private canales: string[] = [];
  private variedades: string[] = [];
  private filas: [string, string][] = [];

  /** Crea un usuario de prueba (con su perfil) y lo registra para borrarlo al final. */
  async usuario(tema: string, rol: 'admin' | 'operario', puedeVerLinaje = false): Promise<UsuarioG8> {
    const email = `aud-g8-${tema}-${this.sufijo}@test.local`;
    const { client, userId } = await crearUsuarioDePrueba(this.creds, this.service, { email, rol, puedeVerLinaje });
    this.usuarios.push(userId);
    return { client, userId, email };
  }

  /** Registra un usuario creado por otro camino (p. ej. signup) para limpiarlo. */
  registrarUsuario(userId: string) {
    this.usuarios.push(userId);
  }

  async especie(tema: string): Promise<string> {
    const { data, error } = await this.service
      .from('especies')
      .insert({ nombre: `AUD-G8 ${tema} ${this.sufijo}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`setup especie ${tema}: ${error?.message}`);
    this.especies.push(data.id as string);
    return data.id as string;
  }

  async variedad(especieId: string, nombre: string, creadoPor: string | null = null): Promise<string> {
    const { data, error } = await this.service
      .from('variedades')
      .insert({ especie_id: especieId, nombre, created_by: creadoPor })
      .select('id')
      .single();
    if (error || !data) throw new Error(`setup variedad ${nombre}: ${error?.message}`);
    this.variedades.push(data.id as string);
    return data.id as string;
  }

  /** Cruce de prueba creado con service_role. */
  async cruce(
    codigo: string,
    especieId: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const { data, error } = await this.service
      .from('plantas')
      .insert({
        codigo_sistema: `AUD-G8-${codigo}-${this.sufijo}`,
        especie_id: especieId,
        estado: 'polinizacion',
        es_prueba: true,
        ...extra,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`setup cruce ${codigo}: ${error?.message}`);
    this.plantas.push(data.id as string);
    return data.id as string;
  }

  /** Registra una fila creada por la API (tabla, id) para borrarla al final con service_role. */
  registrarFila(tabla: string, id: string) {
    this.filas.push([tabla, id]);
  }

  registrarCanal(canalId: string) {
    this.canales.push(canalId);
  }

  /**
   * Limpieza en orden de dependencia. Todo con service_role y tolerante a
   * fallos parciales (cada paso se intenta aunque otro falle).
   */
  async limpiar(): Promise<void> {
    const s = this.service;
    const intentar = async (f: () => PromiseLike<unknown>) => {
      try { await f(); } catch { /* limpieza best-effort */ }
    };

    for (const canal of this.canales) {
      await intentar(async () => {
        // max_rows de PostgREST es 1000 y la URL no admite listas largas: tandas de 100 hasta vaciar el canal.
        for (let vuelta = 0; vuelta < 1000; vuelta++) {
          const { data: ms } = await s.from('chat_mensajes').select('id').eq('canal_id', canal).limit(100);
          const ids = (ms ?? []).map((m) => m.id as string);
          if (ids.length === 0) break;
          await s.from('chat_menciones').delete().in('mensaje_id', ids);
          await s.from('chat_mensajes').delete().in('id', ids);
        }
        await s.from('audit_log').delete().eq('accion', 'chat_clear').eq('detalle->>canal_id', canal);
        await s.from('chat_canales').delete().eq('id', canal);
      });
    }
    if (this.plantas.length) {
      await intentar(() => s.from('audit_log').delete().in('planta_id', this.plantas));
      await intentar(() => s.from('individuos').delete().in('planta_id', this.plantas));
      await intentar(() => s.from('plantas').delete().in('id', this.plantas));
    }
    for (const [tabla, id] of this.filas) await intentar(() => s.from(tabla).delete().eq('id', id));
    if (this.variedades.length) await intentar(() => s.from('variedades').delete().in('id', this.variedades));
    for (const e of this.especies) {
      await intentar(() => s.from('variedades').delete().eq('especie_id', e));
      await intentar(() => s.from('especies').delete().eq('id', e));
    }
    if (this.usuarios.length) {
      await intentar(() => s.from('audit_log').delete().in('usuario_id', this.usuarios));
      await intentar(() => s.from('individuos').delete().in('created_by', this.usuarios));
    }
    for (const id of this.usuarios) await intentar(() => s.auth.admin.deleteUser(id));
  }
}
