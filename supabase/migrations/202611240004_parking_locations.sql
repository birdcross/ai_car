create table public.parking_locations (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    kind text not null check (kind in ('personal', 'sample')),
    spot text not null default '' check (char_length(spot) <= 100),
    latitude double precision check (latitude between -90 and 90),
    longitude double precision check (longitude between -180 and 180),
    updated_at timestamptz not null default now(),
    primary key (user_id, kind),
    check ((latitude is null) = (longitude is null)),
    check (btrim(spot) <> '' or latitude is not null)
);

alter table public.parking_locations enable row level security;
revoke all on public.parking_locations from public, anon, authenticated;
grant select, insert, update, delete on public.parking_locations to authenticated;
create policy "Users manage their parking locations"
on public.parking_locations for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
