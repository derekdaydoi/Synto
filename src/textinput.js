// Text helpers: symbol auto-replace while typing, backslash commands, and the "quick math" syntax.

/** Replacements applied when the typed text ends with the key. Longest keys are checked first. */
export const AUTO_REPLACE = [
  ['<=>', '⇔'], ['≤>', '⇔'],
  ['>=', '≥'], ['<=', '≤'], ['!=', '≠'], ['~=', '≈'], ['+-', '±'],
  ['->', '→'], ['=>', '⇒'], ['^2', '²'], ['^3', '³'],
];

/** Backslash words: typing "\delta" then a space or punctuation inserts the symbol. */
export const SYMBOL_WORDS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ',
  pi: 'π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ', phi: 'φ', Phi: 'Φ', omega: 'ω', Omega: 'Ω', xi: 'ξ', eta: 'η',
  infty: '∞', inf: '∞', sqrt: '√', sum: '∑', prod: '∏', int: '∫', partial: '∂', nabla: '∇', pm: '±', times: '×', div: '÷',
  cdot: '·', le: '≤', ge: '≥', ne: '≠', approx: '≈', equiv: '≡', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
  cup: '∪', cap: '∩', empty: '∅', forall: '∀', exists: '∃', neg: '¬', and: '∧', or: '∨', implies: '⇒', iff: '⇔',
  therefore: '∴', because: '∵', angle: '∠', triangle: '△', perp: '⊥', parallel: '∥', deg: '°', to: '→',
  N: 'ℕ', Z: 'ℤ', Q: 'ℚ', R: 'ℝ', C: 'ℂ',
};

/**
 * Given the text before the caret, returns {remove, insert} for a replacement to apply, or null.
 * `remove` = number of characters to delete before the caret.
 */
export function findReplacement(before) {
  // Backslash command terminated by a space or punctuation: "\delta " -> "Δ "
  const m = /\\([A-Za-z]+)([\s.,;:!?)\]}])$/.exec(before);
  if (m && Object.prototype.hasOwnProperty.call(SYMBOL_WORDS, m[1])) {
    return { remove: m[0].length, insert: SYMBOL_WORDS[m[1]] + m[2] };
  }
  for (const [key, val] of AUTO_REPLACE) {
    if (before.endsWith(key)) return { remove: key.length, insert: val };
  }
  return null;
}

/**
 * Applies a replacement to a textarea at the caret, keeping the browser's native undo stack
 * (execCommand insertText). Returns true when something was replaced.
 */
export function applyAutoReplace(textarea) {
  if (textarea.selectionStart !== textarea.selectionEnd) return false;
  const pos = textarea.selectionStart;
  const r = findReplacement(textarea.value.slice(0, pos));
  if (!r) return false;
  textarea.setSelectionRange(pos - r.remove, pos);
  const ok = document.execCommand && document.execCommand('insertText', false, r.insert);
  if (!ok) {
    textarea.setRangeText(r.insert, pos - r.remove, pos, 'end');
  }
  return true;
}

// ---------- quick math -> LaTeX ----------

const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'Delta', 'epsilon', 'theta', 'Theta', 'lambda', 'Lambda', 'mu', 'pi', 'Pi',
  'rho', 'sigma', 'Sigma', 'tau', 'phi', 'Phi', 'omega', 'Omega', 'xi', 'eta', 'nu', 'kappa', 'psi', 'Psi', 'chi', 'zeta', 'Gamma'];
const FUNCS = ['sin', 'cos', 'tan', 'cot', 'log', 'ln', 'exp', 'lim', 'max', 'min'];

/**
 * Converts friendly input into LaTeX. Rules:
 *  sqrt(x) -> \sqrt{x}; a/b -> \frac{a}{b} where a, b are numbers, words or (groups);
 *  +- -> \pm, >= -> \ge, <= -> \le, != -> \ne, -> -> \to, => -> \Rightarrow, * -> \cdot,
 *  greek names and inf/infinity -> commands; sin/cos/... -> \sin. Input that already contains
 *  a backslash command is left mostly untouched (users can mix LaTeX in).
 */
