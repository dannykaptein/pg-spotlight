/* PG Spotlight — shared team sync (Supabase).
 *
 * This file is intentionally self-contained so it keeps working even if app.js
 * is reset by an editor. It syncs at the localStorage layer:
 *   - reads/writes the app's local database (key starting "pg-spotlight-")
 *   - mirrors it to Supabase (aes / nbm_entries / jerseys tables)
 *   - polls so everyone on the team sees the same live ranking
 *
 * A 3-way merge (last-known snapshot vs. my local vs. the server) makes sure
 * concurrent edits from different people don't clobber each other.
 *
 * The publishable key below is safe to ship in the browser — access is limited
 * by the Row Level Security policies created in supabase-schema.sql.
 */
(function () {
  "use strict";

  /* ---------- connection (overridable via config.js) ---------- */
  var SUPABASE_URL = "https://qodolcmtrpczpaueifyh.supabase.co";
  var SUPABASE_KEY = "sb_publishable_el0wj5epMvdnWYy0ALCRMw_DqZoF0oO";
  try {
    var cfg = window.PG_CONFIG || {};
    if (String(cfg.supabaseUrl || "").trim()) SUPABASE_URL = String(cfg.supabaseUrl).trim();
    if (String(cfg.supabasePublishableKey || "").trim()) SUPABASE_KEY = String(cfg.supabasePublishableKey).trim();
    else if (String(cfg.supabaseAnonKey || "").trim()) SUPABASE_KEY = String(cfg.supabaseAnonKey).trim();
  } catch (e) {
    /* ignore */
  }
  SUPABASE_URL = SUPABASE_URL.replace(/\/+$/, "");
  var REST = SUPABASE_URL + "/rest/v1/";
  var POLL_MS = 6000;
  var SNAP_KEY = "pg-supa-snapshot";

  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  function headers(extra) {
    var h = {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  /* ---------- local database ---------- */
  var CANON_KEY = "pg-spotlight-v1"; // MUST match STORE_KEY in app.js
  function storeKey() { return CANON_KEY; }
  function cleanupStaleKeys() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("pg-spotlight-") === 0 && k !== CANON_KEY) kill.push(k);
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {
      /* ignore */
    }
  }
  function normalize(db) {
    db = db || {};
    var out = {
      aes: Array.isArray(db.aes) ? db.aes : [],
      entries: Array.isArray(db.entries) ? db.entries : [],
      jerseys: db.jerseys && typeof db.jerseys === "object" ? db.jerseys : {},
      settings: db.settings && typeof db.settings === "object" ? db.settings : { managerName: "" },
    };
    return ensureRvp(out);
  }
  // Backfill each AE's manager from the known roster (by name) when missing,
  // so the manager filter always has data even if a stale sync dropped it.
  function nameToMgr() {
    var map = {};
    (typeof REAL_ROSTER !== "undefined" ? REAL_ROSTER : []).forEach(function (r) {
      if (r && r[0]) map[String(r[0]).trim().toLowerCase()] = r[2] || "";
    });
    return map;
  }
  function ensureRvp(db) {
    var map = nameToMgr();
    (db.aes || []).forEach(function (a) {
      if (a && (!a.rvp || !String(a.rvp).trim())) {
        var m = map[String(a.name || "").trim().toLowerCase()];
        if (m) a.rvp = m;
      }
    });
    return db;
  }
  function readLocal() {
    try { return normalize(JSON.parse(localStorage.getItem(storeKey()) || "null")); }
    catch (e) { return normalize(null); }
  }
  function writeLocal(db) {
    try { localStorage.setItem(storeKey(), JSON.stringify(normalize(db))); } catch (e) {}
  }
  function readSnap() {
    try { var s = localStorage.getItem(SNAP_KEY); return s ? normalize(JSON.parse(s)) : null; }
    catch (e) { return null; }
  }
  function writeSnap(db) {
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(normalize(db))); } catch (e) {}
  }

  /* ---------- row <-> object conversions ---------- */
  function aeToRow(a) {
    return {
      id: a.id, name: a.name, country: a.country || "", region: a.region || "", rvp: a.rvp || "",
      start_date: a.startDate || "", photo_url: a.photoUrl || "",
      calendar_email: a.calendarEmail || "", active: a.active !== false,
    };
  }
  function rowToAE(r) {
    return {
      id: r.id, name: r.name, country: r.country || "", region: r.region || "", rvp: r.rvp || "",
      startDate: r.start_date || "", photoUrl: r.photo_url || "",
      calendarEmail: r.calendar_email || "", active: r.active !== false,
    };
  }
  function entryToRow(e) {
    return {
      id: e.id, ae_id: e.aeId, week_key: e.weekKey, level: e.level, account: e.account || "",
      value_pyramid: !!e.valuePyramid, held: !!e.held, calendarised: !!e.calendarised,
      date: e.date || "", note: e.note || "", status: e.status || "pending",
      verified_by: e.verifiedBy || "", verified_at: e.verifiedAt || "", created_at: e.createdAt || new Date().toISOString(),
      source: e.source || "manual", calendar_event_id: e.calendarEventId || null,
      attendee_email: e.attendeeEmail || "", attendee_name: e.attendeeName || "", attendee_title: e.attendeeTitle || "",
      auto_level: e.autoLevel || "",
    };
  }
  function rowToEntry(r) {
    return {
      id: r.id, aeId: r.ae_id, weekKey: r.week_key, level: r.level, account: r.account || "",
      valuePyramid: !!r.value_pyramid, held: !!r.held, calendarised: !!r.calendarised,
      date: r.date || "", note: r.note || "", status: r.status || "pending",
      verifiedBy: r.verified_by || "", verifiedAt: r.verified_at || "", createdAt: r.created_at || "",
      source: r.source || "manual", calendarEventId: r.calendar_event_id || "",
      attendeeEmail: r.attendee_email || "", attendeeName: r.attendee_name || "", attendeeTitle: r.attendee_title || "",
      autoLevel: r.auto_level || "",
    };
  }

  /* ---------- network ---------- */
  function sbGet(path) {
    return fetch(REST + path, { headers: headers() }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("GET " + path + " " + r.status + " " + t); });
      return r.json();
    });
  }
  function sbUpsert(table, rows) {
    if (!rows.length) return Promise.resolve();
    return fetch(REST + table, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows),
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("UPSERT " + table + " " + r.status + " " + t); });
      return true;
    });
  }
  function sbDelete(table, query) {
    return fetch(REST + table + "?" + query, { method: "DELETE", headers: headers({ Prefer: "return=minimal" }) })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error("DELETE " + table + " " + r.status + " " + t); });
        return true;
      });
  }
  function pullRemote() {
    return Promise.all([sbGet("aes?select=*"), sbGet("nbm_entries?select=*"), sbGet("jerseys?select=*")]).then(function (res) {
      var jerseys = {};
      (res[2] || []).forEach(function (j) {
        if (!jerseys[j.week_key]) jerseys[j.week_key] = {};
        jerseys[j.week_key][j.ae_id] = j.country || "";
      });
      return { aes: (res[0] || []).map(rowToAE), entries: (res[1] || []).map(rowToEntry), jerseys: jerseys, settings: { managerName: "" } };
    });
  }

  /* ---------- merge ---------- */
  function indexById(arr) { var m = {}; (arr || []).forEach(function (x) { if (x && x.id != null) m[x.id] = x; }); return m; }
  function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function has(map, id) { return Object.prototype.hasOwnProperty.call(map, id); }

  // 3-way merge of a record list keyed by id. Mine wins on a true conflict.
  function mergeList(base, mine, theirs) {
    var b = indexById(base), m = indexById(mine), t = indexById(theirs);
    var ids = {};
    [b, m, t].forEach(function (map) { Object.keys(map).forEach(function (k) { ids[k] = 1; }); });
    var out = [];
    Object.keys(ids).forEach(function (id) {
      var mh = has(m, id), th = has(t, id), bh = has(b, id);
      var iChanged = mh !== bh || (mh && bh && !eq(m[id], b[id]));
      var theyChanged = th !== bh || (th && bh && !eq(t[id], b[id]));
      var pick;
      if (iChanged && !theyChanged) pick = mh ? m[id] : undefined;
      else if (theyChanged && !iChanged) pick = th ? t[id] : undefined;
      else if (iChanged && theyChanged) pick = mh ? m[id] : undefined; // conflict -> mine
      else pick = bh ? b[id] : th ? t[id] : mh ? m[id] : undefined;
      if (pick !== undefined) out.push(pick);
    });
    return out;
  }
  function jerseysToList(j) {
    var out = [];
    Object.keys(j || {}).forEach(function (wk) {
      Object.keys(j[wk] || {}).forEach(function (ae) {
        out.push({ id: wk + "::" + ae, week_key: wk, ae_id: ae, country: j[wk][ae] });
      });
    });
    return out;
  }
  function listToJerseys(list) {
    var j = {};
    (list || []).forEach(function (x) { if (!j[x.week_key]) j[x.week_key] = {}; j[x.week_key][x.ae_id] = x.country || ""; });
    return j;
  }
  function mergeDB(base, mine, theirs) {
    base = normalize(base); mine = normalize(mine); theirs = normalize(theirs);
    return {
      aes: mergeList(base.aes, mine.aes, theirs.aes),
      entries: mergeList(base.entries, mine.entries, theirs.entries),
      jerseys: listToJerseys(mergeList(jerseysToList(base.jerseys), jerseysToList(mine.jerseys), jerseysToList(theirs.jerseys))),
      settings: mine.settings,
    };
  }
  function stableData(db) {
    db = normalize(db);
    function s(a) { return (a || []).slice().sort(function (x, y) { return String(x && x.id).localeCompare(String(y && y.id)); }); }
    return JSON.stringify({ aes: s(db.aes), entries: s(db.entries), jerseys: jerseysToList(db.jerseys).sort(function (x, y) { return x.id.localeCompare(y.id); }) });
  }

  /* ---------- push local -> remote ---------- */
  function pushRemote(remote, merged) {
    remote = normalize(remote); merged = normalize(merged);
    var tA = indexById(remote.aes), tE = indexById(remote.entries);
    var mA = indexById(merged.aes), mE = indexById(merged.entries);
    var upAes = merged.aes.filter(function (a) { return !eq(a, tA[a.id]); }).map(aeToRow);
    var upEntries = merged.entries.filter(function (e) { return !eq(e, tE[e.id]); }).map(entryToRow);
    var delAes = remote.aes.filter(function (a) { return !has(mA, a.id); }).map(function (a) { return a.id; });
    var delEntries = remote.entries.filter(function (e) { return !has(mE, e.id); }).map(function (e) { return e.id; });

    var tJ = jerseysToList(remote.jerseys), mJ = jerseysToList(merged.jerseys);
    var tJi = indexById(tJ), mJi = indexById(mJ);
    var upJ = mJ.filter(function (x) { return !eq(x, tJi[x.id]); }).map(function (x) { return { week_key: x.week_key, ae_id: x.ae_id, country: x.country }; });
    var delJ = tJ.filter(function (x) { return !has(mJi, x.id); });

    var ops = [];
    if (upAes.length) ops.push(sbUpsert("aes", upAes));
    if (upEntries.length) ops.push(sbUpsert("nbm_entries", upEntries));
    if (upJ.length) ops.push(sbUpsert("jerseys", upJ));
    delEntries.forEach(function (id) { ops.push(sbDelete("nbm_entries", "id=eq." + encodeURIComponent(id))); });
    delAes.forEach(function (id) { ops.push(sbDelete("aes", "id=eq." + encodeURIComponent(id))); });
    delJ.forEach(function (x) { ops.push(sbDelete("jerseys", "week_key=eq." + encodeURIComponent(x.week_key) + "&ae_id=eq." + encodeURIComponent(x.ae_id))); });
    return Promise.all(ops);
  }

  /* ---------- safe reload so incoming updates appear ---------- */
  var pendingReload = false;
  function safeToReload() {
    if (document.visibilityState !== "visible") return false;
    var ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return false;
    var modal = document.querySelector("#modal-root");
    if (modal && modal.children.length > 0) return false;
    return true;
  }
  function rememberTab() {
    try {
      var active = document.querySelector(".tabs [data-tab].active, .tabs .tab.active, [data-tab][aria-selected='true']");
      if (active) sessionStorage.setItem("pg-supa-tab", active.getAttribute("data-tab"));
    } catch (e) {}
  }
  function restoreTab() {
    try {
      var t = sessionStorage.getItem("pg-supa-tab");
      if (!t) return;
      sessionStorage.removeItem("pg-supa-tab");
      var btn = document.querySelector("[data-tab='" + t + "']");
      if (btn) btn.click();
    } catch (e) {}
  }
  function tryReload() {
    if (!pendingReload) return;
    if (safeToReload()) { rememberTab(); location.reload(); }
  }

  /* ---------- sync cycle ---------- */
  var busy = false;
  function syncOnce() {
    if (busy) return Promise.resolve();
    busy = true;
    var local = readLocal();
    var snap = readSnap();
    return pullRemote()
      .then(function (remote) {
        if (snap === null) {
          var remoteEmpty = remote.aes.length === 0 && remote.entries.length === 0 && jerseysToList(remote.jerseys).length === 0;
          if (remoteEmpty) {
            return pushRemote({ aes: [], entries: [], jerseys: {} }, local).then(function () {
              writeSnap(local);
              setOk();
            });
          }
          var adopted = { aes: remote.aes, entries: remote.entries, jerseys: remote.jerseys, settings: local.settings };
          var changed = stableData(adopted) !== stableData(local);
          writeLocal(adopted);
          writeSnap(adopted);
          setOk();
          if (changed) { pendingReload = true; tryReload(); }
          return;
        }
        var merged = mergeDB(snap, local, remote);
        var needPush = stableData(merged) !== stableData(remote);
        var needLocal = stableData(merged) !== stableData(local);
        var chain = Promise.resolve();
        if (needPush) chain = chain.then(function () { return pushRemote(remote, merged); });
        return chain.then(function () {
          writeSnap(merged);
          if (needLocal) { writeLocal(merged); pendingReload = true; tryReload(); }
          setOk();
        });
      })
      .catch(function (err) {
        setErr(String((err && err.message) || err));
      })
      .then(function () {
        busy = false;
      });
  }

  /* ---------- status bar ---------- */
  var barEl = null;
  function ensureBar() {
    if (barEl) return barEl;
    barEl = document.createElement("div");
    barEl.id = "pg-supa-bar";
    barEl.style.cssText =
      "position:fixed;left:16px;bottom:16px;z-index:9999;max-width:340px;" +
      "font:600 12.5px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
      "border-radius:12px;padding:10px 13px;box-shadow:0 10px 30px rgba(7,30,71,.28);" +
      "border:1px solid rgba(255,255,255,.5);backdrop-filter:blur(6px);";
    document.body.appendChild(barEl);
    return barEl;
  }
  function setOk() {
    var el = ensureBar();
    el.style.background = "rgba(46,204,113,.96)";
    el.style.color = "#08311c";
    el.innerHTML = "\u2705 Shared mode ON \u2014 the whole team sees one live ranking.";
  }
  function setErr(msg) {
    var el = ensureBar();
    el.style.background = "rgba(231,76,60,.96)";
    el.style.color = "#fff";
    el.innerHTML = "\u26a0\ufe0f Shared sync error: " + (msg || "unknown") + "<br><small>Saved locally; will retry.</small>";
  }

  /* ---------- one-time real roster load ---------- */
  // The official campaign roster (name, team, start date). Replaces any demo
  // data and resets standings to zero. Runs once per browser (guarded by a flag);
  // stable IDs make re-runs idempotent (no duplicates).
  var REAL_ROSTER_FLAG = "pg-real-roster-v3";
  // [name, team, manager (verifies their NBMs), start date]
  var REAL_ROSTER = [
    ["Charles Addai-Appiah", "UK", "Jason Creane", "2026-04-20"],
    ["James Farnhill", "UK", "Jason Creane", "2026-05-11"],
    ["Lauren Caska", "UK", "Jason Creane", "2026-06-01"],
    ["Dylan Chambers", "UK", "Jason Creane", "2026-06-01"],
    ["Ben Harknett", "UK", "Jason Creane", "2026-07-06"],
    ["Jack Ferrari", "UK", "Jason Creane", "2026-06-08"],
    ["Karim Chester", "UK", "Jason Creane", "2026-06-01"],
    ["Michael Hart", "UK", "Jason Creane", "2026-06-08"],
    ["Mounir Ben Saad", "France", "Benjamin Caller", "2026-04-12"],
    ["Julien Le Postec", "France", "Benjamin Caller", "2026-05-18"],
    ["Daniel Campo", "France", "Benjamin Caller", "2026-05-25"],
    ["Aurelien Aissa", "France", "Benjamin Caller", "2026-06-15"],
    ["Robert Glowacz", "Germany", "Timo Trunk", "2026-05-04"],
    ["Vincent Le Magoariec", "Switzerland", "Timo Trunk", "2026-06-01"],
    ["Sven Ehlhardt", "Germany", "Timo Trunk", "2026-07-01"],
    ["Tobias Tritscher", "Germany", "Timo Trunk", "2026-08-05"],
    ["Joerg Kassner", "Germany", "Timo Trunk", "2026-08-19"],
    ["Gino Mommers", "Netherlands", "Danny Kaptein", "2026-05-11"],
    ["Jeffrey de Roo", "Netherlands", "Danny Kaptein", "2026-06-01"],
    ["Joren de Graaf", "Netherlands", "Danny Kaptein", "2026-06-29"],
    ["Achraf Artimi", "Netherlands", "Danny Kaptein", "2026-07-06"],
    ["Sjors Bonjer", "Netherlands", "Danny Kaptein", "2026-06-29"],
    ["Mats Millnert", "Sweden", "Sia Y", "2026-05-04"],
    ["Jonathan Falk Sundman", "Sweden", "Sia Y", "2026-06-29"],
    ["Erik Rasmussen", "Sweden", "Sia Y", "2026-06-29"],
    ["Elias Almqvist", "Sweden", "Sia Y", "2026-08-03"],
    ["Sevinc Celebi", "Germany", "Kathrin Redlich", "2026-06-01"],
    ["Marcquero Ermoza", "France", "Kathrin Redlich", ""],
    ["Nicolas Chahoud", "France", "Kathrin Redlich", "2026-01-08"],
    ["Yvonne Kyri", "Germany", "Kathrin Redlich", "2026-07-01"],
    ["Pierre Phelippeau", "France", "Kathrin Redlich", ""],
    ["Pieter D'Hondt", "Netherlands", "Kathrin Redlich", "2026-07-01"],
    ["Alyssa Murre", "UK", "Kathrin Redlich", "2026-07-01"],
    ["Tom Gudgeon", "UK", "Kathrin Redlich", "2026-09-01"],
  ];
  function teamToCountryCode(team) {
    var map = { uk: "GB", "united kingdom": "GB", france: "FR", germany: "DE", switzerland: "CH", netherlands: "NL", sweden: "SE" };
    var t = String(team || "").trim().toLowerCase();
    return map[t] || String(team || "GB").trim().toUpperCase() || "GB";
  }
  function slug(name) {
    return "ae-" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function buildRealRoster() {
    return REAL_ROSTER.map(function (row) {
      return { id: slug(row[0]), name: row[0], country: teamToCountryCode(row[1]), region: row[1], rvp: row[2] || "", startDate: row[3] || "", photoUrl: "" };
    });
  }
  // One-time per-browser roster seed: the real roster becomes the local source
  // of truth (clearing demo data locally and in stale store keys). It does NOT
  // wipe server data — shared NBM entries/jerseys are preserved and adopted via
  // the next sync. Stable IDs keep the AE upsert idempotent (no duplicates).
  function resetRealRosterOnce() {
    try { if (localStorage.getItem(REAL_ROSTER_FLAG)) return false; } catch (e) { return false; }
    var local = readLocal();
    cleanupStaleKeys();
    try { localStorage.removeItem(SNAP_KEY); } catch (e) {}
    writeLocal({ aes: buildRealRoster(), entries: [], jerseys: {}, settings: local.settings });
    try { localStorage.setItem(REAL_ROSTER_FLAG, "1"); } catch (e) {}
    return true;
  }
  // Seed the real roster onto the server WITHOUT destroying shared competition
  // data. This runs once per browser after a roster reset, so it must never
  // delete nbm_entries or jerseys — otherwise every new AE that opens the app
  // would wipe everyone else's logged NBMs. We only upsert the roster AEs; the
  // next sync's 3-way merge then adopts the server's existing entries/jerseys
  // back into this browser.
  function forceReplaceRemote() {
    var local = readLocal();
    var ops = [];
    if (local.aes.length) ops.push(sbUpsert("aes", local.aes.map(aeToRow)));
    return Promise.all(ops).then(function () {
      // Snapshot the roster-only local state. Because this snapshot has no
      // entries/jerseys, the very next mergeDB() treats the server's rows as
      // "added remotely" and pulls them in instead of deleting them.
      writeSnap(local);
    });
  }

  // Stamp managers into the locally stored DB immediately (so app.js, which reads
  // localStorage directly, shows them on the very next render).
  function backfillLocalManagers() {
    try {
      var raw = localStorage.getItem(storeKey());
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      var before = JSON.stringify(((parsed && parsed.aes) || []).map(function (a) { return (a && a.rvp) || ""; }));
      var stamped = normalize(parsed);
      var after = JSON.stringify(stamped.aes.map(function (a) { return a.rvp || ""; }));
      if (before !== after) { writeLocal(stamped); return true; }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  /* ---------- boot ---------- */
  function start() {
    ensureBar();
    restoreTab();
    cleanupStaleKeys();
    var didReset = resetRealRosterOnce();
    var stamped = backfillLocalManagers();
    if (didReset) {
      forceReplaceRemote()
        .then(function () { setOk(); pendingReload = true; tryReload(); })
        .catch(function (err) { setErr(String((err && err.message) || err)); pendingReload = true; tryReload(); });
    } else {
      if (stamped) { pendingReload = true; tryReload(); }
      syncOnce();
    }
    setInterval(syncOnce, POLL_MS);
    document.addEventListener("visibilitychange", tryReload);
    window.addEventListener("focus", tryReload);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
