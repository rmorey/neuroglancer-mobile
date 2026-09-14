# Neuroglancer Mobile: feature access and verification scope

This version embeds the upstream Neuroglancer viewer. The mobile interface controls the same viewer, layer manager, navigation state, annotations, segmentation objects, and serialized state used by the native interface. The original lightweight XY prototype remains separate.

**Source pin:** Neuroglancer 2.41.2, commit `3598da303d5eb865564a2f1f5123220a33f87e25`, vendored in [`vendor/neuroglancer`](vendor/neuroglancer). The build uses the upstream production standalone configuration with its default layer, datasource, key-value-store, worker, and WebAssembly modules enabled. No image-only replacement renderer is used here.

This is a map of implemented entry points and retained upstream capabilities. It is **not a claim that every upstream feature has been verified on a physical mobile device**. Runtime evidence must come from the saved browser test results for the built version.

## Workspace entry points

| Capability | Mobile entry point | Native implementation retained |
| --- | --- | --- |
| Multiscale image volumes and channels | Layers; layer settings | Upstream image layers, shaders, channel controls, datasource adapters, chunk cache, GPU rendering |
| Segmentation and segment properties | Layers; native layer Segments tab; Select mode | Segment query, property filters, visibility, colors, stars, selected segments, native selection details |
| Meshes and skeletons | Add the source in Layers; choose 3D or a split view | Upstream mesh/skeleton loaders, rendering, and layer controls |
| Volume rendering | Native image layer rendering controls; 3D view | Upstream volume renderer and layer settings |
| XY, XZ, and YZ sections | View selector | Native slice panels and navigation transforms |
| Perspective view | 3D in View selector | Native perspective panel, projection, camera, and picking |
| Four-panel and combined views | View selector | All nine named layouts: `xy`, `xz`, `yz`, `3d`, `4panel`, `4panel-alt`, `xy-3d`, `xz-3d`, `yz-3d` |
| Custom split/group layouts | Full controls; state editor | Native layout tree and layer groups. Opening mobile controls should not replace an imported custom layout. Choosing a new named layout intentionally changes it. |
| Position, sections, and zoom | X/Y/Z coordinate form; axis selector; section field, slider, arrows, step, and play; navigation toolbar | Native position, cross-section scale, and orientation state |
| Layer management | Layers; native Layers panel | Add, remove, rename, visibility, picking, source configuration, type, and native controls |
| Layer tabs | Native layer sheet | All tabs supplied by the selected upstream layer, including source, rendering, segments, annotations, and applicable schema/settings tabs |
| Annotation creation and editing | Annotate sheet | Upstream local annotation layers and native tools for point, line, box, ellipsoid, and polyline |
| Annotation selection and precise edits | Annotate sheet; native annotation/selection details | IDs, description, coordinates, properties, related segments, and geometry |
| Annotation history and transfer | Annotate sheet | Mobile undo/redo for local changes, import validation, export; changes remain in upstream local annotation state |
| Remote annotation inspection/editing | Native source and annotation panels | Depends on the upstream datasource's capabilities and write permissions; mobile local-annotation tools do not turn a read-only remote source into a writable source |
| Full state import/export/editing | Workspace; Full controls → JSON state editor | Complete upstream serialized viewer state and native CodeMirror state editor |
| State URLs and sharing | Share; Workspace | Upstream state includes layers, segmentation selections, local annotations, navigation, layouts, and supported settings |
| Saved views | Workspace | Browser-local saved state; exporting/sharing state provides a transferable copy |
| Screenshot | Screenshot button in navigation toolbar; native controls | Upstream screenshot action |
| Viewer controls and performance settings | Workspace; native Settings panel | Display settings, memory/download/cache limits, scale bars, axes, projection, and applicable native settings |
| Tool palettes and command palette | Full controls; Workspace actions | Native tool palettes, tool activation, commands, and keyboard bindings |
| Keyboard and modified mouse actions on a touchscreen | Workspace → Touch keyboard and mouse actions | Native key dispatch, Ctrl/Alt/Shift toggles, navigation keys, custom key codes, and primary/right click at the last viewer point. The accessory preserves native focus and leaves ordinary text editing to the device keyboard. |
| Help and statistics | Help; native Help and Statistics panels | Upstream binding descriptions and statistics |
| Original desktop workspace | Full controls button | Original top row, layer bar, native panels, menus, tools, and keyboard bindings remain available |

