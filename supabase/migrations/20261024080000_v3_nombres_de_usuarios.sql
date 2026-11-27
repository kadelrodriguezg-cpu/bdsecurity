-- =============================================================================
-- MIGRACIÓN 20261024080000 — NOMBRES DE COMPAÑEROS PARA CUALQUIER USUARIO AUTENTICADO (v3, decisión N15)
--
-- Antes: la RLS de `perfiles` (`perfiles_select_propio`) solo deja que un no-admin lea su propio perfil. La
-- interfaz mostraba «otra persona» en «Actividad reciente» y en la planilla de Crecimiento. El chat ya expone
-- nombres, pero solo de los participantes de una conversación (`listar_participantes_chat(p_canal_id)`), así que
-- no sirve para esto.
--
-- Ahora: `nombres_de_usuarios(p_ids uuid[])` devuelve SOLO `id` y `nombre` de los perfiles pedidos (a lo sumo
-- 200 por llamada), a cualquier usuario autenticado. No devuelve rol, permiso de linaje, fechas ni nada más del
-- perfil, ni deja listar a todos (hay que conocer el id, que ya viene en las filas que el usuario puede leer:
-- created_by de evaluaciones, eventos, PCR, bajas). La RLS de `perfiles` no cambia.
--
-- Paquete: es parte del despliegue de v3 (docs/rediseno_v3/paquete_v3.md). No se aplica sola: va después de U-03
-- (paso 40, 20261024070000) y del paso 39 (20261024060000).
-- =============================================================================

create or replace function public.nombres_de_usuarios(p_ids uuid[])
returns table (id uuid, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if coalesce(cardinality(p_ids), 0) > 200 then
    raise exception 'Se pueden pedir a lo sumo 200 nombres por vez.' using errcode = '22023';
  end if;
  return query
    select p.id, p.nombre
    from public.perfiles p
    where p.id = any (coalesce(p_ids, '{}'))
    order by p.nombre, p.id;
end;
$$;

comment on function public.nombres_de_usuarios(uuid[]) is
  'Solo id y nombre de los perfiles pedidos (máx. 200), para cualquier autenticado (N15). No expone nada más del perfil ni lista a todos.';

revoke all on function public.nombres_de_usuarios(uuid[]) from public, anon;
grant execute on function public.nombres_de_usuarios(uuid[]) to authenticated;
