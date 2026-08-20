-- Schedule the calendar-sync edge function to run automatically.
-- Run this once in the Supabase SQL editor AFTER deploying the function and
-- setting its secrets. It uses pg_cron (scheduler) + pg_net (HTTP) — both are
-- available on Supabase; enable them in Database → Extensions if needed.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the service-role key in Vault so it isn't written in plaintext here.
-- Do this once (replace the value), then the job below reads it back by name:
--   select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'calendar_sync_key');

-- Runs every hour on the hour. Adjust the cron expression as you like
-- (e.g. '*/30 * * * *' for every 30 minutes, or '0 6-20 * * 1-5' for business hours).
select cron.schedule(
  'pg-calendar-sync',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/calendar-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_key')
    ),
    body    := jsonb_build_object('trigger', 'cron')
  );
  $$
);

-- To inspect or remove the schedule later:
--   select * from cron.job;
--   select cron.unschedule('pg-calendar-sync');
