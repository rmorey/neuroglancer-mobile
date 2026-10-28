# Neuroglancer Mobile

A touch interface for [Neuroglancer](https://github.com/google/neuroglancer). It wraps the full standalone viewer from Seung Lab's [Spelunker](https://github.com/seung-lab/neuroglancer/tree/spelunker) branch, so every data source, layer type, shader, tool and state format still works. The mobile shell adds touch navigation, section controls, annotation tools, proofreading entry points and an on-screen keyboard.

**[Open the viewer](https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-10-28-spelunker-v4/index.html)**. Like stock Neuroglancer, it starts empty: add a layer, or open a link with a `#!` state.

## Using it

- **Navigate:** drag to pan, pinch to zoom, twist two fingers to rotate the slice. In 3D, drag to rotate. The bottom bar picks the layout and steps or plays through sections.
- **Layers:** add any Neuroglancer source and open its native tabs (source, rendering, segments, annotations).
- **Annotate:** point, line, box, ellipsoid and polyline tools, with numeric editing, properties, related segments and undo.
- **Proofread:** Workspace → Spelunker tools for Graphene merge, multicut, find path, Time controls and annotation review. These drive Spelunker's own tools and need a Graphene/CAVE source and account.
- **Workspace:** state import/export, saved views, settings, the command palette, the JSON editor and a touch keyboard for key bindings.
- **Share:** a full `#!` URL, or a CAVE short link.
- **Full controls:** shows the complete desktop Neuroglancer UI.

Feature details: [MOBILE-FEATURES.md](MOBILE-FEATURES.md) and [SPELUNKER.md](SPELUNKER.md).

## Develop

Requires Node.js ≥ 22.18.

```sh
(cd vendor/neuroglancer && npm ci)
npm ci
npm run build    # static app in dist/
npm start        # http://127.0.0.1:4174/
```

`dist/` is a self-contained static site. The host must serve `.wasm` as `application/wasm`. Data sources must allow cross-origin browser access, and Range requests where the format needs them.

## Test

```sh
npm run check:engine            # type-check the vendored engine
npm test                        # unit tests
npx playwright install chromium
npm start &                     # leave the server running
npm run test:browser            # seven Chromium suites with touch emulation
```

The browser suites use synthetic fixtures in `tests/fixtures/`, simulated Graphene/CAVE services, and one public MEC volume, which needs network access. `BASE_URL` points them at a deployed release. Reports go to `test-results/`.

The tests run in Chromium with touch emulation only. Real iOS/Android devices, Safari, and live CAVE editing are untested.

## Layout

| Path | Contents |
| --- | --- |
| `main.js`, `index.html`, `mobile.css` | Shell: boot, panels, navigation |
| `annotations.js` | Annotation tools and editor |
| `spelunker-controls.js` | Touch entry points for Spelunker proofreading tools |
| `touch-keyboard.js` | On-screen keyboard and modified clicks |
| `state.js` | Default state, legacy-link conversion, input validation |
| `vendor/neuroglancer/` | Engine source snapshot (Apache-2.0) |
| `UPSTREAM.json`, `patches/` | Engine pin, cherry-picks and local patches |
| `build.mjs`, `serve.mjs` | Build and dev server |
| `prepare-release.mjs`, `verify-public.mjs` | Release packaging and public hash checks |

## Engine

`vendor/neuroglancer/` is the Spelunker commit recorded in `UPSTREAM.json`, plus the Google Neuroglancer fixes listed there, with eight local patches already applied. Don't apply the patches again. To upgrade or contribute upstream, see [CONTRIBUTING.md](CONTRIBUTING.md).

Releases are published to Nokura; see [DEPLOYMENT.md](DEPLOYMENT.md).

Licensed under Apache-2.0; see [NOTICE](NOTICE) and [UPSTREAM-LICENSE](UPSTREAM-LICENSE).
