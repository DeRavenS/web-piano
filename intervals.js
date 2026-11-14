// ===========================================================================
// intervals.js — interval ear training: hear two notes, name the interval.
//   * Melodic (up / down / mixed) or harmonic (together) intervals, any subset
//     of minor 2nd .. octave, from a fixed or random starting note.
//   * Wrong guesses can be retried; only first-try answers score.
//   * Per-interval accuracy for the session, plus all-time totals per browser.
// ===========================================================================

const IntervalTrainer = (() => {
  const $ = (id) => document.getElementById(id);
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

  const INTERVALS = [
    { s: 1, short: "m2", name: "Minor 2nd" },
    { s: 2, short: "M2", name: "Major 2nd" },
    { s: 3, short: "m3", name: "Minor 3rd" },
    { s: 4, short: "M3", name: "Major 3rd" },
    { s: 5, short: "P4", name: "Perfect 4th" },
    { s: 6, short: "TT", name: "Tritone" },
    { s: 7, short: "P5", name: "Perfect 5th" },
    { s: 8, short: "m6", name: "Minor 6th" },
    { s: 9, short: "M6", name: "Major 6th" },
    { s: 10, short: "m7", name: "Minor 7th" },
    { s: 11, short: "M7", name: "Major 7th" },
    { s: 12, short: "P8", name: "Octave" },
  ];
  const byS = new Map(INTERVALS.map((iv) => [iv.s, iv]));
  const PRESETS = {
    simple: [4, 7, 12],
    diatonic: [2, 4, 5, 7, 9, 11, 12],
    all: INTERVALS.map((iv) => iv.s),
  };
  const NOTE_SECONDS = { slow: 1.1, medium: 0.75, fast: 0.45 };
  const HOTKEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
  const FIXED_NOTE = 60;           // C4
  const LOWEST = 48, HIGHEST = 72; // random notes stay within C3..C5

  // ---- Persistence (per-browser conveniences only) -------------------------
  const KEY = "webpiano.intervals.v1";
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } };
  const stored = load(KEY, {});
  const settings = Object.assign({
    enabled: PRESETS.diatonic, dir: "asc", speed: "medium", count: 20, fixedRoot: false, autoNext: false,
  }, stored.settings);
  const allTime = stored.allTime || {}; // semitones -> { heard, right }
  const persist = () => save(KEY, { settings, allTime });

  // ---- DOM -----------------------------------------------------------------
  const el = $("intervalTrainer");
  const choicesEl = $("ivChoices");
  const playBtn = $("ivPlay");
  const nextBtn = $("ivNext");
  const endBtn = $("ivEnd");
  const promptEl = $("ivPrompt");
  const resultsEl = $("ivResults");
  const presetSel = $("ivPreset");
  const chipsEl = $("ivChips");
  const dirSel = $("ivDir");
  const speedSel = $("ivSpeed");
  const countSel = $("ivCount");
  const fixedCb = $("ivFixed");
  const autoCb = $("ivAuto");
  const ro = { progress: $("ivProgress"), progressDetail: $("ivProgressDetail"), score: $("ivScore"), scoreDetail: $("ivScoreDetail"), streak: $("ivStreak"), streakDetail: $("ivStreakDetail") };

  // ---- State ---------------------------------------------------------------
  let active = false;
  let session = null; // { done, asked, firstTry, streak, bestStreak, per: { s: { heard, right } } }
  let q = null;       // { s, dir, a, b, answered, missed, tried: Set }
  let voices = [];
  let nextTimer = null;

  const enabled = () => settings.enabled.slice().sort((a, b) => a - b);
  const done = () => session && settings.count > 0 && session.asked >= settings.count;

  // =========================================================================
  // Sound
  // =========================================================================
  function stopSound() {
    const t = AudioEngine.now();
    for (const v of voices) v.stop(t);
    voices = [];
  }

  async function playPair(a, b, harmonic) {
    await AudioEngine.resume();
    stopSound();
    const inst = PianoUI.instrument();
    const d = NOTE_SECONDS[settings.speed];
    const t = AudioEngine.now() + 0.05;
    if (harmonic) {
      const v1 = AudioEngine.play(inst, a, t, { gain: 0.7 });
      const v2 = AudioEngine.play(inst, b, t, { gain: 0.7 });
      v1.stop(t + d * 1.8); v2.stop(t + d * 1.8);
      voices.push(v1, v2);
    } else {
      const v1 = AudioEngine.play(inst, a, t);
      v1.stop(t + d);
      const v2 = AudioEngine.play(inst, b, t + d);
      v2.stop(t + 2 * d);
      voices.push(v1, v2);
    }
  }

  // The second note of interval s from `first`, in direction dir.
  const partner = (first, s, dir) => (dir === "desc" ? first - s : first + s);

  // =========================================================================
  // Quiz flow
  // =========================================================================
  function newQuestion() {
    const pool = enabled();
    let s;
    do { s = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && q && s === q.s);
    const dir = settings.dir === "mixed" ? (Math.random() < 0.5 ? "asc" : "desc") : settings.dir;
    let first;
    if (settings.fixedRoot) first = FIXED_NOTE;
    else if (dir === "desc") first = LOWEST + s + Math.floor(Math.random() * (HIGHEST - LOWEST - s + 1));
    else first = LOWEST + Math.floor(Math.random() * (HIGHEST - LOWEST - s + 1));
    q = { s, dir, a: first, b: partner(first, s, dir), answered: false, missed: false, tried: new Set() };
  }

  function start() {
    session = { done: false, asked: 0, firstTry: 0, streak: 0, bestStreak: 0, per: {} };
    resultsEl.hidden = true;
    next();
  }

  function next() {
    clearTimeout(nextTimer);
    if (!session || session.done) return;
    if (done()) { finish(); return; }
    newQuestion();
    PianoUI.markNotes([]);
    render();
    replay();
  }

  function replay() {
    if (q) playPair(q.a, q.b, q.dir === "harm");
  }

  function answer(s) {
    if (!q || q.answered) return;
    if (s !== q.s) {
      q.missed = true;
      q.tried.add(s);
      promptEl.textContent = `Not a ${byS.get(s).name.toLowerCase()} — listen again and try another.`;
      render(false);
      return;
    }
    q.answered = true;
    record(q.s, !q.missed);
    const iv = byS.get(q.s);
    const how = q.dir === "harm" ? "together" : q.dir === "desc" ? "down" : "up";
    promptEl.innerHTML = `${q.missed ? "Got it" : "✅ Correct"} — <b>${iv.name}</b> (${q.s} semitone${q.s > 1 ? "s" : ""}), ` +
      `${noteName(q.a)} → ${noteName(q.b)} ${how}.`;
    PianoUI.markNotes([q.a, q.b]);
    render(false);
    if (done()) nextTimer = setTimeout(finish, 1200);
    else if (settings.autoNext) nextTimer = setTimeout(next, 1300);
  }

  function record(s, right) {
    session.asked++;
    const p = session.per[s] ??= { heard: 0, right: 0 };
    p.heard++;
    const a = allTime[s] ??= { heard: 0, right: 0 };
    a.heard++;
    if (right) {
      p.right++; a.right++;
      session.firstTry++;
      session.streak++;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
    } else {
      session.streak = 0;
    }
    persist();
  }

  function finish() {
    clearTimeout(nextTimer);
    if (!session) return;
    session.done = true;
    stopSound();
    q = null;
    PianoUI.markNotes([]);
    showResults();
    render();
  }

  // =========================================================================
  // Rendering
  // =========================================================================
  const pct = (right, heard) => (heard ? Math.round((100 * right) / heard) + "%" : "—");

  function renderChoices() {
    choicesEl.innerHTML = "";
    enabled().forEach((s, i) => {
      const iv = byS.get(s);
      const wrap = document.createElement("div");
      wrap.className = "iv-choice";
      wrap.dataset.s = s;
      const ans = document.createElement("button");
      ans.type = "button";
      ans.className = "iv-answer";
      ans.innerHTML = `<span class="iv-key">${HOTKEYS[i]}</span><b>${iv.name}</b><small>${iv.short} · ${s} st</small>`;
      ans.addEventListener("click", () => answer(s));
      const hear = document.createElement("button");
      hear.type = "button";
      hear.className = "iv-hear secondary";
      hear.textContent = "▶";
      hear.title = `Hear a ${iv.name.toLowerCase()}`;
      hear.setAttribute("aria-label", hear.title);
      hear.addEventListener("click", () => hearExample(s));
      wrap.append(ans, hear);
      choicesEl.append(wrap);
    });
  }

  // Comparing is allowed between questions and once the answer is known.
  function hearExample(s) {
    if (q && !q.answered) return;
    const dir = q ? q.dir : settings.dir === "mixed" ? "asc" : settings.dir;
    const first = q ? q.a : FIXED_NOTE;
    playPair(first, partner(first, s, dir), dir === "harm");
  }

  function render(resetPrompt = true) {
    const asking = q && !q.answered;
    for (const wrap of choicesEl.children) {
      const s = parseInt(wrap.dataset.s, 10);
      const ans = wrap.firstChild, hear = wrap.lastChild;
      ans.classList.toggle("wrong", !!q && q.tried.has(s));
      ans.classList.toggle("right", !!q && q.answered && s === q.s);
      ans.disabled = !asking || q.tried.has(s);
      hear.disabled = !!asking;
    }

    const running = session && !session.done;
    playBtn.textContent = running && q ? "🔁 Replay" : "▶ Start";
    nextBtn.disabled = !(q && q.answered);
    endBtn.hidden = !running;
    if (resetPrompt) {
      promptEl.textContent = running
        ? "Which interval was that?"
        : "Press Start (or Space) to hear two notes, then pick the interval. Use ▶ to hear any interval first.";
    }

    const total = settings.count > 0 ? settings.count : null;
    if (session) {
      ro.progress.textContent = total ? `${Math.min(session.asked + (q && !q.answered ? 1 : 0), total)} / ${total}` : String(session.asked);
      ro.progressDetail.textContent = session.done ? "finished" : total ? "question" : "endless session";
      ro.score.textContent = session.asked ? pct(session.firstTry, session.asked) : "—";
      ro.scoreDetail.textContent = `${session.firstTry} of ${session.asked} first try`;
      ro.streak.textContent = String(session.streak);
      ro.streakDetail.textContent = `best ${session.bestStreak}`;
    } else {
      ro.progress.textContent = ro.score.textContent = ro.streak.textContent = "—";
      ro.progressDetail.textContent = total ? `${total} questions` : "endless session";
      ro.scoreDetail.textContent = "first-try answers";
      ro.streakDetail.textContent = " ";
    }
  }

  function showResults() {
    const rows = enabled().filter((s) => session.per[s]).map((s) => {
      const p = session.per[s], a = allTime[s] || { heard: 0, right: 0 };
      return { s, p, a, acc: p.right / p.heard };
    });
    const weak = rows.filter((r) => r.acc < 0.75).sort((x, y) => x.acc - y.acc).slice(0, 3);
    resultsEl.innerHTML = `
      <h3>Session finished — ${pct(session.firstTry, session.asked)} first try</h3>
      <p class="iv-summary">${session.firstTry} of ${session.asked} correct on the first guess · best streak ${session.bestStreak}</p>
      <table class="iv-table">
        <thead><tr><th>Interval</th><th>Heard</th><th>First try</th><th>Accuracy</th><th>All time</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.acc < 0.75 ? "weak" : ""}"><td>${byS.get(r.s).name}</td><td>${r.p.heard}</td>` +
          `<td>${r.p.right}</td><td>${pct(r.p.right, r.p.heard)}</td><td>${pct(r.a.right, r.a.heard)} <small>(${r.a.heard})</small></td></tr>`).join("")}</tbody>
      </table>
      <p class="tips">${weak.length
        ? `Work on: <b>${weak.map((r) => byS.get(r.s).name).join(", ")}</b>. Use ▶ to compare them side by side, or untick the others in the settings to drill just these.`
        : "Nice — every interval at 75% or better. Add more intervals or try another direction to make it harder."}</p>`;
    resultsEl.hidden = false;
  }

  // =========================================================================
  // Settings
  // =========================================================================
  function matchingPreset() {
    const cur = enabled().join(",");
    return Object.keys(PRESETS).find((k) => PRESETS[k].join(",") === cur) || "custom";
  }

  function syncSettingsUI() {
    presetSel.value = matchingPreset();
    for (const cb of chipsEl.querySelectorAll("input")) cb.checked = settings.enabled.includes(parseInt(cb.value, 10));
    dirSel.value = settings.dir;
    speedSel.value = settings.speed;
    countSel.value = String(settings.count);
    fixedCb.checked = settings.fixedRoot;
    autoCb.checked = settings.autoNext;
  }

  function enabledChanged() {
    persist();
    syncSettingsUI();
    renderChoices();
    // The interval being asked may have been switched off: ask a fresh one.
    if (q && !q.answered && !settings.enabled.includes(q.s)) next();
    else render(false);
  }

  for (const iv of INTERVALS) {
    const label = document.createElement("label");
    label.className = "iv-chip";
    label.innerHTML = `<input type="checkbox" value="${iv.s}" /> ${iv.short}`;
    label.title = iv.name;
    chipsEl.append(label);
  }
  chipsEl.addEventListener("change", (e) => {
    const s = parseInt(e.target.value, 10);
    if (e.target.checked) settings.enabled = [...new Set([...settings.enabled, s])];
    else if (settings.enabled.length > 2) settings.enabled = settings.enabled.filter((x) => x !== s);
    else e.target.checked = true; // keep at least two to choose between
    enabledChanged();
  });
  presetSel.addEventListener("change", () => {
    if (PRESETS[presetSel.value]) { settings.enabled = PRESETS[presetSel.value].slice(); enabledChanged(); }
  });
  dirSel.addEventListener("change", () => { settings.dir = dirSel.value; persist(); });
  speedSel.addEventListener("change", () => { settings.speed = speedSel.value; persist(); });
  countSel.addEventListener("change", () => { settings.count = parseInt(countSel.value, 10); persist(); render(false); });
  fixedCb.addEventListener("change", () => { settings.fixedRoot = fixedCb.checked; persist(); });
  autoCb.addEventListener("change", () => { settings.autoNext = autoCb.checked; persist(); });

  // =========================================================================
  // Buttons + keyboard shortcuts
  // =========================================================================
  playBtn.addEventListener("click", () => {
    if (!session || session.done) start();
    else if (!q) next();
    else replay();
  });
  nextBtn.addEventListener("click", next);
  endBtn.addEventListener("click", finish);

  // Capture phase, so these keys don't also play piano notes while quizzing.
  window.addEventListener("keydown", (e) => {
    if (!active || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.("input, select, textarea")) return;
    let handled = true;
    if (e.key === " ") playBtn.click();
    else if (e.key === "Enter") { if (q && q.answered) next(); }
    else if (HOTKEYS.includes(e.key)) {
      const s = enabled()[HOTKEYS.indexOf(e.key)];
      if (s !== undefined) answer(s);
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // =========================================================================
  // Tab hook (called by trainer.js)
  // =========================================================================
  function setActive(on) {
    active = on;
    el.hidden = !on;
    if (!on) {
      clearTimeout(nextTimer);
      stopSound();
      PianoUI.markNotes([]);
    } else if (q && q.answered) {
      PianoUI.markNotes([q.a, q.b]);
    }
  }

  syncSettingsUI();
  renderChoices();
  render();

  return { setActive, el };
})();
