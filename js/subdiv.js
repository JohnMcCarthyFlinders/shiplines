// Catmull–Clark subdivision for a regular, open quad grid.
//
// The control cage is a rows × cols grid of points (rows run along the hull from
// stern to bow, columns run around each half-section from keel to sheer).
// On a regular quad grid, Catmull–Clark is exactly the tensor product of the
// 1-D cubic B-spline subdivision rules (vertex 1/8·6/8·1/8, edge ½·½). The open
// boundaries (keel, sheer, stem, stern) use the standard Catmull–Clark crease /
// boundary rules: boundary curves refine with the 1-D rule along the boundary
// only, and the four corners stay fixed – the same behaviour as Blender's
// Subdivision Surface modifier with "Keep Corners" boundary smoothing.
//
// Because the keel column and the stem row only ever mix with themselves, a
// keel or stem that lies on the centreplane (y = 0) stays exactly on it at every
// level.

/** Grid: { rows, cols, p: Float64Array(rows*cols*3) } */

export function makeGrid(rows, cols) {
  return { rows, cols, p: new Float64Array(rows * cols * 3) };
}

export function gridFromCage(cage) {
  const g = makeGrid(cage.ni, cage.nj);
  for (let i = 0; i < cage.ni; i++)
    for (let j = 0; j < cage.nj; j++) {
      const q = cage.pts[i][j], k = (i * cage.nj + j) * 3;
      g.p[k] = q.x; g.p[k + 1] = q.y; g.p[k + 2] = q.z;
    }
  return g;
}

// 1-D refinement of one strided run of points (n points -> 2n-1).
function refine1D(src, sOff, sStride, n, dst, dOff, dStride) {
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < n; k++) {
      const p = src[sOff + k * sStride + c];
      let v;
      if (k === 0 || k === n - 1) v = p; // fixed ends (boundary/corner rule)
      else v = (src[sOff + (k - 1) * sStride + c] + 6 * p + src[sOff + (k + 1) * sStride + c]) / 8;
      dst[dOff + (2 * k) * dStride + c] = v;
      if (k < n - 1) dst[dOff + (2 * k + 1) * dStride + c] = (p + src[sOff + (k + 1) * sStride + c]) / 2;
    }
  }
}

export function subdivideOnce(g) {
  const { rows, cols, p } = g;
  const nc = cols * 2 - 1, nr = rows * 2 - 1;
  // pass 1: along each row (j direction)
  const a = makeGrid(rows, nc);
  for (let i = 0; i < rows; i++) refine1D(p, i * cols * 3, 3, cols, a.p, i * nc * 3, 3);
  // pass 2: along each column (i direction)
  const b = makeGrid(nr, nc);
  for (let j = 0; j < nc; j++) refine1D(a.p, j * 3, nc * 3, rows, b.p, j * 3, nc * 3);
  return b;
}

export function subdivide(g, levels) {
  let r = g;
  for (let l = 0; l < levels; l++) r = subdivideOnce(r);
  return r;
}

export function gridPoint(g, i, j) {
  const k = (i * g.cols + j) * 3;
  return [g.p[k], g.p[k + 1], g.p[k + 2]];
}

/** Boundary polylines of the half-hull surface. */
export function boundaries(g) {
  const row = (i) => { const o = []; for (let j = 0; j < g.cols; j++) o.push(gridPoint(g, i, j)); return o; };
  const col = (j) => { const o = []; for (let i = 0; i < g.rows; i++) o.push(gridPoint(g, i, j)); return o; };
  return {
    keel: col(0),               // stern -> bow, on centreplane
    sheer: col(g.cols - 1),     // stern -> bow
    stern: row(0),              // keel -> sheer (sternpost or transom edge)
    stem: row(g.rows - 1),      // keel -> sheer, on centreplane
  };
}

/** Axis-aligned bounds of a grid. */
export function gridBounds(g) {
  const b = { xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity, zmin: Infinity, zmax: -Infinity };
  for (let k = 0; k < g.p.length; k += 3) {
    const x = g.p[k], y = g.p[k + 1], z = g.p[k + 2];
    if (x < b.xmin) b.xmin = x; if (x > b.xmax) b.xmax = x;
    if (y < b.ymin) b.ymin = y; if (y > b.ymax) b.ymax = y;
    if (z < b.zmin) b.zmin = z; if (z > b.zmax) b.zmax = z;
  }
  return b;
}
