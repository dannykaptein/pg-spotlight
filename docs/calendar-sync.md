# Automatic NBM tracking from Google Calendar

The PG Dashboard can detect New Business Meetings (NBMs) automatically from the
team's Google Calendars, so most meetings never need to be logged by hand. A
scheduled Supabase Edge Function reads each active AE's calendar centrally, finds
external meetings, infers the seniority level, and writes them into the dashboard
as `source = calendar` NBMs.

```
Google Calendar ──(service account, domain-wide delegation)──▶ calendar-sync (edge fn)
                                                                     │
                                                     upsert (dedup by event id)
                                                                     ▼
                                                        Supabase  nbm_entries
                                                                     │
                                                                     ▼
                                                        PG Dashboard insights
```

The same function can optionally **discover the roster** from the Google Workspace
Directory, so newly-started AEs — and whole teams — appear automatically without
anyone maintaining a list by hand (see section 5).

## What counts as an NBM

For each AE's calendar the function looks at timed events in the sync window and
keeps a meeting when **all** of these hold:

- it is not cancelled and the AE has not declined it;
- it has at least one **external** attendee (email domain not in `COMPANY_DOMAINS`).

For each kept meeting it derives:

- **Seniority** (VP/CTO · Director/Head of · Engineer) from keywords in the event
  title, description and attendee name — used only to break down where pipeline is
  coming from. There is **no scoring**: an NBM is an NBM.
- **Account** from the external attendee's email domain.
- **Held** — true when the meeting is in the past and was accepted.
- **Next step** — true when a later external meeting exists with the same company.

Each meeting maps to exactly one NBM, deduplicated by the Google event id, so the
job is safe to run as often as you like.

## 1. Create a Google service account with domain-wide delegation

You need Google Workspace **super-admin** access once.

