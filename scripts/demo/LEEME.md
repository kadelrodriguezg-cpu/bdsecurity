# Datos de demostración (solo base LOCAL)

Estos scripts cargan datos **ficticios** en la base local de Supabase para revisar la aplicación y sacar capturas. Todo es inventado: usuarios `@test.local`, variedades «Variedad A–D», predio «Predio Demo Las Lomas», ensayo EVECL «PARCELA-DEMO-01». No hay linaje real.

## Seguridad

- Cada script llama a `urlLocal()` (`_local.mjs`) **antes de hacer nada**. Si el host de la API no es `127.0.0.1` o `localhost`, termina con un error y no toca nada. La URL por defecto es `http://127.0.0.1:54600` (puerto del CLI según `supabase/config.toml`); se puede cambiar con `DEMO_SUPABASE_URL`, pero solo hacia otro host local.
- Las claves se leen del contenedor Kong local (`supabase_kong_dbsecurity-frutales`) y los comandos SQL van al contenedor `supabase_db_dbsecurity-frutales`. Ninguno lee `.env` ni usa las claves de producción.
- No se usan en producción ni deben usarse.

## Procedimiento de recarga

Desde la raíz del repositorio, con el stack local arriba (`supabase start`):

```bash
npx supabase db reset --local
node scripts/demo/fixture-0201.mjs 02-502
node scripts/demo/datos.mjs
node scripts/demo/fase4.mjs   # opcional: datos de la fase 4 (especies y catálogos)
```

El orden importa: `datos.mjs` supone que el cruce `02-502` ya existe (lo crea el fixture). Después del reset, los pines de Storage (`supabase/.temp/storage-version` = `v1.80.2`, `storage-migration` = `revoke-grants-to-unused-operations`) tienen que seguir intactos; si una subida de archivos falla con `42P10`, ver `README.md`.

`datos.mjs` es idempotente en lo posible: si un cruce de demo ya existe no lo vuelve a crear. Busca a los usuarios recorriendo todas las páginas de Auth, así que funciona aunque la base local tenga más de 1000 usuarios (los que dejan las pruebas).

## Qué crea cada script

**`fixture-0201.mjs <codigo>`** (por defecto `02-501`; el procedimiento usa `02-502`)
- Dos usuarios de capturas (`capturas-admin@test.local` admin y `capturas-sprint0-operario@test.local` operario).
- El cruce `<codigo>` en Evaluación anual con 379 individuos vivos.
- La ronda 1 de solo 54 individuos: 51 borradores del admin, 1 evaluación completa y 2 con una evaluación anulada. Los otros 325 quedan sin ronda (el resto lo abre `datos.mjs`).

**`fase4.mjs`** (se corre después de `datos.mjs`; idempotente): crea la especie «Frutilla» con 4 cruces en fases distintas, dos cruces de «Frambuesa», «Mora» sin cruces y catálogos con la capacidad repetida en el nombre ("Maceteros (10 L)").

**`datos.mjs`**
- Usuarios: `demo-admin@test.local` (Ana Rojas, admin con linaje) y `demo-maria`, `demo-jorge`, `demo-carla` (operarios). Contraseña de prueba `test-password-123`, la misma de `tests/rls/helpers.ts`.
- Variedades «Variedad A» a «Variedad D».
- `02-502`: abre la ronda 1 de todos los individuos, fija el protocolo y deja evaluaciones completas, borradores y pendientes.
- `02-504`: dos rondas completas (para la comparación histórica).
- `02-905`: cruce en Polinización con 3 sesiones. Cada sesión se escribe como lo hace la app (`agregarPolinizacionEvento`): fila en `polinizacion_evento`, columnas `fecha_polinizacion` / `n_flores_cruzadas` de `plantas` con la última sesión y evento `polinizacion` en `registros_evento`.
- `02-610`: ensayo multisitio en un predio ficticio, con coordenadas y clima.
- `02-620` (Crecimiento), `02-630` (Proceso finalizado) y `02-640` (Trasplante): 6 individuos vivos cada uno, para revisar la lista única de individuos en esas fases (para revisar la lista única de individuos).
- Un ensayo EVECL con variedades foráneas ficticias.
- El chat del cruce `02-502`.
- Ajusta `fecha_cambio_estado` de los cruces de demo para que aparezcan en Inicio como los cambios de fase más recientes.

## Qué NO crea

- Capturas de pantalla (los scripts de captura no están versionados).
- Los fixtures de las pruebas automáticas: cada prueba de `tests/rls/` crea y limpia los suyos.
- Datos de revisión UX (`UXA-01`, `02-701`) ni los de otras noches de trabajo.
- Nada de producción.

## Pruebas y datos de demostración

Las pruebas de la raíz (`npx vitest run`) se pueden correr con estos datos cargados. `tests/rls/limpieza-datos.test.ts` incluye una comprobación («No marca nada de los fixtures 02-9xx») que exige que los cruces `02-9xx` no tengan inconsistencias que detecten los informes de `scripts/limpieza/`; por eso `02-905` tiene que crearse con su bitácora, como lo hace ahora `datos.mjs`.
