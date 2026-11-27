-- =============================================================================
-- SPRINT 2 — Scoring por categorías (migración de fundaciones de datos).
-- Corresponde a docs/BDSecurity_Documento_Maestro.md, sección 2.1 y Fase 1.a.
--
-- Estado real de scoring_metrica antes de esta migración (verificado por
-- query directa, ver evidencia del sprint): existen exactamente 4 filas —
-- firmeza, calibre_mm, brix, bloom — todas pertenecientes conceptualmente a
-- Fruto/Calidad, con pesos provisionales 4-3-2-1 (comentario original: "el
-- orden aprobado firmeza > calibre > Brix > bloom", pendiente de validación
-- científica). No existe ninguna métrica de Fenología, Producción ni Estrés,
-- aunque `evaluaciones` ya captura los 15 descriptores del Excel completo.
--
-- Alcance de ESTE sprint (confirmado explícitamente): solo fundaciones de
-- datos. Se agrega la columna de categoría y se backfillea SOLO sobre las 4
-- métricas que existen hoy (las 4 son fruto_calidad, mapeo inequívoco). Se
-- crea scoring_categoria_peso y se siembran las 4 categorías con los pesos
-- del Excel para la versión activa, aunque 3 de esas categorías todavía no
-- tengan ninguna métrica registrada — el diseño ya contempla ese caso borde
-- (ver comentario de tabla más abajo: subpuntaje NULL, no 0, renormalizando
-- sobre categorías presentes). Poblar scoring_metrica con las 11 métricas
-- faltantes requeriría inventar pesos relativos intra-categoría que el Excel
-- no especifica — la misma clase de decisión que el seed original marca
-- explícitamente como provisional y pendiente de Efraín. Queda fuera de este
-- sprint; no se agregan métricas nuevas acá.
--
-- Como no hay ninguna métrica de Estrés hoy, no hay nada que invertir en este
-- sprint (direccion_favorable es un enum 'mayor'/'menor' de solo 2 valores;
-- invertirlo es mecánicamente trivial). La regla queda documentada en el
-- comentario de la columna `categoria` para que se respete cuando se
-- registren métricas de Estrés.
-- =============================================================================

create type categoria_scoring as enum ('fenologia', 'fruto_calidad', 'produccion', 'estres');

alter table scoring_metrica add column categoria categoria_scoring;

update scoring_metrica
set categoria = 'fruto_calidad'
where metrica in ('firmeza', 'calibre_mm', 'brix', 'bloom');

-- No debería quedar ninguna fila sin categoría tras el backfill de arriba;
-- si la quedara, el NOT NULL de abajo hace fallar la migración en vez de
-- dejar una métrica huérfana de categoría (una métrica sin categoría no
-- puede agregarse al ranking por categorías).
alter table scoring_metrica alter column categoria set not null;

comment on column scoring_metrica.categoria is
  'Categoría de agrupación para el ranking (2.1 del documento maestro). '
  'Toda métrica nueva de la categoría estres DEBE crearse con '
  'direccion_favorable = ''menor'' (menor daño -> mayor puntaje normalizado): '
  'el peso de la categoría es positivo (ver scoring_categoria_peso), la '
  'inversión de "-10%" de la vista legacy se modela por dirección, no por '
  'resta ni por peso negativo.';

create table scoring_categoria_peso (
  id                  uuid primary key default gen_random_uuid(),
  scoring_version_id  uuid not null references scoring_version (id) on delete restrict,
  categoria           categoria_scoring not null,
  peso                numeric not null check (peso >= 0 and peso <= 1),
  created_at          timestamptz not null default now(),
  unique (scoring_version_id, categoria)
);

comment on table scoring_categoria_peso is
  'Pesos por categoría de una versión de scoring. La suma de pesos de las '
  'filas existentes de cada scoring_version_id debe ser exactamente 1.00 '
  '(validado por trigger de restricción diferido, no por CHECK: un CHECK de '
  'fila no puede sumar sobre otras filas). Contrato de agregación para quien '
  'implemente el cálculo (RPC de Sprint 5): el subpuntaje de una categoría '
  'para un individuo es el promedio ponderado de sus métricas normalizadas '
  'CON VALOR (por scoring_metrica.peso); si el individuo no tiene ninguna '
  'métrica evaluada de esa categoría, el subpuntaje es NULL — nunca 0, para '
  'no penalizar por dato faltante. El puntaje global es la suma ponderada de '
  'los subpuntajes de categoría NO NULOS usando el peso de esta tabla, '
  'renormalizada dividiendo por la suma de pesos de las categorías '
  'presentes (no siempre por 1.00) para que la ausencia de una categoría no '
  'reduzca artificialmente el puntaje de quien simplemente no tiene esa '
  'evaluación cargada.';

