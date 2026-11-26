import { PRESETS, makePreset, cloneCage, isLocked } from './presets.js?v=20';
import { gridFromCage, subdivide } from './subdiv.js?v=20';
import { computeLines, hydrostatics, offsetsTable, LINE_DEFAULTS } from './lines.js?v=20';
import { Viewer3D } from './viewer3d.js?v=20';
import { renderDrawing, PAPERS } from './drawing2d.js?v=20';
import { initGame } from './game.js?v=20';
import { initReference } from './refui.js?v=20';
import { initTrace } from './traceui.js?v=20';
import { loftGrid } from './loft.js?v=20';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ------------------------------------------------------------------ state
const state = {
  cage: null,
  level: 2,
  lineOpts: { ...LINE_DEFAULTS },
  view: '3d',
  paper: 'A3', aged: true, inks: 'mono', layout: 'auto',
  drawnBy: '', date: new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }),
};
let grid = null, lines = null, hydro = null;
const undo = [], redo = [];

const viewer = new Viewer3D($('#gl'), {
  onEdit(phase) {
    if (phase === 'start') pushUndo();
    schedule(phase === 'end');
    if (phase === 'drag') showSel();
  },
  onSelect: () => showSel(),
});

// ------------------------------------------------------------------ pipeline
let raf = 0, hydroTimer = 0, drawTimer = 0;
const hydroWaiters = [];
function schedule(full = true) {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; rebuild(); });
  clearTimeout(hydroTimer);
  hydroTimer = setTimeout(() => {
    hydro = hydrostatics(grid, lines); ref?.afterHydro(); renderHud(); if (state.view === '2d') renderSheet();
    const w = hydroWaiters.splice(0); w.forEach((f) => f(hydro, lines));
    api.onUpdate?.();
  }, full ? 30 : 160);
}
function rebuild() {
  const lofted = state.source === 'loft' ? loftGrid(state.trace) : null;
  state.loftOk = !!lofted;
  grid = lofted || subdivide(gridFromCage(state.cage), state.level);
  lines = computeLines(grid, state.lineOpts);
  viewer.convention = state.lineOpts.convention;
  const blank = state.source === 'loft' && !lofted;
  if (viewer.blank !== blank) { viewer.blank = blank; viewer.setSurfaceMode(viewer.surfaceMode); }
  document.body.classList.toggle('trace-blank', blank);
  viewer.updateSurface(grid);
  ref?.afterLines(grid, lines);
  viewer.updateLines(lines);
  viewer.updateCage();
  renderHud();
  trace?.render();
}

