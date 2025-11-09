do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='user_preferences' and policyname='user_prefs_read_self'
  ) then
    create policy user_prefs_read_self
      on public.user_preferences
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;
end $$;