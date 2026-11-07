// Minimal in-browser test runner. Open tests/index.html via scripts/serve.ps1.
import { tests } from './harness.js';
import './geometry.test.js';
import './svgpath.test.js';
import './shapes.test.js';
import './text.test.js';
import './elements.test.js';
import './snapping.test.js';
import './transform.test.js';
import './storage.test.js';
import './mindmap.test.js';

const out = document.getElementById('out');
let pass = 0, fail = 0;
const failures = [];
for (const t of tests) {
  try {
    await t.fn();
    pass++;
    out.insertAdjacentHTML('beforeend', `<div class="pass">✓ ${t.name}</div>`);
  } catch (e) {
    fail++;
    failures.push(t.name + ': ' + (e && e.message));
    const div = document.createElement('div');
    div.className = 'fail';
    div.textContent = `✗ ${t.name} — ${e && e.message}`;
    out.appendChild(div);
  }
}
const summary = document.getElementById('summary');
summary.textContent = `${fail ? 'THẤT BẠI' : 'ĐẠT'}: ${pass} đạt, ${fail} lỗi, tổng ${tests.length}`;
summary.className = fail ? 'fail' : 'pass';
window.__testResult = { pass, fail, failures };
