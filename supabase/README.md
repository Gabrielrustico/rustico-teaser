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
