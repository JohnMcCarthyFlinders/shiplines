// Reference material for tracing and reconstruction:
//  · underlays — scanned lines plans placed behind the profile, plan or end view
//  · evidence  — recorded points / meshes from a wreck, checked against the hull
// All geometry here is in ship coordinates (metres): x fore-and-aft, y half-breadth, z height.

import { makePreset } from './presets.js?v=17';
import { gridFromCage, subdivide, gridBounds } from './subdiv.js?v=17';

// ======================================================================= view axes
// Each orthographic view shows two ship axes. (h, v) are distances to the screen's
// right and up, in metres; `s` is the sign that maps h or v onto the ship axis.
export function viewAxes(view, convention) {
  const st = convention === 'steffy';
  switch (view) {
    case 'profile': return { h: 'x', hs: st ? -1 : 1, v: 'z', vs: 1, d: 'y' };
    case 'plan': return { h: 'x', hs: st ? -1 : 1, v: 'y', vs: st ? 1 : -1, d: 'z' };
    case 'body': return { h: 'y', hs: -1, v: 'z', vs: 1, d: 'x' };
    default: return null;
  }
}
export function hvToShip(view, convention, h, v, depth = 0) {
  const a = viewAxes(view, convention);
  const p = { x: 0, y: 0, z: 0 };
  p[a.h] = h * a.hs; p[a.v] = v * a.vs; p[a.d] = depth;
  return p;
}
export function shipToHV(view, convention, p) {
  const a = viewAxes(view, convention);
  return [p[a.h] * a.hs, p[a.v] * a.vs];
}

// ======================================================================= underlays
// An underlay maps image pixels (px, py; y down) to view coordinates (h, v) by a
// similarity transform (scale, rotation, optional mirror, translation) set by
// two-point calibration, followed by a small fine-tuning adjustment about the
// image centre.
export function makeUnderlay(view, img, dataURL, name) {
  return {
    view, img, dataURL, name: name || 'plan', w: img.naturalWidth || img.width, h: img.naturalHeight || img.height,
    base: { s: 1, th: 0, flip: false, t: [0, 0] },
    adj: { dh: 0, dv: 0, k: 1, rot: 0 },
    opacity: 0.75, invert: true, visible: true, calibrated: false,
  };
}
function baseHV(u, px, py) {
  let x = px, y = -py;
  if (u.base.flip) x = -x;
  const c = Math.cos(u.base.th), s = Math.sin(u.base.th);
  return [u.base.s * (c * x - s * y) + u.base.t[0], u.base.s * (s * x + c * y) + u.base.t[1]];
}
export function imgToHV(u, px, py) {
  const p = baseHV(u, px, py), C = baseHV(u, u.w / 2, u.h / 2);
  const r = (u.adj.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), k = u.adj.k;
  const dx = p[0] - C[0], dy = p[1] - C[1];
  return [C[0] + k * (c * dx - s * dy) + u.adj.dh, C[1] + k * (s * dx + c * dy) + u.adj.dv];
}
/** Place an uncalibrated image so it spans `span` metres across, centred on (ch, cv). */
export function fitUnderlay(u, span, ch, cv) {
  u.base = { s: span / u.w, th: 0, flip: false, t: [0, 0] };
  const C = baseHV(u, u.w / 2, u.h / 2);
  u.base.t = [ch - C[0], cv - C[1]];
  u.adj = { dh: 0, dv: 0, k: 1, rot: 0 };
}
/** Two-point calibration: image points A, B ([px, py]) land on view points Ahv, Bhv. */
export function calibrateUnderlay(u, A, B, Ahv, Bhv) {
  let a = [A[0], -A[1]], b = [B[0], -B[1]];
  const D = [Bhv[0] - Ahv[0], Bhv[1] - Ahv[1]];
  const flip = (b[0] - a[0]) * D[0] < 0;   // drawing faces the other way: mirror it so it stays upright
  if (flip) { a = [-a[0], a[1]]; b = [-b[0], b[1]]; }
  const d = [b[0] - a[0], b[1] - a[1]];
  const s = Math.hypot(...D) / Math.max(1e-9, Math.hypot(...d));
  const th = Math.atan2(D[1], D[0]) - Math.atan2(d[1], d[0]);
  const c = Math.cos(th), sn = Math.sin(th);
  u.base = { s, th, flip, t: [Ahv[0] - s * (c * a[0] - sn * a[1]), Ahv[1] - s * (sn * a[0] + c * a[1])] };
  u.adj = { dh: 0, dv: 0, k: 1, rot: 0 };
  u.calibrated = true;
}
/** Image corners in ship coordinates (TL, TR, BR, BL). */
export function underlayCorners(u, convention, depth = 0) {
  return [[0, 0], [u.w, 0], [u.w, u.h], [0, u.h]].map(([px, py]) => {
    const [h, v] = imgToHV(u, px, py);
    return hvToShip(u.view, convention, h, v, depth);
  });
}

