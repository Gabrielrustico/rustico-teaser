-- Apartado de empleados de Rusti-Co. (rusti-co.cl/equipo)
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr sin romper nada.
--
-- Reglas de acceso:
--   * Administradores (tabla administradores): ven y editan todo.
--   * Cada trabajador entra con el correo de su ficha y ve solo lo suyo:
--     su ficha, sus liquidaciones, sus vacaciones y sus marcas.
--   * Un trabajador puede marcar entrada/salida (la hora la pone el servidor)
--     y solicitar vacaciones. No puede cambiar sueldos ni liquidaciones.

create extension if not exists pgcrypto;

create table if not exists public.administradores (
  email text primary key check (email = lower(email))
);

create table if not exists public.trabajadores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text unique check (email = lower(email)),
  nombre text not null,
  rut text,
  cargo text,
  contrato text not null default 'indefinido'
    check (contrato in ('indefinido','plazo_fijo','obra','sin_contrato')),
  ingreso date,
  jornada numeric not null default 42,
  sueldo integer not null default 0,
  grat text not null default 'art50' check (grat in ('art50','no')),
  afp text not null default 'PlanVital',
  salud text not null default 'fonasa' check (salud in ('fonasa','isapre')),
  plan_uf numeric not null default 0,
  colacion integer not null default 0,
  movilizacion integer not null default 0,
  anios_previos integer not null default 0,
  tomados_previos numeric not null default 0,
  lugar text,
  fecha_nacimiento date,
  nacionalidad text,
  direccion text,
  comuna text,
  telefono text,
  contacto_emergencia text,
  activo boolean not null default true,
  creado timestamptz not null default now()
);

create table if not exists public.vacaciones (
  id uuid primary key default gen_random_uuid(),
  trabajador_id uuid not null references public.trabajadores(id) on delete cascade,
  desde date not null,
  hasta date not null,
  dias numeric not null check (dias > 0),
  obs text,
  estado text not null default 'aprobada' check (estado in ('solicitada','aprobada','rechazada')),
  creado timestamptz not null default now(),
  check (hasta >= desde)
);

create table if not exists public.liquidaciones (
  id uuid primary key default gen_random_uuid(),
  trabajador_id uuid not null references public.trabajadores(id) on delete cascade,
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  variables jsonb not null,
  resultado jsonb not null,
  parametros jsonb not null,
  guardada timestamptz not null default now(),
  unique (trabajador_id, mes)
);

create table if not exists public.parametros (
  id integer primary key default 1 check (id = 1),
  datos jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);

-- Marcas de asistencia: control interno. El registro legal sigue siendo el libro
-- mientras no se use un sistema certificado por la Dirección del Trabajo.
create table if not exists public.marcas (
  id uuid primary key default gen_random_uuid(),
  trabajador_id uuid not null references public.trabajadores(id) on delete cascade,
  tipo text not null check (tipo in ('entrada','salida')),
  momento timestamptz not null default now(),
  nota text,
  creada_por uuid default auth.uid()
);
create index if not exists marcas_trab_momento on public.marcas (trabajador_id, momento desc);

-- Documentos firmados (contratos, anexos, finiquitos, reglamento, etc.).
-- Los archivos van en el bucket privado "documentos", en la carpeta <trabajador_id>/.
create table if not exists public.documentos (
  id uuid primary key default gen_random_uuid(),
  trabajador_id uuid not null references public.trabajadores(id) on delete cascade,
  tipo text not null default 'contrato'
    check (tipo in ('contrato','anexo','finiquito','liquidacion_firmada','reglamento','amonestacion','otro')),
  titulo text not null,
  fecha date,
  ruta text not null unique,
  subido timestamptz not null default now()
);

-- ---------- Funciones ----------
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.mi_trabajador() returns uuid
language sql stable security definer set search_path = public as $$
  select id from trabajadores where user_id = auth.uid() limit 1;
$$;

-- Une la cuenta que inició sesión con la ficha que tiene su mismo correo.
create or replace function public.vincular_usuario() returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  update trabajadores set user_id = auth.uid()
   where user_id is null and email = lower(coalesce(auth.jwt() ->> 'email', ''))
   returning id into tid;
  return coalesce(tid, mi_trabajador());
end $$;

