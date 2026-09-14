import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.env.FIXTURE_ROOT || `${here}/fixtures`);
const upstream = resolve(process.env.UPSTREAM_ROOT || `${here}/../vendor/neuroglancer`);
const { readValueUint64 } = await import(pathToFileURL(`${upstream}/src/sliceview/compressed_segmentation/decode_common.ts`).href);
const pin = '3598da303d5eb865564a2f1f5123220a33f87e25';
const shape = [32, 24, 16], chunk = [16, 12, 8], resolution = [8, 8, 45];
const dimensions = { x: [8e-9, 'm'], y: [8e-9, 'm'], z: [45e-9, 'm'] };
const ids = [1n, 4294967301n, 9007199254740993n, 18446744073709551614n];
const manifest = { fixtureVersion: 1, upstreamPin: pin, shape, chunk, resolution, dimensions,
  ids: ids.map(String), files: [], datasets: [], checks: [], expectedSamples: [] };
const labels = (x, y, z) => (y + z) % 7 === 0 ? 0n : ids[Math.min(3, Math.floor(x / 8))];
const u8 = (x, y, z) => (x * 7 + y * 11 + z * 13) % 256;
const u16 = (x, y, z) => (x * 977 + y * 173 + z * 37) % 65536;
const f32 = (x, y, z) => Math.fround((x - 16) / 8 + (y - 12) / 12 + (z - 8) / 16);
async function put(path, data) {
  const content = typeof data === 'string' || Buffer.isBuffer(data) ? data : `${JSON.stringify(data, null, 2)}\n`;
  const bytes = Buffer.from(content);
  await mkdir(dirname(`${output}/${path}`), { recursive: true });
  await writeFile(`${output}/${path}`, bytes);
  manifest.files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const product = values => values.reduce((a, b) => a * b, 1);
function rawBytes(type, size, origin, value) {
  const widths = { uint8: 1, uint16: 2, float32: 4, uint64: 8 };
  const bytes = Buffer.alloc(product(size) * widths[type]);
  let offset = 0;
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = value(x + origin[0], y + origin[1], z + origin[2]);
    if (type === 'uint8') bytes.writeUInt8(v, offset);
    else if (type === 'uint16') bytes.writeUInt16LE(v, offset);
    else if (type === 'float32') bytes.writeFloatLE(v, offset);
    else bytes.writeBigUInt64LE(v, offset);
    offset += widths[type];
  }
  return bytes;
}
function compressedLabels(size, origin) {
  const block = [4, 4, 4], grid = size.map((n, axis) => Math.ceil(n / block[axis]));
  const words = Array(product(grid) * 2).fill(0);
  let blockIndex = 0;
  for (let bz = 0; bz < grid[2]; bz++) for (let by = 0; by < grid[1]; by++) for (let bx = 0; bx < grid[0]; bx++, blockIndex++) {
    const table = [], lookup = new Map(), values = [];
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const position = [bx * 4 + x, by * 4 + y, bz * 4 + z];
      const label = position.some((v, axis) => v >= size[axis]) ? 0n : labels(...position.map((v, axis) => v + origin[axis]));
      if (!lookup.has(label)) { lookup.set(label, table.length); table.push(label); }
      values.push(lookup.get(label));
    }
    const bits = [0, 1, 2, 4, 8, 16, 32].find(bits => (2 ** bits) >= table.length);
    const encodedOffset = words.length;
    for (let i = 0; i < Math.ceil(values.length * bits / 32); i++) words.push(0);
    if (bits) values.forEach((v, index) => { words[encodedOffset + Math.floor(index * bits / 32)] |= v << ((index * bits) % 32); });
    const tableOffset = words.length;
    for (const id of table) words.push(Number(id & 0xffffffffn), Number(id >> 32n));
    words[blockIndex * 2] = tableOffset | bits << 24;
    words[blockIndex * 2 + 1] = encodedOffset;
  }
  const encoded = new Uint32Array([1, ...words]);
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    assert.equal(readValueUint64(encoded, 0, size, block, [x, y, z, 0]), labels(x + origin[0], y + origin[1], z + origin[2]), 'Upstream compressed segmentation decoder disagrees');
  }
  return Buffer.from(encoded.buffer);
}
async function volume(name, type, value, { segmentation = false, compressed = false, size = shape, chunks = chunk, offset = [0, 0, 0], objects = false } = {}) {
  const scale = { key: '8_8_45', size, resolution, voxel_offset: offset, chunk_sizes: [chunks], encoding: compressed ? 'compressed_segmentation' : 'raw' };
  if (compressed) scale.compressed_segmentation_block_size = [4, 4, 4];
  const info = { '@type': 'neuroglancer_multiscale_volume', type: segmentation ? 'segmentation' : 'image', data_type: type, num_channels: 1, scales: [scale] };
  if (objects) Object.assign(info, { mesh: '../mesh', skeletons: '../skeletons', segment_properties: '../segment-properties' });
  await put(`${name}/info`, info);
  const count = size.map((n, axis) => Math.ceil(n / chunks[axis]));
  let n = 0;
  for (let z = 0; z < count[2]; z++) for (let y = 0; y < count[1]; y++) for (let x = 0; x < count[0]; x++) {
    const origin = [x, y, z].map((v, axis) => v * chunks[axis]);
    const extent = origin.map((v, axis) => Math.min(chunks[axis], size[axis] - v));
    const begin = origin.map((v, axis) => v + offset[axis]);
    const filename = begin.map((v, axis) => `${v}-${v + extent[axis]}`).join('_');
    const data = compressed ? compressedLabels(extent, origin) : rawBytes(type, extent, origin, value);
    await put(`${name}/${scale.key}/${filename}`, data); n++;
  }
  manifest.datasets.push({ name, protocol: 'precomputed', type, encoding: scale.encoding, chunks: n, size, offset, objects });
}
await volume('raw-uint8', 'uint8', u8);
await volume('raw-uint16', 'uint16', u16);
await volume('raw-float32', 'float32', f32);
await volume('segmentation-uint64', 'uint64', labels, { segmentation: true, objects: true });
await volume('compressed-segmentation-uint64', 'uint64', labels, { segmentation: true, compressed: true, objects: true });
await volume('offset-edge-uint8', 'uint8', u8, { size: [17, 13, 9], chunks: [8, 8, 4], offset: [-5, 7, 11] });
manifest.checks.push({ name: 'compressed-segmentation-upstream-decoder', passed: true, comparedVoxels: product(shape), decoder: 'src/sliceview/compressed_segmentation/decode_common.ts' });
for (const p of [[0, 1, 0], [9, 2, 3], [17, 5, 8], [25, 10, 12], [31, 23, 15]]) {
  manifest.expectedSamples.push({ position: p, uint8: u8(...p), uint16: u16(...p), float32: f32(...p), uint64: String(labels(...p)) });
}

