// Traditional lines drawing (sheer, half-breadth and body plans) rendered as an
// SVG sheet in millimetres at a true, standard drawing scale.
//
// Steffy conventions (as taught in Castro's lines-drawing course, after Steffy 1994):
//   bow to the left; plans titled Sheer, Body and Half-Breadth;
//   sections lettered A, B, C … towards the bow and numbered 1, 2, 3 … towards
//   the stern from the midship section, which carries the amidships mark.
// An alternative 'naval architecture' convention (bow right, stations 0 … N) is provided.

export const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] };
const SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 400, 500, 1000, 2000]; // metric standard scales

const INKS = {
  mono: { stations: null, waterlines: null, buttocks: null, diagonals: null },
  colour: { stations: '#8a5a00', waterlines: '#1c5d8c', buttocks: '#8f2a68', diagonals: '#2e6a2a' },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = (v) => (Math.round(v * 100) / 100).toString();

function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

// Catmull–Rom through the points, emitted as cubic Béziers: the digital batten.
function smoothPath(pts) {
  const q = [];
  for (const p of pts) {
    const l = q[q.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.35) q.push(p);
  }
  const last = pts[pts.length - 1];
  if (q.length && (q[q.length - 1][0] !== last[0] || q[q.length - 1][1] !== last[1])) q.push(last);
  if (q.length < 2) return '';
  let d = `M${f2(q[0][0])},${f2(q[0][1])}`;
  if (q.length === 2) return d + `L${f2(q[1][0])},${f2(q[1][1])}`;
  for (let i = 0; i < q.length - 1; i++) {
    const p0 = q[Math.max(0, i - 1)], p1 = q[i], p2 = q[i + 1], p3 = q[Math.min(q.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f2(c1[0])},${f2(c1[1])} ${f2(c2[0])},${f2(c2[1])} ${f2(p2[0])},${f2(p2[1])}`;
  }
  return d;
}

export function renderDrawing(lines, meta, opts = {}) {
  const o = { paper: 'A3', aged: true, inks: 'mono', convention: 'steffy', layout: 'auto', ...opts };
  const [W, H] = PAPERS[o.paper] || PAPERS.A3;
  const b = lines.bounds;
  const steffy = o.convention === 'steffy';
  const L = b.L, B2 = b.B2, Hm = b.Hmax;
  let dmax = 0;
  for (const d of lines.diagonals) for (const l of d.developed) for (const q of l) dmax = Math.max(dmax, q[1]);
  dmax = lines.diagonals.length ? dmax * 1.04 : 0;

  // ---------------------------------------------------------------- sheet geometry
  const fr = { l: 20, t: 10, r: W - 10, b: H - 10 };       // inner frame
  const TB = { w: Math.min(178, W * 0.42), h: 50 };          // title block
  const pad = 7;
  const area = { l: fr.l + pad, t: fr.t + pad, r: fr.r - pad, b: fr.b - pad };
  const ml = 16, mr = 16, gx = 12, topLab = 9, titleSp = 11, gy = 8, botLab = 7;

  const cert = meta.certificate || null;
  const CERT_H = cert ? 50 : 0;     // certificate cartouche stacked above the scale bar
  const tbTop = area.b - TB.h - 14 - CERT_H; // leave room for the scale bar above the title block
  const tbLeft = fr.r - TB.w;
  const AW = area.r - area.l, AH = area.b - area.t;
  const hTop = (s) => topLab + Hm * s + titleSp;
  const hHB = (s) => gy + B2 * s + dmax * s + botLab + titleSp;
  const hBody = (s) => topLab + Hm * s + 13;
  const wBody = (s) => 2 * B2 * s + 28;

  // Layout A ('beside'): body plan to the right of the sheer plan, sharing its baseline (Steffy's usual layout).
  const fitBeside = (s) => {
    const w = ml + L * s + gx + 2 * B2 * s + mr, h = hTop(s) + hHB(s);
    const besideTB = area.l + Math.max(0, (AW - w) / 2) + ml + L * s + 6 < tbLeft || area.l + ml + L * s + 6 < tbLeft;
    const ok = w <= AW && h <= AH && area.t + hTop(s) + 4 < tbTop && (besideTB || area.t + h < tbTop);
    return { ok, w, h };
  };
  // Layout B ('below'): body plan beneath the half-breadth plan, left of the title block (for long hulls).
  const fitBelow = (s) => {
    const w = ml + L * s + mr, h1 = hTop(s) + hHB(s), h = h1 + 6 + hBody(s);
    const sheerClearsTB = area.l + ml + L * s + 6 < tbLeft;
    const ok = w <= AW && h <= AH && area.l + wBody(s) < tbLeft - 6 && (sheerClearsTB || area.t + h1 < tbTop);
    return { ok, w, h, h1 };
  };
  const best = (fit) => { for (const d of SCALES) if (fit(1000 / d).ok) return d; return SCALES[SCALES.length - 1]; };
  const dA = best(fitBeside), dB = best(fitBelow);
  const layout = o.layout === 'beside' ? 'beside' : o.layout === 'below' ? 'below' : (dB < dA ? 'below' : 'beside');
  const denom = layout === 'below' ? dB : dA;
  const s = 1000 / denom;               // paper mm per metre
  const fit = layout === 'below' ? fitBelow(s) : fitBeside(s);

  // centre horizontally; share spare height between the plans
  let ox = area.l + Math.max(0, (AW - fit.w) / 2);
  const hbRight = (x) => x + ml + L * s + 6;
  if (hbRight(ox) >= tbLeft && area.t + (layout === 'below' ? fit.h1 : fit.h) >= tbTop) ox = area.l;
  const clearsTB = hbRight(ox) < tbLeft;
  const limit = layout === 'below' ? area.b : clearsTB ? area.b : tbTop;
  const spare = Math.max(0, limit - (area.t + fit.h));
  const nGaps = layout === 'below' ? 3 : 2;
  const vg = Math.min(spare / (nGaps + 1), 22);

  const X0 = ox + ml;                    // sheer / half-breadth plan left edge
  const Xs = (x) => (steffy ? X0 + (b.xmax - x) * s : X0 + (x - b.xmin) * s);
  const Ybase = area.t + vg + topLab + Hm * s;
  const Yz = (z) => Ybase - z * s;
  const Yc = Ybase + titleSp + gy + vg + B2 * s;   // half-breadth centreline
  let Xbc, YbB;
  if (layout === 'beside') { Xbc = X0 + L * s + gx + B2 * s; YbB = Ybase; }
  else {
    const hbBottom = Yc + dmax * s + botLab + titleSp;
    YbB = hbBottom + vg + 6 + topLab + Hm * s;
    Xbc = Math.max(area.l + 14 + B2 * s, Math.min((area.l + tbLeft) / 2 - 6, X0 + L * s / 2));
  }
  const YzB = (z) => YbB - z * s;
  const fwdSide = steffy ? -1 : 1;
  const Xb = (y, fwd) => Xbc + (fwd ? fwdSide : -fwdSide) * y * s;

  const ink = o.aged ? '#24201b' : '#000';
  const paper = o.aged ? '#efe5c9' : '#ffffff';
  const IK = INKS[o.inks] || INKS.mono;
  const col = (k) => IK[k] || ink;
  const W_HULL = 0.3, W_OUT = 0.5, W_GRID = 0.12, W_REF = 0.22;

  const out = [];
  const P = (d, w, c = ink, extra = '') => d && out.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`);
  const Ln = (x1, y1, x2, y2, w, c = ink, extra = '') => out.push(`<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="${c}" stroke-width="${w}" ${extra}/>`);
  const T = (x, y, txt, size = 2.6, anchor = 'middle', cls = 'hand', extra = '') => out.push(`<text x="${f2(x)}" y="${f2(y)}" font-size="${size}" text-anchor="${anchor}" class="${cls}" fill="${ink}" ${extra}>${esc(txt)}</text>`);
  const DASHDOT = 'stroke-dasharray="6 1.2 0.6 1.2"';
  const amidships = (x, y, r = 1.6) => {
    out.push(`<g stroke="${ink}" stroke-width="0.22" fill="none"><circle cx="${f2(x)}" cy="${f2(y)}" r="${r}"/><line x1="${f2(x)}" y1="${f2(y - r * 1.9)}" x2="${f2(x)}" y2="${f2(y + r * 1.9)}"/></g>`);
  };
  const stLabel = (st, x, y) => (st.isMid ? amidships(x, y - 0.9) : T(x, y, st.label, 2.8));

  // ================================================================ SHEER PLAN
  const xL = Xs(steffy ? b.xmax : b.xmin), xR = Xs(steffy ? b.xmin : b.xmax);
  const topZ = Hm * 1.0;
  // grid
  for (const st of lines.stations) Ln(Xs(st.x), Ybase, Xs(st.x), Yz(topZ) - 1.5, st.isMid ? W_REF : W_GRID);
  for (const w of lines.waterlines) Ln(xL, Yz(w.z), xR, Yz(w.z), w.isLWL ? W_REF * 1.3 : W_GRID, w.isLWL ? col('waterlines') : ink);
  Ln(xL - 4, Ybase, xR + 4, Ybase, W_REF); // baseline
  // buttocks (x,z)
  for (const bt of lines.buttocks) for (const l of bt.polylines) P(smoothPath(l.map((q) => [Xs(q[0]), Yz(q[2])])), W_HULL, col('buttocks'));
  // profile
  const ol = lines.outline;
  for (const k of ['keel', 'stem', 'stern', 'sheer']) P(smoothPath(ol[k].map((q) => [Xs(q[0]), Yz(q[2])])), W_OUT);
  // labels
  for (const st of lines.stations) stLabel(st, Xs(st.x), Yz(topZ) - 3.2);
  for (const w of lines.waterlines) T(xL - 3, Yz(w.z) + 0.9, w.label, w.isLWL ? 2.6 : 2.3, 'end');
  T(xL - 3, Ybase + 0.9, 'BASE', 2.1, 'end');
  for (const bt of lines.buttocks) {
    const l = bt.polylines[0]; if (!l) continue;
    const q = l.reduce((m, p) => (Xs(p[0]) > Xs(m[0]) ? p : m), l[0]);
    T(Xs(q[0]) + 1.2, Yz(q[2]) - 0.8, bt.label, 2.1, 'start');
  }
  T((xL + xR) / 2, Ybase + 8, 'SHEER PLAN', 4.2, 'middle', 'title');

  // ================================================================ HALF-BREADTH PLAN
  for (const st of lines.stations) Ln(Xs(st.x), Yc - B2 * s - 1, Xs(st.x), Yc + dmax * s + 1, st.isMid ? W_REF : W_GRID);
  Ln(xL - 4, Yc, xR + 4, Yc, W_REF, ink, DASHDOT); // centreline
  for (const bt of lines.buttocks) Ln(xL, Yc - bt.y * s, xR, Yc - bt.y * s, W_GRID);
  for (const w of lines.waterlines) for (const l of w.polylines) P(smoothPath(l.map((q) => [Xs(q[0]), Yc - q[1] * s])), w.isLWL ? W_HULL * 1.5 : W_HULL, col('waterlines'));
  P(smoothPath(ol.sheer.map((q) => [Xs(q[0]), Yc - q[1] * s])), W_OUT);
  P(smoothPath(ol.stern.map((q) => [Xs(q[0]), Yc - q[1] * s])), W_OUT);
  for (const d of lines.diagonals) for (const l of d.developed) P(smoothPath(l.map((q) => [Xs(q[0]), Yc + q[1] * s])), W_HULL, col('diagonals'));
  // labels
  for (const bt of lines.buttocks) T(xL - 3, Yc - bt.y * s + 0.9, bt.label, 2.1, 'end');
  T(xL - 3, Yc + 0.9, 'CL', 2.1, 'end');
  for (const w of lines.waterlines) {
    const l = w.polylines.reduce((m, p) => (p.length > (m ? m.length : 0) ? p : m), null); if (!l) continue;
    const q = l.reduce((m, p) => (p[1] > m[1] ? p : m), l[0]);
    T(Xs(q[0]), Yc - q[1] * s + (w.isLWL ? 3 : 2.6), w.label, 1.9);
  }
  for (const d of lines.diagonals) {
    const l = d.developed[0]; if (!l) continue;
    const q = l.reduce((m, p) => (p[1] > m[1] ? p : m), l[0]);
    T(Xs(q[0]), Yc + q[1] * s + 2.8, d.label, 2.1);
  }
  for (const st of lines.stations) stLabel(st, Xs(st.x), Yc + dmax * s + 4.6);
  const hbTitleY = Yc + dmax * s + botLab + 6;
  T((xL + xR) / 2, hbTitleY, 'HALF-BREADTH PLAN', 4.2, 'middle', 'title');
  // bow / stern pointer under the sheer plan, Steffy style
  T(steffy ? xL : xR, hbTitleY, steffy ? '◂ BOW' : 'BOW ▸', 2.4, steffy ? 'start' : 'end');
  T(steffy ? xR : xL, hbTitleY, steffy ? 'STERN' : 'STERN', 2.4, steffy ? 'end' : 'start');

  // ================================================================ BODY PLAN
  const bl = Xbc - B2 * s, br = Xbc + B2 * s;
  Ln(Xbc, YbB + 1.5, Xbc, YzB(topZ) - 1.5, W_REF, ink, DASHDOT);
  Ln(bl - 2, YbB, br + 2, YbB, W_REF);
  for (const w of lines.waterlines) Ln(bl, YzB(w.z), br, YzB(w.z), w.isLWL ? W_REF * 1.3 : W_GRID, w.isLWL ? col('waterlines') : ink);
  for (const bt of lines.buttocks) for (const side of [-1, 1]) Ln(Xbc + side * bt.y * s, YbB, Xbc + side * bt.y * s, YzB(topZ), W_GRID);
  for (const d of lines.diagonals) for (const side of [-1, 1]) {
    // clip the diagonal to the body plan rectangle
    const t = Math.min(1, (B2 * 1.0) / Math.max(1e-9, d.b.y - d.a.y));
    const ey = d.a.y + (d.b.y - d.a.y) * t, ez = d.a.z + (d.b.z - d.a.z) * t;
    Ln(Xbc, YzB(d.a.z), Xbc + side * ey * s, YzB(ez), W_GRID * 1.4, col('diagonals'), 'stroke-dasharray="2.2 0.9"');
    T(Xbc + side * ey * s + side * 1.6, YzB(ez) + 0.9, d.label, 2.0, side > 0 ? 'start' : 'end');
  }
  for (const st of lines.stations) {
    const sides = st.isMid ? [true, false] : [st.fwd];
    for (const fwd of sides) for (const l of st.polylines) P(smoothPath(l.map((q) => [Xb(q[1], fwd), YzB(q[2])])), st.isMid ? W_HULL * 1.25 : W_HULL, col('stations'));
    if (!st.isMid) {
      const l = st.polylines[0]; if (!l) continue;
      const top = l.reduce((m, p) => (p[2] > m[2] ? p : m), l[0]);
      T(Xb(top[1], st.fwd) + (st.fwd ? fwdSide : -fwdSide) * 0.6, YzB(top[2]) - 1.4, st.label, 2.2);
    }
  }
  // sheer line through the section heads, fore and after bodies
  const sheerF = ol.sheer.filter((q) => q[0] >= b.xmid), sheerA = ol.sheer.filter((q) => q[0] <= b.xmid);
  P(smoothPath(sheerF.map((q) => [Xb(q[1], true), YzB(q[2])])), W_HULL * 0.9);
  P(smoothPath(sheerA.map((q) => [Xb(q[1], false), YzB(q[2])])), W_HULL * 0.9);
  if (!meta.sternClosed) P(smoothPath(ol.stern.map((q) => [Xb(q[1], false), YzB(q[2])])), W_HULL, ink, 'stroke-dasharray="1.6 0.8"');
  // midship mark and labels
  const midSt = lines.stations.find((x) => x.isMid);
  if (midSt) amidships(Xbc, YzB(topZ) - 4.1);
  for (const w of lines.waterlines) T(br + 3, YzB(w.z) + 0.9, w.label, w.isLWL ? 2.6 : 2.3, 'start');
  for (const bt of lines.buttocks) for (const side of [-1, 1]) T(Xbc + side * bt.y * s, YbB + 3.4, bt.label.replace('B ', ''), 1.9);
  T(Xbc + fwdSide * B2 * s * 0.5, YbB + 6.4, 'FORE BODY', 2.2);
  T(Xbc - fwdSide * B2 * s * 0.5, YbB + 6.4, 'AFTER BODY', 2.2);
  T(Xbc, YbB + 11, 'BODY PLAN', 4.2, 'middle', 'title');

  // ================================================================ TITLE BLOCK, SCALE, FRAME
  const tb = { x: fr.r - TB.w, y: fr.b - TB.h, w: TB.w, h: TB.h };
  const hyd = meta.hydro || {};
  const cells = [];
  const R = (x, y, w, h) => cells.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="none" stroke="${ink}" stroke-width="0.25"/>`);
  R(tb.x, tb.y, tb.w, tb.h);
  const c1 = tb.w * 0.36;
  R(tb.x, tb.y, c1, tb.h * 0.56);
  R(tb.x + c1, tb.y, tb.w - c1, tb.h * 0.56);
  const rowY = tb.y + tb.h * 0.56, rowH = (tb.h * 0.44) / 2;
  const colW = [0.24, 0.16, 0.30, 0.30].map((v) => v * tb.w);
  let cx = tb.x;
  const small = [];
  const fields = [
    ['SCALE', `1 : ${denom}`], ['SHEET', `${o.paper}`], ['DRAWN', meta.drawnBy || '—'], ['DATE', meta.date || ''],
    ['CONVENTION', steffy ? 'After Steffy (1994)' : 'Naval arch. (bow right)'], ['SURFACE', `Subdiv. level ${meta.level}`], ['UNITS', 'Metres'], ['CHECKED', ''],
  ];
  for (let r = 0; r < 2; r++) {
    cx = tb.x;
    for (let c = 0; c < 4; c++) {
      const w = r === 1 ? [0.30, 0.22, 0.16, 0.32][c] * tb.w : colW[c];
      R(cx, rowY + r * rowH, w, rowH);
      const [k, v] = fields[r * 4 + c];
      small.push(`<text x="${f2(cx + 1.2)}" y="${f2(rowY + r * rowH + 2.6)}" font-size="1.7" class="type" fill="${ink}">${k}</text>`);
      small.push(`<text x="${f2(cx + 1.2)}" y="${f2(rowY + r * rowH + rowH - 1.6)}" font-size="2.6" class="type" fill="${ink}">${esc(v)}</text>`);
      cx += w;
    }
  }
  out.push(`<g class="titleblock">${cells.join('')}${small.join('')}`);
  // institution
  const ix = tb.x + c1 / 2;
  out.push(`<text x="${f2(ix)}" y="${f2(tb.y + 8.5)}" font-size="4.6" text-anchor="middle" class="title" fill="${ink}">Flinders</text>`);
  out.push(`<text x="${f2(ix)}" y="${f2(tb.y + 13)}" font-size="2.6" text-anchor="middle" class="title" fill="${ink}" letter-spacing="0.6">UNIVERSITY</text>`);
  Ln(tb.x + 5, tb.y + 15.5, tb.x + c1 - 5, tb.y + 15.5, 0.18);
  out.push(`<text x="${f2(ix)}" y="${f2(tb.y + 19.6)}" font-size="2.05" text-anchor="middle" class="type" fill="${ink}">MARITIME ARCHAEOLOGY</text>`);
  out.push(`<text x="${f2(ix)}" y="${f2(tb.y + 22.8)}" font-size="2.05" text-anchor="middle" class="type" fill="${ink}">PROGRAM</text>`);
  out.push(`<text x="${f2(ix)}" y="${f2(tb.y + 26.4)}" font-size="1.6" text-anchor="middle" class="type" fill="${ink}">College of Human Sciences &amp; Culture</text>`);
  const tx = tb.x + c1 + (tb.w - c1) / 2;
  out.push(`<text x="${f2(tx)}" y="${f2(tb.y + 8.2)}" font-size="5.6" text-anchor="middle" class="title" fill="${ink}" letter-spacing="0.5">LINES OF ${esc((meta.name || 'VESSEL').toUpperCase())}</text>`);
  out.push(`<text x="${f2(tx)}" y="${f2(tb.y + 13.2)}" font-size="2.6" text-anchor="middle" class="type" fill="${ink}">${esc(meta.type || '')}</text>`);
  const dims = `LOA ${b.L.toFixed(2)} m   ·   Beam ${(2 * B2).toFixed(2)} m   ·   Depth ${b.Hmid.toFixed(2)} m`;
  out.push(`<text x="${f2(tx)}" y="${f2(tb.y + 18.2)}" font-size="2.3" text-anchor="middle" class="type" fill="${ink}">${dims}</text>`);
  if (hyd.V > 0) {
    const hl = `LWL draught ${hyd.T.toFixed(2)} m  ·  Displ. ${hyd.disp.toFixed(1)} t (SW)  ·  Cb ${hyd.Cb.toFixed(3)}  Cp ${hyd.Cp.toFixed(3)}`;
    out.push(`<text x="${f2(tx)}" y="${f2(tb.y + 22.4)}" font-size="1.95" text-anchor="middle" class="type" fill="${ink}">${hl}</text>`);
  }
  const lab = steffy ? 'Sections A, B, C … forward and 1, 2, 3 … aft of the midship section' : 'Stations numbered 0 (aft) … ' + lines.opts.stations + ' (fwd)';
  out.push(`<text x="${f2(tx)}" y="${f2(tb.y + 26.4)}" font-size="1.6" text-anchor="middle" class="type" fill="${ink}">${lab}</text>`);
  out.push('</g>');

  // graphic scale (scale of metres), first unit subdivided into tenths
  const unit = niceStep(70 / (5 * s));
  const uw = unit * s, sbx = tb.x + 14, sby = tb.y - 7.5;
  const sb = [];
  for (let k = 0; k < 5; k++) sb.push(`<rect x="${f2(sbx + k * uw)}" y="${f2(sby)}" width="${f2(uw)}" height="1.4" fill="${k % 2 ? 'none' : ink}" stroke="${ink}" stroke-width="0.15"/>`);
  for (let k = 0; k < 10; k++) sb.push(`<rect x="${f2(sbx - uw + (k * uw) / 10)}" y="${f2(sby)}" width="${f2(uw / 10)}" height="1.4" fill="${k % 2 ? ink : 'none'}" stroke="${ink}" stroke-width="0.12"/>`);
  for (let k = 0; k <= 5; k++) sb.push(`<text x="${f2(sbx + k * uw)}" y="${f2(sby - 1.1)}" font-size="1.9" text-anchor="middle" class="type" fill="${ink}">${f2(k * unit)}</text>`);
  sb.push(`<text x="${f2(sbx - uw)}" y="${f2(sby - 1.1)}" font-size="1.9" text-anchor="middle" class="type" fill="${ink}">${f2(unit)}</text>`);
  sb.push(`<text x="${f2(sbx + 5 * uw + 2)}" y="${f2(sby + 1.3)}" font-size="2" class="type" fill="${ink}">METRES</text>`);
  sb.push(`<text x="${f2(sbx + 2.5 * uw)}" y="${f2(sby + 4.4)}" font-size="1.8" text-anchor="middle" class="type" fill="${ink}">SCALE 1:${denom}</text>`);
  out.push(`<g>${sb.join('')}</g>`);
  if (cert) out.push(certificateBlock(cert, tb.x, tb.y - 12 - CERT_H, tb.w, CERT_H - 3, ink));

  // frame with zone references, as on an engineering sheet
  const fz = [];
  fz.push(`<rect x="5" y="5" width="${W - 10}" height="${H - 10}" fill="none" stroke="${ink}" stroke-width="0.15"/>`);
  fz.push(`<rect x="${fr.l}" y="${fr.t}" width="${fr.r - fr.l}" height="${fr.b - fr.t}" fill="none" stroke="${ink}" stroke-width="0.7"/>`);
  const nx = Math.round((fr.r - fr.l) / 50), ny = Math.round((fr.b - fr.t) / 50);
  for (let k = 0; k <= nx; k++) {
    const x = fr.l + ((fr.r - fr.l) * k) / nx;
    if (k > 0 && k < nx) { fz.push(`<line x1="${f2(x)}" y1="5" x2="${f2(x)}" y2="${fr.t}" stroke="${ink}" stroke-width="0.15"/>`, `<line x1="${f2(x)}" y1="${fr.b}" x2="${f2(x)}" y2="${H - 5}" stroke="${ink}" stroke-width="0.15"/>`); }
    if (k < nx) { const cxm = x + (fr.r - fr.l) / nx / 2; fz.push(`<text x="${f2(cxm)}" y="8.6" font-size="2.2" text-anchor="middle" class="type" fill="${ink}">${k + 1}</text>`, `<text x="${f2(cxm)}" y="${H - 6.4}" font-size="2.2" text-anchor="middle" class="type" fill="${ink}">${k + 1}</text>`); }
  }
  for (let k = 0; k <= ny; k++) {
    const y = fr.t + ((fr.b - fr.t) * k) / ny;
    if (k > 0 && k < ny) fz.push(`<line x1="5" y1="${f2(y)}" x2="${fr.l}" y2="${f2(y)}" stroke="${ink}" stroke-width="0.15"/>`, `<line x1="${fr.r}" y1="${f2(y)}" x2="${W - 5}" y2="${f2(y)}" stroke="${ink}" stroke-width="0.15"/>`);
    if (k < ny) { const cym = y + (fr.b - fr.t) / ny / 2 + 0.8; const L_ = 'ABCDEFGHJK'[k]; fz.push(`<text x="12.5" y="${f2(cym)}" font-size="2.2" text-anchor="middle" class="type" fill="${ink}">${L_}</text>`, `<text x="${W - 7.5}" y="${f2(cym)}" font-size="2.2" text-anchor="middle" class="type" fill="${ink}">${L_}</text>`); }
  }

  // ---------------------------------------------------------------- assemble
  const defs = o.aged ? agedDefs(W, H) : '';
  const bg = o.aged
    ? `<rect width="${W}" height="${H}" fill="${paper}"/>
       <rect width="${W}" height="${H}" filter="url(#sl-blotch)" opacity="0.9"/>
       <rect width="${W}" height="${H}" filter="url(#sl-grain)" opacity="0.4"/>
       <line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" stroke="url(#sl-foldv)" stroke-width="3"/>
       <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="url(#sl-foldh)" stroke-width="3"/>
       <rect width="${W}" height="${H}" fill="url(#sl-vignette)"/>`
    : `<rect width="${W}" height="${H}" fill="#fff"/>`;
  const inkFilter = o.aged ? 'filter="url(#sl-ink)"' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" class="lines-sheet">
<title>Lines of ${esc(meta.name || 'vessel')} — Flinders University Maritime Archaeology Program</title>
<defs>${defs}<style>${SHEET_CSS}</style></defs>
${bg}
<g ${inkFilter} opacity="${o.aged ? 0.92 : 1}">${fz.join('')}${out.join('\n')}</g>
</svg>`;
  return { svg, scale: denom, paper: o.paper, size: [W, H], layout };
}

function certificateBlock(c, x, y, w, h, ink) {
  const red = '#8e1b17';
  const o = [];
  o.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="none" stroke="${ink}" stroke-width="0.6"/>`);
  o.push(`<rect x="${f2(x + 1.3)}" y="${f2(y + 1.3)}" width="${f2(w - 2.6)}" height="${f2(h - 2.6)}" fill="none" stroke="${ink}" stroke-width="0.18"/>`);
  const cx = x + (w - 30) / 2;
  const t = (yy, txt, size, cls, extra = '') => o.push(`<text x="${f2(cx)}" y="${f2(y + yy)}" font-size="${size}" text-anchor="middle" class="${cls}" fill="${ink}" ${extra}>${esc(txt)}</text>`);
  t(7.4, 'CERTIFICATE OF PROFICIENCY', 4.3, 'title', 'letter-spacing="0.6"');
  t(11.6, 'Ship Lines  ·  Maritime Archaeology Program', 2.1, 'type');
  t(17.4, 'This is to certify that', 2.5, 'hand');
  t(24.6, c.student || 'Student', 5.4, 'title');
  o.push(`<line x1="${f2(cx - 48)}" y1="${f2(y + 26.2)}" x2="${f2(cx + 48)}" y2="${f2(y + 26.2)}" stroke="${ink}" stroke-width="0.18"/>`);
  t(30.6, 'has identified, labelled, shaped and faired the lines of a ship’s hull', 2.3, 'hand');
  t(36.8, `Score ${c.score} / 100   ·   ${c.grade}`, 3.4, 'title', 'letter-spacing="0.3"');
  t(41.6, c.breakdown || '', 1.85, 'type');
  // wax seal
  const sx = x + w - 18, sy = y + h / 2 + 1, r = 12;
  const id = 'seal' + Math.round(sx * 10);
  o.push(`<g transform="rotate(-8 ${f2(sx)} ${f2(sy)})">
    <path d="M${f2(sx - r - 1.4)},${f2(sy)} ${[...Array(24)].map((_, k) => { const a = (k / 24) * Math.PI * 2, rr = r + (k % 2 ? 1.6 : 0.6); return `L${f2(sx + rr * Math.cos(a))},${f2(sy + rr * Math.sin(a))}`; }).join(' ')}Z" fill="${red}" opacity="0.92"/>
    <circle cx="${f2(sx)}" cy="${f2(sy)}" r="${r - 1.5}" fill="none" stroke="#e8c9a0" stroke-width="0.3" opacity="0.8"/>
    <circle cx="${f2(sx)}" cy="${f2(sy)}" r="${r - 5.2}" fill="none" stroke="#e8c9a0" stroke-width="0.25" opacity="0.8"/>
    <path id="${id}" d="M${f2(sx - (r - 3.4))},${f2(sy)} a${r - 3.4},${r - 3.4} 0 1,1 ${f2(2 * (r - 3.4))},0 a${r - 3.4},${r - 3.4} 0 1,1 ${f2(-2 * (r - 3.4))},0" fill="none"/>
    <text font-size="1.75" class="type" fill="#f3dcb8" letter-spacing="0.25"><textPath href="#${id}">FLINDERS UNIVERSITY · MARITIME ARCHAEOLOGY ·</textPath></text>
    <g stroke="#f3dcb8" stroke-width="0.45" fill="none" stroke-linecap="round">
      <circle cx="${f2(sx)}" cy="${f2(sy - 4.6)}" r="0.9"/>
      <line x1="${f2(sx)}" y1="${f2(sy - 3.7)}" x2="${f2(sx)}" y2="${f2(sy + 4.4)}"/>
      <line x1="${f2(sx - 2.2)}" y1="${f2(sy - 2.6)}" x2="${f2(sx + 2.2)}" y2="${f2(sy - 2.6)}"/>
      <path d="M${f2(sx - 3.6)},${f2(sy + 1.6)} Q${f2(sx - 3.2)},${f2(sy + 4.6)} ${f2(sx)},${f2(sy + 4.6)} Q${f2(sx + 3.2)},${f2(sy + 4.6)} ${f2(sx + 3.6)},${f2(sy + 1.6)}"/>
    </g>
  </g>`);
  o.push(`<text x="${f2(sx)}" y="${f2(y + h - 2.6)}" font-size="1.7" text-anchor="middle" class="type" fill="${ink}">${esc(c.date || '')}</text>`);
  return `<g class="certificate">${o.join('')}</g>`;
}

const SHEET_CSS = `
.lines-sheet .hand{font-family:'Architects Daughter','Comic Neue',cursive;}
.lines-sheet .title{font-family:'IM Fell English SC',Georgia,serif;letter-spacing:.35px}
.lines-sheet .type{font-family:'Special Elite','Courier New',monospace;}
`;

function agedDefs(W, H) {
  return `
  <filter id="sl-grain" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
    <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="11" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.33  0 0 0 0 0.2  0 0 0 -1.3 0.75"/>
  </filter>
  <filter id="sl-blotch" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
    <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="4" seed="4" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.62  0 0 0 0 0.48  0 0 0 0 0.26  0 0 0 1.25 -0.55"/>
  </filter>
  <filter id="sl-ink" x="-1%" y="-1%" width="102%" height="102%">
    <feTurbulence type="fractalNoise" baseFrequency="0.14" numOctaves="2" seed="3" result="t"/>
    <feDisplacementMap in="SourceGraphic" in2="t" scale="0.2" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="0.045"/>
  </filter>
  <radialGradient id="sl-vignette" cx="50%" cy="48%" r="75%">
    <stop offset="0.55" stop-color="#7a5a2a" stop-opacity="0"/>
    <stop offset="1" stop-color="#6b4a1e" stop-opacity="0.32"/>
  </radialGradient>
  <linearGradient id="sl-foldv" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0" stop-color="#5a4524" stop-opacity="0"/><stop offset="0.5" stop-color="#5a4524" stop-opacity="0.10"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="sl-foldh" x1="0" x2="0" y1="0" y2="1">
    <stop offset="0" stop-color="#5a4524" stop-opacity="0"/><stop offset="0.5" stop-color="#5a4524" stop-opacity="0.09"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>`;
}
