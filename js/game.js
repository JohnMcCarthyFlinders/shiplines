// Play mode: four scored rounds that test understanding of a lines plan,
// introduced by Mouldy Lofterson of the Mount Lofty Mould Loft, ending with a certificate drawn on the
// student's own lines plan.
//
//   1  Know your lines        (20)  identify a highlighted line and the plan that shows its true shape
//   2  Steffy's labels        (15)  name a highlighted section using Steffy's A, B, C / 1, 2, 3 convention
//   3  Match the section      (30)  move four handles until the midship section matches a target
//   4  Fair the hull          (35)  find the three bumped handles among four and fair the hull

import { cloneCage, isLocked, makePreset, PRESETS } from './presets.js?v=20';
import { gridFromCage, subdivide } from './subdiv.js?v=20';
import { computeLines, hydrostatics } from './lines.js?v=20';
import { renderDrawing } from './drawing2d.js?v=20';

const ROUNDS = [
  { key: 'lines', title: 'Know your lines', max: 20 },
  { key: 'labels', title: 'Steffy’s labels', max: 15 },
  { key: 'shape', title: 'Match the section', max: 30 },
  { key: 'fair', title: 'Fair the hull', max: 35 },
];

export const GRADES = [
  [85, 'High Distinction'], [75, 'Distinction'], [65, 'Credit'], [50, 'Pass'], [0, 'Keep practising'],
];
export const gradeFor = (s) => GRADES.find(([min]) => s >= min)[1];

// ---------------------------------------------------------------- Mouldy Lofterson, the old shipwright
export const SHIPWRIGHT = {
  name: 'Old Mouldy Lofterson, who lives and works in the Mount Lofty Mould Loft on Kaurna Country',
  // the fuller introduction, shown on the opening screen and the start of the phone tour
  about: 'Old Mouldy Lofterson, who lives and works in the Mount Lofty Mould Loft on Kaurna Country. A mould loft is a large, open floor or building where shipbuilders and aircraft makers draw design lines at full size to make moulds, patterns and templates for structural parts. Lofterson designed his famous ship <i>The Pie Floater</i> here, a stable vessel although it was not very streamlined.',
  welcome: 'Well, hello there. I’m Mouldy Lofterson, and I live up in the Mount Lofty Mould Loft. Are you here to test yourself against the old trade, or would you rather have a look around the loft first?',
  rounds: [
    'Come in, come in. You’ll be the new hand, so. Before you go near a batten I want to see do you know your lines. I’ll put a light on one of them, and you tell me what it is and which plan shows its true shape. There’s a drawing beside you there if you need it.',
    'Fair play to you. Now, Steffy had a tidy way of naming sections, and I’ll hold you to it: letters forward of the midship section, A, B, C, and numbers aft of it, 1, 2, 3. The bow is to the left, mind. Tell me the name of the section I’m showing you.',
    'Right so. The owner is after changing his mind about the midship section; they always do. Bring the flashing white curve onto his dashed gold one. And don’t be expecting the handles to sit on the curve: the hull lies inside the cage, so it does.',
    'Ah, would you look at that. Someone’s after leaning timber against the frames and knocked two of them out of fair. Find the two handles and put them back in line with their neighbours. Watch the zebra stripes: where they kink, the hull is lumpy. The End view is handy for shifting them across the section, and the arrow keys for the fine work.',
  ],
  verdict: {
    'High Distinction': 'Well now. That’s a master’s hand, and I don’t say that lightly. You’d have a place in any loft I ever worked in.',
    Distinction: 'That’s grand work altogether. A small bit more practice with the battens and you’ll be teaching me.',
    Credit: 'Solid enough, so it is. You know your way around a lines plan. Keep at it.',
    Pass: 'You got there in the end. Come back and have another go; sure that’s how we all learned.',
    'Keep practising': 'Don’t be worrying. There was never a shipwright who didn’t spoil a few lines before he drew a fair one. Have another go.',
  },
};

// Portrait by John McCarthy: bald, with a solid, tidy ginger beard.
export const SHIPWRIGHT_SVG = '<img class="wright" src="assets/lofterson-face.jpg" alt="Mouldy Lofterson" width="256" height="256">';

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

