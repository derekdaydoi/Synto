// Library of flat shapes. Each shape is an SVG path in a 24x24 design box;
// it is stretched to the element's width/height at render time.
// `closed: false` marks shapes that are only strokes (never filled).

import { parsePath, transformPath, pathBounds, flattenPath, closedSubpaths, pathKeyPoints } from './svgpath.js';

const CIRCLE = 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0z';

export const SHAPE_GROUPS = [
  { name: 'Cơ bản', items: [
    { id: 'rect', n: 'Chữ nhật', d: 'M3 6h18v12H3z' },
    { id: 'roundrect', n: 'Bo góc', d: 'M7 6h10a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4z' },
    { id: 'square', n: 'Vuông', d: 'M5 5h14v14H5z', square: true },
    { id: 'circle', n: 'Tròn', d: CIRCLE, square: true },
    { id: 'ellipse', n: 'Elip', d: 'M3 12a9 6 0 1 0 18 0a9 6 0 1 0-18 0z' },
    { id: 'semicircle', n: 'Bán nguyệt', d: 'M3 16a9 9 0 0 1 18 0z' },
    { id: 'sector', n: 'Hình quạt', d: 'M5 19V5a14 14 0 0 1 14 14z' },
    { id: 'ring', n: 'Vành khăn', d: CIRCLE + 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0z', square: true },
    { id: 'arc', n: 'Cung tròn', d: 'M4 17A9 9 0 0 1 20 17', closed: false },
  ]},
  { name: 'Tam giác · tứ giác', items: [
    { id: 'tri-eq', n: 'T.giác đều', d: 'M12 4l9 15H3z' },
    { id: 'tri-right', n: 'T.giác vuông', d: 'M5 4v15h15z' },
    { id: 'tri-iso', n: 'T.giác cân', d: 'M12 3l6 17H6z' },
    { id: 'tri-obtuse', n: 'T.giác tù', d: 'M3 18h18L7 8z' },
    { id: 'rhombus', n: 'Thoi', d: 'M12 3l9 9-9 9-9-9z' },
    { id: 'parallelogram', n: 'Bình hành', d: 'M7 6h14l-4 12H3z' },
    { id: 'trapezoid', n: 'Thang', d: 'M7 6h10l4 12H3z' },
    { id: 'trapezoid-right', n: 'Thang vuông', d: 'M5 6h10l5 12H5z' },
    { id: 'kite', n: 'Cánh diều', d: 'M12 3l6 6-6 12-6-12z' },
  ]},
  { name: 'Đa giác · sao', items: [
    { id: 'polygon', n: 'Đa giác đều', param: 'sides' },
    { id: 'star', n: 'Ngôi sao', param: 'star' },
    { id: 'pentagon', n: 'Ngũ giác', d: 'M12 3l8.56 6.22-3.27 10.06H6.71L3.44 9.22z' },
    { id: 'hexagon', n: 'Lục giác', d: 'M7.5 4.2h9L21 12l-4.5 7.8h-9L3 12z' },
    { id: 'octagon', n: 'Bát giác', d: 'M8.56 3.69h6.88l4.87 4.87v6.88l-4.87 4.87H8.56l-4.87-4.87V8.56z' },
    { id: 'star4', n: 'Sao 4', d: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z' },
    { id: 'star6', n: 'Sao 6', d: 'M12 3l7.8 13.5H4.2zM12 21L4.2 7.5h15.6z' },
    { id: 'star8', n: 'Sao 8', d: 'M12 2l2 5 5-2-2 5 5 2-5 2 2 5-5-2-2 5-2-5-5 2 2-5-5-2 5-2-2-5 5 2z' },
    { id: 'cross', n: 'Chữ thập', d: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z' },
  ]},
  { name: 'Mũi tên', items: [
    { id: 'arrow-right', n: 'Phải', d: 'M3 9h11V5l7 7-7 7v-4H3z' },
    { id: 'arrow-up', n: 'Lên', d: 'M12 3l7 7h-4v11H9V10H5z' },
    { id: 'arrow-both', n: 'Hai chiều', d: 'M2 12l5-5v3h10V7l5 5-5 5v-3H7v3z' },
    { id: 'chevron', n: 'Chevron', d: 'M4 5h10l6 7-6 7H4l6-7z' },
    { id: 'pointer', n: 'Chỉ hướng', d: 'M3 6h13l5 6-5 6H3z' },
    { id: 'arrow-curve', n: 'Cong', d: 'M5 20C5 11 10 6 17 6M14 3l3 3-3 3', closed: false },
    { id: 'arrow-uturn', n: 'Quay đầu', d: 'M8 20V10a4 4 0 0 1 8 0v5M13 12l3 3 3-3', closed: false },
    { id: 'arrow-cycle', n: 'Vòng lặp', d: 'M19 12a7 7 0 1 1-2.05-4.95M17 3v4h-4', closed: false },
    { id: 'arrow-4', n: 'Bốn hướng', d: 'M12 2l3 3h-2v6h6V9l3 3-3 3v-2h-6v6h2l-3 3-3-3h2v-6H5v2l-3-3 3-3v2h6V5H9z' },
  ]},
  { name: 'Sơ đồ', items: [
    { id: 'fc-process', n: 'Xử lý', d: 'M3 6h18v12H3z' },
    { id: 'fc-decision', n: 'Quyết định', d: 'M12 5l9 7-9 7-9-7z' },
    { id: 'fc-terminal', n: 'Bắt đầu', d: 'M8 7h8a5 5 0 0 1 0 10H8a5 5 0 0 1 0-10z' },
    { id: 'fc-document', n: 'Tài liệu', d: 'M4 5h16v12c-4-2.5-8 2.5-16 0z' },
    { id: 'fc-data', n: 'Dữ liệu', d: 'M7 6h14l-4 12H3z' },
    { id: 'fc-database', n: 'CSDL', d: 'M5 6c0-1.4 3-2.5 7-2.5s7 1.1 7 2.5-3 2.5-7 2.5S5 7.4 5 6zM5 6v12c0 1.4 3 2.5 7 2.5s7-1.1 7-2.5V6' , closed: false },
    { id: 'fc-manual', n: 'Nhập tay', d: 'M4 9l16-4v14H4z' },
    { id: 'fc-delay', n: 'Trễ', d: 'M4 6h9a6 6 0 0 1 0 12H4z' },
    { id: 'fc-offpage', n: 'Nối trang', d: 'M5 4h14v11l-7 5-7-5z' },
  ]},
  { name: 'Chú thích', items: [
    { id: 'callout', n: 'Thoại', d: 'M4 5h16v10H10l-4 4v-4H4z' },
    { id: 'callout-round', n: 'Thoại tròn', d: 'M12 4c5 0 9 3 9 7s-4 7-9 7c-1 0-2-.1-3-.3L5 20l1-4c-2-1.5-3-3-3-5 0-4 4-7 9-7z' },
    { id: 'thought', n: 'Suy nghĩ', d: 'M8 15a4 4 0 0 1-1-7.9A5 5 0 0 1 16 6a4 4 0 0 1 2 7.5A3 3 0 0 1 14 15zM7 19a1.5 1.5 0 1 0 0.01 0z' },
    { id: 'ribbon', n: 'Ruy băng', d: 'M3 7h18l-3 5 3 5H3l3-5z' },
    { id: 'tag', n: 'Nhãn', d: 'M4 4h9l7 8-7 8H4z' },
    { id: 'brace', n: 'Ngoặc', d: 'M10 4c-3 0-3 2-3 4s0 3-3 4c3 1 3 2 3 4s0 4 3 4M14 4c3 0 3 2 3 4s0 3 3 4c-3 1-3 2-3 4s0 4-3 4', closed: false },
    { id: 'pin', n: 'Ghim', d: 'M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z' },
    { id: 'heart', n: 'Tim', d: 'M12 20C4 14 3 10 5 7c2-3 6-2 7 1 1-3 5-4 7-1 2 3 1 7-7 13z' },
    { id: 'cloud', n: 'Mây', d: 'M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A4.5 4.5 0 0 1 17 18z' },
  ]},
  { name: 'Toán · hình học', items: [
    { id: 'angle', n: 'Góc', d: 'M4 19h16M4 19L17 6M10 19a6 6 0 0 0-1.8-4.2', closed: false },
    { id: 'right-angle', n: 'Góc vuông', d: 'M5 4v15h15M5 14h5v5', closed: false },
    { id: 'axes', n: 'Trục Oxy', d: 'M5 21V3M3 19h18M5 3l-2 3M5 3l2 3M21 19l-3-2M21 19l-3 2', closed: false },
    { id: 'number-line', n: 'Trục số', d: 'M2 12h20M6 9v6M10 9v6M14 9v6M18 9v6', closed: false },
    { id: 'parallel', n: 'Song song', d: 'M4 9l16-4M4 19l16-4', closed: false },
    { id: 'perpendicular', n: 'Vuông góc', d: 'M12 4v16M4 20h16M12 16h4v4', closed: false },
    { id: 'radius', n: 'Bán kính', d: CIRCLE + 'M12 12h9', closed: false, square: true },
    { id: 'parabola', n: 'Parabol', d: 'M4 4c3 16 13 16 16 0', closed: false },
    { id: 'sine', n: 'Hình sin', d: 'M2 12c2.5-7 5-7 7.5 0s5 7 7.5 0 3-5 5-3', closed: false },
  ]},
];

export const SHAPES = new Map();
for (const g of SHAPE_GROUPS) for (const s of g.items) SHAPES.set(s.id, { closed: true, ...s, group: g.name });

export const DEFAULT_PARAMS = { sides: 6, points: 5, inner: 0.45 };

export function regularPolygonPath(sides) {
  const n = Math.max(3, Math.min(24, Math.round(sides)));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push([12 + 9 * Math.cos(a), 12 + 9 * Math.sin(a)]);
  }
  return 'M' + pts.map((p) => p[0].toFixed(3) + ' ' + p[1].toFixed(3)).join('L') + 'Z';
}

export function starPath(points, inner) {
  const n = Math.max(3, Math.min(24, Math.round(points)));
  const r2 = 9 * Math.max(0.1, Math.min(0.95, inner));
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? r2 : 9;
    pts.push([12 + r * Math.cos(a), 12 + r * Math.sin(a)]);
  }
  return 'M' + pts.map((p) => p[0].toFixed(3) + ' ' + p[1].toFixed(3)).join('L') + 'Z';
}

/** Design-box path for a shape (resolves parametric shapes). Unknown ids fall back to a rectangle. */
export function designPath(shapeId, params = {}) {
  const def = SHAPES.get(shapeId) || SHAPES.get('rect');
  if (def.param === 'sides') return regularPolygonPath(params.sides ?? DEFAULT_PARAMS.sides);
  if (def.param === 'star') return starPath(params.points ?? DEFAULT_PARAMS.points, params.inner ?? DEFAULT_PARAMS.inner);
  return def.d;
}

export const isClosedShape = (shapeId) => (SHAPES.get(shapeId) || SHAPES.get('rect')).closed !== false;

const designCache = new Map();
function parsedDesign(shapeId, params) {
  const key = shapeId + '|' + (params?.sides ?? '') + '|' + (params?.points ?? '') + '|' + (params?.inner ?? '');
  let v = designCache.get(key);
  if (!v) {
    const cmds = parsePath(designPath(shapeId, params));
    v = { cmds, bounds: pathBounds(cmds) };
    designCache.set(key, v);
    if (designCache.size > 500) designCache.delete(designCache.keys().next().value);
  }
  return v;
}

/**
 * Geometry of a shape stretched into a w x h box (local coords, origin top-left).
 * Returns {cmds, d, fillD, polylines, keyPoints, closed}.
 */
export function shapeGeometry(shapeId, params, w, h) {
  const { cmds, bounds } = parsedDesign(shapeId, params);
  const bw = Math.max(1e-6, bounds.maxX - bounds.minX), bh = Math.max(1e-6, bounds.maxY - bounds.minY);
  const sx = Math.max(w, 0.01) / bw, sy = Math.max(h, 0.01) / bh;
  const local = transformPath(cmds, sx, sy, -bounds.minX * sx, -bounds.minY * sy);
  const closed = isClosedShape(shapeId);
  return {
    cmds: local,
    fillCmds: closed ? closedSubpaths(local) : [],
    polylines: flattenPath(local, 16),
    keyPoints: pathKeyPoints(local),
    closed,
  };
}

export function shapeNeedsSquare(shapeId) {
  return !!(SHAPES.get(shapeId) || {}).square;
}
