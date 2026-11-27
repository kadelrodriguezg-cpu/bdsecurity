# Scripts de limpieza de datos (S3-4)

Decisión de Kadel (Sprint 3 de la Fase 2): «Limpieza de huérfanos de Storage y de sesiones/bitácora descuadradas: Sprint 3, con respaldo previo».

> **ADVERTENCIA.** Estos scripts se escribieron y probaron **solo en local** (`tests/rls/limpieza-datos.test.ts`). **Nunca se han ejecutado en producción.** En producción solo se ejecutan con el **OK escrito de Kadel** y con el **respaldo previo** hecho y verificado (ver más abajo). Los scripts de informe son de solo lectura y seguros en cualquier base; los de aplicación **modifican o borran datos**.

## Qué detecta cada clase

Cada clase sale de la auditoría integral, Corrida 1 (hallazgos 4 y 5 del resumen y la tabla de hallazgos; lo que sigue abierto está en `docs/pendientes.md`) y de sus invariantes de producción (`scripts/invariantes_produccion.sql`, cuyas consultas se reutilizan).

| # | Clase | Hallazgo / invariante | Informe (solo lectura) | Aplicación | Qué hace al aplicar |
|---|---|---|---|---|---|
| 1 | **Huérfanos de Storage**: objeto de `media-plantas` sin fila en `evento_archivos` ni `pcr_analisis.informe_pdf_url`, o de `evecl-fotos` sin `evecl_respuesta.foto_path`. Producción tenía 4 de 9 objetos en esa situación. | A1-035, A1-036, A1-037 (A1-G3-04/05/06); invariante B02 | `informe_huerfanos_storage.sql` | `aplicar_huerfanos_storage.mjs` | Borra el objeto **por la API de Storage** (el SQL no borra el binario). **Irreversible**: ver respaldo. |
| 2 | **Metadato sin objeto**: fila de `evento_archivos` cuyo `storage_path` ya no existe en `media-plantas` (ícono roto en la ficha). Producción tenía 0. | A1-G3-10; invariante B01 | `informe_metadatos_sin_objeto.sql` | `aplicar_metadatos_sin_objeto.sql` | Borra la fila de `evento_archivos` (queda entera en `audit_log.detalle.fila`). No toca `pcr_analisis` ni `evecl_respuesta` (solo las cuenta). |
| 3 | **Evento eliminado con archivos**: evento de bitácora con borrado lógico (`eliminado_at`) cuyos archivos siguen en Storage. Producción tenía 2 eventos (cruce 02-028). | A1-G3-20; invariante B03 | `informe_eventos_eliminados_con_archivos.sql` | **ninguna (solo informe)** | Nada. El evento se puede restaurar por la API; borrarle los archivos lo haría irrecuperable. Decisión de Kadel, evento por evento. |
| 4 | **Sesión sin bitácora**: fila de `polinizacion_evento` sin evento de bitácora (`tipo 'polinizacion'`, no eliminado) del mismo cruce y fecha. Producción tenía 6. | A1-G2-06 / A1-024; invariante P14 | `informe_sesiones_sin_bitacora.sql` | `aplicar_sesiones_sin_bitacora.sql` | Crea el evento de bitácora que faltó (uno por cruce y fecha, con la sesión más reciente del día), con los mismos datos que escribe la app. Excluye cruces archivados. |
| 5 | **Bitácora sin sesión** («bitácora falsa»): evento de polinización sin sesión del mismo cruce y fecha. Producción tenía 5. | A1-G2-06 / A1-024; invariante P13 | `informe_bitacora_sin_sesion.sql` | `aplicar_bitacora_sin_sesion.sql` | Marca el evento como eliminado (borrado lógico, **reversible**: `eliminado_at = null`). Solo los automatizables: sin archivos adjuntos, cruce activo y fuera de `proceso_finalizado`; el resto lo lista el informe como «revisar a mano». |

Las clases 4 y 5 son los dos lados del mismo problema (la escritura de una sesión es de cuatro pasos sin transacción, y «quitar última sesión» no toca la bitácora). El informe de la auditoría no describe ninguna otra desviación entre sesiones y bitácora; las demás fases (cosecha, germinación) no tienen invariante propia y no se cubren. A1-024 y A1-027 (rediseño del flujo de polinización) siguen para después de la Fase 2: estos scripts limpian la huella ya existente, no evitan que reaparezca.

## Cómo correr los informes (solo lectura)

Desde la raíz del repositorio, contra la base **local**:

```bash
for f in scripts/limpieza/informe_*.sql; do
  echo "######## $f"
  docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres < "$f"
done
```

Variables opcionales de psql (`-v nombre=valor`, antes del `<`):

- `filtro_codigo=<texto>`: solo cruces cuyo `codigo_sistema` empieza con ese texto (clases 2 a 5).
- `filtro_ruta=<texto>` y `min_edad_horas=<n>` (24 por defecto): clase 1. Los objetos más nuevos no cuentan, porque la app sube el binario **antes** de escribir su fila y una subida en curso se ve igual que un huérfano.

Cada informe termina en `rollback` (corre dentro de `begin read only`).

## Cómo aplicar

Todos los scripts de aplicación hacen lo mismo: **recalculan** el conjunto, **muestran el conteo** y solo actúan si se les da la autorización completa. Sin ella no cambian nada.

**Siempre en dos pasos:** primero sin confirmar (para ver el conteo y la lista), después con la confirmación y el mismo número.

Clases 2, 4 y 5 (SQL, una transacción cada una):

