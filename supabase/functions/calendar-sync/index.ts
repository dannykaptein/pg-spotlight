// EMEA AE Activity Tracker — calendar-sync edge function (Supabase / Deno).
//
// Reads each active AE's Google Calendar centrally, detects external meetings,
// and upserts them into the `nbm_entries` table as source='calendar'. The upsert
// is keyed on calendar_event_id, so re-running never duplicates a meeting.
//
// Two ways to authenticate to Google (pick one):
//   A) Central-account OAuth (NO super-admin) — one ordinary account grants
//      consent once; its token reads every calendar that's internally visible.
//      Set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN.
//   B) Service account + domain-wide delegation (needs a Workspace super-admin).
//      Set GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY.
//
// Trigger it on a schedule (see docs/calendar-sync.md) or on demand from the
// dashboard's "Calendar Sync → Run sync now" button.
//
// Required environment variables (set with `supabase secrets set`):
//   SUPABASE_URL                  - your project URL (injected automatically)
//   SUPABASE_SERVICE_ROLE_KEY     - service-role key (injected automatically)
//   COMPANY_DOMAINS               - extra internal domains (cursor.com, anysphere.co,
//                                   x.ai are always internal by default)
// Auth option A — central-account OAuth (no super-admin):
//   GOOGLE_OAUTH_CLIENT_ID        - OAuth client id (Google Cloud, Web app)
//   GOOGLE_OAUTH_CLIENT_SECRET    - OAuth client secret
//   GOOGLE_OAUTH_REFRESH_TOKEN    - refresh token for the central account
//                                   (scopes: calendar.readonly + spreadsheets.readonly)
// Auth option B — service account + domain-wide delegation:
//   GOOGLE_SA_CLIENT_EMAIL        - service account client email
//   GOOGLE_SA_PRIVATE_KEY         - service account private key (PEM, \n escaped)
// Optional (calendar scan):
//   SYNC_WINDOW_PAST_DAYS         - how far back to scan (default 28)
//   SYNC_WINDOW_FUTURE_DAYS       - how far forward to scan (default 7)
//   REPORTING_START              - never import before this (default 2026-08-01)
//   DEFAULT_NBM_LEVEL             - fallback level (default "Director/Head of")
// Optional (automatic roster from a shared Google Sheet — the simplest option):
//   ROSTER_SHEET_ID               - spreadsheet id (share the sheet with the service
//                                   account email as Viewer; enable the Sheets API)
//   ROSTER_SHEET_TABS             - comma-separated tab names to read (default: all tabs)
//   ROSTER_DEFAULT_COUNTRY        - fallback ISO country code (default "GB")
//
// Optional (automatic roster from the Google Workspace Directory — advanced):
//   GOOGLE_ADMIN_SUBJECT          - an admin user to impersonate for the Admin SDK
//                                   (domain-wide delegation must grant directory scopes)
//   ROSTER_GROUP_EMAILS           - comma-separated Google Group(s) whose members are AEs
//   ROSTER_ORG_UNIT               - org-unit path to list users from (e.g. "/EMEA/PG")
//   ROSTER_QUERY                  - Directory users.list query (e.g. "orgTitle:Account Executive")
//   ROSTER_HIRE_DATE_FIELD        - custom-schema field holding start date ("Schema.field")
//   ROSTER_REGION_FIELD           - where to read region from: "department" (default),
//                                   "orgUnit", "costCenter", or "Schema.field"
//
// Roster discovery is OPT-IN. Provide a Google Sheet (ROSTER_SHEET_ID) OR the
// Directory settings above; the Sheet takes precedence when both are set. An AE is
// treated as "started" when their start date is on or before today (a future date
// makes them a pending joiner). Discovered AEs are upserted into `aes` keyed on
// calendar_email, so re-running never duplicates people and new hires appear
// automatically.
//
// Auto-tracked NBMs are counted automatically — there is no leader approval
// step for calendar-sourced meetings. Past accepted meetings land as "done",
// upcoming ones as "confirmed"; both count toward the standings immediately.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SA_EMAIL = Deno.env.get("GOOGLE_SA_CLIENT_EMAIL") || "";
const SA_KEY = (Deno.env.get("GOOGLE_SA_PRIVATE_KEY") || "").replace(/\\n/g, "\n");
// Central-account OAuth (no super-admin / no domain-wide delegation): one ordinary
// account grants consent once and we read every internally-visible calendar with
// its token. Preferred when colleagues can already see each other's event details.
const OAUTH_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const OAUTH_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const OAUTH_REFRESH_TOKEN = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN") || "";
const OAUTH_ENABLED = !!(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET && OAUTH_REFRESH_TOKEN);
// Anyone on a company domain is internal, so a meeting with only these attendees
// is NOT an external meeting. Defaults cover all our domains; COMPANY_DOMAINS can
// extend them. cursor.com, anysphere.co and x.ai are always treated as internal.
const DEFAULT_COMPANY_DOMAINS = ["cursor.com", "anysphere.co", "x.ai"];
const COMPANY_DOMAINS = Array.from(
  new Set([
    ...DEFAULT_COMPANY_DOMAINS,
    ...(Deno.env.get("COMPANY_DOMAINS") || "")
      .split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
  ]),
);
const PAST_DAYS = Number(Deno.env.get("SYNC_WINDOW_PAST_DAYS") || "28");
const FUTURE_DAYS = Number(Deno.env.get("SYNC_WINDOW_FUTURE_DAYS") || "7");
// Never pull anything before the current quarter starts — the tracker only counts
// activity from Aug 1, 2026 onward, so there's no reason to import older meetings.
const REPORTING_START = Deno.env.get("REPORTING_START") || "2026-08-01T00:00:00Z";
const DEFAULT_LEVEL = Deno.env.get("DEFAULT_NBM_LEVEL") || "Director/Head of";

