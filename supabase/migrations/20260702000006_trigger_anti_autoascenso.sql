-- =============================================================================
-- MIGRACIÓN 006 — TRIGGER ANTI-AUTO-ASCENSO EN PERFILES
--
-- Problema que cierra: la policy perfiles_update_propio permite a un usuario
-- actualizar SU PROPIA fila de perfiles, incluida la columna rol. Sin este
-- trigger, un operario podía hacer UPDATE perfiles SET rol = 'admin' sobre sí
-- mismo y quedar con acceso total al linaje. Escalada de privilegios directa.
--
-- Alcance AMPLIADO respecto del pedido original (decisión explícita):
-- se protege la columna rol Y TAMBIÉN puede_ver_linaje. Motivo: auto-concederse
-- puede_ver_linaje = true da acceso al linaje genético (el activo que este
-- sistema protege) sin necesidad de ser admin — misma severidad que el
-- auto-ascenso de rol, mismo vector (UPDATE a la fila propia), así que cerrar
-- una sola de las dos columnas dejaba la puerta abierta por la otra.
-- =============================================================================

create or replace function bloquear_autoascenso()
returns trigger
language plpgsql
security definer            -- corre con permisos del dueño para poder consultar
set search_path = public    -- perfiles vía es_admin() sin depender del RLS del invocante
as $$
begin
  -- Contexto SIN usuario de API (auth.uid() es null): SQL Editor de Studio,
  -- service_role, migraciones. Son contextos administrativos que ya saltean
  -- RLS; bloquearlos acá solo rompería la gestión manual de roles que hoy se
  -- hace desde Studio. Un cliente anónimo de la API también tiene auth.uid()
  -- null, pero ese caso ya no llega hasta acá: las policies de RLS de perfiles
  -- le niegan el UPDATE antes de que el trigger se dispare.
  if auth.uid() is null then
    return new;
  end if;

  -- Si el que ejecuta NO es admin, no puede cambiar ni rol ni puede_ver_linaje
  -- (ni el suyo ni el de nadie — la policy ya lo limita a su propia fila, pero
  -- el trigger no depende de eso: defensa en profundidad).
  if not es_admin() then
    if new.rol is distinct from old.rol then
      raise exception 'Solo un admin puede cambiar el rol de un perfil'
        using errcode = '42501';  -- insufficient_privilege
    end if;
    if new.puede_ver_linaje is distinct from old.puede_ver_linaje then
      raise exception 'Solo un admin puede cambiar el permiso de linaje'
        using errcode = '42501';
    end if;
  end if;

  -- CASO LÍMITE DOCUMENTADO (hoy permitido a propósito): un admin puede
  -- cambiarse SU PROPIO rol, incluido degradarse a operario. Riesgo: si el
  -- ÚLTIMO admin se degrada, el sistema queda sin ningún admin operable desde
  -- la API (recuperable solo entrando por Studio/SQL, que es aceptable para un
  -- equipo de 5-10 personas con acceso al dashboard de Supabase). Si esto
  -- preocupa, la protección adicional sería: contar los admins restantes y
  -- rechazar la degradación cuando old.rol='admin' y quedaría cero. Queda
  -- anotado en PLAN.md como decisión a revisar; no se implementa sin pedido.

  return new;
end;
$$;

comment on function bloquear_autoascenso is 'Impide que un no-admin cambie rol o puede_ver_linaje (anti escalada de privilegios).';

create trigger trg_perfiles_anti_autoascenso
  before update on perfiles
  for each row execute function bloquear_autoascenso();
