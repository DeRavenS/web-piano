// ===========================================================================
// audio.js — one shared Web Audio context for every sound in the app.
//   * Sampled instruments (piano, acoustic + electric guitar) are loaded from
//     samples/ and re-pitched to cover the full 88-key range A0–C8.
//   * Synth instruments (piano synth, plucked-string guitar, voice "Aah"/"Ooh",
//     choir) are generated live, so they work offline and at any pitch.
//   * The microphone is analysed on the same context so pitch traces line up
//     with scheduled notes.
// Every instrument shares one API:
//   const v = AudioEngine.play(id, midi, when?, { gain })
//   v.glide(toMidi, t0, t1); v.stop(when?)
// ===========================================================================

const AudioEngine = (() => {
  let ctx = null;
  let master = null;
  let volume = 0.7;

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // A source node may only be stopped once; a voice can be stopped early
  // (exercise cancelled) after its normal stop was already scheduled.
  function safeStop(node, when) {
    try { node.stop(when); } catch (_) { /* already stopped */ }
  }

  function context() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    // A gentle compressor keeps chords / choir voices from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(comp).connect(ctx.destination);
    return ctx;
  }

  async function resume() {
    context();
    if (ctx.state === "suspended") await ctx.resume();
  }

  function now() { return context().currentTime; }

  function setVolume(frac) {
    volume = frac;
    if (master) master.gain.setTargetAtTime(frac, ctx.currentTime, 0.02);
  }

  // -------------------------------------------------------------------------
  // Sampler
  // -------------------------------------------------------------------------
  const NOTE_INDEX = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };

  function fileToMidi(name) {
    const m = name.match(/^([A-G]s?)(\d)$/);
    return (parseInt(m[2], 10) + 1) * 12 + NOTE_INDEX[m[1]];
  }

  function makeSampler({ dir, files, release = 1, gain = 1 }) {
    const buffers = []; // { midi, buffer } sorted by midi
    let status = "idle"; // idle | loading | ready | error
    let promise = null;

    function load() {
      if (promise) return promise;
      status = "loading";
      const c = context();
      promise = Promise.all(files.map(async (f) => {
        const res = await fetch(`${dir}/${f}.mp3`);
        if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
        const buffer = await c.decodeAudioData(await res.arrayBuffer());
        buffers.push({ midi: fileToMidi(f), buffer });
      })).then(() => {
        buffers.sort((a, b) => a.midi - b.midi);
        status = "ready";
      }, (err) => {
        status = "error";
        throw err;
      });
      return promise;
    }

    function nearest(midi) {
      let best = buffers[0];
      for (const b of buffers) if (Math.abs(b.midi - midi) < Math.abs(best.midi - midi)) best = b;
      return best;
    }

    function start(midi, when, opts) {
      const c = context();
      const s = nearest(midi);
      const src = c.createBufferSource();
      src.buffer = s.buffer;
      src.playbackRate.setValueAtTime(Math.pow(2, (midi - s.midi) / 12), when);
      const g = c.createGain();
      g.gain.setValueAtTime((opts.gain ?? 0.9) * gain, when);
      src.connect(g).connect(master);
      src.start(when);
      return {
        glide(toMidi, t0, t1) {
          src.playbackRate.setValueAtTime(src.playbackRate.value, t0);
          src.playbackRate.exponentialRampToValueAtTime(Math.pow(2, (toMidi - s.midi) / 12), t1);
        },
        stop(t) {
          g.gain.cancelScheduledValues(t);
          g.gain.setTargetAtTime(0, t, release / 4);
          safeStop(src, t + release * 1.5);
        },
      };
    }

    return { load, start, get status() { return status; } };
  }

  // -------------------------------------------------------------------------
  // Synth voices
  // -------------------------------------------------------------------------

  // Triangle-wave "piano" (the original offline engine).
  function startPianoSynth(midi, when, opts) {
    const c = context();
    const osc = c.createOscillator();
    const g = c.createGain();
    const peak = 0.9 * (opts.gain ?? 0.9);
    osc.type = "triangle";
    osc.frequency.setValueAtTime(midiToFreq(midi), when);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.01);
    g.gain.exponentialRampToValueAtTime(peak * 0.45, when + 0.4);
    osc.connect(g).connect(master);
    osc.start(when);
    return {
      glide(toMidi, t0, t1) {
        osc.frequency.setValueAtTime(osc.frequency.value, t0);
        osc.frequency.exponentialRampToValueAtTime(midiToFreq(toMidi), t1);
      },
      stop(t) {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, 0.03);
        safeStop(osc, t + 0.3);
      },
    };
  }

  // Karplus–Strong plucked string: a burst of noise fed through a decaying
  // delay line. Rendered once per note into a buffer and cached.
  const pluckCache = new Map();
  function pluckBuffer(midi) {
    if (pluckCache.has(midi)) return pluckCache.get(midi);
    const c = context();
    const sr = c.sampleRate;
    const f = midiToFreq(midi);
    const period = Math.max(2, Math.round(sr / f));
    const t60 = Math.min(4, Math.max(0.6, 4 - (midi - 40) * 0.06));
    const len = Math.floor(sr * t60);
    const buf = c.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const rho = Math.pow(0.001, period / (sr * t60)); // per-period loss -> ~t60 decay
    let lp = 0;
    for (let i = 0; i < period; i++) {
      lp += 0.5 * ((Math.random() * 2 - 1) - lp); // soften the pick attack
      d[i] = lp;
    }
    for (let i = period; i < len; i++) {
      d[i] = rho * 0.5 * (d[i - period] + d[i - period - 1 >= 0 ? i - period - 1 : 0]);
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < len; i++) d[i] *= 0.7 / peak;
    // The averaging filter adds half a sample of delay; correct the pitch on playback.
    const entry = { buffer: buf, rate: f / (sr / (period + 0.5)) };
    pluckCache.set(midi, entry);
    return entry;
  }

  function startPluck(midi, when, opts) {
    const c = context();
    const p = pluckBuffer(Math.round(midi));
    const src = c.createBufferSource();
    src.buffer = p.buffer;
    src.playbackRate.setValueAtTime(p.rate * Math.pow(2, (midi - Math.round(midi)) / 12), when);
    const g = c.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.9, when);
    src.connect(g).connect(master);
    src.start(when);
    return {
      glide(toMidi, t0, t1) {
        src.playbackRate.setValueAtTime(src.playbackRate.value, t0);
        src.playbackRate.exponentialRampToValueAtTime(p.rate * Math.pow(2, (toMidi - Math.round(midi)) / 12), t1);
      },
      stop(t) {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, 0.08);
        safeStop(src, t + 0.5);
      },
    };
  }

  // Formant voice: sawtooth "vocal folds" shaped by band-pass "vocal tract"
  // filters at vowel formant frequencies, with delayed natural vibrato.
  const VOWELS = {
    aah: [[800, 1.0, 80], [1150, 0.55, 90], [2900, 0.14, 120], [3900, 0.07, 130]],
    ooh: [[350, 1.0, 60], [600, 0.35, 70], [2700, 0.05, 100], [3300, 0.03, 120]],
    mmm: [[280, 1.0, 50], [1000, 0.08, 120], [2200, 0.02, 150]],
  };

  function startVoice(midi, when, opts, vowel, choir) {
    const c = context();
    const f = midiToFreq(midi);
    const detunes = choir ? [-11, 0, 9, 4] : [0];
    const level = (opts.gain ?? 0.9) * (choir ? 0.45 : 0.75);

    const out = c.createGain();
    out.gain.setValueAtTime(0, when);
    out.gain.linearRampToValueAtTime(level, when + (choir ? 0.18 : 0.09));
    out.connect(master);

    const source = c.createGain();
    source.gain.value = 1 / detunes.length;

    // Vibrato fades in after ~0.4 s like a real singer.
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.4;
    const lfoDepth = c.createGain();
    lfoDepth.gain.setValueAtTime(0, when);
    lfoDepth.gain.setValueAtTime(0, when + 0.35);
    lfoDepth.gain.linearRampToValueAtTime(22, when + 0.9); // cents
    lfo.connect(lfoDepth);
    lfo.start(when);

    const oscs = detunes.map((d) => {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f, when);
      o.detune.value = d;
      lfoDepth.connect(o.detune);
      o.connect(source);
      o.start(when);
      return o;
    });

    // Keep the fundamental present even when it sits above the first formant
    // (high soprano notes), otherwise the band-passes would filter it out.
    const body = c.createBiquadFilter();
    body.type = "lowpass";
    body.frequency.setValueAtTime(Math.max(400, f * 1.6), when);
    const bodyGain = c.createGain();
    bodyGain.gain.value = 0.35;
    source.connect(body).connect(bodyGain).connect(out);

    for (const [fr, g, bw] of VOWELS[vowel]) {
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      const centre = Math.max(fr, f * 1.05);
      bp.frequency.value = centre;
      bp.Q.value = centre / bw;
      const fg = c.createGain();
      fg.gain.value = g * 3;
      source.connect(bp).connect(fg).connect(out);
    }

    return {
      glide(toMidi, t0, t1) {
        for (const o of oscs) {
          o.frequency.setValueAtTime(o.frequency.value, t0);
          o.frequency.exponentialRampToValueAtTime(midiToFreq(toMidi), t1);
        }
      },
      stop(t) {
        out.gain.cancelScheduledValues(t);
        out.gain.setTargetAtTime(0, t, 0.07);
        for (const o of oscs) safeStop(o, t + 0.6);
        safeStop(lfo, t + 0.6);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Instrument registry
  // -------------------------------------------------------------------------
  const SALAMANDER = ["A0"];
  for (let o = 1; o <= 7; o++) SALAMANDER.push(`C${o}`, `Ds${o}`, `Fs${o}`, `A${o}`);
  SALAMANDER.push("C8");

  const INSTRUMENTS = {
    piano: {
      label: "Grand piano (samples)",
      sampler: makeSampler({ dir: "samples/salamander", files: SALAMANDER, release: 1 }),
      fallback: "pianoSynth",
    },
    pianoSynth: { label: "Piano (synth, offline)", start: startPianoSynth },
    guitar: {
      label: "Acoustic guitar (samples)",
      sampler: makeSampler({
        dir: "samples/guitar-acoustic",
        files: ["D2", "F2", "Gs2", "B2", "D3", "F3", "Gs3", "B3", "D4", "F4", "Gs4", "B4", "D5"],
        release: 0.35, gain: 1.1,
      }),
      fallback: "pluck",
    },
    eguitar: {
      label: "Electric guitar (samples)",
      sampler: makeSampler({
        dir: "samples/guitar-electric",
        files: ["Cs2", "E2", "Fs2", "A2", "C3", "Ds3", "Fs3", "A3", "C4", "Ds4", "Fs4", "A4", "C5", "Ds5", "Fs5", "A5", "C6"],
        release: 0.3, gain: 0.9,
      }),
      fallback: "pluck",
    },
    pluck: { label: "Plucked guitar (synth, offline)", start: startPluck },
    voiceAah: { label: "Voice – \"Aah\"", start: (m, w, o) => startVoice(m, w, o, "aah", false) },
    voiceOoh: { label: "Voice – \"Ooh\"", start: (m, w, o) => startVoice(m, w, o, "ooh", false) },
    voiceHum: { label: "Voice – hum \"Mmm\"", start: (m, w, o) => startVoice(m, w, o, "mmm", false) },
    choir: { label: "Choir – \"Aah\"", start: (m, w, o) => startVoice(m, w, o, "aah", true) },
  };

  // Start loading an instrument's samples (no-op for synths). Resolves with
  // the final status: "ready", "synth" or "error".
  async function load(id) {
    const inst = INSTRUMENTS[id];
    if (!inst || !inst.sampler) return "synth";
    try { await inst.sampler.load(); return "ready"; } catch (e) { console.warn(e); return "error"; }
  }

  function play(id, midi, when, opts = {}) {
    const c = context();
    const t = when ?? c.currentTime;
    let inst = INSTRUMENTS[id] || INSTRUMENTS.pianoSynth;
    if (inst.sampler) {
      if (inst.sampler.status === "ready") return inst.sampler.start(midi, t, opts);
      if (inst.sampler.status === "idle") load(id);
      inst = INSTRUMENTS[inst.fallback]; // play the synth stand-in until samples arrive
    }
    return inst.start(midi, t, opts);
  }

  // Metronome tick for count-ins.
  function click(when, accent) {
    const c = context();
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = accent ? 1600 : 1100;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.5, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    o.connect(g).connect(master);
    o.start(when);
    safeStop(o, when + 0.08);
  }

  // -------------------------------------------------------------------------
  // Microphone
  // -------------------------------------------------------------------------
  let mic = null;
  async function openMic() {
    if (mic) return mic;
    await resume();
    // Browser voice processing (echo cancel / noise suppression / AGC) smears
    // pitch, so ask for the raw signal. Headphones avoid the piano bleeding in.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    mic = { stream, analyser, buffer: new Float32Array(analyser.fftSize) };
    return mic;
  }

  function closeMic() {
    if (!mic) return;
    mic.stream.getTracks().forEach((t) => t.stop());
    mic = null;
  }

  return {
    INSTRUMENTS, context, resume, now, setVolume, load, play, click,
    openMic, closeMic, get mic() { return mic; }, midiToFreq,
  };
})();
