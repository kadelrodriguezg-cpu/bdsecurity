-- Corrección de seguridad detectada durante la migración a producción.
--
-- Los default ACL del rol postgres en public concedían Dxtm a anon y
-- authenticated. Esos privilegios incluyen TRUNCATE, REFERENCES, TRIGGER y
-- MAINTAIN y se heredaron en las tablas nuevas aunque cada migración declarara
-- después sus grants funcionales explícitos.
--
-- Este REVOKE no altera SELECT, INSERT, UPDATE ni DELETE. Los permisos
-- funcionales concedidos explícitamente por las migraciones permanecen.

revoke truncate, references, trigger, maintain
on table
  public.rango_referencia,
  public.scoring_version,
  public.scoring_metrica,
  public.ranking_snapshot,
  public.ranking_snapshot_resultado
from anon, authenticated;

-- Solo cambia la ACL inicial de tablas que el rol postgres cree en public a
-- partir de este momento. No modifica permisos de tablas ya existentes.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables
  from anon, authenticated;
