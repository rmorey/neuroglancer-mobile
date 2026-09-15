# Spelunker support in Neuroglancer Mobile

The application includes the complete standalone Spelunker engine at commit
`d4aeac3b66eb4bd3fa86dbdc0202a7f006439740`, matching the Spelunker branch and
public deployment checked on 2026-09-15 UTC. `UPSTREAM.json` pins the source and
records every local engine patch. No source adapter, renderer, layer type,
codec, or worker is intentionally excluded from its default standalone build.

## Features and mobile access

| Spelunker feature | Access in this app |
| --- | --- |
| Graphene merge, multicut/split, find path, native preview and submission | Workspace → Spelunker tools, or native Graph tab/tool palettes. Touch controls operate the native tools, not a separate editing implementation. |
| Red/blue split groups, anchors, clear, submit, native settings | Active touch tool strip and its Details control. Native backend guards and submission behavior remain in charge. |
| Historical segmentation and timestamp ownership/locking | Time / graph controls opens the native Graph tab. Timestamp and owner state survive saving/sharing. Merge/split remain disabled for a historical view. |
| Annotation review, next/previous and associated-segment switching | Spelunker tools annotation review controls, native annotation tabs and configured bracket shortcuts. |
| Boolean annotation properties and tag summaries | Native schema, annotation list and selection details. Mobile annotation editing retains the same property values and exact related uint64 segment IDs. |
| Legacy annotation tags, shader property names and tool bindings | Spelunker's upgrader runs for URL/remote state, native editor, mobile JSON/file import and saved-view restoration. Legacy named layer maps are accepted. |
| Legacy Graphene timestamps | Spelunker's upgrader migrates source state into the current layer timestamp representation. |
| CAVE short-state links | Workspace → Create CAVE short link, or native Share. The configured service is the same as Spelunker's deployment. The resulting URL retains the current mobile app path, including `index.html`. |
| MiddleAuth authentication and terms of service | Native login and terms-acceptance popups/retry flow retained. Credentials are supplied by the service and user, not included in this repository. |
| Default proofreading shortcuts | M: merge; C: multicut; F: find path; brackets: annotation navigation; Ctrl+Shift+X: clear segments. Touch controls and the existing keyboard accessory provide access without a hardware keyboard. |
| Segment-list color picker | Enabled by the same build flag as Spelunker. Other native color/shader/property controls remain available. |
| Images, segmentation, meshes, skeletons, volume rendering, formats and transforms | All retained native functionality through Layers, Workspace and Full controls, alongside the existing mobile navigation and annotation editor. |
| Dataset-specific Spelunker compatibility behavior | Placeholder-scale filtering, Graphene fragment paths, special GCS routing, manifest updates and other pinned source changes are retained with the full snapshot. |

Ordinary Share creates a full viewer URL locally. Creating a CAVE short link
uploads the workspace JSON to the configured state service only when the user
presses that action. Remote dataset editing likewise uses native explicit tools
and backend authorization. The default MEC image source is unchanged and does
not itself provide segmentation proofreading.

## Compatibility fixes

The mobile shell uses exported Spelunker configuration rather than duplicating
its state upgrader or custom-key binding rules. The patches also preserve state
on failed URL/editor loads, clean up download links, reset canceled touches, and
retain subdirectory paths in server-backed share links. Consult `UPSTREAM.json`
for the exact patch files and additional lifecycle fixes.

Starting a mobile annotation tool cancels the mobile proofreading activation;
starting a proofreading tool cancels the mobile annotation tool and clears
accessory modifiers. Canceling/closing a tool follows native cleanup and does
not assert that any pending backend operation was undone. Native controls and
tool state remain available for the full workflow.

## Verification boundaries

The existing five browser suites exercise real MEC imagery and deterministic
image, segmentation, mesh, skeleton, annotation, Zarr, state, and touch fixtures.
The sixth suite, `tests/spelunker.browser.mjs`, exercises Spelunker migration,
timestamps, Graphene tools, short-state sharing, and authentication behavior
using simulated services. It never submits changes to a real CAVE dataset or
uploads a real workspace to a production state service.

The seventh suite, `tests/spelunker-touch.browser.mjs`, places real touch
endpoints/anchors and submits merge, multicut and path operations to intercepted
synthetic services. It checks native Details, duplicate-submit prevention,
drag behavior, and 44px phone/landscape controls.

The [published release](DEPLOYMENT.md) passed all **88 browser checks** and all
145 public file hashes. Engine typechecking, four state/input unit tests, and
exact reproduction from the pristine source plus eight patches also passed.

Those tests establish implementation behavior against controlled protocol
fixtures. A particular live service still needs its account, permissions,
origin/CORS settings, and representative data. Physical iOS/Android, Safari,
mobile memory limits, cellular performance, and live authenticated merge/split
are separate qualification targets. Python-server integration is a separate
upstream deployment profile, not part of Spelunker's public standalone site.

Exact successful release checks, hashes, and screenshots are recorded in the
release receipt. The old Google-engine evidence remains historical and does not
stand in for verification of the Spelunker build.
