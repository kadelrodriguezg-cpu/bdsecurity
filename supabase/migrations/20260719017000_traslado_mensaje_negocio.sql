-- =============================================================================
-- SPRINT 5 (5/5) — Traslado: mensaje de negocio claro para destino inválido.
-- Corresponde a docs/BDSecurity_Documento_Maestro.md, Fase 2 / 2.4.3.
--
-- Hallazgo (confirmado por lectura del código, no asumido): la versión
-- anterior de registrar_traslado_individuo YA lanzaba un mensaje propio (no
-- el error crudo de FK) — 'El sector, predio o sitio no existe o está
-- inactivo' — pero genérico: no distingue CUÁL de los tres es el problema ni
-- dice "elige otro destino" como pide 2.4.3 literalmente. Se reemplaza por
-- una validación en 3 pasos que da el mensaje específico correcto en cada
-- caso.
--
-- Alcance real de este fix, documentado explícitamente (confirmado con el
-- dueño del proyecto antes de escribir código): mejorar el mensaje del RPC
-- NO basta para que el usuario lo vea hoy. frontend/src/api/client.ts
-- (traducirError) descarta TODO error.message para los códigos que ya
-- maneja — 23503, 42501, P0002, 28000, 23505 — y lo reemplaza por texto
-- genérico fijo por código, por diseño deliberado (evitar filtrar detalle de
-- linaje en mensajes crudos de Postgres). Esto significa que aunque este RPC
-- ahora lance 'Este predio está inactivo, elige otro destino', el usuario
-- seguirá viendo el mensaje genérico de traducirError hasta que Sprint 6/7
-- (frontend) agregue un caso específico para esta validación. Se documenta
-- acá para que ese sprint no lo pierda de vista — es un requisito explícito
-- pendiente, no un olvido.
--
-- Los 4 predios reales de producción están HOY con activo=false (Sprint 4):
-- cualquier traslado real que se intente ahora mismo cae en la rama "predio
-- inactivo". Se prueba exactamente contra esa condición real, no un caso
-- hipotético (ver pruebas del sprint).
-- =============================================================================

create or replace function registrar_traslado_individuo(
  p_individuo_id uuid,
  p_sector_id uuid,
  p_fecha_inicio date,
  p_referencia_operativa text default null,
  p_latitud numeric default null,
  p_longitud numeric default null,
  p_precision_metros numeric default null,
  p_ubicacion_exacta text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_planta_id uuid;
  v_estado_vital estado_vital;
  v_anterior emplazamiento_individuo%rowtype;
  v_nuevo_id uuid;
  v_sector sector%rowtype;
  v_predio predio%rowtype;
  v_sitio sitio%rowtype;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede registrar traslados territoriales'
      using errcode = '42501';
  end if;
  if p_fecha_inicio is null then
    raise exception 'La fecha de inicio es obligatoria' using errcode = '23502';
  end if;

  select i.planta_id, i.estado_vital
    into v_planta_id, v_estado_vital
  from individuos i
  where i.id = p_individuo_id;
  if not found then
    raise exception 'Individuo no encontrado' using errcode = 'P0002';
  end if;
  if v_estado_vital <> 'vivo' then
    raise exception 'No se puede trasladar un individuo que no está vivo'
      using errcode = '23514';
  end if;

  -- Validación en 3 pasos, cada uno con el mensaje de negocio específico que
  -- pide 2.4.3 ("Este predio está inactivo, elige otro destino") en vez del
  -- mensaje genérico único que combinaba sector/predio/sitio.
  select * into v_sector from sector where id = p_sector_id;
  if not found then
    raise exception 'El sector seleccionado no existe' using errcode = 'P0002';
  end if;
  if not v_sector.activo then
    raise exception 'Este sector está inactivo, elige otro destino' using errcode = '23514';
  end if;

  select * into v_predio from predio where id = v_sector.predio_id;
  if not found or not v_predio.activo then
    raise exception 'Este predio está inactivo, elige otro destino' using errcode = '23514';
  end if;

  select * into v_sitio from sitio where id = v_predio.sitio_id;
  if not found or not v_sitio.activo then
    raise exception 'Este sitio está inactivo, elige otro destino' using errcode = '23514';
  end if;

  select * into v_anterior
  from emplazamiento_individuo
  where individuo_id = p_individuo_id and fecha_fin is null
  for update;

  if found then
    if p_fecha_inicio < v_anterior.fecha_inicio then
      raise exception 'La fecha del traslado no puede anteceder al emplazamiento activo'
        using errcode = '22007';
    end if;
    update emplazamiento_individuo
    set fecha_fin = p_fecha_inicio
    where id = v_anterior.id;
  end if;

  insert into emplazamiento_individuo (
    individuo_id, sector_id, fecha_inicio, referencia_operativa, created_by
  ) values (
    p_individuo_id, p_sector_id, p_fecha_inicio,
    nullif(btrim(p_referencia_operativa), ''), v_uid
  ) returning id into v_nuevo_id;

  if p_latitud is not null
     or p_longitud is not null
     or p_precision_metros is not null
     or nullif(btrim(p_ubicacion_exacta), '') is not null then
    insert into emplazamiento_coordenada (
      emplazamiento_id, latitud, longitud, precision_metros,
      ubicacion_exacta, created_by
    ) values (
      v_nuevo_id, p_latitud, p_longitud, p_precision_metros,
      nullif(btrim(p_ubicacion_exacta), ''), v_uid
    );
  end if;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    v_planta_id,
    case when v_anterior.id is null then 'registro_emplazamiento' else 'traslado_individuo' end,
    array['individuo_id', 'sector_id', 'fecha_inicio', 'fecha_fin'],
    jsonb_build_object(
      'individuo_id', p_individuo_id,
      'emplazamiento_anterior_id', v_anterior.id,
      'sector_anterior_id', v_anterior.sector_id,
      'emplazamiento_nuevo_id', v_nuevo_id,
      'sector_nuevo_id', p_sector_id,
      'predio_nuevo_id', v_predio.id,
      'fecha_traslado', p_fecha_inicio
    )
  );

  return v_nuevo_id;
end;
$$;

comment on function registrar_traslado_individuo(uuid, uuid, date, text, numeric, numeric, numeric, text) is
  'Registra traslado territorial. Solo admin. Valida sector/predio/sitio en 3 pasos con mensaje de negocio específico por cada uno (Sprint 5, 2.4.3). PENDIENTE: frontend/src/api/client.ts traducirError() descarta error.message para 23514/23503/P0002 hoy — este mensaje no llega al usuario final hasta que Sprint 6/7 agregue un caso específico ahí.';

revoke all on function registrar_traslado_individuo(uuid, uuid, date, text, numeric, numeric, numeric, text)
  from public, anon;
grant execute on function registrar_traslado_individuo(uuid, uuid, date, text, numeric, numeric, numeric, text)
  to authenticated, service_role;
