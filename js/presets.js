// Parametric generators for the starting control cages.
// Ship coordinates (metres): x fore-and-aft (stern ≈ 0 → bow +),
// y half-breadth (starboard +, centreplane = 0), z height above baseline.
// Only the starboard half is modelled; the port side is its mirror image.

export const NI = 11; // control rows along the hull (stern → bow)
export const NJ = 7;  // control points per half-section (keel → sheer)

const clamp01 = (t) => Math.max(0, Math.min(1, t));

export const PRESETS = {
  cargo: {
    label: 'Cargo ship', blurb: 'Full, boxy form: flat floors, hard bilge, long parallel middle body.',
    L: 120, B: 20, D: 11,
    nMid: 10, nEnd: 3,
    run: 0.30, entrance: 0.24, pRun: 2.0, pEnt: 2.6,
    sheerAft: 0.6, sheerFwd: 2.0,
    stemRake: 4, stemShape: 'straight', sternRake: 3, transom: 0.62, cutUp: 0.42,
    tumble: 0, vName: 'MV Exemplar',
  },
  clipper: {
    label: 'Clipper ship', blurb: 'Sharp, hollow entrance, rising floors, raked clipper bow (c. 1850–70).',
    L: 64, B: 11, D: 6.8,
    nMid: 1.9, nEnd: 1.25,
    run: 0.48, entrance: 0.52, pRun: 1.5, pEnt: 1.15,
    sheerAft: 0.8, sheerFwd: 1.4,
    stemRake: 7.5, stemShape: 'clipper', sternRake: 4.5, transom: 0.28, cutUp: 0.08,
    tumble: 0.04, vName: 'Clipper',
  },
  sleek: {
    label: 'Sleek & sharp', blurb: 'Light, fine-ended V-bottom hull with a raked stem and wide transom.',
    L: 18, B: 3.8, D: 2.1,
    nMid: 1.6, nEnd: 1.15,
    run: 0.56, entrance: 0.44, pRun: 1.4, pEnt: 1.1,
    sheerAft: 0.05, sheerFwd: 0.45,
    stemRake: 1.6, stemShape: 'straight', sternRake: 0.3, transom: 0.7, cutUp: 0.18,
    tumble: 0, vName: 'Sleek',
  },
  warship: {
    label: '18th-c. warship', blurb: 'Wide, round, full-bowed hull with tumblehome and a high stern (74-gun type).',
    L: 54, B: 14.8, D: 8.6,
    nMid: 2.7, nEnd: 1.7,
    run: 0.56, entrance: 0.36, pRun: 1.6, pEnt: 2.2,
    sheerAft: 2.4, sheerFwd: 1.1,
    stemRake: 3.2, stemShape: 'forefoot', sternRake: 2.4, transom: 0.52, cutUp: 0.0,
    tumble: 0.2, vName: 'Warship',
  },
  simple: {
    label: 'Simple (start here)', blurb: 'A plain double-ended form to practise fairing from scratch.',
    L: 20, B: 5, D: 2.6,
    nMid: 3, nEnd: 2,
    run: 0.5, entrance: 0.5, pRun: 1.5, pEnt: 1.5,
    sheerAft: 0.3, sheerFwd: 0.3,
    stemRake: 0.6, stemShape: 'straight', sternRake: 0.6, transom: 0, cutUp: 0,
    tumble: 0, vName: 'Practice hull',
  },
};

// Quarter superellipse from keel (0, k) to sheer (b, H), resampled at equal arc length.
function sectionPoints(b, k, H, n, count) {
  const N = 240, raw = [];
  for (let s = 0; s <= N; s++) {
    const th = (s / N) * Math.PI / 2;
    const y = b * Math.pow(Math.sin(th), 2 / n);
    const z = H - (H - k) * Math.pow(Math.cos(th), 2 / n);
    raw.push([y, z]);
  }
  const cum = [0];
  for (let s = 1; s <= N; s++) cum.push(cum[s - 1] + Math.hypot(raw[s][0] - raw[s - 1][0], raw[s][1] - raw[s - 1][1]));
  const out = [];
  for (let j = 0; j < count; j++) {
    const target = (j / (count - 1)) * cum[N];
    let s = 1;
    while (s < N && cum[s] < target) s++;
    const t = (target - cum[s - 1]) / Math.max(1e-12, cum[s] - cum[s - 1]);
    out.push([raw[s - 1][0] + t * (raw[s][0] - raw[s - 1][0]), raw[s - 1][1] + t * (raw[s][1] - raw[s - 1][1])]);
  }
  return out;
}

function fullness(P, t) {
  if (t > 1 - P.entrance) return 1 - Math.pow(clamp01((t - (1 - P.entrance)) / P.entrance), P.pEnt);
  if (t < P.run) return 1 - Math.pow(clamp01((P.run - t) / P.run), P.pRun);
  return 1;
}

function stemShift(P, s) {
  switch (P.stemShape) {
    case 'clipper': return P.stemRake * Math.pow(s, 1.6);
    case 'forefoot': return P.stemRake * (1 - Math.pow(1 - s, 2.6));
    default: return P.stemRake * Math.pow(s, 0.9);
  }
}

export function makePreset(key) {
  const P = PRESETS[key];
  const Lk = P.L - P.stemRake - P.sternRake; // keel length
  const pts = [];
  for (let i = 0; i < NI; i++) {
    const t = i / (NI - 1);
    const H = P.D + P.sheerAft * Math.pow(clamp01((0.5 - t) / 0.5), 2) + P.sheerFwd * Math.pow(clamp01((t - 0.5) / 0.5), 2);
    const f = fullness(P, t);
    const n = P.nEnd + (P.nMid - P.nEnd) * Math.sqrt(f);
    const keelZ = P.cutUp * P.D * Math.pow(clamp01((0.2 - t) / 0.2), 2);
    let b = (P.B / 2) * f;
    const isStern = i === 0, isStem = i === NI - 1;
    if (isStern) b = (P.B / 2) * P.transom;
    if (isStem) b = 0;
    const sec = sectionPoints(Math.max(b, 1e-6), keelZ, H, isStern ? Math.max(P.nMid, 2) : n, NJ);
    const row = [];
    for (let j = 0; j < NJ; j++) {
      let [y, z] = sec[j];
      const s = clamp01((z - keelZ) / Math.max(1e-6, H - keelZ));
      if (P.tumble > 0 && s > 0.6) y *= 1 - P.tumble * Math.pow((s - 0.6) / 0.4, 2);
      let x = P.sternRake + t * Lk;
      // lean the upper parts of the end sections out towards the overhangs
      const wF = Math.pow(clamp01((t - 0.62) / 0.38), 2);
      const wA = Math.pow(clamp01((0.38 - t) / 0.38), 2);
      x += stemShift(P, s) * wF - P.sternRake * Math.pow(s, 1.2) * wA;
      if (isStem || j === 0 || (isStern && P.transom === 0)) y = 0;
      row.push({ x, y, z });
    }
    pts.push(row);
  }
  return {
    version: 1, preset: key, type: P.label, name: P.vName,
    ni: NI, nj: NJ, pts,
    sternClosed: P.transom === 0,
  };
}

/** Points that must stay on the centreplane (y = 0). */
export function isLocked(cage, i, j) {
  return j === 0 || i === cage.ni - 1 || (i === 0 && cage.sternClosed);
}

export function cloneCage(c) {
  return JSON.parse(JSON.stringify(c));
}
