// Panel logic for "Trace a plan" (underlays) and "Evidence & reconstruction".
// main.js calls the returned hooks at the right moments in its update pipeline.

import {
  viewAxes, shipToHV, imgToHV, makeUnderlay, fitUnderlay, calibrateUnderlay,
  parsePoints, parseOBJ, localize, alignLocal, normAlign, decimateIdx, boundsOf,
  deviations, fitStats, supportIndex, markSupport, surfaceSupport, sampleWreck,
} from './reference.js?v=17';
import * as THREE from 'three';
import { gridFromCage, subdivide } from './subdiv.js?v=17';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const VIEW_NAMES = { profile: 'Profile', plan: 'Plan', body: 'End' };
const CAL_STEPS = {
  profile: ['Click a reference point on the <b>baseline at the stern</b> (e.g. the aft perpendicular or aftmost station).', 'Now click the matching point on the baseline <b>towards the bow</b> (e.g. the forward perpendicular).', 'Distance between them along the baseline'],
  plan: ['Click the centreline at the <b>same aft reference</b> you used in the profile.', 'Now click the centreline at the <b>same forward reference</b>.', 'Distance between them along the centreline'],
  body: ['Click where the <b>centreline meets the baseline</b>.', 'Now click a point on the <b>baseline</b> a known distance out from the centreline (a buttock line, or the beam).', 'Distance out from the centreline'],
};

