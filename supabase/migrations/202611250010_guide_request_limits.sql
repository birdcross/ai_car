create table if not exists public.guide_request_limits (
    user_id uuid primary key references auth.users(id) on delete cascade,
    window_started timestamptz not null,
    request_count integer not null check (request_count between 1 and 8)
);

alter table public.guide_request_limits enable row level security;
revoke all on public.guide_request_limits from public, anon, authenticated;
grant select, insert, update on public.guide_request_limits to service_role;

create or replace function public.take_guide_request(request_user uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
    insert into public.guide_request_limits as limits (user_id, window_started, request_count)
    values (request_user, pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp()), 1)
    on conflict (user_id) do update
    set window_started = excluded.window_started,
        request_count = case when limits.window_started < excluded.window_started
            then 1 else limits.request_count + 1 end
    where limits.window_started < excluded.window_started
       or (limits.window_started = excluded.window_started and limits.request_count < 8);
    return found;
end;
$$;

revoke all on function public.take_guide_request(uuid) from public, anon, authenticated;
grant execute on function public.take_guide_request(uuid) to service_role;
