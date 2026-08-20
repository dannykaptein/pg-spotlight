/* EMEA AE Activity Tracker — EMEA Pipeline Generation
 * Ongoing team NBM (New Business Meeting) tracker. Dependency-free vanilla JS.
 * Data persists in localStorage and syncs to Supabase (see share.js). NBMs can
 * be logged manually or auto-tracked from the team's Google Calendars by the
 * calendar-sync edge function (see supabase/functions/calendar-sync).
 * Works fully offline from file://.
 */
(function () {
  "use strict";

  /* ============================================================
   * Program configuration
   * ========================================================== */
  const PROGRAM_START = "2026-06-15"; // Monday the tracker started collecting
  // New quarter kick-off. Meetings/NBMs dated before this are ignored everywhere
  // (KPIs, insights, team profiles, calendar counts) — Q3 is a clean slate.
  const REPORTING_START = "2026-08-01";
  function entryDateISO(e) {
    return String((e && (e.date || e.weekKey || e.createdAt)) || "").slice(0, 10);
  }
  function withinReporting(e) {
    const d = entryDateISO(e);
    return !d || d >= REPORTING_START;
  }
  const CHEATSHEET_URL =
    "https://docs.google.com/document/d/1OQ-ZzWUa_GYJPjIkmdbvRTMXsesoJccmrae5zxqNRIc/edit?tab=t.0";

  // NBM seniority level -> label + colour class. Used only to break down where
  // pipeline is coming from; there is no scoring or weighting.
  const LEVELS = {
    "VP/CTO": { cls: "vp", short: "VP / CTO" },
    "Director/Head of": { cls: "dir", short: "Director / Head of" },
    Engineer: { cls: "eng", short: "Engineer" },
  };

  // Meeting type -> label + colour class. Every entry carries one; "NBM" is the
  // default. Users can change it inline on each entry row.
  const MEETING_TYPES = {
    NBM: { cls: "nbm", short: "NBM" },
    "VO Progression": { cls: "vo", short: "VO progression" },
    "Champion Go/No-Go": { cls: "champ", short: "Champion go/no-go" },
    "EB Go/No-Go": { cls: "eb", short: "EB go/no-go" },
  };
  const DEFAULT_MEETING_TYPE = "NBM";
  function meetingType(e) {
    return MEETING_TYPES[e && e.meetingType] ? e.meetingType : DEFAULT_MEETING_TYPE;
  }

  const COUNTRIES = [
    { code: "GB", name: "United Kingdom", flag: "🇬🇧", color: "#cf2e3f" },
    { code: "DE", name: "Germany", flag: "🇩🇪", color: "#111111" },
    { code: "FR", name: "France", flag: "🇫🇷", color: "#1e3a8a" },
    { code: "NL", name: "Netherlands", flag: "🇳🇱", color: "#f5851f" },
    { code: "ES", name: "Spain", flag: "🇪🇸", color: "#c60b1e" },
    { code: "IT", name: "Italy", flag: "🇮🇹", color: "#1f8a4c" },
    { code: "SE", name: "Sweden", flag: "🇸🇪", color: "#1c69d4" },
    { code: "NO", name: "Norway", flag: "🇳🇴", color: "#173a7a" },
    { code: "DK", name: "Denmark", flag: "🇩🇰", color: "#c8102e" },
    { code: "FI", name: "Finland", flag: "🇫🇮", color: "#1d4ed8" },
    { code: "IE", name: "Ireland", flag: "🇮🇪", color: "#169b62" },
    { code: "BE", name: "Belgium", flag: "🇧🇪", color: "#111111" },
    { code: "CH", name: "Switzerland", flag: "🇨🇭", color: "#d52b1e" },
    { code: "AT", name: "Austria", flag: "🇦🇹", color: "#ed2939" },
    { code: "PT", name: "Portugal", flag: "🇵🇹", color: "#046a38" },
    { code: "PL", name: "Poland", flag: "🇵🇱", color: "#dc143c" },
    { code: "AE", name: "United Arab Emirates", flag: "🇦🇪", color: "#00843d" },
    { code: "SA", name: "Saudi Arabia", flag: "🇸🇦", color: "#006c35" },
    { code: "ZA", name: "South Africa", flag: "🇿🇦", color: "#007749" },
    { code: "IL", name: "Israel", flag: "🇮🇱", color: "#0038b8" },
  ];

  const REGIONS = [
    "GEO Enterprise",
    "UKI",
    "Benelux",
    "Central Europe",
    "Southern Europe",
    "Nordics",
  ];

  /* ============================================================
   * Utilities
   * ========================================================== */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  function countryByCode(code) {
    return COUNTRIES.find((c) => c.code === code) || { code: "", name: "—", flag: "🏳️", color: "#444" };
  }

  function parseDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // Monday of the week containing `date`.
  function mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = (d.getDay() + 6) % 7; // 0 = Monday
    d.setDate(d.getDate() - day);
    return d;
  }
  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }
  const DAY_MS = 86400000;

  function weekNumber(weekKey) {
    const start = mondayOf(parseDate(PROGRAM_START));
    const wk = parseDate(weekKey);
    return Math.round((wk - start) / (7 * DAY_MS)) + 1;
  }
  function weekLabel(weekKey) {
    const mon = parseDate(weekKey);
    const fri = addDays(mon, 4);
    const fmt = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return `${fmt(mon)} – ${fmt(fri)}`;
  }
  function currentProgramWeekKey() {
    const todayMon = mondayOf(new Date());
    const startMon = mondayOf(parseDate(PROGRAM_START));
    return toISO(todayMon < startMon ? startMon : todayMon);
  }
  function weekEndKey(weekKey) {
    return toISO(addDays(parseDate(weekKey), 4));
  }
  // ── Rolling-period helpers (used by the leaderboard scope switch) ──────────
  // A period is described by an inclusive [start, end] Monday-week range plus a
  // human label. `ref` is any weekKey inside the period.
  function periodRange(scope, ref) {
    const d = parseDate(ref);
    if (scope === "month") {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { start, end, label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) };
    }
    if (scope === "quarter") {
      const q = Math.floor(d.getMonth() / 3);
      const start = new Date(d.getFullYear(), q * 3, 1);
      const end = new Date(d.getFullYear(), q * 3 + 3, 0);
      return { start, end, label: `Q${q + 1} ${d.getFullYear()}` };
    }
    // all-time
    return { start: parseDate(PROGRAM_START), end: new Date(2999, 0, 1), label: "All time" };
  }
  function shiftPeriod(scope, ref, dir) {
    const d = parseDate(ref);
    if (scope === "month") return toISO(new Date(d.getFullYear(), d.getMonth() + dir, 1));
    if (scope === "quarter") return toISO(new Date(d.getFullYear(), d.getMonth() + dir * 3, 1));
    return ref; // all-time doesn't move
  }
  // Is an entry's booking week inside the given [start,end] date range?
  function entryInRange(e, start, end) {
    const wk = e.weekKey || weekKeyForDate(e.createdAt || e.date);
    const d = parseDate(wk);
    return d >= mondayOf(start) && d <= end;
  }
  function isActiveInWeek(ae, weekKey) {
    return !ae.startDate || ae.startDate <= weekEndKey(weekKey);
  }
  function activeAEsForWeek(weekKey) {
    return db.aes.filter((ae) => isActiveInWeek(ae, weekKey));
  }
  function formatStartDate(iso) {
    if (!iso) return "Start date TBD";
    return parseDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function formatLoggedAt(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `Logged ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }

  /* ============================================================
   * Persistence
   * ========================================================== */
  const STORE_KEY = "pg-spotlight-v1";
  let db = { aes: [], entries: [], jerseys: {}, settings: { managerName: "" }, calendarSync: null };

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
    } catch (e) {
      /* storage may be unavailable on file:// in some browsers; ignore */
    }
  }
  function loadOrSeed() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      raw = null;
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        db = {
          aes: parsed.aes || [],
          // Migrate legacy statuses to the booked -> confirmed -> done model.
          // verified meetings were fully counted -> "done"; pending ones were
          // awaiting the leader -> "booked"; anything unknown defaults to done.
          entries: (parsed.entries || []).map((e) => ({
            ...e,
            status: migrateStatus(e.status),
            verifiedBy: e.verifiedBy || "",
            verifiedAt: e.verifiedAt || "",
            // Entries predating meeting types default to NBM.
            meetingType: MEETING_TYPES[e.meetingType] ? e.meetingType : DEFAULT_MEETING_TYPE,
          })),
          jerseys: parsed.jerseys || {},
          settings: parsed.settings || { managerName: "" },
          calendarSync: parsed.calendarSync || null,
        };
        return;
      } catch (e) {
        /* fall through to seed */
      }
    }
    seed();
    save();
  }

  /* ============================================================
   * Seed data — 18 sample AEs + a populated kick-off week.
   * (All editable; rename to your real roster.)
   * ========================================================== */
  function seed() {
    // Roster mirrors the EMEA "AE name for PG App" sheet (Leader / Team / AE).
    // Country is a per-team default until the sheet carries a country column.
    const roster = [
      ["Alyssa Murre", "GB", "GEO Enterprise", "Kathrin Redlich"],
      ["Tom Gudgeon", "GB", "GEO Enterprise", "Kathrin Redlich"],
      ["Sid Power", "GB", "GEO Enterprise", "Kathrin Redlich"],
      ["Robert Eyre", "GB", "GEO Enterprise", "Kathrin Redlich"],
      ["Ludovica Peracino", "IT", "GEO Enterprise", "Kathrin Redlich"],
      ["Mackeznie Drysdale", "GB", "GEO Enterprise", "Kathrin Redlich"],
      ["Sevinc Celebi", "DE", "GEO Enterprise", "Kathrin Redlich"],
      ["Yvonne Kyri", "GB", "GEO Enterprise", "Kathrin Redlich"],
      ["Nicolas Chahoud", "DE", "GEO Enterprise", "Kathrin Redlich"],
      ["Marcquero Ermoza", "ES", "GEO Enterprise", "Kathrin Redlich"],
      ["Pierre Phelippeau", "FR", "GEO Enterprise", "Kathrin Redlich"],
      ["James Farnhill", "GB", "UKI", "Jacob Anderson"],
      ["Lauren Caska", "GB", "UKI", "Jacob Anderson"],
      ["Dylan Chambers", "GB", "UKI", "Jacob Anderson"],
      ["Jack Ferrari", "GB", "UKI", "Jacob Anderson"],
      ["Ivo Hayes", "GB", "UKI", "Jacob Anderson"],
      ["Ben Beaumont", "GB", "UKI", "Jacob Anderson"],
      ["Charles Addai-Appiah", "GB", "UKI", "Jason Creane"],
      ["Danielle Broeze", "GB", "UKI", "Jason Creane"],
      ["James Daniel", "GB", "UKI", "Jason Creane"],
      ["Ramya Gopalakrishnan", "GB", "UKI", "Jason Creane"],
      ["Sam Hesketh", "GB", "UKI", "Jason Creane"],
      ["Karim Chester", "GB", "UKI", "Jason Creane"],
      ["Michael Hart", "GB", "UKI", "Jason Creane"],
      ["Ben Harknett", "GB", "UKI", "Jason Creane"],
      ["Jeffrey de Roo", "NL", "Benelux", "Danny Kaptein"],
      ["Joren de Graaf", "NL", "Benelux", "Danny Kaptein"],
      ["Sjors Bonjer", "NL", "Benelux", "Danny Kaptein"],
      ["Gino Mommers", "NL", "Benelux", "Danny Kaptein"],
      ["Pieter D`Hondt", "BE", "Benelux", "Danny Kaptein"],
      ["Lotte Koop", "NL", "Benelux", "Danny Kaptein"],
      ["Enrico Antonacci", "NL", "Benelux", "Danny Kaptein"],
      ["Achraf Artimi", "NL", "Benelux", "Danny Kaptein"],
      ["Vincent Le Magoariec", "FR", "Central Europe", "Timo Trunk"],
      ["Sven Ehlhardt", "DE", "Central Europe", "Timo Trunk"],
      ["Tobias Tritscher", "DE", "Central Europe", "Timo Trunk"],
      ["Matthias Goellner", "DE", "Central Europe", "Timo Trunk"],
      ["Kevin Switala", "DE", "Central Europe", "Timo Trunk"],
      ["Robert Glowacz", "PL", "Central Europe", "Timo Trunk"],
      ["Joerg Kassner", "DE", "Central Europe", "Timo Trunk"],
      ["Daniel Campo", "ES", "Southern Europe", "Ben Caller"],
      ["Aurelien Aissa", "FR", "Southern Europe", "Ben Caller"],
      ["Alexandre Paradelo", "ES", "Southern Europe", "Ben Caller"],
      ["Mounir Ben Saad", "FR", "Southern Europe", "Ben Caller"],
      ["Julien Le Postec", "FR", "Southern Europe", "Ben Caller"],
      ["Elias Almqvist", "SE", "Nordics", "Sia Yaghoubi"],
      ["Eric Bodi Salén", "SE", "Nordics", "Sia Yaghoubi"],
      ["Ian Smith", "SE", "Nordics", "Sia Yaghoubi"],
      ["Camilla Kiernan", "SE", "Nordics", "Sia Yaghoubi"],
      ["Erik Ekedahl", "SE", "Nordics", "Sia Yaghoubi"],
      ["Mats Millnert", "SE", "Nordics", "Sia Yaghoubi"],
      ["Jonathan Falk Sundman", "SE", "Nordics", "Sia Yaghoubi"],
      ["Erik Rasmussen", "DK", "Nordics", "Sia Yaghoubi"],
    ];
    // Work email = first.[surname parts].@cursor.com, accents folded.
    // Name particles (de, le, ben, van …) attach to the following surname with
    // no dot (Jeffrey de Roo -> jeffrey.deroo) while regular parts stay dotted
    // (Jonathan Falk Sundman -> jonathan.falk.sundman) — this is the calendar key.
    // Names the general algorithm can't derive (dropped middle name / hyphen).
    const EMAIL_OVERRIDES = {
      "Eric Bodi Salén": "eric.salen@cursor.com",
      "Charles Addai-Appiah": "charles.appiah@cursor.com",
    };
    const emailFor = (name) => {
      const key = String(name).trim();
      if (EMAIL_OVERRIDES[key]) return EMAIL_OVERRIDES[key];
      const slug = (s) =>
        String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]/g, "");
      const particles = new Set(["de", "den", "der", "van", "von", "la", "le", "du", "da", "di", "del", "dos", "das", "ben", "bin", "al", "el", "d"]);
      const tokens = String(name).trim().split(/\s+/);
      const first = slug(tokens.shift() || "");
      const parts = [];
      let carry = "";
      for (const t of tokens) {
        const s = slug(t);
        if (!s) continue;
        if (particles.has(s)) { carry += s; continue; }
        parts.push(carry + s);
        carry = "";
      }
      if (carry) parts.push(carry);
      return `${[first, ...parts].filter(Boolean).join(".")}@cursor.com`;
    };
    db.aes = roster.map(([name, code, region, rvp]) => ({
      id: uid(),
      name,
      country: code,
      region,
      rvp,
      startDate: PROGRAM_START,
      calendarEmail: emailFor(name),
    }));

    // Seed a realistic kick-off week so the boards aren't empty.
    const wk = toISO(mondayOf(parseDate(PROGRAM_START)));
    const levels = Object.keys(LEVELS);
    const accounts = [
      "Helios Bank", "Northwind Logistics", "Aurora Retail", "Vertex Energy",
      "BluePeak Insurance", "Meridian Health", "Forge Manufacturing", "Cobalt Telecom",
      "Lumen Media", "Atlas Pharma", "Orbit Mobility", "Granite Capital",
    ];
    const entries = [];
    db.aes.forEach((ae, i) => {
      const count = 1 + ((i * 7 + 3) % 4); // 1..4 deterministic
      for (let j = 0; j < count; j++) {
        const level = levels[(i + j) % 3];
        const r = (i * 13 + j * 7) % 10;
        // Seed a mix: a few still booked (awaiting confirm), some confirmed,
        // most done — to demo every stage of the leader workflow.
        const status = r === 0 || r === 7 ? "booked" : r === 2 || r === 5 ? "confirmed" : "done";
        const counted = status !== "booked";
        // Mostly NBMs, with a deterministic sprinkle of other types for demo.
        const mtKeys = Object.keys(MEETING_TYPES);
        const meetingType = r >= 8 ? mtKeys[1 + ((i + j) % (mtKeys.length - 1))] : DEFAULT_MEETING_TYPE;
        entries.push({
          id: uid(),
          aeId: ae.id,
          weekKey: wk,
          level,
          account: accounts[(i + j) % accounts.length],
          valuePyramid: counted && r > 3,
          held: status === "done",
          calendarised: counted && r > 5,
          date: toISO(addDays(parseDate(wk), j % 5)),
          note: "",
          status: status,
          meetingType: meetingType,
          verifiedBy: counted ? "System (seed)" : "",
          verifiedAt: counted ? toISO(addDays(parseDate(wk), 4)) : "",
        });
      }
    });
    db.entries = entries;
    db.jerseys = {};
  }

  /* ============================================================
   * Aggregation helpers
   * ========================================================== */
  // An entry counts toward the standings once the leader has confirmed the
  // booking (base points) and keeps counting through "done" (with bonuses).
  function countsTowardStandings(e) {
    return (e.status === "confirmed" || e.status === "done") && withinReporting(e);
  }
  function migrateStatus(s) {
    if (s === "booked" || s === "confirmed" || s === "done" || s === "rejected") return s;
    if (s === "pending") return "booked";
    if (s === "verified") return "done";
    return "done"; // legacy entries with no status were counted
  }
  function entriesForWeek(weekKey) {
    return db.entries.filter((e) => e.weekKey === weekKey);
  }
  function leaderboard(scope, weekKey) {
    // Official standings only count manager-verified NBMs.
    // week = that week's bookings · month/quarter = every booking week in the
    // calendar month/quarter of weekKey · all = every booking week (all-time).
    const isWeek = scope === "week";
    let pool;
    if (isWeek) {
      pool = entriesForWeek(weekKey);
    } else {
      const { start, end } = periodRange(scope, weekKey);
      pool = db.entries.filter((e) => entryInRange(e, start, end));
    }
    pool = pool.filter(countsTowardStandings);
    const map = new Map();
    const aes = isWeek ? activeAEsForWeek(weekKey) : db.aes;
    aes.forEach((ae) => map.set(ae.id, { ae, nbms: 0, held: 0, auto: 0 }));
    pool.forEach((e) => {
      let row = map.get(e.aeId);
      if (!row) {
        const ae = db.aes.find((a) => a.id === e.aeId);
        if (!ae) return;
        row = { ae, nbms: 0, held: 0, auto: 0 };
        map.set(e.aeId, row);
      }
      row.nbms += 1;
      if (e.held) row.held += 1;
      if (e.source === "calendar") row.auto += 1;
    });
    return [...map.values()].sort(
      (a, b) => b.nbms - a.nbms || b.held - a.held || a.ae.name.localeCompare(b.ae.name)
    );
  }
  function aeSeasonStats(aeId) {
    let nbms = 0, held = 0;
    db.entries.forEach((e) => {
      if (e.aeId !== aeId) return;
      if (!countsTowardStandings(e)) return;
      nbms += 1;
      if (e.held) held += 1;
    });
    return { nbms, held };
  }
  // Colour band for a Team card — based on NBM activity, not a score.
  function cardBand(stats) {
    const n = stats.nbms;
    if (n >= 12) return "lvl-legend";
    if (n >= 8) return "lvl-elite";
    if (n >= 5) return "lvl-gold";
    if (n >= 2) return "lvl-mid";
    return "lvl-low";
  }

  /* ============================================================
   * App state
   * ========================================================== */
  const state = {
    tab: "intro",
    weekKey: currentProgramWeekKey(),
    lbScope: "week", // week | month | quarter | all
    overviewRegion: "all", // "all" (holistic) or a REGIONS value
    modal: null, // { mode:'add'|'edit', ae }
  };

  /* ============================================================
   * Rendering
   * ========================================================== */
  const TABS = [
    { id: "intro", label: "How to use the tracker", icon: "👋" },
    { id: "overview", label: "Overview", icon: "🧭" },
    { id: "leaderboard", label: "Insights", icon: "📈" },
    { id: "calendar", label: "Calendar Sync", icon: "🗓️" },
  ];

  function render() {
    const root = $("#root");
    root.innerHTML = `
      ${renderTopbar()}
      <div class="app">
        ${renderTabs()}
        ${renderSyncBanner()}
        ${renderStats()}
        <div id="view">${renderView()}</div>
        <div class="footer-note">
          EMEA AE Activity Tracker · EMEA Pipeline Generation · shared team data is connected
        </div>
      </div>
      <div id="toast" class="toast"></div>
      <div id="modal-root"></div>
    `;
    bindGlobal();
    renderModal();
  }

  function renderSyncBanner() {
    const auto = db.entries.filter((e) => e.source === "calendar" && withinReporting(e)).length;
    const autoNote = auto
      ? ` <b>${auto}</b> NBM${auto === 1 ? "" : "s"} tracked so far.`
      : "";
    return `
      <div class="card card-pad" style="margin-bottom:16px;border-color:rgba(79,122,99,0.35);background:rgba(79,122,99,0.07)">
        <b>Automatic tracking is on.</b>
        <span style="color:var(--muted)">New Business Meetings are pulled straight from the team's calendars into one shared, live view — no logging, no approvals.${autoNote}</span>
      </div>`;
  }

  function renderTopbar() {
    const wn = weekNumber(state.weekKey);
    return `
      <div class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <div class="crest">📊</div>
            <div>
              <div class="sub">EMEA Pipeline Generation</div>
              <h1>EMEA AE Activity Tracker</h1>
            </div>
          </div>
          <div class="topbar-spacer"></div>
          <div class="week-pill">
            <button data-action="week-prev" title="Previous week">‹</button>
            <div class="label">
              Week ${wn > 0 ? wn : "—"}
              <small>${weekLabel(state.weekKey)}</small>
            </div>
            <button data-action="week-next" title="Next week">›</button>
          </div>
          <button class="btn sm" data-action="week-today">This week</button>
        </div>
      </div>`;
  }

  function renderTabs() {
    return `
      <div class="tabs">
        ${TABS.map((t) => {
          return `<button class="tab ${state.tab === t.id ? "active" : ""}" data-tab="${t.id}">
              <span>${t.icon}</span>${t.label}
            </button>`;
        }).join("")}
      </div>`;
  }

  function renderStats() {
    const weekEntries = entriesForWeek(state.weekKey).filter(countsTowardStandings);
    const weekHeld = weekEntries.filter((e) => e.held).length;
    const allTime = db.entries.filter(countsTowardStandings);
    const allHeld = allTime.filter((e) => e.held).length;
    const active = db.aes.filter((a) => a.active !== false).length;
    const heldRate = allTime.length ? Math.round((allHeld / allTime.length) * 100) : 0;
    return `
      <div class="stat-strip">
        <div class="stat"><div class="k">AEs on the board</div><div class="v">${active} <small>/ ${db.aes.length}</small></div></div>
        <div class="stat"><div class="k">NBMs this week</div><div class="v">${weekEntries.length} <small>· ${weekHeld} held</small></div></div>
        <div class="stat"><div class="k">NBMs since 1 Aug</div><div class="v">${allTime.length}</div></div>
        <div class="stat"><div class="k">Held rate · since 1 Aug</div><div class="v">${heldRate}% <small>· ${allHeld} held</small></div></div>
      </div>`;
  }

  function renderView() {
    switch (state.tab) {
      case "intro": return renderIntro();
      case "overview": return renderOverview();
      case "leaderboard": return renderInsights();
      case "calendar": return renderCalendar();
      default: return renderIntro();
    }
  }

  /* ---------- Introduction / Start here ---------- */
  function renderIntro() {
    const sections = [
      ["🧭", "Overview", "Meetings booked quarter-to-date for every AE, broken down by meeting type — filter by region or see all EMEA teams together."],
      ["📈", "Insights", "Team-level KPIs and breakdowns — NBM volume, held rate and next steps, sliced by region, seniority and meeting type over week, month, quarter or all-time."],
      ["🗓️", "Calendar Sync", "Where the automatic tracking lives — meetings are pulled straight from each AE's calendar, with nothing to log by hand."],
    ];
    const meetingTypeCards = Object.keys(MEETING_TYPES)
      .map((k) => `<span class="badge mt ${MEETING_TYPES[k].cls}">${esc(MEETING_TYPES[k].short)}</span>`)
      .join(" ");
    const teams = REGIONS.map((r) => `<span class="chip">${esc(r)}</span>`).join("");

    return `
      <div class="hero">
        <div class="ball">👋</div>
        <div class="eyebrow">EMEA Pipeline Generation</div>
        <h1>Welcome to the EMEA AE Activity Tracker</h1>
        <p class="lead">
          An EMEA-wide Product Group dashboard that automatically tracks New Business Meetings (NBMs)
          and how they progress — straight from the team's calendars. There's no manual logging and no
          points or competition: it's simply a shared, live view of the pipeline-generating activity
          happening across the EMEA teams.
        </p>
        <div class="facts">${teams}</div>
        <div class="cta btn-row">
          <button class="btn primary" data-tab="leaderboard">Go to Insights</button>
          <button class="btn" data-tab="overview">See the Overview</button>
        </div>
      </div>

      <div class="section-head"><div><h2>What this is for</h2><p>Insight into pipeline-generating activity — not a scoreboard</p></div></div>
      <div class="rules-grid">
        <div class="rule"><div class="ic">🗓️</div><b>Automatic, from calendars</b><p>New Business Meetings are detected from the team's calendars, so the picture stays current without anyone logging a thing.</p></div>
        <div class="rule"><div class="ic">🌍</div><b>Whole of EMEA</b><p>Covers every team — GEO Enterprise, UKI, Benelux, Central Europe, Southern Europe and Nordics — in one place.</p></div>
        <div class="rule"><div class="ic">🤝</div><b>Insight, not competition</b><p>No points, no leaderboard prizes. The aim is to understand where pipeline is being created and where it's stalling.</p></div>
      </div>

      <div class="section-head" style="margin-top:20px"><div><h2>How to use it</h2><p>Three main sections, plus a meeting-type tag on every meeting</p></div></div>
      <div class="rules-grid">
        ${sections.map((r) => `<div class="rule"><div class="ic">${r[0]}</div><b>${r[1]}</b><p>${esc(r[2])}</p></div>`).join("")}
      </div>

      <div class="card card-pad" style="margin-top:16px">
        <h2 style="font-size:16px;margin-top:0">🏷️ The meeting-type tag</h2>
        <p style="color:var(--muted);font-size:13.5px;margin:0 0 10px">
          Meetings are pulled in automatically from calendars, and each one carries a meeting-type tag.
          You can adjust the tag inline on any meeting if the automatic guess needs a tweak:
        </p>
        <div class="chip-row">${meetingTypeCards}</div>
      </div>

      <div class="card card-pad" style="margin-top:20px">
        <h2 style="font-size:16px;margin-top:0">🔎 Using it for pipeline review</h2>
        <ul class="info-list">
          <li><span class="dot">▸</span><span><b>See NBM volume and held rates</b> at team and AE level, so conversations start from what actually happened.</span></li>
          <li><span class="dot">▸</span><span><b>Track progression</b> through the <b>VO progression</b>, <b>Champion go/no-go</b> and <b>EB go/no-go</b> stages.</span></li>
          <li><span class="dot">▸</span><span><b>Spot where deals are advancing or stalling</b> — where next steps are being booked and where they aren't.</span></li>
          <li><span class="dot">▸</span><span><b>Ground the discussion in real activity</b> rather than self-reported numbers, because everything is drawn from calendars.</span></li>
        </ul>
      </div>`;
  }

  /* ---------- Overview / Home ---------- */
  function renderHome() {
    const sync = db.calendarSync || {};
    const lastSync = sync.lastRunAt
      ? new Date(sync.lastRunAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "not yet run";
    const autoCount = db.entries.filter((e) => e.source === "calendar" && withinReporting(e)).length;
    const features = [
      ["🗓️", "Auto-tracked from calendars", "New Business Meetings are detected automatically from the team's Google Calendars — nothing to log by hand."],
      ["📈", "Progress, not a contest", "See how pipeline generation is trending across EMEA — volumes, seniority mix and held rates, not a race for prizes."],
      ["⚡", "Zero admin", "No logging, no approvals, no scoring. Meetings flow in from calendars and update the dashboard on their own."],
      ["🎯", "Every NBM counts equally", "An NBM is an NBM — the dashboard counts meetings and how many were held, without points or weighting."],
      ["🌍", "Whole-team view", "Break progress down by region, team and seniority, over week, month, quarter or all-time."],
      ["👥", "Per-AE profiles", "Each AE has a profile showing their NBM activity and held rate at a glance."],
    ];

    return `
      <div class="hero">
        <div class="ball">📊</div>
        <div class="eyebrow">EMEA Pipeline Generation</div>
        <h1>EMEA AE Activity Tracker</h1>
        <p class="lead">
          An always-on view of New Business Meeting progress across EMEA. Meetings are tracked
          automatically from the team's calendars and rolled up into clear insights — by region,
          team and seniority, over week, month, quarter or all-time.
        </p>
        <div class="facts">
          <span class="chip">🌍 <b>${db.aes.filter((a) => a.active !== false).length}</b> AEs on the board</span>
          <span class="chip">🗓️ <b>${autoCount}</b> NBMs tracked</span>
          <span class="chip">🔄 Last sync <b>${lastSync}</b></span>
          <span class="chip">⚡ <b>0</b> manual steps</span>
        </div>
        <div class="cta btn-row">
          <button class="btn primary" data-tab="leaderboard">View insights</button>
          <button class="btn" data-tab="roster">Team</button>
          <button class="btn ghost" data-tab="calendar">Calendar sync</button>
        </div>
      </div>

      <div class="section-head"><div><h2>How it works</h2><p>A fully automatic insight into NBM progress</p></div></div>
      <div class="rules-grid">
        ${features.map((r) => `<div class="rule"><div class="ic">${r[0]}</div><b>${r[1]}</b><p>${esc(r[2])}</p></div>`).join("")}
      </div>

      <div class="two-col">
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-top:0">🗓️ How meetings are tracked</h2>
          <div class="step-list">
            <div class="step-row"><span class="n">1</span><div><b>Calendars are scanned</b><p>A scheduled job reads each AE's Google Calendar and finds external New Business Meetings.</p></div></div>
            <div class="step-row"><span class="n">2</span><div><b>NBMs are captured</b><p>Seniority is inferred from the attendee, and held / next-step outcomes are detected automatically.</p></div></div>
            <div class="step-row"><span class="n">3</span><div><b>Insights update</b><p>Every meeting flows straight into the dashboard — no logging and no approvals.</p></div></div>
          </div>
        </div>
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-top:0">📈 What you can see</h2>
          <div class="step-list">
            <div class="step-row"><span class="n">1</span><div><b>Team momentum</b><p>NBM volume and held rate by week, month, quarter or all-time across the whole region.</p></div></div>
            <div class="step-row"><span class="n">2</span><div><b>Seniority & region mix</b><p>Where the pipeline is coming from — VP/CTO vs Director vs Engineer, and which regions are active.</p></div></div>
            <div class="step-row"><span class="n">3</span><div><b>Per-AE progress</b><p>Each AE's activity and held rate, to spot who needs support — not to crown a winner.</p></div></div>
          </div>
        </div>
      </div>

      <div class="card card-pad" style="margin-top:20px">
        <h2 style="font-size:16px;margin-top:0">📋 What counts as an NBM</h2>
        <p style="color:var(--muted);font-size:13.5px;margin:0 0 6px">
          An NBM is an NBM — there's no scoring. A meeting counts when it has an external prospect on the
          invite; we also track whether it was <b>held</b> and whether a <b>next step</b> was booked. Details are in the
          <button class="btn sm ghost" data-tab="program">Playbook</button>.
        </p>
      </div>`;
  }

  /* ---------- Insights ---------- */
  function scopeLabelFor(scope, ref) {
    if (scope === "week") return `Week ${weekNumber(ref)} · ${weekLabel(ref)}`;
    if (scope === "all") return "All time";
    return periodRange(scope, ref).label;
  }
  // Counting NBM entries within the selected scope (week/month/quarter/all).
  function scopeEntries(scope, ref) {
    let pool;
    if (scope === "week") {
      pool = entriesForWeek(ref);
    } else {
      const { start, end } = periodRange(scope, ref);
      pool = db.entries.filter((e) => entryInRange(e, start, end));
    }
    return pool.filter(countsTowardStandings);
  }
  function barRow(label, value, max, hint) {
    const pct = max ? Math.max(3, Math.round((value / max) * 100)) : 0;
    return `
      <div class="ins-bar">
        <div class="ins-bar-label">${label}${hint ? ` <span class="rg">${hint}</span>` : ""}</div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="ins-bar-val">${value}</div>
      </div>`;
  }
  function renderInsights() {
    const scope = state.lbScope;
    const scopeLabel = scopeLabelFor(scope, state.weekKey);
    const scopes = [["week", "This week"], ["month", "Month"], ["quarter", "Quarter"], ["all", "All-time"]];
    const canPage = scope === "month" || scope === "quarter";
    const pager = canPage
      ? `<div class="week-pill" style="margin-top:10px">
           <button data-action="period-prev" title="Previous ${scope}">‹</button>
           <div class="label">${scopeLabel}</div>
           <button data-action="period-next" title="Next ${scope}">›</button>
         </div>`
      : "";

    const pool = scopeEntries(scope, state.weekKey);
    const total = pool.length;
    const held = pool.filter((e) => e.held).length;
    const nextStep = pool.filter((e) => e.calendarised).length;
    const heldRate = total ? Math.round((held / total) * 100) : 0;
    const activeAeIds = new Set(pool.map((e) => e.aeId));

    const kpis = `
      <div class="stat-strip">
        <div class="stat"><div class="k">NBMs</div><div class="v">${total}</div></div>
        <div class="stat"><div class="k">Held</div><div class="v">${held} <small>· ${heldRate}%</small></div></div>
        <div class="stat"><div class="k">Next step booked</div><div class="v">${nextStep}</div></div>
        <div class="stat"><div class="k">AEs active</div><div class="v">${activeAeIds.size}</div></div>
      </div>`;

    // Breakdown by seniority level.
    const levelKeys = Object.keys(LEVELS);
    const byLevel = levelKeys.map((l) => ({ l, n: pool.filter((e) => e.level === l).length }));
    const levelMax = Math.max(1, ...byLevel.map((x) => x.n));
    const levelCard = `
      <div class="card card-pad">
        <h2 style="font-size:16px;margin-top:0">By seniority</h2>
        ${byLevel.map((x) => barRow(LEVELS[x.l].short, x.n, levelMax)).join("") || "<p class='meta'>No data.</p>"}
      </div>`;

    // Breakdown by region.
    const regionCounts = {};
    pool.forEach((e) => {
      const ae = db.aes.find((a) => a.id === e.aeId);
      const r = (ae && ae.region) || "—";
      regionCounts[r] = (regionCounts[r] || 0) + 1;
    });
    const regionRows = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]);
    const regionMax = Math.max(1, ...regionRows.map((x) => x[1]));
    const regionCard = `
      <div class="card card-pad">
        <h2 style="font-size:16px;margin-top:0">By region</h2>
        ${regionRows.map(([r, n]) => barRow(esc(r), n, regionMax)).join("") || "<p class='meta'>No data.</p>"}
      </div>`;

    // Breakdown by meeting type.
    const typeKeys = Object.keys(MEETING_TYPES);
    const byType = typeKeys.map((k) => ({ k, n: pool.filter((e) => meetingType(e) === k).length }));
    const typeMax = Math.max(1, ...byType.map((x) => x.n));
    const typeCard = `
      <div class="card card-pad">
        <h2 style="font-size:16px;margin-top:0">By meeting type</h2>
        ${byType.map((x) => barRow(esc(MEETING_TYPES[x.k].short), x.n, typeMax)).join("") || "<p class='meta'>No data.</p>"}
      </div>`;

    // Per-AE progress (ordered by activity — a progress view, not a contest).
    const rows = leaderboard(scope, state.weekKey).filter((r) => r.nbms > 0)
      .sort((a, b) => b.nbms - a.nbms || b.held - a.held || a.ae.name.localeCompare(b.ae.name));
    const maxN = rows.length ? rows[0].nbms : 1;
    const tableRows = rows.length
      ? rows.map((r) => {
          const c = countryByCode(r.ae.country);
          const pct = Math.max(6, Math.round((r.nbms / maxN) * 100));
          const hr = r.nbms ? Math.round((r.held / r.nbms) * 100) : 0;
          return `
            <tr>
              <td>
                <div class="ae">
                  <span class="flag">${c.flag}</span>
                  <span><span class="nm">${esc(r.ae.name)}</span><br><span class="rg">${esc(r.ae.region)}${r.ae.rvp ? " · " + esc(r.ae.rvp) : ""}</span></span>
                </div>
              </td>
              <td class="num">${r.nbms}</td>
              <td class="num">${r.held}</td>
              <td class="num">${hr}%</td>
              <td><div class="bar"><span style="width:${pct}%"></span></div></td>
            </tr>`;
        }).join("")
      : `<tr><td colspan="5"><div class="empty"><div class="ico">🗓️</div><h3>No NBMs ${scope === "all" ? "yet" : "in this period"}</h3><p>Meetings appear here automatically once the calendar sync runs.</p></div></td></tr>`;

    return `
      <div class="section-head">
        <div>
          <h2>Insights</h2>
          <p>NBM progress across EMEA · ${scopeLabel}</p>
          ${pager}
        </div>
        <div class="seg">
          ${scopes.map(([s, l]) => `<button class="${scope === s ? "active" : ""}" data-scope="${s}">${l}</button>`).join("")}
        </div>
      </div>
      ${kpis}
      <div class="two-col" style="margin-top:16px">
        ${levelCard}
        ${regionCard}
      </div>
      <div style="margin-top:16px">${typeCard}</div>
      <div class="section-head" style="margin-top:20px"><div><h2 style="font-size:16px">Per-AE progress</h2><p>Ordered by activity — to see momentum and who may need support</p></div></div>
      <div class="card">
        <table class="lb">
          <thead>
            <tr>
              <th>Account Executive</th>
              <th class="num">NBMs</th><th class="num">Held</th><th class="num" title="Share of NBMs held">Held&nbsp;%</th><th>Activity</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
  }

  /* ---------- Overview (QTD meetings by type) ---------- */
  // Fiscal quarters for the QTD Overview. NOTE these are FISCAL, not calendar,
  // quarters (Q3 is only Aug–Sep), so they intentionally do NOT use periodRange.
  // Add more entries here to extend beyond FY26.
  const QUARTERS = [
    { label: "Q3 2026", start: "2026-08-01", end: "2026-09-30" },
    { label: "Q4 2026", start: "2026-10-01", end: "2026-12-31" },
  ];
  // Resolve the quarter-to-date window from today's real date. QTD runs from the
  // current quarter's start through the earlier of today or the quarter end. If
  // today falls outside every configured quarter we fall back to the nearest one
  // and flag it so the UI can label it clearly.
  function currentQuarterToDate(today) {
    const nowISO = toISO(today || new Date());
    let quarter = QUARTERS.find((q) => nowISO >= q.start && nowISO <= q.end);
    let note = "";
    if (!quarter) {
      if (QUARTERS.length && nowISO < QUARTERS[0].start) {
        quarter = QUARTERS[0];
        note = "upcoming quarter — not started yet";
      } else {
        quarter = QUARTERS[QUARTERS.length - 1];
        note = "quarter closed — showing the full period";
      }
    }
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    return { quarter, startISO: quarter.start, endISO: clamp(nowISO, quarter.start, quarter.end), note };
  }
  function fmtQtdDate(iso) {
    return parseDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function renderOverview() {
    const { quarter, startISO, endISO, note } = currentQuarterToDate();
    const typeKeys = Object.keys(MEETING_TYPES); // source of truth for columns
    const blank = () => typeKeys.reduce((o, k) => ((o[k] = 0), o), {});

    // Count each AE's entries dated inside the QTD window, bucketed by type.
    const counts = new Map();
    db.aes.forEach((ae) => counts.set(ae.id, blank()));
    db.entries.forEach((e) => {
      if (!e || !e.date) return;
      if (e.date < startISO || e.date > endISO) return;
      const row = counts.get(e.aeId);
      if (!row) return;
      row[meetingType(e)] += 1;
    });

    // Region filter — "all" is the holistic combined view (default).
    const allRegions = [
      ...REGIONS,
      ...[...new Set(db.aes.map((a) => a.region))].filter((r) => !REGIONS.includes(r)),
    ];
    const selected = state.overviewRegion === "all" || allRegions.includes(state.overviewRegion)
      ? state.overviewRegion
      : "all";
    const showAll = selected === "all";
    const seg = `
      <div class="seg">
        <button class="${showAll ? "active" : ""}" data-region-filter="all">All regions</button>
        ${allRegions.map((r) => `<button class="${selected === r ? "active" : ""}" data-region-filter="${esc(r)}">${esc(r)}</button>`).join("")}
      </div>`;

    const rangeLabel = `${fmtQtdDate(startISO)} – ${fmtQtdDate(endISO)}`;
    const scopeText = showAll ? "all EMEA regions" : esc(selected);
    const header = `
      <div class="section-head">
        <div>
          <h2>Overview</h2>
          <p>Meetings booked quarter-to-date, by meeting type · <b>${esc(quarter.label)}</b> · ${esc(rangeLabel)} · ${scopeText}${note ? ` · <span class="rg">${esc(note)}</span>` : ""}</p>
        </div>
        ${seg}
      </div>`;

    if (!db.aes.length) {
      return `${header}<div class="empty"><div class="ico">🧭</div><h3>No AEs yet</h3><p>Add the team to see quarter-to-date meeting activity.</p></div>`;
    }

    const th = typeKeys.map((k) => `<th class="num">${esc(MEETING_TYPES[k].short)}</th>`).join("");
    const grand = blank();
    let grandTotal = 0;

    // Group rows by region (mirrors the region grouping used elsewhere).
    // When a single region is selected the table is filtered to just that team.
    const regionOrder = showAll ? allRegions : [selected];
    const body = regionOrder
      .map((region) => {
        const members = db.aes
          .filter((a) => a.region === region)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!members.length) return "";
        const sub = blank();
        let subTotal = 0;
        const rows = members
          .map((ae) => {
            const row = counts.get(ae.id) || blank();
            const rowTotal = typeKeys.reduce((n, k) => n + row[k], 0);
            typeKeys.forEach((k) => { sub[k] += row[k]; grand[k] += row[k]; });
            subTotal += rowTotal;
            grandTotal += rowTotal;
            const c = countryByCode(ae.country);
            const cells = typeKeys.map((k) => `<td class="num">${row[k] || 0}</td>`).join("");
            return `
              <tr>
                <td>
                  <div class="ae">
                    <span class="flag">${c.flag}</span>
                    <span><span class="nm">${esc(ae.name)}</span><br><span class="rg">${esc(ae.region)}${ae.rvp ? " · " + esc(ae.rvp) : ""}</span></span>
                  </div>
                </td>
                ${cells}
                <td class="num"><b>${rowTotal}</b></td>
              </tr>`;
          })
          .join("");
        const subCells = typeKeys.map((k) => `<td class="num">${sub[k]}</td>`).join("");
        return `
          <tr><td colspan="${typeKeys.length + 2}" style="background:var(--surface-2,#f3f4f6);font-weight:700;color:var(--muted)">${esc(region)}</td></tr>
          ${rows}
          <tr style="border-top:1px solid var(--border,#d7dae0)"><td style="color:var(--muted)">${esc(region)} subtotal</td>${subCells}<td class="num"><b>${subTotal}</b></td></tr>`;
      })
      .join("");

    const grandCells = typeKeys.map((k) => `<td class="num"><b>${grand[k]}</b></td>`).join("");
    // Grand total only adds signal in the holistic view; for a single region it
    // would just duplicate that region's subtotal.
    const grandRow = showAll
      ? `<tr style="border-top:2px solid var(--border,#d7dae0)">
              <td><b>All EMEA</b></td>
              ${grandCells}
              <td class="num"><b>${grandTotal}</b></td>
            </tr>`
      : "";

    return `
      ${header}
      <div class="card">
        <table class="lb">
          <thead>
            <tr>
              <th>Account Executive</th>
              ${th}
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            ${body}
            ${grandRow}
          </tbody>
        </table>
      </div>`;
  }

  /* ---------- Team ---------- */
  function renderRoster() {
    if (!db.aes.length) {
      return `
        <div class="section-head"><div><h2>Team</h2><p>Account Executives on the board</p></div>
          <button class="btn primary" data-action="add-ae">+ Add AE</button></div>
        <div class="empty"><div class="ico">👥</div><h3>No AEs yet</h3><p>Add the team so their calendar NBMs can be tracked.</p></div>`;
    }
    // Per-AE NBM count for the current calendar month (a recent-momentum signal).
    const monthKey = toISO(mondayOf(new Date()));
    const { start, end } = periodRange("month", monthKey);
    const monthCount = (aeId) =>
      db.entries.filter((e) => e.aeId === aeId && countsTowardStandings(e) && entryInRange(e, start, end)).length;

    const sorted = [...db.aes].sort((a, b) => {
      const activeA = a.active !== false, activeB = b.active !== false;
      if (activeA !== activeB) return activeA ? -1 : 1;
      return aeSeasonStats(b.id).nbms - aeSeasonStats(a.id).nbms;
    });
    const cards = sorted
      .map((ae, idx) => {
        const s = aeSeasonStats(ae.id);
        const c = countryByCode(ae.country);
        const active = ae.active !== false;
        const initials = ae.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
        const heldRate = s.nbms ? Math.round((s.held / s.nbms) * 100) : 0;
        return `
          <div class="panini ${cardBand(s)}">
            <div class="panini-inner">
              <div class="top-row">
                <div class="ovr">${s.nbms}<small>NBMs</small></div>
                <div class="flag">${c.flag}</div>
              </div>
              <div class="avatar"><span class="initials">${esc(initials)}</span></div>
              <div class="card-tier">${ae.rvp ? esc(ae.rvp) : "—"}</div>
              <div class="pname">${esc(ae.name)}</div>
              <div class="prole">${esc(ae.region)} · ${esc(c.name)}</div>
              <div class="joinline ${active ? "active" : "future"}">${active ? "Active" : "Joins"} · ${formatStartDate(ae.startDate)}${ae.calendarEmail ? "" : " · no calendar"}</div>
              <div class="pstats">
                <div class="pstat"><b>${monthCount(ae.id)}</b><span>This month</span></div>
                <div class="pstat"><b>${s.held}</b><span>Held</span></div>
                <div class="pstat"><b>${heldRate}%</b><span>Held rate</span></div>
              </div>
              <div class="card-actions">
                <button data-action="edit-ae" data-id="${ae.id}">Edit</button>
              </div>
            </div>
          </div>`;
      })
      .join("");
    const missing = db.aes.filter((a) => a.active !== false && !a.calendarEmail).length;
    return `
      <div class="section-head">
        <div><h2>Team</h2><p>${db.aes.length} Account Executives · NBM activity from calendar tracking${missing ? ` · <span style="color:var(--muted)">${missing} missing a calendar</span>` : ""}</p></div>
        <button class="btn primary" data-action="add-ae">+ Add AE</button>
      </div>
      <div class="grid-cards">${cards}</div>`;
  }

  function statusBadge(e) {
    const map = {
      booked: ["pending", "⏳ Booked"],
      confirmed: ["verified", "📅 Confirmed"],
      done: ["verified", "✓ Done"],
      rejected: ["rejected", "✕ Rejected"],
    };
    const [cls, label] = map[e.status] || map.booked;
    return `<span class="badge ${cls}">${label}</span>`;
  }
  // A small badge marking how an NBM entered the system.
  function sourceBadge(e) {
    if (e.source === "calendar") {
      const who = e.attendeeTitle || e.attendeeName || e.attendeeEmail;
      return `<span class="badge auto" title="Auto-tracked from calendar${who ? " · " + esc(who) : ""}">🗓️ Auto</span>`;
    }
    return "";
  }

  // Visible meeting-type pill.
  function meetingTypeBadge(e) {
    const mt = meetingType(e);
    const t = MEETING_TYPES[mt];
    return `<span class="badge mt ${t.cls}">${esc(t.short)}</span>`;
  }
  // Inline, editable meeting-type control (persists + syncs on change).
  function meetingTypeControl(e) {
    const cur = meetingType(e);
    const opts = Object.keys(MEETING_TYPES)
      .map((k) => `<option value="${esc(k)}" ${k === cur ? "selected" : ""}>${esc(MEETING_TYPES[k].short)}</option>`)
      .join("");
    return `<select class="mt-select ${MEETING_TYPES[cur].cls}" data-action="set-meeting-type" data-id="${esc(e.id)}" title="Meeting type">${opts}</select>`;
  }

  function renderEntryRow(e) {
    const ae = db.aes.find((a) => a.id === e.aeId);
    const c = countryByCode(ae ? ae.country : "");
    const lvl = LEVELS[e.level] || { cls: "", short: e.level };
    const tags = [
      e.held ? "Held" : null,
      e.calendarised ? "Next step" : null,
    ].filter(Boolean).join(" · ");
    return `
      <div class="entry">
        <span class="flag">${c.flag}</span>
        <div class="main">
          <b>${esc(ae ? ae.name : "Unknown")}</b> <span class="badge ${lvl.cls}">${lvl.short}</span> ${meetingTypeBadge(e)} ${statusBadge(e)} ${sourceBadge(e)}
          <div class="meta">${esc(e.account || "—")}${tags ? " · " + tags : ""}</div>
        </div>
        <div class="acts">${meetingTypeControl(e)}</div>
      </div>`;
  }

  /* ---------- Calendar Sync ---------- */
  function calendarConfig() {
    const cfg = (typeof window !== "undefined" && window.PG_CONFIG) || {};
    const url = String(cfg.supabaseUrl || "").replace(/\/+$/, "");
    const key = String(cfg.supabasePublishableKey || cfg.supabaseAnonKey || "");
    return { url, key, ready: !!(url && key) };
  }
  // Pull the latest sync bookkeeping row so the UI can show "last synced".
  function fetchCalendarSyncState() {
    const { url, key, ready } = calendarConfig();
    if (!ready) return Promise.resolve(null);
    return fetch(url + "/rest/v1/calendar_sync_state?id=eq.global&select=*", {
      headers: { apikey: key, Authorization: "Bearer " + key },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const r = (rows && rows[0]) || null;
        if (r) {
          db.calendarSync = {
            lastRunAt: r.last_run_at, lastStatus: r.last_status,
            eventsScanned: r.events_scanned, nbmsCreated: r.nbms_created,
            nbmsUpdated: r.nbms_updated, windowStart: r.window_start,
            windowEnd: r.window_end, message: r.message,
          };
          save();
        }
        return db.calendarSync;
      })
      .catch(() => null);
  }
  // Trigger the scheduled edge function on demand ("Run sync now").
  function runCalendarSync() {
    const { url, key, ready } = calendarConfig();
    if (!ready) {
      toast("Configure Supabase in config.js first");
      return;
    }
    toast("Calendar sync started…");
    fetch(url + "/functions/v1/calendar-sync", {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "manual" }),
    })
      .then((r) => r.json().catch(() => ({})).then((body) => ({ ok: r.ok, status: r.status, body })))
      .then((res) => {
        if (!res.ok) {
          const msg = (res.body && (res.body.error || res.body.message)) || ("HTTP " + res.status);
          toast("Sync failed: " + msg);
        } else {
          const created = (res.body && res.body.nbmsCreated) || 0;
          toast(`Sync done · ${created} new NBM${created === 1 ? "" : "s"}`);
        }
        return fetchCalendarSyncState();
      })
      .then(() => render())
      .catch((err) => {
        // The function may not be deployed yet — guide the user to the docs.
        toast("Sync unavailable — see Calendar Sync setup");
      });
  }

  function renderCalendar() {
    const s = db.calendarSync || {};
    const mapped = db.aes.filter((a) => a.calendarEmail && a.active !== false);
    const missing = db.aes.filter((a) => !a.calendarEmail && a.active !== false);
    const auto = db.entries.filter((e) => e.source === "calendar" && withinReporting(e));
    const recent = auto.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
    const { ready } = calendarConfig();

    const lastRun = s.lastRunAt
      ? new Date(s.lastRunAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "Never";
    const statusCls = s.lastStatus === "ok" ? "verified" : s.lastStatus === "error" ? "rejected" : "pending";

    const statusCard = `
      <div class="card card-pad">
        <div class="section-head" style="margin:0 0 12px">
          <div><h2 style="font-size:16px;margin:0">🗓️ Calendar sync status</h2>
          <p style="margin:2px 0 0">Auto-detects NBMs from the team's Google Calendars</p></div>
          <button class="btn primary sm" data-action="run-calendar-sync">Run sync now</button>
        </div>
        <div class="stat-strip" style="margin:0">
          <div class="stat"><div class="k">Last run</div><div class="v" style="font-size:15px">${lastRun} <span class="badge ${statusCls}">${esc(s.lastStatus || "idle")}</span></div></div>
          <div class="stat"><div class="k">Events scanned</div><div class="v">${s.eventsScanned || 0}</div></div>
          <div class="stat"><div class="k">NBMs created</div><div class="v">${s.nbmsCreated || 0}</div></div>
          <div class="stat"><div class="k">Auto-tracked total</div><div class="v">${auto.length}</div></div>
        </div>
        ${s.message ? `<p class="meta" style="margin:12px 0 0">${esc(s.message)}</p>` : ""}
        ${!ready ? `<p class="meta" style="margin:12px 0 0;color:var(--red,#a85850)">⚠️ Supabase isn't configured in <b>config.js</b>, so sync can't run yet.</p>` : ""}
      </div>`;

    const coverageCard = `
      <div class="card card-pad">
        <h2 style="font-size:16px;margin-top:0">📇 Calendar coverage</h2>
        <p class="meta" style="margin:0 0 10px"><b>${mapped.length}</b> of ${mapped.length + missing.length} active AEs have a calendar mapped. With roster discovery enabled this is filled in automatically.</p>
        ${
          missing.length
            ? `<div class="meta" style="margin-bottom:6px">Missing a calendar email (won't be auto-tracked):</div>
               <div class="chip-row">${missing.map((a) => `<span class="chip">${countryByCode(a.country).flag} ${esc(a.name)}</span>`).join("")}</div>
               <p class="meta" style="margin:10px 0 0">These AEs need a <code>firstname.lastname@cursor.com</code> calendar email mapped in the roster so the sync knows which calendar to read.</p>`
            : `<p class="meta" style="margin:0">✅ Every active AE has a calendar mapped.</p>`
        }
      </div>`;

    const reviewCard = `
      <div class="card">
        <div class="section-head" style="padding:14px 16px 0;margin:0">
          <div><h2 style="font-size:15px">Recently auto-tracked</h2>
          <p style="margin:2px 0 0">Counted automatically — no approval needed</p></div>
          ${recent.length ? `<button class="btn sm" data-tab="leaderboard">View insights</button>` : ""}
        </div>
        <div style="padding:6px 4px 8px">
          ${
            recent.length
              ? recent.map(renderEntryRow).join("")
              : `<div class="empty"><div class="ico">🗓️</div><p>No calendar NBMs tracked yet. Run a sync to pull them in.</p></div>`
          }
        </div>
      </div>`;

    return `
      <div class="section-head">
        <div><h2>Calendar Sync</h2><p>New Business Meetings are detected automatically from Google Calendar</p></div>
      </div>
      ${statusCard}
      <div class="two-col" style="margin-top:16px">
        ${coverageCard}
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-top:0">🔎 How detection works</h2>
          <ul class="info-list">
            <li><span class="dot">▸</span><span>Scans each AE's calendar for meetings with <b>external attendees</b> (outside your company domain).</span></li>
            <li><span class="dot">▸</span><span>Infers the <b>NBM level</b> (VP/CTO, Director, Engineer) from the attendee's job title in the directory.</span></li>
            <li><span class="dot">▸</span><span>Marks a meeting <b>Held</b> when it's in the past and was accepted; detects a booked <b>next step</b> from follow-up events.</span></li>
            <li><span class="dot">▸</span><span>Each meeting maps to <b>one NBM</b> (deduped by event id) and is <b>counted automatically</b> — no approval, no scoring.</span></li>
            <li><span class="dot">▸</span><span>Optionally <b>auto-detects the roster</b> from a shared Google Sheet (one tab per team) or the Directory, adding AEs and whole teams as people start.</span></li>
          </ul>
          <p class="meta" style="margin:10px 0 0">Full setup — Google service account, domain-wide delegation, roster discovery and scheduling — is in <code>docs/calendar-sync.md</code>.</p>
        </div>
      </div>
      <div style="margin-top:16px">${reviewCard}</div>`;
  }

  /* ---------- Program / Playbook ---------- */
  function renderProgram() {
    return `
      <div class="section-head"><div><h2>Playbook</h2><p>How the EMEA AE Activity Tracker works, in one place</p></div></div>
      <div class="two-col">
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-top:0">How it runs</h2>
          <div class="cadence-grid">
            <div class="cad"><div class="day">Daily</div><div class="time">auto</div><div class="desc">Calendar sync detects new NBMs</div></div>
            <div class="cad"><div class="day">Anytime</div><div class="time">live</div><div class="desc">Insights update as meetings land</div></div>
            <div class="cad"><div class="day">Weekly</div><div class="time">Mon</div><div class="desc">Review progress with the team</div></div>
          </div>
          <ul class="info-list" style="margin-top:16px">
            <li><span class="dot">▸</span><span><b>Fully automatic:</b> NBMs are detected from the team's Google Calendars — see the <button class="btn sm ghost" data-tab="calendar">Calendar Sync</button> tab. No manual logging, no approvals.</span></li>
            <li><span class="dot">▸</span><span><b>An insight, not a contest:</b> the dashboard shows NBM progress so the team can spot momentum and where to help.</span></li>
            <li><span class="dot">▸</span><span><b>Focus:</b> Cost / business case, anchored on the Gartner report.</span></li>
            <li><span class="dot">▸</span><span><b>Views:</b> slice progress by week, month, quarter or all-time, and by region and seniority.</span></li>
          </ul>
        </div>
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-top:0">What counts as an NBM</h2>
          <ul class="info-list">
            <li><span class="dot">▸</span><span><b>An NBM is an NBM.</b> There's no scoring or weighting — every qualifying meeting counts as one.</span></li>
            <li><span class="dot">▸</span><span><b>Qualifies when</b> the meeting has an external prospect on the invite (outside your company domain).</span></li>
            <li><span class="dot">▸</span><span><b>Held</b> is tracked when the meeting took place, and <b>next step</b> when a follow-up is booked — shown as context, not points.</span></li>
            <li><span class="dot">▸</span><span><b>Seniority</b> (VP/CTO · Director · Engineer) is inferred from the prospect, purely to break down where pipeline is coming from.</span></li>
          </ul>
          <div class="btn-row" style="margin-top:8px">
            <a class="btn sm" href="${CHEATSHEET_URL}" target="_blank" rel="noopener">Cheatsheet stories ↗</a>
          </div>
        </div>
      </div>

      <div class="card card-pad" style="margin-top:20px">
        <div class="section-head" style="margin:0 0 8px"><div><h2 style="font-size:16px">Team & data</h2></div></div>
        <ul class="info-list">
          <li><span class="dot">🔄</span><span><b>Auto-tracking:</b> map each AE's calendar email in the <button class="btn sm ghost" data-tab="roster">Team</button> tab so the sync knows which calendar to read.</span></li>
          <li><span class="dot">🗓</span><span><b>Start dates:</b> AEs become active from their start date; future joiners appear on the Team page but their NBMs only count once they've started.</span></li>
          <li><span class="dot">📈</span><span><b>Insights:</b> the numbers are meant to support coaching and momentum — not to rank people against each other.</span></li>
        </ul>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn sm" data-action="import-roster">Import roster CSV</button>
          <button class="btn sm" data-action="export-all">Export all data (JSON)</button>
          <button class="btn sm" data-action="import-data">Import data</button>
          <button class="btn sm danger" data-action="reset-data">Reset to sample</button>
        </div>
      </div>`;
  }

  /* ---------- Modal (add/edit AE) ---------- */
  function renderModal() {
    const host = $("#modal-root");
    if (!state.modal) {
      host.innerHTML = "";
      return;
    }
    const m = state.modal;
    const ae = m.ae || { name: "", country: "GB", region: REGIONS[0], rvp: "", startDate: PROGRAM_START };
    const countryOpts = COUNTRIES.map(
      (c) => `<option value="${c.code}" ${ae.country === c.code ? "selected" : ""}>${c.flag} ${esc(c.name)}</option>`
    ).join("");
    const regionOpts = REGIONS.map(
      (r) => `<option ${ae.region === r ? "selected" : ""}>${esc(r)}</option>`
    ).join("");
    host.innerHTML = `
      <div class="modal-overlay" data-action="close-modal">
        <div class="modal" data-stop>
          <h3>${m.mode === "edit" ? "Edit AE" : "Add Account Executive"}</h3>
          <form id="ae-form">
            <div class="field" style="margin-bottom:12px">
              <label>Full name</label>
              <input type="text" data-field="name" value="${esc(ae.name)}" required placeholder="Jane Doe" />
            </div>
            <div class="form-grid">
              <div class="field"><label>Country (jersey)</label><select data-field="country">${countryOpts}</select></div>
              <div class="field"><label>Region</label><select data-field="region">${regionOpts}</select></div>
            </div>
            <div class="field" style="margin-top:12px">
              <label>RVP</label>
              <input type="text" data-field="rvp" value="${esc(ae.rvp)}" placeholder="Reporting RVP" />
            </div>
            <div class="form-grid" style="margin-top:12px">
              <div class="field">
                <label>Start date</label>
                <input type="date" data-field="startDate" value="${esc(ae.startDate || PROGRAM_START)}" />
              </div>
              <div class="field">
                <label>Calendar email <span class="meta">(for auto-tracking)</span></label>
                <input type="email" data-field="calendarEmail" value="${esc(ae.calendarEmail || "")}" placeholder="ae@company.com" />
              </div>
            </div>
            <div class="btn-row" style="margin-top:18px;justify-content:space-between">
              <div>${m.mode === "edit" ? `<button type="button" class="btn danger" data-action="delete-ae" data-id="${m.ae.id}">Delete</button>` : ""}</div>
              <div class="btn-row">
                <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
                <button type="submit" class="btn primary">${m.mode === "edit" ? "Save" : "Add AE"}</button>
              </div>
            </div>
          </form>
        </div>
      </div>`;
    const form = $("#ae-form");
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const get = (f) => { const el = $(`[data-field="${f}"]`, form); return el ? el.value.trim() : ""; };
      const data = { name: get("name"), country: get("country"), region: get("region"), rvp: get("rvp"), startDate: get("startDate") || PROGRAM_START, calendarEmail: get("calendarEmail") };
      if (!data.name) return;
      if (m.mode === "edit") {
        Object.assign(m.ae, data);
        toast("AE updated");
      } else {
        db.aes.push({ id: uid(), active: true, ...data });
        toast("AE added to the squad");
      }
      save();
      state.modal = null;
      render();
    });
  }

  /* ============================================================
   * Event handling
   * ========================================================== */
  function bindGlobal() {
    $("#root").addEventListener("click", onClick);
    $("#root").addEventListener("change", onChange);
  }

  // Inline <select> edits (e.g. the meeting-type tag) persist + trigger sync.
  function onChange(ev) {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const action = el.getAttribute("data-action");
    const id = el.getAttribute("data-id");
    if (action === "set-meeting-type") {
      const entry = db.entries.find((e) => e.id === id);
      if (!entry) return;
      const val = MEETING_TYPES[el.value] ? el.value : DEFAULT_MEETING_TYPE;
      if (entry.meetingType === val) return;
      entry.meetingType = val;
      save();
      render();
      toast(`Meeting type set to ${MEETING_TYPES[val].short}`);
    }
  }

  function onClick(ev) {
    const tabBtn = ev.target.closest("[data-tab]");
    if (tabBtn) {
      state.tab = tabBtn.getAttribute("data-tab");
      render();
      // Refresh the calendar sync status from the backend when opening the tab.
      if (state.tab === "calendar") fetchCalendarSyncState().then(() => { if (state.tab === "calendar") render(); });
      return;
    }
    const scopeBtn = ev.target.closest("[data-scope]");
    if (scopeBtn) {
      state.lbScope = scopeBtn.getAttribute("data-scope");
      render();
      return;
    }
    const regionBtn = ev.target.closest("[data-region-filter]");
    if (regionBtn) {
      state.overviewRegion = regionBtn.getAttribute("data-region-filter");
      render();
      return;
    }
    const actEl = ev.target.closest("[data-action]");
    if (!actEl) return;
    const action = actEl.getAttribute("data-action");
    const id = actEl.getAttribute("data-id");

    switch (action) {
      case "week-prev":
        state.weekKey = toISO(addDays(parseDate(state.weekKey), -7));
        render();
        break;
      case "week-next":
        state.weekKey = toISO(addDays(parseDate(state.weekKey), 7));
        render();
        break;
      case "week-today":
        state.weekKey = currentProgramWeekKey();
        render();
        break;
      case "period-prev":
        state.weekKey = shiftPeriod(state.lbScope, state.weekKey, -1);
        render();
        break;
      case "period-next":
        state.weekKey = shiftPeriod(state.lbScope, state.weekKey, 1);
        render();
        break;
      case "run-calendar-sync":
        runCalendarSync();
        break;
      case "add-ae":
        state.modal = { mode: "add", ae: null };
        renderModal();
        break;
      case "edit-ae": {
        const ae = db.aes.find((a) => a.id === id);
        if (ae) {
          state.modal = { mode: "edit", ae };
          renderModal();
        }
        break;
      }
      case "delete-ae":
        db.aes = db.aes.filter((a) => a.id !== id);
        db.entries = db.entries.filter((e) => e.aeId !== id);
        save();
        state.modal = null;
        render();
        toast("AE removed");
        break;
      case "export-all":
        exportJSON();
        break;
      case "import-data":
        importJSON();
        break;
      case "import-roster":
        importRosterCSV();
        break;
      case "reset-data":
        if (confirm("Reset all data back to the sample roster? This clears your logged NBMs.")) {
          seed();
          save();
          render();
          toast("Reset to sample data");
        }
        break;
      case "close-modal":
        if (ev.target.closest("[data-stop]") && ev.target !== actEl) return;
        state.modal = null;
        renderModal();
        break;
      default:
        break;
    }
  }

  /* ============================================================
   * Import / export
   * ========================================================== */
  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) {
      /* fall through */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    } catch (e) {
      /* ignore */
    }
  }
  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJSON() {
    download("pg-spotlight-data.json", JSON.stringify(db, null, 2), "application/json");
    toast("Data exported");
  }
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (quoted && ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = !quoted;
      } else if (!quoted && ch === ",") {
        row.push(cell);
        cell = "";
      } else if (!quoted && (ch === "\n" || ch === "\r")) {
        if (ch === "\r" && next === "\n") i++;
        row.push(cell);
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some((v) => v.trim())) rows.push(row);
    return rows;
  }
  function normaliseHeader(h) {
    return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function findCol(headers, names) {
    const wanted = names.map(normaliseHeader);
    return headers.findIndex((h) => wanted.includes(normaliseHeader(h)));
  }
  function parseFlexibleDate(value) {
    const v = String(value || "").trim();
    if (!v) return PROGRAM_START;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const slash = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (slash) {
      const day = Number(slash[1]);
      const month = Number(slash[2]);
      const year = Number(slash[3].length === 2 ? "20" + slash[3] : slash[3]);
      return toISO(new Date(year, month - 1, day));
    }
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? PROGRAM_START : toISO(parsed);
  }
  function importRosterText(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) {
      toast("Roster CSV has no rows");
      return;
    }
    const headers = rows[0];
    const nameCol = findCol(headers, ["name", "ae", "account executive", "account executive name", "full name"]);
    const startCol = findCol(headers, ["startdate", "start date", "join date", "joindate", "onboard date", "onboarddate"]);
    const countryCol = findCol(headers, ["country", "market"]);
    const regionCol = findCol(headers, ["region", "segment"]);
    const rvpCol = findCol(headers, ["rvp", "manager", "leader"]);
    if (nameCol < 0 || startCol < 0) {
      alert("Could not find required columns. Please export a CSV with at least Name and Start Date columns.");
      return;
    }
    const existingByName = new Map(db.aes.map((ae) => [ae.name.trim().toLowerCase(), ae]));
    let changed = 0;
    rows.slice(1).forEach((row) => {
      const name = String(row[nameCol] || "").trim();
      if (!name) return;
      const country = String(row[countryCol] || "GB").trim().toUpperCase() || "GB";
      const region = String(row[regionCol] || "EMEA").trim() || "EMEA";
      const rvp = String(row[rvpCol] || "").trim();
      const startDate = parseFlexibleDate(row[startCol]);
      const key = name.toLowerCase();
      const current = existingByName.get(key);
      if (current) {
        Object.assign(current, { name, country, region, rvp, startDate });
      } else {
        db.aes.push({ id: uid(), name, country, region, rvp, startDate });
      }
      changed++;
    });
    save();
    render();
    toast(`Imported ${changed} roster row${changed === 1 ? "" : "s"}`);
  }
  function importRosterCSV() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importRosterText(String(reader.result || ""));
      reader.readAsText(file);
    };
    input.click();
  }
  function importJSON() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          db = { aes: parsed.aes || [], entries: parsed.entries || [], jerseys: parsed.jerseys || {} };
          save();
          render();
          toast("Data imported");
        } catch (e) {
          toast("Invalid file");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /* ============================================================
   * Toast
   * ========================================================== */
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = "✓ " + msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* ============================================================
   * Boot
   * ========================================================== */
  function applyDeepLink() {
    try {
      const tab = (location.hash || "").replace(/^#/, "");
      if (tab && TABS.some((t) => t.id === tab)) state.tab = tab;
    } catch (e) {
      /* ignore */
    }
  }
  loadOrSeed();
  applyDeepLink();
  render();
})();
