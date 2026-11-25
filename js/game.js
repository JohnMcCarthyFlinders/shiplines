// Play mode: four scored rounds that test understanding of a lines plan,
// ending with a certificate drawn on the student's own lines plan.
//
//   1  Know your lines   (20)  identify a highlighted line and the plan that shows its true shape
//   2  Steffy's labels   (15)  name a highlighted section using Steffy's A, B, C / 1, 2, 3 convention
//   3  Shape to spec     (30)  reshape a hull to a target block coefficient and beam
//   4  Fair the hull     (35)  remove bumps from a damaged hull (zebra stripes + fairness meter)

import { makePreset, cloneCage, isLocked } from './presets.js?v=4';

const ROUNDS = [
  { key: 'lines', title: 'Know your lines', max: 20 },
  { key: 'labels', title: 'Steffy’s labels', max: 15 },
  { key: 'shape', title: 'Shape to spec', max: 30 },
  { key: 'fair', title: 'Fair the hull', max: 35 },
];

export const GRADES = [
  [85, 'High Distinction'], [75, 'Distinction'], [65, 'Credit'], [50, 'Pass'], [0, 'Keep practising'],
];
export const gradeFor = (s) => GRADES.find(([min]) => s >= min)[1];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LINE_INFO = {
  station: { name: 'Station (section)', plan: 'Body plan', why: 'A station is a vertical, transverse slice across the hull. Its true shape is the curve in the <b>body plan</b>; in the sheer and half-breadth plans it is a straight line.' },
  waterline: { name: 'Waterline', plan: 'Half-breadth plan', why: 'A waterline is a horizontal slice parallel to the baseline. Its true shape is the curve in the <b>half-breadth plan</b>; in the sheer and body plans it is a straight line.' },
  buttock: { name: 'Buttock line', plan: 'Sheer plan', why: 'A buttock is a vertical fore-and-aft slice parallel to the centreline. Its true shape is the curve in the <b>sheer plan</b>; in the body and half-breadth plans it is a straight line.' },
  diagonal: { name: 'Diagonal', plan: 'Half-breadth plan', why: 'A diagonal is an inclined fore-and-aft plane cutting through the bilge. It is a straight line in the body plan, and its true (developed) shape is plotted in the <b>half-breadth plan</b>, opposite the waterlines.' },
};
const TYPES = Object.keys(LINE_INFO);
const PLANS = ['Body plan', 'Half-breadth plan', 'Sheer plan'];

// Fairness energy of the control cage: sum of squared second differences
// along and around the hull. Bumps raise it; fairing lowers it again.
export function cageEnergy(c) {
  let E = 0;
  const P = c.pts;
  const d2 = (a, b, q) => (a.x - 2 * b.x + q.x) ** 2 + (a.y - 2 * b.y + q.y) ** 2 + (a.z - 2 * b.z + q.z) ** 2;
  for (let i = 1; i < c.ni - 1; i++) for (let j = 0; j < c.nj; j++) E += d2(P[i - 1][j], P[i][j], P[i + 1][j]);
  for (let i = 0; i < c.ni; i++) for (let j = 1; j < c.nj - 1; j++) E += d2(P[i][j - 1], P[i][j], P[i][j + 1]);
  return E;
}

