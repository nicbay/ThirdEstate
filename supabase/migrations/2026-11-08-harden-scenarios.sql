-- Run once in the Supabase SQL editor (Project → SQL → New query) on the existing database.
-- 1. Nobody can list other users' scenarios (and their user_id) any more: reads are owner-only.
-- 2. Rows are capped at 32 kB, so the table can't be used to store large blobs.
-- 3. Updates check ownership on the new row too.
alter table public.scenarios drop constraint if exists scenarios_data_size;
alter table public.scenarios add constraint scenarios_data_size check (pg_column_size(data) < 32768) not valid;
alter table public.scenarios validate constraint scenarios_data_size;

drop policy if exists "own scenarios: read" on public.scenarios;
create policy "own scenarios: read" on public.scenarios for select using (auth.uid() = user_id);
drop policy if exists "own scenarios: update" on public.scenarios;
create policy "own scenarios: update" on public.scenarios for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
