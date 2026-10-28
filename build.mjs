import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';

const root = import.meta.dirname;
const upstream = resolve(root, process.env.NG_ENGINE_DIR || 'vendor/neuroglancer');
const { rspack, HtmlRspackPlugin, DefinePlugin } = await import(pathToFileURL(join(upstream, 'node_modules/@rspack/core/dist/index.js')));
const pin = JSON.parse(await readFile(join(root, 'UPSTREAM.json')));
const { version } = JSON.parse(await readFile(join(root, 'package.json')));
const stateServers = JSON.parse(await readFile(join(upstream, 'config/state_servers.json')));
const inputBindings = JSON.parse(await readFile(join(upstream, 'config/custom-keybinds.json')));
const upstreamConfig = (await import(pathToFileURL(join(upstream, 'rspack.config.ts')))).default;
const config = upstreamConfig({}, { mode: 'production' });
config.entry = { main: join(root, 'main.js') };
config.output = { ...config.output, path: join(root, 'dist'), publicPath: 'auto', clean: true };
config.devtool = false;
config.plugins = config.plugins.filter(p => !['HtmlRspackPlugin', 'ProgressPlugin'].includes(p.constructor.name));
config.plugins.push(new HtmlRspackPlugin({ template: join(root, 'index.html'), filename: 'index.html', title: 'Neuroglancer Mobile' }));
config.plugins.push(new DefinePlugin({
  STATE_SERVERS: JSON.stringify(stateServers),
  NEUROGLANCER_CUSTOM_INPUT_BINDINGS: JSON.stringify(inputBindings),
  NEUROGLANCER_SEGMENT_LIST_COLOR_WIDGET: 'true',
  NEUROGLANCER_BUILD_INFO: JSON.stringify({ tag: `Spelunker ${pin.commit.slice(0, 12)}`, url: `${pin.repository}/commit/${pin.commit}`, branch: pin.branch }),
}));
config.resolve = { ...config.resolve, alias: {
  'neuroglancer$': join(upstream, 'src/main_module.ts'),
  'neuroglancer/unstable': join(upstream, 'src'),
}, extensionAlias: { '.js': ['.ts', '.js'], '.mjs': ['.mts', '.mjs'] } };
config.optimization = { ...config.optimization, minimize: true };
const compiler = rspack(config);
await new Promise((resolveBuild, reject) => compiler.run(async (error, stats) => {
  if (error) return reject(error);
  const summary = stats.toJson({ all: false, errors: true, warnings: true, assets: true, timings: true, modules: true });
  try {
    const evidence = resolve(root, process.env.EVIDENCE_DIR || 'test-results');
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, 'build-stats.json'), JSON.stringify(summary, null, 2));
  } catch (writeError) { compiler.close(() => reject(writeError)); return; }
  if (stats.hasErrors()) { compiler.close(() => reject(new Error(stats.toString({ all: false, errors: true })))); return; }
  console.log(stats.toString({ colors: false, all: false, assets: true, timings: true, warnings: true }));
  compiler.close(closeError => closeError ? reject(closeError) : resolveBuild());
}));
await copyFile(join(root, 'UPSTREAM-LICENSE'), join(root, 'dist/LICENSE.txt'));
await copyFile(join(root, 'UPSTREAM.json'), join(root, 'dist/upstream.json'));
await copyFile(join(root, 'icon.svg'), join(root, 'dist/icon.svg'));
await writeFile(join(root, 'dist/version.json'), JSON.stringify({ version, builtAt: new Date().toISOString(), upstream: pin.commit, engine: 'spelunker', repository: pin.repository, stateServers, segmentListColorWidget: true }, null, 2));
