-- Agrega datos personales a la ficha del trabajador.
alter table public.trabajadores
  add column if not exists fecha_nacimiento date,
  add column if not exists nacionalidad text,
  add column if not exists direccion text,
  add column if not exists comuna text,
  add column if not exists telefono text,
  add column if not exists contacto_emergencia text;
