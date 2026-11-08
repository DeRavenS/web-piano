# 🎹 Web Piano

A browser piano you can play with your mouse or computer keyboard. Built with plain
HTML, CSS, and JavaScript — no build step, no install.

## Features

- Realistic piano-key layout (white + overlaid black keys), 1–7 octaves or the full
  88-key range (A0–C8). Play with **mouse/touch** or **computer keyboard**; remappable keys.
- **Swappable sounds**, each covering the whole 88-key range:
  - **Grand piano** — [Salamander Grand Piano](https://github.com/tambien/Piano) samples
  - **Acoustic guitar** and **Electric guitar** — samples from
    [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) (CC-BY 3.0)
  - **Voice "Aah" / "Ooh" / hum** and **Choir** — synthesized singing voice
    (formant synthesis with natural vibrato), so it works at any pitch
  - **Piano synth** and **Plucked guitar synth** — fully offline fallbacks
  - All samples are bundled in `samples/`; sampled sounds fall back to a synth until loaded.
- **🎤 Free play** — play any key to set a target note, sing it and watch your voice drawn
  live against the target on a scrolling pitch graph (green = in tune). Shows the note
  you're singing, Hz, cents sharp/flat on a tuning meter, and your accuracy over the last
  5 seconds. Extras: random-note challenge, replay, and a sustained drone of the target.
- **🏋️ Vocal exercises** — 80 Pitchy-Ninja-style exercises, transposed through your range
  rep by rep and scored per note:
  - *Warm-ups*: hums, lip trills, five-tone scale, sirens, slides, sighs
  - *Scales*: major, all three minors, pentatonics, blues, whole-tone, chromatic, modes,
    Rossini 9-note, scale in thirds
  - *Arpeggios*: major/minor/dim/aug/sus4, 7th chords, octave jumps, extended arpeggios
  - *Intervals*: every interval from minor 2nd to octave, ascending and descending
  - *Agility & runs*: fast runs, triplets, turns, riffs, staccato
  - *Sustain & control*: long tones, step-and-hold glides, semitone steps
  - *Ear training*: random note, random interval, echo random melodies (hear, then sing)
  - *Range finder*: measures your lowest/highest held notes and saves your range
  - Options: tempo, guide mode (play along / hear then sing / starting note only),
    repetitions, transposition direction, start note. Results show a star rating,
    per-rep scores, whether you tend sharp or flat, and your best score per exercise.
- **Voice settings**: voice-type presets (bass → soprano) or custom range, accuracy
  tolerance (±15¢ to ±60¢), "any octave counts", mic sensitivity.
- While the mic is on, the key you're singing lights up on the keyboard (green when in
  tune) and the target key is marked in orange — in every tab.

**Use headphones** for singing practice, otherwise the mic also hears the reference notes.

## Running it

### Quickest (synth only)
Double-click **`index.html`** to open it in your browser. The synth engine works
immediately from a `file://` URL.

### Recommended (enables realistic piano samples)
Browsers block reading the local sample files from a `file://` page (CORS), even though
the files live in this folder. Serve the folder over HTTP instead — from inside
`piano-app/`:

```bash
python -m http.server 8000
```

Or just double-click **`start-piano.bat`**, which does this and opens
<http://localhost:8000>. Serving over localhost is also what lets the browser use your
microphone. Everything runs offline — samples load from `samples/`, not the internet.

## Default keyboard layout

The lower QWERTY row is the white keys, the row above is the black keys (relative to
the lowest note shown):

```
white:  A S D F G H J K L ;
black:   W E   T Y U   O P
```

So `A` = the first C, `W` = C#, `S` = D, and so on.

## Remapping keys

1. Click **Remap keys**.
2. Click a piano key on screen (it highlights).
3. Press the computer key you want to bind to it.
4. Repeat for other keys, then click **Stop remapping**. Press **Esc** to cancel a binding.
5. **Reset mapping** restores the default layout.

## Tech notes

- Audio starts only after your first click/keypress (browser autoplay policy).
- No backend and no network calls; settings and best scores are kept in `localStorage`.
- Pitch detection uses the McLeod Pitch Method (`pitch.js`), accurate to about ±2 cents.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup: tabs, controls, trainer panels |
| `style.css`  | Piano, trainer and exercise styles |
| `audio.js`   | Shared audio engine: samplers, voice/guitar synths, metronome, microphone |
| `pitch.js`   | Pitch detection from the microphone |
| `exercises.js` | The vocal exercise library |
| `app.js`     | Keyboard: note model, input handling, key mapping |
| `trainer.js` | Free play, exercise runner/scoring, range finder, pitch graph |