// resample the longest polyline of a section (y, z) at equal arc length, keel end first
function sectionSamples(polys, n = 48) {
  const l = polys.reduce((m, p) => (p.length > (m ? m.length : 0) ? p : m), null);
  if (!l) return null;
  let pts = l.map((q) => [q[1], q[2]]);
  if (pts[0][1] > pts[pts.length - 1][1]) pts = pts.reverse();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * cum[cum.length - 1];
    let i = 1; while (i < cum.length - 1 && cum[i] < t) i++;
    const f = (t - cum[i - 1]) / Math.max(1e-12, cum[i] - cum[i - 1]);
    out.push([pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])]);
  }
  return out;
}

export function initGame(api) {
  const $ = (s) => document.querySelector(s);
  const panel = $('#game');
  const ref = $('#game-ref');
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
  function ask(r, qLabel, question, options, correct, why, onAnswer) {
    return new Promise((resolve) => {
      render(`${header(r, qLabel)}<p class="g-text">${question}</p>
        <div class="g-opts">${options.map((o, i) => `<button data-i="${i}">${esc(o)}</button>`).join('')}</div>
        <div class="g-fb" hidden></div>`);
      panel.querySelectorAll('.g-opts button').forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.i, ok = i === correct;
        panel.querySelectorAll('.g-opts button').forEach((x) => { x.disabled = true; if (+x.dataset.i === correct) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        onAnswer?.(ok);
        const fb = panel.querySelector('.g-fb');
        fb.hidden = false;
        fb.innerHTML = `<p><b class="${ok ? 'ok' : 'no'}">${ok ? '✓ Correct' : '✗ Not quite'}</b> ${why}</p><button class="g-next">Next ▸</button>`;
        fb.querySelector('.g-next').addEventListener('click', () => resolve(ok));
      }, { once: true }));
    });
  }
  // the shipwright introduces a round
  function say(r, text) {
    return new Promise((resolve) => {
      render(`${header(r)}<div class="wright-say">${SHIPWRIGHT_SVG}<blockquote>${esc(text)}<cite>${SHIPWRIGHT.name}</cite></blockquote></div>
        <div class="g-foot"><span></span><button class="g-go" id="g-ready">Go on so ▸</button></div>`);
      panel.querySelector('#g-ready').addEventListener('click', resolve);
    });
  }

  // reference lines drawing (round 1)
  function showRef(highlight = null) {
    const L = api.lines(); if (!L) return;
    const r = renderDrawing(L, { name: api.state.cage.name, sternClosed: api.state.cage.sternClosed }, { plansOnly: true, aged: false, convention: 'steffy', highlight });
    ref.querySelector('.gr-svg').innerHTML = r.svg;
    ref.querySelector('.gr-note').innerHTML = highlight ? '<b>Red</b>: the line on the hull, in all three plans' : 'Sheer · Half-breadth · Body plan';
    ref.hidden = false;
  }

  // ---------------------------------------------------------------- set-up per round
  function quizView(preset, view) {
    api.loadPreset(preset, { silent: true });
    api.viewer.labelMode = 'ends';
    api.viewer.dimmed = true;
    api.viewer.editLocked = true;
    api.viewer.select(null);
    api.viewer.setEditable(null);
    api.viewer.setGhost(null);
    api.viewer.setToggles({ showCage: false, showLabels: true });
    api.setCam(view);
    api.refresh();
    api.viewer.setScreenShift(Math.min(230, api.viewer.el.clientWidth * 0.16));
    document.body.classList.add('play-quiz');
    document.body.classList.remove('play-edit');
  }
  function editView(preset, surface, view = 'persp') {
    api.loadPreset(preset, { silent: true });
    api.setMode('point');
    api.viewer.editLocked = false;
    api.viewer.setHighlight(null);
    api.viewer.setToggles({ showCage: true, showLabels: true });
    api.setSurface(surface);
    api.setCam(view);
    api.refresh();
    api.clearUndo();
    api.viewer.setScreenShift(Math.min(230, api.viewer.el.clientWidth * 0.16));
    document.body.classList.add('play-edit');
    document.body.classList.remove('play-quiz');
  }

  // ---------------------------------------------------------------- round 1
  async function roundLines() {
    quizView(pick(['cargo', 'clipper', 'warship', 'canoe']), 'persp');
    await say(0, SHIPWRIGHT.rounds[0]);
    let score = 0;
    const order = shuffle(TYPES).concat([pick(TYPES)]);
    for (let q = 0; q < order.length; q++) {
      const type = order[q], L = api.lines();
      const set = { station: L.stations, waterline: L.waterlines, buttock: L.buttocks, diagonal: L.diagonals }[type];
      const line = pick(set);
      api.viewer.setHighlight(line.polylines);
      showRef(null);
      const info = LINE_INFO[type];
      const typeNames = TYPES.map((t) => LINE_INFO[t].name);
      const reveal = () => showRef({ type, k: line.k });
      const ok1 = await ask(0, `Question ${q + 1} of 5 · part A`, 'What kind of line is <b class="hl">flashing white</b> on the hull?', typeNames, TYPES.indexOf(type), info.why, reveal);
      const ok2 = await ask(0, `Question ${q + 1} of 5 · part B`, `In which plan of the lines drawing does this ${info.name.toLowerCase()} appear as a curve showing its true shape?`, PLANS, PLANS.indexOf(info.plan), info.why, reveal);
      score += (ok1 ? 2 : 0) + (ok2 ? 2 : 0);
      run.scores[0] = score;
    }
    ref.hidden = true;
    api.viewer.setHighlight(null);
    return score;
  }

  // ---------------------------------------------------------------- round 2
  async function roundLabels() {
    quizView(pick(['clipper', 'warship', 'cargo']), 'profile');
    await say(1, SHIPWRIGHT.rounds[1]);
    let score = 0;
    const L = api.lines();
    const all = L.stations.filter((s) => !s.isMid).map((s) => s.label);
    const mid = L.stations.find((s) => s.isMid);
    // midships is marked for them (it is not obvious by eye), so it is never the question
    api.viewer.markMid = true; api.viewer.setGhost(mid.polylines); api.refresh();
    const chosen = shuffle(L.stations.filter((s) => !s.isMid)).slice(0, 5);
    for (let q = 0; q < chosen.length; q++) {
      const st = chosen[q];
      api.viewer.setHighlight(st.polylines);
      const opts = shuffle([st.label, ...shuffle(all.filter((l) => l !== st.label)).slice(0, 3)]);
      const nice = (l) => (l === '⦶' ? '⦶  midship section' : l);
      const n = Math.abs(st.k - mid.k);
      const why = st.isMid
        ? 'This is the midship section, marked with the amidships symbol ⦶. Every other section is counted from it.'
        : st.fwd
          ? `It is the ${ordinal(n)} section <b>forward</b> of midships. Steffy letters forward sections A, B, C … counting towards the bow, so it is <b>${st.label}</b>.`
          : `It is the ${ordinal(n)} section <b>aft</b> of midships. Steffy numbers after sections 1, 2, 3 … counting towards the stern, so it is <b>${st.label}</b>.`;
      const ok = await ask(1, `Question ${q + 1} of 5`, 'Following <b>Steffy’s convention</b> (bow to the left), what is the label of the <b class="hl">flashing section</b>? The midship section <b>⦶</b> is marked for you.', opts.map(nice), opts.indexOf(st.label), why);
      if (ok) score += 3;
      run.scores[1] = score;
    }
    api.viewer.setHighlight(null); api.viewer.setGhost(null); api.viewer.markMid = false; api.refresh();
    return score;
  }
  const ordinal = (n) => ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'][n] || `${n}th`;

  // ---------------------------------------------------------------- round 3
  async function roundShape() {
    editView(pick(['simple', 'clipper', 'warship']), 'holo', 'body');
    const c = api.state.cage, mi = Math.floor(c.ni / 2);
    const handles = [[mi, 1], [mi, 2], [mi, 3], [mi, 4]];
    // the owner's target: same hull with a fuller or a finer midship control section
    const target = cloneCage(c);
    let B2 = 0, D = 0; for (const row of c.pts) for (const p of row) { B2 = Math.max(B2, p.y); D = Math.max(D, p.z); }
    const fuller = Math.random() < 0.5;
    const dy = fuller ? [0.24, 0.17, 0.09, 0.03] : [-0.2, -0.17, -0.11, -0.04];
    const dz = fuller ? [-0.03, -0.05, -0.03, 0] : [0.08, 0.1, 0.06, 0.02];
    handles.forEach(([i, j], k) => {
      const p = target.pts[i][j], m = rnd(0.8, 1.2);
      p.y = Math.max(0.03 * B2, p.y + dy[k] * B2 * m);
      p.z = Math.max(0.02 * D, p.z + dz[k] * D * m);
    });
    const tGrid = subdivide(gridFromCage(target), api.state.level);
    const tLines = computeLines(tGrid, api.state.lineOpts);
    const tMid = tLines.stations.find((s) => s.isMid);
    const tHyd = hydrostatics(tGrid, tLines);
    const tSamp = sectionSamples(tMid.polylines);

    api.viewer.setEditable(handles);
    api.viewer.labelMode = 'none';
    api.viewer.setFocus({ rows: [mi] });
    document.body.classList.add('play-lockview');
    api.refresh();

    return new Promise((resolve) => {
      const measure = () => {
        const L = api.lines(), mid = L.stations.find((s) => s.isMid);
        const s = sectionSamples(mid.polylines);
        let e = 0; for (let k = 0; k < s.length; k++) e += Math.hypot(s[k][0] - tSamp[k][0], s[k][1] - tSamp[k][1]);
        e /= s.length * Math.max(1e-6, L.bounds.B2);
        const m = clamp01(1 - (e - 0.008) / 0.08);
        return { mid, m, total: 30 * m };
      };
      const draw = () => {
        const h = api.hydro(), L = api.lines(); if (!h || !L) return;
        const sc = measure();
        api.viewer.setHighlight(sc.mid.polylines);
        api.viewer.setGhost(tMid.polylines);
        render(`${header(2)}
          <div class="wright-say wright-mini">${SHIPWRIGHT_SVG}<blockquote>${esc(SHIPWRIGHT.rounds[2])}</blockquote></div>
          <p class="g-text">Drag the four <b class="c-handle">orange handles</b> of the midship control section until the <b class="hl">flashing white</b> section lies on the owner’s <b class="gold">dashed gold</b> target.</p>
          <div class="g-spec">
            <div><span>Match</span><b>${Math.round(sc.m * 100)}%</b><em>${sc.m > 0.95 ? 'spot on' : sc.m > 0.75 ? 'close' : 'keep going'}</em>${meter(sc.m)}</div>
            <div><span>Midship coeff. C<sub>m</sub></span><b>${h.Cm.toFixed(3)}</b><em>owner’s design ${tHyd.Cm.toFixed(3)} · C<sub>b</sub> now ${h.Cb.toFixed(3)} → ${tHyd.Cb.toFixed(3)}</em></div>
          </div>
          <p class="g-tip">You’re looking along the hull from ahead, as in a body plan, so each handle moves straight across the section. The thin orange line is the control section the handles belong to. Drag a handle directly; the arrow keys nudge it (hold <kbd>Shift</kbd> for fine moves). ${fuller ? 'A <b>fuller</b> section pushes the bilge out and down.' : 'A <b>finer</b> section lifts the floors into a V and pulls the bilge in.'}</p>
          <div class="g-foot"><span>Projected: <b>${Math.round(sc.total)}</b> / 30</span><button class="g-go" id="g-submit">Submit ▸</button></div>`);
        panel.querySelector('#g-submit').addEventListener('click', () => {
          api.onUpdate = null;
          run.design = cloneCage(api.state.cage);
          run.design.name = run.vessel;
          run.design.type = 'Student design (Shiplines Challenge)';
          run.scores[2] = measure().total;
          api.viewer.setGhost(null); api.viewer.setHighlight(null); api.viewer.setEditable(null);
          api.viewer.setFocus(null); document.body.classList.remove('play-lockview');
          resolve(run.scores[2]);
        });
      };
      api.onUpdate = draw;
      api.whenHydro(draw);
    });
  }

  // ---------------------------------------------------------------- round 4
  // Two handles are pushed clearly out of line (sideways). Each scores by how close it is
  // brought back to its fair position: full marks within about a third of the original error.
  async function roundFair() {
    editView(pick(['clipper', 'warship', 'simple', 'cargo']), 'zebra', 'persp');
    api.viewer.labelMode = 'all'; api.viewer.dimmed = false;
    const c = api.state.cage;
    let B2 = 0; for (const row of c.pts) for (const p of row) B2 = Math.max(B2, p.y);
    // two well-separated control sections, one handle each on the topside / bilge
    const iA = pick([2, 3]), iB = pick([c.ni - 4, c.ni - 3]);
    const bumped = [[iA, pick([3, 4])], [iB, pick([2, 3, 4])]];
    const fair = bumped.map(([i, j]) => ({ ...c.pts[i][j] }));
    const d0 = bumped.map(([i, j], k) => {
      const p = c.pts[i][j], out = Math.random() < 0.5 || p.y < 0.35 * B2;
      const d = (out ? 1 : -1) * rnd(0.24, 0.3) * B2;
      p.y = Math.max(0.02 * B2, p.y + d);
      return Math.hypot(p.y - fair[k].y, p.z - fair[k].z, p.x - fair[k].x);
    });
    api.viewer.setEditable(bumped);
    api.refresh(true);
    api.clearUndo();
    api.viewer.editLocked = true;
    await say(3, SHIPWRIGHT.rounds[3]);
    api.viewer.editLocked = false;

    return new Promise((resolve) => {
      const scoreOf = () => {
        const parts = bumped.map(([i, j], k) => {
          const p = api.state.cage.pts[i][j], f = fair[k];
          const d = Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z);
          return clamp01((1 - d / d0[k]) / 0.67);
        });
        const r = (parts[0] + parts[1]) / 2;
        return { r, parts, total: 35 * r };
      };
      const draw = () => {
        const sc = scoreOf();
        render(`${header(3)}
          <p class="g-text"><b>Two handles</b> have been knocked out of line. Drag each one back until it sits in line with its neighbours and the zebra stripes and waterlines run sweetly again.</p>
          <div class="g-spec">
            <div><span>Fairness</span><b>${Math.round(sc.r * 100)}%</b><em>${sc.r > 0.95 ? 'beautifully fair' : sc.r > 0.7 ? 'nearly there' : 'lumpy'} · handle 1 ${Math.round(sc.parts[0] * 100)}% · handle 2 ${Math.round(sc.parts[1] * 100)}%</em>${meter(sc.r)}</div>
          </div>
          <p class="g-tip">Look along the thin orange cage lines: a fair hull has each handle in line with its neighbours, fore-and-aft and around the section. The <b>End</b> view shows sideways errors best. Drag directly; the arrow keys nudge (<kbd>Shift</kbd> for fine).<br><b class="gold">Tip:</b> the <b>Zebra</b> fairness view is always available in Explore mode, under <i>Subdivision surface</i>.</p>
          <div class="g-foot"><span>Projected: <b>${Math.round(sc.total)}</b> / 35</span><button class="g-go" id="g-submit">Submit ▸</button></div>`);
        panel.querySelector('#g-submit').addEventListener('click', () => {
          api.onUpdate = null; const f = scoreOf(); run.scores[3] = f.total; api.viewer.setEditable(null); resolve(f.total);
        });
      };
      api.onUpdate = draw;
      draw();
    });
  }

  const meter = (v) => `<div class="bar"><i style="width:${Math.round(clamp01(v) * 100)}%"></i></div>`;

  // ---------------------------------------------------------------- flow
  function intro() {
    $('#welcome').hidden = true;
    $('#play-intro').hidden = false;
    $('#play-student').focus();
  }
  async function start() {
    const student = $('#play-student').value.trim();
    if (!student) { $('#play-student').focus(); $('#play-student').classList.add('need'); return; }
    $('#play-intro').hidden = true;
    run = { student, vessel: $('#play-vessel').value.trim() || 'The Pie Floater', scores: [0, 0, 0, 0], saved: api.saveState() };
    const token = (run.token = Symbol('run'));
    document.body.classList.add('playing');
    api.setLock(true);
    try {
      await roundLines(); if (run?.token !== token) return;
      await roundLabels(); if (run?.token !== token) return;
      await roundShape(); if (run?.token !== token) return;
      await roundFair(); if (run?.token !== token) return;
      finish();
    } catch (e) { console.error(e); exit(); }
  }
  function finish() {
    const total = Math.round(run.scores.reduce((a, b) => a + b, 0));
    const grade = gradeFor(total);
    const parts = run.scores.map((s, i) => `${ROUNDS[i].title} ${Math.round(s)}/${ROUNDS[i].max}`);
    run.result = { student: run.student, score: total, grade, breakdown: parts.join('   ·   '), date: api.dateString() };
    panel.hidden = true; ref.hidden = true;
    const m = $('#play-results');
    m.querySelector('.r-score').innerHTML = `${total}<small>/100</small>`;
    m.querySelector('.r-grade').textContent = grade;
    m.querySelector('.r-name').textContent = run.student;
    m.querySelector('.r-say').innerHTML = `${SHIPWRIGHT_SVG}<blockquote>${esc(SHIPWRIGHT.verdict[grade])}<cite>${SHIPWRIGHT.name}</cite></blockquote>`;
    m.querySelector('.r-rows').innerHTML = run.scores.map((s, i) => `<div><span>${i + 1} · ${ROUNDS[i].title}</span><b>${Math.round(s)} / ${ROUNDS[i].max}</b><div class="bar"><i style="width:${(s / ROUNDS[i].max) * 100}%"></i></div></div>`).join('');
    m.hidden = false;
    try { const best = +localStorage.getItem('shiplines.best') || 0; if (total > best) localStorage.setItem('shiplines.best', total); } catch { /* storage unavailable */ }
  }
  function exit(withCertificate = false) {
    $('#play-results').hidden = true;
    panel.hidden = true; ref.hidden = true;
    document.body.classList.remove('playing', 'play-quiz', 'play-edit', 'play-lockview');
    api.viewer.setFocus(null);
    api.onUpdate = null;
    api.viewer.labelMode = 'all'; api.viewer.dimmed = false; api.viewer.editLocked = false;
    api.viewer.setHighlight(null); api.viewer.setGhost(null); api.viewer.markMid = false; api.viewer.setEditable(null);
    api.viewer.setScreenShift(0);
    api.setLock(false);
    if (withCertificate && run?.result) {
      const lines = makePreset('warship');
      lines.type = `${PRESETS.warship.label} (certificate lines)`;
      api.loadCage(lines, { name: run.vessel, drawnBy: run.student });
      api.setCertificate(run.result);
      api.setView('2d');
    } else if (run?.saved) api.restoreState(run.saved);
    run = null;
  }

  // welcome screen: test your skills, or explore
  const welcome = $('#welcome');
  welcome.querySelector('.w-say').innerHTML = `${SHIPWRIGHT_SVG}<blockquote>${esc(SHIPWRIGHT.welcome)}<cite class="about">${SHIPWRIGHT.about}</cite></blockquote>`;
  $('#w-test').addEventListener('click', intro);
  $('#w-explore').addEventListener('click', () => (welcome.hidden = true));
  $('#w-guide').addEventListener('click', () => { welcome.hidden = true; $('#help').hidden = false; });

  $('#btn-play').addEventListener('click', intro);
  $('#btn-play-cta').addEventListener('click', intro);
  $('#play-start').addEventListener('click', start);
  $('#play-cancel').addEventListener('click', () => ($('#play-intro').hidden = true));
  $('#play-student').addEventListener('input', (e) => e.target.classList.remove('need'));
  $('#play-cert').addEventListener('click', () => exit(true));
  $('#play-again').addEventListener('click', () => { exit(false); intro(); });
  $('#play-exit').addEventListener('click', () => exit(false));
  panel.addEventListener('click', (e) => { if (e.target.closest('.g-quit') && run) exit(false); });

  return { get active() { return !!run; } };
}