export function initReference(ctx) {
  const { state, viewer } = ctx;
  const R = (state.ref = { underlays: [], ulView: 'profile', ev: null, tol: 0.03, reach: 0.5, notes: '', dev: null, stats: null, has: null, supportFrac: 0 });

  // ================================================================== underlays
  const cur = () => R.underlays.find((u) => u.view === R.ulView);
  const status = (html) => ($('#ul-status').innerHTML = html || '');

  function hullHV(view) {
    const b = ctx.lines().bounds, conv = state.lineOpts.convention;
    if (view === 'body') return { span: 2 * b.B2 * 1.25, c: shipToHV('body', conv, { x: 0, y: 0, z: b.Hmax / 2 + b.z0 }) };
    const c = shipToHV(view, conv, { x: b.xmid, y: 0, z: b.Hmax / 2 + b.z0 });
    return { span: b.L * 1.1, c };
  }
  function syncUL() {
    const u = cur();
    $$('#ul-view button').forEach((b) => b.classList.toggle('on', b.dataset.v === R.ulView));
    $('#ul-ctrl').hidden = !u;
    $('#ul-cal').disabled = !u; $('#ul-del').disabled = !u; $('#ul-move').disabled = !u;
    if (u) {
      $('#ul-op').value = u.opacity; $('#o-ulop').textContent = `${Math.round(u.opacity * 100)}%`;
      $('#ul-inv').checked = u.invert; $('#ul-show').checked = u.visible;
      $('#ul-dh').value = u.adj.dh.toFixed(2); $('#ul-dv').value = u.adj.dv.toFixed(2);
      $('#ul-k').value = (u.adj.k * 100).toFixed(1); $('#ul-rot').value = u.adj.rot.toFixed(1);
      if (!R.calibrating) status(u.calibrated ? `✓ ${esc(u.name)} calibrated in the ${VIEW_NAMES[u.view]} view.` : `${esc(u.name)} placed roughly. <b>Calibrate</b> it to set the true scale.`);
    } else if (!R.calibrating) status('');
  }
  function refreshUL() { viewer.setUnderlays(R.underlays, state.lineOpts.convention); syncUL(); }

  function loadImage(file) {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        R.underlays = R.underlays.filter((u) => u.view !== R.ulView);
        const u = makeUnderlay(R.ulView, img, fr.result, file.name.replace(/\.[^.]+$/, ''));
        const { span, c } = hullHV(R.ulView);
        fitUnderlay(u, span, c[0], c[1]);
        R.underlays.push(u);
        ctx.setCam(R.ulView);
        refreshUL();
        ctx.toast(`${file.name} placed behind the ${VIEW_NAMES[R.ulView]} view`);
      };
      img.onerror = () => ctx.toast('Could not read that image');
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function startCalibration() {
    const u = cur(); if (!u) return;
    if (R.moving) stopMove();
    ctx.setCam(u.view);
    u.visible = true; refreshUL();
    const steps = CAL_STEPS[u.view];
    const pts = [];
    R.calibrating = true;
    status(`<div class="cal">1/3 · ${steps[0]} <button id="cal-x">Cancel</button></div>`);
    const cancel = () => { R.calibrating = false; viewer.clickCapture = null; syncUL(); };
    $('#cal-x').onclick = cancel;
    viewer.clickCapture = (e) => {
      const hit = viewer.pickUnderlay(e);
      if (!hit) { ctx.toast('Click on the drawing itself'); return; }
      pts.push([hit.px, hit.py]);
      if (pts.length === 1) {
        status(`<div class="cal">2/3 · ${steps[1]} <button id="cal-x">Cancel</button></div>`);
        $('#cal-x').onclick = cancel;
        return;
      }
      viewer.clickCapture = null;
      const b = ctx.lines().bounds;
      const guess = u.view === 'body' ? b.B2 : b.L;
      void b;
      status(`<div class="cal">3/3 · ${steps[2]}: <input type="number" id="cal-d" step="0.01" value="${guess.toFixed(2)}"> m <button id="cal-ok">Apply</button><button id="cal-x">Cancel</button></div>`);
      $('#cal-x').onclick = cancel;
      $('#cal-d').focus(); $('#cal-d').select();
      const apply = () => {
        const d = parseFloat($('#cal-d').value);
        if (!(d > 0)) { $('#cal-d').focus(); return; }
        const conv = state.lineOpts.convention;
        let A, B;
        // fixed anchors (x = 0 at the first point, baseline z = 0), so all three views agree
        if (u.view === 'profile') { A = { x: 0, y: 0, z: 0 }; B = { x: d, y: 0, z: 0 }; }
        else if (u.view === 'plan') { A = { x: 0, y: 0, z: 0 }; B = { x: d, y: 0, z: 0 }; }
        else { A = { x: 0, y: 0, z: 0 }; B = { x: 0, y: d, z: 0 }; }
        calibrateUnderlay(u, pts[0], pts[1], shipToHV(u.view, conv, A), shipToHV(u.view, conv, B));
        R.calibrating = false;
        refreshUL();
        ctx.toast(u.base.flip ? 'Calibrated. The drawing faces the other way, so it is shown mirrored; switch the convention to see it as drawn.' : 'Calibrated: the drawing is now at true scale');
      };
      $('#cal-ok').onclick = apply;
      $('#cal-d').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') apply(); });
    };
  }

  // keep an underlay fixed in space when the drawing convention flips the view axes
  function convertUnderlays(from, to) {
    for (const u of R.underlays) {
      const A = viewAxes(u.view, from), B = viewAxes(u.view, to);
      const sh = A.hs * B.hs, sv = A.vs * B.vs;
      if (sh > 0 && sv > 0) continue;
      const bs = u.base, a = u.adj;
      if (sh < 0 && sv < 0) { bs.th += Math.PI; bs.t = [-bs.t[0], -bs.t[1]]; a.dh = -a.dh; a.dv = -a.dv; }
      else if (sh < 0) { bs.th = -bs.th; bs.flip = !bs.flip; bs.t = [-bs.t[0], bs.t[1]]; a.dh = -a.dh; a.rot = -a.rot; }
      else { bs.th = Math.PI - bs.th; bs.flip = !bs.flip; bs.t = [bs.t[0], -bs.t[1]]; a.dv = -a.dv; a.rot = -a.rot; }
    }
  }

  $('#ul-view').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (R.moving) stopMove();
    R.ulView = b.dataset.v; ctx.setCam(R.ulView); syncUL();
  });
  $('#ul-load').addEventListener('click', () => $('#ul-file').click());
  $('#ul-file').addEventListener('change', (e) => { if (e.target.files[0]) loadImage(e.target.files[0]); e.target.value = ''; });
  $('#ul-cal').addEventListener('click', startCalibration);

  // ---- move / scale / rotate the image with the mouse
  function pointerHV(e, u) { const p = viewer.pointerShip(e); return p ? shipToHV(u.view, state.lineOpts.convention, p) : null; }
  // transform the image about a view point P: scale by f and rotate by a (degrees)
  function aboutPoint(u, P, f, aDeg) {
    const now = imgToHV(u, u.w / 2, u.h / 2);           // C + d
    const C = [now[0] - u.adj.dh, now[1] - u.adj.dv];
    const r = (aDeg * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
    const vx = now[0] - P[0], vy = now[1] - P[1];
    const nx = P[0] + f * (c * vx - sn * vy), ny = P[1] + f * (sn * vx + c * vy);
    u.adj.k *= f; u.adj.rot += aDeg; u.adj.dh = nx - C[0]; u.adj.dv = ny - C[1];
  }
  const redraw = () => { viewer.setUnderlays(R.underlays, state.lineOpts.convention); syncUL(); };
  function stopMove() {
    R.moving = false; viewer.setPointerHook(null); ctx.onHookReleased?.();
    $('#move-bar').hidden = true; $('#ul-move').classList.remove('on');
  }
  function startMove() {
    const u = cur(); if (!u) return;
    if (R.moving) { stopMove(); return; }
    ctx.setCam(u.view); u.visible = true; redraw();
    R.moving = true; $('#move-bar').hidden = false; $('#ul-move').classList.add('on');
    let last = null;
    viewer.setPointerHook({
      down: (e) => { last = pointerHV(e, u); },
      move: (e) => {
        if (!last || !(e.buttons & 1)) return;
        const p = pointerHV(e, u); if (!p) return;
        u.adj.dh += p[0] - last[0]; u.adj.dv += p[1] - last[1]; last = p;
        viewer.setUnderlays(R.underlays, state.lineOpts.convention);
      },
      up: () => { last = null; syncUL(); },
      wheel: (e) => {
        const P = pointerHV(e, u); if (!P) return;
        if (e.shiftKey) aboutPoint(u, P, 1, -Math.sign(e.deltaY || e.deltaX) * (e.altKey ? 0.05 : 0.5));
        else aboutPoint(u, P, Math.exp(-e.deltaY * (e.altKey ? 0.0002 : 0.001)), 0);
        redraw();
      },
    });
  }
  $('#ul-move').addEventListener('click', startMove);
  $('#move-done').addEventListener('click', stopMove);
  window.addEventListener('keydown', (e) => { if (R.moving && (e.key === 'Escape' || e.key === 'Enter')) stopMove(); });
  $('#ul-reset').addEventListener('click', () => { const u = cur(); if (!u) return; u.adj = { dh: 0, dv: 0, k: 1, rot: 0 }; redraw(); });
  $('#ul-simple').addEventListener('change', (e) => { viewer.simplifyTrace = e.target.checked; viewer.traceView = undefined; viewer.setUnderlays(R.underlays, state.lineOpts.convention); });
  $('#ul-del').addEventListener('click', () => { if (R.moving) stopMove(); R.underlays = R.underlays.filter((u) => u !== cur()); refreshUL(); });
  $('#ul-op').addEventListener('input', (e) => { const u = cur(); if (!u) return; u.opacity = +e.target.value; $('#o-ulop').textContent = `${Math.round(u.opacity * 100)}%`; if (u.mesh) u.mesh.material.uniforms.uOpacity.value = u.opacity; });
  $('#ul-inv').addEventListener('change', (e) => { const u = cur(); if (u) { u.invert = e.target.checked; refreshUL(); } });
  $('#ul-show').addEventListener('change', (e) => { const u = cur(); if (u) { u.visible = e.target.checked; refreshUL(); } });
  for (const [id, key, f] of [['#ul-dh', 'dh', (v) => v], ['#ul-dv', 'dv', (v) => v], ['#ul-k', 'k', (v) => v / 100], ['#ul-rot', 'rot', (v) => v]]) {
    $(id).addEventListener('input', (e) => { const u = cur(); const v = parseFloat(e.target.value); if (!u || !Number.isFinite(v) || (key === 'k' && v <= 0)) return; u.adj[key] = f(v); viewer.setUnderlays(R.underlays, state.lineOpts.convention); });
  }

  // ================================================================== evidence
  // Geometry is localised once (raw -> local axes, voxel-thinned fit set); the alignment is then a
  // cheap transform: the gizmo moves the group, and only the fit set is re-transformed.
  function buildEvidence() {
    const ev = R.ev; if (!ev) return;
    ev.Lp = ev.rawPts && ev.rawPts.length ? localize(ev.rawPts, ev.align.up) : new Float32Array(0);
    ev.Lm = ev.rawMesh ? localize(ev.rawMesh.pos, ev.align.up) : null;
    const L = new Float32Array(ev.Lp.length + (ev.Lm ? ev.Lm.length : 0));
    L.set(ev.Lp, 0); if (ev.Lm) L.set(ev.Lm, ev.Lp.length);
    // pivot on the data's own centre (site-grid files can sit far from their origin)
    if (!ev.c || ev.c.up !== ev.align.up) { const bb = boundsOf(L); ev.c = { up: ev.align.up, v: [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2] }; }
    for (const A of [L, ev.Lp, ev.Lm]) if (A) for (let i = 0; i < A.length; i += 3) { A[i] -= ev.c.v[0]; A[i + 1] -= ev.c.v[1]; A[i + 2] -= ev.c.v[2]; }
    ev.L = L; ev.nP = ev.Lp.length / 3;
    ev.dec = decimateIdx(L, 20000);
    viewer.setEvidence({ points: ev.Lp.length ? ev.Lp : null, mesh: ev.Lm ? { pos: ev.Lm, idx: ev.rawMesh.idx } : null });
    viewer.setEvidenceVisible($('#ev-show').checked);
    viewer.setEvidenceGizmo(R.gizmo || null);
    applyAlign();
  }
  function applyAlign() {
    const ev = R.ev; if (!ev) return;
    ev.points = alignLocal(ev.L, ev.align, ev.dec.keep);    // fit set, ship coordinates
    ev.mesh = ev.Lm ? { idx: ev.rawMesh.idx } : null;
    R.has = supportIndex(ev.points, R.reach);
    viewer.setEvidenceTransform(ev.align);
    syncEV();
    ctx.schedule(true);
  }
  // Guess orientation and scale for a fresh import: up = the shallowest of Y and Z, the long
  // horizontal axis turned fore-and-aft, and units brought into proportion with the hull.
  function autoPlace(ev) {
    const parts = [ev.rawPts, ev.rawMesh && ev.rawMesh.pos].filter((a) => a && a.length);
    const n = parts.reduce((m, a) => m + a.length / 3, 0), step = Math.max(1, Math.floor(n / 40000));
    const raw = []; let k = 0;
    for (const a of parts) for (let i = 0; i < a.length; i += 3, k++) if (k % step === 0) raw.push(a[i], a[i + 1], a[i + 2]);
    const rb = boundsOf(raw), ext = [rb[3] - rb[0], rb[4] - rb[1], rb[5] - rb[2]];
    const up = ext[1] < ext[2] ? 'y' : 'z';
    const L = localize(raw, up);
    let mx = 0, mz = 0; const m = L.length / 3;
    for (let i = 0; i < L.length; i += 3) { mx += L[i]; mz += L[i + 2]; }
    mx /= m; mz /= m;
    let cxx = 0, czz = 0, cxz = 0;
    for (let i = 0; i < L.length; i += 3) { const x = L[i] - mx, z = L[i + 2] - mz; cxx += x * x; czz += z * z; cxz += x * z; }
    const th = 0.5 * Math.atan2(2 * cxz, cxx - czz);         // long axis, measured from X towards Z
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < L.length; i += 3) { const t = (L[i] - mx) * Math.cos(th) + (L[i + 2] - mz) * Math.sin(th); lo = Math.min(lo, t); hi = Math.max(hi, t); }
    const len = Math.max(1e-9, hi - lo), hullL = ctx.lines().bounds.L, r = len / hullL;
    let scale = 1, unit = '';
    if (r < 0.15 || r > 1.5) {
      const units = [[0.001, 'millimetres'], [0.01, 'centimetres'], [0.1, 'decimetres'], [10, ''], [100, ''], [1000, '']];
      const ok = units.filter(([f]) => r * f >= 0.15 && r * f <= 1.5).sort((a, b) => Math.abs(Math.log(r * a[0] / 0.6)) - Math.abs(Math.log(r * b[0] / 0.6)));
      if (ok.length) { scale = ok[0][0]; unit = ok[0][1] ? ` (looks like ${ok[0][1]})` : ''; }
      else scale = (0.7 * hullL) / len;
    }
    ev.align = { ...ev.align, up, scale, q: [0, Math.sin(th / 2), 0, Math.cos(th / 2)] };
    const turned = Math.round((th * 180) / Math.PI);
    return `Placed on the hull: ${up.toUpperCase()} up` + (turned ? `, turned ${Math.abs(turned)}° to lie fore-and-aft` : '') + (scale !== 1 ? `, scaled ×${+scale.toPrecision(3)}${unit}` : ', true scale') + '. Fine-tune with the gizmo.';
  }
  function setEvidence(rawPts, rawMesh, label, shipCoords = false) {
    const keep = R.ev && R.ev.align;
    R.ev = { rawPts: rawPts || (R.ev && R.ev.rawPts) || null, rawMesh: rawMesh || (R.ev && R.ev.rawMesh) || null, align: keep ? { ...keep, q: [0, 0, 0, 1] } : normAlign(null), label };
    $('#ev-align').open = true;
    const note = shipCoords ? null : autoPlace(R.ev);
    buildEvidence();
    if (note) ctx.toast(note);
    if (shipCoords) { const c = R.ev.c.v; Object.assign(R.ev.align, { dx: c[0], dy: c[2], dz: c[1] }); applyAlign(); }
    else centreOnHull();
  }
  const D = 180 / Math.PI;
  function syncEV() {
    const ev = R.ev;
    $('#ev-body').hidden = !ev;
    if (!ev) return;
    const a = ev.align;
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...a.q), 'YXZ');
    $('#ev-up').value = a.up; $('#ev-scale').value = +a.scale.toFixed(4);
    $('#ev-heel').value = (e.x * D).toFixed(1); $('#ev-yaw').value = (e.y * D).toFixed(1); $('#ev-trim').value = (e.z * D).toFixed(1);
    $('#ev-dx').value = a.dx.toFixed(2); $('#ev-dy').value = a.dy.toFixed(2); $('#ev-dz').value = a.dz.toFixed(2);
    $$('#ev-gizmo button').forEach((b) => b.classList.toggle('on', (b.dataset.g || null) === (R.gizmo || null) || (!R.gizmo && b.dataset.g === '')));
    readout();
  }
  function readout() {
    const ev = R.ev; if (!ev) return;
    const st = R.stats;
    const n = (ev.L ? ev.L.length : 0) / 3;
    const cls = !st ? '' : st.within > 0.9 ? 'g' : st.within > 0.6 ? 'a' : 'r';
    $('#ev-read').innerHTML = `<div>${esc(ev.label || 'Evidence')}: <b>${n.toLocaleString()}</b> ${ev.Lm ? 'vertices' : 'points'}${ev.mesh ? ` · ${(ev.mesh.idx.length / 3).toLocaleString()} tris` : ''}${ev.dropped ? ` · ${ev.dropped.toLocaleString()} loose vertices ignored` : ''}</div>` +
      (st ? `<div>Fit RMS <b>${(st.rms * 1000).toFixed(0)} mm</b> · max <b>${(st.max * 1000).toFixed(0)} mm</b></div><div>Within tolerance <b class="${cls}">${(st.within * 100).toFixed(0)}%</b> · hull recorded <b>${(R.supportFrac * 100).toFixed(0)}%</b></div>` : '<div>Measuring fit…</div>');
  }
  function centreOnHull() {
    const ev = R.ev; if (!ev || !ev.points.length) return;
    const b = ctx.lines().bounds, e = boundsOf(ev.points);
    ev.align.dx += b.xmid - (e[0] + e[3]) / 2;
    ev.align.dz += b.z0 - e[2];
    if (e[1] < 0 && e[4] > 0) ev.align.dy += -(e[1] + e[4]) / 2;   // both sides recorded: centre on the centreline
    else if (e[4] <= 0) ev.align.dy += -e[4];                      // port side only: inner edge to the centreline
    else ev.align.dy += -e[1];                                     // starboard side only
    applyAlign();
  }
  const readFile = (file, cb) => { const fr = new FileReader(); fr.onload = () => cb(fr.result); fr.readAsText(file); };

  $('#ev-pts').addEventListener('click', () => $('#ev-file-pts').click());
  $('#ev-obj').addEventListener('click', () => $('#ev-file-obj').click());
  $('#ev-file-pts').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    readFile(f, (t) => { const p = parsePoints(t); if (!p.length) { ctx.toast('No x, y, z points found in that file'); return; } setEvidence(p, null, f.name); });
  });
  $('#ev-file-obj').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    readFile(f, (t) => { const m = parseOBJ(t); if (!m.pos.length) { ctx.toast('No faces found in that OBJ'); return; } setEvidence(null, m, f.name); R.ev.dropped = m.dropped; readout(); if (m.dropped) setTimeout(() => ctx.toast(`${m.dropped.toLocaleString()} loose vertices (not part of any face) were ignored`), 2600); });
  });
  $('#ev-sample').addEventListener('click', () => {
    const w = sampleWreck();
    R.ev = null;
    setEvidence(w.points, w.mesh, 'Sample wreck: coastal trader, lower hull', true);
    if (!$('#ev-notes').value) { $('#ev-notes').value = 'Sample wreck. Lower hull survives amidships, keel to the turn of the bilge, recorded as points on both sides; three strakes survive on the starboard side. Ends, topsides and sheer are not preserved.'; R.notes = $('#ev-notes').value; }
    ctx.toast('Sample wreck loaded: try the Simple hull and fit it to the points');
  });
  $('#ev-clear').addEventListener('click', () => { R.ev = null; R.has = null; R.dev = null; R.stats = null; R.gizmo = null; viewer.setEvidence(null); viewer.setSupport(null); syncEV(); ctx.schedule(true); });
  $('#ev-up').addEventListener('change', (e) => { if (!R.ev) return; R.ev.align.up = e.target.value; buildEvidence(); centreOnHull(); });
  for (const [id, key] of [['#ev-scale', 'scale'], ['#ev-dx', 'dx'], ['#ev-dy', 'dy'], ['#ev-dz', 'dz']]) {
    $(id).addEventListener('change', (e) => { if (!R.ev) return; const v = parseFloat(e.target.value); if (!Number.isFinite(v) || (key === 'scale' && v <= 0)) return; R.ev.align[key] = v; applyAlign(); });
  }
  for (const id of ['#ev-heel', '#ev-yaw', '#ev-trim']) {
    $(id).addEventListener('change', () => {
      if (!R.ev) return;
      const v = (q) => (parseFloat($(q).value) || 0) / D;
      R.ev.align.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(v('#ev-heel'), v('#ev-yaw'), v('#ev-trim'), 'YXZ')).toArray();
      applyAlign();
    });
  }
  $('#ev-gizmo').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !R.ev) return;
    R.gizmo = b.dataset.g || null;
    if (R.gizmo && !$('#ev-show').checked) { $('#ev-show').checked = true; viewer.setEvidenceVisible(true); }
    viewer.setEvidenceGizmo(R.gizmo); syncEV();
  });
  $('#ev-level').addEventListener('click', () => { if (!R.ev) return; R.ev.align.q = [0, 0, 0, 1]; applyAlign(); });
  $('#ev-floor').addEventListener('click', () => {
    if (!R.ev || !R.ev.points.length) return;
    const e = boundsOf(R.ev.points), b = ctx.lines().bounds;
    R.ev.align.dz += b.z0 - e[2]; applyAlign();
  });
  viewer.hooks.onEvidenceMoved = (t) => { if (!R.ev) return; Object.assign(R.ev.align, t); applyAlign(); };
  $('#ev-centre').addEventListener('click', centreOnHull);
  $('#ev-tol').addEventListener('input', (e) => { R.tol = +e.target.value / 1000; $('#o-evtol').textContent = `${e.target.value} mm`; if (R.dev) { R.stats = fitStats(R.dev, R.tol); paint(); readout(); } });
  $('#ev-reach').addEventListener('input', (e) => { R.reach = +e.target.value; $('#o-evreach').textContent = `${R.reach.toFixed(2)} m`; if (R.ev) R.has = supportIndex(R.ev.points, R.reach); ctx.schedule(true); });
  $('#ev-show').addEventListener('change', (e) => viewer.setEvidenceVisible(e.target.checked));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && R.gizmo && !e.target.matches('input, textarea, select')) { R.gizmo = null; viewer.setEvidenceGizmo(null); syncEV(); } });
  $('#ev-notes').addEventListener('input', (e) => { R.notes = e.target.value; });
  $('#ev-report').addEventListener('click', () => {
    if (!R.ev || !R.dev) return;
    const p = R.ev.points, rows = ['x,y,z,distance_from_hull_m,within_tolerance'];
    for (let i = 0; i < R.dev.length; i++) rows.push(`${p[i * 3].toFixed(4)},${p[i * 3 + 1].toFixed(4)},${p[i * 3 + 2].toFixed(4)},${R.dev[i].toFixed(4)},${R.dev[i] <= R.tol ? 1 : 0}`);
    ctx.download('fit_report.csv', `# Shiplines fit report: ${state.cage.name}; tolerance ${(R.tol * 1000).toFixed(0)} mm\n` + rows.join('\n'), 'text/csv');
  });

  // ================================================================== hooks for main.js
  function afterLines(grid, lines) {
    if (!R.ev || !R.has || state.playing) { viewer.setSupport(null); return; }
    markSupport(lines, R.has);
    const s = surfaceSupport(grid, R.has);
    R.supportFrac = s.frac;
    viewer.setSupport(s.flags);
  }
  function afterHydro() {
    if (!R.ev || state.playing) return;
    const g = state.source === 'loft' || state.level >= 3 ? ctx.grid() : subdivide(gridFromCage(state.cage), 3);
    R.dev = deviations(g, R.ev.points);
    R.stats = fitStats(R.dev, R.tol);
    paint();
    readout();
  }
  // spread the fit-set distances back to every point and mesh vertex through the voxel map
  function paint() {
    const ev = R.ev; if (!ev || !R.dev) return;
    const map = ev.dec.map, nP = ev.nP, nM = ev.Lm ? ev.Lm.length / 3 : 0;
    const dp = new Float32Array(nP), dm = new Float32Array(nM);
    for (let i = 0; i < nP; i++) dp[i] = R.dev[map[i]];
    for (let i = 0; i < nM; i++) dm[i] = R.dev[map[nP + i]];
    viewer.colourEvidence(nP ? dp : null, R.tol, nM ? dm : null);
  }
  function sheetMeta() {
    if (!R.ev || state.playing) return null;
    return { points: R.ev.points, reach: R.reach, tol: R.tol, stats: R.stats, notes: R.notes };
  }
  function onRecentre() {
    viewer.setUnderlays(R.underlays, state.lineOpts.convention);
    if (R.ev) { viewer.setEvidenceTransform(R.ev.align); paint(); }
  }
  function onConvention(from, to) { convertUnderlays(from, to); refreshUL(); }
  function setPlaying(on) {
    if (on && R.moving) stopMove();
    viewer.hideUnderlays = on; viewer._underlayVis();
    viewer.setEvidenceVisible(on ? false : $('#ev-show').checked);
    if (on) { R.gizmo = null; viewer.setEvidenceGizmo(null); }
    if (on) viewer.setSupport(null);
  }
  const decimSet = (raw) => new Set(decimateIdx(raw, 20000).keep);
  function save() {
    const r4 = (a) => Array.from(a, (v) => Math.round(v * 1e4) / 1e4);
    return {
      underlays: R.underlays.map((u) => ({ view: u.view, name: u.name, dataURL: u.dataURL, base: u.base, adj: u.adj, opacity: u.opacity, invert: u.invert, visible: u.visible, calibrated: u.calibrated })),
      evidence: R.ev ? {
        label: R.ev.label, align: R.ev.align, c: R.ev.c,
        rawPts: R.ev.rawPts ? r4(R.ev.rawPts.length > 60000 ? R.ev.rawPts.filter((_, i) => decimSet(R.ev.rawPts).has(Math.floor(i / 3))) : R.ev.rawPts) : null,
        rawMesh: R.ev.rawMesh && R.ev.rawMesh.pos.length <= 300000 ? { pos: r4(R.ev.rawMesh.pos), idx: Array.from(R.ev.rawMesh.idx) } : null,
      } : null,
      tol: R.tol, reach: R.reach, notes: R.notes,
    };
  }
  function load(d) {
    R.underlays = []; refreshUL();
    R.ev = null; viewer.setEvidence(null);
    if (!d) { syncEV(); return; }
    R.tol = d.tol ?? R.tol; R.reach = d.reach ?? R.reach; R.notes = d.notes || '';
    $('#ev-tol').value = Math.round(R.tol * 1000); $('#o-evtol').textContent = `${Math.round(R.tol * 1000)} mm`;
    $('#ev-reach').value = R.reach; $('#o-evreach').textContent = `${R.reach.toFixed(2)} m`;
    $('#ev-notes').value = R.notes;
    for (const s of d.underlays || []) {
      const img = new Image();
      img.onload = () => { const u = makeUnderlay(s.view, img, s.dataURL, s.name); Object.assign(u, { base: s.base, adj: s.adj, opacity: s.opacity, invert: s.invert, visible: s.visible, calibrated: s.calibrated }); R.underlays.push(u); refreshUL(); };
      img.src = s.dataURL;
    }
    if (d.evidence) {
      const e = d.evidence;
      R.ev = { rawPts: e.rawPts ? new Float64Array(e.rawPts) : null, rawMesh: e.rawMesh ? { pos: new Float64Array(e.rawMesh.pos), idx: new Uint32Array(e.rawMesh.idx) } : null, align: normAlign(e.align), label: e.label, c: e.c || { up: normAlign(e.align).up, v: [0, 0, 0] } };
      buildEvidence();
    } else syncEV();
  }

  syncUL(); syncEV();
  return { afterLines, afterHydro, sheetMeta, onRecentre, onConvention, setPlaying, save, load };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