// ------------------------------------------------------------------ presets
function presetIcon(key) {
  const c = makePreset(key);
  const xs = c.pts.flat().map((p) => p.x), zs = c.pts.flat().map((p) => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z1 = Math.max(...zs);
  const sx = (x) => 4 + ((x1 - x) / (x1 - x0)) * 92, sz = (z) => 24 - (z / z1) * 20; // bow left
  const sheer = c.pts.map((r) => r[c.nj - 1]), keel = c.pts.map((r) => r[0]);
  const stem = c.pts[c.ni - 1], stern = c.pts[0];
  const path = [...keel, ...stem.slice(1), ...[...sheer].reverse().slice(1), ...[...stern].reverse().slice(1)];
  const d = path.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sz(p.z).toFixed(1)}`).join('') + 'Z';
  return `<svg viewBox="0 0 100 28" preserveAspectRatio="xMidYMid meet"><path d="${d}" fill="rgba(61,232,255,.12)" stroke="#3DE8FF" stroke-width="1.2" stroke-linejoin="round"/><line x1="0" y1="${(24 - 0.6 * 20).toFixed(1)}" x2="100" y2="${(24 - 0.6 * 20).toFixed(1)}" stroke="#FFD300" stroke-width=".6" stroke-dasharray="3 2"/></svg>`;
}
function buildPresetButtons() {
  const host = $('#presets');
  host.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button data-preset="${k}" title="${p.blurb}">${presetIcon(k)}<span>${p.label}</span></button>`).join('');
  host.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-preset]'); if (!b) return;
    if (state.cage) pushUndo();
    loadPreset(b.dataset.preset);
  });
}
function loadPreset(key, keepUndo = true, silent = false) {
  state.cage = makePreset(key);
  $('#d-name').value = state.cage.name;
  hydro = null;
  applyCage(true);
  if (!keepUndo) undo.length = 0;
  if (!silent) toast(`${PRESETS[key].label} loaded`);
}
function applyCage(recentre) {
  $$('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.preset === state.cage.preset));
  $('#preset-blurb').textContent = PRESETS[state.cage.preset]?.blurb || '';
  viewer.select(null);
  viewer.setCage(state.cage, recentre);
  rebuild();
  if (recentre) { viewer._framed = false; viewer.updateLines(lines); viewer.setView(viewer.view || 'persp'); ref?.onRecentre(); }
  schedule(true);
  updateUndoButtons();
}

// ------------------------------------------------------------------ undo
const snapshot = () => JSON.stringify({ cage: state.cage, trace: state.trace, source: state.source });
function pushUndo() {
  undo.push(snapshot()); if (undo.length > 120) undo.shift();
  redo.length = 0; updateUndoButtons();
}
function doUndo(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  const snap = JSON.parse(from.pop());
  const c = snap.cage || snap;
  if (snap.trace) state.trace = snap.trace;
  const recentre = c.preset !== state.cage.preset;
  state.cage = c;
  applyCage(recentre);
  trace?.list();
}
function updateUndoButtons() { $('#btn-undo').disabled = !undo.length; $('#btn-redo').disabled = !redo.length; }

// ------------------------------------------------------------------ selection panel
function showSel() {
  const s = viewer.sel, host = $('#selinfo');
  if (!s) {
    host.innerHTML = `<p class="hint"><b>Drag</b> an <b class="c-handle">orange handle</b> directly (it moves in the plane of the view), or click it and use the gizmo arrows or arrow keys. <b class="c-locked">Red</b> handles sit on the centreplane (keel, stem, sternpost) and only move in height and length.</p>`;
    $('#hud-title').innerHTML = hudTitle();
    return;
  }
  const p = state.cage.pts[s.i][s.j];
  const locked = isLocked(state.cage, s.i, s.j);
  const what = viewer.mode === 'station' ? `Control section ${s.i}` : viewer.mode === 'longitudinal' ? `Fore–aft row ${s.j}` : `Point S${s.i}·P${s.j}`;
  const sig = `${s.i},${s.j},${viewer.mode}`;
  if (host.dataset.sig !== sig || !host.querySelector('.coord')) {
    host.dataset.sig = sig;
    host.innerHTML = `<div class="coord"><span class="id">▸ ${what}${locked ? ' · on centreplane' : ''}</span>
      <label>x</label><input data-ax="x" type="number" step="0.05">
      <label>y</label><input data-ax="y" type="number" step="0.05" ${locked ? 'disabled' : ''}>
      <label>z</label><input data-ax="z" type="number" step="0.05"></div>
      <p class="hint">x fore-and-aft · y half-breadth · z height (m). ${viewer.mode !== 'point' ? 'Typed values move the whole group.' : ''}</p>`;
    host.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
      const ax = inp.dataset.ax, v = parseFloat(inp.value); if (!isFinite(v)) return;
      pushUndo();
      const d = v - state.cage.pts[s.i][s.j][ax];
      for (const [i, j] of viewer.sel.members) {
        const q = state.cage.pts[i][j];
        if (ax === 'y') q.y = isLocked(state.cage, i, j) ? 0 : Math.max(0, q.y + d); else q[ax] += d;
      }
      schedule(true); showSel();
    }));
  }
  for (const inp of host.querySelectorAll('input')) if (document.activeElement !== inp) inp.value = p[inp.dataset.ax].toFixed(3);
  $('#hud-title').innerHTML = hudTitle();
}

