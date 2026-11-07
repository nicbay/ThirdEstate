-- Third Estate: Supabase schema. Run once in the Supabase SQL editor (Project → SQL → New query).
-- Accounts use Supabase Auth (email magic link). Live visitors use Realtime Presence (no table).

-- Saved simulator scenarios. Each user sees and edits only their own; shared ones are readable by link.
create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  data jsonb not null,
  public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scenarios_user_idx on public.scenarios(user_id, updated_at desc);

alter table public.scenarios enable row level security;

drop policy if exists "own scenarios: read" on public.scenarios;
create policy "own scenarios: read" on public.scenarios for select using (auth.uid() = user_id or public);
drop policy if exists "own scenarios: insert" on public.scenarios;
create policy "own scenarios: insert" on public.scenarios for insert with check (auth.uid() = user_id);
drop policy if exists "own scenarios: update" on public.scenarios;
create policy "own scenarios: update" on public.scenarios for update using (auth.uid() = user_id);
drop policy if exists "own scenarios: delete" on public.scenarios;
create policy "own scenarios: delete" on public.scenarios for delete using (auth.uid() = user_id);
