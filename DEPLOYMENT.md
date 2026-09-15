# Neuroglancer Mobile — Spelunker release

**[Open the Spelunker Mobile demo](https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-09-15-spelunker-v3/index.html)**

Use the explicit `index.html` URL. This immutable release includes the complete
pinned Spelunker standalone engine, its deployment configuration, and the mobile
controls. The default MEC source remains exactly
`precomputed://https://c10s.pni.princeton.edu/mec_alignment_2025-09/alignment/img/v2`.
There is no MEC conversion, proxy, or dataset copy.

| Identity | Value |
| --- | --- |
| App version | 1.1.0 |
| Spelunker source | `seung-lab/neuroglancer`, branch `spelunker`, commit `d4aeac3b66eb4bd3fa86dbdc0202a7f006439740` |
| Source package version | 2.41.2 |
| Built | 2026-09-15 02:31:42 UTC |
| Published | 2026-09-15 02:34:46 UTC |
| Nokura prefix | `nokura:web/neuroglancer-mobile/2026-09-15-spelunker-v3` |
| Main asset | `main.e2534759721a6932.js` |
| Files / bytes | 145 / 5,905,904 |
| Engine deviations | Eight recorded compatibility patches, ten source files; exact pristine-plus-patches comparison passed |

The new engine includes Spelunker's Graphene proofreading, historical Time,
annotation properties and migration, CAVE sharing/authentication, custom bindings,
segment-color widget, and all default standalone data/rendering modules. See
[SPELUNKER.md](SPELUNKER.md) for entry points and qualification boundaries.

## Publication evidence

`rclone copy --immutable --checksum` created the release. `rclone check --one-way
--download` verified 145 files with zero differences. Independent public HTTPS
requests verified **145/145 SHA-256 hashes**, sizes, and relevant JS/WASM MIME types.

Receipts: [manifest](evidence/spelunker-v3/release-manifest.json),
[SHA-256 list](evidence/spelunker-v3/release-sha256.txt),
[upload](evidence/spelunker-v3/nokura-upload.log),
[download comparison](evidence/spelunker-v3/nokura-check.log),
[public verification](evidence/spelunker-v3/public-verification.json).

## Browser verification

All **88 checks** passed locally and against this exact public release in
Chromium 153 with emulated touch/software WebGL. No suite reported an uncaught
page error. Editing/authentication protocol tests intercept synthetic services;
they do not write to a production CAVE dataset or state server.

| Suite | Passed | Public receipt |
| --- | ---: | --- |
| Real MEC, data formats, objects, native layouts, annotation gestures and state | 31 | [Viewer](evidence/spelunker-v3/viewer.json) |
| Local annotation geometry/properties/relations/undo/import | 8 | [Annotations](evidence/spelunker-v3/annotations.json) |
| Workspace, state, bookmarks, downloads, multidimensional navigation | 9 | [Workspace](evidence/spelunker-v3/workspace.json) |
| Touch keyboard and modified pointer actions | 6 | [Keyboard](evidence/spelunker-v3/keyboard.json) |
| Volume rendering, shaders, opacity, 3D/oblique touch rotation | 6 | [Volume](evidence/spelunker-v3/volume.json) |
| Spelunker migration, timestamps, native controls, authentication and short links | 22 | [Spelunker](evidence/spelunker-v3/spelunker.json) |
| Actual touch merge/split/path endpoints, submissions, native controls and sizing | 6 | [Proofreading touch](evidence/spelunker-v3/proofreading-touch.json) |

[Verification summary](evidence/spelunker-v3/verification.json).
The engine typecheck and four state/input unit tests also passed. Source patches
were applied independently to a pristine Spelunker archive; the result matched
all vendored source files exactly, excluding the dependency directory.

Visual evidence: [MEC phone](evidence/spelunker-v3/mec-phone.png),
[proofreading phone](evidence/spelunker-v3/proofreading-phone.png),
[proofreading landscape](evidence/spelunker-v3/proofreading-landscape.png),
[annotation summary](evidence/spelunker-v3/annotation-summary.png).

The new regressions exposed and verified fixes for short-link paths, unreachable
terms handling, Time control lifecycle, native tab disposal, playback during
state imports, and merge preview panels obstructing phone canvas gestures.

## Limits and prior releases

Full engine inclusion is not proof of every workflow on every service/device.
Live authenticated CAVE merge/split still requires representative data, account
permissions, origin/CORS configuration and service qualification. Physical iOS,
Android, Safari, device memory/thermal limits and cellular performance remain
unqualified. Python-server integration is a separate upstream profile.

The [Google-engine v2 release and all its evidence](DEPLOYMENT-GOOGLE-V2.md) remain
preserved. Existing immutable links continue to load that historical version.