function hudTitle() {
  const s = viewer.sel;
  const t = state.source === 'loft'
    ? `<span>TRACED HULL · ${state.loftOk ? 'LOFTED THROUGH BATTENS' : 'TRACING…'}</span><b>${esc($('#d-name').value || 'Traced hull')}</b>`
    : `<span>${(state.cage?.type || '').toUpperCase()} · CATMULL–CLARK L${state.level}</span><b>${esc(state.cage?.name || '')}</b>`;
  return s ? t + `<span class="sel">◉ EDITING ${viewer.mode === 'point' ? `S${s.i}·P${s.j}` : viewer.mode === 'station' ? `SECTION ${s.i}` : `ROW ${s.j}`}</span>` : t;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ HUD data
function renderHud() {
  if (!lines) return;
  const b = lines.bounds, h = hydro;
  const kv = (k, v, u = '') => `<div class="kv"><span>${k}</span><b>${v}${u ? ' <small>' + u + '</small>' : ''}</b></div>`;
  const bar = (v) => `<div class="bar"><i style="width:${Math.max(0, Math.min(1, v)) * 100}%"></i></div>`;
  let html = `<h4>HULL DATA <em>m</em></h4>`;
  html += kv('LOA', b.L.toFixed(2)) + kv('Beam (moulded)', (2 * b.B2).toFixed(2)) + kv('Depth amidships', b.Hmid.toFixed(2));
  if (h) {
    html += `<hr>` + kv('LWL draught T', h.T.toFixed(2)) + kv('L<sub>WL</sub> × B<sub>WL</sub>', `${h.Lwl.toFixed(1)} × ${h.Bwl.toFixed(2)}`);
    html += kv('Volume ∇', h.V.toFixed(1), 'm³') + kv('Displacement Δ', h.disp.toFixed(1), 't SW');
    html += kv('LCB from aft', h.LCB.toFixed(2)) + `<hr>`;
    html += kv('Block C<sub>b</sub>', h.Cb.toFixed(3)) + bar(h.Cb);
    html += kv('Prismatic C<sub>p</sub>', h.Cp.toFixed(3)) + bar(h.Cp);
    html += kv('Midship C<sub>m</sub>', h.Cm.toFixed(3)) + bar(h.Cm);
    html += kv('Waterplane C<sub>wp</sub>', h.Cwp.toFixed(3)) + bar(h.Cwp);
  }
  $('#hud-data').innerHTML = html;
  $('#hud-title').innerHTML = hudTitle();
}

// ------------------------------------------------------------------ 2D sheet
const sheetView = { k: 1, x: 0, y: 0, fitted: false };
let lastSheet = null;
function renderSheet() {
  if (!lines) return;
  if (!hydro) hydro = hydrostatics(grid, lines);
  if (state.source === 'loft' && !state.loftOk) { $('#sheet').innerHTML = '<div class="sheet-wait">Finish tracing the lines to draw the lofted hull.</div>'; return; }
  const meta = { name: $('#d-name').value || state.cage.name, type: state.source === 'loft' ? 'Lofted from traced lines' : state.cage.type, drawnBy: $('#d-by').value, date: state.date, level: state.level, hydro, surface: state.source === 'loft' ? 'Lofted battens' : null, sternClosed: state.source === 'loft' ? true : state.cage.sternClosed, certificate: state.certificate && state.showCert ? state.certificate : null, reconstruction: ref?.sheetMeta() };
  const r = renderDrawing(lines, meta, { paper: state.paper, aged: state.aged, inks: state.inks, convention: state.lineOpts.convention, layout: state.layout });
  lastSheet = r;
  const el = $('#sheet');
  el.innerHTML = r.svg;
  el.dataset.w = r.size[0]; el.dataset.h = r.size[1];
  if (!sheetView.fitted) fitSheet(); else applySheetView();
  $('#sheet-note').textContent = `${r.paper} · scale 1:${r.scale} · body plan ${r.layout} · drag to pan · scroll to zoom`;
}
function fitSheet() {
  const vp = $('#sheet-vp'), el = $('#sheet');
  const W = +el.dataset.w || 420, H = +el.dataset.h || 297;
  const k = Math.min((vp.clientWidth - 40) / W, (vp.clientHeight - 40) / H);
  sheetView.k = k; sheetView.x = (vp.clientWidth - W * k) / 2; sheetView.y = (vp.clientHeight - H * k) / 2; sheetView.fitted = true;
  applySheetView();
}
function applySheetView() {
  const el = $('#sheet');
  const W = +el.dataset.w, H = +el.dataset.h;
  el.style.width = `${W * sheetView.k}px`; el.style.height = `${H * sheetView.k}px`;
  el.style.transform = `translate(${sheetView.x}px, ${sheetView.y}px)`;
}
function initSheetPanZoom() {
  const vp = $('#sheet-vp');
  let drag = null;
  vp.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, sx: sheetView.x, sy: sheetView.y }; vp.classList.add('drag'); vp.setPointerCapture(e.pointerId); });
  vp.addEventListener('pointermove', (e) => { if (!drag) return; sheetView.x = drag.sx + e.clientX - drag.x; sheetView.y = drag.sy + e.clientY - drag.y; applySheetView(); });
  vp.addEventListener('pointerup', () => { drag = null; vp.classList.remove('drag'); });
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015), k2 = Math.max(0.3, Math.min(30, sheetView.k * f)), ff = k2 / sheetView.k;
    sheetView.x = mx - (mx - sheetView.x) * ff; sheetView.y = my - (my - sheetView.y) * ff; sheetView.k = k2;
    applySheetView();
  }, { passive: false });
  new ResizeObserver(() => { if (state.view === '2d' && sheetView.fitted) fitSheet(); }).observe(vp);
}

