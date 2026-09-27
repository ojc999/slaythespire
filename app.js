/* Spire 2 Guide — plain JavaScript, no build step.
 * Game data lives in registry/*.json; this file only renders it.
 * Troubleshooting: errors are logged to the Info page (Diagnostics) and to the browser console.
 */
(function () {
  "use strict";

  var APP_VERSION = "1.1.0";
  var KEYS = { run: "sts2.run", notes: "sts2.notes", log: "sts2.log" };
  var LOG_MAX = 50;

  // ---------- Logging ----------
  // Every error is kept (last 50) so it can be copied from the Info page.
  function log(level, msg, detail) {
    var entry = { t: new Date().toISOString(), level: level, msg: String(msg), detail: detail ? String(detail) : "" };
    (level === "error" ? console.error : console.log)("[sts2]", entry.msg, entry.detail);
    var list = store.get(KEYS.log, []);
    list.push(entry);
    store.set(KEYS.log, list.slice(-LOG_MAX));
  }
  window.addEventListener("error", function (e) {
    log("error", e.message || "Script error", (e.filename || "") + ":" + (e.lineno || "") + " " + (e.error && e.error.stack || ""));
  });
  window.addEventListener("unhandledrejection", function (e) {
    log("error", "Unhandled promise rejection", e.reason && (e.reason.stack || e.reason));
  });

  // ---------- Storage (guarded: private mode or blocked storage must not break the app) ----------
  var memory = {};
  var store = {
    ok: true,
    get: function (k, fallback) {
      try {
        var raw = localStorage.getItem(k);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        store.ok = false;
        return k in memory ? memory[k] : fallback;
      }
    },
    set: function (k, v) {
      memory[k] = v;
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { store.ok = false; }
    },
    remove: function (k) {
      delete memory[k];
      try { localStorage.removeItem(k); } catch (e) { store.ok = false; }
    }
  };

  // ---------- State ----------
  var DATA = null; // { meta, characters, maps, enemies, byId }
  // Per-act choices: maps and bosses are keyed by act number.
  function blankRun() { return { character: null, act: 1, maps: {}, bosses: {}, asc: 0, trackers: {} }; }
  var run = Object.assign(blankRun(), store.get(KEYS.run, {}));
  // Migrate runs saved by v1.0 (single Act 1 map and boss).
  if (run.map) { run.maps[1] = run.map; delete run.map; }
  if (run.boss) { run.bosses[1] = run.boss; delete run.boss; }
  function saveRun() { store.set(KEYS.run, run); }

  // ---------- Helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(sel) { return document.querySelector(sel); }
  function app() { return document.getElementById("app"); }
  function toast(msg) {
    var el = document.createElement("div");
    el.className = "toast"; el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1800);
  }
  var KIND_LABEL = { hallway: "Hallway", elite: "Elite", boss: "Boss", minion: "Summon" };
  var INTENT_LABEL = {
    attack: "Attack", block: "Block", buff: "Buff", debuff: "Debuff", status: "Status cards",
    summon: "Summon", stun: "Stunned", sleep: "Asleep", heal: "Heal", escape: "Escape", none: "Nothing"
  };
  function wikiUrl(page) { return "https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:" + encodeURIComponent(page); }
  function badge(kind) {
    return '<span class="badge ' + esc(kind) + '">' + esc(KIND_LABEL[kind] || kind) + "</span>";
  }
  function enemyLink(id, extra) {
    var e = DATA.byId[id];
    if (!e) { log("error", "Unknown enemy id in link", id); return ""; }
    return '<a class="enemy-link" href="#/enemy/' + esc(id) + '"><span>' + esc(e.name) +
      (e.confidence === "check" ? ' <span class="badge check">check</span>' : "") +
      '</span><span class="meta">' + esc(extra || (e.hp + " HP")) + "</span></a>";
  }
  function ascValue(base, asc) {
    // Shows the value that applies at the player's ascension, with the other one greyed out.
    if (!asc) return esc(base);
    // Ascension text often changes only the numbers (e.g. "30 damage"), so the base text stays readable.
    if (run.asc >= asc.a) {
      return esc(base) + ' <span class="asc-on">→ A' + asc.a + "+: " + esc(asc.v) + "</span>";
    }
    return esc(base) + ' <span class="asc-off">(A' + asc.a + "+: " + esc(asc.v) + ")</span>";
  }
  function bullets(items) {
    if (!items || !items.length) return "";
    return '<ul class="bullets">' + items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
  }

  // ---------- Turn-cycle logic ----------
  // Returns what an enemy does on a given turn of a phase.
  // opener moves play once in order; then either a fixed cycle repeats, or a random pick is made.
  function moveAt(phase, turn, startMoveId) {
    var opener = phase.opener || [];
    if (turn <= opener.length) return { kind: "fixed", ids: [opener[turn - 1]] };
    var k = turn - opener.length - 1;
    var cycle = phase.cycle || [];
    if (cycle.length) {
      var offset = 0;
      if (startMoveId && !opener.length) {
        var i = cycle.indexOf(startMoveId);
        if (i >= 0) offset = i;
      }
      return { kind: "fixed", ids: [cycle[(k + offset) % cycle.length]] };
    }
    if (phase.random && phase.random.length) {
      return { kind: "random", ids: phase.random.map(function (r) { return r.move; }), weights: phase.random };
    }
    return { kind: "end", ids: [] };
  }

  // ---------- Views ----------
  function mapsForAct(act) { return DATA.maps.filter(function (x) { return x.act === act; }); }
  function currentMap() {
    var list = mapsForAct(run.act);
    // Acts with a single map need no choice.
    if (list.length === 1) return list[0];
    var id = run.maps[run.act];
    return list.find(function (x) { return x.id === id; }) || null;
  }
  function chip(id, label, pressed) {
    return '<button type="button" class="chip" data-id="' + esc(id) + '" aria-pressed="' + pressed + '">' + esc(label) + "</button>";
  }

  function viewHome() {
    var acts = DATA.maps.map(function (x) { return x.act; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort();
    if (acts.indexOf(run.act) < 0) run.act = acts[0];
    var actMaps = mapsForAct(run.act);
    var m = currentMap();
    var ch = run.character && DATA.characters.find(function (x) { return x.id === run.character; });
    var boss = run.bosses[run.act] || null;
    var h = [];

    h.push('<section class="card stack"><h1>This run</h1>');
    h.push('<div><div class="small muted">Character</div><div class="chips" id="pick-char">' +
      DATA.characters.map(function (c) { return chip(c.id, c.name, run.character === c.id); }).join("") + "</div></div>");
    h.push('<div><div class="small muted">Act</div><div class="chips" id="pick-act">' +
      acts.map(function (a) { return chip(String(a), "Act " + a, run.act === a); }).join("") + "</div></div>");
    if (actMaps.length > 1) {
      h.push('<div><div class="small muted">Act ' + run.act + ' map</div><div class="chips" id="pick-map">' +
        actMaps.map(function (x) { return chip(x.id, x.name, !!m && m.id === x.id); }).join("") + "</div></div>");
    }
    h.push('<div class="row"><label for="asc" class="small muted">Ascension</label>' +
      '<select id="asc">' + Array.from({ length: 11 }, function (_, i) {
        return '<option value="' + i + '"' + (run.asc === i ? " selected" : "") + ">" + i + "</option>";
      }).join("") + "</select></div>");
    h.push("</section>");

    if (!m) {
      h.push('<p class="muted">Pick the map to see its enemies, elites and bosses. You can tell which map you are on from the first screen of the act.</p>');
      app().innerHTML = h.join("");
      bindHome();
      return;
    }

    h.push('<h2>Act ' + m.act + ": " + esc(m.name) + "</h2>");

    // Boss
    h.push('<section class="card"><h2>Boss</h2><p class="small muted">The boss is shown at the top of the map. Tap it here to pin it.</p>');
    h.push('<div class="chips" id="pick-boss">' + m.bosses.map(function (id) {
      return chip(id, DATA.byId[id].name, boss === id);
    }).join("") + "</div>");
    var bossIds = boss ? [boss] : m.bosses;
    h.push('<ul class="list">' + bossIds.map(function (id) {
      var b = DATA.byId[id];
      return "<li>" + enemyLink(id) + '<div class="small muted">' + esc(b.threat && b.threat[0]) + "</div></li>";
    }).join("") + "</ul></section>");

    // Elites
    h.push('<section class="card"><h2>Elites (one of these per elite room)</h2><ul class="list">' + m.elites.map(function (id) {
      var e = DATA.byId[id];
      return "<li>" + enemyLink(id) + '<div class="small muted">' + esc(e.threat && e.threat[0]) + "</div></li>";
    }).join("") + "</ul></section>");

    // Hallway
    function pool(title, list, note) {
      if (!list || !list.length) return "";
      return '<section class="card"><h2>' + esc(title) + "</h2>" + (note ? '<p class="small muted">' + esc(note) + "</p>" : "") +
        list.map(function (enc) {
          return '<details class="enc"><summary>' + esc(enc.name) + "</summary>" +
            (enc.note ? '<div class="small muted">' + esc(enc.note) + "</div>" : "") +
            '<ul class="list">' + enc.enemies.map(function (id) { return "<li>" + enemyLink(id) + "</li>"; }).join("") + "</ul></details>";
        }).join("") + "</section>";
    }
    var n = m.weakCount || 3;
    h.push(pool("Hallway: first " + n + " fights", m.weakPool, "The first " + n + " fights of the act come from this easier pool."));
    h.push(pool("Hallway: rest of the act", m.normalPool));
    h.push(pool("Event fights", m.events));

    // Act overview
    h.push('<section class="card"><h2>What ' + esc(m.name) + " tests</h2>" + bullets(m.tests) + bullets(m.rules) +
      '<p class="small muted">' + esc(m.rooms) + "</p></section>");

    if (ch) {
      var notes = (ch.acts && ch.acts[String(m.act)]) || [];
      h.push('<section class="card"><h2>' + esc(ch.name) + " in Act " + m.act + '</h2><p class="small muted">' + esc(ch.mechanic) + "</p>" +
        (notes.length ? bullets(notes) : '<p class="muted">No notes for this act yet.</p>') + "</section>");
    }

    app().innerHTML = h.join("");
    bindHome();
  }

  function bindHome() {
    function onChip(sel, fn) {
      var el = $(sel);
      if (!el) return;
      el.addEventListener("click", function (ev) {
        var b = ev.target.closest("button[data-id]");
        if (!b) return;
        fn(b.getAttribute("data-id"));
        saveRun();
        render();
      });
    }
    onChip("#pick-char", function (id) { run.character = run.character === id ? null : id; });
    onChip("#pick-act", function (id) { run.act = Number(id); });
    onChip("#pick-map", function (id) {
      if (run.maps[run.act] !== id) delete run.bosses[run.act];
      run.maps[run.act] = id;
    });
    onChip("#pick-boss", function (id) {
      if (run.bosses[run.act] === id) delete run.bosses[run.act]; else run.bosses[run.act] = id;
    });
    var asc = $("#asc");
    if (asc) asc.addEventListener("change", function () { run.asc = Number(asc.value) || 0; saveRun(); });
  }

  function viewEnemy(id) {
    var e = DATA.byId[id];
    if (!e) {
      app().innerHTML = '<p>Enemy not found: ' + esc(id) + '</p><p><a href="#/">Back</a></p>';
      log("error", "Enemy not found", id);
      return;
    }
    var moves = {};
    e.moves.forEach(function (mv) { moves[mv.id] = mv; });
    var t = run.trackers[id] || { phase: 0, turn: 1, start: e.starts ? e.starts[0].at : null };
    if (t.phase >= e.phases.length) t.phase = 0;
    var phase = e.phases[t.phase];
    var h = [];

    h.push('<p class="small"><a href="javascript:history.back()">‹ Back</a></p>');
    h.push("<h1>" + esc(e.name) + " " + badge(e.kind) + "</h1>");
    h.push('<p><b>HP</b> ' + ascValue(e.hp, e.hpAsc) + "</p>");
    if (e.confidence === "check") {
      h.push('<div class="card"><span class="badge check">check in game</span> ' + esc(e.checkNote) + "</div>");
    }
    if (e.powers && e.powers.length) {
      h.push('<div class="card"><h3>Powers</h3>' + e.powers.map(function (p) {
        return "<p><b>" + esc(p.name) + "</b> — " + esc(p.text) + "</p>";
      }).join("") + "</div>");
    }

    // Turn tracker
    h.push('<section class="tracker" id="tracker">');
    h.push('<div class="row small">');
    if (e.phases.length > 1) {
      h.push('<label>Phase <select id="t-phase">' + e.phases.map(function (p, i) {
        return '<option value="' + i + '"' + (i === t.phase ? " selected" : "") + ">" + esc(p.name) + "</option>";
      }).join("") + "</select></label>");
    }
    if (e.starts && t.phase === 0) {
      h.push('<label>Which one <select id="t-start">' + e.starts.map(function (s) {
        return '<option value="' + esc(s.at) + '"' + (s.at === t.start ? " selected" : "") + ">" + esc(s.label) + "</option>";
      }).join("") + "</select></label>");
    }
    h.push("</div>");
    var now = moveAt(phase, t.turn, t.phase === 0 ? t.start : null);
    h.push('<div class="small muted">' + (e.phases.length > 1 ? esc(phase.name) + " · " : "") + "Turn " + t.turn + "</div>");
    h.push('<div class="now">' + describe(now, moves) + "</div>");
    if (phase.trigger) h.push('<div class="small muted">Starts when: ' + esc(phase.trigger) + "</div>");
    // Next few turns, so the big hits can be seen coming.
    var strip = [];
    for (var n = Math.max(1, t.turn - 1); n < Math.max(1, t.turn - 1) + 7; n++) {
      var a = moveAt(phase, n, t.phase === 0 ? t.start : null);
      if (a.kind === "end") break;
      var label = a.kind === "random" ? "Random" : moves[a.ids[0]].name;
      var cls = a.kind === "random" ? "other" : moves[a.ids[0]].intent;
      strip.push('<div class="t' + (n === t.turn ? " current" : "") + '"><b>T' + n + '</b><span class="intent intent-' + esc(cls) + '">' + esc(label) + "</span></div>");
    }
    h.push('<div class="timeline" aria-label="Upcoming turns">' + strip.join("") + "</div>");
    h.push('<div class="controls"><button type="button" id="t-prev">− Turn</button><button type="button" id="t-reset">Reset</button><button type="button" id="t-next" class="primary">Next turn</button></div>');
    h.push("</section>");

    // Pattern rules
    h.push('<section class="card"><h2>Turn cycle</h2>');
    e.phases.forEach(function (p) {
      if (e.phases.length > 1) h.push("<h3>" + esc(p.name) + "</h3>");
      h.push(bullets(p.rules));
    });
    h.push('<p><b>Scaling:</b> ' + esc(e.scaling) + "</p></section>");

    // Moves
    h.push('<section class="card"><h2>Moves</h2><table class="moves"><tbody>' + e.moves.map(function (mv) {
      return '<tr><td><b>' + esc(mv.name) + '</b><br><span class="small intent intent-' + esc(mv.intent) + '">' + esc(INTENT_LABEL[mv.intent] || mv.intent) +
        "</span></td><td>" + ascValue(mv.text, mv.asc) + "</td></tr>";
    }).join("") + "</tbody></table></section>");

    // What it punishes, and tips
    h.push('<section class="card"><h2>What to know</h2>' + bullets(e.threat));
    var tips = e.tips || {};
    if (tips.general) h.push("<h3>General</h3>" + bullets(tips.general));
    if (run.character) {
      var cname = (DATA.characters.find(function (c) { return c.id === run.character; }) || {}).name;
      if (tips[run.character]) h.push("<h3>" + esc(cname) + "</h3>" + bullets(tips[run.character]));
    } else if (Object.keys(tips).some(function (k) { return k !== "general"; })) {
      h.push('<p class="small muted">Pick your character on the home screen to see character-specific notes.</p>');
    }
    h.push("</section>");

    if (e.companions && e.companions.length) {
      h.push('<section class="card"><h2>Fights alongside / summons</h2><ul class="list">' +
        e.companions.map(function (c) { return "<li>" + enemyLink(c) + "</li>"; }).join("") + "</ul></section>");
    }

    var notes = store.get(KEYS.notes, {});
    h.push('<section class="card"><h2>My notes</h2><textarea id="notes" placeholder="Anything you noticed in game — kept across runs.">' +
      esc(notes[id] || "") + '</textarea><p class="small muted" id="notes-status"></p></section>');

    h.push('<p class="small muted">Source: <a href="' + wikiUrl(e.wiki) + '" target="_blank" rel="noopener">wiki page</a> · data for ' +
      esc(DATA.meta.gamePatch) + "</p>");

    app().innerHTML = h.join("");

    function saveTracker() { run.trackers[id] = t; saveRun(); viewEnemy(id); }
    $("#t-next").addEventListener("click", function () { t.turn += 1; saveTracker(); });
    $("#t-prev").addEventListener("click", function () { t.turn = Math.max(1, t.turn - 1); saveTracker(); });
    $("#t-reset").addEventListener("click", function () { t.turn = 1; t.phase = 0; saveTracker(); });
    var ps = $("#t-phase");
    if (ps) ps.addEventListener("change", function () { t.phase = Number(ps.value); t.turn = 1; saveTracker(); });
    var ss = $("#t-start");
    if (ss) ss.addEventListener("change", function () { t.start = ss.value; t.turn = 1; saveTracker(); });
    var ta = $("#notes");
    var timer;
    ta.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var all = store.get(KEYS.notes, {});
        if (ta.value.trim()) all[id] = ta.value; else delete all[id];
        store.set(KEYS.notes, all);
        $("#notes-status").textContent = store.ok ? "Saved." : "Could not save — browser storage is blocked.";
      }, 400);
    });
  }

  function describe(a, moves) {
    if (a.kind === "end") return '<span class="muted">No further moves in this phase.</span>';
    if (a.kind === "random") {
      return '<span class="intent intent-other">Random:</span> ' + a.weights.map(function (w) {
        var mv = moves[w.move];
        return '<span class="intent intent-' + esc(mv.intent) + '">' + esc(mv.name) + "</span> " + w.w + "%";
      }).join(" · ") + '<div class="small muted">See the rules below for restrictions.</div>';
    }
    var mv = moves[a.ids[0]];
    return '<span class="intent intent-' + esc(mv.intent) + '">' + esc(mv.name) + "</span> — " + ascValue(mv.text, mv.asc);
  }

  function viewSearch() {
    app().innerHTML = '<h1>Find an enemy</h1><input id="q" type="search" placeholder="Type a name…" autocomplete="off" style="width:100%">' +
      '<ul class="list" id="results"></ul>';
    var q = $("#q");
    function show() {
      var term = q.value.trim().toLowerCase();
      var list = DATA.enemies.filter(function (e) {
        var cm = currentMap();
        if (cm && e.maps.indexOf(cm.id) < 0 && !term) return false;
        return !term || e.name.toLowerCase().indexOf(term) >= 0;
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      $("#results").innerHTML = list.map(function (e) {
        var mapNames = e.maps.map(function (id) { return (DATA.maps.find(function (m) { return m.id === id; }) || {}).name; }).join(", ");
        return "<li>" + enemyLink(e.id, (KIND_LABEL[e.kind] || e.kind) + " · " + mapNames) + "</li>";
      }).join("") || '<li class="muted" style="padding:10px 0">No match.</li>';
    }
    q.addEventListener("input", show);
    show();
    q.focus();
  }

  function viewInfo() {
    var m = DATA.meta;
    var flagged = DATA.enemies.filter(function (e) { return e.confidence === "check"; });
    var logs = store.get(KEYS.log, []);
    var diag = [
      "App version: " + APP_VERSION,
      "Registry version: " + m.registryVersion,
      "Game patch: " + m.gamePatch,
      "Storage available: " + store.ok,
      "Service worker: " + ("serviceWorker" in navigator ? (navigator.serviceWorker.controller ? "active" : "registered, not yet controlling") : "not supported"),
      "Online: " + navigator.onLine,
      "User agent: " + navigator.userAgent,
      "Run: " + JSON.stringify({ character: run.character, act: run.act, maps: run.maps, bosses: run.bosses, asc: run.asc }),
      "",
      "Log (" + logs.length + "):"
    ].concat(logs.map(function (l) { return l.t + " " + l.level.toUpperCase() + " " + l.msg + (l.detail ? " | " + l.detail : ""); }));

    app().innerHTML =
      "<h1>About the data</h1>" +
      '<div class="card"><p><b>Game patch:</b> ' + esc(m.gamePatch) + "<br><b>Last reviewed:</b> " + esc(m.lastReviewed) +
      "<br><b>Registry version:</b> " + esc(m.registryVersion) + "</p>" + bullets(m.notes) + "</div>" +
      '<div class="card"><h2>Flagged for checking in game</h2><ul class="list">' +
      (flagged.map(function (e) { return "<li>" + enemyLink(e.id, "check") + '<div class="small muted">' + esc(e.checkNote) + "</div></li>"; }).join("") || "<li>None</li>") +
      "</ul></div>" +
      '<div class="card"><h2>My notes backup</h2><p class="small muted">Notes live only in this browser. Clearing site data deletes them — export now and then.</p>' +
      '<div class="row"><button type="button" id="export">Export notes</button><button type="button" id="import">Import notes</button>' +
      '<input type="file" id="import-file" accept="application/json" hidden></div></div>' +
      '<div class="card"><h2>Diagnostics</h2><p class="small muted">If something breaks, copy this and send it over.</p>' +
      '<pre class="log" id="diag">' + esc(diag.join("\n")) + "</pre>" +
      '<div class="row"><button type="button" id="copy-diag">Copy</button><button type="button" id="clear-log">Clear log</button>' +
      '<button type="button" id="update-app">Check for update</button></div></div>';

    $("#copy-diag").addEventListener("click", function () {
      var text = $("#diag").textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { toast("Copied"); }, function () { toast("Copy failed — select the text instead"); });
      } else { toast("Select the text to copy"); }
    });
    $("#clear-log").addEventListener("click", function () { store.remove(KEYS.log); viewInfo(); });
    $("#update-app").addEventListener("click", function () {
      if (!navigator.onLine) { toast("You are offline"); return; }
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.getRegistration().then(function (r) { return r && r.update(); })
          .then(function () { location.reload(); });
      } else { location.reload(); }
    });
    $("#export").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify({ app: "sts2-guide", exported: new Date().toISOString(), notes: store.get(KEYS.notes, {}) }, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sts2-notes-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    $("#import").addEventListener("click", function () { $("#import-file").click(); });
    $("#import-file").addEventListener("change", function (ev) {
      var f = ev.target.files[0];
      if (!f) return;
      f.text().then(function (txt) {
        var parsed = JSON.parse(txt);
        if (!parsed || typeof parsed.notes !== "object") throw new Error("File has no notes section");
        var merged = Object.assign(store.get(KEYS.notes, {}), parsed.notes);
        store.set(KEYS.notes, merged);
        toast("Imported " + Object.keys(parsed.notes).length + " notes");
      }).catch(function (e) { log("error", "Notes import failed", e); toast("Import failed: " + e.message); });
    });
  }

  // ---------- Router ----------
  function render() {
    if (!DATA) return;
    var hash = location.hash.replace(/^#\/?/, "");
    var parts = hash.split("/");
    try {
      if (parts[0] === "enemy" && parts[1]) viewEnemy(decodeURIComponent(parts[1]));
      else if (parts[0] === "search") viewSearch();
      else if (parts[0] === "info") viewInfo();
      else viewHome();
    } catch (e) {
      log("error", "Render failed for #" + hash, e.stack || e);
      app().innerHTML = '<div class="card"><h2>Something went wrong</h2><p>' + esc(e.message) +
        '</p><p><a href="#/info">Open diagnostics</a> · <a href="#/">Home</a></p></div>';
    }
    if (parts[0] !== "enemy") window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); });

  // ---------- New run ----------
  document.getElementById("new-run").addEventListener("click", function () {
    var dlg = document.getElementById("confirm-dialog");
    if (typeof dlg.showModal !== "function") {
      if (confirm("Start a new run? This clears character, map, boss and turn counters. Notes are kept.")) resetRun();
      return;
    }
    dlg.returnValue = "";
    dlg.showModal();
    dlg.addEventListener("close", function onClose() {
      dlg.removeEventListener("close", onClose);
      if (dlg.returnValue === "ok") resetRun();
    });
  });
  function resetRun() {
    run = blankRun();
    saveRun();
    log("info", "New run started");
    location.hash = "#/";
    render();
    toast("New run started");
  }

  // ---------- Boot ----------
  function fetchJson(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " returned HTTP " + r.status);
      return r.json().catch(function (e) { throw new Error(path + " is not valid JSON: " + e.message); });
    });
  }
  Promise.all([
    fetchJson("registry/meta.json"),
    fetchJson("registry/characters.json"),
    fetchJson("registry/maps.json"),
    fetchJson("registry/enemies.json")
  ]).then(function (res) {
    DATA = { meta: res[0], characters: res[1], maps: res[2], enemies: res[3], byId: {} };
    DATA.enemies.forEach(function (e) { DATA.byId[e.id] = e; });
    render();
  }).catch(function (e) {
    log("error", "Could not load game data", e.stack || e);
    app().innerHTML = '<div class="card"><h2>Could not load the game data</h2><p>' + esc(e.message) + "</p>" +
      '<p class="small muted">If you opened index.html directly as a file, this is expected — it must be served from a web address (see README). ' +
      "If you are online, try reloading.</p></div>";
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(function (e) { log("error", "Service worker registration failed", e); });
  }
})();
