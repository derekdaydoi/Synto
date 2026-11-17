// Small shared helpers. Keep this file dependency-free.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

let idCounter = 0;
/** Collision-resistant id: time + counter + random. */
export function newId() {
  idCounter = (idCounter + 1) % 1e6;
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return Date.now().toString(36) + idCounter.toString(36) + rnd[0].toString(36) + rnd[1].toString(36);
}

export const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647 || 1;

export function debounce(fn, ms) {
  let t = 0;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** Unicode NFC so Vietnamese diacritics from any IME or paste become precomposed. */
export const nfc = (s) => (typeof s === 'string' ? s.normalize('NFC') : '');

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Tiny DOM builder: h('div', {class: 'x', onclick: fn}, child, 'text'). */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Inline SVG icon from a 24x24 path string (stroke icon, inherits currentColor). */
export function icon(d, size = 16, extra = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  return s;
}

export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
