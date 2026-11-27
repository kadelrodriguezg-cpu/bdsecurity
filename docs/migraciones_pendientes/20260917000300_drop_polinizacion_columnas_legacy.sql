-- =============================================================================
-- BORRADOR DIFERIDO — Paso B: DROP COLUMN
--
-- No pertenece a supabase/migrations mientras no exista autorización
-- explícita de producción: cualquier flujo que aplique el directorio de
-- migraciones podría ejecutar un DROP irreversible. Conservarlo aquí mantiene
-- el SQL revisado y trazable sin dejarlo en una ruta ejecutable. Cuando se
-- autorice, se debe revalidar contra el esquema vigente, eliminar el
-- dual-write de frontend y recién entonces crear una nueva migración fechada.
--
-- Origen del borrador local: 20260917000300.
-- =============================================================================
--
-- MIGRACIÓN ORIGINAL 20260917000300 — Paso B: DROP COLUMN
-- plantas.fecha_polinizacion / plantas.n_flores_cruzadas
--
-- ⚠️ NO APLICAR A PRODUCCIÓN SIN AUTORIZACIÓN EXPLÍCITA POR SEPARADO. ⚠️
-- Paso A (polinizacion_evento + dual-write) ya está aplicado y verificado en
-- producción (30 filas, 24 cruces, 329 flores — ver
-- docs/BDSecurity_Documento_Maestro.md sección 0.quinviginti). Este Paso B
-- queda escrito y probado en local, a la espera de que el equipo de BDS use
-- la tabla nueva un tiempo y se confirme que ningún consumidor externo sigue
-- leyendo estas dos columnas directo.
--
-- PRERREQUISITO DE DESPLIEGUE (no lo valida esta migración, es
-- responsabilidad de quien la aplique): el frontend desplegado debe haber
-- dejado de ESCRIBIR estas columnas (fases.ts,
-- sincronizarColumnasLegacyPolinizacion) ANTES o EN EL MISMO despliegue que
-- esta migración. El dual-write se mantiene deliberadamente activo en el
-- código hoy -- a propósito, para no dejar de actualizar las columnas
-- mientras dura la ventana de observación que pidió el dueño del proyecto.
-- Si esta migración se aplica mientras ese código todavía corre en
-- producción, cada guardado de una sesión de polinización empieza a fallar
-- con "column ... does not exist".
--
-- Redefine (de nuevo) auditar_escritura_fase y reiniciar_cruzamiento sin las
-- dos columnas, y recién después las elimina -- mismo orden que
-- 20260717000000_cosecha_fruto.sql usó para conteo_f1/conteo_f2 (redefinir
-- primero lo que referencia la columna, dropear después).
-- =============================================================================

-- Última versión vigente antes de este Paso B: 20260718000000 (agregó
-- semillas_sembradas). Se redefine sin fecha_polinizacion/n_flores_cruzadas.
create or replace function auditar_escritura_fase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fecha_cosecha                 is distinct from old.fecha_cosecha
  or new.n_semillas                    is distinct from old.n_semillas
  or new.escarificacion_subtipo        is distinct from old.escarificacion_subtipo
  or new.escarificacion_duracion_dias  is distinct from old.escarificacion_duracion_dias
  or new.contenedor_id                 is distinct from old.contenedor_id
  or new.predio_id                     is distinct from old.predio_id
  or new.semillas_sembradas            is distinct from old.semillas_sembradas
  then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      new.id,
      'escritura_fase',
      array['fecha_cosecha','n_semillas','escarificacion_subtipo','escarificacion_duracion_dias','contenedor_id','predio_id','semillas_sembradas'],
      jsonb_build_object(
        'anterior', jsonb_build_object(
          'fecha_cosecha', old.fecha_cosecha, 'n_semillas', old.n_semillas,
          'escarificacion_subtipo', old.escarificacion_subtipo, 'escarificacion_duracion_dias', old.escarificacion_duracion_dias,
          'contenedor_id', old.contenedor_id, 'predio_id', old.predio_id,
          'semillas_sembradas', old.semillas_sembradas
        ),
        'nuevo', jsonb_build_object(
          'fecha_cosecha', new.fecha_cosecha, 'n_semillas', new.n_semillas,
          'escarificacion_subtipo', new.escarificacion_subtipo, 'escarificacion_duracion_dias', new.escarificacion_duracion_dias,
          'contenedor_id', new.contenedor_id, 'predio_id', new.predio_id,
          'semillas_sembradas', new.semillas_sembradas
        )
      )
    );
  end if;
  return new;