1. In the [Google Cloud Console](https://console.cloud.google.com/) create (or pick)
   a project and enable the **Google Calendar API**.
2. **IAM & Admin → Service Accounts → Create service account.** Give it a name like
   `pg-dashboard-calendar`. No project roles are required.
3. Open the service account → **Keys → Add key → Create new key → JSON**. Download it.
   You'll use `client_email` and `private_key` from this file.
4. On the service account, note its **Unique ID** (a long number) under *Advanced settings*.
5. In the [Admin console](https://admin.google.com/) go to
   **Security → Access and data control → API controls → Domain-wide delegation →
   Add new**. Enter the service account's Unique ID (client ID) and this scope:

   ```
   https://www.googleapis.com/auth/calendar.readonly
   ```

This lets the service account read (only read) any user's calendar in your domain,
which is what makes central, zero-effort tracking possible.

## 2. Deploy the edge function

Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and link the project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Set the secrets (the private key must keep its newlines — `\n` escaped is fine):

```bash
supabase secrets set \
  GOOGLE_SA_CLIENT_EMAIL="pg-dashboard-calendar@your-project.iam.gserviceaccount.com" \
  GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
  COMPANY_DOMAINS="cursor.com" \
  DEFAULT_NBM_LEVEL="Director/Head of"
```

Auto-tracked NBMs are always counted the moment they're detected — there is no
approval step and no scoring.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

Deploy:

```bash
supabase functions deploy calendar-sync
```

Test it once (returns a JSON summary):

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/calendar-sync" \
  -H "Authorization: Bearer YOUR_ANON_OR_SERVICE_KEY"
```

You can also click **Calendar Sync → Run sync now** in the dashboard.

## 3. Map AEs to calendars

If you're maintaining the roster by hand, open **Team → Edit** for each AE and set
their **Calendar email** (their Google Workspace address). The **Calendar Sync** tab
shows coverage and flags anyone still missing a calendar. Only active AEs with a
calendar email are synced. If you enable roster discovery (section 5) this is filled
in automatically.

## 4. Schedule it

Run [`supabase/schedule-calendar-sync.sql`](../supabase/schedule-calendar-sync.sql)
in the SQL editor to run the sync automatically (hourly by default) via `pg_cron`
+ `pg_net`. Edit the cron expression and project ref inside the file first.

## 5. (Optional) Auto-detect the roster — from a Google Sheet

The easiest way to keep the whole team up to date (all of Benelux, Nordics, GEO
Enterprise, …) is a **shared Google Sheet**. Newly-started AEs appear automatically,
and future joiners show up as pending until their start date. No admin access needed.

**Lay out the sheet.** Use **one tab per team** (the tab name becomes the team/region),
or a single tab with a `Team` column. Each tab has a header row; column names are
matched flexibly (case/spacing-insensitive). Only **Email** is strictly required:

| Column (any of these names) | Required | Notes |
| --- | --- | --- |
| `Email` / `Calendar` / `Work email` | ✅ | The AE's Google Workspace address (their calendar) |
| `Name` / `AE` / `Full name` | – | Falls back to the email if omitted |
| `Team` / `Region` / `Pod` | – | Falls back to the **tab name** |
| `RVP` / `Lead` / `Team lead` | – | The team's leader (e.g. Kathrin Redlich for GEO Enterprise) |
| `Start date` / `Join date` / `Hire date` | – | Future date ⇒ pending joiner; blank ⇒ already started |
| `Country` / `Country code` | – | Name (`Netherlands`) or ISO code (`NL`) for the flag; else `ROSTER_DEFAULT_COUNTRY` |

**Share it with the service account.** In the Google Cloud Console enable the
**Google Sheets API**, then share the sheet with the service account's `client_email`
as **Viewer**. (No domain-wide delegation is needed for the sheet — the service
account reads it as itself.)

**Set the secret** (the id is the long string in the sheet URL):

```bash
supabase secrets set \
  ROSTER_SHEET_ID="1AbC…the_spreadsheet_id" \
  ROSTER_DEFAULT_COUNTRY="GB"
# optional: only read specific tabs
# ROSTER_SHEET_TABS="Benelux,Nordics,GEO Enterprise"
```

That's it — the next sync (scheduled or **Run sync now**) will upsert everyone into
the Team page, keyed on their calendar email so re-running never duplicates anyone,
and then scan their calendars for NBMs.

### Advanced alternative: the Google Workspace Directory

If you'd rather not maintain a sheet, the sync can read the roster from the Directory
instead. Add these read-only scopes to the service account's domain-wide delegation:

```
https://www.googleapis.com/auth/admin.directory.user.readonly
https://www.googleapis.com/auth/admin.directory.group.readonly
https://www.googleapis.com/auth/admin.directory.group.member.readonly
```

Then point it at the AEs (team lead is taken from each person's Google **manager**
relation, so teams group automatically):

```bash
supabase secrets set \
  GOOGLE_ADMIN_SUBJECT="admin@cursor.com" \
  ROSTER_GROUP_EMAILS="emea-pg-aes@cursor.com" \
  ROSTER_HIRE_DATE_FIELD="Employment.start_date" \
  ROSTER_REGION_FIELD="department"
```

The Sheet source takes precedence when both are configured.

## Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_SA_CLIENT_EMAIL` | — | Service account email |
| `GOOGLE_SA_PRIVATE_KEY` | — | Service account private key (PEM) |
| `COMPANY_DOMAINS` | — | Comma-separated internal domains; attendees on these are "internal" |
| `SYNC_WINDOW_PAST_DAYS` | `28` | How far back to scan |
| `SYNC_WINDOW_FUTURE_DAYS` | `7` | How far forward to scan |
| `DEFAULT_NBM_LEVEL` | `Director/Head of` | Seniority used when no keyword is found (breakdown only) |
| `ROSTER_SHEET_ID` | — | Google Sheet id to read the roster from (enables Sheet discovery) |
| `ROSTER_SHEET_TABS` | *(all tabs)* | Comma-separated tab names to read |
| `ROSTER_DEFAULT_COUNTRY` | `GB` | Fallback ISO country code for flags |
| `GOOGLE_ADMIN_SUBJECT` | — | Admin to impersonate for the Directory API (enables Directory discovery) |
| `ROSTER_GROUP_EMAILS` | — | Comma-separated Google Group(s) whose members are AEs |
| `ROSTER_ORG_UNIT` | — | Org-unit path to list users from (e.g. `/EMEA/PG`) |
| `ROSTER_QUERY` | — | Directory `users.list` query (e.g. `orgTitle:Account Executive`) |
| `ROSTER_HIRE_DATE_FIELD` | — | Custom-schema field with the start date (`Schema.field`) |
| `ROSTER_REGION_FIELD` | `department` | Where to read region: `department`, `orgUnit`, `costCenter`, or `Schema.field` |

## Notes & privacy

- The function only requests **read-only** calendar and directory access, and only
  stores the fields the dashboard needs (meeting title, date, external attendee,
  inferred seniority; for roster: name, email, team, region, start date).
- Auto-tracked NBMs are counted automatically — there is no approval step. Re-running
  refreshes untouched detections and adds new meetings without duplicating them.
- Prefer per-user OAuth over a service account? Each AE would connect their own
  calendar instead; the detection logic is identical. Open an issue if you want that
  variant wired up.