// ======================================================================= parsing
/** CSV / TXT / XYZ point lists: x, y, z per line (comma, semicolon, tab or space). */
export function parsePoints(text) {
  const pts = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const f = t.split(/[,;\t ]+/).map(Number);
    if (f.length >= 3 && f.slice(0, 3).every(Number.isFinite)) pts.push(f[0], f[1], f[2]);
  }
  return new Float64Array(pts);
}
/** Wavefront OBJ: vertices and triangulated faces. Vertices not used by any face
 *  (left behind when faces are deleted in MeshLab and similar) are dropped. */
export function parseOBJ(text) {
  const v = [], f = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) { const a = line.trim().split(/\s+/); v.push(+a[1], +a[2], +a[3]); }
    else if (line.startsWith('f ')) {
      const ids = line.trim().split(/\s+/).slice(1).map((s) => { const n = parseInt(s, 10); return n < 0 ? v.length / 3 + n : n - 1; });
      for (let k = 1; k < ids.length - 1; k++) f.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  const nv = v.length / 3, remap = new Int32Array(nv).fill(-1), pos = [];
  for (const i of f) if (i >= 0 && i < nv && remap[i] < 0) { remap[i] = pos.length / 3; pos.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]); }
  const idx = new Uint32Array(f.length);
  for (let k = 0; k < f.length; k++) idx[k] = Math.max(0, remap[f[k]]);
  return { pos: new Float64Array(pos), idx, dropped: nv - pos.length / 3 };
}

// ======================================================================= alignment
// Raw file coordinates -> "local" coordinates (three.js axes: X fore-and-aft, Y up, Z across),
// then a similarity transform (uniform scale k, rotation quaternion q, translation in ship metres).
export const ALIGN_DEFAULT = { up: 'z', scale: 1, q: [0, 0, 0, 1], dx: 0, dy: 0, dz: 0 };
export function normAlign(a) {
  const o = { ...ALIGN_DEFAULT, ...a };
  if (!a || !a.q) { const h = (-(a?.yaw || 0) * Math.PI) / 360; o.q = [0, Math.sin(h), 0, Math.cos(h)]; } // older saves: yaw only
  delete o.yaw;
  return o;
}
export function localize(raw, up) {
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    const x = raw[i], y = raw[i + 1], z = raw[i + 2];
    if (up === 'y') { out[i] = x; out[i + 1] = y; out[i + 2] = -z; } // Y-up data
    else { out[i] = x; out[i + 1] = z; out[i + 2] = y; }               // Z-up data
  }
  return out;
}
/** Local -> ship coordinates. */
export function alignLocal(L, a, idx = null) {
  const [qx, qy, qz, qw] = a.q, k = a.scale;
  const n = idx ? idx.length : L.length / 3, out = new Float64Array(n * 3);
  for (let m = 0; m < n; m++) {
    const i = idx ? idx[m] : m;
    const x = L[i * 3] * k, y = L[i * 3 + 1] * k, z = L[i * 3 + 2] * k;
    // rotate by q: v + 2w(q×v) + 2q×(q×v)
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    const X = x + qw * tx + (qy * tz - qz * ty), Y = y + qw * ty + (qz * tx - qx * tz), Z = z + qw * tz + (qx * ty - qy * tx);
    out[m * 3] = X + a.dx; out[m * 3 + 1] = Z + a.dy; out[m * 3 + 2] = Y + a.dz;
  }
  return out;
}
/** Voxel thinning that keeps a map from every source point to its representative. */
export function decimateIdx(L, max = 20000) {
  const n = L.length / 3;
  const all = () => ({ keep: Int32Array.from({ length: n }, (_, i) => i), map: Int32Array.from({ length: n }, (_, i) => i) });
  if (n <= max) return all();
  const b = boundsOf(L);
  const vol = Math.max(1e-9, (b[3] - b[0]) * Math.max(1e-3, b[4] - b[1]) * Math.max(1e-3, b[5] - b[2]));
  let cell = Math.cbrt(vol / max);
  for (let tries = 0; tries < 8; tries++) {
    const slot = new Map(), keep = [], map = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const k = `${Math.floor(L[i * 3] / cell)},${Math.floor(L[i * 3 + 1] / cell)},${Math.floor(L[i * 3 + 2] / cell)}`;
      let s = slot.get(k); if (s === undefined) { s = keep.length; slot.set(k, s); keep.push(i); }
      map[i] = s;
    }
    if (keep.length <= max * 1.1) return { keep: Int32Array.from(keep), map };
    cell *= 1.3;
  }
  return all();
}
/** Raw data coordinates -> ship coordinates (kept for scripts and older callers). */
export function alignArray(src, a) { const n = normAlign(a); return alignLocal(localize(src, n.up), n); }
/** Thin a dense cloud to at most `max` points with a voxel grid. */
export function decimate(pts, max = 20000) {
  const n = pts.length / 3;
  if (n <= max) return pts;
  const b = boundsOf(pts);
  const vol = Math.max(1e-9, (b[3] - b[0]) * (b[4] - b[1]) * Math.max(1e-3, b[5] - b[2]));
  let cell = Math.cbrt(vol / max);
  for (let tries = 0; tries < 6; tries++) {
    const seen = new Set(), keep = [];
    for (let i = 0; i < n; i++) {
      const k = `${Math.floor(pts[i * 3] / cell)},${Math.floor(pts[i * 3 + 1] / cell)},${Math.floor(pts[i * 3 + 2] / cell)}`;
      if (!seen.has(k)) { seen.add(k); keep.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]); }
    }
    if (keep.length / 3 <= max * 1.1) return new Float64Array(keep);
    cell *= 1.3;
  }
  return pts;
}
export function boundsOf(p) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let c = 0; c < 3; c++) { b[c] = Math.min(b[c], p[i + c]); b[c + 3] = Math.max(b[c + 3], p[i + c]); }
  return b;
}