-- La hora de una marca la fija el servidor, salvo que la cargue un administrador.
create or replace function public.marcas_hora_servidor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then new.momento := now(); end if;
  new.creada_por := auth.uid();
  return new;
end $$;
drop trigger if exists marcas_hora on public.marcas;
create trigger marcas_hora before insert on public.marcas
  for each row execute function public.marcas_hora_servidor();

-- ---------- Seguridad por filas ----------
alter table public.administradores enable row level security;
alter table public.trabajadores   enable row level security;
alter table public.vacaciones     enable row level security;
alter table public.liquidaciones  enable row level security;
alter table public.parametros     enable row level security;
alter table public.marcas         enable row level security;

drop policy if exists adm_leer on public.administradores;
create policy adm_leer on public.administradores for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists trab_leer on public.trabajadores;
create policy trab_leer on public.trabajadores for select to authenticated
  using (es_admin() or user_id = auth.uid());
drop policy if exists trab_admin on public.trabajadores;
create policy trab_admin on public.trabajadores for all to authenticated
  using (es_admin()) with check (es_admin());

drop policy if exists vac_leer on public.vacaciones;
create policy vac_leer on public.vacaciones for select to authenticated
  using (es_admin() or trabajador_id = mi_trabajador());
drop policy if exists vac_solicitar on public.vacaciones;
create policy vac_solicitar on public.vacaciones for insert to authenticated
  with check (trabajador_id = mi_trabajador() and estado = 'solicitada');
drop policy if exists vac_admin on public.vacaciones;
create policy vac_admin on public.vacaciones for all to authenticated
  using (es_admin()) with check (es_admin());

drop policy if exists liq_leer on public.liquidaciones;
create policy liq_leer on public.liquidaciones for select to authenticated
  using (es_admin() or trabajador_id = mi_trabajador());
drop policy if exists liq_admin on public.liquidaciones;
create policy liq_admin on public.liquidaciones for all to authenticated
  using (es_admin()) with check (es_admin());

drop policy if exists par_leer on public.parametros;
create policy par_leer on public.parametros for select to authenticated using (true);
drop policy if exists par_admin on public.parametros;
create policy par_admin on public.parametros for all to authenticated
  using (es_admin()) with check (es_admin());

drop policy if exists mar_leer on public.marcas;
create policy mar_leer on public.marcas for select to authenticated
  using (es_admin() or trabajador_id = mi_trabajador());
drop policy if exists mar_marcar on public.marcas;
create policy mar_marcar on public.marcas for insert to authenticated
  with check (es_admin() or trabajador_id = mi_trabajador());
drop policy if exists mar_admin_editar on public.marcas;
create policy mar_admin_editar on public.marcas for update to authenticated
  using (es_admin()) with check (es_admin());
drop policy if exists mar_admin_borrar on public.marcas;
create policy mar_admin_borrar on public.marcas for delete to authenticated
  using (es_admin());

alter table public.documentos enable row level security;
drop policy if exists doc_leer on public.documentos;
create policy doc_leer on public.documentos for select to authenticated
  using (es_admin() or trabajador_id = mi_trabajador());
drop policy if exists doc_admin on public.documentos;
create policy doc_admin on public.documentos for all to authenticated
  using (es_admin()) with check (es_admin());

-- Bucket privado para los archivos. Cada trabajador solo descarga su carpeta.
insert into storage.buckets (id, name, public) values ('documentos', 'documentos', false)
on conflict (id) do nothing;
drop policy if exists docs_leer on storage.objects;
create policy docs_leer on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (es_admin() or (storage.foldername(name))[1] = mi_trabajador()::text));
drop policy if exists docs_admin on storage.objects;
create policy docs_admin on storage.objects for all to authenticated
  using (bucket_id = 'documentos' and es_admin()) with check (bucket_id = 'documentos' and es_admin());

revoke all on function public.vincular_usuario() from anon;

-- ---------- Datos iniciales ----------
-- Cambia este correo por el tuyo (y agrega el de tu hermano) antes de correr.
-- Este archivo está en un repositorio público: los correos reales se ponen solo en Supabase.
insert into public.administradores (email) values
  ('tu-correo@ejemplo.cl')
on conflict do nothing;

insert into public.parametros (id, datos) values (1, '{}'::jsonb)
on conflict (id) do nothing;
