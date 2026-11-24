create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table public.manual_chunks (
    id text primary key,
    make_key text not null,
    model_key text not null,
    model_year smallint not null check (model_year between 1900 and 2100),
    title text not null,
    content text not null,
    source_url text not null,
    embedding extensions.vector(1536)
);

create index manual_chunks_vehicle_idx
    on public.manual_chunks (make_key, model_key, model_year);

alter table public.manual_chunks enable row level security;
revoke all on public.manual_chunks from public, anon, authenticated;
grant select, insert, update on public.manual_chunks to service_role;

create function public.match_manual_chunks(
    vehicle_make text,
    vehicle_model text,
    vehicle_year integer,
    query_embedding extensions.vector(1536)
)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
    with vehicle_chunks as materialized (
        select id, title, content, source_url, embedding
        from public.manual_chunks
        where make_key = vehicle_make and model_key = vehicle_model
            and model_year = vehicle_year
    ), matches as (
        select id, title, content as text, source_url as source,
            1 - (embedding operator(extensions.<=>) query_embedding) as similarity
        from vehicle_chunks
        where embedding is not null
            and (embedding operator(extensions.<=>) query_embedding) <= 0.65
        order by embedding operator(extensions.<=>) query_embedding, id
        limit 3
    )
    select jsonb_build_object(
        'supported', exists (select 1 from vehicle_chunks),
        'matches', coalesce(
            (select jsonb_agg(to_jsonb(matches) order by similarity desc, id) from matches),
            '[]'::jsonb
        )
    );
$$;

revoke all on function public.match_manual_chunks(text, text, integer, extensions.vector)
    from public, anon, authenticated;
grant execute on function public.match_manual_chunks(text, text, integer, extensions.vector)
    to service_role;
