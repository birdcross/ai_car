create table public.driving_trips (
    id uuid primary key,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    started_at timestamptz not null,
    ended_at timestamptz not null check (ended_at >= started_at),
    points jsonb not null,
    check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 2 and 5000)
);
create index driving_trips_user_date_idx on public.driving_trips (user_id, started_at desc);
alter table public.driving_trips enable row level security;
revoke all on public.driving_trips from public, anon, authenticated;
grant select, insert on public.driving_trips to authenticated;
create policy "Users read their driving trips" on public.driving_trips for select to authenticated
    using ((select auth.uid()) = user_id);
create policy "Users insert their driving trips" on public.driving_trips for insert to authenticated
    with check ((select auth.uid()) = user_id);
