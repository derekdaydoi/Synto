import { test, eq, ok, throws } from './harness.js';
import { parseSceneFile, serializeScene } from '../app/src/storage.js';
import { createElement, withText } from '../app/src/elements.js';
import { sniff } from '../app/src/app.js';

test('file: round trip keeps elements and embedded files', async () => {
  const img = createElement('image', { fileId: 'f1', x: 1, y: 2, w: 3, h: 4 });
  const text = withText(createElement('text', { x: 0, y: 0 }), 'Xin chào');
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer;
  const json = await serializeScene([img, text], async (id) => (id === 'f1' ? { mime: 'image/png', name: 'a.png', bytes } : null));
  const r = parseSceneFile(json);
  eq(r.elements.length, 2);
  eq(r.files.length, 1);
  eq([...new Uint8Array(r.files[0].bytes)], [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  eq(r.elements[1].text, 'Xin chào');
});

test('file: rejects non-Synto and future versions with a clear message', () => {
  throws(() => parseSceneFile('not json'));
  throws(() => parseSceneFile('{"type":"excalidraw"}'));
  throws(() => parseSceneFile('{"type":"synto","version":99,"elements":[]}'));
});

test('file: drops elements whose file is missing or disallowed', () => {
  const r = parseSceneFile(JSON.stringify({
    type: 'synto', version: 1,
    elements: [{ type: 'image', fileId: 'missing' }, { type: 'image', fileId: 'html' }],
    files: { html: { mime: 'text/html', data: 'PGgxPg==' } },
  }));
  eq(r.elements.length, 0);
  eq(r.files.length, 0);
});

test('file: duplicate ids get regenerated', () => {
  const t = { type: 'text', id: 'same', text: 'a' };
  const r = parseSceneFile(JSON.stringify({ type: 'synto', version: 1, elements: [t, t] }));
  eq(r.elements.length, 2);
  ok(r.elements[0].id !== r.elements[1].id);
});

test('sniff: detects real types by magic bytes, ignores extension claims', () => {
  const b = (...xs) => new Uint8Array(xs).buffer;
  eq(sniff(b(0x25, 0x50, 0x44, 0x46, 0x2d), ''), 'application/pdf');
  eq(sniff(b(0x89, 0x50, 0x4e, 0x47), 'image/jpeg'), 'image/png');
  eq(sniff(b(0xff, 0xd8, 0xff, 0xe0), ''), 'image/jpeg');
  eq(sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>').buffer, ''), 'image/svg+xml');
  eq(sniff(new TextEncoder().encode('<html><script>').buffer, 'image/png'), null);
  eq(sniff(b(1, 2, 3), 'application/pdf'), null);
});
