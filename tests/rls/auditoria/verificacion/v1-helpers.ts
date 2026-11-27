/**
 * Auditoría integral, Corrida 1, Fase 2 (verificador independiente), grupos G1-G4.
 * Ayudas mínimas: usuarios propios `aud-v1-...@test.local` y datos `AUD-V1-...`.
 * No reutiliza helpers ni pruebas de los grupos auditados (solo ../../helpers).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../../helpers';

export interface Contexto {
  creds: LocalCreds;
  service: SupabaseClient;
  anon: SupabaseClient;
  R: number;
}

export function contexto(): Contexto {
  const creds = getLocalCreds();
  const service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return { creds, service, anon, R: Date.now() };
}

export async function usuario(ctx: Contexto, etiqueta: string, rol: 'admin' | 'operario', puedeVerLinaje = false) {
  const email = `aud-v1-${etiqueta}-${rol}-${ctx.R}@test.local`;
  const u = await crearUsuarioDePrueba(ctx.creds, ctx.service, { email, rol, puedeVerLinaje });
  return { client: u.client, id: u.userId, email };
}

export async function especieArandano(ctx: Contexto): Promise<string> {
  const { data, error } = await ctx.service.from('especies').select('id').eq('nombre', 'Arándano').single();
  if (error || !data) throw new Error(`especie Arándano: ${error?.message}`);
  return data.id as string;
}
