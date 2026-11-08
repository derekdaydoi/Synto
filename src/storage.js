// Persistence: IndexedDB autosave (scene + binary files), .synto import/export,
// and the bridge to the native host (save/open dialogs) with browser fallbacks.

import { sanitizeElement } from './elements.js';
import { arrayBufferToBase64, base64ToArrayBuffer, newId } from './util.js';

const DB_NAME = 'synto';
const DB_VERSION = 1;
export const FILE_FORMAT = 'synto';
export const FORMAT_VERSION = 1;
export const MAX_FILE_BYTES = 80 * 1024 * 1024; // refuse absurd inputs instead of freezing

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const saveScene = (scene) => tx('kv', 'readwrite', (s) => s.put(scene, 'scene'));
export const loadScene = () => tx('kv', 'readonly', (s) => reqP(s.get('scene')));

/** files: {id, mime, name, bytes: ArrayBuffer} */
export const putFile = (file) => tx('files', 'readwrite', (s) => s.put(file));
export const getFile = (id) => tx('files', 'readonly', (s) => reqP(s.get(id)));
export const allFileIds = () => tx('files', 'readonly', (s) => reqP(s.getAllKeys()));
export const deleteFile = (id) => tx('files', 'readwrite', (s) => s.delete(id));

/** Removes stored files no element references (call after the scene is saved). */
export async function collectGarbage(elements) {
  const used = new Set(elements.map((e) => e.fileId).filter(Boolean));
  for (const id of await allFileIds()) if (!used.has(id)) await deleteFile(id);
}

// ---------- .synto file format ----------

export async function serializeScene(elements, getFileRecord) {
  const files = {};
  for (const el of elements) {
    if (el.fileId && !files[el.fileId]) {
      const f = await getFileRecord(el.fileId);
      if (f) files[el.fileId] = { mime: f.mime, name: f.name || '', data: arrayBufferToBase64(f.bytes) };
    }
  }
  return JSON.stringify({ type: FILE_FORMAT, version: FORMAT_VERSION, app: 'Synto', elements, files });
}

/**
 * Parses and validates a .synto document. Returns {elements, files: [{id, mime, name, bytes}]}.
 * Throws an Error with a user-facing Vietnamese message on invalid input.
 */
export function parseSceneFile(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE_BYTES * 1.4) throw new Error('File quá lớn hoặc không đọc được.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('File không phải định dạng Synto (JSON lỗi).'); }
  if (!data || data.type !== FILE_FORMAT) throw new Error('File không phải định dạng Synto.');
  if (typeof data.version !== 'number' || data.version > FORMAT_VERSION) throw new Error('File được tạo bởi phiên bản Synto mới hơn.');
  const files = [];
  const fileIds = new Set();
  if (data.files && typeof data.files === 'object') {
    for (const [id, f] of Object.entries(data.files)) {
      if (typeof id !== 'string' || id.length > 64 || !f || typeof f.data !== 'string') continue;
      if (!/^(image\/(png|jpeg|gif|webp|svg\+xml)|application\/pdf)$/.test(f.mime)) continue;
      try {
        files.push({ id, mime: f.mime, name: typeof f.name === 'string' ? f.name.slice(0, 260) : '', bytes: base64ToArrayBuffer(f.data) });
        fileIds.add(id);
      } catch { /* skip corrupt file */ }
    }
  }
  const seen = new Set();
  const elements = [];
  for (const raw of Array.isArray(data.elements) ? data.elements.slice(0, 100000) : []) {
    const el = sanitizeElement(raw);
    if (!el) continue;
    if (el.fileId && !fileIds.has(el.fileId)) continue; // drop elements whose file is missing
    if (seen.has(el.id)) el.id = newId();
    seen.add(el.id);
    elements.push(el);
  }
  return { elements, files };
}

// ---------- native host bridge ----------

const host = window.chrome && window.chrome.webview ? window.chrome.webview : null;
const pending = new Map();
if (host) {
  host.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg && msg.requestId && pending.has(msg.requestId)) {
      pending.get(msg.requestId)(msg);
      pending.delete(msg.requestId);
    }
  });
}

function callHost(payload) {
  return new Promise((resolve) => {
    const requestId = newId();
    pending.set(requestId, resolve);
    host.postMessage({ ...payload, requestId });
  });
}

export const hasHost = () => !!host;

/** Save bytes via native dialog (host) or a browser download. Returns {ok, name?, cancelled?, error?}. */
export async function saveBytes(suggestedName, mime, bytes, filterName, extension) {
  if (host) {
    const r = await callHost({ type: 'saveFile', name: suggestedName, mime, filterName, extension, base64: arrayBufferToBase64(bytes) });
    return r.ok ? { ok: true, name: r.name } : { ok: false, cancelled: !!r.cancelled, error: r.error };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = suggestedName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { ok: true, name: suggestedName };
}

/** Open a file via native dialog (host) or <input type=file>. Resolves {name, mime, bytes} or null. */
export async function openFile(accept, filterName, extensions) {
  if (host) {
    const r = await callHost({ type: 'openFile', filterName, extensions });
    if (!r.ok) {
      if (r.error) throw new Error(r.error);
      return null;
    }
    return { name: r.name, mime: r.mime || '', bytes: base64ToArrayBuffer(r.base64) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files && input.files[0];
      resolve(f ? { name: f.name, mime: f.type, bytes: await f.arrayBuffer() } : null);
    };
    input.click();
  });
}

/** Open a web link in the user's browser (the desktop host only allows github.com links). */
export function openExternal(url) {
  if (!/^https:\/\/github\.com\//.test(url)) return;
  if (host) host.postMessage({ type: 'openExternal', url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export function setHostTitle(title) {
  if (host) host.postMessage({ type: 'title', title });
}
