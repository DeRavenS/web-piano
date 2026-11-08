// ===========================================================================
// Web Piano — vanilla JS
// Instruments (piano, guitars, voices) live in audio.js; the pitch trainer and
// vocal exercises live in trainer.js and talk to the keyboard via PianoUI.
// Supports mouse + computer-keyboard play, remappable keys, multiple octaves.
// ===========================================================================

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);
const STORAGE_KEY = "webpiano.keymap.v1";

// Default keyboard layout: computer key -> semitone offset from the first note.
// Two QWERTY rows form the white/black key pattern used by most virtual pianos.
const DEFAULT_KEYMAP = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};

// ---- DOM references --------------------------------------------------------
const pianoEl = document.getElementById("piano");
const engineSel = document.getElementById("engine");
const octavesSel = document.getElementById("octaves");
const startOctaveSel = document.getElementById("startOctave");
const fullPianoCb = document.getElementById("fullPiano");
const volumeInput = document.getElementById("volume");
const showNotesCb = document.getElementById("showNotes");
const showKeysCb = document.getElementById("showKeys");
const remapBtn = document.getElementById("remapBtn");
const resetBtn = document.getElementById("resetBtn");
const remapHint = document.getElementById("remapHint");
const sampleStatus = document.getElementById("sampleStatus");

// ---- State -----------------------------------------------------------------
let notes = [];                       // [{ name, midi, freq, isBlack, offset }]
let offsetToEl = new Map();           // semitone offset -> key element
let keyMap = loadKeyMap();            // computer key -> offset
let heldKeys = new Set();             // currently pressed computer keys (anti-repeat)
let activeNotes = new Map();          // offset -> sounding voice
let pressedOffsets = new Set();       // keys currently held by mouse or keyboard
let remapMode = false;
let remapTargetOffset = null;         // offset awaiting a key binding

// ===========================================================================
// Audio (see audio.js — every instrument shares one engine)
// ===========================================================================
const INSTRUMENT_KEY = "webpiano.instrument.v1";

