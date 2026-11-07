import { test, eq, ok } from './harness.js';
import { findReplacement, quickToLatex } from '../app/src/textinput.js';
import { nfc } from '../app/src/util.js';
import { katexHtml } from '../app/src/mathrender.js';

test('text: NFC composes Vietnamese decomposed input', () => {
  const decomposed = 'Tiếng Việt';
  eq(nfc(decomposed), 'Tiếng Việt');
  eq(nfc(decomposed).length, 10);
});

test('text: auto-replace operators at the caret', () => {
  eq(findReplacement('x >='), { remove: 2, insert: '≥' });
  eq(findReplacement('a <='), { remove: 2, insert: '≤' });
  eq(findReplacement('a !='), { remove: 2, insert: '≠' });
  eq(findReplacement('a ->'), { remove: 2, insert: '→' });
  eq(findReplacement('p =>'), { remove: 2, insert: '⇒' });
  eq(findReplacement('x^2'), { remove: 2, insert: '²' });
  eq(findReplacement('a +-'), { remove: 2, insert: '±' });
});

test('text: <=> becomes ⇔ even after <= was already replaced', () => {
  eq(findReplacement('p ≤>'), { remove: 2, insert: '⇔' });
});

test('text: backslash words need a terminator and a known name', () => {
  eq(findReplacement('\\delta '), { remove: 7, insert: 'δ ' });
  eq(findReplacement('\\Delta,'), { remove: 7, insert: 'Δ,' });
  eq(findReplacement('\\delta'), null, 'no terminator yet');
  eq(findReplacement('\\notaword '), null);
  eq(findReplacement('\\constructor '), null, 'no prototype keys');
});

test('text: plain text is left alone', () => {
  eq(findReplacement('Xin chào'), null);
  eq(findReplacement('a - b'), null);
  eq(findReplacement('x < -5'), null);
});

test('quick math: fractions, roots, greek, operators', () => {
  eq(quickToLatex('a/b'), '\\frac{a}{b}');
  eq(quickToLatex('(a+b)/(c-d)'), '\\frac{a+b}{c-d}');
  eq(quickToLatex('sqrt(x+1)'), '\\sqrt{x+1}');
  eq(quickToLatex('x = (-b +- sqrt(delta)) / 2a'), 'x = \\frac{-b \\pm \\sqrt{\\delta }}{2a}');
  eq(quickToLatex('x >= 2'), 'x \\ge 2');
  eq(quickToLatex('Delta = b^2 - 4ac'), '\\Delta = b^2 - 4ac');
  eq(quickToLatex('sin x'), '\\sin x');
});

test('quick math: existing LaTeX commands are not double-escaped', () => {
  eq(quickToLatex('\\alpha + beta'), '\\alpha + \\beta');
  eq(quickToLatex('\\frac{1}{2}'), '\\frac{1}{2}');
});

test('quick math: unbalanced input does not throw or loop', () => {
  for (const s of ['sqrt(', '(((a/', 'a/', '/b', ')/(', 'a//b']) quickToLatex(s);
  ok(true);
});

test('quick math: every output renders with KaTeX', () => {
  for (const s of ['a/b', 'x = (-b +- sqrt(delta)) / 2a', 'x^2/2 + y_1', 'sin(x)/cos(x)', 'lim x -> 0', 'a != b => c']) {
    const r = katexHtml(quickToLatex(s));
    eq(r.error, null, s);
  }
});
