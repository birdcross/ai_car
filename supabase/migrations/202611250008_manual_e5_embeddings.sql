alter table public.manual_chunks
    add column if not exists e5_embedding extensions.vector(384);

create or replace function public.match_e5_manual_chunks(
    vehicle_make text,
    vehicle_model text,
    vehicle_year integer,
    query_embedding extensions.vector(384)
)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
    with vehicle_chunks as materialized (
        select id, title, content, source_url, e5_embedding
        from public.manual_chunks
        where make_key = vehicle_make and model_key = vehicle_model and model_year = vehicle_year
    ), matches as (
        select id, title, content as text, source_url as source,
            1 - (e5_embedding operator(extensions.<=>) query_embedding) as similarity
        from vehicle_chunks
        where e5_embedding is not null
          and (e5_embedding operator(extensions.<=>) query_embedding) <= 0.2
        order by e5_embedding operator(extensions.<=>) query_embedding, id
        limit 3
    )
    select jsonb_build_object(
        'supported', exists (select 1 from vehicle_chunks),
        'matches', coalesce((select jsonb_agg(to_jsonb(matches) order by similarity desc, id) from matches), '[]'::jsonb)
    );
$$;

revoke all on function public.match_e5_manual_chunks(text, text, integer, extensions.vector)
    from public, anon, authenticated;
grant execute on function public.match_e5_manual_chunks(text, text, integer, extensions.vector)
    to service_role;
