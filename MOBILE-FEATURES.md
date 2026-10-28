# Mobile features

The mobile shell drives the same viewer, layer manager, navigation, annotation and state objects as the native interface. Anything Neuroglancer can load or serialize still works. The shell adds touch entry points, and **Full controls** shows the desktop UI.

This is a map of entry points, not a claim that each feature has been tested on a physical device.

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

Native selectors restyled for touch:

- `.neuroglancer-side-panel`, `.neuroglancer-side-panel-column`, `.neuroglancer-side-panel-row`, and `.neuroglancer-side-panel-titlebar` for panel placement.
- `.neuroglancer-tab-view-bar` and `.neuroglancer-tab-label` for scrollable, touch-sized layer tabs.
- `.neuroglancer-layer-list-panel-item-*` and `.neuroglancer-layer-item-button-container` for layer actions that upstream otherwise shows on hover.
- `.neuroglancer-segment-list-query`, `.neuroglancer-segment-list-entry-*`, `.neuroglancer-star-icon`, and `.neuroglancer-eye-icon` for segment search and actions.
- `.neuroglancer-annotation-list-entry-delete` and `.neuroglancer-tool-palette-tool-delete` for hover-only controls.
- `.overlay-content`, `.neuroglancer-state-editor`, `.neuroglancer-command-palette`, and `.neuroglancer-context-menu` for viewport-bounded native overlays.

CSS makes these controls visible and larger. CSS alone does not replace mouse-only commands with touch interactions.

## Gestures

Upstream maps a one-finger slice drag to moving through Z, a two-finger drag to pan, pinch to zoom, double tap to select and long press to recenter. The shell makes the one-finger drag pan instead, and moves section stepping to the bottom bar. Perspective panels keep their camera gestures.

## Limits

- Tested in Chromium with touch emulation and software WebGL only. Physical iOS/Android, Safari, device memory and cellular performance are untested.
- Not yet covered by touch tests: every segment filter and star action, backend-specific merge/split anchor tools, docking and drag reordering, arbitrary custom key bindings, and every property-entry tool.
- Authenticated sources need their own credentials, CORS and permissions. For example, the default Brainmaps OAuth client doesn't authorize a new origin.
- Local annotations live in the viewer state until it is exported or shared. Remote writes depend on the backend.
- Upstream has five annotation geometry types; there is no polygon primitive.
- Python-server integration is a separate upstream deployment mode and is not included.

## Source references

- [`src/viewer.ts`](vendor/neuroglancer/src/viewer.ts): viewer state, top-row actions, panel registration, native state editor.
- [`src/ui/default_input_event_bindings.ts`](vendor/neuroglancer/src/ui/default_input_event_bindings.ts): upstream touch, mouse, and keyboard bindings.
- [`src/ui/default_commands.ts`](vendor/neuroglancer/src/ui/default_commands.ts): native command registry coverage.
- [`src/data_panel_layout.ts`](vendor/neuroglancer/src/data_panel_layout.ts): all nine named layouts.
- [`src/ui/side_panel.ts`](vendor/neuroglancer/src/ui/side_panel.ts) and [`src/ui/side_panel_location.ts`](vendor/neuroglancer/src/ui/side_panel_location.ts): panel lifecycle and docking state.
- [`src/rendered_data_panel.ts`](vendor/neuroglancer/src/rendered_data_panel.ts): picking, navigation actions, annotation modification, touch translation, and pinch.