// ------------------------------------------------------------------ exports
function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const slug = () => (($('#d-name').value || state.cage.name || 'hull').replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '') || 'hull');
let fontCSS = null;
async function embeddedFontCSS() {
  if (fontCSS) return fontCSS;
  const files = [['Architects Daughter', 'architects-daughter-latin-400-normal.woff2'], ['IM Fell English SC', 'im-fell-english-sc-latin-400-normal.woff2'], ['Special Elite', 'special-elite-latin-400-normal.woff2']];
  const parts = await Promise.all(files.map(async ([fam, f]) => {
    const buf = await (await fetch(`fonts/${f}`)).arrayBuffer();
    let bin = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return `@font-face{font-family:'${fam}';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');}`;
  }));
  return (fontCSS = parts.join(''));
}
async function sheetSVGStandalone() {
  renderSheet();
  const css = await embeddedFontCSS();
  return lastSheet.svg.replace('<style>', `<style>${css}`);
}
async function exportPNG(dpi = 200) {
  const svg = await sheetSVGStandalone();
  const [W, H] = lastSheet.size;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'); c.width = Math.round((W / 25.4) * dpi); c.height = Math.round((H / 25.4) * dpi);
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob((b) => download(`${slug()}_lines_${lastSheet.paper}.png`, b), 'image/png');
}
async function printSheet() {
  const svg = await sheetSVGStandalone();
  const [W, H] = lastSheet.size;
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to print'); return; }
  w.document.write(`<!doctype html><title>${esc(slug())} lines</title><style>@page{size:${W}mm ${H}mm;margin:0}html,body{margin:0}svg{width:${W}mm;height:${H}mm;display:block}</style>${svg}<script>setTimeout(()=>print(),400)<\/script>`);
  w.document.close();
}
function exportOBJ() {
  const g = grid, n = g.rows * g.cols, out = ['# Shiplines hull surface (both sides), metres, Y-up', `# ${state.cage.name} · Catmull-Clark level ${state.level}`, 'o hull'];
  for (const side of [1, -1]) for (let v = 0; v < n; v++) out.push(`v ${g.p[v * 3].toFixed(4)} ${g.p[v * 3 + 2].toFixed(4)} ${(-side * g.p[v * 3 + 1]).toFixed(4)}`);
  for (const [side, off] of [[1, 0], [-1, n]]) for (let i = 0; i < g.rows - 1; i++) for (let j = 0; j < g.cols - 1; j++) {
    const a = off + i * g.cols + j + 1, b = a + 1, c = a + g.cols, d = c + 1;
    out.push(side > 0 ? `f ${a} ${c} ${d} ${b}` : `f ${a} ${b} ${d} ${c}`);
  }
  download(`${slug()}_hull.obj`, out.join('\n'), 'text/plain');
}
function exportCSV() {
  const rows = offsetsTable(lines);
  const head = [`# Table of offsets: ${state.cage.name} (${state.cage.type}); metres from baseline and centreline; Catmull-Clark level ${state.level}`];
  download(`${slug()}_offsets.csv`, head.concat(rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))).join('\n'), 'text/csv');
}
function saveJSON() {
  const data = { app: 'shiplines', version: 1, saved: new Date().toISOString(), cage: state.cage, level: state.level, lineOpts: state.lineOpts, drawing: { name: $('#d-name').value, drawnBy: $('#d-by').value, paper: state.paper }, reference: ref.save(), trace: state.trace, source: state.source };
  download(`${slug()}.shiplines.json`, JSON.stringify(data, null, 1), 'application/json');
}
function loadJSON(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result);
      if (!d.cage || !d.cage.pts) throw new Error('not a Shiplines design');
      pushUndo();
      state.cage = d.cage; state.level = d.level ?? 2; Object.assign(state.lineOpts, d.lineOpts || {});
      if (d.drawing) { $('#d-name').value = d.drawing.name || d.cage.name; $('#d-by').value = d.drawing.drawnBy || ''; state.paper = d.drawing.paper || 'A3'; }
      if (d.trace) state.trace = d.trace;
      if (d.source === 'loft' && !trace.on) trace.enter(); else if (d.source !== 'loft' && trace.on) trace.exit();
      syncControls(); applyCage(true); ref.load(d.reference); trace.loaded(); toast('Design opened');
    } catch (e) { toast('Could not open: ' + e.message); }
  };
  fr.readAsText(file);
}

