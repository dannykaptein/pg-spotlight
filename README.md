# EMEA AE Activity Tracker — EMEA Pipeline Generation

An always-on, dependency-free web dashboard for tracking New Business Meetings (NBMs)
across the EMEA team. It grew out of the "EMEA AE Activity Tracker" championship and keeps the
Panini-style squad and value-led scoring, but runs continuously with rolling
week / month / quarter / all-time views — and can track NBMs **automatically from
the team's Google Calendars**.

## Highlights

- **Automatic NBM tracking** — a scheduled Supabase Edge Function reads the team's
  calendars, detects external meetings, infers seniority level, and files them as
  NBMs (no manual logging needed). See [`docs/calendar-sync.md`](docs/calendar-sync.md).
- **Panini squad cards** — every AE has a player card with an OVR that grows with
  verified points.
- **Value-led scoring** — seniority base points + outcome bonuses (held, Value
  Pyramid / POV, booked next step); max 8 per NBM.
- **Manager verification** — RVPs confirm and score outcomes; standings only reflect
  verified progress.
- **Rolling leaderboards** — week, month, quarter or all-time, plus Weekly MVPs.
- **Shared team data** — everything syncs live through Supabase.

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 5173
# then open http://127.0.0.1:5173
```

## Enable shared team data

1. Create a Supabase project.
2. Run [`supabase-schema.sql`](supabase-schema.sql) in the SQL editor (idempotent —
   safe to run on an existing EMEA AE Activity Tracker database to upgrade it).
3. Copy the Project URL and publishable/anon key into `config.js`.
4. Redeploy the site.

## Enable automatic calendar tracking

Follow [`docs/calendar-sync.md`](docs/calendar-sync.md): create a Google service
account with domain-wide delegation, deploy the `calendar-sync` edge function, map
each AE's calendar email in **Squad → Edit**, then schedule it with
[`supabase/schedule-calendar-sync.sql`](supabase/schedule-calendar-sync.sql).

## Publish

**GitHub Pages:** push and enable Pages (root). **Netlify Drop:** drag the folder
onto <https://app.netlify.com/drop>.

## Files

- `index.html` — app shell
- `styles.css` — theme
- `app.js` — application logic (state, scoring, views, calendar-sync UI)
- `share.js` — Supabase sync layer
- `config.js` — Supabase connection
- `supabase-schema.sql` — database schema (tables, RLS)
- `supabase/functions/calendar-sync/` — Google Calendar → NBM edge function
- `supabase/schedule-calendar-sync.sql` — pg_cron schedule for the sync
- `docs/calendar-sync.md` — automatic tracking setup guide
- `money.svg` — favicon
