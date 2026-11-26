// Lofting a hull surface from traced lines.
//
// The student traces battens on a scanned lines plan:
//   profile: keel (heel → forefoot), stem (forefoot → head), sternpost (heel → top), sheer
//   plan:    deck line at the side (optional; otherwise the sections set the deck breadth)
//   end:     sections (keel → sheer), each at a known station position x
// Each batten is a centripetal Catmull–Rom spline through its points. The surface is
// lofted through the sections (plus the stem and sternpost as end "sections"), with the
// same girth parameter v (keel → sheer) on every section, then held to the traced keel,
// sheer and deck lines. The result is a regular grid {rows, cols, p} like a subdivided
// cage, so every other part of Shiplines (lines, hydrostatics, drawing, export) works on it.

export const CURVES = {
  keel: { view: 'profile', ax: ['x', 'z'], label: 'Keel', hint: 'Profile view: click along the <b>bottom of the keel</b>, from the heel (aft) to the forefoot.' },
  stem: { view: 'profile', ax: ['x', 'z'], label: 'Stem', hint: 'Profile view: click up the <b>stem</b>, from the forefoot to the stem head.' },
  stern: { view: 'profile', ax: ['x', 'z'], label: 'Sternpost', hint: 'Profile view: click up the <b>sternpost</b>, from the heel to its top (or the counter).' },
  sheer: { view: 'profile', ax: ['x', 'z'], label: 'Sheer', hint: 'Profile view: click along the <b>sheer line</b>, from stern to bow.' },
  deck: { view: 'plan', ax: ['x', 'y'], label: 'Deck line', hint: 'Plan view: click along the <b>deck line at the side</b>, the outermost line of the half-breadth plan.' },
  section: { view: 'body', ax: ['y', 'z'], label: 'Section', hint: 'End view: click along this <b>section</b> in the body plan, from the keel up to the sheer. Either side of the body plan works.' },
};

export const emptyTrace = () => ({ keel: [], stem: [], stern: [], sheer: [], deck: [], sections: [] });

/** What is still needed before a hull can be lofted. */
export function missing(T) {
  const m = [];
  for (const k of ['keel', 'stem', 'stern', 'sheer']) if (!T[k] || T[k].length < 2) m.push(CURVES[k].label.toLowerCase());
  const n = (T.sections || []).filter((s) => s.pts.length >= 3).length;
  if (n < 2) m.push(`${2 - n} more section${n === 1 ? '' : 's'} (3+ points each)`);
  return m;
}

// ---------------------------------------------------------------- splines
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); };
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Catmull–Rom (Barry–Goldman form) through P with knots T, evaluated at t. */
export function cr(P, T, t) {
  const n = P.length;
  if (n === 1) return [...P[0]];
  let i = 0;
  while (i < n - 2 && t > T[i + 1]) i++;
  const p1 = P[i], p2 = P[i + 1], t1 = T[i], t2 = T[i + 1];
  const p0 = i > 0 ? P[i - 1] : p1.map((v, k) => 2 * v - p2[k]);
  const t0 = i > 0 ? T[i - 1] : t1 - (t2 - t1);
  const p3 = i < n - 2 ? P[i + 2] : p2.map((v, k) => 2 * v - p1[k]);
  const t3 = i < n - 2 ? T[i + 2] : t2 + (t2 - t1);
  const f = (a, b, ta, tb) => (tb - ta < 1e-12 ? a : lerp(a, b, (t - ta) / (tb - ta)));
  const A1 = f(p0, p1, t0, t1), A2 = f(p1, p2, t1, t2), A3 = f(p2, p3, t2, t3);
  const B1 = f(A1, A2, t0, t2), B2 = f(A2, A3, t1, t3);
  return f(B1, B2, t1, t2);
}
const centripetal = (P) => { const T = [0]; for (let i = 1; i < P.length; i++) T.push(T[i - 1] + Math.max(1e-6, Math.sqrt(dist(P[i], P[i - 1])))); return T; };

/** Dense polyline through points: the digital batten. */
export function batten(pts, perSpan = 14) {
  const P = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-9);
  if (P.length < 2) return P.map((p) => [...p]);
  const T = centripetal(P), out = [];
  for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < perSpan; k++) out.push(cr(P, T, T[i] + ((T[i + 1] - T[i]) * k) / perSpan));
  out.push([...P[P.length - 1]]);
  return out;
}

/** Resample a polyline to n points at equal arc length. */
export function resample(poly, n) {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + dist(poly[i], poly[i - 1]));
  const L = cum[cum.length - 1], out = [];
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * L;
    let i = 1; while (i < poly.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-12, cum[i] - cum[i - 1]);
    out.push(lerp(poly[i - 1], poly[i], Math.max(0, Math.min(1, t))));
  }
  return out;
}

