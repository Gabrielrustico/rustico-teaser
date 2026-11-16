# Apartado de empleados (rusti-co.cl/equipo)

Fichas, liquidaciones, vacaciones, asistencia y documentos firmados del equipo.
Los datos viven en Supabase, no en este repositorio (que es público).

## Puesta en marcha (una sola vez)

1. Crear un proyecto en supabase.com (región São Paulo).
2. **SQL Editor**: pegar `schema.sql`, cambiar el correo de ejemplo en
   `administradores` por el del administrador y ejecutar.
3. **Authentication → URL Configuration**:
   - Site URL: `https://www.rusti-co.cl/equipo/`
   - Redirect URLs: agregar `https://www.rusti-co.cl/equipo/`
4. **Project Settings → API**: copiar Project URL y la clave `anon public`
   en `SUPABASE_URL` y `SUPABASE_ANON_KEY` de `equipo/index.html`.
   La clave `service_role` nunca va en el código.

## Cómo se usa

- El administrador entra con su correo y crea una ficha por trabajador,
  con el correo que esa persona usará para entrar.
- Cada trabajador entra con un enlace que le llega al correo, sin contraseña.
  Ve solo lo suyo: marca entrada y salida, ve sus liquidaciones publicadas,
  su saldo de vacaciones, solicita días y descarga sus documentos firmados.
- Las marcas de asistencia son control interno. El registro legal sigue
  siendo el libro mientras no se use un sistema certificado por la DT.
- Los parámetros (UF, UTM, ingreso mínimo, topes, comisiones AFP) se
  revisan cada mes. Cada liquidación guarda los que usó.

Los cálculos están en `equipo/rrhh.js`.

## Indicadores mensuales (pestaña Indicadores, solo administradores)

1. **SQL Editor**: pegar y ejecutar `migraciones/2026-11-15-indicadores.sql`.
2. **GitHub → Settings → Secrets and variables → Actions**: agregar
   `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API → `service_role`), además de
   `FUDO_API_KEY` y `FUDO_API_SECRET`. La clave `service_role` va solo como secreto, nunca en el código.
3. La acción “Indicadores mensuales desde Fudo” calcula el mes actual y el anterior
   tres veces al día. Para cargar meses pasados: Actions → Run workflow → `meses`
   (ej. `2026-01,2026-02,…`).

Las cifras viven solo en Supabase: el repositorio y los registros de Actions son públicos,
así que el script no imprime montos. Metas y reseñas de Google se escriben a mano en la pestaña.

### Reseñas de Google automáticas

1. **SQL Editor**: pegar y ejecutar `migraciones/2026-11-15-resenas-google.sql`.
2. En Google Cloud (console.cloud.google.com): crear un proyecto, activar **Places API (New)**
   y crear una clave de API restringida a esa API. Guardarla en GitHub como `GOOGLE_PLACES_API_KEY`.
3. La acción guarda cada día el total de reseñas y las estrellas. Reseñas nuevas del mes =
   último total del mes − último total antes del mes.
