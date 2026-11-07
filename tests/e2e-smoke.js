// End-to-end smoke test, driven through real pointer events.
// Run with a throwaway profile (never your real notes):
//   dist\Synto.exe --dev app --script tests\e2e-smoke.js --data build\test-profile
// The script builds a sample page; check it visually. Errors show up as a red toast.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200 && !(window.synto && window.synto.renderer.width > 0); i++) await sleep(50);
  const app = window.synto;
  await sleep(500);
  try {
    app.clearCanvas();
    app.history.reset([]);
    Object.assign(app.state.camera, { scrollX: 0, scrollY: 0, zoom: 1 });
    const c = app.canvas;
    const ev = (type, [x, y], buttons = 1) => {
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === 'pointerup' ? 0 : buttons, pointerType: 'mouse' }));
    };
    const drag = async (a, b, steps = 10) => {
      ev('pointerdown', a);
      for (let i = 1; i <= steps; i++) { ev('pointermove', [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]); await sleep(8); }
      ev('pointerup', b);
      await sleep(30);
    };
    const click = async (p) => { ev('pointermove', p, 0); ev('pointerdown', p); ev('pointerup', p); await sleep(40); };
    const type = async (p, text) => {
      app.setTool('text');
      await click(p);
      const ta = app.textEditor;
      ta.value = text;
      ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
      app.finishTextEdit();
      await sleep(30);
    };
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    // Style changes apply to the current selection too (like Excalidraw), so deselect first
    // when only the defaults for the next element should change.
    const setStyle = app.setStyle.bind(app);
    app.setStyle = (patch) => { app.select([]); setStyle(patch); };

    // Text in both fonts.
    app.setStyle({ font: 'arial', fontSize: 36 });
    await type([140, 160], 'Ghi chú tuần 45');
    app.setStyle({ font: 'hand', fontSize: 24 });
    await type([140, 220], 'Phương trình bậc hai — Ừ, ỡ, ặ, ữ, ộ ≥ ≤ Δ');

    // Formula.
    await app.upsertMath({ point: [330, 310], latex: 'x = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}', source: '', mode: 'latex' });

    // Triangle by clicks; the last click snaps back onto the first vertex.
    app.setTool('line', { lineKind: 'polyline' });
    await click([140, 640]); await click([440, 640]); await click([290, 430]); await click([142, 638]);
    key('Enter');
    await sleep(30);

    // Median from C to the midpoint of AB (both ends snap).
    app.setStyle({ strokeColor: '#e03131', strokeStyle: 'dashed' });
    app.setTool('line', { lineKind: 'segment' });
    await drag([293, 433], [296, 636]);
    app.setStyle({ strokeColor: '#0a0a0a', strokeStyle: 'solid' });

    // Shapes from the library.
    const shape = async (id, a, b, style) => { if (style) app.setStyle(style); app.setTool('shape', { shapeId: id }); await drag(a, b); };
    await shape('hexagon', [520, 380], [660, 490], { fillColor: '#a5d8ff', fillStyle: 'hachure' });
    app.state.shapeParams.points = 5;
    await shape('star', [700, 370], [820, 490], { fillColor: '#ffec99', fillStyle: 'solid' });
    await shape('trapezoid', [520, 540], [660, 620], { fillColor: 'transparent' });
    await shape('callout', [880, 160], [1060, 260], {});
    await shape('heart', [700, 160], [800, 250], { fillColor: '#ffc9c9', fillStyle: 'cross-hatch' });
    app.setStyle({ fillColor: 'transparent' });

    // Curve through 4 points.
    app.setTool('line', { lineKind: 'curve' });
    await click([880, 430]); await click([940, 360]); await click([1000, 450]); await click([1060, 380]);
    key('Enter');

    // Arc: drag the chord, then click the bulge.
    app.setTool('line', { lineKind: 'arc' });
    await drag([880, 620], [1060, 620]);
    await click([970, 540]);

    // Arrow.
    app.setStyle({ endHead: 'arrow' });
    app.setTool('line', { lineKind: 'segment' });
    await drag([700, 560], [820, 630]);
    app.setStyle({ endHead: 'none' });

    // Pen and highlighter.
    app.setTool('pen', { penMode: 'pen' });
    ev('pointerdown', [140, 700]);
    for (let i = 0; i <= 60; i++) { ev('pointermove', [140 + i * 5, 700 + Math.sin(i / 5) * 14]); await sleep(4); }
    ev('pointerup', [440, 700]);
    app.setTool('pen', { penMode: 'highlighter' });
    await drag([136, 182], [420, 182], 20);

    // Image (generated) and a 3-page PDF (generated).
    const pc = document.createElement('canvas');
    pc.width = 320; pc.height = 200;
    const g = pc.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 320, 200);
    grad.addColorStop(0, '#1971c2'); grad.addColorStop(1, '#2f9e44');
    g.fillStyle = grad; g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#fff'; g.font = '28px Arial'; g.fillText('ảnh-bảng-trắng.png', 20, 110);
    const png = await (await new Promise((r) => pc.toBlob(r, 'image/png'))).arrayBuffer();
    await app.insertFile('anh.png', 'image/png', png, [1260, 250]);

    const makePdf = (n) => {
      const objs = [], kids = [];
      objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
      for (let i = 0; i < n; i++) {
        const p = 3 + i * 2, cc = 4 + i * 2;
        kids.push(`${p} 0 R`);
        const s = `BT /F1 40 Tf 72 700 Td (Page ${i + 1}) Tj ET 0.1 0.45 0.76 rg 72 380 300 160 re f`;
        objs[p] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${cc} 0 R /Resources << /Font << /F1 ${3 + n * 2} 0 R >> >> >>`;
        objs[cc] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
      }
      objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`;
      objs[3 + n * 2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
      let out = '%PDF-1.4\n';
      const off = [];
      for (let i = 1; i < objs.length; i++) { off[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
      const x = out.length;
      out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
      for (let i = 1; i < objs.length; i++) out += String(off[i]).padStart(10, '0') + ' 00000 n \n';
      out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
      return new TextEncoder().encode(out).buffer;
    };
    const pdf = await app.insertFile('bao-cao.pdf', 'application/pdf', makePdf(3), [1260, 580]);
    if (pdf) {
      // Annotate on the PDF.
      app.state.pdfAnnotate = true;
      app.setStyle({ strokeColor: '#e03131' });
      app.setTool('pen', { penMode: 'pen' });
      const e = app.byId(pdf.id);
      ev('pointerdown', [e.x + 60, e.y + 180]);
      for (let i = 0; i <= 30; i++) { ev('pointermove', [e.x + 60 + i * 5, e.y + 180 + Math.sin(i / 3) * 10]); await sleep(4); }
      ev('pointerup', [e.x + 210, e.y + 180]);
      app.state.pdfAnnotate = false;
      app.setStyle({ strokeColor: '#0a0a0a' });
    }

    app.setStyle = setStyle;
    // Select the hexagon to show the selection frame and handles.
    app.setTool('select');
    app.zoomToFit();
    const hex = app.elements.find((x) => x.type === 'shape' && x.shapeId === 'hexagon');
    if (hex) app.select([hex.id]);
    app.requestRender();
    const summary = `Smoke OK: ${app.elements.length} phần tử, ${app.history.past.length} bước hoàn tác`;
    app.toast(summary);
    window.__smoke = { ok: true, summary };
  } catch (err) {
    app.toast('Smoke FAILED: ' + (err && err.message), true);
    window.__smoke = { ok: false, error: String(err && err.stack) };
  }
})();
