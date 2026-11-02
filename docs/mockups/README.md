# Mockups

Artboard source copied 2026-11-01 (refreshed the same evening) from the *Pottery Tracker – Shelf*
design canvas (https://claude.ai/artifact/HuVxdT1BANh15KX2GLWmsr). Each `project/*.dc.html` is one
390×844 phone screen; the markup and inline styles carry the real tokens, type and
spacing. The `support.js` script tag and `<x-dc>` wrapper belong to the canvas runtime
and can be ignored. `canvas.json` records board order and placement.

| File | Screen | Spec | Status |
|------|--------|------|--------|
| `project/Main.dc.html` | Shelf (home) | 5.1 | Authoritative |
| `project/Piece.dc.html` | Piece detail with before/after | 5.2 | Authoritative |
| `project/Glazes.dc.html` | Glaze library | 5.3 | Authoritative |
| `project/Capture.dc.html` | Quick add: capture, then New piece details | 5.4, 5.7 | Look only for the camera half: it draws a live viewfinder, but v1 opens the native camera and shows this dark screen as post-capture review. The New piece / Update toggle at the top and the details sheet are authoritative. |
| `project/PickPiece.dc.html` | Update · Pick a piece | 5.5 | Authoritative. Review photo on top, sheet with search and in-progress list, "Not here? Save as a new piece" link, "Add to <piece>" button. |
| `project/StageStrip.dc.html` | Update · Stage strip | 5.6, 5.8 | Authoritative. Next stage pre-selected; picking the current stage saves a second photo; Glazed reveals the glaze list; optional note with a per-stage placeholder; "Save to <stage>" button. |

Differences from the spec to resolve: the mockup's pick sheet uses a single-column list with a search box, where 5.5 describes a photo grid with a New piece tile at the top. The mockup instead splits New piece and Update on the Capture screen. Treat the mockup as the current design and update 5.5 when confirmed.