// ======================================================================= spatial hash
class Hash {
  constructor(pts, cell) {
    this.p = pts; this.cell = cell; this.m = new Map();
    for (let i = 0; i < pts.length / 3; i++) {
      const k = this.key(Math.floor(pts[i * 3] / cell), Math.floor(pts[i * 3 + 1] / cell), Math.floor(pts[i * 3 + 2] / cell));
      let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push(i);
    }
  }
  // numeric cell key (collisions only add candidates; distances are always checked)
  key(ix, iy, iz) { return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0; }
  _scan(x, y, z, n, bd) {
    const c = this.cell, ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c);
    let best = -1;
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (let d = -n; d <= n; d++) {
      const arr = this.m.get(this.key(ix + a, iy + b, iz + d)); if (!arr) continue;
      for (const i of arr) {
        const dx = this.p[i * 3] - x, dy = this.p[i * 3 + 1] - y, dz = this.p[i * 3 + 2] - z, dd = dx * dx + dy * dy + dz * dz;
        if (dd < bd) { bd = dd; best = i; }
      }
    }
    return [best, bd];
  }
  /** index and distance of the nearest point within `r` (or -1). Searches outwards ring by ring. */
  nearest(x, y, z, r) {
    const max = Math.ceil(r / this.cell);
    for (let n = 1; ; n = Math.min(max, n * 2)) {
      const [i, bd] = this._scan(x, y, z, n, r * r);
      // a hit inside the scanned cube is only certain if it is closer than the cube's inner radius
      if (i >= 0 && (Math.sqrt(bd) <= n * this.cell || n >= max)) return [i, Math.sqrt(bd)];
      if (n >= max) return [-1, r];
    }
  }
}

// closest point on triangle (Ericson, Real-Time Collision Detection 5.1.5) -> squared distance
function triDist2(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const q = (u, v, w) => { const x = a[0] + u * ab[0] + v * ac[0] - p[0], y = a[1] + u * ab[1] + v * ac[1] - p[1], z = a[2] + u * ab[2] + v * ac[2] - p[2]; return x * x + y * y + z * z; };
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return q(d1 / (d1 - d3), 0);
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return q(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return q(1 - w, w); }
  const den = 1 / (va + vb + vc);
  return q(vb * den, vc * den);
}

// ======================================================================= fitting
/**
 * Distance from each evidence point to the (starboard) hull surface, using the
 * absolute value of y so port-side records count too. Returns Float32Array.
 */
export function deviations(grid, pts) {
  const { rows, cols, p } = grid;
  const b = gridBounds(grid), L = Math.max(1e-6, b.xmax - b.xmin);
  const R = Math.max(L * 0.15, 1);
  const h = new Hash(p, Math.max(1e-3, L / Math.max(8, rows / 2)));
  const out = new Float32Array(pts.length / 3);
  const P = (i, j) => { const k = (i * cols + j) * 3; return [p[k], p[k + 1], p[k + 2]]; };
  for (let n = 0; n < pts.length / 3; n++) {
    const q = [pts[n * 3], Math.abs(pts[n * 3 + 1]), pts[n * 3 + 2]];
    const [vi, vd] = h.nearest(q[0], q[1], q[2], R);
    if (vi < 0) { out[n] = R; continue; }
    const i0 = Math.floor(vi / cols), j0 = vi % cols;
    let best = vd * vd;
    for (let i = Math.max(0, i0 - 1); i < Math.min(rows - 1, i0 + 1); i++) for (let j = Math.max(0, j0 - 1); j < Math.min(cols - 1, j0 + 1); j++) {
      const a = P(i, j), b2 = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      best = Math.min(best, triDist2(q, a, b2, c), triDist2(q, a, c, d));
    }
    out[n] = Math.sqrt(best);
  }
  return out;
}
export function fitStats(dev, tol) {
  if (!dev || !dev.length) return null;
  let ss = 0, within = 0, max = 0;
  for (const d of dev) { ss += d * d; if (d <= tol) within++; if (d > max) max = d; }
  return { n: dev.length, rms: Math.sqrt(ss / dev.length), within: within / dev.length, max };
}