function populateInstruments() {
  engineSel.innerHTML = "";
  for (const [id, inst] of Object.entries(AudioEngine.INSTRUMENTS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = inst.label;
    engineSel.appendChild(opt);
  }
  let saved = null;
  try { saved = localStorage.getItem(INSTRUMENT_KEY); } catch (_) { /* ignore */ }
  engineSel.value = saved && AudioEngine.INSTRUMENTS[saved] ? saved : "piano";
}

async function ensureAudio() {
  await AudioEngine.resume();
}

// Kick off sample loading for the selected instrument and report progress.
async function loadSelectedInstrument() {
  const id = engineSel.value;
  if (!AudioEngine.INSTRUMENTS[id].sampler) { sampleStatus.hidden = true; return; }
  setSampleStatus("loading", "loading samples…");
  const result = await AudioEngine.load(id);
  if (engineSel.value !== id) return; // user switched meanwhile
  if (result === "ready") setSampleStatus("ready", "samples ready");
  else setSampleStatus("error", "samples unavailable — using synth (run start-piano.bat)");
}

// ---- Note triggering -------------------------------------------------------
function startNote(note) {
  if (activeNotes.has(note.offset)) return;
  activeNotes.set(note.offset, AudioEngine.play(engineSel.value, note.midi));
}

function stopNote(note) {
  const voice = activeNotes.get(note.offset);
  if (!voice) return;
  voice.stop(AudioEngine.now());
  activeNotes.delete(note.offset);
}

// ===========================================================================
// Play / release (engine-agnostic, drives visuals too)
// ===========================================================================
async function playOffset(offset, source) {
  const note = notes[offset];
  if (!note) return;
  pressedOffsets.add(offset);
  if (AudioEngine.context().state !== "running") await ensureAudio();
  // The key may have been released while audio was starting up; voice
  // instruments sustain forever, so never start a note nobody is holding.
  if (!pressedOffsets.has(offset)) return;
  startNote(note);
  const el = offsetToEl.get(offset);
  if (el) el.classList.add("active");
  PianoUI.onNoteOn?.(note.midi);
}

function releaseOffset(offset) {
  const note = notes[offset];
  if (!note) return;
  pressedOffsets.delete(offset);
  stopNote(note);
  const el = offsetToEl.get(offset);
  if (el) el.classList.remove("active");
}

// ===========================================================================
// Note model + rendering
// ===========================================================================
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function buildNotes() {
  notes = [];
  let startMidi, total;
  if (fullPianoCb.checked) {
    // Standard 88-key acoustic piano: A0 (MIDI 21) up to C8 (MIDI 108).
    startMidi = 21;
    total = 88;
  } else {
    const startOctave = parseInt(startOctaveSel.value, 10);
    const octaveCount = parseInt(octavesSel.value, 10);
    total = octaveCount * 12;
    startMidi = (startOctave + 1) * 12; // C{startOctave}
  }
  for (let i = 0; i < total; i++) {
    const midi = startMidi + i;
    const semitone = midi % 12;
    const octave = Math.floor(midi / 12) - 1;
    notes.push({
      name: NOTE_NAMES[semitone] + octave,
      midi,
      freq: midiToFreq(midi),
      isBlack: BLACK_SEMITONES.has(semitone),
      offset: i,
    });
  }
}

function renderPiano() {
  pianoEl.innerHTML = "";
  offsetToEl = new Map();
  applyKeySizing();
  const offsetToKeyLabel = invertKeyMap();

  for (const note of notes) {
    const el = document.createElement("div");
    el.className = "key " + (note.isBlack ? "black" : "white");
    el.dataset.offset = String(note.offset);

    const keyLabel = document.createElement("span");
    keyLabel.className = "key-label";
    keyLabel.textContent = offsetToKeyLabel.get(note.offset) || "";

    const noteLabel = document.createElement("span");
    noteLabel.className = "note-label";
    noteLabel.textContent = note.name;

    el.appendChild(noteLabel);
    el.appendChild(keyLabel);
    pianoEl.appendChild(el);
    offsetToEl.set(note.offset, el);
  }
  applyLabelVisibility();
}

// Shrink keys so the whole range tries to fit the viewport; never grow past the
// default size, and stop shrinking past a readable minimum (then it scrolls).
function applyKeySizing() {
  const DEFAULT_WHITE = 56, DEFAULT_BLACK = 36;
  const whiteCount = notes.filter((n) => !n.isBlack).length || 1;
  const available = Math.min(window.innerWidth - 60, 1280);
  const fitWidth = available / whiteCount;
  const whiteW = Math.max(22, Math.min(DEFAULT_WHITE, fitWidth));
  const scale = whiteW / DEFAULT_WHITE;
  pianoEl.style.setProperty("--white-key-w", whiteW + "px");
  pianoEl.style.setProperty("--black-key-w", DEFAULT_BLACK * scale + "px");
}

function invertKeyMap() {
  const m = new Map();
  for (const [key, offset] of Object.entries(keyMap)) {
    if (!m.has(offset)) m.set(offset, key); // first binding wins for display
  }
  return m;
}

function refreshKeyLabels() {
  const offsetToKeyLabel = invertKeyMap();
  for (const [offset, el] of offsetToEl) {
    const label = el.querySelector(".key-label");
    if (label) label.textContent = offsetToKeyLabel.get(offset) || "";
  }
}

function applyLabelVisibility() {
  for (const el of offsetToEl.values()) {
    el.querySelector(".note-label").style.display = showNotesCb.checked ? "" : "none";
    el.querySelector(".key-label").style.display = showKeysCb.checked ? "" : "none";
  }
}

// ===========================================================================
// Key mapping persistence
// ===========================================================================
function loadKeyMap() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && typeof stored === "object") return stored;
  } catch (_) { /* ignore */ }
  return { ...DEFAULT_KEYMAP };
}

function saveKeyMap() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keyMap)); } catch (_) { /* ignore */ }
}

function resetKeyMap() {
  keyMap = { ...DEFAULT_KEYMAP };
  saveKeyMap();
  refreshKeyLabels();
}

// ===========================================================================
// Volume
// ===========================================================================
function volumeFraction() { return parseInt(volumeInput.value, 10) / 100; }

function applyVolume() {
  AudioEngine.setVolume(volumeFraction());
}

// ===========================================================================
// Input handling
// ===========================================================================
// --- Mouse / touch (pointer events) ---
pianoEl.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".key");
  if (!el) return;
  const offset = parseInt(el.dataset.offset, 10);
  if (remapMode) { selectRemapTarget(offset); return; }
  el.setPointerCapture?.(e.pointerId);
  playOffset(offset, "mouse");
});

pianoEl.addEventListener("pointerup", endPointer);
pianoEl.addEventListener("pointercancel", endPointer);
function endPointer(e) {
  const el = e.target.closest(".key");
  if (!el) return;
  releaseOffset(parseInt(el.dataset.offset, 10));
}

