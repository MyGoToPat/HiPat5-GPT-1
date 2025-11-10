create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preference_text text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_preferences' and policyname = 'prefs_self_read'
  ) then
    create policy "prefs_self_read" on public.user_preferences for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_preferences' and policyname = 'prefs_self_upsert'
  ) then
    create policy "prefs_self_upsert" on public.user_preferences for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_preferences' and policyname = 'prefs_self_update'
  ) then
    create policy "prefs_self_update" on public.user_preferences for update using (auth.uid() = user_id);
  end if;
end$$;
