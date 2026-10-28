# Contributing

Keep changes in the shell (repository root) when you can. `vendor/neuroglancer/` is a snapshot of upstream source plus the patches in `patches/`. Edit it only through a patch recorded in `UPSTREAM.json`.

## Changing the engine

1. Make the change in a separate Neuroglancer checkout at the pinned tree.
2. Save the diff as `patches/NNNN-short-name.patch` and add an entry with its file(s) and reason to `UPSTREAM.json`.
3. Apply it to `vendor/neuroglancer/`.
4. Run `npm run check:engine`, `npm test` and `npm run test:browser`.

If the fix belongs upstream, open a PR there from that checkout.

## Upgrading the engine

```sh
git clone https://github.com/seung-lab/neuroglancer.git ng && cd ng
git remote add google https://github.com/google/neuroglancer.git && git fetch google
git checkout -b mobile-engine origin/spelunker
git log --oneline origin/spelunker..google/master   # Google fixes Spelunker lacks
git cherry-pick -x <commits worth taking>           # record them in UPSTREAM.json
git tag base-engine
# Re-apply local patches, one commit each, resolving conflicts:
for p in ../neuroglancer-mobile/patches/*.patch; do git apply --3way "$p" && git commit -qam "mobile: $(basename "$p" .patch)"; done
```

Then:

- `rsync -a --delete --exclude=.git --exclude=node_modules ./ ../neuroglancer-mobile/vendor/neuroglancer/`
- Regenerate each patch with `git diff <commit>^ <commit>`.
- Update `UPSTREAM.json`: set `commit`, `googleCherryPicks`, `sourceTree` (`git rev-parse base-engine^{tree}`), and any changed patch reasons.
- Update the pin in `NOTICE`.
- Check the shell against changed engine APIs, especially `default_viewer_setup.ts`. `main.js` repeats its setup steps.
- Run all checks. The browser suites also cover the patched behavior.

## Tests

`npm test` covers state and input parsing. `npm run test:browser` needs `npm start` running and runs seven suites: real-volume rendering, synthetic image/segmentation/mesh/skeleton/annotation/Zarr fixtures, workspace state, touch keyboard, volume rendering, and Spelunker tools against simulated Graphene/CAVE services. `tests/generate-parity-fixtures.mjs` regenerates the fixtures with the vendored codecs.

CI (`.github/workflows/verify.yml`) runs the type check, the unit tests, the build and the browser suites in Chromium. It does not publish.
