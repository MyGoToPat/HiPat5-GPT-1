create extension if not exists pgcrypto;

create extension if not exists vector;

create table if not exists public.intent_routes (

  id uuid primary key default gen_random_uuid(),

  name text not null unique,

  examples text[] not null default '{}',

  embedding vector(768),                -- align with text-embedding-004

  hi_threshold numeric not null default 0.80,

  mid_threshold numeric not null default 0.55,

  created_at timestamptz not null default now()

);

create index if not exists intent_routes_name_idx on public.intent_routes (name);

do $$ begin

  execute 'create index if not exists intent_routes_embedding_idx

           on public.intent_routes using ivfflat (embedding vector_l2_ops) with (lists = 100)';

exception when others then null;

end $$;

alter table public.intent_routes enable row level security;

-- read for anon/auth

do $$ begin

  if not exists (

    select 1 from pg_policies where schemaname='public' and tablename='intent_routes' and policyname='intent_routes_read'

  ) then

    create policy intent_routes_read

      on public.intent_routes

      for select

      to anon, authenticated

      using (true);

  end if;

end $$;

-- write only via service_role

do $$ begin

  if not exists (

    select 1 from pg_policies where schemaname='public' and tablename='intent_routes' and policyname='intent_routes_insert_service'

  ) then

    create policy intent_routes_insert_service

      on public.intent_routes

      for insert

      to service_role

      with check (true);

  end if;

  if not exists (

    select 1 from pg_policies where schemaname='public' and tablename='intent_routes' and policyname='intent_routes_update_service'

  ) then

    create policy intent_routes_update_service

      on public.intent_routes

      for update

      to service_role

      using (true)

      with check (true);

  end if;

  if not exists (

    select 1 from pg_policies where schemaname='public' and tablename='intent_routes' and policyname='intent_routes_delete_service'

  ) then

    create policy intent_routes_delete_service

      on public.intent_routes

      for delete

      to service_role

      using (true);

  end if;

end $$;

insert into public.intent_routes (name, examples, hi_threshold, mid_threshold) values

  ('food_log',      array['i ate 4 eggs','log my meal','add breakfast'], 0.80, 0.55),

  ('food_question', array['what are the macros for 4 eggs','protein in salmon'], 0.80, 0.55),

  ('workout_log',   array['log my workout','i did legs today'], 0.80, 0.55),

  ('general',       array['who are you?','tell me a story','talk to me'], 0.80, 0.55),

  ('web',           array['search the web','UEFA Euro final score'], 0.80, 0.55)

on conflict (name) do nothing;

