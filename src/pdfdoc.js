// PDF support via pdf.js: open documents from stored bytes, read page sizes,
// and render pages to bitmaps on demand with a small LRU cache and one render at a time.

import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

const VENDOR = new URL('../vendor/pdfjs/', import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', VENDOR).href;

const docs = new Map(); // fileId -> Promise<PDFDocumentProxy>
const bitmaps = new Map(); // key -> {canvas, scale}
const MAX_BITMAPS = 48;
const queue = [];
let busy = false;
let onPageReady = () => {};

export function setPageReadyCallback(fn) { onPageReady = fn; }

export function openDocument(fileId, bytes) {
  if (!docs.has(fileId)) {
    // pdf.js transfers (detaches) the buffer it is given, so always pass a copy.
    const data = new Uint8Array(bytes.slice(0));
    const p = pdfjs.getDocument({
      data,
      cMapUrl: new URL('cmaps/', VENDOR).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', VENDOR).href,
      wasmUrl: new URL('wasm/', VENDOR).href,
      iccUrl: new URL('iccs/', VENDOR).href,
      isEvalSupported: false,
      enableXfa: false,
    }).promise;
    p.catch(() => docs.delete(fileId));
    docs.set(fileId, p);
  }
  return docs.get(fileId);
}

/** Page sizes in PDF points, [[w, h], ...]. */
export async function readPageSizes(fileId, bytes) {
  const doc = await openDocument(fileId, bytes);
  const sizes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push([vp.width, vp.height]);
  }
  return sizes;
}

/** Scale buckets keep re-renders rare while zooming: 0.5, 1, 1.5, 2, 3, 4. */
export function bucketScale(s) {
  const steps = [0.5, 1, 1.5, 2, 3, 4];
  for (const b of steps) if (s <= b) return b;
  return steps[steps.length - 1];
}

/**
 * Returns a rendered canvas for (fileId, pageIndex) at the requested bucket, or the best
 * lower-resolution version already cached while a sharper one renders in the background.
 */
export function getPageBitmap(fileId, pageIndex, pixelsPerPoint, getBytes) {
  const bucket = bucketScale(pixelsPerPoint);
  const key = `${fileId}:${pageIndex}:${bucket}`;
  const hit = bitmaps.get(key);
  if (hit) {
    bitmaps.delete(key); bitmaps.set(key, hit); // LRU touch
    return hit.canvas;
  }
  if (!queue.some((q) => q.key === key)) {
    queue.push({ key, fileId, pageIndex, bucket, getBytes });
    pump();
  }
  let fallback = null;
  for (const [k, v] of bitmaps) if (k.startsWith(`${fileId}:${pageIndex}:`)) fallback = v.canvas;
  return fallback;
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      // Newest request first: it is most likely what is on screen now.
      const job = queue.pop();
      if (bitmaps.has(job.key)) continue;
      try {
        const bytes = await job.getBytes(job.fileId);
        if (!bytes) continue;
        const doc = await openDocument(job.fileId, bytes);
        if (job.pageIndex >= doc.numPages) continue;
        const page = await doc.getPage(job.pageIndex + 1);
        const vp = page.getViewport({ scale: job.bucket });
        const canvas = document.createElement('canvas');
        // Cap the bitmap size so huge pages cannot exhaust memory.
        const cap = Math.min(1, 4096 / Math.max(vp.width, vp.height));
        const vpc = cap < 1 ? page.getViewport({ scale: job.bucket * cap }) : vp;
        canvas.width = Math.max(1, Math.floor(vpc.width));
        canvas.height = Math.max(1, Math.floor(vpc.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vpc }).promise;
        bitmaps.set(job.key, { canvas });
        while (bitmaps.size > MAX_BITMAPS) bitmaps.delete(bitmaps.keys().next().value);
        onPageReady();
      } catch (e) {
        console.warn('PDF render failed', e);
      }
      if (queue.length > 24) queue.splice(0, queue.length - 24); // drop stale requests
    }
  } finally {
    busy = false;
  }
}

export function forgetDocument(fileId) {
  const p = docs.get(fileId);
  if (p) p.then((d) => d.destroy()).catch(() => {});
  docs.delete(fileId);
  for (const k of [...bitmaps.keys()]) if (k.startsWith(fileId + ':')) bitmaps.delete(k);
}
