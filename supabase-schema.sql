-- PG Spotlight — shared backend schema (run once in the Supabase SQL editor).
-- Creates the three tables the app syncs, plus permissive RLS policies so the
-- public anon key can read/write. Tighten these policies (e.g. require auth)
-- before using with sensitive data.

create table if not exists public.aes (
  id          text primary key,
  name        text not null,
  country     text,
  region      text,
  rvp         text,
  created_at  timestamptz default now()
);

create table if not exists public.nbm_entries (
  id             text primary key,
  ae_id          text references public.aes(id) on delete cascade,
  week_key       text not null,
  level          text not null,
  account        text,
  value_pyramid  boolean default false,
  held           boolean default false,
  calendarised   boolean default false,
  date           text,
  note           text default '',
  status         text default 'pending',
  verified_by    text default '',
  verified_at    text default '',
  created_at     timestamptz default now()
);

create table if not exists public.jerseys (
  week_key  text not null,
  ae_id     text not null,
  country   text,
  primary key (week_key, ae_id)
);

create index if not exists nbm_entries_week_idx on public.nbm_entries (week_key);
create index if not exists nbm_entries_ae_idx   on public.nbm_entries (ae_id);

alter table public.aes         enable row level security;
alter table public.nbm_entries enable row level security;
alter table public.jerseys     enable row level security;

-- Demo policies: allow anonymous full access via the public anon key.
drop policy if exists "anon_all_aes" on public.aes;
drop policy if exists "anon_all_entries" on public.nbm_entries;
drop policy if exists "anon_all_jerseys" on public.jerseys;

create policy "anon_all_aes"     on public.aes         for all using (true) with check (true);
create policy "anon_all_entries" on public.nbm_entries for all using (true) with check (true);
create policy "anon_all_jerseys" on public.jerseys     for all using (true) with check (true);
