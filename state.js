import upstream from './UPSTREAM.json' with { type: 'json' };
export const UPSTREAM = Object.freeze({ version: upstream.version, commit: upstream.commit, repository: upstream.repository, branch: upstream.branch });
// Like stock Neuroglancer, the app opens without data and shows the native
// new-layer source dialog. The limits are phone-sized device settings.
export const DEFAULT_STATE = {
  title: 'Neuroglancer Mobile', layers: [],
  gpuMemoryLimit: 134217728, systemMemoryLimit: 268435456, concurrentDownloads: 6,
};
// The original prototype only viewed MEC; its #source= links omit everything
// else, so they are translated against this view. Tests also use it as the
// live public volume.
const PROTOTYPE_SOURCE = 'precomputed://https://c10s.pni.princeton.edu/mec_alignment_2025-09/alignment/img/v2';
export const PROTOTYPE_STATE = {
  ...DEFAULT_STATE, title: 'MEC · Neuroglancer Mobile', layout: 'xy', dimensions: { x: [16e-9, 'm'], y: [16e-9, 'm'], z: [45e-9, 'm'] },
  position: [131072, 98304, 5000], crossSectionScale: 8, projectionScale: 327680,
  layers: [{ type: 'image', name: 'MEC alignment', source: PROTOTYPE_SOURCE }],
};
export function parseSegmentIds(value) {
  const parts = Array.isArray(value) ? value : String(value).trim().split(/[\s,;]+/).filter(Boolean);
  return [...new Set(parts.map(part => {
    if (typeof part === 'number' && !Number.isSafeInteger(part)) throw new Error('Large segment IDs must be decimal strings.');
    const text = String(part);
    if (!/^\d+$/.test(text)) throw new Error(`Invalid segment ID: ${text}`);
    const id = BigInt(text);
    if (id > 18446744073709551615n) throw new Error('Segment IDs must fit in uint64.');
    return id.toString();
  }))];
}
export function finiteNumber(value, label = 'Coordinate') {
  if (String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error(`${label} must be a finite number.`);
  return Number(value);
}
export function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a Neuroglancer state object.');
  if (value.layers !== undefined && (!value.layers || typeof value.layers !== 'object')) throw new Error('State layers must be an array or a named layer map.');
  if (value.position !== undefined && (!Array.isArray(value.position) || value.position.some(v => !Number.isFinite(v)))) throw new Error('State coordinates must be finite numbers.');
  return value;
}
export function legacyState(hash) {
  if (!hash.startsWith('#source=')) return undefined;
  const params = new URLSearchParams(hash.slice(1)), state = structuredClone(PROTOTYPE_STATE);
  state.layers[0].source = params.get('source') || PROTOTYPE_SOURCE;
  for (const [index, key, scale] of [[0, 'x', 16], [1, 'y', 16], [2, 'z', 1]]) {
    if (params.has(key)) state.position[index] = finiteNumber(params.get(key), key) / scale;
  }
  if (params.has('nm')) state.crossSectionScale = Math.max(0.001, finiteNumber(params.get('nm'), 'Scale') / 16);
  return state;
}
