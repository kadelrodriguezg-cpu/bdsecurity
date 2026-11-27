# BDSecurity — Trazabilidad genética de frutales

Sistema completo (base de datos, API y aplicación web/móvil) para un programa de
mejoramiento genético de frutales: arándano primero, y luego mora, frambuesa y
otras especies. Reemplaza un sistema anterior en Notion y lo usa a diario un
equipo de campo y de administración.

Cada planta lleva una **etiqueta con código QR**. Al escanearla con el celular se
abre su ficha: fase del cruce, evaluaciones por temporada, fotos, historial y
ranking. Lo más delicado es el **linaje genético** (de qué variedades viene cada
cruce). Es un activo comercial que la competencia tiene incentivos para conocer,
así que protegerlo es el requisito central del diseño y no un detalle del
frontend.

> **Sobre este repositorio.** Es una copia de portafolio del código. No incluye
> datos reales, documentación interna, herramientas de despliegue ni
> configuración de producción. Los datos de ejemplo y de demostración son
> ficticios.

---

## Qué hace

- **Ciclo completo del cruce:** polinización → cosecha → siembra → germinación →
  trasplante → crecimiento → evaluación anual → traslado, con transiciones
  validadas en la base de datos.
- **Plantas individuales con QR propio:** cada planta nace en el trasplante con
  un identificador inmutable que codifica su etiqueta. La baja es lógica, nunca
  un borrado.
- **Evaluaciones por rondas** con descriptores fenotípicos configurables por
  especie, borradores locales que sobreviven sin conexión y corrección con
  historial.
- **Ranking y puntaje versionados:** varias versiones de puntaje conviven en la
  base, con fotos fijas (snapshots) inmutables para comparar temporadas.
- **Multiespecie:** la especie es el espacio de trabajo de toda la aplicación.
- **Chat del equipo** con menciones y notificaciones push (web push con VAPID,
  enviadas desde una función serverless).
- **Ensayos de variedades externas**, mapa de predios, etiquetas en PDF y
  exportación a CSV.
- **PWA instalable**, pensada primero para celular en el campo.

## Stack

| Capa | Tecnología |
|---|---|
| Base de datos, autenticación y archivos | **Supabase** (Postgres 15+, Auth, Storage) |
| Lógica sensible | SQL: políticas RLS, vistas, funciones `SECURITY DEFINER` y triggers |
| Frontend | **React 18 + TypeScript estricto + Vite**, TanStack Query, React Hook Form + Zod, Tailwind, Leaflet |
| Funciones serverless | Vercel Functions (push y proxy de geocodificación) |
| Pruebas | **Vitest** (frontend con Testing Library; seguridad contra Postgres real) |

## Diseño de seguridad

La seguridad vive en la base de datos, no en la interfaz. El rol en el frontend
solo decide qué se muestra; lo que se puede leer o escribir lo decide Postgres.

1. **Autenticación solo con Supabase Auth.** No hay contraseñas, sesiones ni
   tokens hechos a mano. El registro público está cerrado: las cuentas las crea
   un administrador.
2. **RLS en todas las tablas desde su primera migración.** Una tabla sin política
   no entrega nada.
3. **El linaje se oculta por columna.** Los operarios leen los cruces a través de
   la vista `plantas_operativas` (`security_invoker = on`, para que respete el
   RLS de quien consulta), que no expone `cruzamiento`, `mama` ni `papa`.
4. **Defensa en profundidad.** Además de la vista, `REVOKE SELECT` sobre las
   columnas de linaje para el rol `authenticated`. El camino directo a la tabla
   también está cerrado.
5. **Lecturas auditadas.** Postgres no tiene triggers `ON SELECT`, así que la
   ficha se lee solo con la RPC `obtener_planta()`. Esa función valida el
   permiso, registra en `audit_log` quién vio qué campos y cuándo, y recién
   entonces devuelve los datos. El linaje se escribe solo con
   `actualizar_linaje()`.
6. **Bitácora inmutable.** `audit_log` tiene políticas de lectura (solo
   administradores) e inserción vía RPC, pero ninguna de UPDATE ni DELETE.
7. **Sin autoascenso.** Un trigger impide que un usuario cambie su propio rol o
   su permiso de ver linaje; solo un administrador puede hacerlo.
8. **Archivos privados.** Fotos y videos en buckets privados de Storage con
   políticas propias; la base guarda solo los metadatos.

## Pruebas

- **Pruebas empíricas de seguridad** (`tests/rls/`): se conectan a un Supabase
  local real con usuarios de distintos roles (administrador, operario con y sin
  permiso de linaje) e intentan leer y escribir lo que no deberían. Incluyen una
  matriz esperada de permisos por tabla y operación, y las pruebas de una
  auditoría de seguridad completa, grupo por grupo.
- **Pruebas del frontend** (`frontend/src/**/*.test.ts(x)`): componentes,
  flujos de pantalla y la capa de datos.
- En total, más de 300 archivos de pruebas. Un gancho `pre-push` corre tipos y
  pruebas antes de cada push.

## Estructura

```
supabase/migrations/   ~190 migraciones SQL en orden: esquema, RLS, vistas, RPC, Storage
supabase/seed.sql      datos de ejemplo (linaje sintético)
frontend/              aplicación React (PWA) y funciones serverless (frontend/api/)
tests/rls/             pruebas de seguridad contra la base local
scripts/demo/          carga de datos ficticios para revisar la app en local
scripts/limpieza/      scripts de limpieza de datos, probados contra la base local
docs/                  SQL de activación y rollback que leen las pruebas de puntaje
DESIGN.md              sistema visual (colores, tipografía, componentes)
```

## Correrlo en local

Requisitos: Node.js 20+, Docker Desktop y pnpm.

```bash
npm install            # dependencias de la raíz (incluye la CLI de Supabase)
npm run db:start       # Supabase local (puertos 54600-54603)
npm run db:reset       # migraciones + seed
npm test               # pruebas de seguridad contra la base local

cd frontend
pnpm install
cp .env.example .env.development.local   # completar con los valores de «npx supabase status»
pnpm dev
```

Para tener datos con los que navegar, ver `scripts/demo/LEEME.md`.

---

## Derechos

Código publicado como muestra de portafolio. Todos los derechos reservados: no
se concede licencia para usarlo, copiarlo ni redistribuirlo.
