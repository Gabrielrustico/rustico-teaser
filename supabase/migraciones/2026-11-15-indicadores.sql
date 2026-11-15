-- Indicadores mensuales (rusti-co.cl/equipo → pestaña Indicadores).
-- Pegar en Supabase → SQL Editor → Run. Se puede volver a correr sin romper nada.
--
-- indicadores_mes: lo escribe la acción "Indicadores mensuales desde Fudo" de GitHub
--   (con la clave service_role guardada como secreto). Solo administradores pueden leer.
-- indicadores_manual: metas del mes y reseñas de Google, que el administrador
--   escribe a mano en la pestaña. Solo administradores leen y editan.

create table if not exists public.indicadores_mes (
  mes text primary key check (mes ~ '^\d{4}-\d{2}$'),
  datos jsonb not null,
  actualizado timestamptz not null default now()
);

create table if not exists public.indicadores_manual (
  mes text primary key check (mes ~ '^\d{4}-\d{2}$'),
  datos jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);

alter table public.indicadores_mes    enable row level security;
alter table public.indicadores_manual enable row level security;

drop policy if exists ind_leer on public.indicadores_mes;
create policy ind_leer on public.indicadores_mes for select to authenticated using (public.es_admin());

drop policy if exists indm_admin on public.indicadores_manual;
create policy indm_admin on public.indicadores_manual for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Metas ya acordadas (se pueden cambiar desde la pestaña).
insert into public.indicadores_manual (mes, datos) values
  ('2026-10', '{"meta_venta": 26000000, "meta_ticket": 19000, "meta_resenas": 30, "resenas_nuevas": 9, "resenas_total": 160, "estrellas": 4.8}'),
  ('2026-11', '{"meta_venta": 26000000, "meta_ticket": 19000, "meta_resenas": 100}')
on conflict (mes) do nothing;
