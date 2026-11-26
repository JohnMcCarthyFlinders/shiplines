// "Trace lines" mode: draw battens over a scanned plan, loft a hull through them.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CURVES, emptyTrace, missing, batten, valueAt, traceFromLines } from './loft.js?v=13';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PINK = 0xff3d9a, PINK_HI = 0xffd1e6;
const VIEW_NAMES = { profile: 'Profile', plan: 'Plan', body: 'End' };

export function initTrace(ctx) {
  const { state, viewer } = ctx;
  if (!state.trace) state.trace = emptyTrace();
  state.source = state.source || 'cage';
  const S = { active: { kind: 'keel' }, drag: null, pickSection: false, nextId: 1 };
  const group = new THREE.Group(); group.renderOrder = 12;
  viewer.root.add(group);
  const mats = {};
  const lineMat = (key, color, w) => {
    if (!mats[key]) mats[key] = new LineMaterial({ color, linewidth: w, transparent: true, depthTest: false, toneMapped: false });
    mats[key].resolution.set(viewer.el.clientWidth, viewer.el.clientHeight);
    return mats[key];
  };

  // ------------------------------------------------------------------ geometry helpers
  const T = () => state.trace;
  const curveOf = (a) => (a.kind === 'section' ? T().sections.find((s) => s.id === a.id) : null);
  const ptsOf = (a) => (a.kind === 'section' ? (curveOf(a) || { pts: [] }).pts : T()[a.kind]);
  const viewOf = (a) => CURVES[a.kind].view;
  const sheerDense = () => (T().sheer.length >= 2 ? batten(T().sheer) : null);
  // 2-D curve point -> ship 3-D
  function to3(kind, q, sec) {
    if (kind === 'section') return { x: sec.x, y: q[0], z: q[1] };
    if (kind === 'deck') { const sd = sheerDense(); const z = sd ? valueAt(sd, 0, q[0], 1) : null; return { x: q[0], y: q[1], z: z ?? 0 }; }
    return { x: q[0], y: 0, z: q[1] };
  }
  // pointer -> curve 2-D coordinates
  function from3(kind, p) {
    const [a, b] = CURVES[kind].ax;
    return [p[a], p[b]];
  }

  // ------------------------------------------------------------------ drawing
  function render() {
    for (const c of [...group.children]) { group.remove(c); c.geometry?.dispose(); if (c.element) c.element.remove(); }
    if (!S.on) return;
    const view = viewer.view || 'persp';
    const showAll = view === 'persp';
    const add = (kind, pts, sec) => {
      const isActive = S.active.kind === kind && (kind !== 'section' || S.active.id === sec.id);
      const cv = CURVES[kind].view;
      if (!showAll && cv !== view) return;
      if (!pts.length) return;
      const P = pts.map((q) => to3(kind, q, sec));
      if (P.length >= 2) {
        const d = batten(pts).map((q) => to3(kind, q, sec)), pos = [];
        for (const mir of kind === 'section' || kind === 'deck' ? [1] : [1])
          for (let i = 1; i < d.length; i++) { const a = viewer.shipToThree(d[i - 1].x, mir * d[i - 1].y, d[i - 1].z), b = viewer.shipToThree(d[i].x, mir * d[i].y, d[i].z); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); }
        const g = new LineSegmentsGeometry(); g.setPositions(pos);
        const m = isActive ? lineMat('act', PINK_HI, 3.2) : lineMat('cur', PINK, 2);
        const o = new LineSegments2(g, m); o.renderOrder = 13; group.add(o);
      }
      if (isActive || !showAll) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P.flatMap((p) => { const v = viewer.shipToThree(p.x, p.y, p.z); return [v.x, v.y, v.z]; }), 3));
        const o = new THREE.Points(g, new THREE.PointsMaterial({ color: isActive ? 0xffffff : PINK, size: isActive ? 9 : 6, sizeAttenuation: false, depthTest: false, transparent: true, toneMapped: false }));
        o.renderOrder = 14; group.add(o);
      }
    };
    for (const k of ['keel', 'stem', 'stern', 'sheer', 'deck']) add(k, T()[k]);
    for (const sec of T().sections) add('section', sec.pts, sec);
    // section positions as station marks in the profile and plan views
    if (view === 'profile' || view === 'plan' || showAll) {
      const sd = sheerDense();
      const top = sd ? Math.max(...sd.map((q) => q[1])) : 5;
      const pos = [];
      for (const sec of T().sections) {
        const act = S.active.kind === 'section' && S.active.id === sec.id;
        const a = view === 'plan' ? viewer.shipToThree(sec.x, -0.02 * top, 0) : viewer.shipToThree(sec.x, 0, -0.05 * top);
        const b = view === 'plan' ? viewer.shipToThree(sec.x, top * 0.9, 0) : viewer.shipToThree(sec.x, 0, top * 1.08);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        const d = document.createElement('div'); d.className = 'lab3d trace-lab' + (act ? ' act' : ''); d.textContent = sec.name;
        const l = new CSS2DObject(d); l.position.copy(b); group.add(l);
      }
      if (pos.length && !showAll) { const g = new LineSegmentsGeometry(); g.setPositions(pos); const o = new LineSegments2(g, lineMat('mark', PINK, 1)); mats.mark.opacity = 0.45; o.renderOrder = 12; group.add(o); }
    }
  }

  // ------------------------------------------------------------------ panel
  function status() {
    const m = missing(T());
    $('#tr-need').innerHTML = m.length ? `Still needed: ${m.map(esc).join(', ')}.` : `✓ Hull lofted from ${T().sections.filter((s) => s.pts.length >= 3).length} sections. The <b class="gold">gold</b> lines are cut from it: compare them with the drawing.`;
    $('#tr-need').classList.toggle('ok', !m.length);
  }
  function list() {
    const btn = (kind, label, n, extra = '') => {
      const on = S.active.kind === kind && !extra;
      return `<button class="tr-c${on ? ' on' : ''}" data-k="${kind}"><span>${label}</span><i>${n ? `${n} pt${n > 1 ? 's' : ''}` : '—'}</i></button>`;
    };
    $('#tr-prof').innerHTML = ['keel', 'stem', 'stern', 'sheer'].map((k) => btn(k, CURVES[k].label, T()[k].length)).join('');
    $('#tr-plan').innerHTML = btn('deck', 'Deck line <small>(optional)</small>', T().deck.length);
    $('#tr-secs').innerHTML = T().sections.slice().sort((a, b) => a.x - b.x).map((s) => {
      const on = S.active.kind === 'section' && S.active.id === s.id;
      return `<div class="tr-sec${on ? ' on' : ''}" data-id="${s.id}"><button class="tr-c" data-k="section" data-id="${s.id}"><span>${esc(s.name)}</span><i>${s.pts.length ? s.pts.length + ' pts' : '—'}</i></button>
        <label>x <input type="number" step="0.01" value="${s.x.toFixed(2)}" data-x="${s.id}"></label><button class="tr-del" data-del="${s.id}" title="Delete section">✕</button></div>`;
    }).join('') || '<p class="hint">No sections yet.</p>';
    const a = S.active;
    $('#tr-hint').innerHTML = S.pickSection
      ? 'Profile view: <b>click on the drawing at the station</b> where the new section lies (a vertical station line). <button id="tr-pick-x">Cancel</button>'
      : `${a.kind === 'section' ? `<b>${esc((curveOf(a) || {}).name || '')}</b> · ` : ''}${CURVES[a.kind].hint} <span class="keys">Click to add · drag a point to move · click on the batten to insert · Shift+click a point to delete · right-drag pans, scroll zooms</span>`;
    const px = $('#tr-pick-x'); if (px) px.onclick = () => { S.pickSection = false; list(); };
    status();
  }
  function activate(a) {
    S.active = a; S.pickSection = false;
    const v = viewOf(a);
    if (viewer.view !== v) ctx.setCam(v);
    list(); render();
  }
  function changed() { ctx.schedule(true); list(); render(); }

  $('#trace-panel').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      ctx.pushUndo();
      const id = +del.dataset.del;
      T().sections = T().sections.filter((s) => s.id !== id);
      if (S.active.kind === 'section' && S.active.id === id) S.active = { kind: 'keel' };
      changed(); return;
    }
    const b = e.target.closest('.tr-c');
    if (b) activate(b.dataset.k === 'section' ? { kind: 'section', id: +b.dataset.id } : { kind: b.dataset.k });
  });
  $('#trace-panel').addEventListener('change', (e) => {
    const id = e.target.dataset.x; if (!id) return;
    const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return;
    ctx.pushUndo(); const s = T().sections.find((q) => q.id === +id); if (s) s.x = v; changed();
  });
  $('#tr-add').addEventListener('click', () => {
    S.pickSection = true; ctx.setCam('profile'); list(); render();
  });
  $('#tr-clear').addEventListener('click', () => {
    const p = ptsOf(S.active); if (!p || !p.length) return;
    ctx.pushUndo(); p.length = 0; changed();
  });
  $('#tr-example').addEventListener('click', () => {
    ctx.pushUndo();
    state.trace = traceFromLines(ctx.cageLines());
    S.nextId = state.trace.sections.length + 1;
    S.active = { kind: 'section', id: state.trace.sections[Math.floor(state.trace.sections.length / 2)]?.id };
    changed();
    ctx.toast('Example battens taken from the current preset hull: edit them, or clear and trace your own');
  });
  $('#tr-reset').addEventListener('click', () => {
    if (!confirm('Clear all traced lines?')) return;
    ctx.pushUndo(); state.trace = emptyTrace(); S.active = { kind: 'keel' }; changed();
  });

  // ------------------------------------------------------------------ pointer editing
  function screenPts(a) {
    const sec = curveOf(a);
    return ptsOf(a).map((q) => { const p = to3(a.kind, q, sec); return viewer.toScreen(p.x, p.y, p.z); });
  }
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const hook = {
    down(e) {
      if (e.button !== 0 || viewer.clickCapture) return false;
      // choosing where a new section lies
      if (S.pickSection) {
        if (viewer.view !== 'profile' && viewer.view !== 'plan') return false;
        const p = viewer.pointerShip(e); if (!p) return false;
        ctx.pushUndo();
        const n = T().sections.length + 1, id = S.nextId++;
        T().sections.push({ id, name: `S${n}`, x: p.x, pts: [] });
        S.pickSection = false;
        activate({ kind: 'section', id });
        ctx.toast(`Section ${n} at x = ${p.x.toFixed(2)} m: now trace it in the End view`);
        changed();
        return true;
      }
      const a = S.active, v = viewOf(a);
      if (viewer.view !== v) return false;
      if (a.kind === 'section' && !curveOf(a)) return false;
      const pts = ptsOf(a), sp = screenPts(a), m = [e.clientX, e.clientY];
      const p3 = viewer.pointerShip(e); if (!p3) return false;
      const q = from3(a.kind, p3);
      // on a point: drag it (or Shift-delete)
      let hit = -1, hd = 10;
      sp.forEach((s, i) => { const d = Math.hypot(s[0] - m[0], s[1] - m[1]); if (d < hd) { hd = d; hit = i; } });
      ctx.pushUndo();
      if (hit >= 0) {
        if (e.shiftKey) { pts.splice(hit, 1); changed(); return true; }
        S.drag = hit; return true;
      }
      // on the batten: insert between neighbours
      let ins = -1, id = 9;
      for (let i = 1; i < sp.length; i++) { const d = segDist(m, sp[i - 1], sp[i]); if (d < id) { id = d; ins = i; } }
      if (ins >= 0) { pts.splice(ins, 0, q); S.drag = ins; changed(); return true; }
      // otherwise extend from the nearer end
      if (pts.length >= 2 && Math.hypot(sp[0][0] - m[0], sp[0][1] - m[1]) < Math.hypot(sp[sp.length - 1][0] - m[0], sp[sp.length - 1][1] - m[1])) { pts.unshift(q); S.drag = 0; }
      else { pts.push(q); S.drag = pts.length - 1; }
      changed();
      return true;
    },
    move(e, hooked) {
      if (!hooked || S.drag == null) return;
      const p3 = viewer.pointerShip(e); if (!p3) return;
      ptsOf(S.active)[S.drag] = from3(S.active.kind, p3);
      ctx.schedule(false); render();
    },
    up() { if (S.drag != null) { S.drag = null; changed(); } },
  };

  // ------------------------------------------------------------------ mode
  function enter() {
    S.on = true;
    state.source = 'loft';
    document.body.classList.add('tracing');
    $('#tr-start').hidden = true; $('#tr-body').hidden = false;
    viewer.setToggles({ showCage: false });
    viewer.editLocked = true;
    viewer.setPointerHook(hook, { keepOrbit: true, cursor: 'crosshair' });
    const first = ['keel', 'stem', 'stern', 'sheer'].find((k) => T()[k].length < 2);
    activate(first ? { kind: first } : S.active);
    ctx.schedule(true);
  }
  function exit() {
    S.on = false; S.pickSection = false;
    state.source = 'cage';
    document.body.classList.remove('tracing');
    $('#tr-start').hidden = false; $('#tr-body').hidden = true;
    viewer.setPointerHook(null);
    viewer.editLocked = false;
    viewer.setToggles({ showCage: $('#t-cage').checked });
    render();
    ctx.schedule(true);
  }
  $('#tr-start').addEventListener('click', enter);
  $('#tr-exit').addEventListener('click', exit);
  window.addEventListener('keydown', (e) => {
    if (!S.on || e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape' && S.pickSection) { S.pickSection = false; list(); }
  });

  S.nextId = Math.max(0, ...T().sections.map((s) => s.id)) + 1;
  return {
    get on() { return !!S.on; },
    render, list: () => { if (S.on) list(); },
    enter, exit,
    reinstall() { if (S.on) viewer.setPointerHook(hook, { keepOrbit: true, cursor: 'crosshair' }); },
    viewChanged() { if (S.on) { render(); } },
    loaded() { S.nextId = Math.max(0, ...T().sections.map((s) => s.id)) + 1; if (S.on || state.source === 'loft') { if (!S.on) enter(); else { list(); render(); } } },
  };
}
