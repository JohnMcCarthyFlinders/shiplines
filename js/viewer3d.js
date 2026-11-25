import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { isLocked } from './presets.js';

export const LINE_COLOURS = {
  stations: '#FFD300',   // Flinders Gold
  waterlines: '#3DE8FF',
  lwl: '#B8FBFF',
  buttocks: '#FF4FD8',
  diagonals: '#7CFF6B',
  outline: '#EAF2FF',
};
const HANDLE = { free: 0xff9f1c, locked: 0xff5a36, selected: 0xffffff, group: 0xffe7a3 };

// ship (x, y, z) -> three (x, z, y): three Y is up, three Z is starboard
const S2T = (x, y, z, o) => new THREE.Vector3(x - o.x, z - o.z, y);

export class Viewer3D {
  constructor(container, hooks = {}) {
    this.el = container;
    this.hooks = hooks;
    this.o = { x: 0, z: 0 };
    this.sel = null; // { i, j, members: [[i,j]...] }
    this.mode = 'point';
    this.surfaceMode = 'holo';
    this.showMirror = true;
    this.showCage = true;
    this.showWire = true;
    this.showWater = true;
    this.showLabels = true;
    this.labelMode = 'all'; // 'all' | 'ends'
    this.dimmed = false;
    this.editLocked = false;
    this.highlightPolys = null;
    this.lineWidth = 2.5;
    this.vis = { stations: true, waterlines: true, buttocks: true, diagonals: true, outline: true };
    this.convention = 'steffy';
    this.t0 = performance.now();
    this._initRenderer();
    this._initScene();
    this._initControls();
    this._initEvents();
    this._loop();
  }

  // ------------------------------------------------------------------ setup
  _initRenderer() {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    this.el.appendChild(r.domElement);
    this.css = new CSS2DRenderer();
    this.css.domElement.className = 'labels3d';
    this.el.appendChild(this.css.domElement);
  }