// --- Computer keyboard ---
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (e.target.closest?.("input, select, textarea")) return; // typing in a control

  if (remapMode && remapTargetOffset !== null && !e.repeat) {
    if (key === "escape") { cancelRemap(); return; }
    bindKey(key, remapTargetOffset);
    e.preventDefault();
    return;
  }
  if (key === "escape" && remapMode) { cancelRemap(); return; }

  if (e.repeat || heldKeys.has(key)) return;
  if (!(key in keyMap)) return;
  heldKeys.add(key);
  e.preventDefault();
  playOffset(keyMap[key], "keyboard");
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (!heldKeys.has(key)) return;
  heldKeys.delete(key);
  if (key in keyMap) releaseOffset(keyMap[key]);
});

// Releasing focus / leaving the tab should silence stuck notes.
window.addEventListener("blur", () => {
  for (const key of heldKeys) if (key in keyMap) releaseOffset(keyMap[key]);
  heldKeys.clear();
});

// ===========================================================================
// Remap workflow
// ===========================================================================
function enterRemap() {
  remapMode = true;
  remapBtn.classList.add("active");
  remapBtn.textContent = "Stop remapping";
  remapTargetOffset = null;
  showHint("Remap mode: click a piano key, then press the computer key to bind it. Press Esc to cancel.");
}

function exitRemap() {
  remapMode = false;
  remapBtn.classList.remove("active");
  remapBtn.textContent = "Remap keys";
  clearRemapTarget();
  hideHint();
}

function selectRemapTarget(offset) {
  clearRemapTarget();
  remapTargetOffset = offset;
  offsetToEl.get(offset)?.classList.add("remap-target");
  showHint(`Now press a computer key to bind to ${notes[offset].name}. Press Esc to cancel.`);
}

function bindKey(key, offset) {
  // Remove any existing binding of this key, then assign.
  delete keyMap[key];
  keyMap[key] = offset;
  saveKeyMap();
  refreshKeyLabels();
  clearRemapTarget();
  showHint(`Bound "${key}" to ${notes[offset].name}. Click another key, or click "Stop remapping".`);
}

function clearRemapTarget() {
  if (remapTargetOffset !== null) {
    offsetToEl.get(remapTargetOffset)?.classList.remove("remap-target");
  }
  remapTargetOffset = null;
}

function cancelRemap() { clearRemapTarget(); showHint('Remap mode: click a piano key to choose what to bind. Press "Stop remapping" when done.'); }

function showHint(text) { remapHint.textContent = text; remapHint.hidden = false; }
function hideHint() { remapHint.hidden = true; }

// ===========================================================================
// Controls wiring
// ===========================================================================
remapBtn.addEventListener("click", () => (remapMode ? exitRemap() : enterRemap()));
resetBtn.addEventListener("click", resetKeyMap);
volumeInput.addEventListener("input", applyVolume);
showNotesCb.addEventListener("change", applyLabelVisibility);
showKeysCb.addEventListener("change", applyLabelVisibility);

function rebuild() {
  buildNotes();
  renderPiano();
}
octavesSel.addEventListener("change", rebuild);
startOctaveSel.addEventListener("change", rebuild);
fullPianoCb.addEventListener("change", () => {
  // In full-piano mode the octave/start selectors don't apply.
  octavesSel.disabled = fullPianoCb.checked;
  startOctaveSel.disabled = fullPianoCb.checked;
  rebuild();
});
window.addEventListener("resize", applyKeySizing);

engineSel.addEventListener("change", async () => {
  try { localStorage.setItem(INSTRUMENT_KEY, engineSel.value); } catch (_) { /* ignore */ }
  await ensureAudio();
  loadSelectedInstrument();
});

function setSampleStatus(kind, text) {
  sampleStatus.hidden = false;
  sampleStatus.className = "status " + kind;
  sampleStatus.textContent = text;
}

// ===========================================================================
// Hooks for trainer.js
// ===========================================================================
const PianoUI = {
  onNoteOn: null,                       // set by the trainer: (midi) => void
  instrument: () => engineSel.value,
  // Mark the key the singer is currently on (midi may be fractional).
  setSung(midi, inTune) {
    for (const el of pianoEl.querySelectorAll(".key.sung")) el.classList.remove("sung", "in-tune");
    if (midi === null || !notes.length) return;
    const el = offsetToEl.get(Math.round(midi) - notes[0].midi);
    if (el) el.classList.add("sung", ...(inTune ? ["in-tune"] : []));
  },
  // Mark the note the singer should be on.
  setTarget(midi) {
    for (const el of pianoEl.querySelectorAll(".key.target")) el.classList.remove("target");
    if (midi === null || !notes.length) return;
    offsetToEl.get(Math.round(midi) - notes[0].midi)?.classList.add("target");
  },
};

// ===========================================================================
// Init
// ===========================================================================
populateInstruments();
rebuild();
// Start fetching samples right away so the first key press sounds right.
loadSelectedInstrument();