// One shard/minishard and a single chunk; offsets are relative to the end of the 16-byte shard index.
const shardData = rawBytes('uint8', [8, 8, 8], [0, 0, 0], u8);
const shardHeader = Buffer.alloc(16), miniIndex = Buffer.alloc(24);
shardHeader.writeBigUInt64LE(BigInt(shardData.length), 0); shardHeader.writeBigUInt64LE(BigInt(shardData.length + miniIndex.length), 8);
miniIndex.writeBigUInt64LE(0n, 0); miniIndex.writeBigUInt64LE(0n, 8); miniIndex.writeBigUInt64LE(BigInt(shardData.length), 16);
await put('sharded-uint8/info', { '@type': 'neuroglancer_multiscale_volume', type: 'image', data_type: 'uint8', num_channels: 1,
  scales: [{ key: '8_8_45', size: [8, 8, 8], resolution, voxel_offset: [0, 0, 0], chunk_sizes: [[8, 8, 8]], encoding: 'raw',
    sharding: { '@type': 'neuroglancer_uint64_sharded_v1', preshift_bits: 0, hash: 'identity', minishard_bits: 0, shard_bits: 0, minishard_index_encoding: 'raw', data_encoding: 'raw' } }] });
await put('sharded-uint8/8_8_45/0.shard', Buffer.concat([shardHeader, shardData, miniIndex]));
manifest.datasets.push({ name: 'sharded-uint8', protocol: 'precomputed', type: 'uint8', encoding: 'raw', size: [8, 8, 8], sharded: true, requiresHTTPRange: true });

