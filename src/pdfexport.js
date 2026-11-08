// Minimal PDF writer: one page per call, holding a JPEG image of the rendered canvas.
// No dependencies; produces a standard PDF 1.4 file with a correct cross-reference table.

const enc = new TextEncoder();
const MAX_PT = 14400; // PDF page size limit (200 inches)

/**
 * Builds a single-page PDF that shows `jpeg` (bytes of a baseline JPEG, imgW x imgH px)
 * on a page of pageW x pageH points. Returns an ArrayBuffer.
 */
export function jpegToPdf(jpeg, imgW, imgH, pageW, pageH, title = 'Synto') {
  const s = Math.min(1, MAX_PT / pageW, MAX_PT / pageH);
  const pw = +(pageW * s).toFixed(2), ph = +(pageH * s).toFixed(2);
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => {
    const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(b);
    length += b.length;
  };
  const obj = (n, body, stream) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  // The second line holds non-ASCII bytes so transfer tools treat the file as binary.
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  obj(5, `<< /Length ${content.length} >>`, enc.encode(content));
  obj(6, `<< /Producer (Synto) /Title (${pdfString(title)}) >>`);
  const xref = length;
  let table = `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(table);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

/** Escapes a string for a PDF literal; non-ASCII becomes '?' (titles are metadata only). */
function pdfString(s) {
  return String(s).replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1').slice(0, 200);
}

/** Renders a canvas into a PDF (JPEG on white). cssW/cssH: page size in CSS px (96 dpi). */
export async function canvasToPdf(canvas, cssW, cssH, title) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) throw new Error('Không tạo được ảnh để xuất PDF.');
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  return jpegToPdf(jpeg, canvas.width, canvas.height, cssW * 0.75, cssH * 0.75, title);
}
