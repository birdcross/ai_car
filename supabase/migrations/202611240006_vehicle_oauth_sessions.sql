create table if not exists public.vehicle_oauth_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  brand text not null check (brand in ('hyundai', 'kia')),
  kind text not null check (kind in ('state', 'token')),
  value text not null,
  expires_at double precision not null,
  primary key (user_id, brand, kind)
);

alter table public.vehicle_oauth_sessions enable row level security;
revoke all on public.vehicle_oauth_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.vehicle_oauth_sessions to service_role;