// Roster discovery config (optional). Sheet source (preferred) …
const ROSTER_SHEET_ID = Deno.env.get("ROSTER_SHEET_ID") || "";
const ROSTER_SHEET_TABS = (Deno.env.get("ROSTER_SHEET_TABS") || "")
  .split(",").map((t) => t.trim()).filter(Boolean);
const ROSTER_DEFAULT_COUNTRY = (Deno.env.get("ROSTER_DEFAULT_COUNTRY") || "GB").toUpperCase();
// … or Directory source (advanced).
const ADMIN_SUBJECT = Deno.env.get("GOOGLE_ADMIN_SUBJECT") || "";
const ROSTER_GROUPS = (Deno.env.get("ROSTER_GROUP_EMAILS") || "")
  .split(",").map((g) => g.trim().toLowerCase()).filter(Boolean);
const ROSTER_ORG_UNIT = Deno.env.get("ROSTER_ORG_UNIT") || "";
const ROSTER_QUERY = Deno.env.get("ROSTER_QUERY") || "";
const ROSTER_HIRE_DATE_FIELD = Deno.env.get("ROSTER_HIRE_DATE_FIELD") || "";
const ROSTER_REGION_FIELD = Deno.env.get("ROSTER_REGION_FIELD") || "department";
const SHEET_ENABLED = !!ROSTER_SHEET_ID;
const DIRECTORY_ENABLED = !!ADMIN_SUBJECT && (ROSTER_GROUPS.length > 0 || !!ROSTER_ORG_UNIT || !!ROSTER_QUERY);
const DIRECTORY_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
].join(" ");
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* ── Seniority inference ──────────────────────────────────────────────────
 * External prospects aren't in your directory, so we infer the NBM level from
 * seniority keywords found in the event title/description and attendee names.
 * Managers can always override during verification. */
const LEVEL_KEYWORDS: [RegExp, string][] = [
  [/\b(ceo|cto|cio|ciso|cfo|coo|chief|founder|co-?founder|owner|president|evp|svp|vp|vice president)\b/i, "VP/CTO"],
  [/\b(director|head of|dir\.|vp of|principal|partner)\b/i, "Director/Head of"],
  [/\b(engineer|developer|architect|lead|manager|analyst|specialist|ic|staff)\b/i, "Engineer"],
];
function inferLevel(text: string): string {
  for (const [re, level] of LEVEL_KEYWORDS) if (re.test(text)) return level;
  return DEFAULT_LEVEL;
}

