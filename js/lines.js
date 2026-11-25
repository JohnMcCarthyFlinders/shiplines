// Builds the full set of hull lines (stations, waterlines, buttocks, diagonals)
// plus outline curves and basic hydrostatics from a subdivided surface grid.
// All returned heights are measured from the baseline (lowest point of the hull).

import { sliceGrid } from './slicer.js?v=10';
import { boundaries, gridBounds } from './subdiv.js?v=10';

export const LINE_DEFAULTS = {
  stations: 10,       // number of equal station spaces along the length
  wlBelow: 3,         // waterlines up to and including the LWL
  lwlRatio: 0.6,      // LWL height as a fraction of midship sheer height (Steffy/Castro 3/5 rule)
  wlAbove: true,      // continue waterlines above the LWL at the same spacing
  buttocks: 3,
  diagonals: 2,
  convention: 'steffy', // 'steffy' (bow left, A,B,C fwd / 1,2,3 aft) or 'na' (bow right, 0 AP … N FP)
};

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I and O skipped, as is usual on drawings

export function stationLabel(k, n, convention) {
  const mid = Math.round(n / 2);
  if (convention === 'na') return String(k);
  if (k === mid) return '⦶';
  if (k > mid) return LETTERS[k - mid - 1] || `F${k - mid}`;
  return String(mid - k);
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function computeLines(g, opt) {
  const o = { ...LINE_DEFAULTS, ...opt };
  const bb = gridBounds(g);
  const z0 = bb.zmin;
  const rel = (lines) => lines.map((l) => l.map((q) => [q[0], q[1], q[2] - z0]));
  const L = bb.xmax - bb.xmin;
  const xmid = (bb.xmin + bb.xmax) / 2;
  const B2 = bb.ymax;
  const bnd = boundaries(g);
  const outline = {
    keel: rel([bnd.keel])[0], sheer: rel([bnd.sheer])[0], stern: rel([bnd.stern])[0], stem: rel([bnd.stem])[0],
  };
  // midship sheer height (relative) from the sheer boundary
  const Hmid = interpAt(outline.sheer, 0, xmid, 2);
  const Hmax = bb.zmax - z0;

  // ---- stations
  const stations = [];
  const nS = Math.max(2, o.stations | 0);
  const mid = Math.round(nS / 2);
  for (let k = 1; k < nS; k++) {
    const x = bb.xmin + (k * L) / nS;
    stations.push({
      k, x, label: stationLabel(k, nS, o.convention), isMid: k === mid,
      fwd: x > xmid + 1e-6, aft: x < xmid - 1e-6,
      polylines: rel(sliceGrid(g, (px) => px, x)),
    });
  }

  // ---- waterlines
  const lwl = o.lwlRatio * Hmid;
  const nW = Math.max(1, o.wlBelow | 0);
  const dz = lwl / nW;
  const waterlines = [];
  for (let k = 1; ; k++) {
    const z = k * dz;
    if (k > nW && (!o.wlAbove || z >= Hmax - dz * 0.15)) break;
    if (k > 40) break;
    waterlines.push({
      k, z, isLWL: k === nW, label: k === nW ? 'LWL' : `WL${k}`,
      polylines: rel(sliceGrid(g, (px, py, pz) => pz, z + z0)),
    });
  }

  // ---- buttocks
  const buttocks = [];
  const nB = Math.max(0, o.buttocks | 0);
  for (let k = 1; k <= nB; k++) {
    const y = (k * B2) / (nB + 1);
    buttocks.push({ k, y, label: `B${ROMAN[k - 1] ? ' ' + ROMAN[k - 1] : k}`, polylines: rel(sliceGrid(g, (px, py) => py, y)) });
  }

  // ---- diagonals (planes parallel to the x axis, drawn straight in the body plan)
  const diagonals = [];
  const nD = Math.max(0, o.diagonals | 0);
  for (let k = 1; k <= nD; k++) {
    const u = nD === 1 ? 0 : (k - 1) / (nD - 1);
    const a = { y: 0, z: Hmid * (0.92 - 0.32 * u) };
    const b = { y: B2 * (1.15 - 0.45 * u), z: 0 };
    const dy = b.y - a.y, dzz = b.z - a.z, len = Math.hypot(dy, dzz);
    const ny = -dzz / len, nz = dy / len; // unit normal in (y,z)
    const c = ny * a.y + nz * (a.z + z0);
    const pl = rel(sliceGrid(g, (px, py, pz) => ny * py + nz * pz, c));
    // distance along the diagonal from its centreline end, for the half-breadth plan
    const ux = dy / len, uz = dzz / len;
    const developed = pl.map((l) => l.map((q) => [q[0], (q[1] - a.y) * ux + (q[2] - a.z) * uz]));
    diagonals.push({ k, a, b, len, label: `D${k}`, polylines: pl, developed });
  }

  return {
    opts: o, bounds: { ...bb, z0, L, xmid, B2, Hmid, Hmax, lwl },
    stations, waterlines, buttocks, diagonals, outline,
  };
}

// value of coordinate `out` on a polyline where coordinate `axis` == v (first crossing)
export function interpAt(line, axis, v, out) {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1][axis], b = line[i][axis];
    if ((a - v) * (b - v) <= 0 && a !== b) {
      const t = (v - a) / (b - a);
      return line[i - 1][out] + t * (line[i][out] - line[i - 1][out]);
    }
  }
  return line.length ? line[Math.floor(line.length / 2)][out] : 0;
}