// Tetrahedral meshes and branching skeletons for every nonzero label, including IDs above Number.MAX_SAFE_INTEGER.
await put('mesh/info', { '@type': 'neuroglancer_legacy_mesh' });
await put('skeletons/info', { '@type': 'neuroglancer_skeletons', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], vertex_attributes: [{ id: 'radius', data_type: 'float32', num_components: 1 }] });
for (let i = 0; i < ids.length; i++) {
  const x = i * 64 + 8;
  const vertices = [[x, 48, 180], [x + 48, 48, 180], [x + 24, 144, 180], [x + 24, 96, 540]];
  const triangles = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];
  const mesh = Buffer.alloc(4 + vertices.length * 12 + triangles.length * 12);
  mesh.writeUInt32LE(vertices.length, 0);
  vertices.flat().forEach((value, index) => mesh.writeFloatLE(value, 4 + index * 4));
  triangles.flat().forEach((value, index) => mesh.writeUInt32LE(value, 4 + vertices.length * 12 + index * 4));
  await put(`mesh/${ids[i]}:0`, { fragments: [`${ids[i]}-tetrahedron`] });
  await put(`mesh/${ids[i]}-tetrahedron`, mesh);
  const points = [[x + 24, 60, 240], [x + 24, 96, 320], [x + 8, 132, 430], [x + 40, 132, 480]], edges = [[0, 1], [1, 2], [1, 3]];
  const skeleton = Buffer.alloc(8 + points.length * 12 + edges.length * 8 + points.length * 4);
  skeleton.writeUInt32LE(points.length, 0); skeleton.writeUInt32LE(edges.length, 4);
  points.flat().forEach((value, index) => skeleton.writeFloatLE(value, 8 + index * 4));
  edges.flat().forEach((value, index) => skeleton.writeUInt32LE(value, 8 + points.length * 12 + index * 4));
  points.forEach((_, index) => skeleton.writeFloatLE(6 - index, 8 + points.length * 12 + edges.length * 8 + index * 4));
  await put(`skeletons/${ids[i]}`, skeleton);
}
await put('segment-properties/info', { '@type': 'neuroglancer_segment_properties', inline: { ids: ids.map(String), properties: [
  { id: 'label', type: 'label', values: ['Small ID', 'Above uint32', 'Above safe integer', 'Near uint64 maximum'] },
  { id: 'description', type: 'description', values: ids.map(id => `Deterministic fixture segment ${id}`) },
  { id: 'confidence', type: 'number', data_type: 'float32', values: [0.25, 0.5, 0.75, 1] },
  { id: 'tags', type: 'tags', tags: ['fixture', 'large-id'], values: [[0], [0, 1], [0, 1], [0, 1]] },
] } });

const annotationCases = {
  POINT: [16, 12, 8], LINE: [5, 5, 4, 27, 19, 12], AXIS_ALIGNED_BOUNDING_BOX: [7, 6, 4, 25, 18, 12],
  ELLIPSOID: [16, 12, 8, 6, 5, 3], POLYLINE: [5, 6, 5, 16, 18, 8, 27, 6, 11],
};
for (const [type, geometry] of Object.entries(annotationCases)) {
  const name = `annotations-${type.toLowerCase().replaceAll('_', '-')}`, id = 9007199254741009n;
  const geometryBytes = Buffer.alloc(geometry.length * 4 + (type === 'POLYLINE' ? 4 : 0));
  if (type === 'POLYLINE') geometryBytes.writeUInt32LE(geometry.length / 3, 0);
  geometry.forEach((value, index) => geometryBytes.writeFloatLE(value, index * 4 + (type === 'POLYLINE' ? 4 : 0)));
  const properties = Buffer.alloc(8); properties.writeFloatLE(0.875, 0); properties.set([255, 120, 40, 255], 4);
  const record = Buffer.concat([geometryBytes, properties]), relationships = Buffer.alloc(12);
  relationships.writeUInt32LE(1, 0); relationships.writeBigUInt64LE(ids[2], 4);
  const header = Buffer.alloc(8), idBytes = Buffer.alloc(8); header.writeBigUInt64LE(1n); idBytes.writeBigUInt64LE(id);
  const list = Buffer.concat([header, record, idBytes]);
  await put(`${name}/info`, { '@type': 'neuroglancer_annotations_v1', dimensions, lower_bound: [0, 0, 0], upper_bound: shape, annotation_type: type,
    properties: [{ id: 'confidence', type: 'float32' }, { id: 'color', type: 'rgba' }], relationships: [{ id: 'segments', key: 'by-segment' }],
    by_id: { key: 'by-id' }, spatial: [{ key: 'spatial0', grid_shape: [1, 1, 1], chunk_size: shape, limit: 10 }] });
  await put(`${name}/by-id/${id}`, Buffer.concat([record, relationships]));
  await put(`${name}/by-segment/${ids[2]}`, list);
  await put(`${name}/spatial0/0_0_0`, list);
  manifest.datasets.push({ name, protocol: 'precomputed', annotationType: type, annotationId: String(id), relatedSegment: String(ids[2]) });
}