/** Value of coordinate `out` where coordinate `ax` == v on a polyline (null if outside). */
export function valueAt(poly, ax, v, out) {
  if (!poly || poly.length < 2) return null;
  let best = null, bd = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1][ax], b = poly[i][ax];
    if ((a - v) * (b - v) <= 0 && a !== b) {
      const r = poly[i - 1][out] + ((v - a) / (b - a)) * (poly[i][out] - poly[i - 1][out]);
      const d = Math.abs(i - poly.length / 2); // prefer the crossing nearest the middle
      if (d < bd) { bd = d; best = r; }
    }
  }
  return best;
}

// ---------------------------------------------------------------- loft
export function loftGrid(T, { nv = 25, rows = 72 } = {}) {
  if (missing(T).length) return null;
  const keel = batten(T.keel), sheer = batten(T.sheer);
  const deck = T.deck && T.deck.length >= 2 ? batten(T.deck) : null;
  const upward = (poly) => (poly[0][1] <= poly[poly.length - 1][1] ? poly : [...poly].reverse());
  const endRow = (pts) => resample(upward(batten(pts)), nv).map(([x, z]) => [x, 0, z]);
  const sternRow = endRow(T.stern), bowRow = endRow(T.stem);
  const xa = Math.max(...sternRow.map((p) => p[0])), xf = Math.min(...bowRow.map((p) => p[0]));

  // hold a row's ends to the keel (y = 0) and to the sheer / deck line, spreading the
  // correction linearly round the girth
  const hold = (row) => {
    const n = row.length, b = row[0], t = row[n - 1];
    const kz = valueAt(keel, 0, b[0], 1);
    const sz = valueAt(sheer, 0, t[0], 1), dy = deck ? valueAt(deck, 0, t[0], 1) : null;
    const db = [-b[1], kz == null ? 0 : kz - b[2]];
    const dt = [dy == null ? 0 : Math.abs(dy) - t[1], sz == null ? 0 : sz - t[2]];
    return row.map((p, j) => {
      const v = j / (n - 1);
      return [p[0], Math.max(0, p[1] + db[0] * (1 - v) + dt[0] * v), p[2] + db[1] * (1 - v) + dt[1] * v];
    });
  };

  const secs = T.sections.filter((s) => s.pts.length >= 3 && s.x > xa && s.x < xf).sort((a, b) => a.x - b.x).map((s) => {
    const d = upward(batten(s.pts.map(([y, z]) => [Math.abs(y), z])));
    return hold(resample(d, nv).map(([y, z]) => [s.x, y, z]));
  });
  if (secs.length < 2) return null;
  const R = [sternRow, ...secs, bowRow];

  // one knot vector for every girth line, from mean chord lengths between rows
  const K = [0];
  for (let r = 1; r < R.length; r++) {
    let d = 0; for (let j = 0; j < nv; j++) d += dist(R[r][j], R[r - 1][j]);
    K.push(K[r - 1] + Math.max(1e-6, Math.sqrt(d / nv)));
  }
  const cols = R[0].map((_, j) => R.map((row) => row[j]));
  const p = new Float64Array(rows * nv * 3);
  for (let i = 0; i < rows; i++) {
    const t = (i / (rows - 1)) * K[K.length - 1];
    let row = cols.map((C) => cr(C, K, t));
    if (i > 0 && i < rows - 1) row = hold(row);
    row.forEach((q, j) => p.set(q, (i * nv + j) * 3));
  }
  return { rows, cols: nv, p };
}

/** Example trace taken from computed hull lines, so the workflow can be tried without a scan. */
export function traceFromLines(lines) {
  const z0 = lines.bounds.z0;
  const pick = (poly, n, f) => { if (!poly || poly.length < 2) return []; const r = resample(poly, n); return r.map(f); };
  const o = lines.outline;
  const T = {
    keel: pick(o.keel, 9, (q) => [q[0], q[2] + z0]),
    stem: pick(o.stem, 6, (q) => [q[0], q[2] + z0]),
    stern: pick(o.stern, 5, (q) => [q[0], q[2] + z0]),
    sheer: pick(o.sheer, 10, (q) => [q[0], q[2] + z0]),
    deck: pick(o.sheer, 10, (q) => [q[0], q[1]]),
    sections: [],
  };
  lines.stations.forEach((s, k) => {
    const l = s.polylines.reduce((m, q) => (q.length > (m ? m.length : 0) ? q : m), null);
    if (l) T.sections.push({ id: k + 1, name: s.label === '⦶' ? 'Mid' : s.label, x: s.x, pts: pick(l, 7, (q) => [(s.fwd ? 1 : -1) * q[1], q[2] + z0]) });
  });
  return T;
}
