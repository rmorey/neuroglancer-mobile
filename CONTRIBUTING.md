# Developing Neuroglancer Mobile

The mobile application is at the repository root. The initial development
workspace also contained a separate lightweight XY prototype; that prototype
is not part of this repository. The Nokura demo is a static build of this app.

## Relationship to upstream

`vendor/neuroglancer/` is a source snapshot of the commit in `UPSTREAM.json`.
All default standalone datasource, worker, codec, and layer modules are kept.
The mobile shell controls the same viewer and serializes the native state.

The first Git commit imports the unmodified Google upstream snapshot. The following
application commit adds the shell and applies the original three patches. The
Spelunker integration replaces the snapshot with its pinned Seung Lab branch,
then records the rebased fixes and setup/sharing adaptations as separate patches.
This is a dedicated application repository rather than GitHub's fork network.
To propose an upstream fix, apply the appropriate patch to a separate checkout
of the repository and commit in `UPSTREAM.json` and test it there.

Keep shell changes outside the vendor directory when possible. For an engine
fix, add or update a patch and its `UPSTREAM.json` entry. When upgrading the
engine, update the source snapshot and pin together, rebase the patches, and
rerun both exact-value fixtures and touch/browser tests. Preserve upstream
copyright and license notices.

## Checks

Use the locked Node dependencies and commands in `README.md`. `npm test`
checks state and input handling. With the development server running,
`npm run test:browser` runs seven suites, including the real MEC volume and
synthetic image, segmentation, annotation, mesh, skeleton, and Zarr fixtures.
Spelunker-specific checks use simulated Graphene/CAVE services for state sharing,
authentication, historical segmentation, and proofreading tool behavior. They do
not publish to a real state service or edit real segmentation.
New artifacts belong in ignored `test-results/`; the committed `evidence/`
files describe the previously qualified Nokura release.

CI runs the build and these checks in Chromium. Physical mobile devices and
Safari are separate qualification targets; see `MOBILE-FEATURES.md` before
making compatibility claims. CI does not publish or replace the Nokura demo.

## Publishing

Build to `dist/`, prepare a new dated release directory, and verify the exact
assets before publication. Keep static JavaScript, CSS, workers, WebAssembly,
license files, and other emitted assets together. An explicit `index.html`
URL is required for the existing Nokura host. `DEPLOYMENT.md` records the
previous release's hashes, checks, scope, and limitations.

Use `RELEASE_DIR` and `EVIDENCE_DIR` when running `prepare-release.mjs` to create
a new release and keep prior manifests intact. `verify-public.mjs` uses the same
`EVIDENCE_DIR` and an explicit `BASE_URL` ending in the release directory slash.
