// ===========================================================================
// trainer.js — pitch training on top of the piano.
//   * Free play: play a key to set a target, sing it, and watch your pitch
//     trace against it on a scrolling piano-roll graph.
//   * Vocal exercises: patterns from exercises.js, transposed through your
//     range rep by rep, scored on how much of each note you sing in tune.
//   * Range finder: measures your lowest / highest held notes.
// ===========================================================================

(() => {
  const $ = (id) => document.getElementById(id);
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const RANGE_PRESETS = {
    bass: [40, 64], baritone: [43, 67], tenor: [48, 72], alto: [53, 77], mezzo: [57, 81], soprano: [60, 84],
  };
  const RANGE_MIN = 28, RANGE_MAX = 96; // E1 .. C7 selectable

  // ---- Persistence (per-browser conveniences only) -------------------------
  const SETTINGS_KEY = "webpiano.trainer.v1";
  const BEST_KEY = "webpiano.best.v1";
  const TAB_KEY = "webpiano.tab.v1";
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } };

  const settings = Object.assign({
    preset: "baritone", lo: 43, hi: 67, tol: 40, ignoreOctave: false, sensitivity: 60,
    drone: false, droneSound: "voiceOoh",
    exId: "five-tone", mode: "along", reps: "8", direction: "up", tempos: {},
  }, load(SETTINGS_KEY, {}));
  const best = load(BEST_KEY, {});
  const saveSettings = () => save(SETTINGS_KEY, settings);

  // ---- DOM -----------------------------------------------------------------
  const trainerEl = $("trainer");
  const freePanel = $("freePanel");
  const exPanel = $("exPanel");
  const micBtn = $("micBtn");
  const micLevel = $("micLevel");
  const canvas = $("pitchCanvas");
  const g = canvas.getContext("2d");
  const countdownEl = $("countdown");
  const pianoMain = document.querySelector("main");
  const ui = {
    sungNote: $("sungNote"), sungDetail: $("sungDetail"),
    targetNote: $("targetNote"), targetDetail: $("targetDetail"),
    needle: $("centsNeedle"), centsText: $("centsText"), zone: document.querySelector(".cents-zone"),
    scoreLabel: $("scoreLabel"), scoreBig: $("scoreBig"), scoreDetail: $("scoreDetail"),
  };

  // ---- Shared state --------------------------------------------------------
  let tab = "piano";
  const history = [];     // { t, m (fractional midi | null), tgt (midi | null), rms }
  const recent = [];      // last few raw detections for median smoothing
  let lastRms = 0;
  let freeTarget = null;
  let droneVoice = null;
  let run = null;         // active exercise run
  let preview = null;     // idle exercise preview plan
  let rf = null;          // active range finder
  let currentEx = null;
  let viewCentre = 60;    // smoothed vertical centre for scrolling views
  let lastSungKey = "";
  let lastTargetKey = "";

  const tol = () => settings.tol;

  function centsOff(m, target) {
    let c = (m - target) * 100;
    if (settings.ignoreOctave) c = ((c % 1200) + 1800) % 1200 - 600;
    return c;
  }

  // =========================================================================
  // Tabs
  // =========================================================================
  const tabButtons = document.querySelectorAll(".tab");
  function setTab(t) {
    if (run) stopRun(true);
    if (rf) endRangeFinder(false);
    tab = t;
    save(TAB_KEY, t);
    for (const b of tabButtons) b.setAttribute("aria-selected", String(b.dataset.tab === t));
    trainerEl.hidden = t === "piano";
    // Keep the keyboard right under the pitch graph while singing.
    if (t === "piano") trainerEl.after(pianoMain);
    else canvas.parentElement.after(pianoMain);
    freePanel.hidden = t !== "free";
    exPanel.hidden = t !== "exercises";
    if (t !== "free") stopDrone();
    else restartDrone();
    ui.scoreLabel.textContent = t === "free" ? "Accuracy (last 5 s)" : "Score";
    ui.scoreBig.textContent = "—";
    ui.scoreDetail.textContent = " ";
    if (t === "exercises") buildPreview();
  }
  for (const b of tabButtons) {
    b.addEventListener("click", async () => {
      setTab(b.dataset.tab);
      await AudioEngine.resume();
      // Entering a singing mode is a user gesture, so we can ask for the mic.
      if (b.dataset.tab !== "piano" && !AudioEngine.mic) toggleMic();
    });
  }

  // =========================================================================
  // Microphone
  // =========================================================================
  async function toggleMic() {
    if (AudioEngine.mic) {
      AudioEngine.closeMic();
      PianoUI.setSung(null);
      lastSungKey = "";
    } else {
      try {
        await AudioEngine.openMic();
      } catch (e) {
        ui.sungDetail.textContent = "mic unavailable: " + (e.message || e.name);
        console.warn(e);
      }
    }
    micBtn.textContent = AudioEngine.mic ? "🎤 Mic on" : "🎤 Turn on mic";
    micBtn.classList.toggle("on", !!AudioEngine.mic);
  }
  micBtn.addEventListener("click", toggleMic);

  // Sensitivity slider 0..100 -> loudness gate (RMS) 0.05 .. 0.002, log scale.
  const minRms = () => 0.05 * Math.pow(0.04, settings.sensitivity / 100);

  function samplePitch(now) {
    const mic = AudioEngine.mic;
    if (!mic) return null;
    mic.analyser.getFloatTimeDomainData(mic.buffer);
    let sumSq = 0;
    for (let i = 0; i < mic.buffer.length; i++) sumSq += mic.buffer[i] * mic.buffer[i];
    lastRms = Math.sqrt(sumSq / mic.buffer.length);

    const sr = AudioEngine.context().sampleRate;
    const r = PitchDetector.detect(mic.buffer, sr, { minRms: minRms() });
    const raw = r ? freqToMidi(r.freq) : null;

    // Median of the last 3 detections removes one-frame octave glitches.
    recent.push(raw);
    if (recent.length > 3) recent.shift();
    let m = raw;
    if (raw !== null && recent.every((x) => x !== null)) {
      m = recent.slice().sort((a, b) => a - b)[1];
    }

    // The analysis window is centred half a frame in the past.
    const t = now - mic.analyser.fftSize / sr / 2;
    history.push({ t, m, tgt: scoredTargetAt(t), rms: lastRms });
    while (history.length && history[0].t < now - 30) history.shift();
    return m;
  }

  // =========================================================================
  // Voice settings
  // =========================================================================
  const rangePreset = $("rangePreset"), rangeLo = $("rangeLo"), rangeHi = $("rangeHi");
  const toleranceSel = $("tolerance"), ignoreOctaveCb = $("ignoreOctave"), sensitivityInput = $("sensitivity");

  for (let m = RANGE_MIN; m <= RANGE_MAX; m++) {
    rangeLo.add(new Option(noteName(m), m));
    rangeHi.add(new Option(noteName(m), m));
  }

  function syncSettingsUI() {
    rangePreset.value = settings.preset;
    rangeLo.value = settings.lo;
    rangeHi.value = settings.hi;
    toleranceSel.value = settings.tol;
    ignoreOctaveCb.checked = settings.ignoreOctave;
    sensitivityInput.value = settings.sensitivity;
    $("droneCb").checked = settings.drone;
    $("droneSound").value = settings.droneSound;
  }

  function rangeChanged() {
    saveSettings();
    populateStartSelect();
    buildPreview();
  }

  rangePreset.addEventListener("change", () => {
    settings.preset = rangePreset.value;
    if (RANGE_PRESETS[settings.preset]) [settings.lo, settings.hi] = RANGE_PRESETS[settings.preset];
    syncSettingsUI();
    rangeChanged();
  });
  for (const [sel, key] of [[rangeLo, "lo"], [rangeHi, "hi"]]) {
    sel.addEventListener("change", () => {
      settings[key] = parseInt(sel.value, 10);
      // Keep at least a fifth between the ends.
      if (settings.hi - settings.lo < 7) {
        if (key === "lo") settings.hi = Math.min(RANGE_MAX, settings.lo + 7);
        else settings.lo = Math.max(RANGE_MIN, settings.hi - 7);
      }
      settings.preset = "custom";
      syncSettingsUI();
      rangeChanged();
    });
  }
  toleranceSel.addEventListener("change", () => { settings.tol = parseInt(toleranceSel.value, 10); saveSettings(); });
  ignoreOctaveCb.addEventListener("change", () => { settings.ignoreOctave = ignoreOctaveCb.checked; saveSettings(); });
  sensitivityInput.addEventListener("input", () => { settings.sensitivity = parseInt(sensitivityInput.value, 10); saveSettings(); });

  // =========================================================================
  // Free play
  // =========================================================================
  PianoUI.onNoteOn = (midi) => {
    if (tab !== "free") return;
    freeTarget = midi;
    restartDrone();
  };

  function playReference(m, seconds = 1.5) {
    const v = AudioEngine.play(PianoUI.instrument(), m);
    v.stop(AudioEngine.now() + seconds);
  }

  function restartDrone() {
    stopDrone();
    if (tab === "free" && settings.drone && freeTarget !== null) {
      droneVoice = AudioEngine.play(settings.droneSound, freeTarget, undefined, { gain: 0.35 });
    }
  }
  function stopDrone() {
    droneVoice?.stop(AudioEngine.now());
    droneVoice = null;
  }

  $("randomNoteBtn").addEventListener("click", async () => {
    await AudioEngine.resume();
    freeTarget = settings.lo + Math.floor(Math.random() * (settings.hi - settings.lo + 1));
    playReference(freeTarget);
    restartDrone();
  });
  $("replayBtn").addEventListener("click", async () => {
    if (freeTarget === null) return;
    await AudioEngine.resume();
    playReference(freeTarget);
  });
  $("clearTargetBtn").addEventListener("click", () => { freeTarget = null; stopDrone(); });
  $("droneCb").addEventListener("change", (e) => { settings.drone = e.target.checked; saveSettings(); restartDrone(); });
  $("droneSound").addEventListener("change", (e) => { settings.droneSound = e.target.value; saveSettings(); restartDrone(); });

  // =========================================================================
  // Exercises — browser & options
  // =========================================================================
  const exList = $("exList"), exSearch = $("exSearch");
  const exTempo = $("exTempo"), exMode = $("exMode"), exReps = $("exReps"), exDirection = $("exDirection"), exStart = $("exStart");
  const exStartBtn = $("exStartBtn"), exStopBtn = $("exStopBtn"), rfNextBtn = $("rfNextBtn"), exStatus = $("exStatus");
  const exResults = $("exResults");

  function renderExList() {
    const q = exSearch.value.trim().toLowerCase();
    exList.innerHTML = "";
    let cat = null;
    for (const ex of Exercises.list) {
      if (q && !`${ex.name} ${ex.cat} ${ex.desc}`.toLowerCase().includes(q)) continue;
      if (ex.cat !== cat) {
        cat = ex.cat;
        const h = document.createElement("div");
        h.className = "ex-group";
        h.textContent = cat;
        exList.appendChild(h);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ex-item" + (currentEx?.id === ex.id ? " selected" : "");
      const name = document.createElement("span");
      name.textContent = ex.name;
      const badge = document.createElement("span");
      badge.className = "ex-best";
      badge.textContent = best[ex.id] !== undefined ? `best ${best[ex.id]}%` : "";
      b.append(name, badge);
      b.addEventListener("click", () => selectEx(ex.id));
      exList.appendChild(b);
    }
  }
  exSearch.addEventListener("input", renderExList);

  function selectEx(id) {
    if (run) stopRun(true);
    if (rf) endRangeFinder(false);
    currentEx = Exercises.list.find((e) => e.id === id) || Exercises.list[0];
    settings.exId = currentEx.id;
    saveSettings();
    const ex = currentEx;
    $("exCat").textContent = ex.cat;
    $("exName").textContent = ex.name;
    $("exDesc").textContent = ex.desc;
    $("exHint").hidden = !ex.hint;
    $("exHint").textContent = ex.hint ? `Sing on: ${ex.hint}` : "";

    const special = ex.special === "range";
    $("exOptions").hidden = special;
    $("rangeFinder").hidden = !special;
    $("rfLow").textContent = $("rfHigh").textContent = "—";
    exStartBtn.textContent = special ? "▶ Start measuring" : "▶ Start";
    exResults.hidden = true;
    exStatus.textContent = "";

    exTempo.value = settings.tempos[ex.id] || ex.tempo || 90;
    exMode.value = ex.forceMode || settings.mode;
    exMode.disabled = !!ex.forceMode;
    exReps.value = settings.reps;
    exDirection.value = settings.direction;
    exDirection.disabled = !!ex.gen;
    exStart.disabled = !!ex.gen;
    populateStartSelect();
    renderExList();
    buildPreview();
  }

  function populateStartSelect() {
    const prev = exStart.value;
    exStart.innerHTML = "";
    exStart.add(new Option("Edge of my range (auto)", "auto"));
    for (let m = settings.lo; m <= settings.hi; m++) exStart.add(new Option(noteName(m), m));
    exStart.value = [...exStart.options].some((o) => o.value === prev) ? prev : "auto";
  }

  function readOptions() {
    const tempo = clamp(parseInt(exTempo.value, 10) || currentEx.tempo || 90, 40, 220);
    exTempo.value = tempo;
    settings.tempos[currentEx.id] = tempo;
    if (!currentEx.forceMode) settings.mode = exMode.value;
    settings.reps = exReps.value;
    settings.direction = exDirection.value;
    saveSettings();
    return {
      tempo,
      mode: currentEx.forceMode || exMode.value,
      reps: parseInt(exReps.value, 10),
      direction: exDirection.value,
      start: exStart.value,
    };
  }
  for (const el of [exTempo, exMode, exReps, exDirection, exStart]) {
    el.addEventListener("change", () => { if (currentEx && !currentEx.special) { readOptions(); buildPreview(); } });
  }

  // Roots for each repetition: walk the pattern through the singer's range.
  function repRoots(ex, opts) {
    const sp = Exercises.span(ex.notes);
    let lowest = settings.lo - sp.lo;
    let highest = settings.hi - sp.hi;
    let warning = "";
    if (lowest > highest) {
      // Pattern is wider than the range: centre it once and say so.
      lowest = highest = Math.round((settings.lo + settings.hi) / 2 - (sp.lo + sp.hi) / 2);
      warning = "This pattern is wider than your range — it's centred instead.";
    }
    let start = opts.start === "auto"
      ? (opts.direction === "down" ? highest : lowest)
      : clamp(parseInt(opts.start, 10), lowest, highest);
    const n = opts.reps;
    let roots = [];
    if (opts.direction === "same") {
      roots = Array(n === 99 ? 4 : n).fill(start);
    } else if (opts.direction === "down") {
      for (let r = start; r >= lowest && roots.length < n; r--) roots.push(r);
    } else if (opts.direction === "updown") {
      const upCount = n === 99 ? Infinity : Math.ceil((n + 1) / 2);
      const up = [];
      for (let r = start; r <= highest && up.length < upCount; r++) up.push(r);
      roots = up.concat(up.slice(0, -1).reverse()).slice(0, n);
    } else {
      for (let r = start; r <= highest && roots.length < n; r++) roots.push(r);
    }
    if (!roots.length) roots = [start];
    return { roots, warning };
  }

  // Turn an exercise + options into a timeline of note events (seconds from 0).
  function buildPlan(ex, opts) {
    const spb = 60 / opts.tempo;
    const countIn = 4 * spb;
    let reps, warning = "";
    if (ex.gen) {
      const n = opts.reps === 99 ? 10 : opts.reps;
      reps = Array.from({ length: n }, () => ex.gen(Math.random, settings.lo, settings.hi));
    } else {
      const r = repRoots(ex, opts);
      warning = r.warning;
      reps = r.roots.map((root) => ({ root, notes: ex.notes }));
    }

    const events = [];
    const repInfo = [];
    let t = countIn;
    reps.forEach((rep, i) => {
      const repStart = t;
      const pass = (kind, play, scored) => {
        for (const n of rep.notes) {
          const d = n.b * spb;
          if (n.o !== null) {
            events.push({
              a: t, b: t + d, m0: rep.root + n.o, m1: rep.root + (n.g ?? n.o),
              kind, play, scored, rep: i, hit: 0, total: 0, errSum: 0, errN: 0,
            });
          }
          t += d;
        }
      };
      if (opts.mode === "listen") {
        pass("listen", true, false);
        t += spb;
        pass("sing", false, true);
      } else if (opts.mode === "cue") {
        const first = rep.notes.find((n) => n.o !== null);
        events.push({ a: t, b: t + spb, m0: rep.root + first.o, m1: rep.root + first.o, kind: "cue", play: true, scored: false, rep: i });
        t += 2 * spb;
        pass("sing", false, true);
      } else {
        pass("sing", true, true);
      }
      repInfo.push({ root: rep.root, a: repStart, b: t });
      t += spb; // breath between reps
    });

    let lo = Infinity, hi = -Infinity;
    for (const e of events) { lo = Math.min(lo, e.m0, e.m1); hi = Math.max(hi, e.m0, e.m1); }
    const centre = (lo + hi) / 2;
    const half = Math.max(7, (hi - lo) / 2 + 3);
    return { events, repInfo, duration: t, spb, countIn, lo: centre - half, hi: centre + half, warning, mode: opts.mode };
  }

  function buildPreview() {
    if (tab !== "exercises" || !currentEx || currentEx.special || run) { preview = null; return; }
    preview = buildPlan(currentEx, readOptionsSilently());
    exStatus.textContent = preview.warning || `${preview.repInfo.length} reps · about ${Math.round(preview.duration)} s`;
  }
  // Same as readOptions but without persisting (used for previews).
  function readOptionsSilently() {
    return {
      tempo: clamp(parseInt(exTempo.value, 10) || 90, 40, 220),
      mode: currentEx.forceMode || exMode.value,
      reps: parseInt(exReps.value, 10),
      direction: exDirection.value,
      start: exStart.value,
    };
  }

  // =========================================================================
  // Exercises — running
  // =========================================================================
  exStartBtn.addEventListener("click", () => {
    if (currentEx.special === "range") {
      if (rf) endRangeFinder(true); else startRangeFinder();
    } else {
      startRun();
    }
  });
  exStopBtn.addEventListener("click", () => stopRun(false));

  async function startRun() {
    await AudioEngine.resume();
    if (!AudioEngine.mic) await toggleMic();
    const opts = readOptions();
    const plan = buildPlan(currentEx, opts);
    const start = AudioEngine.now() + 0.25;
    for (let b = 0; b < 4; b++) AudioEngine.click(start + b * plan.spb, b === 0);
    for (const e of plan.events) { e.a += start; e.b += start; }
    for (const r of plan.repInfo) { r.a += start; r.b += start; }
    run = { ex: currentEx, plan, start, end: start + plan.duration, nextPlay: 0, instrument: PianoUI.instrument() };
    preview = null;
    exStartBtn.hidden = true;
    exStopBtn.hidden = false;
    exResults.hidden = true;
    exStatus.textContent = plan.warning || (AudioEngine.mic ? "" : "No mic — notes will play but can't be scored.");
  }

  // Schedule reference notes slightly ahead of time on the audio clock.
  function scheduleNotes(now) {
    const ev = run.plan.events;
    while (run.nextPlay < ev.length && ev[run.nextPlay].a < now + 0.2) {
      const e = ev[run.nextPlay++];
      if (!e.play) continue;
      e.voice = AudioEngine.play(run.instrument, e.m0, Math.max(e.a, now));
      if (e.m1 !== e.m0) e.voice.glide(e.m1, e.a, e.b);
      e.voice.stop(e.b);
    }
  }

  const targetMidiAt = (e, t) => e.m0 + (e.m1 - e.m0) * clamp((t - e.a) / (e.b - e.a), 0, 1);

  // The note being scored at time t (or the free-play target).
  function scoredTargetAt(t) {
    if (run) {
      for (const e of run.plan.events) {
        if (e.a > t) break;
        if (e.scored && t < e.b) return targetMidiAt(e, t);
      }
      return null;
    }
    if (tab === "free") return freeTarget;
    return null;
  }

  // Any event sounding / expected at time t, for the readouts.
  function eventAt(t) {
    if (!run) return null;
    for (const e of run.plan.events) {
      if (e.a > t) break;
      if (t < e.b) return e;
    }
    return null;
  }

  function scoreFrame(sample) {
    if (!sample) return;
    for (const e of run.plan.events) {
      if (e.a > sample.t) break;
      if (!e.scored || sample.t >= e.b) continue;
      // Give the singer a moment to land each note before it counts.
      const grace = Math.min(0.15, (e.b - e.a) * 0.25);
      if (sample.t < e.a + grace || sample.t > e.b - 0.03) return;
      e.total++;
      if (sample.m !== null) {
        const c = centsOff(sample.m, targetMidiAt(e, sample.t));
        if (Math.abs(c) <= tol()) e.hit++;
        if (Math.abs(c) < 300) { e.errSum += c; e.errN++; }
      }
      return;
    }
  }

  function runScore(events) {
    let hit = 0, total = 0;
    for (const e of events) if (e.scored) { hit += e.hit; total += e.total; }
    return total ? Math.round((100 * hit) / total) : null;
  }

  function stopRun(silent) {
    if (!run) return;
    const now = AudioEngine.now();
    for (const e of run.plan.events) e.voice?.stop(now);
    const finished = run;
    run = null;
    countdownEl.hidden = true;
    exStartBtn.hidden = false;
    exStopBtn.hidden = true;
    PianoUI.setTarget(null);
    lastTargetKey = "";
    if (!silent) showResults(finished, true);
    buildPreview();
  }

  function finishRun() {
    const finished = run;
    run = null;
    countdownEl.hidden = true;
    exStartBtn.hidden = false;
    exStopBtn.hidden = true;
    PianoUI.setTarget(null);
    lastTargetKey = "";
    showResults(finished, false);
    buildPreview();
  }

  function showResults(r, stoppedEarly) {
    const events = r.plan.events.filter((e) => e.scored && e.total > 0);
    const score = runScore(events);
    exResults.hidden = false;
    exResults.innerHTML = "";
    if (score === null) {
      exResults.innerHTML = "<h3>No score</h3><p>Nothing was scored — stopped before the first note, or the mic was off.</p>";
      return;
    }
    let isBest = false;
    if (!stoppedEarly && (best[r.ex.id] === undefined || score > best[r.ex.id])) {
      isBest = best[r.ex.id] !== undefined; // only celebrate beating a previous score
      best[r.ex.id] = score;
      save(BEST_KEY, best);
      renderExList();
    }
    const stars = score >= 90 ? 5 : score >= 75 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : 1;

    const h = document.createElement("h3");
    h.innerHTML = `<span class="stars">${"★".repeat(stars)}${"☆".repeat(5 - stars)}</span> ${score}% in tune`
      + (stoppedEarly ? " <small>(stopped early)</small>" : isBest ? " <small>— new best!</small>" : "");
    exResults.appendChild(h);

    // One bar per rep.
    const bars = document.createElement("div");
    bars.className = "rep-bars";
    r.plan.repInfo.forEach((rep, i) => {
      const s = runScore(events.filter((e) => e.rep === i));
      if (s === null) return;
      const bar = document.createElement("div");
      bar.className = "rep-bar";
      bar.style.height = Math.max(4, s) + "%";
      bar.style.background = s >= 75 ? "#5ad17e" : s >= 40 ? "#f0c14b" : "#ff6b6b";
      bar.title = `Rep ${i + 1} (${noteName(rep.root)}): ${s}%`;
      const lbl = document.createElement("span");
      lbl.textContent = noteName(rep.root);
      bar.appendChild(lbl);
      bars.appendChild(bar);
    });
    exResults.appendChild(bars);

    // Coaching tips from the data.
    const tips = [];
    let errSum = 0, errN = 0, total = 0;
    for (const e of events) { errSum += e.errSum; errN += e.errN; total += e.total; }
    const avg = errN ? errSum / errN : 0;
    if (errN && avg > 12) tips.push(`On average you were <b>${Math.round(avg)}¢ sharp</b> — relax and aim a little lower.`);
    else if (errN && avg < -12) tips.push(`On average you were <b>${Math.round(-avg)}¢ flat</b> — lift the pitch and keep the breath support going.`);
    else if (errN) tips.push(`Your average pitch was centred (${avg >= 0 ? "+" : ""}${Math.round(avg)}¢) — nice.`);
    if (total && errN / total < 0.6) tips.push("The mic often couldn't hear a clear pitch — sing a bit louder or raise <i>Mic sensitivity</i>.");
    const worst = r.plan.repInfo
      .map((rep, i) => ({ rep, s: runScore(events.filter((e) => e.rep === i)) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => a.s - b.s)[0];
    if (worst && worst.s < score - 15) tips.push(`Weakest rep: <b>${noteName(worst.rep.root)}</b> (${worst.s}%) — try starting there next time.`);
    const p = document.createElement("p");
    p.className = "tips";
    p.innerHTML = tips.join("<br>");
    exResults.appendChild(p);
  }

  // =========================================================================
  // Range finder
  // =========================================================================
  async function startRangeFinder() {
    await AudioEngine.resume();
    if (!AudioEngine.mic) await toggleMic();
    rf = { phase: "low", low: null, high: null, cand: null, since: 0 };
    $("rfLow").textContent = $("rfHigh").textContent = "—";
    exStartBtn.textContent = "💾 Save range";
    rfNextBtn.hidden = false;
    rfNextBtn.textContent = "Next: highest note";
    exStatus.textContent = "Step 1: slide down to your lowest note and hold it…";
  }
  rfNextBtn.addEventListener("click", () => {
    if (!rf) return;
    rf.phase = "high";
    rfNextBtn.hidden = true;
    exStatus.textContent = "Step 2: slide up to your highest comfortable note and hold it…";
  });

  function updateRangeFinder(now, m) {
    if (m === null) { rf.cand = null; return; }
    const n = Math.round(m);
    if (rf.cand !== n) { rf.cand = n; rf.since = now; return; }
    if (now - rf.since < 0.35) return; // must be held, not just passed through
    if (rf.low === null || n < rf.low) rf.low = n;
    if (rf.high === null || n > rf.high) rf.high = n;
    $("rfLow").textContent = noteName(rf.low);
    $("rfHigh").textContent = noteName(rf.high);
  }

  function endRangeFinder(apply) {
    const r = rf;
    rf = null;
    exStartBtn.textContent = "▶ Start measuring";
    rfNextBtn.hidden = true;
    if (!apply) { exStatus.textContent = ""; return; }
    if (r.low === null || r.high === null || r.high - r.low < 7) {
      exStatus.textContent = "Couldn't measure at least a fifth — try again, holding each end note for a second.";
      return;
    }
    // Keep a semitone of headroom at each end so exercises stay comfortable.
    settings.lo = r.low + 1;
    settings.hi = r.high - 1;
    settings.preset = "custom";
    syncSettingsUI();
    rangeChanged();
    exStatus.textContent = `Saved: ${noteName(settings.lo)} – ${noteName(settings.hi)} (you reached ${noteName(r.low)} – ${noteName(r.high)}).`;
  }

  // =========================================================================
  // Drawing
  // =========================================================================
  const COL = {
    bg: "#15171c", lane: "#1c1f26", laneBlack: "#14161b", cLine: "#343a46",
    label: "#6f7782", labelC: "#c9ccd2",
    target: "#4f9dff", targetFill: "rgba(79,157,255,0.28)",
    listen: "rgba(154,160,170,0.18)", listenEdge: "#9aa0aa",
    good: "#5ad17e", ok: "#f0c14b", bad: "#ff6b6b", trace: "#e8eaed", playhead: "rgba(255,255,255,0.55)",
  };

  function draw(view) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COL.bg;
    g.fillRect(0, 0, w, h);

    const gutter = 46;
    const laneH = h / (view.hi - view.lo);
    const X = (t) => gutter + ((t - view.t0) / (view.t1 - view.t0)) * (w - gutter);
    const Y = (m) => h - (m - view.lo) * laneH;
    const tolH = Math.max(laneH * 0.35, (tol() / 100) * laneH * 2);

    // Note lanes + labels.
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (let m = Math.floor(view.lo); m <= Math.ceil(view.hi); m++) {
      const pc = ((m % 12) + 12) % 12;
      const top = Y(m + 0.5);
      g.fillStyle = BLACK.has(pc) ? COL.laneBlack : COL.lane;
      g.fillRect(gutter, top, w - gutter, laneH);
      if (pc === 0) { g.fillStyle = COL.cLine; g.fillRect(gutter, Y(m - 0.5) - 1, w - gutter, 1); }
      if (laneH >= 11 || pc === 0) {
        g.fillStyle = pc === 0 ? COL.labelC : COL.label;
        g.font = `${pc === 0 ? 600 : 400} ${Math.round(clamp(laneH * 0.8, 9, 12))}px system-ui, sans-serif`;
        g.fillText(noteName(m), gutter - 6, Y(m));
      }
    }

    g.save();
    g.beginPath();
    g.rect(gutter, 0, w - gutter, h);
    g.clip();

    // Free-play target band.
    if (view.band !== null && view.band !== undefined) {
      const y = Y(view.band);
      g.fillStyle = COL.targetFill;
      g.fillRect(gutter, y - tolH / 2, w - gutter, tolH);
      g.strokeStyle = COL.target;
      g.setLineDash([6, 6]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(gutter, y); g.lineTo(w, y);
      g.stroke();
      g.setLineDash([]);
    }

    // Exercise notes.
    g.font = "600 11px system-ui, sans-serif";
    g.textAlign = "left";
    for (const e of view.events || []) {
      if (e.b < view.t0 || e.a > view.t1) continue;
      let fill, edge;
      if (!e.scored) { fill = COL.listen; edge = COL.listenEdge; }
      else if (e.done) {
        const s = e.total ? e.hit / e.total : 0;
        edge = s >= 0.75 ? COL.good : s >= 0.4 ? COL.ok : COL.bad;
        fill = edge + "40";
      } else { fill = COL.targetFill; edge = COL.target; }
      const xa = X(e.a), xb = X(e.b) - 2;
      g.fillStyle = fill;
      g.strokeStyle = edge;
      g.lineWidth = 1.5;
      g.beginPath();
      if (e.m0 === e.m1 && !g.roundRect) {
        g.rect(xa, Y(e.m0) - tolH / 2, Math.max(2, xb - xa), tolH);
      } else if (e.m0 === e.m1) {
        g.roundRect(xa, Y(e.m0) - tolH / 2, Math.max(2, xb - xa), tolH, Math.min(6, tolH / 2));
      } else {
        g.moveTo(xa, Y(e.m0) - tolH / 2);
        g.lineTo(xb, Y(e.m1) - tolH / 2);
        g.lineTo(xb, Y(e.m1) + tolH / 2);
        g.lineTo(xa, Y(e.m0) + tolH / 2);
        g.closePath();
      }
      g.fill();
      g.stroke();
      if (xb - xa > 34 && tolH >= 10) {
        g.fillStyle = edge;
        g.fillText(e.kind === "listen" ? "listen" : e.kind === "cue" ? "cue" : noteName(Math.round(e.m0)), xa + 5, Y(e.m0));
      }
    }

    // Your voice.
    if (view.trace) {
      g.lineWidth = 3;
      g.lineCap = "round";
      let prev = null;
      for (const p of history) {
        if (p.t < view.t0 - 0.2) continue;
        if (p.t > view.t1) break;
        if (p.m === null) { prev = null; continue; }
        let dm = p.m;
        if (settings.ignoreOctave && p.tgt !== null) dm = p.m - 12 * Math.round((p.m - p.tgt) / 12);
        let col = COL.trace;
        if (p.tgt !== null) {
          const c = Math.abs(centsOff(p.m, p.tgt));
          col = c <= tol() ? COL.good : c <= tol() * 2.5 ? COL.ok : COL.bad;
        }
        const pt = { x: X(p.t), y: Y(dm), t: p.t };
        g.strokeStyle = col;
        g.beginPath();
        if (prev && pt.t - prev.t < 0.12) { g.moveTo(prev.x, prev.y); g.lineTo(pt.x, pt.y); }
        else { g.moveTo(pt.x, pt.y); g.lineTo(pt.x + 0.1, pt.y); }
        g.stroke();
        prev = pt;
      }
    }

    if (view.playhead !== undefined) {
      g.strokeStyle = COL.playhead;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(X(view.playhead), 0);
      g.lineTo(X(view.playhead), h);
      g.stroke();
    }
    g.restore();
  }

  // =========================================================================
  // Readouts
  // =========================================================================
  function updateReadouts(m, displayTarget, targetLabel) {
    micLevel.style.width = Math.min(100, lastRms * 500) + "%";

    if (m !== null) {
      const n = Math.round(m);
      ui.sungNote.textContent = noteName(n);
      const own = Math.round((m - n) * 100);
      ui.sungDetail.textContent = `${(440 * Math.pow(2, (m - 69) / 12)).toFixed(1)} Hz · ${own >= 0 ? "+" : ""}${own}¢`;
    } else {
      ui.sungNote.textContent = "—";
      ui.sungDetail.textContent = AudioEngine.mic ? "listening…" : "turn on the mic and sing";
    }

    ui.targetNote.textContent = displayTarget !== null ? noteName(Math.round(displayTarget)) : "—";
    ui.targetDetail.textContent = targetLabel || " ";

    const zoneHalf = Math.min(50, tol());
    ui.zone.style.left = 50 - zoneHalf + "%";
    ui.zone.style.width = 2 * zoneHalf + "%";
    if (m !== null) {
      const ref = displayTarget !== null ? displayTarget : Math.round(m);
      const c = centsOff(m, ref);
      ui.needle.hidden = false;
      ui.needle.style.left = clamp(50 + c, 0, 100) + "%";
      const word = Math.abs(c) <= tol() ? "in tune" : c > 0 ? "sharp" : "flat";
      ui.centsText.textContent = Math.abs(c) >= 100
        ? `${Math.abs(c / 100).toFixed(1)} semitones ${c > 0 ? "high" : "low"}`
        : `${c >= 0 ? "+" : ""}${Math.round(c)}¢ ${word}`;
    } else {
      ui.needle.hidden = true;
      ui.centsText.textContent = " ";
    }

    // Keyboard highlights (only touch the DOM when something changed).
    const scored = displayTarget !== null && m !== null && Math.abs(centsOff(m, displayTarget)) <= tol();
    const sungKey = m === null ? "" : `${Math.round(m)}:${scored}`;
    if (sungKey !== lastSungKey) { PianoUI.setSung(m === null ? null : m, scored); lastSungKey = sungKey; }
    const tKey = displayTarget === null ? "" : String(Math.round(displayTarget));
    if (tKey !== lastTargetKey) { PianoUI.setTarget(displayTarget); lastTargetKey = tKey; }
  }

  function freeAccuracy(now) {
    let hit = 0, n = 0;
    for (let i = history.length - 1; i >= 0 && history[i].t > now - 5; i--) {
      const p = history[i];
      if (p.m === null || p.tgt === null) continue;
      n++;
      if (Math.abs(centsOff(p.m, p.tgt)) <= tol()) hit++;
    }
    return n > 10 ? Math.round((100 * hit) / n) : null;
  }

  // =========================================================================
  // Main loop
  // =========================================================================
  function tick() {
    requestAnimationFrame(tick);
    if (tab === "piano" && !AudioEngine.mic) return;
    const now = AudioEngine.now();

    if (run) scheduleNotes(now);
    const m = samplePitch(now);
    if (run && AudioEngine.mic) scoreFrame(history[history.length - 1]);
    if (rf) updateRangeFinder(now, m);

    let displayTarget = null, targetLabel = "";
    if (run) {
      for (const e of run.plan.events) if (!e.done && now > e.b) e.done = true;
      const e = eventAt(now);
      if (e) {
        displayTarget = targetMidiAt(e, now);
        targetLabel = e.kind === "listen" ? "listen…" : e.kind === "cue" ? "starting note" : "sing!";
      }
      const rep = run.plan.repInfo.findIndex((r) => now >= r.a && now < r.b + run.plan.spb);
      const s = runScore(run.plan.events);
      ui.scoreBig.textContent = s === null ? "—" : s + "%";
      ui.scoreDetail.textContent = rep >= 0
        ? `rep ${rep + 1}/${run.plan.repInfo.length} · key ${noteName(run.plan.repInfo[rep].root)}`
        : "get ready…";
      const beatsLeft = Math.ceil((run.start + run.plan.countIn - now) / run.plan.spb);
      countdownEl.hidden = beatsLeft <= 0 || beatsLeft > 4;
      if (!countdownEl.hidden) countdownEl.textContent = beatsLeft;
      if (now > run.end + 0.3) finishRun();
    } else if (tab === "free") {
      displayTarget = freeTarget;
      targetLabel = freeTarget !== null ? `${(440 * Math.pow(2, (freeTarget - 69) / 12)).toFixed(1)} Hz` : "play a key";
      const acc = freeAccuracy(now);
      ui.scoreBig.textContent = acc === null ? "—" : acc + "%";
      ui.scoreDetail.textContent = freeTarget === null ? "set a target first" : "of the time in tune";
    }
    updateReadouts(m, displayTarget, targetLabel);

    if (tab === "piano") return;

    // Pick what the graph shows.
    if (run) {
      draw({ t0: now - 2.5, t1: now + 6.5, lo: run.plan.lo, hi: run.plan.hi, events: run.plan.events, trace: true, playhead: now });
    } else if (tab === "exercises" && preview) {
      const t0 = preview.countIn - 0.6;
      draw({ t0, t1: t0 + 9, lo: preview.lo, hi: preview.hi, events: preview.events, trace: false });
    } else {
      // Scrolling view that follows the target (or your voice).
      let lastVoiced = null;
      for (let i = history.length - 1; i >= 0 && history[i].t > now - 1.5; i--) {
        if (history[i].m !== null) { lastVoiced = history[i].m; break; }
      }
      const want = displayTarget ?? lastVoiced ?? viewCentre;
      viewCentre += (want - viewCentre) * 0.06;
      draw({ t0: now - 8, t1: now + 0.4, lo: viewCentre - 9, hi: viewCentre + 9, band: displayTarget, trace: true });
    }
  }

  // Leaving the page or backgrounding the Android app: stop the exercise,
  // release the microphone and pause audio.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    if (run) stopRun(true);
    if (rf) endRangeFinder(false);
    stopDrone();
    if (AudioEngine.mic) toggleMic();
    AudioEngine.suspend();
  });

  // =========================================================================
  // Init
  // =========================================================================
  syncSettingsUI();
  selectEx(settings.exId);
  setTab(load(TAB_KEY, "piano"));
  requestAnimationFrame(tick);
})();
