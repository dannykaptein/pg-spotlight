/* PG Spotlight — World Championship PG 2026
 * Weekly sales progress tracker. Dependency-free vanilla JS.
 * Data persists in localStorage; works fully offline from file://.
 */
(function () {
  "use strict";

  /* ============================================================
   * Program configuration (from the PG Spotlight brief)
   * ========================================================== */
  const PROGRAM_START = "2026-06-15"; // Monday, kick-off
  const CHEATSHEET_URL =
    "https://docs.google.com/document/d/1OQ-ZzWUa_GYJPjIkmdbvRTMXsesoJccmrae5zxqNRIc/edit?tab=t.0";
  const WEEKLY_WINNER_COUNT = 6;

  // NBM level -> base points & max achievable (per scoring rubric).
  const LEVELS = {
    "VP/CTO": { base: 3, max: 8, cls: "vp", short: "VP / CTO" },
    "Director/Head of": { base: 2, max: 7, cls: "dir", short: "Director / Head of" },
    Engineer: { base: 1, max: 6, cls: "eng", short: "Engineer" },
  };

  // Scoring components beyond level base points.
  const COMPONENTS = [
    { key: "valuePyramid", label: "Value Pyramid / POV", hint: "Value Pyramid or Point of View used", pts: 2 },
    { key: "held", label: "Held / Done", hint: "Meeting actually took place", pts: 2 },
    { key: "calendarised", label: "Calendarised next step", hint: "Concrete next step booked in the calendar", pts: 1 },
  ];

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
    "UK & Ireland",
    "DACH",
    "France",
    "Benelux",
    "Nordics",
    "Southern Europe",
    "Middle East & Africa",
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
  // An NBM belongs to the week it was booked in: the Monday of its booking date.
  function weekKeyForDate(dateISO) {
    return toISO(mondayOf(dateISO ? parseDate(dateISO) : new Date()));
  }
  function weekEndKey(weekKey) {
    return toISO(addDays(parseDate(weekKey), 4));
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
   * Scoring engine
   * ========================================================== */
  function entryPoints(e) {
    // Points only start counting once the RVP has confirmed the booking.
    // A freshly booked (or rejected) meeting scores nothing yet.
    if (e.status !== "confirmed" && e.status !== "done") return 0;
    const lvl = LEVELS[e.level] || { base: 0 };
    let p = lvl.base; // base counts on confirmation
    if (e.held) p += 2; // Held: auto-added when the leader marks the meeting done
    if (e.valuePyramid) p += 2; // leader-ticked after the meeting
    if (e.calendarised) p += 1; // leader-ticked after the meeting
    return p;
  }
  // Points an AE locks in the moment the booking is confirmed (preview on the
  // log form). The outcome bonuses are added later by the leader.
  function draftPoints(d) {
    const lvl = LEVELS[d.level] || { base: 0 };
    return lvl.base;
  }

  /* ============================================================
   * Persistence
   * ========================================================== */
  const STORE_KEY = "pg-spotlight-v1";
  let db = { aes: [], entries: [], jerseys: {}, settings: { managerName: "" } };

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
          })),
          jerseys: parsed.jerseys || {},
          settings: parsed.settings || { managerName: "" },
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
    const roster = [
      ["Olivia Bennett", "GB", "UK & Ireland", "James Whitfield"],
      ["Liam O'Connor", "IE", "UK & Ireland", "James Whitfield"],
      ["Sophie Laurent", "FR", "France", "James Whitfield"],
      ["Lucas Moreau", "FR", "France", "Camille Dubois"],
      ["Mia Schneider", "DE", "DACH", "Camille Dubois"],
      ["Noah Weber", "DE", "DACH", "Camille Dubois"],
      ["Emma Fischer", "AT", "DACH", "Camille Dubois"],
      ["Daan Visser", "NL", "Benelux", "Sven Eriksson"],
      ["Charlotte Janssen", "BE", "Benelux", "Sven Eriksson"],
      ["Lukas Berg", "SE", "Nordics", "Sven Eriksson"],
      ["Ingrid Hansen", "NO", "Nordics", "Sven Eriksson"],
      ["Mette Sørensen", "DK", "Nordics", "Sven Eriksson"],
      ["Aino Virtanen", "FI", "Nordics", "Sven Eriksson"],
      ["Mateo Romano", "IT", "Southern Europe", "Paolo Ricci"],
      ["Lucia Fernández", "ES", "Southern Europe", "Paolo Ricci"],
      ["Tiago Costa", "PT", "Southern Europe", "Paolo Ricci"],
      ["Omar Al-Rashid", "AE", "Middle East & Africa", "Paolo Ricci"],
      ["Thabo Nkosi", "ZA", "Middle East & Africa", "Paolo Ricci"],
    ];
    db.aes = roster.map(([name, code, region, rvp]) => ({
      id: uid(),
      name,
      country: code,
      region,
      rvp,
      startDate: PROGRAM_START,
    }));

    // Seed realistic bookings across last week and this week so the week
    // navigation has data on both sides. Each NBM's week is derived from its
    // booking date (see weekKeyForDate), matching how live bookings behave.
    const thisWeek = mondayOf(parseDate(PROGRAM_START));
    const lastWeek = addDays(thisWeek, -7);
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
        // Spread bookings across last week and this week by booking date.
        const baseMon = (i + j) % 2 === 0 ? lastWeek : thisWeek;
        const bookingDate = toISO(addDays(baseMon, (i + j) % 5));
        entries.push({
          id: uid(),
          aeId: ae.id,
          weekKey: weekKeyForDate(bookingDate),
          level,
          account: accounts[(i + j) % accounts.length],
          valuePyramid: counted && r > 3,
          held: status === "done",
          calendarised: counted && r > 5,
          date: bookingDate,
          note: "",
          status: status,
          verifiedBy: counted ? "System (seed)" : "",
          verifiedAt: counted ? toISO(addDays(baseMon, 4)) : "",
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
    return e.status === "confirmed" || e.status === "done";
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
    const pool = (scope === "week" ? entriesForWeek(weekKey) : db.entries).filter(countsTowardStandings);
    const map = new Map();
    const aes = scope === "week" ? activeAEsForWeek(weekKey) : db.aes;
    aes.forEach((ae) => map.set(ae.id, { ae, points: 0, nbms: 0, held: 0, best: 0 }));
    pool.forEach((e) => {
      const row = map.get(e.aeId);
      if (!row) return;
      const p = entryPoints(e);
      row.points += p;
      row.nbms += 1;
      if (e.held) row.held += 1;
      if (p > row.best) row.best = p;
    });
    return [...map.values()].sort(
      (a, b) => b.points - a.points || b.held - a.held || a.ae.name.localeCompare(b.ae.name)
    );
  }
  function aeSeasonStats(aeId) {
    let points = 0, nbms = 0, held = 0, pending = 0;
    db.entries.forEach((e) => {
      if (e.aeId !== aeId) return;
      nbms += 1;
      if (e.status === "booked") pending += 1; // awaiting leader confirmation
      if (!countsTowardStandings(e)) return;
      points += entryPoints(e);
      if (e.held) held += 1;
    });
    return { points, nbms, held, pending };
  }
  function paniniRating(stats, rank) {
    // The player-card rating grows with verified commercial progress.
    const activity = Math.min(12, stats.nbms);
    const execution = Math.min(10, stats.held * 2);
    const podiumBoost = rank <= 3 ? 4 - rank : 0;
    const ovr = Math.min(99, 50 + stats.points * 2 + activity + execution + podiumBoost);
    if (ovr >= 92) return { ovr, cls: "lvl-legend", label: "World Class" };
    if (ovr >= 84) return { ovr, cls: "lvl-elite", label: "Captain" };
    if (ovr >= 76) return { ovr, cls: "lvl-gold", label: "Playmaker" };
    if (ovr >= 65) return { ovr, cls: "lvl-mid", label: "Rising Star" };
    return { ovr, cls: "lvl-low", label: "Prospect" };
  }

  /* ============================================================
   * App state
   * ========================================================== */
  const state = {
    tab: "home",
    weekKey: currentProgramWeekKey(),
    lbScope: "week", // week | season
    draft: blankDraft(),
    modal: null, // { mode:'add'|'edit', ae }
    verifyMgr: "", // filter the verify queue to one manager's AEs
  };
  function blankDraft() {
    // AEs only book the meeting; outcome bonuses are added by the leader later.
    return {
      aeId: "",
      account: "",
      level: "VP/CTO",
      date: toISO(new Date()),
      note: "",
    };
  }

  /* ============================================================
   * Rendering
   * ========================================================== */
  const TABS = [
    { id: "home", label: "Spotlight", icon: "📣" },
    { id: "leaderboard", label: "Leaderboard", icon: "🏆" },
    { id: "roster", label: "Squad", icon: "🃏" },
    { id: "log", label: "Log NBM", icon: "✍️" },
    { id: "verify", label: "Verify", icon: "✅" },
    { id: "winners", label: "Weekly Winners", icon: "👕" },
    { id: "program", label: "Playbook", icon: "📋" },
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
          PG Spotlight · World Championship PG 2026 · shared team data is connected
        </div>
      </div>
      <div id="toast" class="toast"></div>
      <div id="modal-root"></div>
    `;
    bindGlobal();
    if (state.tab === "log") bindLogForm();
    renderModal();
  }

  function renderSyncBanner() {
    return `
      <div class="card card-pad" style="margin-bottom:16px;border-color:rgba(46,204,113,0.38);background:rgba(46,204,113,0.08)">
        <b>Shared competition mode is on.</b>
        <span style="color:var(--muted)">Everyone's submitted and verified NBMs are syncing into the same leaderboard.</span>
      </div>`;
  }

  function renderTopbar() {
    const wn = weekNumber(state.weekKey);
    return `
      <div class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <div class="crest">🏆</div>
            <div>
              <div class="sub">World Championship</div>
              <h1>PG Spotlight 2026</h1>
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
    const weekPending = db.entries.filter(
      (e) => e.weekKey === state.weekKey && e.status === "booked"
    ).length;
    return `
      <div class="tabs">
        ${TABS.map((t) => {
          const badge =
            t.id === "verify" && weekPending > 0
              ? `<span class="count">${weekPending}</span>`
              : "";
          return `<button class="tab ${state.tab === t.id ? "active" : ""}" data-tab="${t.id}">
              <span>${t.icon}</span>${t.label}${badge}
            </button>`;
        }).join("")}
      </div>`;
  }

  function renderStats() {
    const weekEntries = entriesForWeek(state.weekKey);
    const counting = weekEntries.filter(countsTowardStandings);
    const booked = weekEntries.filter((e) => e.status === "booked").length;
    const weekPoints = counting.reduce((s, e) => s + entryPoints(e), 0);
    const seasonPoints = db.entries.filter(countsTowardStandings).reduce((s, e) => s + entryPoints(e), 0);
    const onboard = activeAEsForWeek(state.weekKey).length;
    return `
      <div class="stat-strip">
        <div class="stat"><div class="k">AEs onboard</div><div class="v">${onboard} <small>/ ${db.aes.length}</small></div></div>
        <div class="stat"><div class="k">NBMs this week</div><div class="v">${weekEntries.length} <small>· ${counting.length} counting · ${booked} to confirm</small></div></div>
        <div class="stat"><div class="k">Points · week</div><div class="v">${weekPoints}</div></div>
        <div class="stat"><div class="k">Points · season</div><div class="v">${seasonPoints}</div></div>
      </div>`;
  }

  function renderView() {
    switch (state.tab) {
      case "home": return renderHome();
      case "leaderboard": return renderLeaderboard();
      case "roster": return renderRoster();
      case "log": return renderLog();
      case "verify": return renderVerify();
      case "winners": return renderWinners();
      case "program": return renderProgram();
      default: return "";
    }
  }

  /* ---------- Spotlight / Home ---------- */
  function renderHome() {
    const kickoff = parseDate(PROGRAM_START).toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    const rules = [
      ["🃏", "Panini squad format", "Every participating AE gets a collectible player card. Watch your OVR climb as you bank verified points."],
      ["🏟️", "Tournament style", "Points accumulate week to week in a knock-out-style race. A multiplier boosts scores in the finals."],
      ["🎯", "Cost & business case", "Lead with value. Anchor conversations on the Gartner report and a clear cost / business case."],
      ["✅", "Book, confirm, deliver", "AEs book NBMs. The RVP confirms the booking (base points count), then after the meeting marks it done and ticks the value story for the bonus points."],
      ["📈", "Climb the levels", "Higher-seniority meetings score more — a held VP/CTO meeting with a value story and next step is worth the max 8."],
      ["👕", "Win your jersey", `The ${WEEKLY_WINNER_COUNT} weekly winners pick a World Championship jersey — any country, with the Cursor logo.`],
    ];

    return `
      <div class="hero">
        <div class="ball">⚽</div>
        <div class="eyebrow">World Championship PG 2026</div>
        <h1>PG Spotlight</h1>
        <p class="lead">
          A six-week EMEA-wide sales championship to put pipeline generation in the spotlight.
          Run high-value New Business Meetings, tell the value story, and bank points to climb the
          leaderboard — tournament style. Every week, the top performers take home a jersey.
        </p>
        <div class="facts">
          <span class="chip">🚀 Kick-off <b>${kickoff}</b></span>
          <span class="chip">🌍 <b>${activeAEsForWeek(state.weekKey).length}</b> AEs onboard this week</span>
          <span class="chip">🏆 <b>${WEEKLY_WINNER_COUNT}</b> weekly winners</span>
          <span class="chip">📊 Max <b>8</b> pts per NBM</span>
        </div>
        <div class="cta btn-row">
          <button class="btn primary" data-tab="log">Log an NBM</button>
          <button class="btn" data-tab="leaderboard">View leaderboard</button>
          <a class="btn ghost" href="${CHEATSHEET_URL}" target="_blank" rel="noopener">Cheatsheet stories ↗</a>
        </div>
      </div>

      <div class="section-head"><div><h2>Rules of engagement</h2><p>What the championship rewards</p></div></div>
      <div class="rules-grid">
        ${rules.map((r) => `<div class="rule"><div class="ic">${r[0]}</div><b>${r[1]}</b><p>${esc(r[2])}</p></div>`).join("")}
      </div>

      <div class="two-col">
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-top:0">✍️ For Account Executives</h2>
          <div class="step-list">
            <div class="step-row"><span class="n">1</span><div><b>Book your NBMs</b><p>Target VP/CTO, Director/Head of, and Engineer personas — seniority scores higher.</p></div></div>
            <div class="step-row"><span class="n">2</span><div><b>Bring the value story</b><p>Use the Value Pyramid / POV and lock in a next step in the meeting — your RVP ticks these afterwards for bonus points.</p></div></div>
            <div class="step-row"><span class="n">3</span><div><b>Book it before Friday</b><p>Record each meeting in <b>Log NBM</b>. Base points count as soon as your RVP confirms the booking.</p></div></div>
          </div>
        </div>
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-top:0">✅ For RVPs / Managers</h2>
          <div class="step-list">
            <div class="step-row"><span class="n">1</span><div><b>Confirm bookings</b><p>Open <b>Verify</b> and confirm each booked NBM — base points start counting immediately.</p></div></div>
            <div class="step-row"><span class="n">2</span><div><b>Mark done & score the outcome</b><p>After the meeting, mark it <b>Done</b> (+2 held) and tick Value Pyramid (+2) and Next step (+1).</p></div></div>
            <div class="step-row"><span class="n">3</span><div><b>Present at 16:00</b><p>Share the standings at the EMEA wrap-up; two AEs present success stories.</p></div></div>
          </div>
        </div>
      </div>

      <div class="card card-pad" style="margin-top:20px">
        <h2 style="font-size:16px;margin-top:0">🗓️ Weekly cadence</h2>
        <div class="cadence-grid">
          <div class="cad"><div class="day">Monday</div><div class="time">09:00</div><div class="desc">Kick-off call — EMEA wide</div></div>
          <div class="cad"><div class="day">Monday</div><div class="time">17:00</div><div class="desc">Wrap-up call — local</div></div>
          <div class="cad"><div class="day">Friday</div><div class="time">16:00</div><div class="desc">EMEA wrap-up — 2 AEs present success stories</div></div>
        </div>
        <p style="color:var(--muted);font-size:13px;margin:14px 0 0">
          Full scoring rubric, prize details and data tools live in the <button class="btn sm ghost" data-tab="program">Playbook</button>.
        </p>
      </div>`;
  }

  /* ---------- Leaderboard ---------- */
  function renderLeaderboard() {
    const rows = leaderboard(state.lbScope, state.weekKey);
    const ranked = rows.filter((r) => r.points > 0);
    const max = ranked.length ? ranked[0].points : 1;
    const scopeLabel = state.lbScope === "week" ? `Week ${weekNumber(state.weekKey)}` : "Full season";

    const podium = ranked.slice(0, 3);
    const podiumOrder = [podium[1], podium[0], podium[2]]; // 2nd, 1st, 3rd
    const medals = { 0: "🥇", 1: "🥈", 2: "🥉" };

    const podiumHTML = ranked.length
      ? `<div class="podium">
          ${podiumOrder
            .map((r, idx) => {
              if (!r) return `<div></div>`;
              const rank = podium.indexOf(r);
              const c = countryByCode(r.ae.country);
              return `
                <div class="podium-card p${rank + 1}">
                  <div class="podium-rank">${rank + 1}</div>
                  <div class="medal">${medals[rank]}</div>
                  <div class="flag">${c.flag}</div>
                  <div class="nm">${esc(r.ae.name)}</div>
                  <div class="rg">${esc(r.ae.region)}</div>
                  <div class="pts">${r.points}<small> pts</small></div>
                </div>`;
            })
            .join("")}
        </div>`
      : "";

    const tableRows = ranked.length
      ? ranked
          .map((r, i) => {
            const c = countryByCode(r.ae.country);
            const pct = Math.max(6, Math.round((r.points / max) * 100));
            return `
              <tr>
                <td class="rankcell ${i < 3 ? "top" : ""}">${i + 1}</td>
                <td>
                  <div class="ae">
                    <span class="flag">${c.flag}</span>
                    <span><span class="nm">${esc(r.ae.name)}</span><br><span class="rg">${esc(r.ae.region)} · ${esc(r.ae.rvp)}</span></span>
                  </div>
                </td>
                <td class="num">${r.nbms}</td>
                <td class="num">${r.held}</td>
                <td>
                  <div class="ptscell">${r.points}</div>
                  <div class="bar"><span style="width:${pct}%"></span></div>
                </td>
              </tr>`;
          })
          .join("")
      : `<tr><td colspan="5"><div class="empty"><div class="ico">⚽</div><h3>No points logged yet</h3><p>Log NBMs to populate the ${scopeLabel.toLowerCase()} board.</p></div></td></tr>`;

    return `
      <div class="section-head">
        <div>
          <h2>Leaderboard</h2>
          <p>Tournament-style standings · ${scopeLabel} · top ${WEEKLY_WINNER_COUNT} take a jersey</p>
        </div>
        <div class="seg">
          <button class="${state.lbScope === "week" ? "active" : ""}" data-scope="week">This week</button>
          <button class="${state.lbScope === "season" ? "active" : ""}" data-scope="season">Season</button>
        </div>
      </div>
      ${podiumHTML}
      <div class="card">
        <table class="lb">
          <thead>
            <tr>
              <th>#</th><th>Account Executive</th>
              <th class="num">NBMs</th><th class="num">Held</th><th>Points</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
  }

  /* ---------- Roster / Panini cards ---------- */
  function renderRoster() {
    if (!db.aes.length) {
      return `
        <div class="section-head"><div><h2>Squad</h2><p>Your competing Account Executives</p></div>
          <button class="btn primary" data-action="add-ae">+ Add AE</button></div>
        <div class="empty"><div class="ico">🃏</div><h3>No AEs yet</h3><p>Add your roster to start the championship.</p></div>`;
    }
    const sorted = [...db.aes].sort((a, b) => {
      const activeA = isActiveInWeek(a, state.weekKey);
      const activeB = isActiveInWeek(b, state.weekKey);
      if (activeA !== activeB) return activeA ? -1 : 1;
      return aeSeasonStats(b.id).points - aeSeasonStats(a.id).points;
    });
    const cards = sorted
      .map((ae, idx) => {
        const s = aeSeasonStats(ae.id);
        const c = countryByCode(ae.country);
        const active = isActiveInWeek(ae, state.weekKey);
        const initials = ae.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
        const rank = idx + 1;
        const card = paniniRating(s, rank);
        return `
          <div class="panini ${card.cls}">
            <div class="panini-inner">
              <div class="top-row">
                <div class="ovr">${card.ovr}<small>OVR</small></div>
                <div class="flag">${c.flag}</div>
              </div>
              <div class="avatar"><span class="initials">${esc(initials)}</span></div>
              <div class="card-tier">${card.label} · #${rank}</div>
              <div class="pname">${esc(ae.name)}</div>
              <div class="prole">${esc(ae.region)} · ${esc(c.name)}</div>
              <div class="joinline ${active ? "active" : "future"}">${active ? "Onboarded" : "Joins"} · ${formatStartDate(ae.startDate)}</div>
              <div class="pstats">
                <div class="pstat"><b>${s.points}</b><span>Points</span></div>
                <div class="pstat"><b>${s.nbms}</b><span>NBMs</span></div>
                <div class="pstat"><b>${s.held}</b><span>Held</span></div>
              </div>
              <div class="card-actions">
                <button data-action="edit-ae" data-id="${ae.id}">Edit</button>
                <button data-action="log-for" data-id="${ae.id}">Log NBM</button>
              </div>
            </div>
          </div>`;
      })
      .join("");
    return `
      <div class="section-head">
        <div><h2>Squad — Panini Wall</h2><p>${db.aes.length} Account Executives · OVR rating grows with season points</p></div>
        <button class="btn primary" data-action="add-ae">+ Add AE</button>
      </div>
      <div class="grid-cards">${cards}</div>`;
  }

  /* ---------- Log NBM ---------- */
  function renderLog() {
    const d = state.draft;
    const activeAEs = activeAEsForWeek(state.weekKey);
    const aeOptions = activeAEs
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((ae) => `<option value="${ae.id}" ${d.aeId === ae.id ? "selected" : ""}>${esc(ae.name)} — ${esc(ae.region)}</option>`)
      .join("");
    const levelOptions = Object.keys(LEVELS)
      .map((l) => `<option value="${l}" ${d.level === l ? "selected" : ""}>${LEVELS[l].short} (base ${LEVELS[l].base})</option>`)
      .join("");

    const recent = entriesForWeek(state.weekKey)
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    return `
      <div class="section-head">
        <div><h2>Book a New Business Meeting</h2><p>Week ${weekNumber(state.weekKey)} · ${weekLabel(state.weekKey)} — book it before Fri 12:00; your RVP confirms it and adds the outcome after the meeting</p></div>
      </div>
      <div class="two-col">
        <div class="card card-pad">
          <form id="nbm-form">
            <div class="form-grid">
              <div class="field">
                <label>Account Executive</label>
                <select data-field="aeId" required>
                  <option value="">Select AE…</option>${aeOptions}
                </select>
                <div class="meta" id="ae-manager-hint" style="margin-top:6px">${d.aeId && managerOf(d.aeId) ? "Confirmed by: " + esc(managerOf(d.aeId)) : ""}</div>
                ${activeAEs.length ? "" : `<p style="color:var(--muted);font-size:12px;margin:6px 0 0">No AEs have joined by this week yet.</p>`}
              </div>
              <div class="field">
                <label>Account / Prospect</label>
                <input type="text" data-field="account" value="${esc(d.account)}" placeholder="e.g. Helios Bank" />
              </div>
              <div class="field">
                <label>NBM level</label>
                <select data-field="level">${levelOptions}</select>
              </div>
              <div class="field">
                <label>Meeting date</label>
                <input type="date" data-field="date" value="${esc(d.date)}" />
              </div>
              <div class="field full">
                <div class="meta" style="background:rgba(7,30,71,.05);border-radius:10px;padding:10px 12px">
                  Booking locks in the <b>base points</b> once your RVP confirms it.
                  After the meeting, your RVP marks it <b>Done</b> (+2 held) and ticks
                  <b>Value Pyramid</b> (+2) and <b>Next step</b> (+1) for the full score.
                </div>
              </div>
              <div class="field full">
                <label>Notes (optional)</label>
                <textarea data-field="note" placeholder="Context, value story, next step…">${esc(d.note)}</textarea>
              </div>
            </div>
            <div class="btn-row" style="margin-top:16px">
              <button type="submit" class="btn primary">Book NBM</button>
              <button type="button" class="btn ghost" data-action="reset-draft">Clear</button>
            </div>
          </form>
        </div>
        <div>
          <div class="points-preview" style="margin-bottom:16px">
            <div>
              <div id="preview-pts" class="big">${draftPoints(d)}</div>
              <div class="lbl">base pts on confirm · up to ${LEVELS[d.level].max} when done</div>
            </div>
          </div>
          <div class="card">
            <div class="section-head" style="padding:14px 16px 0;margin:0">
              <div><h2 style="font-size:15px">This week’s log</h2></div>
              ${recent.length ? `<button class="btn sm ghost" data-action="export-week">Export CSV</button>` : ""}
            </div>
            <div style="padding:6px 4px 8px">
              ${
                recent.length
                  ? recent.map(renderEntryRow).join("")
                  : `<div class="empty"><div class="ico">📭</div><p>No NBMs logged this week yet.</p></div>`
              }
            </div>
          </div>
        </div>
      </div>`;
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

  function renderEntryRow(e) {
    const ae = db.aes.find((a) => a.id === e.aeId);
    const c = countryByCode(ae ? ae.country : "");
    const lvl = LEVELS[e.level] || { cls: "", short: e.level };
    const tags = [
      e.valuePyramid ? "POV" : null,
      e.held ? "Held" : null,
      e.calendarised ? "Next step" : null,
    ].filter(Boolean).join(" · ");
    return `
      <div class="entry">
        <span class="flag">${c.flag}</span>
        <div class="main">
          <b>${esc(ae ? ae.name : "Unknown")}</b> <span class="badge ${lvl.cls}">${lvl.short}</span> ${statusBadge(e)}
          <div class="meta">${esc(e.account || "—")}${tags ? " · " + tags : ""}</div>
        </div>
        <div class="epts">${entryPoints(e)}</div>
        <button class="del" data-action="del-entry" data-id="${e.id}" title="Delete">✕</button>
      </div>`;
  }

  /* ---------- Manager verification queue ---------- */
  function managerOf(aeId) {
    const ae = db.aes.find((a) => a.id === aeId);
    return (ae && ae.rvp) || "";
  }
  function renderVerify() {
    const managers = [...new Set(db.aes.map((a) => a.rvp).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const selMgr = state.verifyMgr || "";
    let weekEntries = entriesForWeek(state.weekKey).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (selMgr) weekEntries = weekEntries.filter((e) => managerOf(e.aeId) === selMgr);
    const booked = weekEntries.filter((e) => e.status === "booked");
    const confirmed = weekEntries.filter((e) => e.status === "confirmed");
    const done = weekEntries.filter((e) => e.status === "done");
    const rejected = weekEntries.filter((e) => e.status === "rejected");
    const mgr = (db.settings && db.settings.managerName) || "";
    const mgrOptions =
      `<option value="">All managers</option>` +
      managers.map((m) => `<option value="${esc(m)}" ${selMgr === m ? "selected" : ""}>${esc(m)}</option>`).join("");

    const group = (title, list, kind, emptyMsg) => {
      if (!list.length && kind !== "booked") return "";
      return `
        <div class="verify-group">
          <div class="gh">${title} <span class="chip"><b>${list.length}</b></span></div>
          <div class="card">
            ${
              list.length
                ? list.map((e) => renderVerifyRow(e, kind)).join("")
                : `<div class="empty"><div class="ico">🎉</div><p>${esc(emptyMsg || `No bookings awaiting confirmation for Week ${weekNumber(state.weekKey)}.`)}</p></div>`
            }
          </div>
        </div>`;
    };

    return `
      <div class="section-head">
        <div><h2>Manager Verification</h2>
        <p>Week ${weekNumber(state.weekKey)} · ${weekLabel(state.weekKey)} — confirm bookings (base points), then mark them done and tick the value story</p></div>
        <div class="btn-row">
          <select data-field="verifyMgr" style="min-width:170px">${mgrOptions}</select>
          ${selMgr ? `<button class="btn ghost sm" data-action="copy-mgr-link">Copy ${esc(selMgr)}'s link</button>` : ""}
          <input type="text" data-field="managerName" value="${esc(mgr)}" placeholder="Your name (RVP / manager)" style="min-width:200px" />
          ${booked.length ? `<button class="btn primary sm" data-action="confirm-all">Confirm all (${booked.length})</button>` : ""}
        </div>
      </div>
      ${group(`⏳ Booked — confirm to start scoring`, booked, "booked")}
      ${group(`📅 Confirmed — base points counting`, confirmed, "confirmed")}
      ${group(`✓ Done — full score counting`, done, "done")}
      ${group(`✕ Rejected`, rejected, "rejected")}`;
  }

  function renderVerifyRow(e, kind) {
    const ae = db.aes.find((a) => a.id === e.aeId);
    const c = countryByCode(ae ? ae.country : "");
    const lvl = LEVELS[e.level] || { cls: "", short: e.level };
    // Outcome state is shown via the toggle buttons below, so keep the meta line
    // to just the account here.
    const tags = "";
    let acts = "";
    if (kind === "booked") {
      acts = `
        <button class="btn primary sm" data-action="confirm-entry" data-id="${e.id}">Confirm</button>
        <button class="btn danger sm" data-action="reject-entry" data-id="${e.id}">Reject</button>`;
    } else if (kind === "confirmed") {
      acts = `
        <button class="btn primary sm" data-action="mark-done" data-id="${e.id}">Mark done</button>
        <button class="btn ghost sm" data-action="revert-booked" data-id="${e.id}">Revert</button>`;
    } else if (kind === "done") {
      acts = `<button class="btn ghost sm" data-action="revert-confirmed" data-id="${e.id}">Reopen</button>`;
    } else {
      acts = `<button class="btn ghost sm" data-action="revert-booked" data-id="${e.id}">Restore</button>`;
    }

    // After the meeting, the leader ticks the value-story bonuses (live points).
    let outcome = "";
    if (kind === "confirmed" || kind === "done") {
      const toggle = (comp, label, pts) =>
        `<button class="btn sm ${e[comp] ? "primary" : "ghost"}" data-action="toggle-comp" data-id="${e.id}" data-comp="${comp}">${e[comp] ? "✓ " : ""}${label} +${pts}</button>`;
      const heldChip = kind === "done"
        ? `<span class="badge verified" title="Auto-added when marked done">✓ Held +2</span>`
        : "";
      outcome = `
        <div class="outcome-row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
          ${heldChip}
          ${toggle("valuePyramid", "Value Pyramid", 2)}
          ${toggle("calendarised", "Next step", 1)}
        </div>`;
    }

    const stamp =
      (e.status === "confirmed" || e.status === "done" || e.status === "rejected") && e.verifiedBy
        ? `<div class="vstamp">${e.status === "rejected" ? "Rejected" : e.status === "done" ? "Done" : "Confirmed"} by ${esc(e.verifiedBy)}</div>`
        : "";
    return `
      <div class="entry">
        <span class="flag">${c.flag}</span>
        <div class="main">
          <b>${esc(ae ? ae.name : "Unknown")}</b> <span class="badge ${lvl.cls}">${lvl.short}</span>
          <div class="meta">${esc(e.account || "—")}${tags ? " · " + tags : ""}</div>
          ${ae && ae.rvp ? `<div class="meta">Manager: ${esc(ae.rvp)}</div>` : ""}
          ${formatLoggedAt(e.createdAt) ? `<div class="vstamp">${formatLoggedAt(e.createdAt)}</div>` : ""}
          ${stamp}
          ${outcome}
        </div>
        <div class="epts">${entryPoints(e)}</div>
        <div class="acts">${acts}</div>
      </div>`;
  }

  /* ---------- Weekly winners + jerseys ---------- */
  function renderWinners() {
    const rows = leaderboard("week", state.weekKey).filter((r) => r.points > 0);
    const winners = rows.slice(0, WEEKLY_WINNER_COUNT);
    const picks = db.jerseys[state.weekKey] || {};

    const body = winners.length
      ? `<div class="winners-grid">
          ${winners
            .map((r, i) => {
              const pickedCode = picks[r.ae.id] || r.ae.country;
              const jc = countryByCode(pickedCode);
              const opts = COUNTRIES.map(
                (c) => `<option value="${c.code}" ${c.code === pickedCode ? "selected" : ""}>${c.flag} ${esc(c.name)}</option>`
              ).join("");
              return `
                <div class="jersey">
                  <div class="rankbadge">#${i + 1}</div>
                  <div class="shirt">${shirtSVG(jc.color)}<div class="cursor-logo">CURSOR</div></div>
                  <div class="wname">${esc(r.ae.name)}</div>
                  <div class="wpts">${r.points} <small>pts</small></div>
                  <select data-action="pick-jersey" data-id="${r.ae.id}">${opts}</select>
                </div>`;
            })
            .join("")}
        </div>`
      : `<div class="empty"><div class="ico">👕</div><h3>No winners yet for Week ${weekNumber(state.weekKey)}</h3><p>Winners appear once NBMs are logged for this week.</p></div>`;

    return `
      <div class="section-head">
        <div><h2>Weekly Winners — Week ${weekNumber(state.weekKey)}</h2>
        <p>Top ${WEEKLY_WINNER_COUNT} pick their World Championship jersey · country of choice + Cursor logo</p></div>
      </div>
      ${body}`;
  }

  function shirtSVG(color) {
    return `
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M34 10 L44 6 Q50 12 56 6 L66 10 L86 24 L76 38 L70 32 L70 92 L30 92 L30 32 L24 38 L14 24 Z"
          fill="${color}" stroke="rgba(0,0,0,0.25)" stroke-width="1.5"/>
        <path d="M44 6 Q50 16 56 6 L52 16 Q50 18 48 16 Z" fill="rgba(255,255,255,0.85)"/>
      </svg>`;
  }

  /* ---------- Program / Playbook ---------- */
  function renderProgram() {
    const rubricRows = Object.keys(LEVELS)
      .map((l) => {
        const lv = LEVELS[l];
        return `<tr><td>${lv.short}</td><td>${lv.base}</td><td>2</td><td>2</td><td>1</td><td class="max">${lv.max}</td></tr>`;
      })
      .join("");
    return `
      <div class="section-head"><div><h2>Playbook</h2><p>Everything from the PG Spotlight brief, in one place</p></div></div>
      <div class="two-col">
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-top:0">Operational cadence</h2>
          <div class="cadence-grid">
            <div class="cad"><div class="day">Monday</div><div class="time">09:00</div><div class="desc">Kick-off call — EMEA wide</div></div>
            <div class="cad"><div class="day">Monday</div><div class="time">17:00</div><div class="desc">Wrap-up call — local</div></div>
            <div class="cad"><div class="day">Friday</div><div class="time">16:00</div><div class="desc">EMEA wrap-up — 2 AEs present success stories</div></div>
          </div>
          <ul class="info-list" style="margin-top:16px">
            <li><span class="dot">▸</span><span><b>Kick-off:</b> 15 June 2026 — Sabiha opens with value stories.</span></li>
            <li><span class="dot">▸</span><span><b>RVP submission:</b> Fridays before 12:00 via the shared sheet to present at 16:00.</span></li>
            <li><span class="dot">▸</span><span><b>Focus:</b> Cost / business case, anchored on the Gartner report.</span></li>
            <li><span class="dot">▸</span><span><b>Format:</b> Panini-card participants · tournament-style points · multiplier in the finals.</span></li>
          </ul>
        </div>
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-top:0">Scoring rubric — NBM</h2>
          <table class="rubric">
            <thead><tr><th>Level of NBM</th><th>Level pts</th><th>Value Pyramid / POV</th><th>Held / Done</th><th>Calendarised step</th><th>Max</th></tr></thead>
            <tbody>${rubricRows}</tbody>
          </table>
          <p style="color:var(--muted);font-size:12.5px;margin-top:12px">
            Each NBM scores its level points plus any components achieved. A held VP/CTO meeting with a value
            story and a booked next step is the maximum 8 points.
          </p>
          <div class="btn-row" style="margin-top:8px">
            <a class="btn sm" href="${CHEATSHEET_URL}" target="_blank" rel="noopener">Cheatsheet stories ↗</a>
          </div>
        </div>
      </div>

      <div class="card card-pad" style="margin-top:20px">
        <div class="section-head" style="margin:0 0 8px"><div><h2 style="font-size:16px">Prize & data</h2></div></div>
        <ul class="info-list">
          <li><span class="dot">🏅</span><span><b>Weekly prize:</b> the ${WEEKLY_WINNER_COUNT} weekly winners each pick their World Championship jersey — the country of their choice, with the Cursor logo.</span></li>
          <li><span class="dot">🗓</span><span><b>Roster start dates:</b> AEs become available from their start date. Future joiners are shown on the Squad wall but excluded from that week's logging and leaderboard until they join.</span></li>
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
            <div class="field" style="margin-top:12px">
              <label>Start date</label>
              <input type="date" data-field="startDate" value="${esc(ae.startDate || PROGRAM_START)}" />
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
      const get = (f) => $(`[data-field="${f}"]`, form).value.trim();
      const data = { name: get("name"), country: get("country"), region: get("region"), rvp: get("rvp"), startDate: get("startDate") || PROGRAM_START };
      if (!data.name) return;
      if (m.mode === "edit") {
        Object.assign(m.ae, data);
        toast("AE updated");
      } else {
        db.aes.push({ id: uid(), ...data });
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
  function setEntryStatus(id, status) {
    const e = db.entries.find((x) => x.id === id);
    if (!e) return;
    e.status = status;
    // Held (+2) is auto-tied to "done"; confirming or reverting clears it.
    e.held = status === "done";
    if (status === "booked") {
      e.verifiedBy = "";
      e.verifiedAt = "";
    } else {
      e.verifiedBy = (db.settings && db.settings.managerName) || "Manager";
      e.verifiedAt = new Date().toISOString();
    }
    save();
    render();
    const msg = {
      booked: "Moved back to booked",
      confirmed: "Booking confirmed · base points now counting",
      done: "Marked done · Held +2 added",
      rejected: "NBM rejected",
    }[status] || "Updated";
    toast(msg);
  }
  // Leader toggles a post-meeting bonus (Value Pyramid / Next step). Only
  // meaningful once the booking is confirmed, when points are live.
  function toggleEntryComponent(id, comp) {
    if (comp !== "valuePyramid" && comp !== "calendarised") return;
    const e = db.entries.find((x) => x.id === id);
    if (!e) return;
    if (e.status !== "confirmed" && e.status !== "done") return;
    e[comp] = !e[comp];
    if (!e.verifiedBy) e.verifiedBy = (db.settings && db.settings.managerName) || "Manager";
    save();
    render();
  }

  function bindGlobal() {
    $("#root").addEventListener("click", onClick);
    $("#root").addEventListener("change", onChange);
  }

  function onClick(ev) {
    const tabBtn = ev.target.closest("[data-tab]");
    if (tabBtn) {
      state.tab = tabBtn.getAttribute("data-tab");
      render();
      return;
    }
    const scopeBtn = ev.target.closest("[data-scope]");
    if (scopeBtn) {
      state.lbScope = scopeBtn.getAttribute("data-scope");
      render();
      return;
    }
    const actEl = ev.target.closest("[data-action]");
    if (!actEl) return;
    const action = actEl.getAttribute("data-action");
    const id = actEl.getAttribute("data-id");

    if (action === "copy-mgr-link") {
      const url = location.origin + location.pathname + "#verify=" + encodeURIComponent(state.verifyMgr || "");
      copyToClipboard(url);
      toast("Manager link copied");
      return;
    }

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
      case "log-for":
        state.draft = blankDraft();
        state.draft.aeId = id;
        state.tab = "log";
        render();
        break;
      case "reset-draft":
        state.draft = blankDraft();
        render();
        break;
      case "del-entry":
        db.entries = db.entries.filter((e) => e.id !== id);
        save();
        render();
        toast("Entry deleted");
        break;
      case "confirm-entry":
        setEntryStatus(id, "confirmed");
        break;
      case "mark-done":
        setEntryStatus(id, "done");
        break;
      case "revert-confirmed":
        setEntryStatus(id, "confirmed");
        break;
      case "revert-booked":
        setEntryStatus(id, "booked");
        break;
      case "reject-entry":
        setEntryStatus(id, "rejected");
        break;
      case "toggle-comp":
        toggleEntryComponent(id, actEl.getAttribute("data-comp"));
        break;
      case "confirm-all": {
        const mgr = (db.settings && db.settings.managerName) || "Manager";
        let n = 0;
        db.entries.forEach((e) => {
          if (e.weekKey === state.weekKey && e.status === "booked") {
            e.status = "confirmed";
            e.held = false;
            e.verifiedBy = mgr;
            e.verifiedAt = new Date().toISOString();
            n++;
          }
        });
        save();
        render();
        toast(`Confirmed ${n} booking${n === 1 ? "" : "s"}`);
        break;
      }
      case "export-week":
        exportCSV();
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

  function onChange(ev) {
    const jersey = ev.target.closest("[data-action='pick-jersey']");
    if (jersey) {
      const aeId = jersey.getAttribute("data-id");
      if (!db.jerseys[state.weekKey]) db.jerseys[state.weekKey] = {};
      db.jerseys[state.weekKey][aeId] = jersey.value;
      save();
      render();
      toast("Jersey selected");
      return;
    }
    const mgrFilter = ev.target.closest("[data-field='verifyMgr']");
    if (mgrFilter) {
      state.verifyMgr = mgrFilter.value;
      render();
      return;
    }
    const mgrInput = ev.target.closest("[data-field='managerName']");
    if (mgrInput) {
      if (!db.settings) db.settings = { managerName: "" };
      db.settings.managerName = mgrInput.value;
      save();
    }
  }

  // Log form: live preview without re-rendering (preserves input focus).
  function bindLogForm() {
    const form = $("#nbm-form");
    if (!form) return;
    form.addEventListener("input", syncDraft);
    form.addEventListener("change", syncDraft);
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      syncDraft();
      const d = state.draft;
      if (!d.aeId) {
        toast("Pick an AE first");
        return;
      }
      // The NBM belongs to the week it is booked in (now) — not the meeting
      // date, which may be scheduled for a later week.
      const bookingWeek = weekKeyForDate();
      const meetingDate = d.date || toISO(new Date());
      const selectedAE = db.aes.find((ae) => ae.id === d.aeId);
      if (selectedAE && !isActiveInWeek(selectedAE, bookingWeek)) {
        toast("This AE has not joined by the booked week");
        return;
      }
      db.entries.push({
        id: uid(),
        aeId: d.aeId,
        // The booking week is when the NBM was booked, regardless of meeting date.
        weekKey: bookingWeek,
        level: d.level,
        account: d.account,
        // Outcome bonuses start empty — the leader fills these in after the meeting.
        valuePyramid: false,
        held: false,
        calendarised: false,
        date: meetingDate,
        note: d.note,
        status: "booked",
        verifiedBy: "",
        verifiedAt: "",
        createdAt: new Date().toISOString(),
      });
      const base = draftPoints(d);
      save();
      const keepAe = d.aeId;
      state.draft = blankDraft();
      state.draft.aeId = keepAe;
      // Jump to the week the NBM was booked in so it's visible immediately.
      state.weekKey = bookingWeek;
      render();
      toast(`NBM booked · +${base} base pts once your RVP confirms`);
    });
  }

  function syncDraft() {
    const form = $("#nbm-form");
    if (!form) return;
    const d = state.draft;
    form.querySelectorAll("[data-field]").forEach((el) => {
      const f = el.getAttribute("data-field");
      d[f] = el.type === "checkbox" ? el.checked : el.value;
    });
    // patch base-points preview + the confirmer hint without a full re-render
    const prev = $("#preview-pts");
    if (prev) prev.textContent = draftPoints(d);
    const hint = $("#ae-manager-hint");
    if (hint) hint.textContent = d.aeId && managerOf(d.aeId) ? "Confirmed by: " + managerOf(d.aeId) : "";
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
  function exportCSV() {
    const rows = entriesForWeek(state.weekKey);
    const head = ["AE", "Region", "RVP", "Account", "Level", "Value Pyramid/POV", "Held", "Calendarised", "Points", "Date", "Notes"];
    const lines = [head.join(",")];
    rows.forEach((e) => {
      const ae = db.aes.find((a) => a.id === e.aeId) || {};
      const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      lines.push(
        [ae.name, ae.region, ae.rvp, e.account, LEVELS[e.level].short, e.valuePyramid ? "Y" : "N",
          e.held ? "Y" : "N", e.calendarised ? "Y" : "N", entryPoints(e), e.date, e.note]
          .map(cell).join(",")
      );
    });
    download(`pg-spotlight-week-${weekNumber(state.weekKey)}.csv`, lines.join("\n"), "text/csv");
    toast("CSV exported");
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
      const m = (location.hash || "").match(/verify=([^&]+)/);
      if (m) {
        state.tab = "verify";
        state.verifyMgr = decodeURIComponent(m[1].replace(/\+/g, " "));
      }
    } catch (e) {
      /* ignore */
    }
  }
  loadOrSeed();
  applyDeepLink();
  render();
})();