end;
$$;

comment on function auditar_escritura_fase is 'Registra en audit_log cualquier cambio en las columnas de fase (Cosecha/Siembra/Traslado, incl. semillas_sembradas) de plantas. Polinización quedó fuera desde el Paso B: su historial de escritura vive en polinizacion_evento (trg_polinizacion_evento_auditoria). Independiente de auditar_cambio_estado (solo estado).';

-- reiniciar_cruzamiento (redefinida en 20260917000100 para el dual-write del
-- Paso A) ya no puede referenciar ni nulear columnas que dejan de existir.
create or replace function reiniciar_cruzamiento(p_planta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_planta      plantas;
  v_n_individuos int;
  v_snapshot    jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede reiniciar un cruzamiento' using errcode = '42501';
  end if;

  select * into v_planta from plantas where id = p_planta_id;
  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  select count(*) into v_n_individuos from individuos where planta_id = p_planta_id;

  v_snapshot := jsonb_build_object(
    'estado_anterior', v_planta.estado,
    'fecha_cosecha', v_planta.fecha_cosecha,
    'n_semillas', v_planta.n_semillas,
    'escarificacion_subtipo', v_planta.escarificacion_subtipo,
    'escarificacion_duracion_dias', v_planta.escarificacion_duracion_dias,
    'contenedor_id', v_planta.contenedor_id,
    'predio_id', v_planta.predio_id,
    'n_individuos_preexistentes', v_n_individuos,
    'n_registros_evento', (select count(*) from registros_evento where planta_id = p_planta_id),
    'n_germinacion_eventos', (select count(*) from germinacion_evento where planta_id = p_planta_id),
    'n_cosecha_frutos', (select count(*) from cosecha_fruto where planta_id = p_planta_id),
    'n_polinizacion_eventos', (select count(*) from polinizacion_evento where planta_id = p_planta_id),
    'n_insumos', (select count(*) from plantas_insumo where planta_id = p_planta_id)
  );

  delete from registros_evento where planta_id = p_planta_id;
  delete from germinacion_evento where planta_id = p_planta_id;
  delete from cosecha_fruto where planta_id = p_planta_id;
  delete from polinizacion_evento where planta_id = p_planta_id;
  delete from plantas_insumo where planta_id = p_planta_id;

  update plantas set
    estado = 'sin_empezar',
    fecha_cosecha = null,
    n_semillas = null,
    escarificacion_subtipo = null,
    escarificacion_duracion_dias = null,
    contenedor_id = null,
    predio_id = null
  where id = p_planta_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'reinicio_cruzamiento', array['*'], v_snapshot);

  return jsonb_build_object('planta_id', p_planta_id, 'snapshot', v_snapshot, 'n_individuos_preexistentes', v_n_individuos);
end;
$$;

comment on function reiniciar_cruzamiento is 'Solo admin. Vuelve plantas.estado a sin_empezar y borra datos de fase del cruce (no toca individuos), incluyendo polinizacion_evento. Audita snapshot completo antes de borrar. Desde el Paso B, el snapshot ya no incluye fecha_polinizacion/n_flores_cruzadas (columnas eliminadas).';

-- borrar_cruzamiento (20260907001000/20260917000200) no referencia
-- fecha_polinizacion/n_flores_cruzadas en ningún punto -- no necesita
-- redefinirse para este Paso B.

alter table plantas
  drop column fecha_polinizacion,
  drop column n_flores_cruzadas;
