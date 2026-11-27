-- Accounts: one profile per signed-in reader (src/lib/profile.ts). Run once in the Supabase SQL editor.
--
-- What a profile holds: the reader's town, their household figures (budget simulator), and — only with a separate,
-- explicit consent — the candidate they follow and their quiz result. Those two are political opinions (GDPR art. 9):
-- the table refuses them unless consent_political_at is set, and withdrawing consent clears them.
-- Each reader sees and edits only their own row. Deleting the account deletes the row (and the scenarios).

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  home jsonb check (home is null or pg_column_size(home) < 2048),
  household jsonb check (household is null or pg_column_size(household) < 8192),
  candidate jsonb check (candidate is null or pg_column_size(candidate) < 1024),
  quiz jsonb check (quiz is null or pg_column_size(quiz) < 4096),
  consent_political_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint political_needs_consent check ((candidate is null and quiz is null) or consent_political_at is not null)
);

alter table public.profiles enable row level security;

drop policy if exists "own profile: read" on public.profiles;
create policy "own profile: read" on public.profiles for select using (auth.uid() = user_id);
drop policy if exists "own profile: insert" on public.profiles;
create policy "own profile: insert" on public.profiles for insert with check (auth.uid() = user_id);
drop policy if exists "own profile: update" on public.profiles;
create policy "own profile: update" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own profile: delete" on public.profiles;
create policy "own profile: delete" on public.profiles for delete using (auth.uid() = user_id);

create or replace function public.touch_profile() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_profile();

-- "Delete my account": removes the reader's auth user; their profile and scenarios go with it (on delete cascade).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
