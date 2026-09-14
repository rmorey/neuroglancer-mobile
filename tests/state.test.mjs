import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSegmentIds, finiteNumber, validateState, legacyState, DEFAULT_STATE } from '../state.js';
test('uint64 segment input retains precision, deduplicates and normalizes IDs', () => {
  assert.deepEqual(parseSegmentIds('1, 9007199254740993;18446744073709551615 001'), ['1', '9007199254740993', '18446744073709551615']);
  assert.deepEqual(parseSegmentIds(''), []);
  for (const ids of ['-1', '1.5', '1e4', '18446744073709551616', [9007199254740993]]) assert.throws(() => parseSegmentIds(ids));
});
test('coordinate inputs reject blank and nonfinite values', () => {
  assert.equal(finiteNumber('-1.25'), -1.25);
  for (const value of ['', ' ', 'NaN', 'Infinity']) assert.throws(() => finiteNumber(value));
});
test('state validation preserves upstream extensions and multidimensional layouts', () => {
  const state = { position: [1, 2, 3, 4], layers: [], layout: { type: 'row', children: [] }, arbitraryUpstreamProperty: { enabled: true } };
  assert.equal(validateState(state), state);
  for (const value of [[], null, { layers: {} }, { position: [NaN] }]) assert.throws(() => validateState(value));
});
test('original prototype URLs convert physical XY and scale into native canonical voxels', () => {
  const state = legacyState('#source=precomputed%3A%2F%2Fhttps%3A%2F%2Fexample.org%2Fdata&x=2097152&y=1572864&z=5000&nm=128');
  assert.deepEqual(state.position, DEFAULT_STATE.position); assert.equal(state.crossSectionScale, 8);
  assert.equal(state.layers[0].source, 'precomputed://https://example.org/data');
  assert.equal(legacyState('#!{}'), undefined);
  assert.throws(() => legacyState('#source=x&x=NaN'));
});
