// Phone tour: a light, mostly read-only introduction to lines plans that ends by
// sending the reader to a computer for the full Shiplines tool.

import { makePreset, PRESETS } from './presets.js?v=18';
import { gridFromCage, subdivide } from './subdiv.js?v=18';
import { computeLines } from './lines.js?v=18';
import { renderDrawing } from './drawing2d.js?v=18';
import { SHIPWRIGHT_SVG, SHIPWRIGHT } from './game.js?v=18';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SAYS = [
  'I’m Mouldy Lofterson, and I live up in the Mount Lofty Mould Loft. Ah, you’ve come in on a phone. Shiplines is a drawing-board job, and you’ll want a proper screen and a mouse for the shaping. But come in anyway and I’ll give you the tour.',
  'Steffy was a careful man, and a tidy drawing is half the battle. Get the conventions right and anyone can read your lines.',
  'That’s the tour, so. The real learning is at the board: shaping a hull yourself, fairing it and drawing its lines. Get yourself in front of a computer and come back to me at the Mould Loft. I’ll have the challenge waiting.',
];
for (const el of $$('[data-say]')) el.innerHTML = `${SHIPWRIGHT_SVG}<blockquote>${esc(SAYS[+el.dataset.say])}${+el.dataset.say === 0 ? `<cite class="about">${SHIPWRIGHT.about}</cite>` : `<cite>${SHIPWRIGHT.name}</cite>`}</blockquote>`;

// ---------------------------------------------------------------- lines figures
const cache = {};
function linesFor(key) {
  if (!cache[key]) {
    const cage = makePreset(key);
    cache[key] = { cage, lines: computeLines(subdivide(gridFromCage(cage), 2), {}) };
  }
  return cache[key];
}
function figure(key, opts = {}) {
  const { cage, lines } = linesFor(key);
  return renderDrawing(lines, { name: cage.name, sternClosed: cage.sternClosed }, { plansOnly: true, aged: false, convention: 'steffy', ...opts }).svg;
}
function pickLine(lines, type) {
  if (type === 'station') return lines.stations.find((s) => s.label === 'B') || lines.stations[0];
  if (type === 'waterline') return lines.waterlines.find((w) => w.isLWL);
  if (type === 'buttock') return lines.buttocks[1] || lines.buttocks[0];
  return lines.diagonals[0];
}
const { lines: clip } = linesFor('clipper');
for (const fig of $$('figure.plan[data-fig]')) {
  const t = fig.dataset.fig;
  if (t === 'plain') fig.innerHTML = figure('clipper');
  else if (t === 'steffy') fig.innerHTML = figure('warship', { aged: true });
  else if (['station', 'waterline', 'buttock', 'diagonal'].includes(t)) fig.innerHTML = figure('clipper', { highlight: { type: t, k: pickLine(clip, t).k } });
}

// fair vs unfair batten sketch
$('#fair-fig').innerHTML = `<svg viewBox="0 0 320 150" role="img" aria-label="A fair curve and an unfair curve">
  <rect width="320" height="150" fill="#fbf7ec"/>
  <g font-family="'Architects Daughter', cursive" font-size="11" fill="#24201b">
    <text x="12" y="20">FAIR</text><text x="12" y="92">UNFAIR</text>
  </g>
  <path d="M20 60 C 90 20, 230 20, 300 60" fill="none" stroke="#24201b" stroke-width="2"/>
  <path d="M20 132 C 70 104, 110 96, 140 104 C 160 110, 170 92, 200 94 C 240 96, 270 110, 300 132" fill="none" stroke="#d0101e" stroke-width="2"/>
  <g fill="#24201b">${[45, 100, 160, 220, 275].map((x) => `<rect x="${x - 7}" y="${(60 - 30 * (1 - ((x - 160) / 140) ** 2) - 10).toFixed(1)}" width="14" height="7" rx="2"/>`).join('')}</g>
  <text x="300" y="16" text-anchor="end" font-family="'Architects Daughter', cursive" font-size="10" fill="#24201b">lead ducks hold the batten</text>
  <text x="300" y="86" text-anchor="end" font-family="'Architects Daughter', cursive" font-size="10" fill="#d0101e">a bump the zebra stripes would show ↓</text>
</svg>`;

// hull gallery
const order = ['cargo', 'clipper', 'canoe', 'warship', 'simple'];
const gal = $('figure[data-fig="gallery"]');
function showHull(k) {
  gal.innerHTML = figure(k);
  $('#gallery-cap').textContent = PRESETS[k].blurb;
  $$('#hulls button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
}
$('#hulls').innerHTML = order.map((k) => `<button data-k="${k}">${PRESETS[k].label.replace(' (start here)', '')}</button>`).join('');
$('#hulls').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showHull(b.dataset.k); });
showHull('clipper');

// ---------------------------------------------------------------- the link to send to a computer
const full = new URL('./', location.href).href;
$('#full-url').textContent = full;
$('#mail').href = `mailto:?subject=${encodeURIComponent('Shiplines: open on a computer')}&body=${encodeURIComponent(`Open Shiplines on a computer:\n${full}\n\nFlinders University Maritime Archaeology Program`)}`;
$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(full); $('#copy').textContent = 'Copied ✓'; }
  catch { const r = document.createRange(); r.selectNodeContents($('#full-url')); getSelection().removeAllRanges(); getSelection().addRange(r); $('#copy').textContent = 'Selected: copy it'; }
});

// ---------------------------------------------------------------- progress dots
const cards = $$('.card');
$('#progress').innerHTML = cards.map(() => '<i></i>').join('');
const dots = $$('#progress i');
const io = new IntersectionObserver((ents) => {
  for (const e of ents) if (e.isIntersecting) { const n = +e.target.dataset.step; dots.forEach((d, i) => d.classList.toggle('on', i <= n)); }
}, { threshold: 0.45 });
cards.forEach((c) => io.observe(c));

// ---------------------------------------------------------------- slowly turning 3D hull (look, don't touch)
(async () => {
  try {
    const { Viewer3D } = await import('./viewer3d.js?v=18');
    const v = new Viewer3D($('#hero'), {});
    const cage = makePreset('clipper');
    v.convention = 'steffy';
    v.setCage(cage, true);
    v.updateSurface(subdivide(gridFromCage(cage), 2));
    v.setToggles({ showCage: false, showLabels: false, showWater: true });
    v.editLocked = true;
    v.updateLines(clip);
    v.orbit.autoRotate = true; v.orbit.autoRotateSpeed = 1.1;
    v.orbit.enableZoom = false; v.orbit.enablePan = false; v.orbit.enableRotate = false;
    v.renderer.domElement.style.touchAction = 'pan-y';
    v.frame();
  } catch (e) {
    $('#hero').innerHTML = `<div class="hero-fallback">${figure('clipper')}</div>`;
  }
})();