// Zarr stores z,y,x arrays in C order, giving identical voxel bytes to the precomputed x,y,z Fortran layout.
await put('zarr-v2-uint16/.zarray', { zarr_format: 2, shape: [...shape].reverse(), chunks: [...chunk].reverse(), dtype: '<u2', compressor: null, fill_value: 0, order: 'C', filters: null, dimension_separator: '.' });
await put('zarr-v2-uint16/.zattrs', { _ARRAY_DIMENSIONS: ['z', 'y', 'x'], dimension_units: ['45 nm', '8 nm', '8 nm'] });
await put('zarr-v3-uint16/zarr.json', { zarr_format: 3, node_type: 'array', shape: [...shape].reverse(), data_type: 'uint16',
  chunk_grid: { name: 'regular', configuration: { chunk_shape: [...chunk].reverse() } }, chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
  fill_value: 0, codecs: [{ name: 'bytes', configuration: { endian: 'little' } }], dimension_names: ['z', 'y', 'x'],
  attributes: { dimension_units: ['45 nm', '8 nm', '8 nm'] } });
for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
  const bytes = rawBytes('uint16', chunk, [x * chunk[0], y * chunk[1], z * chunk[2]], u16);
  await put(`zarr-v2-uint16/${z}.${y}.${x}`, bytes);
  await put(`zarr-v3-uint16/c/${z}/${y}/${x}`, bytes);
}
manifest.datasets.push({ name: 'zarr-v2-uint16', protocol: 'zarr', type: 'uint16', order: 'zyx' }, { name: 'zarr-v3-uint16', protocol: 'zarr', type: 'uint16', order: 'zyx' });

const localAnnotations = [
  { id: 'point-1', type: 'point', point: [16, 12, 8], description: 'Editable point' },
  { id: 'line-1', type: 'line', pointA: [5, 5, 4], pointB: [27, 19, 12] },
  { id: 'box-1', type: 'axis_aligned_bounding_box', pointA: [7, 6, 4], pointB: [25, 18, 12] },
  { id: 'ellipsoid-1', type: 'ellipsoid', center: [16, 12, 8], radii: [6, 5, 3] },
  { id: 'polyline-1', type: 'polyline', points: [[5, 6, 5], [16, 18, 8], [27, 6, 11]] },
];
await put('editable-annotation-state.json', { dimensions, position: [16, 12, 8], crossSectionScale: 1, projectionScale: 512, layout: '4panel',
  layers: [{ type: 'annotation', name: 'Editable annotations', source: 'local://annotations', annotations: localAnnotations }] });
manifest.files.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(`${output}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
const reloaded = JSON.parse(await readFile(`${output}/manifest.json`, 'utf8'));
for (const file of reloaded.files) assert.equal(createHash('sha256').update(await readFile(`${output}/${file.path}`)).digest('hex'), file.sha256);
console.log(JSON.stringify({ output, datasets: manifest.datasets.length, files: manifest.files.length, totalBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), upstreamDecoderVoxelsCompared: product(shape) }, null, 2));