export function initGame(api) {
  const $ = (s) => document.querySelector(s);
  const panel = $('#game');
  let run = null; // active game state

  // ---------------------------------------------------------------- panel helpers
  function render(html) { panel.innerHTML = html; panel.hidden = false; }
  function header(r, q) {
    const rd = ROUNDS[r];
    const total = run.scores.reduce((a, b) => a + b, 0);
    return `<div class="g-head"><span>ROUND ${r + 1}/4 · ${rd.title.toUpperCase()}</span><b>${Math.round(total)}<small>/100</small></b><button class="g-quit" title="Quit the game">✕</button></div>
      <div class="g-prog">${ROUNDS.map((x, i) => `<i class="${i < r ? 'done' : i === r ? 'now' : ''}"></i>`).join('')}</div>
      ${q ? `<div class="g-q">${q}</div>` : ''}`;
  }
  function ask(r, qLabel, question, options, correct, why) {
    return new Promise((resolve) => {
      render(`${header(r, qLabel)}<p class="g-text">${question}</p>
        <div class="g-opts">${options.map((o, i) => `<button data-i="${i}">${esc(o)}</button>`).join('')}</div>
        <div class="g-fb" hidden></div>`);
      panel.querySelectorAll('.g-opts button').forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.i, ok = i === correct;
        panel.querySelectorAll('.g-opts button').forEach((x) => { x.disabled = true; if (+x.dataset.i === correct) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        const fb = panel.querySelector('.g-fb');
        fb.hidden = false;
        fb.innerHTML = `<p><b class="${ok ? 'ok' : 'no'}">${ok ? '✓ Correct' : '✗ Not quite'}</b> ${why}</p><button class="g-next">Next ▸</button>`;
        fb.querySelector('.g-next').addEventListener('click', () => resolve(ok));
      }, { once: true }));
    });
  }

  // ---------------------------------------------------------------- set-up per round
  function quizView(preset, view) {
    api.loadPreset(preset, { silent: true });
    api.viewer.labelMode = 'ends';
    api.viewer.dimmed = true;
    api.viewer.editLocked = true;
    api.viewer.select(null);
    api.viewer.setToggles({ showCage: false, showLabels: true });
    api.setCam(view);
    api.refresh();
    document.body.classList.add('play-quiz');
    document.body.classList.remove('play-edit');
  }
  function editView(preset, surface = 'holo') {
    api.loadPreset(preset, { silent: true });
    api.viewer.labelMode = 'all';
    api.viewer.dimmed = false;
    api.viewer.editLocked = false;
    api.viewer.setHighlight(null);
    api.viewer.setToggles({ showCage: true, showLabels: true });
    api.setSurface(surface);
    api.setCam('persp');
    api.refresh();
    api.clearUndo();
    document.body.classList.add('play-edit');
    document.body.classList.remove('play-quiz');
  }

  // ---------------------------------------------------------------- round 1
  async function roundLines() {
    const preset = pick(['cargo', 'clipper', 'warship', 'canoe']);
    quizView(preset, 'persp');
    let score = 0;
    const order = shuffle(TYPES).concat([pick(TYPES)]);
    for (let q = 0; q < order.length; q++) {
      const type = order[q], L = api.lines();
      const set = { station: L.stations, waterline: L.waterlines, buttock: L.buttocks, diagonal: L.diagonals }[type];
      const line = pick(set);
      api.viewer.setHighlight(line.polylines);
      const info = LINE_INFO[type];
      const typeNames = TYPES.map((t) => LINE_INFO[t].name);
      const ok1 = await ask(0, `Question ${q + 1} of 5 · part A`, 'What kind of line is <b class="hl">flashing white</b> on the hull?', typeNames, TYPES.indexOf(type), info.why);
      const ok2 = await ask(0, `Question ${q + 1} of 5 · part B`, `In which plan of the lines drawing does this ${info.name.toLowerCase()} appear as a curve showing its true shape?`, PLANS, PLANS.indexOf(info.plan), info.why);
      score += (ok1 ? 2 : 0) + (ok2 ? 2 : 0);
      run.scores[0] = score;
    }
    api.viewer.setHighlight(null);
    return score;
  }

  // ---------------------------------------------------------------- round 2
  async function roundLabels() {
    quizView(pick(['clipper', 'warship', 'cargo']), 'profile');
    let score = 0;
    const L = api.lines();
    const all = L.stations.map((s) => s.label);
    const chosen = shuffle(L.stations).slice(0, 5);
    for (let q = 0; q < chosen.length; q++) {
      const st = chosen[q];
      api.viewer.setHighlight(st.polylines);
      const opts = shuffle([st.label, ...shuffle(all.filter((l) => l !== st.label)).slice(0, 3)]);
      const nice = (l) => (l === '⦶' ? '⦶  midship section' : l);
      const mid = L.stations.find((s) => s.isMid);
      const n = Math.abs(st.k - mid.k);
      const why = st.isMid
        ? 'This is the midship section, marked with the amidships symbol ⦶. Every other section is counted from it.'
        : st.fwd
          ? `It is the ${ordinal(n)} section <b>forward</b> of midships. Steffy letters forward sections A, B, C … counting towards the bow, so it is <b>${st.label}</b>.`
          : `It is the ${ordinal(n)} section <b>aft</b> of midships. Steffy numbers after sections 1, 2, 3 … counting towards the stern, so it is <b>${st.label}</b>.`;
      const ok = await ask(1, `Question ${q + 1} of 5`, 'Following <b>Steffy’s convention</b> (bow to the left), what is the label of the <b class="hl">flashing section</b>?', opts.map(nice), opts.indexOf(st.label), why);
      if (ok) score += 3;
      run.scores[1] = score;
    }
    api.viewer.setHighlight(null);
    return score;
  }
  const ordinal = (n) => ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'][n] || `${n}th`;

  // ---------------------------------------------------------------- round 3
  function roundShape() {
    return new Promise((resolve) => {
      editView('simple', 'holo');
      api.whenHydro((h0, L0) => {
        const fuller = Math.random() < 0.5;
        const tCb = +(fuller ? h0.Cb + rnd(0.07, 0.12) : h0.Cb - rnd(0.07, 0.1)).toFixed(3);
        const beam0 = 2 * L0.bounds.B2;
        const tB = +(beam0 * (Math.random() < 0.5 ? rnd(0.82, 0.88) : rnd(1.12, 1.2))).toFixed(2);
        const scoreOf = (h, L) => {
          const dCb = Math.abs(h.Cb - tCb), rB = Math.abs((2 * L.bounds.B2) / tB - 1);
          const sCb = 18 * clamp01(1 - (dCb - 0.015) / 0.085);
          const sB = 12 * clamp01(1 - (rB - 0.03) / 0.17);
          return { sCb, sB, total: sCb + sB, dCb, rB };
        };
        const draw = () => {
          const h = api.hydro(), L = api.lines(); if (!h) return;
          const sc = scoreOf(h, L), beam = 2 * L.bounds.B2;
          render(`${header(2)}
            <p class="g-text">Reshape the practice hull to meet the owner’s specification. Use <b>Point</b>, <b>Section</b> and <b>Fore–aft row</b> editing; watch the hull data.</p>
            <div class="g-spec">
              <div><span>Block coefficient C<sub>b</sub></span><b>${h.Cb.toFixed(3)}</b><em>target ${tCb.toFixed(3)} ± 0.015</em>${meter(1 - sc.dCb / 0.1)}</div>
              <div><span>Beam (moulded)</span><b>${beam.toFixed(2)} m</b><em>target ${tB.toFixed(2)} m ± 3%</em>${meter(1 - sc.rB / 0.2)}</div>
            </div>
            <p class="g-tip">${fuller ? 'C<sub>b</sub> = ∇ / (L·B·T). To <b>raise</b> it, fill out the ends and harden the bilge: push section handles outwards near bow and stern, and flatten the floors.' : 'C<sub>b</sub> = ∇ / (L·B·T). To <b>lower</b> it, fine the ends and add deadrise: pull handles near bow and stern inwards and lift the floors into a V.'}</p>
            <div class="g-foot"><span>Projected: <b>${Math.round(sc.total)}</b> / 30</span><button class="g-go" id="g-submit">Submit design ▸</button></div>`);
          panel.querySelector('#g-submit').addEventListener('click', () => {
            api.onUpdate = null;
            run.design = cloneCage(api.state.cage);
            run.design.name = run.vessel;
            run.design.type = 'Student design (Shiplines Challenge)';
            const f = scoreOf(api.hydro(), api.lines());
            run.scores[2] = f.total;
            resolve(f.total);
          });
        };
        api.onUpdate = draw;
        draw();
      });
    });
  }

  // ---------------------------------------------------------------- round 4
  function roundFair() {
    return new Promise((resolve) => {
      const preset = pick(['clipper', 'warship', 'canoe', 'simple']);
      editView(preset, 'zebra');
      const ref = cloneCage(api.state.cage);
      const Eref = cageEnergy(ref);
      api.whenHydro((h0, L0) => {
        const ref0 = { L: L0.bounds.L, B: 2 * L0.bounds.B2, D: L0.bounds.Hmid, V: h0.V };
        // damage three interior handles
        const c = api.state.cage;
        const cand = [];
        for (let i = 2; i < c.ni - 2; i++) for (let j = 2; j < c.nj - 1; j++) if (!isLocked(c, i, j)) cand.push([i, j]);
        const bumped = shuffle(cand).slice(0, 3);
        for (const [i, j] of bumped) {
          const p = c.pts[i][j];
          p.y = Math.max(0.02, p.y + (Math.random() < 0.5 ? -1 : 1) * rnd(0.14, 0.22) * (ref0.B / 2));
          p.z += (Math.random() < 0.5 ? -1 : 1) * rnd(0.05, 0.09) * ref0.D;
        }
        const Eb = cageEnergy(c);
        api.refresh(true);
        api.clearUndo();
        const scoreOf = () => {
          const h = api.hydro(), L = api.lines();
          const E = cageEnergy(api.state.cage);
          const r = clamp01((Eb - E) / Math.max(1e-9, Eb - Eref));
          const dev = Math.max(Math.abs(L.bounds.L / ref0.L - 1), Math.abs((2 * L.bounds.B2) / ref0.B - 1), Math.abs(L.bounds.Hmid / ref0.D - 1));
          const dv = h ? Math.abs(h.V / ref0.V - 1) : 0;
          const keep = dev <= 0.08 && dv <= 0.15;
          return { r, keep, total: 35 * r * (keep ? 1 : 0.5) };
        };
        const draw = () => {
          const sc = scoreOf();
          render(`${header(3)}
            <p class="g-text">Someone has knocked this hull out of fair: <b>three handles</b> are out of place. Find them and drag them back until the zebra stripes and every line run sweetly.</p>
            <div class="g-spec">
              <div><span>Fairness</span><b>${Math.round(sc.r * 100)}%</b><em>${sc.r > 0.95 ? 'beautifully fair' : sc.r > 0.7 ? 'nearly there' : 'lumpy'}</em>${meter(sc.r)}</div>
              ${sc.keep ? '' : '<div class="warn">⚠ Keep the hull’s length, beam, depth and displacement close to the original (score halved).</div>'}
            </div>
            <p class="g-tip">Look for kinks in the stripes and wiggles in the waterlines and sections. A fair hull has smoothly changing curvature: each handle should sit in line with its neighbours, fore-and-aft and around the section.</p>
            <div class="g-foot"><span>Projected: <b>${Math.round(sc.total)}</b> / 35</span><button class="g-go" id="g-submit">Submit ▸</button></div>`);
          panel.querySelector('#g-submit').addEventListener('click', () => { api.onUpdate = null; const f = scoreOf(); run.scores[3] = f.total; resolve(f.total); });
        };
        api.onUpdate = draw;
        draw();
      });
    });
  }

  const meter = (v) => `<div class="bar"><i style="width:${Math.round(clamp01(v) * 100)}%"></i></div>`;

  // ---------------------------------------------------------------- flow
  function intro() {
    const m = $('#play-intro');
    m.hidden = false;
    $('#play-student').value = api.drawnBy() || $('#play-student').value;
    $('#play-student').focus();
  }
  async function start() {
    const student = $('#play-student').value.trim();
    if (!student) { $('#play-student').focus(); $('#play-student').classList.add('need'); return; }
    $('#play-intro').hidden = true;
    run = { student, vessel: $('#play-vessel').value.trim() || 'My hull', scores: [0, 0, 0, 0], saved: api.saveState() };
    document.body.classList.add('playing');
    api.setLock(true);
    try {
      await roundLines();
      await roundLabels();
      await roundShape();
      await roundFair();
      finish();
    } catch (e) { console.error(e); exit(); }
  }
  function finish() {
    const total = Math.round(run.scores.reduce((a, b) => a + b, 0));
    const grade = gradeFor(total);
    const parts = run.scores.map((s, i) => `${ROUNDS[i].title} ${Math.round(s)}/${ROUNDS[i].max}`);
    run.result = { student: run.student, score: total, grade, breakdown: parts.join('   ·   '), date: api.dateString() };
    panel.hidden = true;
    const m = $('#play-results');
    m.querySelector('.r-score').innerHTML = `${total}<small>/100</small>`;
    m.querySelector('.r-grade').textContent = grade;
    m.querySelector('.r-name').textContent = run.student;
    m.querySelector('.r-rows').innerHTML = run.scores.map((s, i) => `<div><span>${i + 1} · ${ROUNDS[i].title}</span><b>${Math.round(s)} / ${ROUNDS[i].max}</b><div class="bar"><i style="width:${(s / ROUNDS[i].max) * 100}%"></i></div></div>`).join('');
    m.hidden = false;
    try { const best = +localStorage.getItem('shiplines.best') || 0; if (total > best) localStorage.setItem('shiplines.best', total); } catch { /* storage unavailable */ }
  }
  function exit(withCertificate = false) {
    $('#play-results').hidden = true;
    panel.hidden = true;
    document.body.classList.remove('playing', 'play-quiz', 'play-edit');
    api.onUpdate = null;
    api.viewer.labelMode = 'all'; api.viewer.dimmed = false; api.viewer.editLocked = false;
    api.viewer.setHighlight(null);
    api.setLock(false);
    if (withCertificate && run?.result) {
      api.loadCage(run.design, { name: run.vessel, drawnBy: run.student });
      api.setCertificate(run.result);
      api.setView('2d');
    } else if (run?.saved) api.restoreState(run.saved);
    run = null;
  }

  $('#btn-play').addEventListener('click', intro);
  $('#btn-play-cta').addEventListener('click', intro);
  $('#play-start').addEventListener('click', start);
  $('#play-cancel').addEventListener('click', () => ($('#play-intro').hidden = true));
  $('#play-student').addEventListener('input', (e) => e.target.classList.remove('need'));
  $('#play-cert').addEventListener('click', () => exit(true));
  $('#play-again').addEventListener('click', () => { const s = run.student, v = run.vessel; exit(false); $('#play-student').value = s; $('#play-vessel').value = v; intro(); });
  $('#play-exit').addEventListener('click', () => exit(false));
  panel.addEventListener('click', (e) => { if (e.target.closest('.g-quit') && run) exit(false); });

  return { get active() { return !!run; } };
}
