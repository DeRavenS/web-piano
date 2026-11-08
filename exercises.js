// ===========================================================================
// exercises.js — vocal exercise library.
// A pattern is a list of steps { o, b, g? }:
//   o = semitones above the exercise root (null = rest)
//   b = length in beats
//   g = optional glide target (semitones) — the pitch slides from o to g
// Fixed patterns are transposed up/down the singer's range rep by rep.
// Exercises with gen(rng, lo, hi) build a fresh random pattern each rep
// (ear training) and return { root, notes }.
// ===========================================================================

const Exercises = (() => {
  const S = {
    major: [0, 2, 4, 5, 7, 9, 11, 12],
    naturalMinor: [0, 2, 3, 5, 7, 8, 10, 12],
    harmonicMinor: [0, 2, 3, 5, 7, 8, 11, 12],
    melodicMinor: [0, 2, 3, 5, 7, 9, 11, 12],
    pentMajor: [0, 2, 4, 7, 9, 12],
    pentMinor: [0, 3, 5, 7, 10, 12],
    blues: [0, 3, 5, 6, 7, 10, 12],
    wholeTone: [0, 2, 4, 6, 8, 10, 12],
    dorian: [0, 2, 3, 5, 7, 9, 10, 12],
    phrygian: [0, 1, 3, 5, 7, 8, 10, 12],
    lydian: [0, 2, 4, 6, 7, 9, 11, 12],
    mixolydian: [0, 2, 4, 5, 7, 9, 10, 12],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  };

  // Notes of equal length with a longer final note.
  const seq = (offs, b = 1, last = 2) => offs.map((o, i) => ({ o, b: i === offs.length - 1 ? last : b }));
  // Up a list, then back down it without repeating the top.
  const upDown = (offs) => offs.concat(offs.slice(0, -1).reverse());
  // Short notes separated by rests.
  const staccato = (offs, b = 0.5, last = 2) => offs.flatMap((o, i) =>
    i === offs.length - 1 ? [{ o, b: last }] : [{ o, b }, { o: null, b }]);

  const list = [];
  const add = (cat, id, name, desc, notes, extra = {}) => list.push({ cat, id, name, desc, notes, ...extra });

  // ---- Warm-ups ------------------------------------------------------------
  const W = "Warm-ups";
  add(W, "hum-123", "Gentle hum 1-2-3-2-1", "Easy, narrow pattern to wake the voice up. Keep the lips closed and feel the buzz.",
    seq([0, 2, 4, 2, 0]), { hint: "Hum on \"mmm\"", tempo: 80 });
  add(W, "lip-trill-135", "Lip trill 1-3-5-3-1", "A major triad on a lip or tongue trill — balances airflow and frees the throat.",
    seq([0, 4, 7, 4, 0]), { hint: "Lip trill \"brrr\"", tempo: 90 });
  add(W, "five-tone", "Five-tone scale 1-2-3-4-5-4-3-2-1", "The classic warm-up. Keep every note connected and evenly loud.",
    seq(upDown([0, 2, 4, 5, 7])), { hint: "\"Ma-me-mi-mo-mu\"", tempo: 100 });
  add(W, "siren-octave", "Siren 1 ↗ 8 ↘ 1", "Slide smoothly up an octave and back. No bumps or breaks between registers.",
    [{ o: 0, g: 12, b: 3 }, { o: 12, g: 0, b: 3 }], { hint: "Slide on \"ng\" or \"woo\"", tempo: 80 });
  add(W, "siren-fifth", "Fifth slide 1 ↗ 5 ↘ 1", "A smaller siren — aim to land exactly on the top note.",
    [{ o: 0, g: 7, b: 2 }, { o: 7, b: 1 }, { o: 7, g: 0, b: 2 }, { o: 0, b: 1 }], { hint: "\"Wee-oo\"", tempo: 80 });
  add(W, "sigh", "Descending sigh 8 ↘ 1", "Start high and sigh all the way down an octave. Great for releasing tension.",
    [{ o: 12, b: 1 }, { o: 12, g: 0, b: 3 }, { o: 0, b: 1 }], { hint: "\"Haaah\"", tempo: 80 });
  add(W, "ng-151", "Ng pulses 1-5-1", "Simple leap on \"ng\" to place the voice forward.",
    seq([0, 7, 0], 1, 2), { hint: "\"Ng\"", tempo: 90 });
  add(W, "yawn-531", "Yawn-sigh 5-3-1", "Three descending notes with an open, yawning throat.",
    seq([7, 4, 0], 1, 2), { hint: "\"Ah\" with a yawn", tempo: 80 });

  // ---- Scales --------------------------------------------------------------
  const SC = "Scales";
  add(SC, "major", "Major scale", "One octave up and down. Keep the half steps (3-4 and 7-8) tight.", seq(upDown(S.major)), { tempo: 100 });
  add(SC, "natural-minor", "Natural minor scale", "Aeolian minor — note the lowered 3rd, 6th and 7th.", seq(upDown(S.naturalMinor)), { tempo: 100 });
  add(SC, "harmonic-minor", "Harmonic minor scale", "Minor with a raised 7th — watch the wide step between 6 and 7.", seq(upDown(S.harmonicMinor)), { tempo: 90 });
  add(SC, "melodic-minor", "Melodic minor scale", "Raised 6th and 7th going up, natural minor coming down.",
    seq(S.melodicMinor.concat(S.naturalMinor.slice(0, -1).reverse())), { tempo: 90 });
  add(SC, "pent-major", "Major pentatonic", "Five-note scale used in folk, pop and gospel.", seq(upDown(S.pentMajor)), { tempo: 100 });
  add(SC, "pent-minor", "Minor pentatonic", "The backbone of rock, blues and R&B riffs.", seq(upDown(S.pentMinor)), { tempo: 100 });
  add(SC, "blues", "Blues scale", "Minor pentatonic plus the \"blue\" flat-5.", seq(upDown(S.blues)), { tempo: 90 });
  add(SC, "whole-tone", "Whole-tone scale", "Every step is a whole tone — a real tuning challenge.", seq(upDown(S.wholeTone)), { tempo: 80 });
  add(SC, "chromatic-5", "Chromatic 1 to 5", "Every half step up to the 5th and back. Small, precise steps.",
    seq(upDown(S.chromatic.slice(0, 8)), 0.5, 2), { tempo: 80 });
  add(SC, "chromatic-octave", "Chromatic octave", "All twelve half steps up an octave and back down.",
    seq(upDown(S.chromatic), 0.5, 2), { tempo: 80 });
  add(SC, "dorian", "Dorian mode", "Minor with a bright raised 6th — jazz and funk favourite.", seq(upDown(S.dorian)), { tempo: 100 });
  add(SC, "phrygian", "Phrygian mode", "Minor with a dark flat 2nd — Spanish / flamenco sound.", seq(upDown(S.phrygian)), { tempo: 90 });
  add(SC, "lydian", "Lydian mode", "Major with a dreamy raised 4th.", seq(upDown(S.lydian)), { tempo: 100 });
  add(SC, "mixolydian", "Mixolydian mode", "Major with a flat 7th — rock and blues major.", seq(upDown(S.mixolydian)), { tempo: 100 });
  add(SC, "rossini", "Rossini 9-note scale", "Up to the 9th and back in one breath — builds range and breath control.",
    seq(upDown([0, 2, 4, 5, 7, 9, 11, 12, 14]), 0.5, 2), { tempo: 90 });
  add(SC, "thirds", "Scale in thirds", "1-3, 2-4, 3-5… Trains you to hear and pitch every third in the key.",
    seq([0, 4, 2, 5, 4, 7, 5, 9, 7, 11, 9, 12, 11, 14, 12], 0.5, 2), { tempo: 90 });
  add(SC, "descending-major", "Descending major 8-1", "Start at the top and walk down. Don't let the pitch sag as you descend.",
    seq(S.major.slice().reverse()), { tempo: 100 });

  // ---- Arpeggios -----------------------------------------------------------
  const AR = "Arpeggios";
  add(AR, "major-arp", "Major arpeggio 1-3-5-8-5-3-1", "The bread-and-butter arpeggio. Land each leap cleanly.", seq([0, 4, 7, 12, 7, 4, 0]), { tempo: 100 });
  add(AR, "minor-arp", "Minor arpeggio", "As above with a minor 3rd.", seq([0, 3, 7, 12, 7, 3, 0]), { tempo: 100 });
  add(AR, "dim-arp", "Diminished triad", "Two stacked minor thirds — tense and tricky.", seq([0, 3, 6, 3, 0]), { tempo: 90 });
  add(AR, "aug-arp", "Augmented triad", "Two stacked major thirds.", seq([0, 4, 8, 12, 8, 4, 0]), { tempo: 90 });
  add(AR, "sus4-arp", "Sus4 1-4-5-4-1", "Suspended fourth chord shape.", seq([0, 5, 7, 5, 0]), { tempo: 100 });
  add(AR, "dom7-arp", "Dominant 7th arpeggio", "1-3-5-♭7-8 and back.", seq([0, 4, 7, 10, 12, 10, 7, 4, 0]), { tempo: 100 });
  add(AR, "maj7-arp", "Major 7th arpeggio", "1-3-5-7-8 and back — the 7 sits a half step under the octave.", seq([0, 4, 7, 11, 12, 11, 7, 4, 0]), { tempo: 100 });
  add(AR, "min7-arp", "Minor 7th arpeggio", "1-♭3-5-♭7-8 and back.", seq([0, 3, 7, 10, 12, 10, 7, 3, 0]), { tempo: 100 });
  add(AR, "158", "1-5-8-5-1", "Open fifths and octave — no thirds to lean on.", seq([0, 7, 12, 7, 0]), { tempo: 90 });
  add(AR, "octave-jump", "Octave jump 1-8-1", "Leap straight to the octave without scooping.", seq([0, 12, 0], 1.5, 2), { tempo: 80 });
  add(AR, "ext-arp", "Extended arpeggio to the 10th", "1-3-5-8-10-8-5-3-1 — stretches the top of your range.",
    seq([0, 4, 7, 12, 16, 12, 7, 4, 0], 0.5, 2), { tempo: 90 });

  // ---- Intervals -----------------------------------------------------------
  const INTERVALS = [
    [1, "Minor 2nd"], [2, "Major 2nd"], [3, "Minor 3rd"], [4, "Major 3rd"], [5, "Perfect 4th"], [6, "Tritone"],
    [7, "Perfect 5th"], [8, "Minor 6th"], [9, "Major 6th"], [10, "Minor 7th"], [11, "Major 7th"], [12, "Octave"],
  ];
  for (const [i, nm] of INTERVALS) {
    add("Intervals – up", `int-up-${i}`, `${nm} up`, `Root, then a ${nm.toLowerCase()} above, then back to the root.`,
      [{ o: 0, b: 1.5 }, { o: i, b: 1.5 }, { o: 0, b: 2 }], { tempo: 80 });
  }
  for (const [i, nm] of INTERVALS) {
    add("Intervals – down", `int-down-${i}`, `${nm} down`, `Top note, then a ${nm.toLowerCase()} below, then back up.`,
      [{ o: i, b: 1.5 }, { o: 0, b: 1.5 }, { o: i, b: 2 }], { tempo: 80 });
  }

  // ---- Agility -------------------------------------------------------------
  const AG = "Agility & runs";
  add(AG, "fast-five", "Fast five-tone run", "1-2-3-4-5-4-3-2-1 in quick eighth notes. Keep it light.",
    seq(upDown([0, 2, 4, 5, 7]), 0.5, 2), { tempo: 110 });
  add(AG, "octave-run", "Octave scale run", "A full major scale up and down in eighth notes.", seq(upDown(S.major), 0.5, 2), { tempo: 100 });
  add(AG, "triplets", "Triplet scale 1-2-3, 2-3-4…", "Overlapping three-note groups climbing the scale.",
    seq([0, 2, 4, 2, 4, 5, 4, 5, 7, 5, 7, 9, 7, 9, 11, 9, 11, 12, 12], 1 / 3, 2), { tempo: 80 });
  add(AG, "turn", "Turn 1-2-1-7-1", "A small ornament — the building block of riffs.", seq([0, 2, 0, -1, 0], 0.5, 2), { tempo: 90 });
  add(AG, "cascade", "Pentatonic cascade 8-6-5-3-2-1", "Falling pentatonic riff, R&B style.", seq([12, 9, 7, 4, 2, 0], 0.5, 2), { tempo: 90 });
  add(AG, "staccato-135", "Staccato 1-3-5-3-1", "Short, bouncy notes from the diaphragm.", staccato([0, 4, 7, 4, 0]), { hint: "\"Ha! Ha! Ha!\"", tempo: 100 });
  add(AG, "staccato-repeat", "Staccato repeated note", "Five short hits on the same pitch — each one should start in tune.",
    staccato([0, 0, 0, 0, 0]), { hint: "\"Hey!\"", tempo: 100 });
  add(AG, "arp-run", "Fast arpeggio 1-3-5-8-5-3-1", "The major arpeggio at speed.", seq([0, 4, 7, 12, 7, 4, 0], 0.5, 2), { tempo: 110 });
  add(AG, "minor-riff", "Minor riff 5-♭7-8-♭7-5-4-♭3-1", "A soul-style minor pentatonic lick.", seq([7, 10, 12, 10, 7, 5, 3, 0], 0.5, 2), { tempo: 90 });

  // ---- Sustain / control ---------------------------------------------------
  const SU = "Sustain & control";
  add(SU, "long-tone", "Long tone (8 beats)", "Hold one note as steadily as you can. Aim for a flat line.", [{ o: 0, b: 8 }], { tempo: 80 });
  add(SU, "long-135", "Long tones 1-3-5", "Hold each note of the triad for four beats.", [{ o: 0, b: 4 }, { o: 4, b: 4 }, { o: 7, b: 4 }], { tempo: 80 });
  add(SU, "step-hold", "Step & hold 1 ↗ 2 ↘ 1", "Hold, slide a whole tone, hold — controlled pitch movement.",
    [{ o: 0, b: 2 }, { o: 0, g: 2, b: 1 }, { o: 2, b: 2 }, { o: 2, g: 0, b: 1 }, { o: 0, b: 2 }], { tempo: 80 });
  add(SU, "semitone-steps", "Semitone steps 1-♭2-2-♭2-1", "Tiny half-step moves — the hardest to pitch exactly.",
    seq([0, 1, 2, 1, 0], 1.5, 2), { tempo: 80 });

  // ---- Ear training (random, hear then sing) ------------------------------
  const ET = "Ear training";
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const rootFor = (rng, lo, hi, span) => lo + Math.floor(rng() * Math.max(1, hi - lo - span + 1));

  function randomMelody(rng, n, scale) {
    const degs = [0];
    let idx = 0;
    for (let i = 1; i < n; i++) {
      idx = Math.min(scale.length - 1, Math.max(0, idx + pick(rng, [-2, -1, 1, 1, 2, 3])));
      degs.push(scale[idx]);
    }
    return degs;
  }

  add(ET, "random-note", "Match a random note", "Hear a note anywhere in your range, then sing it back.", null,
    { forceMode: "listen", tempo: 80, gen: (rng, lo, hi) => ({ root: rootFor(rng, lo, hi, 0), notes: [{ o: 0, b: 3 }] }) });
  add(ET, "random-interval", "Random interval", "Hear two notes, then sing them back.", null,
    {
      forceMode: "listen", tempo: 80,
      gen: (rng, lo, hi) => {
        const i = pick(rng, [2, 3, 4, 5, 7, 8, 9, 12]);
        const up = rng() < 0.6;
        return up
          ? { root: rootFor(rng, lo, hi, i), notes: [{ o: 0, b: 1.5 }, { o: i, b: 2 }] }
          : { root: rootFor(rng, lo, hi, i), notes: [{ o: i, b: 1.5 }, { o: 0, b: 2 }] };
      },
    });
  add(ET, "echo-3", "Echo a 3-note melody", "A short random phrase in a major key. Listen, then echo it.", null,
    { forceMode: "listen", tempo: 90, gen: (rng, lo, hi) => ({ root: rootFor(rng, lo, hi, 12), notes: seq(randomMelody(rng, 3, S.major), 1, 2) }) });
  add(ET, "echo-5", "Echo a 5-note melody", "Longer random phrase — tests pitch memory.", null,
    { forceMode: "listen", tempo: 100, gen: (rng, lo, hi) => ({ root: rootFor(rng, lo, hi, 12), notes: seq(randomMelody(rng, 5, S.major), 1, 2) }) });
  add(ET, "echo-pent", "Echo a pentatonic phrase", "Six random notes from the major pentatonic.", null,
    { forceMode: "listen", tempo: 100, gen: (rng, lo, hi) => ({ root: rootFor(rng, lo, hi, 12), notes: seq(randomMelody(rng, 6, S.pentMajor), 0.75, 2) }) });
  add(ET, "echo-minor", "Echo a minor melody", "Five random notes from the natural minor scale.", null,
    { forceMode: "listen", tempo: 90, gen: (rng, lo, hi) => ({ root: rootFor(rng, lo, hi, 12), notes: seq(randomMelody(rng, 5, S.naturalMinor), 1, 2) }) });

  // ---- Range ---------------------------------------------------------------
  add("Range", "range-finder", "Find my vocal range", "Sing your lowest and highest comfortable notes. Your range is then used to place every exercise.",
    null, { special: "range" });

  // Lowest / highest semitone a pattern touches.
  function span(notes) {
    let lo = Infinity, hi = -Infinity;
    for (const n of notes) {
      for (const v of [n.o, n.g]) {
        if (v === null || v === undefined) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    return { lo, hi };
  }

  return { list, span };
})();
