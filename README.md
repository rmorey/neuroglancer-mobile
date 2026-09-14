# Neuroglancer Mobile

A mobile interface around the full upstream standalone Neuroglancer engine, pinned to 2.41.2 (`3598da303d5eb865564a2f1f5123220a33f87e25`). This implementation uses upstream rendering, data sources, workers, codecs, layers, annotations, tools, and state serialization.

**[Open the Nokura demo](https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-09-13-v2/index.html)** · [Verified release](DEPLOYMENT.md) · [Coverage and remaining gaps](MOBILE-FEATURES.md)

This is an independent repository for the mobile interface, with a vendored upstream engine. It is not a GitHub fork of `google/neuroglancer` or an official Google release. The source pin, original license, and three small upstream patches are retained so engine updates and potential upstream contributions can be reviewed separately. See [CONTRIBUTING.md](CONTRIBUTING.md).

The default volume is `precomputed://https://c10s.pni.princeton.edu/mec_alignment_2025-09/alignment/img/v2`. Data requests go directly from the browser to the source. No dataset conversion, proxy, or copy is needed.

## Use

- Drag a slice with one finger to pan; pinch to zoom; rotate two fingers for oblique sections. Drag the 3D view to rotate.
- Choose XY, XZ, YZ, 3D, four panels, or a combined view. The section controls and coordinate fields operate on native coordinates.
- **Layers** adds any upstream source, controls visibility/order/opacity, and opens the full native source, rendering, segmentation, and schema tabs. Segment IDs stay exact through the full uint64 range.
- **Annotate** provides point, line, box, ellipsoid, and polyline tools, numerical editing, descriptions, properties, related segments, move/delete, undo/redo, and JSON transfer. Choosing a tool leaves the canvas available; a compact toolbar provides Finish, Undo, and Cancel.
- **Workspace** exposes state import/export, saved views, settings, selection details, the command palette, and the original state editor. **Share** produces native Neuroglancer URLs.
- **Full controls** reveals the complete original interface. Native custom layouts, transforms, multidimensional data, shaders, mesh/skeleton controls, tool palettes, and datasource-specific operations remain available. Workspace also offers a touch keyboard with modifier keys, custom key codes, and primary/right-click actions at the selected viewer point.

Local annotations and saved views remain in viewer state or browser storage until exported/shared. Remote writes use the native backend's capabilities and permissions.

## Reproduce

Requires Node.js 22.18 or newer. Upstream dependencies and browser tests have committed lockfiles.

```sh
cd neuroglancer-mobile
(cd vendor/neuroglancer && npm ci --no-audit --no-fund)
npm ci --no-audit --no-fund
npm run build
npm start
```

Open `http://127.0.0.1:4174/`. `dist/` is the complete static app. Serve `.wasm` as `application/wasm`, `.js` as JavaScript, and keep all relative assets together. Datasources must permit browser access and Range requests where their format requires it.

The repository includes the engine source and application assets. Dependencies, generated bundles, and local browser profiles are excluded from Git. A fresh clone does not require a submodule checkout or files from the original development workspace.

The three narrowly scoped upstream fixes are recorded in [UPSTREAM.json](UPSTREAM.json) and [patches](patches/): safe state-download cleanup, failed URL-state rollback, and canceled-touch reset. The vendored source already includes those patches. Do not apply them twice. Apache-2.0 license and notices remain in the vendor tree and built app.

## Verify

```sh
npm test
npx playwright install chromium
npm start
# In another terminal:
npm run test:browser
```

Browser scripts accept `BASE_URL`, `FIXTURE_BASE_URL`, and an optional `PLAYWRIGHT_MODULE` path. `AGENT_BROWSER_EXECUTABLE_PATH` selects an existing Chromium binary. New reports and screenshots go to ignored `test-results/`; `EVIDENCE_DIR` overrides that directory. Synthetic fixtures are committed in `tests/fixtures`; `tests/generate-parity-fixtures.mjs` regenerates them using the pinned upstream codec implementation. The local server exposes them at `/fixtures/` and supports byte ranges. The full browser suite also accesses the public MEC test volume and therefore requires network access.

Evidence includes JSON test reports, screenshots of actual rendered content, exact sample values, HTTP Range checks, release hashes, and public deployment checks. See [MOBILE-FEATURES.md](MOBILE-FEATURES.md) for the capability map and [DEPLOYMENT.md](DEPLOYMENT.md) for the release receipt.

The qualification target is the full standalone browser build. Python-server integration is a separate upstream deployment profile. Authenticated backends still need their credentials and accepted browser origin. Browser emulation does not establish physical iOS/Android compatibility or device memory/performance limits; the available host cannot launch WebKit because required system libraries are absent.
