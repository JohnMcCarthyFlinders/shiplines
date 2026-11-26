// Parametric generators for the starting control cages.
// Ship coordinates (metres): x fore-and-aft (stern ≈ 0 → bow +),
// y half-breadth (starboard +, centreplane = 0), z height above baseline.
// Only the starboard half is modelled; the port side is its mirror image.

import { TEMPLATES } from './templates.js?v=24';

export const NI = 11; // control rows along the hull (stern → bow)
export const NJ = 7;  // control points per half-section (keel → sheer)

const clamp01 = (t) => Math.max(0, Math.min(1, t));

// Optional extras used by the period ships:
//   runTop/entTop/pRunTop/pEntTop – breadth at the sheer (deck) can stay full while the
//     underwater body (run/entrance) fines away, as on the Flying Fish or Victory lines;
//   hollow – wineglass (hollow-garboard) sections towards the ends;
//   blendTransom – aft deck breadth runs smoothly into the transom (no pinch at the stern).
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
    label: 'Clipper ship', blurb: 'Extreme clipper after the Flying Fish lines (McKay, 1851): long hollow entrance and run, firm midship section, raked cutwater and counter stern.',
    L: 63, B: 11.6, D: 6.9,
    nMid: 2.7, nEnd: 1.7,
    run: 0.47, entrance: 0.5, pRun: 1.35, pEnt: 1.2,
    runTop: 0.3, entTop: 0.36, pRunTop: 1.8, pEntTop: 1.55, hollow: 0.7, blendTransom: true,
    sheerAft: 0.7, sheerFwd: 1.6,
    stemRake: 4.6, stemShape: 'clipper', sternRake: 3.2, transom: 0.4, cutUp: 0.03,
    tumble: 0.03, vName: 'Flying Fish',
  },
  canoe: {
    label: 'Canoe', blurb: 'Light, sharp-ended open boat: rising floors, hollow entrance, raked stem.',
    L: 6.4, B: 1.1, D: 0.68,
    nMid: 1.9, nEnd: 1.25,
    run: 0.48, entrance: 0.52, pRun: 1.5, pEnt: 1.15,
    sheerAft: 0.08, sheerFwd: 0.14,
    stemRake: 0.75, stemShape: 'clipper', sternRake: 0.45, transom: 0.28, cutUp: 0.08,
    tumble: 0.04, vName: 'Canoe',
  },
  warship: {
    label: '18th-c. warship', blurb: 'Low, broad and stable gun platform in the manner of HMS Victory: bluff bow, full round body, tumblehome, fine run under a broad square stern.',
    L: 57, B: 15.8, D: 7.0,
    nMid: 2.9, nEnd: 1.7,
    run: 0.5, entrance: 0.36, pRun: 1.3, pEnt: 1.8,
    runTop: 0.18, entTop: 0.22, pRunTop: 1.6, pEntTop: 2.4, hollow: 0.7, blendTransom: true,
    sheerAft: 1.3, sheerFwd: 0.7,
    stemRake: 2.4, stemShape: 'forefoot', sternRake: 1.6, transom: 0.78, cutUp: 0.0,
    tumble: 0.16, vName: 'Victory',
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
  pie: {
    label: 'The Pie Floater', blurb: 'A joke, and Old Mouldy Lofterson’s pride: an Adelaide meat pie turned upside down. Nearly round in plan, a broad flat bottom and sides that draw in slightly towards the top. Very stable, not very streamlined.',
    L: 12, B: 11, D: 4.2, vName: 'The Pie Floater', custom: 'pie',
  },
};

