// ===========================================================================
// pitch.js — monophonic pitch detection for the singing voice.
// McLeod Pitch Method (normalised square difference function) on a 2x
// decimated frame, with a loudness gate and a clarity threshold so breaths and
// background noise don't register as notes.
// ===========================================================================

const PitchDetector = (() => {
  let work = null;
  let nsdf = null;

  // Returns { freq, clarity, rms } or null when no clear pitch is present.
  function detect(input, sampleRate, { minFreq = 55, maxFreq = 1500, minRms = 0.01, minClarity = 0.82 } = {}) {
    // Loudness gate on the raw frame.
    let sumSq = 0;
    for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i];
    const rms = Math.sqrt(sumSq / input.length);
    if (rms < minRms) return null;

    // Decimate by 2 (pairwise average) — plenty of bandwidth for voice and it
    // cuts the O(n * lag) autocorrelation cost by 4x.
    const n = input.length >> 1;
    const sr = sampleRate / 2;
    if (!work || work.length !== n) { work = new Float32Array(n); nsdf = new Float32Array(n); }
    let mean = 0;
    for (let i = 0; i < n; i++) { work[i] = 0.5 * (input[2 * i] + input[2 * i + 1]); mean += work[i]; }
    mean /= n;
    for (let i = 0; i < n; i++) work[i] -= mean;

    const minLag = Math.max(2, Math.floor(sr / maxFreq));
    const maxLag = Math.min(n - 2, Math.ceil(sr / minFreq));

    for (let tau = 0; tau <= maxLag; tau++) {
      let acf = 0, m = 0;
      for (let i = 0, end = n - tau; i < end; i++) {
        const a = work[i], b = work[i + tau];
        acf += a * b;
        m += a * a + b * b;
      }
      nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
    }

    // Collect the highest peak of each positive lobe after the first
    // negative-going zero crossing.
    const peaks = [];
    let tau = 1;
    while (tau < maxLag && nsdf[tau] > 0) tau++;
    while (tau < maxLag) {
      while (tau < maxLag && nsdf[tau] <= 0) tau++;
      let best = -1, bestTau = -1;
      while (tau < maxLag && nsdf[tau] > 0) {
        if (nsdf[tau] > best) { best = nsdf[tau]; bestTau = tau; }
        tau++;
      }
      if (bestTau > 0) peaks.push(bestTau);
    }
    if (!peaks.length) return null;

    let globalMax = 0;
    for (const p of peaks) if (p >= minLag) globalMax = Math.max(globalMax, nsdf[p]);
    const threshold = 0.9 * globalMax;
    const chosen = peaks.find((p) => p >= minLag && nsdf[p] >= threshold);
    if (chosen === undefined || nsdf[chosen] < minClarity) return null;

    // Parabolic interpolation for sub-sample lag accuracy.
    const y0 = nsdf[chosen - 1], y1 = nsdf[chosen], y2 = nsdf[chosen + 1];
    const denom = y0 - 2 * y1 + y2;
    const shift = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
    const freq = sr / (chosen + shift);
    if (freq < minFreq || freq > maxFreq) return null;
    return { freq, clarity: y1, rms };
  }

  return { detect };
})();