  _initScene() {
    const s = (this.scene = new THREE.Scene());
    s.background = gradientTexture();
    s.fog = new THREE.FogExp2(0x02101f, 0.0);
    this.persp = new THREE.PerspectiveCamera(38, 1, 0.05, 5000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    this.camera = this.persp;

    s.add(new THREE.HemisphereLight(0x9fd8ff, 0x061423, 1.1));
    const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(0.6, 1, 0.8); s.add(d);
    const d2 = new THREE.DirectionalLight(0x3de8ff, 0.5); d2.position.set(-1, 0.3, -0.6); s.add(d2);

    this.root = new THREE.Group(); s.add(this.root);
    this.linesGroup = new THREE.Group(); this.root.add(this.linesGroup);
    this.labelGroup = new THREE.Group(); this.root.add(this.labelGroup);
    this.cageGroup = new THREE.Group(); this.root.add(this.cageGroup);

    // materials
    this.mats = {
      holo: holoMaterial(0.8),
      holoMirror: holoMaterial(0.35),
      zebra: zebraMaterial(),
      solid: new THREE.MeshStandardMaterial({ color: 0x3a7fc0, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, emissive: 0x020c18 }),
    };
    this.hullGeo = new THREE.BufferGeometry();
    this.hull = new THREE.Mesh(this.hullGeo, this.mats.holo);
    this.mirror = new THREE.Mesh(this.hullGeo, this.mats.holoMirror);
    this.mirror.scale.z = -1;
    this.hull.renderOrder = 1; this.mirror.renderOrder = 1;
    this.root.add(this.hull, this.mirror);
    this.wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x3de8ff, transparent: true, opacity: 0.07, depthWrite: false }));
    this.wireM = new THREE.LineSegments(this.wire.geometry, this.wire.material); this.wireM.scale.z = -1;
    this.root.add(this.wire, this.wireM);

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMaterial());
    this.floor.rotation.x = -Math.PI / 2; this.floor.renderOrder = -1;
    s.add(this.floor);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), waterMaterial());
    this.water.rotation.x = -Math.PI / 2; this.water.renderOrder = 3;
    this.root.add(this.water);

    // handles
    this.handleGeo = new THREE.SphereGeometry(1, 16, 12);
    this.handles = [];
    this.cageLine = null;

    // post-processing
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.14, 0.25, 0.75);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _initControls() {
    this.orbit = new OrbitControls(this.persp, this.renderer.domElement);
    this.orbit.enableDamping = true; this.orbit.dampingFactor = 0.08;
    this.orbitO = new OrbitControls(this.ortho, this.renderer.domElement);
    this.orbitO.enableRotate = false; this.orbitO.enabled = false;
    this.orbitO.screenSpacePanning = true;
    this.tc = new TransformControls(this.persp, this.renderer.domElement);
    this.tc.setSize(0.75);
    this.tc.setSpace('world');
    this.scene.add(this.tc.getHelper());
    this.proxy = new THREE.Object3D(); this.scene.add(this.proxy);
    this.tc.addEventListener('dragging-changed', (e) => {
      this.activeOrbit().enabled = !e.value;
      if (e.value) { this._dragStart = this.proxy.position.clone(); this._startPts = this.sel.members.map(([i, j]) => ({ ...this.cage.pts[i][j] })); this.hooks.onEdit?.('start'); }
      else this.hooks.onEdit?.('end');
    });
    this.tc.addEventListener('objectChange', () => {
      if (!this.sel || !this._dragStart) return;
      const d = this.proxy.position.clone().sub(this._dragStart); // three delta
      this.sel.members.forEach(([i, j], k) => {
        const p0 = this._startPts[k], p = this.cage.pts[i][j];
        p.x = p0.x + d.x; p.z = p0.z + d.y;
        p.y = isLocked(this.cage, i, j) ? 0 : Math.max(0, p0.y + d.z);
      });
      this.hooks.onEdit?.('drag');
    });
  }

  activeOrbit() { return this.camera === this.persp ? this.orbit : this.orbitO; }

  _initEvents() {
    const dom = this.renderer.domElement;
    this.ray = new THREE.Raycaster();
    let down = null;
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointerup', (e) => {
      if (!down || this.tc.dragging) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || e.button !== 0) return;
      const h = this._pick(e);
      if (h) this.select(h.userData.i, h.userData.j);
      else if (!this.tc.axis) this.select(null);
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.tc.dragging) return;
      const h = this._pick(e);
      dom.style.cursor = h ? 'pointer' : '';
      if (h !== this._hover) {
        if (this._hover) this._hover.userData.hover = false;
        if (h) h.userData.hover = true;
        this._hover = h;
      }
    });
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.resize();
  }

  _pick(e) {
    if (!this.showCage || this.editLocked || !this.handles.length) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(m, this.camera);
    const hits = this.ray.intersectObjects(this.handles, false);
    return hits.length ? hits[0].object : null;
  }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.css.setSize(w, h);
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    this._fitOrtho();
    for (const m of this._lineMats()) m.resolution.set(w, h);
  }

  // ------------------------------------------------------------------ data
  setCage(cage, recentre = false) {
    this.cage = cage;
    if (recentre || !this._hasFrame) {
      let xmin = Infinity, xmax = -Infinity, zmin = Infinity;
      for (const row of cage.pts) for (const p of row) { xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); zmin = Math.min(zmin, p.z); }
      this.o = { x: (xmin + xmax) / 2, z: zmin };
      this._hasFrame = true;
    }
    this._buildHandles();
  }

  _buildHandles() {
    for (const h of this.handles) { this.cageGroup.remove(h); h.material.dispose(); }
    this.handles = [];
    const c = this.cage;
    let L = 0; for (const row of c.pts) for (const p of row) L = Math.max(L, p.x);
    this.handleR = Math.max(0.04, L * 0.0042);
    for (let i = 0; i < c.ni; i++) for (let j = 0; j < c.nj; j++) {
      const locked = isLocked(c, i, j);
      const m = new THREE.Mesh(this.handleGeo, new THREE.MeshBasicMaterial({ color: locked ? HANDLE.locked : HANDLE.free, depthTest: false, transparent: true, opacity: 0.95 }));
      m.userData = { i, j, r: this.handleR, locked };
      m.renderOrder = 10;
      this.cageGroup.add(m); this.handles.push(m);
    }
    this.updateCage();
  }

  updateCage() {
    const c = this.cage;
    for (const h of this.handles) {
      const p = c.pts[h.userData.i][h.userData.j];
      h.position.copy(S2T(p.x, p.y, p.z, this.o));
      const sel = this._isSel(h), prim = this.sel && this.sel.i === h.userData.i && this.sel.j === h.userData.j;
      h.material.color.setHex(prim ? HANDLE.selected : sel ? HANDLE.group : h.userData.locked ? HANDLE.locked : HANDLE.free);
      h.userData.k = sel ? 1.6 : 1;
    }
    const pos = [];
    const P = (i, j) => { const p = c.pts[i][j]; const v = S2T(p.x, p.y, p.z, this.o); return [v.x, v.y, v.z]; };
    for (let i = 0; i < c.ni; i++) for (let j = 0; j < c.nj; j++) {
      if (j < c.nj - 1) pos.push(...P(i, j), ...P(i, j + 1));
      if (i < c.ni - 1) pos.push(...P(i, j), ...P(i + 1, j));
    }
    if (this.cageLine) { this.cageGroup.remove(this.cageLine); this.cageLine.geometry.dispose(); }
    const g = new LineSegmentsGeometry(); g.setPositions(pos);
    if (!this.cageMat) this.cageMat = new LineMaterial({ color: 0xff9f1c, linewidth: 1.2, transparent: true, opacity: 0.55, depthTest: false, toneMapped: false });
    this.cageLine = new LineSegments2(g, this.cageMat); this.cageLine.renderOrder = 9;
    this.cageGroup.add(this.cageLine);
    this.cageGroup.visible = this.showCage;
    if (this.sel && !this.tc.dragging) this._placeProxy();
  }

  updateSurface(grid) {
    const { rows, cols, p } = grid;
    const n = rows * cols;
    const pos = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const t = S2T(p[v * 3], p[v * 3 + 1], p[v * 3 + 2], this.o);
      pos[v * 3] = t.x; pos[v * 3 + 1] = t.y; pos[v * 3 + 2] = t.z;
    }
    if (this._dims !== `${rows}x${cols}`) {
      this._dims = `${rows}x${cols}`;
      const idx = [], wid = [];
      for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
        idx.push(a, c, d, a, d, b);
      }
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const a = i * cols + j;
        if (j < cols - 1) wid.push(a, a + 1);
        if (i < rows - 1) wid.push(a, a + cols);
      }
      this.hullGeo.setIndex(idx);
      this.wire.geometry.setIndex(wid);
    }
    this.hullGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.hullGeo.computeVertexNormals();
    this.hullGeo.computeBoundingSphere();
    this.wire.geometry.setAttribute('position', this.hullGeo.getAttribute('position'));
    this.wire.geometry.computeBoundingSphere();
  }

  updateLines(lines) {
    this.lines = lines;
    for (const ch of [...this.linesGroup.children]) { this.linesGroup.remove(ch); ch.geometry.dispose(); }
    for (const ch of [...this.labelGroup.children]) { this.labelGroup.remove(ch); ch.element.remove(); }
    const mk = (key, polys, width) => {
      if (!polys.length) return;
      const pos = [];
      for (const l of polys) for (const mir of [1, -1]) {
        for (let k = 1; k < l.length; k++) {
          const a = S2T(l[k - 1][0], mir * l[k - 1][1], l[k - 1][2] + lines.bounds.z0, this.o);
          const b = S2T(l[k][0], mir * l[k][1], l[k][2] + lines.bounds.z0, this.o);
          pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      const g = new LineSegmentsGeometry(); g.setPositions(pos);
      const m = this._lineMat(key, width);
      const o = new LineSegments2(g, m); o.renderOrder = 5; o.userData.key = key;
      this.linesGroup.add(o);
    };
    const lw = this.lineWidth;
    if (this.vis.stations) mk('stations', lines.stations.flatMap((s) => s.polylines), lw);
    if (this.vis.waterlines) {
      mk('waterlines', lines.waterlines.filter((w) => !w.isLWL).flatMap((w) => w.polylines), lw);
      mk('lwl', lines.waterlines.filter((w) => w.isLWL).flatMap((w) => w.polylines), lw * 1.6);
    }
    if (this.vis.buttocks) mk('buttocks', lines.buttocks.flatMap((b) => b.polylines), lw);
    if (this.vis.diagonals) mk('diagonals', lines.diagonals.flatMap((d) => d.polylines), lw);
    if (this.vis.outline) {
      const ol = lines.outline;
      mk('outline', [ol.sheer, ol.keel, ol.stem, ol.stern], lw * 0.9);
    }
    // labels
    const b = lines.bounds;
    const lab = (txt, cls, x, y, z) => {
      const d = document.createElement('div'); d.className = 'lab3d ' + cls; d.textContent = txt;
      const o = new CSS2DObject(d); o.position.copy(S2T(x, y, z + b.z0, this.o)); this.labelGroup.add(o);
    };
    if (this.showLabels) {
      const all = this.labelMode === 'all';
      if (all && this.vis.stations) for (const s of lines.stations) lab(s.label, 'st' + (s.isMid ? ' mid' : ''), s.x, 0, b.Hmax + b.Hmax * 0.09);
      if (all && this.vis.waterlines) for (const w of lines.waterlines) lab(w.label, 'wl' + (w.isLWL ? ' lwl' : ''), b.xmin - b.L * 0.035, 0, w.z);
      if (all && this.vis.buttocks) for (const t of lines.buttocks) { const l = t.polylines.reduce((m, p) => (p.length > (m ? m.length : 0) ? p : m), null); if (l) { const q = l.reduce((m, p) => (p[0] > m[0] ? p : m), l[0]); lab(t.label, 'bt', q[0] + b.L * 0.012, t.y, q[2]); } }
      if (all && this.vis.diagonals) for (const d of lines.diagonals) { const l = d.polylines[0]; if (l) { const q = l.reduce((m, p) => (p[0] < m[0] ? p : m), l[0]); lab(d.label, 'dg', q[0] - b.L * 0.015, q[1], q[2]); } }
      lab('BOW', 'end', b.xmax + b.L * 0.06, 0, b.Hmid * 0.5);
      lab('STERN', 'end', b.xmin - b.L * 0.09, 0, b.Hmid * 0.5);
    }
    for (const m of Object.values(this._mats || {})) m.opacity = this.dimmed ? 0.22 : 1;
    this._buildHighlight();
    this._placeEnvironment(b);
  }

  /** Highlight a set of starboard polylines (relative heights, as in `lines`); null clears. */
  setHighlight(polys) { this.highlightPolys = polys; this._buildHighlight(); }
  _buildHighlight() {
    if (this.hl) { this.root.remove(this.hl); this.hl.geometry.dispose(); this.hl = null; }
    const polys = this.highlightPolys, lines = this.lines;
    if (!polys || !lines) return;
    const pos = [];
    for (const l of polys) for (const mir of [1, -1]) for (let k = 1; k < l.length; k++) {
      const a = S2T(l[k - 1][0], mir * l[k - 1][1], l[k - 1][2] + lines.bounds.z0, this.o);
      const b = S2T(l[k][0], mir * l[k][1], l[k][2] + lines.bounds.z0, this.o);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new LineSegmentsGeometry(); g.setPositions(pos);
    if (!this.hlMat) this.hlMat = new LineMaterial({ color: 0xffffff, linewidth: 5, transparent: true, depthTest: false, toneMapped: false });
    this.hlMat.linewidth = Math.max(4, this.lineWidth * 2.2);
    this.hlMat.resolution.set(this.el.clientWidth, this.el.clientHeight);
    this.hl = new LineSegments2(g, this.hlMat); this.hl.renderOrder = 30;
    this.root.add(this.hl);
  }

  _lineMat(key, width) {
    this._mats = this._mats || {};
    const k = key;
    if (!this._mats[k]) this._mats[k] = new LineMaterial({ color: new THREE.Color(LINE_COLOURS[key]), linewidth: width, toneMapped: false, transparent: true, opacity: 1 });
    this._mats[k].linewidth = width;
    this._mats[k].resolution.set(this.el.clientWidth, this.el.clientHeight);
    return this._mats[k];
  }
  _lineMats() { return [...Object.values(this._mats || {}), this.cageMat, this.hlMat].filter(Boolean); }

  _placeEnvironment(b) {
    const size = Math.max(b.L, b.B2 * 2) * 3;
    this.floor.scale.set(size, size, 1);
    this.floor.position.set(0, -b.Hmax * 0.04, 0);
    this.floor.material.uniforms.uSpacing.value = niceStep(b.L / 12);
    this.floor.material.uniforms.uFade.value = size * 0.45;
    this.water.scale.set(b.L * 1.35, b.B2 * 2 * 2.2, 1);
    this.water.position.set(b.xmid - this.o.x, b.lwl + b.z0 - this.o.z, 0);
    this.water.material.uniforms.uSpacing.value = niceStep(b.L / 24);
    this.water.visible = this.showWater;
    const H = b.Hmax || 1;
    this.mats.holo.uniforms.uScan.value = 70 / H; this.mats.holoMirror.uniforms.uScan.value = 70 / H;
    this.mats.zebra.uniforms.uStripes.value = 14;
    this._bounds = b;
    if (!this._framed) { this.frame(); this._framed = true; }
  }

  // ------------------------------------------------------------------ selection
  setMode(m) { this.mode = m; if (this.sel) this.select(this.sel.i, this.sel.j); }
  _isSel(h) { return !!this.sel && this.sel.members.some(([i, j]) => i === h.userData.i && j === h.userData.j); }
  select(i, j) {
    if (i == null) { this.sel = null; this.tc.detach(); if (this.cage) this.updateCage(); this.hooks.onSelect?.(null); return; }
    const c = this.cage, members = [];
    if (this.mode === 'station') for (let jj = 0; jj < c.nj; jj++) members.push([i, jj]);
    else if (this.mode === 'longitudinal') for (let ii = 0; ii < c.ni; ii++) members.push([ii, j]);
    else members.push([i, j]);
    this.sel = { i, j, members };
    this._placeProxy();
    this.tc.attach(this.proxy);
    const allLocked = members.every(([a, b]) => isLocked(c, a, b));
    this.tc.showZ = !allLocked;
    this.updateCage();
    this.hooks.onSelect?.(this.sel);
  }
  _placeProxy() {
    const p = this.cage.pts[this.sel.i][this.sel.j];
    this.proxy.position.copy(S2T(p.x, p.y, p.z, this.o));
  }

  // ------------------------------------------------------------------ display
  setSurfaceMode(m) {
    this.surfaceMode = m;
    this.hull.visible = this.mirror.visible = m !== 'off';
    this.hull.material = m === 'solid' ? this.mats.solid : m === 'zebra' ? this.mats.zebra : this.mats.holo;
    this.mirror.material = m === 'solid' ? this.mats.solid : m === 'zebra' ? this.mats.zebra : this.mats.holoMirror;
    this.mirror.visible = this.mirror.visible && this.showMirror;
    this.wire.visible = this.showWire && m !== 'off' && m !== 'zebra';
    this._applyBloom();
    this.wireM.visible = this.wire.visible && this.showMirror;
  }
  setToggles(t) {
    Object.assign(this, t);
    this.cageGroup.visible = this.showCage;
    if (!this.showCage) this.select(null);
    this.setSurfaceMode(this.surfaceMode);
    this.water.visible = this.showWater;
    this._applyBloom();
  }

  _applyBloom() {
    const base = { holo: 0.14, solid: 0.08, zebra: 0.0, off: 0.12 }[this.surfaceMode] ?? 0.14;
    this.bloom.strength = this.bloomOn === false ? 0 : base;
  }

  frame() {
    const b = this._bounds; if (!b) return;
    const L = b.L, H = b.Hmax;
    const target = new THREE.Vector3(b.xmid - this.o.x, H * 0.45, 0);
    const dir = new THREE.Vector3(this.convention === 'steffy' ? -0.55 : 0.55, 0.42, 0.75).normalize();
    this.persp.position.copy(target).addScaledVector(dir, L * 1.55);
    this.persp.near = L * 0.005; this.persp.far = L * 40; this.persp.updateProjectionMatrix();
    this.orbit.target.copy(target); this.orbit.update();
  }

  setView(v) {
    const b = this._bounds; if (!b) return;
    this.view = v;
    if (v === 'persp') {
      this.camera = this.persp; this.orbit.enabled = true; this.orbitO.enabled = false;
    } else {
      this.camera = this.ortho; this.orbit.enabled = false; this.orbitO.enabled = true;
      const t = new THREE.Vector3(b.xmid - this.o.x, b.Hmax * 0.45, 0);
      const D = b.L * 4, flip = this.convention === 'steffy' ? 1 : -1;
      const cam = this.ortho;
      if (v === 'profile') { cam.position.set(t.x, t.y, -flip * D); cam.up.set(0, 1, 0); }
      if (v === 'plan') { t.y = 0; cam.position.set(t.x, D, 0); cam.up.set(0, 0, flip); }
      if (v === 'body') { cam.position.set(t.x + D, t.y, 0); cam.up.set(0, 1, 0); }
      cam.lookAt(t); cam.zoom = 1;
      this.orbitO.target.copy(t); this.orbitO.update();
      this._fitOrtho();
    }
    this.renderPass.camera = this.camera;
    this.tc.camera = this.camera;
  }
  _fitOrtho() {
    const b = this._bounds; if (!b) return;
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1, a = w / h;
    let span = this.view === 'body' ? Math.max(b.B2 * 2.6, b.Hmax * 1.4 * a) : b.L * 1.25;
    if (this.view === 'body') span = Math.max(span, b.Hmax * 1.5 * a);
    const hh = span / a / 2;
    Object.assign(this.ortho, { left: -span / 2, right: span / 2, top: hh, bottom: -hh });
    this.ortho.updateProjectionMatrix();
  }

  // keep handles a constant size on screen (about 5 px radius)
  _sizeHandles() {
    if (!this.handles.length || !this.cageGroup.visible) return;
    const hpx = this.el.clientHeight || 1;
    const cam = this.camera;
    for (const h of this.handles) {
      let wpp;
      if (cam.isOrthographicCamera) wpp = (cam.top - cam.bottom) / cam.zoom / hpx;
      else wpp = (2 * cam.position.distanceTo(h.position) * Math.tan((cam.fov * Math.PI) / 360)) / hpx;
      h.scale.setScalar(wpp * 5 * (h.userData.k || 1) * (h.userData.hover ? 1.35 : 1));
    }
  }

  snapshot() { this.composer.render(); return this.renderer.domElement.toDataURL('image/png'); }

  _loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      const t = (performance.now() - this.t0) / 1000;
      this.mats.holo.uniforms.uTime.value = t; this.mats.holoMirror.uniforms.uTime.value = t;
      this.water.material.uniforms.uTime.value = t;
      if (this.hlMat) this.hlMat.opacity = 0.65 + 0.35 * Math.sin(t * 5);
      this.mats.zebra.uniforms.uCam.value.copy(this.camera.position);
      this.activeOrbit().update();
      this._sizeHandles();
      this.composer.render();
      this.css.render(this.scene, this.camera);
    };
    tick();
  }
}