// ------------------------------------------------------------------ UI wiring
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), Math.max(1800, msg.length * 55)); }
function seg(sel, attr, fn) {
  $(sel).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$(`${sel} button`).forEach((x) => x.classList.toggle('on', x === b));
    fn(b.dataset[attr]);
  });
}
function bindSlider(id, out, fmt, fn) {
  const el = $(id), o = $(out);
  const upd = () => { o.textContent = fmt(+el.value); fn(+el.value); };
  el.addEventListener('input', upd);
  return el;
}
function syncControls() {
  const L = state.lineOpts;
  const set = (id, v, out, f) => { $(id).value = v; $(out).textContent = f(v); };
  set('#level', state.level, '#o-level', String);
  set('#stations', L.stations, '#o-stations', String);
  set('#wl', L.wlBelow, '#o-wl', String);
  set('#lwl', L.lwlRatio, '#o-lwl', (v) => (+v).toFixed(2));
  set('#btk', L.buttocks, '#o-btk', String);
  set('#diag', L.diagonals, '#o-diag', String);
  $('#t-wlabove').checked = L.wlAbove;
  $('#convention').value = L.convention;
  $('#d-paper').value = state.paper;
}
function setView(v) {
  state.view = v;
  $$('.tab').forEach((t) => { const on = t.dataset.view === v; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
  $('#view-3d').classList.toggle('active', v === '3d');
  $('#view-2d').classList.toggle('active', v === '2d');
  if (v === '2d') { renderSheet(); if (!sheetView.fitted) fitSheet(); }
  else viewer.resize();
}

// ------------------------------------------------------------------ arrow-key nudging
// Moves the selected handle(s) in the plane of the current view; Shift for fine steps.
let lastNudge = 0;
function nudge(key, fine) {
  const b = lines.bounds, f = fine ? 0.2 : 1;
  const sx = b.L * 0.005 * f, sy = b.B2 * 0.02 * f, sz = b.Hmax * 0.015 * f;
  const steffy = state.lineOpts.convention === 'steffy';
  const h = key === 'arrowright' ? 1 : key === 'arrowleft' ? -1 : 0, v = key === 'arrowup' ? 1 : key === 'arrowdown' ? -1 : 0;
  let d = [0, 0, 0];
  switch (viewer.view) {
    case 'profile': d = [h * sx * (steffy ? -1 : 1), 0, v * sz]; break;
    case 'plan': d = [h * sx * (steffy ? -1 : 1), v * sy * (steffy ? 1 : -1), 0]; break;
    case 'body': d = [0, -h * sy, v * sz]; break;
    default: d = [0, h * sy, v * sz];
  }
  if (performance.now() - lastNudge > 700) pushUndo();
  lastNudge = performance.now();
  viewer.nudge(...d);
  schedule(true); showSel();
}

// ------------------------------------------------------------------ game API
function setCam(v) {
  $$('.hud-views button').forEach((x) => x.classList.toggle('on', x.dataset.cam === v));
  viewer.setView(v);
}
function setSurface(m) {
  $$('#surf-mode button').forEach((x) => x.classList.toggle('on', x.dataset.surf === m));
  viewer.setSurfaceMode(m);
}
const api = {
  state, viewer, onUpdate: null,
  lines: () => lines, hydro: () => hydro,
  loadPreset: (k, o = {}) => loadPreset(k, false, !!o.silent),
  refresh: (full) => { viewer.updateCage(); rebuild(); viewer.updateLines(lines); schedule(true); },
  whenHydro: (f) => { hydroWaiters.push(f); schedule(true); },
  clearUndo: () => { undo.length = 0; redo.length = 0; updateUndoButtons(); },
  setCam, setSurface, setView: (v) => setView(v),
  setMode: (m) => $(`#sel-mode button[data-mode="${m}"]`).click(),
  drawnBy: () => $('#d-by').value,
  dateString: () => state.date,
  saveState: () => ({ cage: JSON.stringify(state.cage), level: state.level, lineOpts: { ...state.lineOpts }, name: $('#d-name').value, surface: viewer.surfaceMode,
    toggles: { showCage: $('#t-cage').checked, showLabels: $('#t-labels').checked } }),
  restoreState(sv) {
    if (sv.lineOpts.convention !== state.lineOpts.convention) ref.onConvention(state.lineOpts.convention, sv.lineOpts.convention);
    state.cage = JSON.parse(sv.cage); state.level = sv.level; Object.assign(state.lineOpts, sv.lineOpts);
    syncControls(); viewer.setToggles(sv.toggles); setSurface(sv.surface); setCam('persp');
    applyCage(true); $('#d-name').value = sv.name;
    api.clearUndo();
  },
  loadCage(c, { name, drawnBy }) {
    state.cage = cloneCage(c); state.cage.name = name;
    $('#d-name').value = name; $('#d-by').value = drawnBy;
    viewer.setToggles({ showCage: true, showLabels: true }); setSurface('holo'); setCam('persp');
    applyCage(true); api.clearUndo();
  },
  setCertificate(r) {
    state.certificate = r; state.showCert = true;
    $('#d-cert').hidden = false; $('#d-cert').classList.add('on');
    sheetView.fitted = false;
  },
  setLock(on) {
    if (on && trace.on) trace.exit();
    state.playing = on;
    ref.setPlaying(on);
    if (on && state.lineOpts.convention !== 'steffy') ref.onConvention(state.lineOpts.convention, 'steffy');
    if (on) {
      // the game uses the default line set and Steffy's convention
      api._prevLineOpts = { ...state.lineOpts };
      Object.assign(state.lineOpts, LINE_DEFAULTS, { convention: 'steffy' });
      state.level = 2; syncControls();
      viewer.convention = 'steffy';
      setView('3d');
    }
    $('#convention').disabled = on;
    $('#btn-reset').disabled = on;
  },
};

let ref = null, trace = null;

function init() {
  ref = initReference({ state, viewer, lines: () => lines, grid: () => grid, schedule, toast, setCam, download, onHookReleased: () => trace?.reinstall() });
  trace = initTrace({ state, viewer, schedule, toast, setCam, pushUndo, cageLines: () => computeLines(subdivide(gridFromCage(state.cage), 2), state.lineOpts) });
  viewer.onViewChange = () => trace?.viewChanged();
  buildPresetButtons();
  initSheetPanZoom();
  $$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  seg('#sel-mode', 'mode', (m) => { viewer.setMode(m); showSel(); });
  seg('#surf-mode', 'surf', (m) => viewer.setSurfaceMode(m));
  seg('#d-style', 'style', (m) => { state.aged = m === 'aged'; renderSheet(); });
  seg('#d-inks', 'inks', (m) => { state.inks = m; renderSheet(); });
  $$('.hud-views button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.cam === 'frame') { if (viewer.view && viewer.view !== 'persp') viewer.setView(viewer.view); else viewer.frame(); return; }
    $$('.hud-views button').forEach((x) => x.classList.toggle('on', x === b));
    viewer.setView(b.dataset.cam);
  }));

  bindSlider('#level', '#o-level', String, (v) => { state.level = v; schedule(true); });
  bindSlider('#stations', '#o-stations', String, (v) => { state.lineOpts.stations = v; schedule(true); });
  bindSlider('#wl', '#o-wl', String, (v) => { state.lineOpts.wlBelow = v; schedule(true); });
  bindSlider('#lwl', '#o-lwl', (v) => v.toFixed(2), (v) => { state.lineOpts.lwlRatio = v; schedule(true); });
  bindSlider('#btk', '#o-btk', String, (v) => { state.lineOpts.buttocks = v; schedule(true); });
  bindSlider('#diag', '#o-diag', String, (v) => { state.lineOpts.diagonals = v; schedule(true); });
  bindSlider('#lw', '#o-lw', (v) => `${v} px`, (v) => { viewer.lineWidth = v; viewer.updateLines(lines); });
  $('#t-wlabove').addEventListener('change', (e) => { state.lineOpts.wlAbove = e.target.checked; schedule(true); });
  $('#convention').addEventListener('change', (e) => {
    const from = state.lineOpts.convention;
    state.lineOpts.convention = e.target.value; viewer.convention = e.target.value;
    ref.onConvention(from, e.target.value);
    schedule(true);
    if (viewer.view && viewer.view !== 'persp') viewer.setView(viewer.view);
  });
  $$('[data-vis]').forEach((c) => c.addEventListener('change', () => { viewer.vis[c.dataset.vis] = c.checked; viewer.updateLines(lines); }));
  const tog = () => viewer.setToggles({
    showCage: $('#t-cage').checked, showWire: $('#t-wire').checked, showMirror: $('#t-mirror').checked,
    showWater: $('#t-water').checked, showLabels: $('#t-labels').checked, bloomOn: $('#t-bloom').checked,
  });
  ['#t-cage', '#t-wire', '#t-mirror', '#t-water', '#t-bloom'].forEach((id) => $(id).addEventListener('change', tog));
  $('#t-labels').addEventListener('change', () => { tog(); viewer.updateLines(lines); });

  $('#btn-undo').addEventListener('click', () => doUndo(undo, redo));
  $('#btn-redo').addEventListener('click', () => doUndo(redo, undo));
  $('#btn-reset').addEventListener('click', () => { pushUndo(); loadPreset(state.cage.preset); });
  $('#btn-save').addEventListener('click', saveJSON);
  $('#btn-load').addEventListener('click', () => $('#file-in').click());
  $('#file-in').addEventListener('change', (e) => { if (e.target.files[0]) loadJSON(e.target.files[0]); e.target.value = ''; });
  $('#btn-csv').addEventListener('click', exportCSV);
  $('#btn-obj').addEventListener('click', exportOBJ);
  $('#btn-shot').addEventListener('click', () => { const u = viewer.snapshot(); fetch(u).then((r) => r.blob()).then((b) => download(`${slug()}_3d.png`, b)); });

  $('#d-paper').addEventListener('change', (e) => { state.paper = e.target.value; sheetView.fitted = false; renderSheet(); });
  ['#d-name', '#d-by'].forEach((id) => $(id).addEventListener('input', () => { clearTimeout(drawTimer); drawTimer = setTimeout(renderSheet, 250); }));
  $('#d-name').addEventListener('change', (e) => { state.cage.name = e.target.value; renderHud(); });
  $('#d-layout').addEventListener('change', (e) => { state.layout = e.target.value; renderSheet(); });
  $('#d-fit').addEventListener('click', fitSheet);
  $('#d-cert').addEventListener('click', () => { state.showCert = !state.showCert; $('#d-cert').classList.toggle('on', state.showCert); renderSheet(); });
  $('#d-svg').addEventListener('click', async () => download(`${slug()}_lines_${state.paper}.svg`, await sheetSVGStandalone(), 'image/svg+xml'));
  $('#d-png').addEventListener('click', () => exportPNG(150).catch((e) => toast('PNG export failed: ' + e.message)));
  $('#d-print').addEventListener('click', printSheet);

  const help = $('#help');
  $('#btn-help').addEventListener('click', () => (help.hidden = false));
  $('#help-close').addEventListener('click', () => (help.hidden = true));
  help.addEventListener('click', (e) => { if (e.target === help) help.hidden = true; });

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (document.body.classList.contains('playing') && (k === 'tab' || ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) && document.body.classList.contains('play-quiz'))) { e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doUndo(redo, undo) : doUndo(undo, redo); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doUndo(redo, undo); return; }
    if (k === 'escape') { help.hidden = true; $('#welcome').hidden = true; viewer.select(null); }
    if (k === 'f') viewer.frame();
    if (k === 'h' || k === '?') help.hidden = !help.hidden;
    if (k === 'tab') { e.preventDefault(); setView(state.view === '3d' ? '2d' : '3d'); }
    if (k.startsWith('arrow') && viewer.sel && state.view === '3d') { e.preventDefault(); nudge(k, e.shiftKey); return; }
    const modes = { 1: 'point', 2: 'station', 3: 'longitudinal' };
    if (modes[e.key]) $(`#sel-mode button[data-mode="${modes[e.key]}"]`).click();
    if (k === 'w') viewer.tc.setMode('translate');
  });

  syncControls();
  loadPreset('clipper', false);
  undo.length = 0; updateUndoButtons();
  $('#welcome').hidden = false;
  initGame(api);
  window.__shiplines = { state, viewer, api, get lines() { return lines; }, get hydro() { return hydro; }, setView, renderSheet, loadPreset };
}
function localStorageSafe(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; }
}

init();
