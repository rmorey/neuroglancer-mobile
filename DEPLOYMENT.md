# Deployment

Releases are immutable, dated directories on Nokura under `nokura:web/neuroglancer-mobile/`, served publicly from `https://c10s.pni.princeton.edu/web/neuroglancer-mobile/`. Always link the explicit `index.html`; the directory URL returns 404.

## Current release

**[2026-10-28-spelunker-v4](https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-10-28-spelunker-v4/index.html)**

| | |
| --- | --- |
| App version | 1.2.0 |
| Engine | Spelunker `48b879ce` + Google fixes through `c8c4d139` (see `UPSTREAM.json`) |
| Files | 145 (5,913,694 bytes), including `fixtures/` for the browser tests |
| Upload | `rclone copy --immutable --checksum`; `rclone check --one-way --download`: 145 matching, 0 differences |
| Public check | 145/145 SHA-256 hashes, sizes and JS/WASM MIME types over HTTPS |
| Browser suites against the live URL | 89/89 passed, no page errors (Chromium 153, touch emulation, software WebGL) |

Changes since v3: opens empty like stock Neuroglancer, engine rebased, and shell fixes (see git log). Receipts are in [`evidence/2026-10-28-spelunker-v4/`](evidence/2026-10-28-spelunker-v4/).

Not covered: physical iOS/Android devices, Safari, and live CAVE editing.

## Previous releases

These stay live at their URLs. Their receipts are in git history.

| Release | Notes |
| --- | --- |
| [2026-09-15-spelunker-v3](https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-09-15-spelunker-v3/index.html) | First Spelunker engine; opens the MEC volume |
| [2026-09-13-v2](https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-09-13-v2/index.html) | Google Neuroglancer engine |
| 2026-09-12-v1 | Original lightweight prototype |

## Publishing a release

```sh
R=YYYY-MM-DD-name
npm run build
RELEASE_DIR=release/$R EVIDENCE_DIR=evidence/$R node prepare-release.mjs
rclone copy --immutable --checksum release/$R nokura:web/neuroglancer-mobile/$R
rclone check release/$R nokura:web/neuroglancer-mobile/$R --one-way --download
B=https://c10s.pni.princeton.edu/web/neuroglancer-mobile/$R/
BASE_URL=$B EVIDENCE_DIR=evidence/$R node verify-public.mjs
BASE_URL=${B}index.html FIXTURE_BASE_URL=${B}fixtures EVIDENCE_DIR=evidence/$R EVIDENCE_TAG=public npm run test:browser
```

Commit the manifest, hash list, rclone logs, public verification and JSON reports with `git add -f evidence/$R/...`, then update this file.
