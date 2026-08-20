-- PG Dashboard (EMEA) — shared backend schema (run in the Supabase SQL editor).
-- Creates the tables the app syncs, plus permissive RLS policies so the public
-- anon key can read/write. Tighten these policies (e.g. require auth) before
-- using with sensitive data.
--
-- This file is idempotent: re-running it only adds what is missing, so it safely
-- upgrades an existing "PG Spotlight" database to the ongoing dashboard model
-- with automatic calendar-based NBM tracking.

create table if not exists public.aes (
  id          text primary key,
  name        text not null,
  country     text,
  region      text,
  rvp         text,
  start_date  text,
  photo_url   text,
  created_at  timestamptz default now()
);

alter table public.aes add column if not exists start_date text;
alter table public.aes add column if not exists photo_url text;
-- Calendar auto-tracking maps each AE to the Google Calendar it reads from
-- (usually the AE's work email). Nullable so manual-only AEs keep working.
alter table public.aes add column if not exists calendar_email text;
alter table public.aes add column if not exists active boolean default true;
-- Idempotent roster discovery: the calendar-sync function upserts AEs found in
-- the Google Workspace Directory keyed on calendar_email, so re-running never
-- duplicates people. Partial unique index skips manual AEs with no calendar.
-- (The function lowercases emails before upserting so this stays consistent.)
create unique index if not exists aes_calendar_email_ux
  on public.aes (calendar_email) where calendar_email is not null;

create table if not exists public.nbm_entries (
  id             text primary key,
  ae_id          text,
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

alter table public.nbm_entries add column if not exists created_at timestamptz default now();

-- ── Calendar auto-tracking columns ─────────────────────────────────────────
-- source: 'manual' (logged by an AE) or 'calendar' (detected by the sync job).
alter table public.nbm_entries add column if not exists source text default 'manual';
-- calendar_event_id: the Google event id, used to keep the sync idempotent so
-- re-running it never creates duplicate NBMs for the same meeting.
alter table public.nbm_entries add column if not exists calendar_event_id text;
-- Snapshot of the external contact the meeting was detected against.
alter table public.nbm_entries add column if not exists attendee_email text;
alter table public.nbm_entries add column if not exists attendee_name  text;
alter table public.nbm_entries add column if not exists attendee_title text;
-- Auto-detected seniority level before any manager override (VP/CTO, etc.).
alter table public.nbm_entries add column if not exists auto_level text;
-- Meeting type tag: NBM (default), VO Progression, Champion Go/No-Go, EB Go/No-Go.
alter table public.nbm_entries add column if not exists meeting_type text default 'NBM';

-- One NBM per calendar event: makes the edge function's upsert idempotent.
create unique index if not exists nbm_entries_calendar_event_ux
  on public.nbm_entries (calendar_event_id)
  where calendar_event_id is not null;

create table if not exists public.jerseys (
  week_key  text not null,
  ae_id     text not null,
  country   text,
  primary key (week_key, ae_id)
);

create index if not exists nbm_entries_week_idx   on public.nbm_entries (week_key);
create index if not exists nbm_entries_ae_idx     on public.nbm_entries (ae_id);
create index if not exists nbm_entries_source_idx on public.nbm_entries (source);

-- ── Calendar sync bookkeeping ───────────────────────────────────────────────
-- A single-row-per-scope log so the dashboard can show "last synced" and the
-- edge function can report how many events it scanned / NBMs it created.
create table if not exists public.calendar_sync_state (
  id            text primary key default 'global',
  last_run_at   timestamptz,
  last_status   text,
  events_scanned integer default 0,
  nbms_created  integer default 0,
  nbms_updated  integer default 0,
  window_start  text,
  window_end    text,
  message       text default ''
);

alter table public.aes                enable row level security;
alter table public.nbm_entries        enable row level security;
alter table public.jerseys            enable row level security;
alter table public.calendar_sync_state enable row level security;

-- Demo policies: allow anonymous full access via the public anon key.
drop policy if exists "anon_all_aes" on public.aes;
drop policy if exists "anon_all_entries" on public.nbm_entries;
drop policy if exists "anon_all_jerseys" on public.jerseys;
drop policy if exists "anon_all_sync" on public.calendar_sync_state;

create policy "anon_all_aes"     on public.aes                for all using (true) with check (true);
create policy "anon_all_entries" on public.nbm_entries        for all using (true) with check (true);
create policy "anon_all_jerseys" on public.jerseys            for all using (true) with check (true);
create policy "anon_all_sync"    on public.calendar_sync_state for all using (true) with check (true);
