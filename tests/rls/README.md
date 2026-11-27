# Tests de RLS y seguridad

Tests **empíricos** del modelo de seguridad: código real que se loguea como
distintos usuarios contra la base LOCAL y verifica que policies, grants,
triggers y RPCs hacen lo que dicen. Framework: Vitest.

## Cómo correrlos

```bash
# 1) La base local tiene que estar corriendo y migrada:
npm run db:start
npm run db:reset

# 2) Correr los tests (desde la raíz):
npm test
```

Las credenciales salen de `npx supabase status` — por diseño **no pueden
apuntar a producción**. Los tests crean dos usuarios (`operario@test.local`,
`admin@test.local`) con la API admin (si ya existen los reutilizan; al terminar la corrida se borran los que se crearon, ver más abajo).

> Nota: `npm run db:reset` borra los datos pero NO los usuarios de Auth si solo
> se resetea el schema public; si un test falla por estado raro, ejecuta
> `npm run db:reset` de nuevo (resetea todo el stack local, usuarios incluidos).

## Mapa de carpetas

`rls.test.ts` y unos 20 archivos sueltos (p. ej. `push-notificaciones.test.ts`, `limpieza-datos.test.ts`) cubren el modelo base y módulos puntuales. Por carpeta: `auditoria/` (grupos G1 a G11 de la Corrida 1; las `it.fails` son la reproducción de los hallazgos abiertos), `correccion/` (correcciones de la Corrida 1), `fase2/`, `fase4/` y `fase5/` (cada fase), `scoring-v2/` (puntaje v2; lee `docs/scoring_v2/rollback/`) y `v3/` (interfaz y firmas viejas, paso 39). Las pruebas de la fase 5 leen `docs/fase5/rollback/` y `docs/migraciones_pendientes/`: no mover esos archivos.

## Qué cubren (`rls.test.ts`)

- Usuario **no autenticado**: no lee plantas.
- **Operario**: no lee linaje por SELECT directo (grant de columna); ve la vista
  `plantas_operativas` sin linaje; solo ve su propio perfil; inserta eventos a su
  nombre pero no a nombre de otro; `obtener_planta()` le responde sin linaje y
  deja auditoría `lectura_ficha`; NO puede auto-ascenderse a admin ni
  auto-concederse `puede_ver_linaje` (trigger 006); NO puede cambiar la fase
  (U-03, 42501); NO puede escribir linaje vía RPC.
- El **admin** sí cambia la fase y el cambio queda auditado con valores
  anterior/nuevo (trigger 007).
- **Admin**: `obtener_planta()` con linaje + auditoría `lectura_linaje`; lee
  todos los perfiles; escribe linaje vía `actualizar_linaje` con auditoría de
  valores anterior/nuevo; NO puede adulterar el `audit_log` (append-only).

## La base local se llena de perfiles de pruebas viejas

Varias pruebas crean usuarios en Auth (`@test.local`) y no todas los borran al terminar: cada corrida completa deja algunos más. Con más de 1000 perfiles, la API corta las respuestas en 1000 filas (`max_rows = 1000` en `supabase/config.toml`) y fallan las pruebas que esperan **todos** los perfiles, por ejemplo `g8-chat` T06 (directorio del chat). Pasó el 24-10-2026 con 1532 perfiles.

**Cómo limpiarla:** `npx supabase db reset --local` y recargar los datos de demostración (`node scripts/demo/fixture-0201.mjs 02-502` y después `node scripts/demo/datos.mjs`, ver `scripts/demo/LEEME.md`). Antes y después, `supabase/.temp/storage-version` tiene que seguir en `v1.80.2`. La primera corrida del Realtime del chat después de un reset puede fallar una vez; al repetirla pasa.

**Cuándo:** cuando `select count(*) from perfiles` pase de unos cientos, o si falla `g8-chat` T06 (en `tests/rls/auditoria/g8-chat.test.ts`) con una lista de 1000.

**Implementado: las pruebas borran los usuarios que crean** (configurado en `vitest.config.ts`).
1. `setup-registro-usuarios.ts` (`setupFiles`) envuelve `createClient` de supabase-js: todo `auth.admin.createUser` o `auth.signUp` hecho por una prueba, sea por `crearUsuarioDePrueba` o por un helper propio de un grupo, anota el id en un archivo de la corrida (`.scratch/usuarios-de-prueba-*.txt`, ignorado por git). Los procesos hijos de Vitest lo encuentran por la variable `TALCA_REGISTRO_USUARIOS`.
2. `global-setup.ts` (`globalSetup`) crea ese archivo al empezar y, al terminar la corrida, borra con la clave de servicio local (`auth.admin.deleteUser`) los ids anotados; el perfil cae en cascada. Solo actúa si la URL es 127.0.0.1, localhost o [::1].
3. Nunca borra por patrón de correo: los usuarios de demostración (`demo-*`) y de capturas (`capturas-*`) no se tocan porque no están en el archivo. Si una prueba ya borró a su usuario, se cuenta como «ya borrado» y no falla nada.
4. Si un usuario no se puede borrar, no falla la suite: al final se imprime una línea `[limpieza de usuarios] Anotados N: borrados X, ya borrados por la prueba Y, no se pudieron borrar Z`.

**Quién borra qué (limpieza de pruebas, decisiones N24 y N29):** una prueba que deja cruces, individuos o usuarios propios los borra en su `afterAll` con `limpiarPrueba` (`tests/rls/limpieza-pruebas.ts`): primero cruces, especies y variedades (en orden de dependencias, con service_role) y al final los usuarios. Toda prueba que crea cruces los marca `es_prueba = true`; la excepción son los cruces reales a propósito (p. ej. `ranking-grupos`, `qr-individuo`), que se borran igual en el `afterAll`. Con esto una corrida completa ya no deja perfiles ni cruces sin marca.

**Qué queda sin borrar, por diseño de la base (todo marcado `es_prueba = true`):** `protocolo_ronda` es inmutable (trigger `protocolo_ronda_inmutable`), así que los cruces con protocolo (`PR-`, `PR2-`, `PRL-`) quedan; `emplazamiento_individuo` es append-only (triggers `trg_emplazamiento_sin_borrado` y `validar_cierre_emplazamiento`), así que quedan los cruces con traslados (`TERR-`, `PROC-`, `MAPA-`, `MAPAFALLBACK-`, `RESTORE-`, `HARDTERR-`), y los usuarios que registran traslados no se pueden borrar (el `SET NULL` de `created_by` también choca con el trigger): por eso `g4-traslado` usa usuarios y cruces fijos. `audit_log` crece (cada baja de perfil agrega `baja_perfil` y `cambio_perfil`; `usuario_id` pasa a NULL).

**Cómo verificarlo:** anotar `select count(*) from perfiles`, correr `npx vitest run` y volver a contar; la diferencia debería ser solo la cifra «no se pudieron borrar» de la línea final. Si una corrida se interrumpe, el archivo `.scratch/usuarios-de-prueba-*.txt` queda sin procesar y se puede borrar a mano.