```bash
# 1) ver qué haría (rollback automático)
docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres \
  -v operador="Nombre de quien ejecuta" < scripts/limpieza/aplicar_sesiones_sin_bitacora.sql
# 2) aplicar, con el número que mostró el paso 1
docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres \
  -v operador="Nombre de quien ejecuta" -v esperado=3 -v confirmar=SI \
  < scripts/limpieza/aplicar_sesiones_sin_bitacora.sql
```

- `confirmar` debe ser exactamente `SI`; `esperado` debe ser igual al conteo recalculado; `operador` no puede estar vacío. Si algo falla: `rollback` y «NO SE APLICÓ NADA».
- Clase 5 además exige `-v admin_id=<uuid de un perfil admin>`: el borrado lógico de bitácora solo lo permite un admin (trigger `bloquear_borrado_no_admin`), así que el script actúa «como» ese admin solo durante el `UPDATE`, tras comprobar que el perfil es admin. Es quien autoriza (Kadel); queda como `usuario_id` en `audit_log`.
- Tras aplicar, una verificación interna comprueba que el conjunto quedó resuelto; si no, revierte todo.
- Contra producción, el comando sería el mismo con la conexión de producción (ver `docs/respaldo_produccion.md` para cómo se conecta uno): **no se ha hecho ni se hará sin el OK escrito de Kadel**.

Clase 1 (Node, por la API de Storage). Nunca lee `.env`: URL y clave van por variables de entorno explícitas.

```bash
export LIMPIEZA_SUPABASE_URL=http://127.0.0.1:54600
export LIMPIEZA_SERVICE_KEY=<service_role de ESA base>
# 1) modo seco (por defecto): lista y cuenta, no borra
node scripts/limpieza/aplicar_huerfanos_storage.mjs --listar
# 2) borrar
node scripts/limpieza/aplicar_huerfanos_storage.mjs --aplicar --esperado 4 --operador "Nombre de quien ejecuta"
```

Opciones: `--min-edad-horas <h>` (24), `--bucket media-plantas|evecl-fotos` (repetible; por defecto ambos), `--prefijo <texto>` (solo nombres que empiezan así).

- Se niega a correr si el host no es `127.0.0.1`/`localhost`/`[::1]`, salvo con `--produccion-confirmado`.
- Antes de borrar vuelve a comprobar que ningún objeto haya pasado a estar referenciado; si alguno lo está, aborta sin borrar nada.
- Escribe en `audit_log` la lista de objetos **antes** de borrar (si no puede escribirla, no borra) y un resumen al terminar.
- Códigos de salida: 0 bien; 2 entorno o argumentos; 3 falta autorización (`--esperado`/`--operador`); 4 un objeto cambió de estado; 5 algún borrado falló.

### Rastro en `audit_log`

Todas las aplicaciones escriben filas con `accion = 'limpieza_datos'` (una por elemento, con `clase`, `script`, `cambio`, `motivo`, `operador` y los identificadores o rutas afectados) y una `limpieza_datos_resumen` con los totales. El borrado lógico de la clase 5 además dispara el rastro propio de la bitácora (`eliminacion_evento`). `audit_log` es append-only desde la API: estas filas no se editan.

## Respaldo previo obligatorio

**Antes de aplicar cualquier script en producción:**

1. Respaldo lógico verificado de la base según `docs/respaldo_produccion.md` (`pg_dump -Fc`, SHA-256, `pg_restore --list`, restauración de prueba y conteos).
2. **Para la clase 1, un respaldo de los binarios.** El `pg_dump` **no incluye** los objetos de Storage (`docs/respaldo_produccion.md`, sección «Storage»), y borrar un objeto es irreversible. Con `--listar` el modo seco da la lista exacta: descargar esos objetos antes de aplicar. Si algún huérfano resulta ser una foto que alguien aún necesita, el respaldo es la única forma de recuperarla.
3. El OK escrito de Kadel con la lista revisada (el informe de cada clase, ejecutado el mismo día).

## Orden recomendado

1. Respaldo (arriba) y todos los informes. Anotar los conteos.
2. Clase 4 (crear los eventos de bitácora que faltan): no destruye nada.
3. Clase 5 (marcar la bitácora falsa): reversible. Revisar a mano los casos que el informe deja fuera.
4. Clase 2 (filas de archivo sin objeto).
5. Clase 1 (huérfanos de Storage), al final y con el respaldo de binarios: es lo único irreversible. Conviene correrla otra vez en modo seco unos días después, por si una subida lenta de la app dejó algún objeto en tránsito.
6. Volver a correr todos los informes: las clases 1, 2, 4 y 5 deben dar 0 corregibles (quedan las de «revisar a mano» y la clase 3).

## Qué no se cubre

- Inconsistencias que el informe de auditoría no respalda (no se inventaron clases).
- Clase 3: decisión humana (se informa, no se corrige).
- Referencias a objetos inexistentes en `pcr_analisis.informe_pdf_url` y `evecl_respuesta.foto_path`: solo se cuentan en el informe de la clase 2.
- Cruces archivados: no se corrigen sesiones ni bitácora de un cruce archivado (restaurarlo primero).

## Pruebas

`npx vitest run tests/rls/limpieza-datos.test.ts` (desde la raíz, contra la base y el Storage locales). Siembra casos de cada clase con el prefijo `LIMP-<marca de tiempo>` (más casos legítimos y de «revisar a mano»), comprueba que el informe encuentra solo eso, que aplicar sin autorización no cambia nada, que con ella corrige solo lo sembrado y deja rastro, y que el informe posterior da 0; al final borra todo lo sembrado. Los filtros (`filtro_codigo`, `--prefijo`) acotan la acción: las inconsistencias previas de la base local no se tocan.