// ---------------------------------------------------------------- hydrostatics
// Section area below T from a station polyline (y,z), closed along the centreplane.
function sectionAreaBelow(lines, T) {
  let A = 0;
  for (const l of lines) {
    if (l.length < 2) continue;
    const poly = l.map((q) => [q[1], q[2]]);
    const s = poly[0], e = poly[poly.length - 1];
    poly.push([0, e[1]], [0, s[1]]);
    A += Math.abs(shoelace(clipBelow(poly, T)));
  }
  return A;
}
function clipBelow(poly, T) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const pin = p[1] <= T, qin = q[1] <= T;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (T - p[1]) / (q[1] - p[1]);
      out.push([p[0] + t * (q[0] - p[0]), T]);
    }
  }
  return out;
}
function shoelace(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function hydrostatics(g, lines, samples = 48) {
  const { xmin, L, z0, lwl: T } = lines.bounds;
  let V = 0, Mx = 0, prevA = 0, prevX = xmin, Amax = 0;
  for (let k = 0; k <= samples; k++) {
    const x = xmin + (k / samples) * L;
    const A = k === 0 || k === samples ? 0 : 2 * sectionAreaBelow(sliceGrid(g, (px) => px, x).map((l) => l.map((q) => [q[0], q[1], q[2] - z0])), T);
    if (A > Amax) Amax = A;
    if (k > 0) { const dx = x - prevX; V += 0.5 * (A + prevA) * dx; Mx += 0.5 * (A * x + prevA * prevX) * dx; }
    prevA = A; prevX = x;
  }
  // waterplane at LWL
  const wl = lines.waterlines.find((w) => w.isLWL);
  let Awp = 0, xa = Infinity, xf = -Infinity, bwl = 0;
  if (wl) for (const l of wl.polylines) {
    const poly = l.map((q) => [q[0], q[1]]);
    poly.push([poly[poly.length - 1][0], 0], [poly[0][0], 0]);
    Awp += 2 * Math.abs(shoelace(poly));
    for (const q of l) { xa = Math.min(xa, q[0]); xf = Math.max(xf, q[0]); bwl = Math.max(bwl, q[1]); }
  }
  const Lwl = xf > xa ? xf - xa : 0, Bwl = 2 * bwl;
  const ok = V > 0 && Lwl > 0 && Bwl > 0 && T > 0;
  return {
    T, Lwl, Bwl, V, disp: V * 1.025, Awp, Am: Amax,
    LCB: ok ? Mx / V - xmin : 0,
    Cb: ok ? V / (Lwl * Bwl * T) : 0,
    Cm: ok ? Amax / (Bwl * T) : 0,
    Cp: ok && Amax > 0 ? V / (Amax * Lwl) : 0,
    Cwp: ok ? Awp / (Lwl * Bwl) : 0,
  };
}

// ---------------------------------------------------------------- table of offsets
export function offsetsTable(lines) {
  const rows = [];
  const fmt = (v) => (v == null || !isFinite(v) ? '' : v.toFixed(3));
  const head = ['Station', 'x (m)'];
  for (const w of lines.waterlines) head.push(`${w.label} half-breadth @ ${w.z.toFixed(3)} m`);
  head.push('Sheer half-breadth', 'Sheer height');
  for (const b of lines.buttocks) head.push(`${b.label} height @ ${b.y.toFixed(3)} m`);
  rows.push(head);
  for (const s of lines.stations) {
    const pl = s.polylines.flat();
    const r = [s.isMid ? 'Midship' : s.label, s.x.toFixed(3)];
    for (const w of lines.waterlines) r.push(fmt(maxYAtZ(s.polylines, w.z)));
    const top = pl.reduce((m, q) => (q[2] > (m ? m[2] : -Infinity) ? q : m), null);
    r.push(fmt(top && top[1]), fmt(top && top[2]));
    for (const b of lines.buttocks) r.push(fmt(minZAtY(s.polylines, b.y)));
    rows.push(r);
  }
  return rows;
}
function maxYAtZ(lines, z) {
  let best = null;
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i];
    if ((a[2] - z) * (b[2] - z) <= 0 && a[2] !== b[2]) {
      const y = a[1] + ((z - a[2]) / (b[2] - a[2])) * (b[1] - a[1]);
      if (best == null || y > best) best = y;
    }
  }
  return best;
}
function minZAtY(lines, y) {
  let best = null;
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) {
      const z = a[2] + ((y - a[1]) / (b[1] - a[1])) * (b[2] - a[2]);
      if (best == null || z < best) best = z;
    }
  }
  return best;
}
