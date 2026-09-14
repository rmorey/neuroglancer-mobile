# Full Neuroglancer mobile validation

Reference implementation: google/neuroglancer commit `3598da303d5eb865564a2f1f5123220a33f87e25`, package version 2.41.2. Source links below are pinned to that commit. An intact upstream engine preserves available capabilities; each feature additionally needs accessible mobile controls and behavioral evidence. A finite fixture suite does not establish compatibility with every possible dataset or authenticated service.

## Browser engines

| Engine | Probe result | Meaning |
|---|---|---|
| Chromium 153.0.8010.12 | Launch passed; WebGL2 and EXT_color_buffer_float available with SwiftShader | Can exercise functional rendering, shader compilation, workers, touch input and screenshots on this host |
| Playwright WebKit 26.6 | Download succeeded; launch rejected because host GTK4, ICU74, codecs and other libraries are absent | No WebKit/Safari pass may be claimed; no host packages were changed |
| Physical iOS Safari / Android Chrome | No devices attached | Memory pressure, browser chrome/safe-area behavior, virtual keyboard and cellular performance require device evidence |

Probe receipt: `browser-engines.json` in this evidence directory. Browser command must set `TMPDIR` to the task directory and permit local browser IPC. SwiftShader is software rendering and is not a phone-GPU performance measurement.

## Validation matrix

This matrix records the upstream contracts and intended checks; the completed browser coverage below and the machine-readable reports state which behaviors were actually exercised. Entries such as every segment filter, every codec, or each authenticated backend must not be inferred to have passed from source preservation alone.

