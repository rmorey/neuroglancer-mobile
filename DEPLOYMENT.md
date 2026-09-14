# Neuroglancer Mobile — verified Nokura release

**Demo:** [Open Neuroglancer Mobile](https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-09-13-v2/index.html)

Use the explicit `index.html` URL. Nokura returns 404 for the directory URL without that filename. Initial directory-URL test failures are preserved separately in `evidence/`; the successful reports below use the correct document URL.

The default source is the requested `precomputed://https://c10s.pni.princeton.edu/mec_alignment_2025-09/alignment/img/v2`. The browser reads its original chunks directly. The release contains the static app and small synthetic validation fixtures, with no copy or modification of the MEC volume.

## Published build

| Item | Value |
| --- | --- |
| Remote prefix | `nokura:web/neuroglancer-mobile/2026-09-13-v2` |
| Upload | 2026-09-14 02:20:39 UTC / September 13, 22:20:39 EDT |
| Upstream | Neuroglancer 2.41.2, `3598da303d5eb865564a2f1f5123220a33f87e25` |
| Profile | Full default standalone browser; no datasource, key-value-store, or layer exclusions |
| Build timestamp | `2026-09-14T02:13:03.438Z` |
| Main asset | `main.78f5800ededdb4ba.js` |
| Files / bytes | 145 / 5,875,795 |
| Previous prototype | Preserved at `web/neuroglancer-mobile/2026-09-12-v1/index.html` |

The build retains upstream workers, codecs, WebAssembly, source adapters, layers, state, commands, and original controls. Three bounded upstream fixes are described in [UPSTREAM.json](UPSTREAM.json): safe state-download cleanup, rollback after invalid state restoration, and canceled-touch reset. Comparing the vendored `src/` with the pinned checkout found only those three changed files; the upstream build configuration and dependency lockfile match the pin.

`rclone copy --immutable --checksum` created the new release. `rclone check --one-way --download` found **145 matching files and zero differences**. Independent public HTTPS downloads verified **145/145 SHA-256 hashes**, sizes, and relevant JavaScript/WebAssembly MIME types. Receipts: [upload](evidence/nokura-upload.log), [download comparison](evidence/nokura-check.log), [manifest](evidence/release-manifest.json), [SHA-256 list](evidence/release-sha256.txt), [public verification](evidence/public-verification.json).

## Browser verification on Nokura

All **60 checks** below passed against the published build in Chromium 153.0.8010.12 with touch emulation and software WebGL. No suite reported an uncaught page error. The primary suite rejects unexpected HTTP/console errors; it permits three exact Zarr version-discovery 404s, retained in its report.

| Suite | Passed | Evidence |
| --- | ---: | --- |
| Main end-to-end suite | 31/31 | [Public report](evidence/full-nokura-browser-report.json) |
| Annotation editor | 8/8 | [Public report](evidence/nokura-annotation-editor-browser.json) |
| Workspace, downloads, custom layouts, multidimensional navigation | 9/9 | [Public report](evidence/nokura-workspace-index-browser.json) |
| Touch keyboard and pointer accessory | 6/6 | [Public report](evidence/nokura-touch-keyboard-browser-report.json) |
| Volume rendering and touch rotation | 6/6 | [Public report](evidence/nokura-volume-rendering-browser.json) |

Coverage includes actual visible MEC imagery; exact uint8, uint16, float32 and uint64 values; raw/compressed segmentation; offsets/truncated chunks; real sharded HTTP 206; Zarr v2/v3; meshes, skeletons and segment properties; all five remote/local annotation geometries; actual touch creation/move/delete/cancel; native layers; all nine named layouts; state URLs/JSON sharing and restoration; malformed-state recovery; saved views; downloaded PNG/JSON files; four-dimensional state; keyboard modifiers; true ray-marched volume pixels and shader alpha/gain; and 3D/oblique touch rotation.

Local verification additionally includes [four input/state unit tests](evidence/unit-tests.tap). The local browser results and failed intermediate runs remain available for provenance. Only the successful published-build reports in the table qualify this release.

Visual evidence: [live MEC phone screenshot](evidence/nokura-demo-phone.png), [landscape](evidence/full-nokura-landscape.png), [3D objects](evidence/full-nokura-objects-3d.png), [touch annotations](evidence/full-nokura-touch-annotations.png), [volume rendering](evidence/nokura-volume-red.png).

## Qualification limits

This delivers the full upstream **standalone browser engine** with a mobile interface and access to the native controls. A finite suite does not prove every source, codec, native widget, or backend on every phone. Physical iOS/Android devices were not available; WebKit could not launch because the host lacks required libraries. Browser-GPU memory limits, cellular performance, authenticated backends, and every legacy drag/keyboard interaction therefore remain unqualified. Python-server integration is a separate upstream profile. Authenticated sources still require their service configuration, credentials, permissions, CORS, and accepted origin.

See [MOBILE-FEATURES.md](MOBILE-FEATURES.md) and [PARITY_VALIDATION.md](evidence/PARITY_VALIDATION.md) for the capability map and detailed distinction between preserved features and exercised behavior.
