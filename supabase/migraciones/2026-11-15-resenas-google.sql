-- Foto diaria de las reseñas de Google (total y estrellas), para calcular las reseñas nuevas de cada mes.
-- La escribe la acción "Indicadores mensuales desde Fudo". Solo administradores pueden leer.
create table if not exists public.resenas_google (
  fecha date primary key,
  total integer not null,
  estrellas numeric(2,1)
);
alter table public.resenas_google enable row level security;
drop policy if exists res_leer on public.resenas_google;
create policy res_leer on public.resenas_google for select to authenticated using (public.es_admin());

-- Punto de partida aproximado: total leído en Google Maps a comienzos de noviembre de 2026.
insert into public.resenas_google (fecha, total, estrellas) values ('2026-10-31', 160, 4.8)
on conflict (fecha) do nothing;
