create table if not exists public.vehicle_charging_status (
    user_id uuid not null references auth.users(id) on delete cascade,
    car_id text not null check (length(car_id) between 1 and 128),
    battery_plugin smallint not null check (battery_plugin between 0 and 2),
    battery_charge boolean not null,
    soc numeric not null check (soc between 0 and 100),
    target_plug_type smallint check (target_plug_type between 0 and 2),
    target_soc numeric check (target_soc between 0 and 100),
    remaining_value numeric check (remaining_value >= 0),
    remaining_unit smallint check (remaining_unit between 0 and 3),
    vehicle_reported_at timestamptz not null,
    fetched_at timestamptz not null default now(),
    message_id text,
    primary key (user_id, car_id)
);

alter table public.vehicle_charging_status enable row level security;
revoke all on public.vehicle_charging_status from public, anon, authenticated;
grant select, insert, update, delete on public.vehicle_charging_status to service_role;

create or replace function public.save_vehicle_charging_status(snapshot jsonb)
returns void language sql set search_path = '' as $$
    insert into public.vehicle_charging_status
    select (jsonb_populate_record(null::public.vehicle_charging_status, snapshot)).*
    on conflict (user_id, car_id) do update set
        battery_plugin = excluded.battery_plugin,
        battery_charge = excluded.battery_charge,
        soc = excluded.soc,
        target_plug_type = excluded.target_plug_type,
        target_soc = excluded.target_soc,
        remaining_value = excluded.remaining_value,
        remaining_unit = excluded.remaining_unit,
        vehicle_reported_at = excluded.vehicle_reported_at,
        fetched_at = excluded.fetched_at,
        message_id = excluded.message_id
    where (excluded.vehicle_reported_at, excluded.fetched_at) >=
          (vehicle_charging_status.vehicle_reported_at, vehicle_charging_status.fetched_at);
$$;

revoke all on function public.save_vehicle_charging_status(jsonb) from public, anon, authenticated;
grant execute on function public.save_vehicle_charging_status(jsonb) to service_role;