| Capability | Upstream contract | Deterministic evidence / required behavior |
|---|---|---|
| Upstream registrations and codecs | [Default source registrations](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/datasource/enabled_frontend_modules.ts), companion backend/async-computation modules | Build graph retains all registered source modules, corresponding workers and WASM assets. Report any disabled module explicitly |
| Data source breadth | [README sources](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/README.md), [file protocols](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/datasource/file_protocols.md) | Precomputed and Zarr fixtures render. N5/NIfTI/DeepZoom/OBJ/VTK/nggraph plus service adapters remain in the build; unsupported or untested live backends are separated from failures |
| Image data types and exact voxel values | [Precomputed volumes](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/datasource/precomputed/volume.md) | raw uint8, uint16 and signed-range float32 fixtures; inspect exact values at manifest sample coordinates, visible dynamic range, custom shader and opacity changes |
| Multiscale / nonzero offsets / chunk edges | Same volume contract | Requested MEC volume plus `offset-edge-uint8` fixture with offset [-5,7,11], size [17,13,9] and truncated chunks. Verify physical coordinates and all orthogonal planes |
| Image codecs | Same volume contract | Raw and JPEG exercised locally/MEC. Preserve PNG, JXL, compresso and crackle registration; use upstream codec tests or additional fixture evidence before claiming each codec tested |
| uint64 segmentation | [Volume format](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/datasource/precomputed/volume.md), [compressed segmentation](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/sliceview/compressed_segmentation/README.md) | Raw and compressed fixtures use 1, 4294967301, 9007199254740993 and 18446744073709551614. Read/pick values without Number rounding; select, clear, hide, recolor, show/hide zero, change alpha, equivalences and segment list state roundtrip |
| Sharded storage / HTTP Range | [Sharded format](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/datasource/precomputed/sharded.md) | `sharded-uint8` requires real 206 range responses; verify index and voxel bytes. A server silently serving full files must not be mistaken for correct range support |
| Meshes and skeletons | [Meshes](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/datasource/precomputed/meshes.md), [skeletons](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/datasource/precomputed/skeletons.md) | Legacy tetrahedral meshes and branching skeletons for all large IDs; select object and show in 3D; verify geometry requests, visible pixels, visibility/alpha/rotation and radius attribute. Multires Draco paths require separate upstream/fixture proof |
| Segment properties | [Property format](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/datasource/precomputed/segment_properties.md) | Labels, description, numeric confidence and tags present. Search/list/filter matches exact large ID and exported state preserves it |
| Annotation reading | [Annotation format](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/datasource/precomputed/annotations.md) | Precomputed point, line, box, ellipsoid and polyline collections with float property, RGBA color, ID above 2^53 and related segment ID. Verify spatial/by-id/by-segment reads and selection |
| Annotation editing | [Native annotation handlers](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/annotation/index.ts) | Create all five geometries through touch-accessible controls; finish/cancel multiline tools, edit geometry/description/properties/relations, move/delete, undo/redo where provided. Reload exported native state and compare geometry |
| Layouts / orientation / navigation | [Viewer behavior](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/README.md), [default input bindings](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/ui/default_input_event_bindings.ts) | XY/XZ/YZ, 4-panel, 3D and mixed layouts; keep center synchronized; oblique rotation, orientation reset, orthographic mode, pan/pinch, section seek, axis/scale toggles. Touch gestures are actual CDP events |
| Layers / sources / shaders / transforms | [Layer panels](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/ui/layer_side_panel.ts), [shader language](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/sliceview/image_layer_rendering.md) | Add/remove/rename/reorder layers; source editing and subsource toggles; alpha and shaders; coordinate transform editing. Native editor remains reachable and fits phone viewport |
| Zarr v2/v3 | [Zarr support](https://github.com/google/neuroglancer/blob/3598da303d5eb865564a2f1f5123220a33f87e25/src/datasource/zarr/README.md) | Separate raw uint16 v2 and v3 fixtures with explicit z/y/x names and physical units; exact voxel values match precomputed fixture. OME-NGFF and additional codecs are distinct coverage items |
| Native state compatibility | Viewer JSON and URL state | Import unmodified native JSON and fragment links; export/share then fresh context restore with no lost layers, sources, dimensions, shader, annotations, segment IDs, camera or layout. Mobile UI state must not replace native schema |
| Mobile reachability and resilience | Existing upstream functionality plus wrapper controls | 390x844, 360x640, 844x390, 1440x900; no clipped essential dialogs, touch targets at least 44px, focus/keyboard close behavior, real drag/pinch, no unexpected errors. Metadata/chunk failure, cancellation, retry and stale responses remain correct |

## Available fixture inventory

`../tests/fixtures/manifest.json` records each of 121 file hashes, 14 datasets, dimensions, five exact voxel samples, segment IDs and the upstream decoder check. Total fixture content is 256,013 bytes excluding the manifest. Standalone mesh, skeleton and property directories are referenced by segmentation metadata. The `editable-annotation-state.json` file provides native state for all five local geometries.

`../tests/generate-parity-fixtures.mjs` uses only Node builtins and the pinned upstream compressed segmentation decoder. Every one of 12,288 compressed uint64 voxels was compared against that decoder; all checks passed. Separate Chromium browser cases exercise every fixture dataset, as detailed in the browser reports.

## Completed browser coverage

`../tests/full-browser.mjs` contains 31 end-to-end cases. The preserved `full-final-local-browser-report.json` records the preceding 30-case pass; `full-candidate-local-browser-report.json` is the final candidate run including the touch keyboard. The final report's `passed` field and each case result are authoritative. Separate root workspace and annotation editor suites supplement these checks.

The unchanged published build passed the same **31/31 cases** in `full-nokura-browser-report.json`, using [the explicit public entry file](https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-09-13-v2/index.html) and its public `fixtures/` directory. Public screenshots are `full-nokura-mec-phone.png`, `full-nokura-objects-3d.png`, `full-nokura-touch-annotations.png`, `full-nokura-landscape.png` and `full-nokura-native-controls.png`; portrait and landscape screenshots were visually reviewed. The directory URL ending in `/2026-09-13-v2/` returns HTTP 404 because this host does not resolve that index automatically; the failed startup receipt is preserved as `full-nokura-directory-404-browser-report.json`.

- Requested MEC imagery is present in the actual browser screenshot, as well as the WebGL framebuffer. The screenshot check detects CSS overlays that could hide a correctly rendered canvas.
- Raw uint8, uint16, float32, offset/truncated chunks, sharded HTTP 206, raw/compressed uint64, and Zarr v2/v3 match exact fixture samples. Visible large segment IDs survive selection and native JSON export without rounding.
- Legacy mesh and skeleton requests succeed and produce nonblank 3D pixels; the segment property map loads. All five remote annotation geometries resolve by ID with exact large IDs and relationships.
- All five local annotation geometries roundtrip; actual touch taps create all five consecutively, cancel unfinished lines, delete selected annotations, move a native point handle, and delete at its new location.
- All nine built-in layouts switch; actual CDP touch cancellation followed by pan and pinch works. Section axis and step controls change the expected native coordinates.
- Layer addition, visibility, rename, opacity, order, removal and undo work. Native share fragments restore in a new page; workspace JSON import, orientation changes/reset, command palette and native state download work.
- Malformed JSON fragments and invalid restoration dimensions preserve the existing workspace. Native on-screen ArrowRight and sticky Ctrl+Equal dispatch the corresponding native actions; closing clears modifiers.
- Mobile shell controls fit 390x844, 360x640, 844x390 and 1440x900, with minimum 44px targets in the measured shell controls. Layers, workspace, help and annotation sheets fit those viewports. Original native controls remain reachable; this is not a claim that every legacy native widget has a 44px target.
- Uncaught page/worker errors and unexpected HTTP/console errors fail the suite. Three expected Zarr version-discovery 404 responses are allowed by exact URL, and retained in the report.

No physical device or WebKit execution passed on this host. Authenticated services, every supported codec, multiresolution Draco meshes, every segment filtering option, large-volume memory pressure and phone GPU/cellular performance remain outside this fixture suite. Native engine registration and emitted-asset audits provide distinct preservation evidence for those paths.

## Test execution order

1. Freeze build revision; inventory emitted modules/workers/WASM and record file hashes.
2. Load the requested live MEC volume in Chromium at phone dimensions and verify image pixels and clean worker/console logs.
3. Serve fixtures with CORS and HTTP Range, then run data-type/segmentation/object/annotation/Zarr cases with exact value and state assertions.
4. Exercise real mobile controls and touches against native viewer state, including annotation creation and selection.
5. Repeat native state roundtrip and core navigation against published Nokura assets; compare deployed asset hashes with the tested build.
6. Publish explicit passed, failed, preserved-but-untested and device-validation-pending coverage. Do not label WebKit or every remote datasource tested from the Chromium run.
