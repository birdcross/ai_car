create table public.guide_conversations (
    id uuid primary key,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    title text not null check (char_length(title) between 1 and 100),
    vehicle jsonb not null check (jsonb_typeof(vehicle) = 'object'),
    turns jsonb not null check (jsonb_typeof(turns) = 'array'),
    updated_at timestamptz not null default now()
);

create index guide_conversations_owner_recent
on public.guide_conversations (user_id, updated_at desc, id);

alter table public.guide_conversations enable row level security;
revoke all on public.guide_conversations from public, anon, authenticated;
grant select, insert, update, delete on public.guide_conversations to authenticated;
create policy "Users manage their guide conversations"
on public.guide_conversations for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create function public.save_guide_turn(
    conversation_id uuid, conversation_title text, conversation_vehicle jsonb,
    new_turn jsonb, new_conversation boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if new_conversation then
        insert into public.guide_conversations (id, title, vehicle, turns)
        values (conversation_id, conversation_title, conversation_vehicle, jsonb_build_array(new_turn))
        on conflict (id) do nothing;
    end if;

    update public.guide_conversations
    set turns = turns || jsonb_build_array(new_turn), updated_at = now()
    where id = conversation_id
      and not turns @> jsonb_build_array(jsonb_build_object('id', new_turn->>'id'));

    if not found and not exists (
        select 1 from public.guide_conversations where id = conversation_id
    ) then
        raise exception 'Conversation unavailable';
    end if;
end;
$$;
revoke all on function public.save_guide_turn(uuid, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.save_guide_turn(uuid, text, jsonb, jsonb, boolean) to authenticated;