## Mobile presentation

The custom shell has large controls, safe-area spacing, 16 px form text, a scrollable panel, and portrait/landscape layouts. Native panels keep their existing contents and lifecycle. On smaller screens their presentation becomes a sheet; the native layout engine and rendered panels stay attached to the upstream viewer.

Native selectors reviewed against the pinned source include:

- `.neuroglancer-side-panel`, `.neuroglancer-side-panel-column`, `.neuroglancer-side-panel-row`, and `.neuroglancer-side-panel-titlebar` for panel placement.
- `.neuroglancer-tab-view-bar` and `.neuroglancer-tab-label` for scrollable, touch-sized layer tabs.
- `.neuroglancer-layer-list-panel-item-*` and `.neuroglancer-layer-item-button-container` for layer actions that upstream otherwise shows on hover.
- `.neuroglancer-segment-list-query`, `.neuroglancer-segment-list-entry-*`, `.neuroglancer-star-icon`, and `.neuroglancer-eye-icon` for segment search and actions.
- `.neuroglancer-annotation-list-entry-delete` and `.neuroglancer-tool-palette-tool-delete` for hover-only controls.
- `.overlay-content`, `.neuroglancer-state-editor`, `.neuroglancer-command-palette`, and `.neuroglancer-context-menu` for viewport-bounded native overlays.

CSS makes these controls visible and larger. CSS alone does not replace mouse-only commands with touch interactions.

## Verified browser behavior

Upstream maps one-finger slice dragging to moving through Z, two-finger dragging to pan, pinch to zoom, double tap to select, and long press to recenter. The mobile shell changes the primary slice gesture to pan and provides separate section controls. Perspective panels keep their own camera gestures.

The following checks passed in Chromium 153.0.8010.12 with touch emulation and software WebGL. Gesture tests send browser touch events; they do not infer interaction success from screenshots alone.

| Behavior exercised | Saved evidence |
| --- | --- |
| Touch cancellation followed by one-finger pan and pinch; section axis and step changes; all nine named layouts | [`full-candidate-local-browser-report.json`](evidence/full-candidate-local-browser-report.json), cases `real-touch-pan-pinch-and-section-controls` and `all-native-layouts` |
| Touch creation of point, line, box, ellipsoid, and polyline; Finish and Cancel; selection/deletion; moving a native point handle and deleting at its new location | Same report, cases beginning `touch-create-five-annotation-geometries` and `touch-annotation-` |
| Numeric geometry edits for all five shapes, descriptions, typed properties, exact uint64 relations, polyline vertices, undo/redo, and rejected invalid imports | [`annotation-editor-browser.json`](evidence/annotation-editor-browser.json), eight editor checks |
| Native state/share round trips, orientation/reset, layer actions, native editor download, and rejection of malformed state without losing the workspace | [`full-candidate-local-browser-report.json`](evidence/full-candidate-local-browser-report.json) and [`workspace-browser.json`](evidence/workspace-browser.json) |
| On-screen native ArrowRight and Ctrl+Equal change viewer state; axes toggle and Ctrl+Equal run through actual accessory buttons; modifiers affect native controls while excluding editable fields; right-click event delivery; Clear and Close release modifiers | Main report case `touch-native-keyboard-and-sticky-modifier`; [`touch-keyboard-browser-report.json`](evidence/touch-keyboard-browser-report.json), six accessory checks |
| Mobile shell and sheets fit 360×640, 390×844, 844×390, and 1440×900; measured shell controls have 44 px targets. The keyboard also fits the three phone viewports with all 17 measured controls at least 44 px. | Main report case `responsive-workspace-panels`; accessory report case `phone-and-landscape-bounds`; [360×640](evidence/touch-keyboard-360x640.png), [390×844](evidence/touch-keyboard-390x844.png), and [844×390](evidence/touch-keyboard-844x390.png) screenshots |