// ------------------------------------------------------------------ helpers
function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function gradientTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#000a17'); gr.addColorStop(0.55, '#00213f'); gr.addColorStop(1, '#00305c');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function holoMaterial(alpha) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: alpha }, uScan: { value: 10 }, uBase: { value: new THREE.Color('#0a3a6b') }, uRim: { value: new THREE.Color('#3de8ff') } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uAlpha, uScan; uniform vec3 uBase, uRim;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.2);
        float scan = smoothstep(0.82, 1.0, sin(vW.y * uScan - uTime * 1.6) * 0.5 + 0.5);
        vec3 col = uBase * 0.55 + uRim * (rim * 0.45 + scan * 0.05);
        float a = (0.14 + rim * 0.38 + scan * 0.03) * uAlpha;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

function zebraMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    uniforms: { uCam: { value: new THREE.Vector3() }, uStripes: { value: 14 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCam; uniform float uStripes; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 n = normalize(vN); vec3 v = normalize(vW - uCam);
        if (dot(n, v) > 0.0) n = -n;
        vec3 r = reflect(v, n);
        float s = smoothstep(0.46, 0.54, fract(r.y * uStripes * 0.5));
        float shade = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.4,1.0,0.6))), 0.0);
        vec3 col = mix(vec3(0.01,0.03,0.06), vec3(0.62,0.7,0.78), s) * shade;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function floorMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uSpacing: { value: 5 }, uFade: { value: 100 } },
    vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform float uSpacing, uFade; varying vec3 vW;
      float grid(vec2 p, float s){ vec2 g = abs(fract(p/s - 0.5) - 0.5) / fwidth(p/s); return 1.0 - min(min(g.x,g.y), 1.0); }
      void main(){
        float d = length(vW.xz);
        float fade = 1.0 - smoothstep(uFade*0.15, uFade, d);
        float a = grid(vW.xz, uSpacing) * 0.22 + grid(vW.xz, uSpacing*5.0) * 0.35;
        vec3 col = mix(vec3(0.1,0.55,0.8), vec3(0.25,0.9,1.0), a);
        gl_FragColor = vec4(col, a * fade);
      }`,
  });
}

function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uSpacing: { value: 2 }, uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform float uSpacing, uTime; varying vec2 vUv; varying vec3 vW;
      void main(){
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = smoothstep(0.0, 0.12, min(e.x, e.y));
        vec2 g = abs(fract(vW.xz/uSpacing - 0.5) - 0.5) / fwidth(vW.xz/uSpacing);
        float line = 1.0 - min(min(g.x,g.y),1.0);
        float pulse = 0.5 + 0.5 * sin(uTime * 1.2);
        gl_FragColor = vec4(vec3(0.24,0.85,1.0), (0.07 + line * (0.16 + 0.06*pulse)) * edge);
      }`,
  });
}
