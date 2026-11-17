// SVG path data: parse to absolute commands, transform, flatten, serialize.
// Supported: M L H V C S Q T A Z (absolute and relative).
// Output commands: {c:'M',p}, {c:'L',p}, {c:'C',c1,c2,p}, {c:'Q',c1,p}, {c:'A',rx,ry,rot,large,sweep,p}, {c:'Z'}

import { cubicAt, quadAt, boundsOfPoints } from './geometry.js';

const ARG_COUNT = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function tokenize(d) {
  const tokens = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) tokens.push(m[1] ? { cmd: m[1] } : { num: parseFloat(m[2]) });
  return tokens;
}

/** Arc flags may be written without separators ("a1 1 0 01 5 5"); split them out. */
function expandArcFlags(d) {
  return d.replace(/([Aa])([^MmLlHhVvCcSsQqTtAaZz]*)/g, (_, cmd, body) => {
    const re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
    let i = 0, m;
    // Scan argument by argument so the two flags (slots 3 and 4) become single digits.
    const out = [];
    let rest = body;
    while (rest.length) {
      rest = rest.replace(/^[\s,]+/, '');
      if (!rest) break;
      const slot = i % 7;
      if (slot === 3 || slot === 4) {
        const f = rest[0];
        if (f !== '0' && f !== '1') break;
        out.push(f);
        rest = rest.slice(1);
      } else {
        re.lastIndex = 0;
        m = re.exec(rest);
        if (!m || m.index !== 0) break;
        out.push(m[0]);
        rest = rest.slice(m[0].length);
      }
      i++;
    }
    // Anything left unparsed is kept so parsePath can report it instead of silently dropping it.
    return cmd + out.join(' ') + ' ' + rest;
  });
}

export function parsePath(d) {
  const tokens = tokenize(expandArcFlags(String(d || '')));
  const out = [];
  let i = 0, cmd = null;
  let cx = 0, cy = 0, sx = 0, sy = 0; // current point and subpath start
  let lastC2 = null, lastQ = null;
  const num = () => {
    const t = tokens[i];
    if (!t || t.num === undefined) throw new Error('Bad path data');
    i++;
    return t.num;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.cmd) { cmd = t.cmd; i++; }
    else if (!cmd) throw new Error('Path must start with a command');
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    if (up === 'Z') {
      out.push({ c: 'Z' });
      cx = sx; cy = sy; lastC2 = lastQ = null;
      cmd = null;
      continue;
    }
    if (tokens[i] === undefined || tokens[i].num === undefined) {
      if (ARG_COUNT[up] > 0) throw new Error('Missing arguments for ' + cmd);
      continue;
    }
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    switch (up) {
      case 'M': {
        cx = num() + ox; cy = num() + oy; sx = cx; sy = cy;
        out.push({ c: 'M', p: [cx, cy] });
        cmd = rel ? 'l' : 'L'; // subsequent pairs are implicit lineto
        lastC2 = lastQ = null;
        break;
      }
      case 'L': cx = num() + ox; cy = num() + oy; out.push({ c: 'L', p: [cx, cy] }); lastC2 = lastQ = null; break;
      case 'H': cx = num() + ox; out.push({ c: 'L', p: [cx, cy] }); lastC2 = lastQ = null; break;
      case 'V': cy = num() + oy; out.push({ c: 'L', p: [cx, cy] }); lastC2 = lastQ = null; break;
      case 'C': {
        const c1 = [num() + ox, num() + oy], c2 = [num() + ox, num() + oy];
        cx = num() + ox; cy = num() + oy;
        out.push({ c: 'C', c1, c2, p: [cx, cy] }); lastC2 = c2; lastQ = null;
        break;
      }
      case 'S': {
        const c1 = lastC2 ? [2 * cx - lastC2[0], 2 * cy - lastC2[1]] : [cx, cy];
        const c2 = [num() + ox, num() + oy];
        cx = num() + ox; cy = num() + oy;
        out.push({ c: 'C', c1, c2, p: [cx, cy] }); lastC2 = c2; lastQ = null;
        break;
      }
      case 'Q': {
        const c1 = [num() + ox, num() + oy];
        cx = num() + ox; cy = num() + oy;
        out.push({ c: 'Q', c1, p: [cx, cy] }); lastQ = c1; lastC2 = null;
        break;
      }
      case 'T': {
        const c1 = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
        cx = num() + ox; cy = num() + oy;
        out.push({ c: 'Q', c1, p: [cx, cy] }); lastQ = c1; lastC2 = null;
        break;
      }
      case 'A': {
        const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), large = num() ? 1 : 0, sweep = num() ? 1 : 0;
        cx = num() + ox; cy = num() + oy;
        out.push({ c: 'A', rx, ry, rot, large, sweep, p: [cx, cy] }); lastC2 = lastQ = null;
        break;
      }
      default: throw new Error('Unknown command ' + cmd);
    }
  }
  return out;
}

/** Affine map with scale (sx, sy) then translate (tx, ty). Arcs must have rot = 0 or uniform scale. */
export function transformPath(cmds, sx, sy, tx = 0, ty = 0) {
  const m = (p) => [p[0] * sx + tx, p[1] * sy + ty];
  return cmds.map((k) => {
    switch (k.c) {
      case 'M': case 'L': return { c: k.c, p: m(k.p) };
      case 'C': return { c: 'C', c1: m(k.c1), c2: m(k.c2), p: m(k.p) };
      case 'Q': return { c: 'Q', c1: m(k.c1), p: m(k.p) };
      case 'A': return { c: 'A', rx: k.rx * Math.abs(sx), ry: k.ry * Math.abs(sy), rot: k.rot, large: k.large, sweep: sx * sy < 0 ? 1 - k.sweep : k.sweep, p: m(k.p) };
      default: return { c: 'Z' };
    }
  });
}