/* ── Meeting type ──────────────────────────────────────────────────────────
 * An external meeting is just an external meeting: it's recorded as the neutral
 * "Activity" type — NOT assumed to be an NBM. It's the AE's job to tag it (NBM,
 * VO progression, Champion go/no-go or EB go/no-go). */
const DEFAULT_MEETING_TYPE = "Activity";
function defaultMeetingType(): string {
  return DEFAULT_MEETING_TYPE;
}

function isInternal(email: string): boolean {
  const domain = (email.split("@")[1] || "").toLowerCase();
  return COMPANY_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}
function accountFromDomain(email: string): string {
  const domain = (email.split("@")[1] || "").toLowerCase();
  const core = domain.split(".").filter((p) => !["com", "co", "io", "net", "org", "ai", "www"].includes(p))[0] || domain;
  return core ? core.charAt(0).toUpperCase() + core.slice(1) : "Prospect";
}
// Monday (UTC) of the given date — matches the app's weekKey convention.
function mondayISO(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

/* ── Google service-account OAuth (domain-wide delegation) ─────────────────
 * Mint a short-lived access token that impersonates `subject` (an AE's email)
 * with read-only Calendar scope. Uses RS256 via Web Crypto. */
function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(str: string): string {
  return b64url(new TextEncoder().encode(str));
}
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
const tokenCache = new Map<string, { token: string; exp: number }>();
async function getAccessToken(subject: string, scope = CALENDAR_SCOPE): Promise<string> {
  const cacheKey = `${subject}::${scope}`;
  const cached = tokenCache.get(cacheKey);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claim: Record<string, unknown> = {
    iss: SA_EMAIL,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  // With a subject we impersonate that user (domain-wide delegation); without one
  // the token represents the service account itself (used to read a shared Sheet).
  if (subject) claim.sub = subject;
  const unsigned = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(SA_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token for ${subject}: ${body.error || res.status} ${body.error_description || ""}`);
  tokenCache.set(cacheKey, { token: body.access_token, exp: now + (body.expires_in || 3600) });
  return body.access_token;
}

/* ── Central-account OAuth (refresh token) ─────────────────────────────────
 * Exchange the central account's long-lived refresh token for a short-lived
 * access token. The scopes are whatever were granted at consent (we ask for
 * calendar.readonly + spreadsheets.readonly). One token reads every calendar
 * that's internally visible to the central account — no impersonation. */
let oauthCache: { token: string; exp: number } | null = null;
async function getOAuthToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (oauthCache && oauthCache.exp - 60 > now) return oauthCache.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      refresh_token: OAUTH_REFRESH_TOKEN,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`oauth refresh: ${body.error || res.status} ${body.error_description || ""}`);
  oauthCache = { token: body.access_token, exp: now + (body.expires_in || 3600) };
  return body.access_token;
}

// Token to read an AE's calendar: central-account OAuth reads any internally
// visible calendar directly; otherwise the service account impersonates the AE.
async function calendarTokenFor(aeEmail: string): Promise<string> {
  return OAUTH_ENABLED ? await getOAuthToken() : await getAccessToken(aeEmail);
}
// Token to read the roster Google Sheet (shared with whichever account we use).
async function sheetToken(): Promise<string> {
  return OAUTH_ENABLED ? await getOAuthToken() : await getAccessToken("", SHEETS_SCOPE);
}

type GEvent = {
  id: string;
  summary?: string;
  description?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; organizer?: boolean; resource?: boolean; self?: boolean }[];
  organizer?: { email?: string };
};
async function listEvents(token: string, calendarId: string, timeMin: string, timeMax: string): Promise<GEvent[]> {
  const out: GEvent[] = [];
  let pageToken = "";
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showDeleted", "false");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`events ${calendarId}: ${res.status} ${t.slice(0, 160)}`);
    }
    const body = await res.json();
    (body.items || []).forEach((e: GEvent) => out.push(e));
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return out;
}

/* ── Google Admin SDK Directory API (roster discovery) ────────────────────── */
type DirUser = {
  primaryEmail?: string;
  name?: { fullName?: string; givenName?: string; familyName?: string };
  suspended?: boolean;
  archived?: boolean;
  orgUnitPath?: string;
  organizations?: { title?: string; department?: string; costCenter?: string; location?: string }[];
  addresses?: { countryCode?: string; country?: string }[];
  locations?: { area?: string; buildingId?: string }[];
  relations?: { type?: string; value?: string }[];
  customSchemas?: Record<string, Record<string, unknown>>;
};

async function dirGet(token: string, url: URL): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`directory ${url.pathname}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
// All ACTIVE user members of a group (recurses one level into nested groups).
async function listGroupMemberEmails(token: string, group: string, seen = new Set<string>()): Promise<string[]> {
  if (seen.has(group)) return [];
  seen.add(group);
  const emails: string[] = [];
  let pageToken = "";
  do {
    const url = new URL(`https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(group)}/members`);
    url.searchParams.set("maxResults", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await dirGet(token, url);
    for (const m of body.members || []) {
      if (m.type === "USER" && m.status === "ACTIVE" && m.email) emails.push(String(m.email).toLowerCase());
      else if (m.type === "GROUP" && m.email) emails.push(...(await listGroupMemberEmails(token, String(m.email).toLowerCase(), seen)));
    }
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return emails;
}
async function getDirUser(token: string, email: string): Promise<DirUser | null> {
  try {
    const url = new URL(`https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(email)}`);
    url.searchParams.set("projection", "full");
    url.searchParams.set("viewType", "admin_view");
    return await dirGet(token, url);
  } catch (e) {
    console.error(`getUser ${email}: ${(e as Error).message}`);
    return null;
  }
}
// users.list by org unit and/or free-text query.
async function listDirUsers(token: string): Promise<DirUser[]> {
  const domain = COMPANY_DOMAINS[0];
  const out: DirUser[] = [];
  let pageToken = "";
  do {
    const url = new URL("https://admin.googleapis.com/admin/directory/v1/users");
    if (domain) url.searchParams.set("domain", domain);
    url.searchParams.set("projection", "full");
    url.searchParams.set("viewType", "admin_view");
    url.searchParams.set("maxResults", "200");
    const query = [ROSTER_QUERY, ROSTER_ORG_UNIT ? `orgUnitPath='${ROSTER_ORG_UNIT}'` : ""].filter(Boolean).join(" ");
    if (query) url.searchParams.set("query", query);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await dirGet(token, url);
    (body.users || []).forEach((u: DirUser) => out.push(u));
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return out;
}
function customField(u: DirUser, path: string): string {
  const dot = path.indexOf(".");
  if (dot < 0) return "";
  const schema = path.slice(0, dot), field = path.slice(dot + 1);
  const v = u.customSchemas?.[schema]?.[field];
  return v == null ? "" : String(v);
}
function regionFor(u: DirUser): string {
  const f = ROSTER_REGION_FIELD;
  let v = "";
  if (f === "department") v = u.organizations?.[0]?.department || "";
  else if (f === "costCenter") v = u.organizations?.[0]?.costCenter || "";
  else if (f === "orgUnit") v = (u.orgUnitPath || "").split("/").filter(Boolean).pop() || "";
  else if (f.includes(".")) v = customField(u, f);
  return v || "EMEA";
}
function countryFor(u: DirUser): string {
  const cc = u.addresses?.find((a) => a.countryCode)?.countryCode;
  return (cc || ROSTER_DEFAULT_COUNTRY).toUpperCase();
}
// "started" + the ISO start date, from the optional hire-date custom field.
function hireInfo(u: DirUser): { started: boolean; startDate: string } {
  const todayISO = new Date().toISOString().slice(0, 10);
  if (ROSTER_HIRE_DATE_FIELD) {
    const raw = customField(u, ROSTER_HIRE_DATE_FIELD);
    const d = raw ? new Date(raw) : null;
    if (d && !isNaN(d.getTime())) {
      const iso = d.toISOString().slice(0, 10);
      return { started: iso <= todayISO, startDate: iso };
    }
  }
  // No hire date available → treat an active account as already started.
  return { started: true, startDate: todayISO };
}

/* Normalised roster record produced by either source. */
type RosterAE = { email: string; name: string; region: string; rvp: string; country: string; started: boolean; startDate: string };

/* ── Google Sheets roster source (simplest) ───────────────────────────────── */
async function getSheetTabTitles(token: string): Promise<string[]> {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ROSTER_SHEET_ID)}`);
  url.searchParams.set("fields", "sheets.properties.title");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sheet meta: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return (body.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);
}
async function getSheetValues(token: string, range: string): Promise<string[][]> {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ROSTER_SHEET_ID)}/values/${encodeURIComponent(range)}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sheet values ${range}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return (body.values || []) as string[][];
}
const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function colIndex(headers: string[], names: string[]): number {
  const want = names.map(norm);
  return headers.findIndex((h) => want.includes(norm(h)));
}
// A row is a header if it names the AE column plus a team or leader column.
function looksLikeRosterHeader(row: string[]): boolean {
  const cells = (row || []).map(norm);
  const has = (names: string[]) => names.map(norm).some((n) => cells.includes(n));
  return has(["name", "ae", "account executive", "full name", "rep"]) &&
    has(["team", "region", "pod", "segment", "market", "rvp", "lead", "team lead", "manager", "leader"]);
}
// Map a country name or code to the ISO alpha-2 code the dashboard uses for flags.
const COUNTRY_BY_NAME: Record<string, string> = {
  unitedkingdom: "GB", uk: "GB", greatbritain: "GB", england: "GB",
  germany: "DE", france: "FR", netherlands: "NL", holland: "NL", spain: "ES",
  italy: "IT", sweden: "SE", norway: "NO", denmark: "DK", finland: "FI",
  ireland: "IE", belgium: "BE", switzerland: "CH", austria: "AT", portugal: "PT",
  poland: "PL", luxembourg: "LU", unitedarabemirates: "AE", uae: "AE",
  saudiarabia: "SA", israel: "IL", southafrica: "ZA", turkey: "TR", turkiye: "TR",
};
function toCountryCode(v: string): string {
  const s = String(v || "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return COUNTRY_BY_NAME[norm(s)] || ROSTER_DEFAULT_COUNTRY;
}
// A future start date makes the AE a pending joiner; anything today-or-earlier
// (or a blank/unparseable date) is treated as already started.
function startedInfo(raw: string): { started: boolean; startDate: string } {
  const todayISO = new Date().toISOString().slice(0, 10);
  const d = raw ? new Date(raw) : null;
  if (d && !isNaN(d.getTime())) {
    const iso = d.toISOString().slice(0, 10);
    return { started: iso <= todayISO, startDate: iso };
  }
  return { started: true, startDate: todayISO };
}
async function rosterFromSheet(): Promise<RosterAE[]> {
  const token = await sheetToken(); // central account or service account reads a shared sheet
  const tabs = ROSTER_SHEET_TABS.length ? ROSTER_SHEET_TABS : await getSheetTabTitles(token);
  const out: RosterAE[] = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    let values: string[][];
    try {
      values = await getSheetValues(token, `${tab}!A1:Z2000`);
    } catch (e) {
      console.error((e as Error).message);
      continue;
    }
    if (values.length < 2) continue;
    // The EMEA roster sheet repeats a "Leader / Team / AE" header for each team
    // block and only fills Leader/Team on the first row of the block, so we
    // detect headers on the fly and forward-fill those two columns downward.
    let idx: { name: number; email: number; team: number; rvp: number; start: number; country: number } | null = null;
    let lastTeam = "";
    let lastRvp = "";
    for (const row of values) {
      if (!row || row.every((c) => !String(c || "").trim())) continue; // blank spacer row
      if (looksLikeRosterHeader(row)) {
        idx = {
          name: colIndex(row, ["name", "ae", "account executive", "full name", "rep"]),
          email: colIndex(row, ["email", "calendar", "work email", "google email", "primary email", "calendar email"]),
          team: colIndex(row, ["team", "region", "pod", "segment", "market"]),
          rvp: colIndex(row, ["rvp", "lead", "team lead", "manager", "leader"]),
          start: colIndex(row, ["start date", "start", "join date", "onboard date", "hire date"]),
          country: colIndex(row, ["country", "country code", "location"]),
        };
        lastTeam = "";
        lastRvp = "";
        continue;
      }
      if (!idx) continue; // data appearing before any header — skip
      const teamCell = idx.team >= 0 ? String(row[idx.team] || "").trim() : "";
      if (teamCell) lastTeam = teamCell;
      const rvpCell = idx.rvp >= 0 ? String(row[idx.rvp] || "").trim() : "";
      if (rvpCell) lastRvp = rvpCell;
      const name = idx.name >= 0 ? String(row[idx.name] || "").trim() : "";
      const email = idx.email >= 0 ? String(row[idx.email] || "").trim().toLowerCase() : "";
      if (!email || seen.has(email)) continue; // an AE needs an email to map a calendar
      seen.add(email);
      // Team from the forward-filled block value, else the tab name (Benelux, …).
      const region = lastTeam || tab;
      const { started, startDate } = startedInfo(idx.start >= 0 ? String(row[idx.start] || "") : "");
      out.push({
        email,
        name: name || email,
        region: region || "EMEA",
        rvp: lastRvp,
        country: idx.country >= 0 ? toCountryCode(String(row[idx.country] || "")) : ROSTER_DEFAULT_COUNTRY,
        started,
        startDate,
      });
    }
  }
  return out;
}

/* ── Directory roster source (advanced) ───────────────────────────────────── */
async function rosterFromDirectory(): Promise<RosterAE[]> {
  const token = await getAccessToken(ADMIN_SUBJECT, DIRECTORY_SCOPES);
  const byEmail = new Map<string, DirUser>();
  if (ROSTER_GROUPS.length) {
    const emails = new Set<string>();
    for (const g of ROSTER_GROUPS) (await listGroupMemberEmails(token, g)).forEach((e) => emails.add(e));
    for (const email of emails) {
      const u = await getDirUser(token, email);
      if (u?.primaryEmail) byEmail.set(u.primaryEmail.toLowerCase(), u);
    }
  }
  if (ROSTER_ORG_UNIT || ROSTER_QUERY) {
    for (const u of await listDirUsers(token)) if (u.primaryEmail) byEmail.set(u.primaryEmail.toLowerCase(), u);
  }
  const users = [...byEmail.values()].filter((u) => u.primaryEmail && !u.suspended && !u.archived);

  // Resolve each AE's team lead (RVP) from the Google "manager" relation.
  const nameByEmail = new Map<string, string>();
  users.forEach((u) => nameByEmail.set(u.primaryEmail!.toLowerCase(), u.name?.fullName || u.primaryEmail!));
  async function leadName(u: DirUser): Promise<string> {
    const mgr = u.relations?.find((r) => (r.type || "").toLowerCase() === "manager")?.value;
    if (!mgr) return "";
    const key = mgr.toLowerCase();
    if (nameByEmail.has(key)) return nameByEmail.get(key)!;
    const m = await getDirUser(token, key);
    const nm = m?.name?.fullName || mgr;
    nameByEmail.set(key, nm);
    return nm;
  }

  const out: RosterAE[] = [];
  for (const u of users) {
    const { started, startDate } = hireInfo(u);
    out.push({
      email: u.primaryEmail!.toLowerCase(),
      name: u.name?.fullName || u.primaryEmail!,
      region: regionFor(u),
      rvp: await leadName(u),
      country: countryFor(u),
      started,
      startDate,
    });
  }
  return out;
}

/* Upsert a normalised roster into `aes`, preserving existing ids (so
 * nbm_entries.ae_id links survive) and keying on calendar_email. */
async function upsertRoster(records: RosterAE[]): Promise<{ scanned: number; added: number; updated: number; active: number }> {
  const existRes = await sb("aes?select=id,calendar_email");
  const idByEmail = new Map<string, string>();
  (await existRes.json()).forEach((r: any) => { if (r.calendar_email) idByEmail.set(String(r.calendar_email).toLowerCase(), r.id); });

  let active = 0, added = 0, updated = 0;
  const rows = records.map((r) => {
    if (r.started) active++;
    if (idByEmail.has(r.email)) updated++; else added++;
    return {
      id: idByEmail.get(r.email) || `dir-${crypto.randomUUID()}`,
      name: r.name, calendar_email: r.email, country: r.country,
      region: r.region, rvp: r.rvp, start_date: r.startDate, active: r.started,
    };
  });
  if (rows.length) {
    const res = await sb("aes?on_conflict=calendar_email", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`upsert aes: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return { scanned: records.length, added, updated, active };
}

/* Discover the roster from a shared Google Sheet (preferred) or the Directory,
 * and upsert it. Returns stats + which source was used, or null when disabled. */
async function syncRoster(): Promise<{ scanned: number; added: number; updated: number; active: number; source: string } | null> {
  let records: RosterAE[] | null = null;
  let source = "";
  if (SHEET_ENABLED) { records = await rosterFromSheet(); source = "sheet"; }
  else if (DIRECTORY_ENABLED) { records = await rosterFromDirectory(); source = "directory"; }
  if (!records) return null;
  return { ...(await upsertRoster(records)), source };
}

/* ── Supabase REST helpers (service role) ─────────────────────────────────── */
function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json", ...(init.headers || {}),
    },
  });
}

type NBMRow = {
  id: string; ae_id: string; week_key: string; level: string; account: string;
  value_pyramid: boolean; held: boolean; calendarised: boolean; date: string; note: string;
  status: string; verified_by: string; verified_at: string; created_at: string;
  source: string; calendar_event_id: string; attendee_email: string; attendee_name: string;
  attendee_title: string; auto_level: string; meeting_type: string;
};

async function run() {
  if (!OAUTH_ENABLED && (!SA_EMAIL || !SA_KEY))
    throw new Error("No Google auth configured: set GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN (central account) or GOOGLE_SA_CLIENT_EMAIL/PRIVATE_KEY (service account).");
  if (!COMPANY_DOMAINS.length) throw new Error("COMPANY_DOMAINS not configured");

  // Step 1 (optional): discover the roster from the Directory so newly-started
  // AEs — and whole teams — show up automatically before we scan calendars.
  let roster: Awaited<ReturnType<typeof syncRoster>> = null;
  try {
    roster = await syncRoster();
  } catch (e) {
    console.error(`roster sync: ${(e as Error).message}`);
  }

  const now = new Date();
  // Scan back PAST_DAYS, but never earlier than the quarter start (Aug 1).
  const windowStart = new Date(now.getTime() - PAST_DAYS * 864e5);
  const reportingStart = new Date(REPORTING_START);
  const timeMin = (windowStart > reportingStart ? windowStart : reportingStart).toISOString();
  const timeMax = new Date(now.getTime() + FUTURE_DAYS * 864e5).toISOString();

  // Active AEs that have a calendar mapped (includes anyone just discovered above).
  const aesRes = await sb("aes?select=id,name,calendar_email,active");
  const aes = (await aesRes.json()).filter((a: any) => a.calendar_email && a.active !== false);

  // Existing calendar rows so we don't clobber manager edits: we only insert new
  // ones and refresh detection fields, never override status once a human touched it.
  // Keyed per (ae, event) because one meeting can be activity for several AEs.
  const existRes = await sb("nbm_entries?source=eq.calendar&select=id,ae_id,calendar_event_id,status,verified_by,verified_at,meeting_type");
  const existing = new Map<string, any>();
  (await existRes.json()).forEach((r: any) => existing.set(`${r.ae_id}::${r.calendar_event_id}`, r));

  let scanned = 0, created = 0, updated = 0;
  const toUpsert: NBMRow[] = [];
  // Guard against the same (ae, event) appearing twice in one batch.
  const seen = new Set<string>();

  for (const ae of aes) {
    let token: string;
    try {
      token = await calendarTokenFor(ae.calendar_email);
    } catch (e) {
      console.error(`skip ${ae.name}: ${e.message}`);
      continue;
    }
    let events: GEvent[];
    try {
      events = await listEvents(token, ae.calendar_email, timeMin, timeMax);
    } catch (e) {
      console.error(`events ${ae.name}: ${e.message}`);
      continue;
    }
    scanned += events.length;

    // Precompute external contacts per event for next-step detection.
    const nbmEvents = events.filter((e) => e.status !== "cancelled" && e.start?.dateTime);
    for (const ev of nbmEvents) {
      const attendees = ev.attendees || [];
      const external = attendees.filter(
        (a) => a.email && !a.resource && !isInternal(a.email) && !isInternal(ev.organizer?.email || ""),
      );
      // Not an NBM: no external human attendee, or the AE declined.
      if (!external.length) continue;
      const selfDeclined = attendees.some((a) => a.self && a.responseStatus === "declined");
      if (selfDeclined) continue;

      const primary = external[0];
      const startISO = ev.start!.dateTime!;
      const start = new Date(startISO);
      const endISO = ev.end?.dateTime || startISO;
      const held = new Date(endISO) < now &&
        (attendees.some((a) => a.self && a.responseStatus === "accepted") || ev.organizer?.email === ae.calendar_email);

      // Booked next step: another external meeting with the same domain later on.
      const primaryDomain = (primary.email!.split("@")[1] || "").toLowerCase();
      const calendarised = nbmEvents.some((o) =>
        o.id !== ev.id && new Date(o.start!.dateTime!) > start &&
        (o.attendees || []).some((a) => a.email && !isInternal(a.email) &&
          (a.email.split("@")[1] || "").toLowerCase() === primaryDomain),
      );

      const inferText = `${ev.summary || ""} ${ev.description || ""} ${primary.displayName || ""} ${primary.email || ""}`;
      const level = inferLevel(inferText);
      const eventId = ev.id;
      const key = `${ae.id}::${eventId}`;
      if (seen.has(key)) continue; // same meeting already recorded for this AE
      seen.add(key);
      const prior = existing.get(key);
      // Auto-tracked NBMs are counted automatically — no leader approval step.
      // Past accepted meetings are "done", upcoming ones "confirmed"; both count.
      // If a leader has manually overridden the status, respect that.
      const humanTouched = prior && prior.verified_by && !/auto/i.test(prior.verified_by);
      const status = humanTouched ? prior.status : (held ? "done" : "confirmed");
      // New meetings are recorded as the neutral "Activity" type; on re-sync we
      // keep whatever's already there so inline AE tags in the dashboard survive.
      const mtType = prior?.meeting_type || defaultMeetingType();

      const row: NBMRow = {
        id: prior?.id || `cal-${ae.id}-${eventId}`,
        ae_id: ae.id,
        week_key: mondayISO(start),
        level,
        account: accountFromDomain(primary.email!),
        value_pyramid: false, // a value-story is a human judgement, not auto-scored
        held,
        calendarised,
        date: startISO.slice(0, 10),
        note: (ev.summary || "").slice(0, 200),
        status,
        verified_by: humanTouched ? (prior?.verified_by || "") : "Calendar sync (auto)",
        verified_at: humanTouched ? (prior?.verified_at || "") : new Date().toISOString(),
        created_at: startISO,
        source: "calendar",
        calendar_event_id: eventId,
        attendee_email: primary.email || "",
        attendee_name: primary.displayName || "",
        attendee_title: "",
        auto_level: level,
        meeting_type: mtType,
      };
      toUpsert.push(row);
      if (prior) updated++; else created++;
    }
  }

  if (toUpsert.length) {
    const res = await sb("nbm_entries?on_conflict=ae_id,calendar_event_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(toUpsert),
    });
    if (!res.ok) throw new Error(`upsert nbm_entries: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  // Record bookkeeping for the dashboard's status card.
  const rosterMsg = roster
    ? `Roster: ${roster.scanned} AEs (${roster.added} new, ${roster.active} started). `
    : "";
  await sb("calendar_sync_state?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      id: "global", last_run_at: new Date().toISOString(), last_status: "ok",
      events_scanned: scanned, nbms_created: created, nbms_updated: updated,
      window_start: timeMin.slice(0, 10), window_end: timeMax.slice(0, 10),
      message: `${rosterMsg}Synced ${aes.length} calendar${aes.length === 1 ? "" : "s"} · ${created} new, ${updated} updated NBMs.`,
    }]),
  });

  return {
    ok: true, aes: aes.length, eventsScanned: scanned, nbmsCreated: created, nbmsUpdated: updated,
    roster: roster || undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const result = await run();
    return new Response(JSON.stringify(result), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    // Best-effort: record the failure so the dashboard shows it.
    try {
      await sb("calendar_sync_state?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: "global", last_run_at: new Date().toISOString(), last_status: "error", message: String(e.message || e).slice(0, 300) }]),
      });
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