/** Evidence lookup for "is this part of the hull supported by recorded evidence?" */
export function supportIndex(pts, reach) {
  const folded = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) { folded[i] = pts[i]; folded[i + 1] = Math.abs(pts[i + 1]); folded[i + 2] = pts[i + 2]; }
  const h = new Hash(folded, reach);
  return (x, y, z) => h.nearest(x, Math.abs(y), z, reach)[0] >= 0;
}
/** Attach .support (Uint8Array) to every polyline in `lines` (heights relative to z0). */
export function markSupport(lines, has) {
  const z0 = lines.bounds.z0;
  const mark = (l) => { const s = new Uint8Array(l.length); for (let i = 0; i < l.length; i++) s[i] = has(l[i][0], l[i][1], l[i][2] + z0) ? 1 : 0; l.support = s; return s; };
  for (const set of [lines.stations, lines.waterlines, lines.buttocks]) for (const it of set) it.polylines.forEach(mark);
  for (const d of lines.diagonals) d.polylines.forEach((l, i) => { const s = mark(l); if (d.developed[i]) d.developed[i].support = s; });
  for (const k of ['keel', 'stem', 'stern', 'sheer']) mark(lines.outline[k]);
}
/** Fraction of hull grid vertices supported, and per-vertex flags. */
export function surfaceSupport(grid, has) {
  const n = grid.rows * grid.cols, flags = new Uint8Array(n);
  let c = 0;
  for (let v = 0; v < n; v++) if ((flags[v] = has(grid.p[v * 3], grid.p[v * 3 + 1], grid.p[v * 3 + 2]) ? 1 : 0)) c++;
  return { flags, frac: c / n };
}

// ======================================================================= sample wreck
// A small coastal trader: only the lower hull survives between the ends, recorded
// as scattered points (both sides) plus three surviving strakes as a mesh.
export function sampleWreck(seed = 7) {
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const cage = makePreset('clipper');
  for (const row of cage.pts) for (const p of row) { p.x *= 0.38; p.y *= 0.62; p.z *= 0.46; }
  // a fuller, flatter-floored merchantman than the clipper
  for (const row of cage.pts) for (let j = 1; j < 4; j++) { row[j].y *= 1.12; row[j].z *= 0.85; }
  const g = subdivide(gridFromCage(cage), 4);
  const b = gridBounds(g), L = b.xmax - b.xmin, H = b.zmax - b.zmin;
  const pts = [];
  const gap = (x, z) => Math.sin(x * 0.9) + Math.sin(z * 2.7 + 1.3) > 1.35; // eroded patches
  for (let i = 0; i < g.rows; i++) for (let j = 0; j < g.cols; j++) {
    const k = (i * g.cols + j) * 3, x = g.p[k], y = g.p[k + 1], z = g.p[k + 2];
    const t = (x - b.xmin) / L, s = (z - b.zmin) / H;
    if (t < 0.14 || t > 0.86 || s > 0.42 + 0.08 * Math.sin(t * 9)) continue;
    if (gap(x, z) || rand() < 0.35) continue;
    const side = rand() < 0.4 ? -1 : 1;
    pts.push(x + gauss() * 0.01, side * y + gauss() * 0.01, z + gauss() * 0.01);
  }
  // three surviving strakes (thin ribbons) on the starboard side
  const pos = [], idx = [];
  const bands = [[1, 4], [6, 9], [11, 14]];
  for (const [j0, j1] of bands) {
    const base = pos.length / 3;
    const i0 = Math.floor(g.rows * 0.2), i1 = Math.floor(g.rows * 0.8);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = (i * g.cols + j) * 3; pos.push(g.p[k], g.p[k + 1] + 0.015, g.p[k + 2]); }
    const w = j1 - j0 + 1;
    for (let i = 0; i < i1 - i0; i++) for (let j = 0; j < w - 1; j++) {
      const a = base + i * w + j, c = a + w;
      idx.push(a, c, c + 1, a, c + 1, a + 1);
    }
  }
  return { points: new Float64Array(pts), mesh: { pos: new Float64Array(pos), idx: new Uint32Array(idx) }, L, B: 2 * b.ymax, H };
}