// The Pie Floater: an upturned pie. Each control row is a radial "station" through the
// centre of the pie; the flat bottom runs out to the chine and the sides lean in a little,
// like the tin-shaped base of a pie with the lid underneath.
function makePie(P) {
  const Rx = P.L / 2, Ry = P.B / 2, D = P.D, k = 1.07; // k offsets the B-spline shrinkage
  const r = [0, 0.5, 0.86, 1.0, 0.975, 0.945, 0.915]; // radius at each control point, as a fraction
  const z = [0, 0, 0, 0.07, 0.4, 0.74, 1].map((f) => f * D);
  const bottom = [0, 0.5, 0.86];                    // j = 0..2 lie on the flat bottom
  const pts = [];
  for (let i = 0; i < NI; i++) {
    const ph = (Math.PI * i) / (NI - 1);             // stern (0) round to bow (π)
    const row = [];
    for (let j = 0; j < NJ; j++) {
      const rr = j < 3 ? 1 : r[j];                   // fore-and-aft position follows the chine on the bottom
      const x = Rx - Rx * rr * Math.cos(ph);
      const y = i === 0 || i === NI - 1 ? 0 : k * Ry * (j < 3 ? bottom[j] : r[j]) * Math.sin(ph);
      row.push({ x, y, z: z[j] });
    }
    pts.push(row);
  }
  return { version: 1, preset: 'pie', type: P.label, name: P.vName, ni: NI, nj: NJ, pts, sternClosed: true };
}

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

function profile(t, run, ent, pRun, pEnt, tr = 0) {
  if (t > 1 - ent) return 1 - Math.pow(clamp01((t - (1 - ent)) / ent), pEnt);
  if (t < run) return tr + (1 - tr) * (1 - Math.pow(clamp01((run - t) / run), pRun));
  return 1;
}
// underwater fullness (drives section shape)
const fullness = (P, t) => profile(t, P.run, P.entrance, P.pRun, P.pEnt);
// breadth at the sheer
const deckFullness = (P, t) => (P.runTop == null ? fullness(P, t)
  : profile(t, P.runTop, P.entTop, P.pRunTop, P.pEntTop, P.blendTransom ? P.transom : 0));

function stemShift(P, s) {
  switch (P.stemShape) {
    case 'clipper': return P.stemRake * Math.pow(s, 1.6);
    case 'forefoot': return P.stemRake * (1 - Math.pow(1 - s, 2.6));
    default: return P.stemRake * Math.pow(s, 0.9);
  }
}

export function makePreset(key) {
  const P = PRESETS[key];
  if (P.custom === 'pie') return makePie(P);
  const T = TEMPLATES[key];
  if (T) {
    // hand-faired template
    return {
      version: 1, preset: key, type: P.label, name: P.vName,
      ni: T.pts.length, nj: T.pts[0].length,
      pts: T.pts.map((row) => row.map(([x, y, z]) => ({ x, y, z }))),
      sternClosed: T.sternClosed,
    };
  }
  const Lk = P.L - P.stemRake - P.sternRake; // keel length
  const pts = [];
  for (let i = 0; i < NI; i++) {
    const t = i / (NI - 1);
    const H = P.D + P.sheerAft * Math.pow(clamp01((0.5 - t) / 0.5), 2) + P.sheerFwd * Math.pow(clamp01((t - 0.5) / 0.5), 2);
    const f = fullness(P, t), fd = deckFullness(P, t);
    const n = P.nEnd + (P.nMid - P.nEnd) * Math.sqrt(f);
    const hol = (P.hollow || 0) * (1 - f);
    const keelZ = P.cutUp * P.D * Math.pow(clamp01((0.2 - t) / 0.2), 2);
    let b = (P.B / 2) * fd;
    const isStern = i === 0, isStem = i === NI - 1;
    if (isStern) b = (P.B / 2) * P.transom;
    if (isStem) b = 0;
    const sec = sectionPoints(Math.max(b, 1e-6), keelZ, H, isStern ? Math.max(P.nMid, 2) : n, NJ);
    const row = [];
    for (let j = 0; j < NJ; j++) {
      let [y, z] = sec[j];
      const s = clamp01((z - keelZ) / Math.max(1e-6, H - keelZ));
      if (P.tumble > 0 && s > 0.6) y *= 1 - P.tumble * Math.pow((s - 0.6) / 0.4, 2);
      if (hol > 0 && !isStern) y *= 1 - hol * Math.pow(1 - s, 2.2); // wineglass / hollow garboards
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
