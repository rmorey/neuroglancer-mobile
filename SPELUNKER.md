# Spelunker support

The engine is Seung Lab's Spelunker branch (pinned in `UPSTREAM.json`) with its standard standalone build: CAVE state servers, custom key bindings and the segment-color widget. Nothing is excluded from it.

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

## Behavior notes

- Ordinary Share builds a full URL locally. **Create CAVE short link** uploads the state to the configured service, and only when pressed.
- Starting a mobile annotation tool cancels any active proofreading tool, and vice versa. Cancel follows the native cleanup. It does not undo anything already submitted to the backend.
- The shell reuses Spelunker's own state upgrader and key-binding setup; patch 0004 exports them for embedding. Patch 0005 keeps the app's subdirectory path in short links.

## Testing

`tests/spelunker.browser.mjs` covers state migration, timestamps, Graphene tools, short links and MiddleAuth terms handling. `tests/spelunker-touch.browser.mjs` places real touch endpoints and submits merge, multicut and find-path operations. Both run against intercepted synthetic services and never write to a real CAVE dataset or state server.

Live merge/split on a real service still needs an account, permissions, CORS for this origin, and representative data.