alter table scoring_categoria_peso enable row level security;

create policy scoring_categoria_peso_select_autenticados on scoring_categoria_peso
  for select using (auth.uid() is not null);
create policy scoring_categoria_peso_admin_inserta on scoring_categoria_peso
  for insert with check (es_admin());
create policy scoring_categoria_peso_admin_actualiza on scoring_categoria_peso
  for update using (es_admin()) with check (es_admin());

-- Mismo patrón que scoring_version/scoring_metrica: sin DELETE. Un cambio de
-- pesos se hace con una versión nueva, no editando destructivamente la
-- vigente (trazabilidad de qué pesos produjeron qué ranking histórico).
grant select, insert, update on scoring_categoria_peso to authenticated;
grant all on scoring_categoria_peso to service_role;

-- ---------------------------------------------------------------------------
-- Validación de suma de pesos = 1.00 por scoring_version_id.
--
-- Mecanismo elegido: CONSTRAINT TRIGGER diferido (DEFERRABLE INITIALLY
-- DEFERRED), no un CHECK de columna/fila. Justificación:
--   1) Un CHECK de Postgres solo ve la fila que se está escribiendo; no puede
--      sumar `peso` de las OTRAS filas de la misma scoring_version_id. La
--      suma es una propiedad del conjunto, no de una fila individual.
--   2) Un trigger AFTER normal (no diferido) validaría después de CADA fila
--      individual. El seed de abajo inserta las 4 categorías de una versión
--      en un único INSERT de 4 filas: aun siendo un solo statement, un
--      trigger FOR EACH ROW no diferido evaluaría la suma parcial tras la
--      primera fila (0.20 ≠ 1.00) y fallaría antes de que la transacción
--      termine de insertar las 4. DEFERRABLE INITIALLY DEFERRED pospone la
--      validación hasta el COMMIT (o un SET CONSTRAINTS ... IMMEDIATE
--      explícito), permitiendo que cualquier secuencia de INSERT/UPDATE/
--      DELETE dentro de una misma transacción deje el conjunto en un estado
--      consistente solo al final, que es exactamente el caso de uso (un
--      admin editando pesos de varias categorías antes de guardar).
--   3) Se dispara también en UPDATE y DELETE: bajar un peso o borrar una
--      categoría también puede romper la suma.
--   4) Si no hay ninguna fila para esa scoring_version_id (suma NULL), no se
--      rechaza: una versión sin desglose por categoría es un estado válido
--      (compatibilidad con versiones de scoring anteriores a este sprint).
-- ---------------------------------------------------------------------------

create or replace function validar_suma_pesos_categoria_scoring()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_scoring_version_id uuid;
  v_suma numeric;
begin
  v_scoring_version_id := coalesce(new.scoring_version_id, old.scoring_version_id);

  select sum(peso) into v_suma
  from scoring_categoria_peso
  where scoring_version_id = v_scoring_version_id;

  if v_suma is not null and v_suma <> 1 then
    raise exception
      'La suma de pesos por categoría de la versión de scoring % debe ser 1.00 (actual: %)',
      v_scoring_version_id, v_suma
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger trg_validar_suma_pesos_categoria
  after insert or update or delete on scoring_categoria_peso
  deferrable initially deferred
  for each row execute function validar_suma_pesos_categoria_scoring();

-- Siembra: pesos del Excel de descriptores para la(s) versión(es)
-- actualmente activa(s). Un solo INSERT de 4 filas por versión; la
-- validación de suma corre diferida al commit de esta migración.
insert into scoring_categoria_peso (scoring_version_id, categoria, peso)
select sv.id, c.categoria, c.peso
from scoring_version sv
cross join (values
  ('fenologia'::categoria_scoring,      0.20::numeric),
  ('fruto_calidad'::categoria_scoring,  0.40::numeric),
  ('produccion'::categoria_scoring,     0.30::numeric),
  ('estres'::categoria_scoring,         0.10::numeric)
) as c(categoria, peso)
where sv.estado = 'activa';
