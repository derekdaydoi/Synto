# Third-party notices

Synto bundles the following open-source components. Exact versions and SHA-256 hashes are pinned in
`scripts/fetch-deps.ps1`; each component's license file is copied next to it under `app/vendor/`.

| Component | Version | License | Used for |
|---|---|---|---|
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.19.1 | MIT | Formula layout and fonts |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 6.4.299 | Apache-2.0 | Reading and rendering PDF pages (includes OpenJPEG, JBIG2 and QCMS decoders, see `app/vendor/pdfjs/wasm/LICENSE_*`) |
| [Rough.js](https://github.com/rough-stuff/rough) | 4.6.6 | MIT | Hand-drawn strokes and fills |
| [perfect-freehand](https://github.com/steveruizok/perfect-freehand) | 1.2.3 | MIT | Pen and highlighter strokes |
| [Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand) | Google Fonts | SIL Open Font License 1.1 | Handwriting font |
| [Microsoft.Web.WebView2](https://www.nuget.org/packages/Microsoft.Web.WebView2) | 1.0.4314.35 | Microsoft (BSD-style, see package `LICENSE.txt`) | Desktop host (embedded in `Synto.exe`) |

The UI layout follows [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT); no Excalidraw code
or assets are included.

Arial is not bundled: the app uses the Arial installed with Windows, falling back to Arimo / Liberation
Sans when present.
