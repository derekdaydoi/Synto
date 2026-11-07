export const tests = [];
export const test = (name, fn) => tests.push({ name, fn });

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

export function ok(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

export function near(actual, expected, eps = 1e-6, msg = '') {
  if (!(Math.abs(actual - expected) <= eps)) throw new Error(`${msg} expected ≈${expected}, got ${actual}`);
}

export function nearPt(a, b, eps = 1e-6, msg = '') {
  near(a[0], b[0], eps, msg + ' x');
  near(a[1], b[1], eps, msg + ' y');
}

export function throws(fn, msg = 'expected to throw') {
  try { fn(); } catch { return; }
  throw new Error(msg);
}