The main candidate suite records 31 passing cases, including real MEC screenshot pixels and deterministic image, segmentation, object, annotation, and Zarr fixtures. See [`PARITY_VALIDATION.md`](evidence/PARITY_VALIDATION.md) for the data coverage and exact boundaries. The keyboard test supports `BASE_URL` and `EVIDENCE_TAG` for separate public-demo evidence. Optional `FIXTURE_BASE_URL` replaces the default MEC layer with the deterministic `raw-uint8` fixture before running the same commands.

The same six accessory checks also passed against the [published Nokura demo](https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-09-13-v2/index.html) using the requested MEC volume: [`nokura-touch-keyboard-browser-report.json`](evidence/nokura-touch-keyboard-browser-report.json). The explicit `index.html` URL is required on this host; the directory URL returned 404 and its startup failure is preserved separately.

The separate [public volume suite](evidence/nokura-volume-rendering-browser.json) also passed all six checks, including true ray marching, shader color/alpha/gain, one-finger 3D rotation, and two-finger rotation within an oblique slice.

Preserved capabilities still needing dedicated interaction evidence include every segment filter and star operation, backend-specific merge/split and anchor tools, native docking/drag reordering, arbitrary custom key bindings, and every property-entry tool. Accessory key and mouse event delivery is verified; it does not certify every command receiving those events. Custom layouts and all possible state combinations also need targeted tests beyond the recorded round trips.

## Targeted upstream fixes

Three small, recorded patches preserve native behavior while fixing failures exposed by mobile use: state downloads attach and remove their temporary link and revoke its blob URL; URL state parsing validates before mutation and restores the prior workspace after a failed restoration; touch cancellation clears pending gesture and long-press state. Patch provenance is recorded in [`UPSTREAM.json`](UPSTREAM.json) and [`patches`](patches). The candidate browser suite covers successful native downloads, malformed/invalid URL state, and cancellation followed by fresh pan and pinch gestures.

## Backend and platform boundaries

- The standalone browser profile does not contain Python-server integration. That is a separate upstream deployment profile requiring a Python server.
- Authenticated sources still require the source's credentials, browser access, CORS, and permissions. In particular, the upstream default Brainmaps OAuth client origin allowlist does not automatically authorize a new Nokura origin; that backend needs suitable operator configuration.
- Local annotations are local/in-state until state or annotation JSON is saved/exported. Remote writes depend on the native backend.
- The pinned upstream defines five annotation geometry types; it does not define a separate polygon primitive.
- This test volume is an image source. It alone cannot establish segmentation, mesh, skeleton, remote-write, or authenticated-backend behavior. Those require appropriate additional fixtures or sources.
- Browser emulation is not a physical iOS/Android test and does not establish device memory limits, thermal behavior, Safari compatibility, or mobile network performance.

## Source references

- [`src/viewer.ts`](vendor/neuroglancer/src/viewer.ts): viewer state, top-row actions, panel registration, native state editor.
- [`src/ui/default_input_event_bindings.ts`](vendor/neuroglancer/src/ui/default_input_event_bindings.ts): upstream touch, mouse, and keyboard bindings.
- [`src/ui/default_commands.ts`](vendor/neuroglancer/src/ui/default_commands.ts): native command registry coverage.
- [`src/data_panel_layout.ts`](vendor/neuroglancer/src/data_panel_layout.ts): all nine named layouts.
- [`src/ui/side_panel.ts`](vendor/neuroglancer/src/ui/side_panel.ts) and [`src/ui/side_panel_location.ts`](vendor/neuroglancer/src/ui/side_panel_location.ts): panel lifecycle and docking state.
- [`src/rendered_data_panel.ts`](vendor/neuroglancer/src/rendered_data_panel.ts): picking, navigation actions, annotation modification, touch translation, and pinch.