export function quickToLatex(input) {
  let s = String(input || '').normalize('NFC');
  // Operators first (longest first).
  const ops = [['<=>', '\\Leftrightarrow '], ['=>', '\\Rightarrow '], ['->', '\\to '], ['>=', '\\ge '], ['<=', '\\le '],
    ['!=', '\\ne '], ['+-', '\\pm '], ['~=', '\\approx '], ['*', '\\cdot '],
    ['≥', '\\ge '], ['≤', '\\le '], ['≠', '\\ne '], ['±', '\\pm '], ['→', '\\to '], ['⇒', '\\Rightarrow '], ['∞', '\\infty '], ['Δ', '\\Delta ']];
  // Words: replace whole identifiers that are not already part of a \command.
  s = s.replace(/(\\?)([A-Za-z]+)/g, (all, bs, word) => {
    if (bs) return all;
    if (GREEK.includes(word)) return '\\' + word + ' ';
    if (word === 'inf' || word === 'infinity') return '\\infty ';
    if (FUNCS.includes(word)) return '\\' + word + ' ';
    return all;
  });
  for (const [k, v] of ops) s = s.split(k).join(v);
  s = convertSqrt(s);
  s = convertFractions(s);
  return s.replace(/\s+/g, ' ').trim();
}

/** Finds the matching closing paren index for the '(' at i, or -1. */
function matchParen(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

function convertSqrt(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('sqrt(', i) && s[i - 1] !== '\\') {
      const open = i + 4;
      const close = matchParen(s, open);
      if (close < 0) { out += s.slice(i); break; }
      out += '\\sqrt{' + convertSqrt(s.slice(open + 1, close)) + '}';
      i = close + 1;
    } else {
      out += s[i++];
    }
  }
  return out;
}

/** Splits into operand tokens around '/', handling (groups), {groups}, numbers, words, \commands. */
function convertFractions(s) {
  // Recursively handle inside parentheses first.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') {
      const close = matchParen(s, i);
      if (close < 0) { out += s.slice(i); break; }
      out += '(' + convertFractions(s.slice(i + 1, close)) + ')';
      i = close;
    } else out += s[i];
  }
  s = out;
  // Now process a/b at this level.
  for (let guard = 0; guard < 50; guard++) {
    const slash = findTopLevelSlash(s);
    if (slash < 0) break;
    const left = operandBefore(s, slash);
    const right = operandAfter(s, slash);
    if (!left || !right) break;
    const strip = (t) => (t.startsWith('(') && t.endsWith(')') && matchParen(t, 0) === t.length - 1 ? t.slice(1, -1) : t);
    s = s.slice(0, left.start) + '\\frac{' + strip(left.text).trim() + '}{' + strip(right.text).trim() + '}' + s.slice(right.end);
  }
  return s;
}

function findTopLevelSlash(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '{') depth++;
    else if (c === ')' || c === '}') depth--;
    else if (c === '/' && depth === 0) return i;
  }
  return -1;
}

function operandBefore(s, i) {
  let j = i - 1;
  while (j >= 0 && s[j] === ' ') j--;
  if (j < 0) return null;
  const end = j + 1;
  if (s[j] === ')' || s[j] === '}') {
    const open = s[j] === ')' ? '(' : '{', close = s[j];
    let depth = 0;
    for (; j >= 0; j--) {
      if (s[j] === close) depth++;
      else if (s[j] === open) { depth--; if (depth === 0) break; }
    }
    if (j < 0) return null;
    // Include a preceding \command (e.g. \sqrt{...}).
    let k = j - 1;
    while (k >= 0 && /[A-Za-z]/.test(s[k])) k--;
    if (k >= 0 && s[k] === '\\') j = k;
    return { start: j, text: s.slice(j, end) };
  }
  let k = j;
  while (k >= 0 && /[A-Za-z0-9.^_²³']/.test(s[k])) k--;
  if (k >= 0 && s[k] === '\\') k--;
  const start = k + 1;
  if (start === end) return null;
  return { start, text: s.slice(start, end) };
}

function operandAfter(s, i) {
  let j = i + 1;
  while (j < s.length && s[j] === ' ') j++;
  if (j >= s.length) return null;
  const start = j;
  if (s[j] === '(' ) {
    const close = matchParen(s, j);
    if (close < 0) return null;
    return { end: close + 1, text: s.slice(start, close + 1) };
  }
  if (s[j] === '\\') {
    j++;
    while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
    if (s[j] === '{') {
      let depth = 0;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) { j++; break; } }
      }
    }
    return { end: j, text: s.slice(start, j) };
  }
  while (j < s.length && /[A-Za-z0-9.^_²³']/.test(s[j])) j++;
  if (j === start) return null;
  return { end: j, text: s.slice(start, j) };
}
