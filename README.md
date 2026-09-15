# Neuroglancer Mobile

A mobile interface around the full Spelunker standalone Neuroglancer engine, pinned to Seung Lab's `spelunker` commit `d4aeac3b66eb4bd3fa86dbdc0202a7f006439740` (package version 2.41.2). This implementation uses its rendering, data sources, workers, codecs, layers, annotations, tools, authentication, and state serialization.

**[Open the Spelunker Mobile demo](https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-09-15-spelunker-v3/index.html)** · [Verified release](DEPLOYMENT.md) · [Spelunker support](SPELUNKER.md)

This is an independent repository for the mobile interface, with a vendored Spelunker engine. It is not an official Google or Seung Lab release. The exact source pin, original license, and compatibility patches are retained so engine updates and potential upstream contributions can be reviewed separately. See [CONTRIBUTING.md](CONTRIBUTING.md).

The default volume is `precomputed://https://c10s.pni.princeton.edu/mec_alignment_2025-09/alignment/img/v2`. Data requests go directly from the browser to the source. No dataset conversion, proxy, or copy is needed.

## Use

- Drag a slice with one finger to pan; pinch to zoom; rotate two fingers for oblique sections. Drag the 3D view to rotate.
- Choose XY, XZ, YZ, 3D, four panels, or a combined view. The section controls and coordinate fields operate on native coordinates.
- **Layers** adds any upstream source, controls visibility/order/opacity, and opens the full native source, rendering, segmentation, and schema tabs. Segment IDs stay exact through the full uint64 range.
- **Annotate** provides point, line, box, ellipsoid, and polyline tools, numerical editing, descriptions, properties, related segments, move/delete, undo/redo, and JSON transfer. Choosing a tool leaves the canvas available; a compact toolbar provides Finish, Undo, and Cancel.
- **Workspace** exposes state import/export, saved views, settings, selection details, the command palette, and the original state editor. **Share** produces native Neuroglancer URLs.
- **Full controls** reveals the complete original interface. Native custom layouts, transforms, multidimensional data, shaders, mesh/skeleton controls, tool palettes, and datasource-specific operations remain available. Workspace also offers a touch keyboard with modifier keys, custom key codes, and primary/right-click actions at the selected viewer point.

- **Workspace → Spelunker tools** provides touch entry points for Graphene merge, split/multicut, find path, and annotation review. Native Graph controls include historical Time and timestamp locks. The segment color picker and Spelunker's M/C/F and bracket shortcuts are enabled.
- **Create CAVE short link** saves the complete workspace to Spelunker's configured state service. Ordinary Share retains a full URL without a server upload. Legacy Spelunker tags, shaders, tool bindings, and timestamps are migrated when loading state; short links retain this app's page path.

Local annotations and saved views remain in viewer state or browser storage until exported/shared. Remote writes use the native backend's capabilities and permissions. The included MEC source is imagery; it does not supply a proofreading backend. Full engine inclusion is separate from verification on a particular service or physical mobile device. See [Spelunker support](SPELUNKER.md).

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

Compatibility fixes are recorded in [UPSTREAM.json](UPSTREAM.json) and [patches](patches/), including download cleanup, state rollback, canceled-touch reset, embedding setup, and short-link path preservation. The vendored source already includes those patches. Do not apply them twice. Apache-2.0 license and notices remain in the vendor tree and built app.

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
