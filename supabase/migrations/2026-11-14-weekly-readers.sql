-- Third Estate: readers this week, for the homepage widget. Run once in the Supabase SQL editor.
-- One row per anonymous visitor per day: a random id kept in the reader's browser, the day, and the department
-- only if the reader chose one. No IP, no town, no account. Rows older than 14 days are deleted as new ones arrive.
create table if not exists public.visits (
  visitor uuid not null,
  day date not null default current_date,
  dep text check (dep is null or dep ~ '^(\d{2,3}|2[AB])$'),
  primary key (visitor, day)
);
create index if not exists visits_day_idx on public.visits(day);

-- no policies: the table is reached only through the two functions below
alter table public.visits enable row level security;

create or replace function public.log_visit(v uuid, d text default null)
returns void language sql security definer set search_path = public as $$
  insert into visits(visitor, day, dep)
  values (v, current_date, case when d ~ '^(\d{2,3}|2[AB])$' then d end)
  on conflict (visitor, day) do update set dep = coalesce(excluded.dep, visits.dep);
  delete from visits where day < current_date - 14;
$$;

-- distinct readers over the last 7 days, in total and per department
create or replace function public.weekly_readers()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'readers', (select count(distinct visitor) from visits where day > current_date - 7),
    'deps', coalesce((select json_object_agg(dep, n) from (
      select dep, count(distinct visitor) as n from visits where day > current_date - 7 and dep is not null group by dep
    ) t), '{}'::json)
  );
$$;

revoke all on function public.log_visit(uuid, text) from public;
revoke all on function public.weekly_readers() from public;
grant execute on function public.log_visit(uuid, text) to anon, authenticated;
grant execute on function public.weekly_readers() to anon, authenticated;