const f = (n) => (Math.round(n * 1000) / 1000).toString();

export function pathToString(cmds) {
  return cmds.map((k) => {
    switch (k.c) {
      case 'M': case 'L': return `${k.c}${f(k.p[0])} ${f(k.p[1])}`;
      case 'C': return `C${f(k.c1[0])} ${f(k.c1[1])} ${f(k.c2[0])} ${f(k.c2[1])} ${f(k.p[0])} ${f(k.p[1])}`;
      case 'Q': return `Q${f(k.c1[0])} ${f(k.c1[1])} ${f(k.p[0])} ${f(k.p[1])}`;
      case 'A': return `A${f(k.rx)} ${f(k.ry)} ${f(k.rot)} ${k.large} ${k.sweep} ${f(k.p[0])} ${f(k.p[1])}`;
      default: return 'Z';
    }
  }).join(' ');
}

/** Endpoint arc -> center parameterization (SVG spec F.6.5). Returns sampled points (excluding start). */
function arcPoints(p0, k, segsPerRadian = 6) {
  const [x1, y1] = p0, [x2, y2] = k.p;
  let rx = k.rx, ry = k.ry;
  if (rx < 1e-9 || ry < 1e-9 || (x1 === x2 && y1 === y2)) return [[x2, y2]];
  const phi = (k.rot * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (k.large === k.sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!k.sweep && dt > 0) dt -= 2 * Math.PI;
  else if (k.sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(dt) * segsPerRadian));
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    pts.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
  pts[pts.length - 1] = [x2, y2];
  return pts;
}

/**
 * Flatten to polylines: [{points, closed}]. Curves are sampled with `steps` segments;
 * arcs with ~6 segments per radian (enough for hit testing and snapping).
 */
export function flattenPath(cmds, steps = 16) {
  const subs = [];
  let cur = null;
  let p = [0, 0];
  for (const k of cmds) {
    switch (k.c) {
      case 'M':
        cur = { points: [k.p], closed: false };
        subs.push(cur);
        p = k.p;
        break;
      case 'L':
        if (!cur) { cur = { points: [p], closed: false }; subs.push(cur); }
        cur.points.push(k.p); p = k.p;
        break;
      case 'C':
        if (!cur) { cur = { points: [p], closed: false }; subs.push(cur); }
        for (let i = 1; i <= steps; i++) cur.points.push(cubicAt(p, k.c1, k.c2, k.p, i / steps));
        p = k.p;
        break;
      case 'Q':
        if (!cur) { cur = { points: [p], closed: false }; subs.push(cur); }
        for (let i = 1; i <= steps; i++) cur.points.push(quadAt(p, k.c1, k.p, i / steps));
        p = k.p;
        break;
      case 'A':
        if (!cur) { cur = { points: [p], closed: false }; subs.push(cur); }
        cur.points.push(...arcPoints(p, k));
        p = k.p;
        break;
      case 'Z':
        if (cur) {
          cur.closed = true;
          p = cur.points[0];
          cur = null;
        }
        break;
    }
  }
  // A subpath that ends where it started is closed even without an explicit Z.
  for (const s of subs) {
    const a = s.points[0], b = s.points[s.points.length - 1];
    if (!s.closed && s.points.length > 2 && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) s.closed = true;
  }
  return subs.filter((s) => s.points.length > 0);
}

export function pathBounds(cmds) {
  const pts = [];
  for (const s of flattenPath(cmds, 12)) pts.push(...s.points);
  return boundsOfPoints(pts);
}

/** Keep only closed subpaths (used for fills so open strokes never get filled). */
export function closedSubpaths(cmds) {
  const out = [];
  let buf = [];
  for (const k of cmds) {
    if (k.c === 'M') buf = [k];
    else {
      buf.push(k);
      if (k.c === 'Z') { out.push(...buf); buf = []; }
    }
  }
  return out;
}

/** Vertices (command endpoints) and midpoints of straight segments, for snapping. */
export function pathKeyPoints(cmds) {
  const vertices = [], midpoints = [];
  let p = null, start = null;
  for (const k of cmds) {
    if (k.c === 'Z') {
      if (p && start && (p[0] !== start[0] || p[1] !== start[1])) midpoints.push([(p[0] + start[0]) / 2, (p[1] + start[1]) / 2]);
      p = start;
      continue;
    }
    if (k.c === 'L' && p) midpoints.push([(p[0] + k.p[0]) / 2, (p[1] + k.p[1]) / 2]);
    if (k.c === 'M') start = k.p;
    vertices.push(k.p);
    p = k.p;
  }
  return { vertices: dedupe(vertices), midpoints: dedupe(midpoints) };
}

function dedupe(pts) {
  const seen = new Set();
  const out = [];
  for (const q of pts) {
    const key = Math.round(q[0] * 100) + ',' + Math.round(q[1] * 100);
    if (!seen.has(key)) { seen.add(key); out.push(q); }
  }
  return out;
}
