// Plane slicing of a subdivided grid surface.
// Each quad is split into two triangles; every triangle crossed by the level set
// f(p) = c contributes one segment whose ends lie on mesh edges. Ends are keyed by
// edge so the segments chain exactly into polylines (open or closed).

export function sliceGrid(g, f, c) {
  const { rows, cols, p } = g;
  const n = rows * cols;
  const val = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    let d = f(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]) - c;
    if (Math.abs(d) < 1e-9) d = 1e-9; // nudge vertices that sit exactly on the plane
    val[v] = d;
  }
  const pts = new Map();   // edgeKey -> [x,y,z]
  const adj = new Map();   // edgeKey -> [edgeKey, ...]
  const edgePoint = (a, b) => {
    const key = a < b ? a * n + b : b * n + a;
    if (!pts.has(key)) {
      const t = val[a] / (val[a] - val[b]);
      pts.set(key, [
        p[a * 3] + t * (p[b * 3] - p[a * 3]),
        p[a * 3 + 1] + t * (p[b * 3 + 1] - p[a * 3 + 1]),
        p[a * 3 + 2] + t * (p[b * 3 + 2] - p[a * 3 + 2]),
      ]);
    }
    return key;
  };
  const link = (k1, k2) => {
    if (k1 === k2) return;
    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1).push(k2); adj.get(k2).push(k1);
  };
  const tri = (a, b, cc) => {
    const sa = val[a] > 0, sb = val[b] > 0, sc = val[cc] > 0;
    if (sa === sb && sb === sc) return;
    const e = [];
    if (sa !== sb) e.push(edgePoint(a, b));
    if (sb !== sc) e.push(edgePoint(b, cc));
    if (sc !== sa) e.push(edgePoint(cc, a));
    if (e.length === 2) link(e[0], e[1]);
  };
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < cols - 1; j++) {
      const v00 = i * cols + j, v01 = v00 + 1, v10 = v00 + cols, v11 = v10 + 1;
      tri(v00, v10, v11);
      tri(v00, v11, v01);
    }
  // chain
  const used = new Set();
  const lines = [];
  const walk = (start) => {
    const line = [pts.get(start)];
    used.add(start);
    let prev = -1, cur = start;
    for (;;) {
      const nb = adj.get(cur).filter((k) => k !== prev && !used.has(k));
      if (!nb.length) {
        // closed loop?
        if (adj.get(cur).includes(start) && line.length > 2 && prev !== start) line.push(pts.get(start));
        break;
      }
      prev = cur; cur = nb[0];
      used.add(cur); line.push(pts.get(cur));
    }
    return line;
  };
  for (const [k, nb] of adj) if (nb.length === 1 && !used.has(k)) lines.push(walk(k));
  for (const k of adj.keys()) if (!used.has(k)) lines.push(walk(k));
  return lines.filter((l) => l.length > 1);
}

/** Total polyline length helper */
export function polyLength(l) {
  let s = 0;
  for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1], l[i][2] - l[i - 1][2]);
  return s;
}
