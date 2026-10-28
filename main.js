import 'neuroglancer';
import { makeDefaultViewer } from 'neuroglancer/unstable/ui/default_viewer.js';
import { configureDefaultViewer } from 'neuroglancer/unstable/ui/default_viewer_setup.js';
import { StateShare } from 'neuroglancer/unstable/datasource/state_share.js';
import { UrlHashBinding, encodeStateAsFragment } from 'neuroglancer/unstable/ui/url_hash_binding.js';
import { bindDefaultCopyHandler, bindDefaultPasteHandler } from 'neuroglancer/unstable/ui/default_clipboard_handling.js';
import { registerDefaultCommands } from 'neuroglancer/unstable/ui/default_commands.js';
import { bindCommandPalette } from 'neuroglancer/unstable/ui/command_palette.js';
import { bindStateEditor } from 'neuroglancer/unstable/ui/state_editor.js';
import { bindScreenshotDialog } from 'neuroglancer/unstable/ui/screenshot_menu.js';
import { bindTitle } from 'neuroglancer/unstable/ui/title.js';
import { makeLayer, deleteLayer, changeLayerName } from 'neuroglancer/unstable/layer/index.js';
import { urlSafeParse, bigintToStringJsonReplacer } from 'neuroglancer/unstable/util/json.js';
import { createAnnotationController } from './annotations.js';
import { createTouchKeyboard } from './touch-keyboard.js';
import { createSpelunkerControls } from './spelunker-controls.js';
import { DEFAULT_STATE, UPSTREAM, parseSegmentIds, finiteNumber, validateState, legacyState } from './state.js';
import './mobile.css';

const $ = id => document.getElementById(id);
let toastTimer;
function notify(message) { $('toast').textContent = String(message); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
function guard(action) { return event => { try { Promise.resolve(action(event)).catch(error => notify(error.message || error)); } catch (error) { notify(error.message || error); } }; }
function node(tag, className, text) { const result = document.createElement(tag); if (className) result.className = className; if (text !== undefined) result.textContent = text; return result; }
function button(text, action, className = '') { const result = node('button', `m-button ${className}`, text); result.type = 'button'; result.addEventListener('click', guard(action)); return result; }
function field(label, input) { const wrapper = node('label', 'm-field-label'); wrapper.append(node('span', 'm-muted', label), input); return wrapper; }
function input(value = '', type = 'text', id) { const result = node('input', 'm-field'); result.type = type; result.value = value; if (id) result.id = id; return result; }
function select(options, value, id) { const result = node('select', 'm-field'); if (id) result.id = id; for (const [v, label] of options) { const option = node('option', '', label); option.value = v; result.append(option); } result.value = value; return result; }
function row(...children) { const result = node('div', 'm-row'); result.append(...children); return result; }
function download(value, name) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, bigintToStringJsonReplacer, 2)], { type: 'application/json' })); const link = node('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

async function boot() {
  const legacy = legacyState(location.hash);
  if (legacy) history.replaceState(null, '', `#!${encodeStateAsFragment(legacy)}`);
  const viewer = window.viewer = makeDefaultViewer({ target: $('neuroglancer-container') });
  configureDefaultViewer(viewer);
  const upgradeSpelunkerState = viewer.stateUpgrader;
  let beforeStateRestore = () => {};
  viewer.stateUpgrader = state => {
    const upgraded = upgradeSpelunkerState(state); validateState(upgraded);
    beforeStateRestore(); return upgraded;
  };
  viewer.inputEventBindings.sliceView.set('at:touchtranslate1', 'translate-in-plane-via-touchtranslate');
  const hashBinding = viewer.registerDisposer(new UrlHashBinding(viewer.state, viewer.dataSourceProvider.sharedKvStoreContext, { defaultFragment: JSON.stringify(DEFAULT_STATE), upgradeState: viewer.stateUpgrader }));
  viewer.registerDisposer(hashBinding.parseError.changed.add(() => { if (hashBinding.parseError.value) notify(`Cannot open state: ${hashBinding.parseError.value.message}`); }));
  hashBinding.updateFromUrlHash();
  viewer.registerDisposer(bindTitle(viewer.title));
  bindDefaultCopyHandler(viewer); bindDefaultPasteHandler(viewer);
  registerDefaultCommands(viewer.commandRegistry); bindCommandPalette(viewer);
  bindStateEditor(viewer); bindScreenshotDialog(viewer);
  let panelName, advanced = false, selectMode = false, playback, mountDisposer, previousTool = 'inspect';
  const touchKeyboard = createTouchKeyboard(viewer, { notify });
  let spelunker;
  const exportState = () => JSON.parse(JSON.stringify(viewer.state.toJSON(), bigintToStringJsonReplacer));
  const annotations = createAnnotationController(viewer, { notify, onActivate: () => spelunker?.cancel(), onChange: () => queueMicrotask(() => {
    const mode = annotations.mode, active = mode !== 'inspect';
    $('annotations-toggle').setAttribute('aria-pressed', String(active));
    $('active-tool-strip').hidden = !active; $('active-tool-label').textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    if (active && mode !== previousTool && panelName === 'annotations') closePanel();
    if (active) {
      selectMode = false; $('select-toggle').setAttribute('aria-pressed', 'false');
      if (!advanced) for (const state of panelStates()) state.location.visible = false;
    }
    previousTool = mode;
  }) });
  const nativeShare = viewer.registerDisposer(new StateShare(viewer));
  const shareShort = () => nativeShare.button.click();
  spelunker = createSpelunkerControls(viewer, { notify, closePanel, touchKeyboard, layerDetails, onActivate: () => {
    annotations.cancel(); selectMode = false; $('select-toggle').setAttribute('aria-pressed', 'false');
  }, onActivated: hideNativePanelsForTool, onCanvasAction: hideNativePanelsForTool });
  viewer.registerDisposer(() => spelunker.dispose());
  beforeStateRestore = () => { stopPlayback(); annotations.cancel(); spelunker.cancel(); };
  const panelStates = () => [viewer.layerListPanelState, viewer.selectedLayer, viewer.selectionDetailsState, viewer.settingsPanelState, viewer.helpPanelState, viewer.statisticsDisplayState];
  function hideNativePanelsForTool() { if (!advanced) for (const state of panelStates()) state.location.visible = false; }
  function setAdvanced(value) {
    advanced = value; document.body.classList.toggle('advanced-mode', value);
    viewer.uiConfiguration.showTopBar.value = value; viewer.uiConfiguration.showLayerPanel.value = value;
    $('advanced-toggle').setAttribute('aria-pressed', String(value));
    $('advanced-toggle').setAttribute('aria-label', value ? 'Hide the full Neuroglancer controls' : 'Show the full Neuroglancer controls');
    viewer.display.scheduleRedraw();
  }
  function closePanel() {
    mountDisposer?.(); mountDisposer = undefined; panelName = undefined;
    $('mobile-panel').hidden = true; document.body.classList.remove('mobile-panel-open');
    for (const id of ['layers-toggle', 'workspace-toggle', 'help-toggle', 'annotations-toggle']) $(id).setAttribute('aria-expanded', 'false');
  }
  function nativePanel(state) {
    closePanel();
    if (!advanced) {
      for (const other of panelStates()) if (other !== state) other.location.visible = false;
      state.location.restoreState({ ...state.location.value, side: 'bottom', row: 0, col: 0, size: Math.round(innerHeight * 0.52), visible: true });
    } else state.location.visible = true;
  }
  // Upstream opens an empty viewer with a sourceless `new` layer for its add-layer dialog.
  function isPlaceholder(managed) { return managed.layer?.type === 'new' && !managed.toJSON()?.source; }
  function dataLayers() { return viewer.layerManager.managedLayers.filter(managed => !isPlaceholder(managed)); }
  function layerDetails(managed) { viewer.selectedLayer.layer = managed; nativePanel(viewer.selectedLayer); }
  function restoreState(state) {
    validateState(state);
    const upgraded = viewer.stateUpgrader(structuredClone(state)); validateState(upgraded);
    const previous = exportState(); annotations.cancel(); spelunker.cancel(); stopPlayback();
    try { viewer.state.reset(); viewer.state.restoreState(upgraded); }
    catch (error) { viewer.state.reset(); viewer.state.restoreState(previous); throw error; }
    updateControls(); if (panelName) openPanel(panelName); return exportState();
  }
  function addLayer(name, spec) {
    if (!String(name).trim()) throw new Error('Enter a layer name.');
    const managed = makeLayer(viewer.layerSpecification, viewer.layerManager.getUniqueLayerName(String(name).trim()), spec);
    viewer.layerSpecification.add(managed); viewer.selectedLayer.layer = managed;
    if (panelName === 'layers') openPanel('layers'); return managed;
  }
  function setSegments(name, ids) {
    const parsed = parseSegmentIds(ids), managed = viewer.layerManager.getLayerByName(name);
    const group = managed?.layer?.displayState?.segmentationGroupState?.value;
    if (!group) throw new Error('Select a segmentation layer.');
    group.visibleSegments.clear(); for (const id of parsed) group.visibleSegments.add(BigInt(id));
    return parsed;
  }
  function range(label, trackable, min = 0, max = 1, step = 0.01) {
    const control = input('', 'range'); control.min = min; control.max = max; control.step = step; control.value = trackable.value; control.setAttribute('aria-label', label);
    const value = node('output', 'm-muted', String(trackable.value));
    control.addEventListener('input', guard(() => { trackable.value = Number(control.value); value.textContent = control.value; }));
    return field(label, row(control, value));
  }
  function toggle(label, trackable) {
    const control = input('', 'checkbox'); control.checked = trackable.value; control.addEventListener('change', () => { trackable.value = control.checked; });
    const result = node('label', 'm-toggle'); result.append(control, document.createTextNode(label)); return result;
  }
  function renderLayers(content) {
    content.append(node('p', 'm-muted', 'Each layer uses Neuroglancer’s full data, rendering, and editing controls.'));
    const list = node('div', 'm-list');
    viewer.layerManager.managedLayers.forEach((managed, index) => {
      if (isPlaceholder(managed)) return;
      const card = node('section', 'm-card'), userLayer = managed.layer;
      const name = input(managed.name); name.setAttribute('aria-label', `Layer name ${managed.name}`);
      name.addEventListener('change', guard(() => changeLayerName(managed, name.value.trim() || managed.name)));
      const visible = input('', 'checkbox'); visible.checked = managed.visible; visible.setAttribute('aria-label', `Show ${managed.name}`); visible.addEventListener('change', () => managed.setVisible(visible.checked));
      card.append(row(visible, name), node('p', 'm-muted', `${managed.toJSON()?.type || 'Detecting type'} · ${managed.isReady() ? 'ready' : 'loading / see layer status'}`));
      const up = button('↑', () => { viewer.layerManager.reorderManagedLayer(index, index - 1); openPanel('layers'); }); up.disabled = index === 0; up.setAttribute('aria-label', `Move ${managed.name} up`);
      const down = button('↓', () => { viewer.layerManager.reorderManagedLayer(index, index + 1); openPanel('layers'); }); down.disabled = index === viewer.layerManager.managedLayers.length - 1; down.setAttribute('aria-label', `Move ${managed.name} down`);
      card.append(row(button('Full layer controls', () => layerDetails(managed)), up, down, button('Remove', () => { const removed = managed.toJSON(); deleteLayer(managed); lastRemoved = removed; openPanel('layers'); }, 'm-danger')));
      if (userLayer?.opacity) card.append(range('Opacity', userLayer.opacity));
      if (userLayer?.displayState?.segmentationGroupState) {
        const display = userLayer.displayState, group = display.segmentationGroupState.value;
        const ids = input(Array.from(group.visibleSegments, x => x.toString()).join(', ')); ids.setAttribute('aria-label', `Visible segment IDs for ${managed.name}`);
        card.append(field('Visible segment IDs (full uint64 precision)', ids), button('Apply segment IDs', () => { setSegments(managed.name, ids.value); notify('Visible segments updated'); }));
        if (group.segmentQuery) { const query = input(group.segmentQuery.value); query.setAttribute('aria-label', 'Segment search'); card.append(field('Search properties or IDs', query), button('Search segments', () => { group.segmentQuery.value = query.value; spelunker.openLayerControls(managed.name, 'segments'); })); }
        for (const [label, key] of [['Selected opacity', 'selectedAlpha'], ['Other segments opacity', 'notSelectedAlpha'], ['3D opacity', 'objectAlpha']]) if (display[key]) card.append(range(label, display[key]));
      }
      list.append(card);
    });
    content.append(list);
    if (lastRemoved) content.append(button('Undo last removal', () => { addLayer(lastRemoved.name, lastRemoved); lastRemoved = undefined; openPanel('layers'); }));
    const form = node('form', 'm-card'), name = input('', 'text', 'layer-name'), source = input('', 'text', 'layer-source');
    name.placeholder = 'Layer name'; source.placeholder = 'precomputed://, zarr://, n5://, nifti://…'; source.autocapitalize = 'off'; source.spellcheck = false;
    const type = select([['auto', 'Detect from source'], ['image', 'Image'], ['segmentation', 'Segmentation, meshes, skeletons'], ['annotation', 'Annotation']], 'auto', 'layer-type');
    const submit = button('Add layer', () => {}); submit.type = 'submit'; submit.id = 'add-layer';
    form.append(node('h3', '', 'Add a layer'), field('Name', name), field('Source', source), field('Type', type), submit);
    form.addEventListener('submit', guard(event => { event.preventDefault(); if (!source.value.trim()) throw new Error('Enter a data source.'); addLayer(name.value || 'New layer', { source: source.value.trim(), ...(type.value === 'auto' ? {} : { type: type.value }) }); }));
    content.append(form, button('Native layer list and data-source browser', () => nativePanel(viewer.layerListPanelState)));
  }
  let lastRemoved;
  function renderWorkspace(content) {
    content.append(node('h3', '', 'Complete Neuroglancer workspace'));
    content.append(row(button('Full controls', () => { closePanel(); setAdvanced(true); }), button('Commands', () => { closePanel(); viewer.element.dispatchEvent(new CustomEvent('action:open-command-palette', { bubbles: true, cancelable: true })); })));
    content.append(button('Touch keyboard and mouse actions', () => { closePanel(); touchKeyboard.open(); }));
    content.append(button('Spelunker tools', () => openPanel('spelunker')));
    content.append(row(button('Settings', () => nativePanel(viewer.settingsPanelState)), button('Selection details', () => nativePanel(viewer.selectionDetailsState)), button('Performance', () => nativePanel(viewer.statisticsDisplayState)), button('Screenshot', () => { closePanel(); viewer.showScreenshotDialog(); })));
    content.append(toggle('Axis lines', viewer.showAxisLines), toggle('Scale bar', viewer.showScaleBar), toggle('Slices in 3D', viewer.showPerspectiveSliceViews));
    const stateCard = node('section', 'm-card'); stateCard.append(node('h3', '', 'State and sharing'));
    const stateText = node('textarea', 'm-field'); stateText.rows = 4; stateText.placeholder = 'Paste Neuroglancer JSON or a viewer URL'; stateText.setAttribute('aria-label', 'Import viewer state'); stateText.id = 'state-import';
    stateCard.append(stateText, row(button('Import state', () => importText(stateText.value)), button('Export JSON', () => download(exportState(), 'neuroglancer-state.json')), button('Native state editor', () => { closePanel(); viewer.editJsonState(); })));
    const upload = input('', 'file', 'state-file'); upload.accept = '.json,application/json'; upload.addEventListener('change', guard(async () => { if (upload.files[0]) { if (upload.files[0].size > 32 * 1024 * 1024) throw new Error('State file exceeds 32 MiB.'); await importText(await upload.files[0].text()); } }));
    stateCard.append(field('Import a JSON file', upload), button('Share current view', share), button('Create CAVE short link', shareShort), node('p', 'm-muted', 'Short links save this workspace to the CAVE state service. Sign-in and dataset permissions may be required.')); content.append(stateCard);
    const bookmarks = node('section', 'm-card'), name = input('', 'text', 'bookmark-name'); name.placeholder = 'Saved view name';
    bookmarks.append(node('h3', '', 'Saved views on this device'), field('Name', name), button('Save view', () => { if (!name.value.trim()) throw new Error('Name this view.'); const saved = readBookmarks(); saved[name.value.trim()] = exportState(); localStorage.setItem('neuroglancer-mobile-bookmarks-v2', JSON.stringify(saved)); openPanel('workspace'); }));
    for (const [key, state] of Object.entries(readBookmarks())) bookmarks.append(row(button(key, () => { restoreState(state); closePanel(); }), button(`Delete ${key}`, () => { const saved = readBookmarks(); delete saved[key]; localStorage.setItem('neuroglancer-mobile-bookmarks-v2', JSON.stringify(saved)); openPanel('workspace'); }, 'm-danger')));
    content.append(bookmarks);
    const orientation = node('section', 'm-card'); orientation.append(node('h3', '', 'Oblique and 3D orientation'));
    for (const [label, target] of [['Slice quaternion', viewer.crossSectionOrientation], ['3D quaternion', viewer.projectionOrientation]]) {
      const values = input(Array.from(target.orientation).join(', ')); values.setAttribute('aria-label', label);
      orientation.append(field(`${label} (x, y, z, w)`, values), button(`Apply ${label.toLowerCase()}`, () => {
        const q = values.value.split(/[\s,]+/).filter(Boolean).map(x => finiteNumber(x)); const norm = Math.hypot(...q);
        if (q.length !== 4 || norm === 0) throw new Error('Enter four quaternion components with a nonzero norm.'); target.restoreState(q.map(x => x / norm));
      }));
    }
    content.append(orientation, node('p', 'm-muted', `Spelunker ${UPSTREAM.version} · ${UPSTREAM.commit.slice(0, 12)}. Data sources, shaders, transforms, dimensions, volume rendering, mesh and skeleton controls, tools, and custom layouts are available through Full controls.`));
  }
  function readBookmarks() { try { const value = JSON.parse(localStorage.getItem('neuroglancer-mobile-bookmarks-v2') || '{}'); return value && !Array.isArray(value) && typeof value === 'object' ? value : {}; } catch { return {}; } }
  async function importText(text) {
    text = text.trim(); if (!text) throw new Error('Paste a viewer state or URL.');
    if (/^https?:\/\//.test(text)) {
      const url = new URL(text); if (!url.hash) throw new Error('A viewer URL must include its state fragment.');
      const legacy = legacyState(url.hash); if (legacy) { restoreState(legacy); closePanel(); return; }
      location.hash = url.hash; closePanel(); return;
    }
    if (text.startsWith('#!')) { location.hash = text; closePanel(); return; }
    restoreState(urlSafeParse(text)); closePanel(); notify('State imported');
  }
  function renderHelp(content) {
    content.append(node('h3', '', 'Touch controls'), node('p', '', 'Drag one finger to pan a slice. Pinch to zoom. Rotate two fingers for an oblique view. Drag in 3D to rotate. Use the section slider or arrows to move through the stack.'));
    content.append(node('p', '', 'Turn on Select, then tap a segment. Double-tap also selects using the native controls. Long press centers the view. Annotate provides point, line, box, ellipsoid, polyline, move, delete, finish, cancel, and undo controls.'));
    content.append(node('p', '', 'Coordinates are in the current Neuroglancer dimensions. The section axis follows XY, XZ, or YZ when chosen. Imported multidimensional and custom layouts remain native viewer states.'));
    content.append(node('p', '', 'Full controls opens the complete upstream interface, including advanced data sources, custom shaders, transforms, segmentation queries and equivalences, linked views, tool palettes, annotation schemas, and volume rendering.'));
    content.append(node('p', '', 'Workspace → Spelunker tools provides proofreading and annotation-review actions. A Graphene segmentation source is required for merge, split, find path, and historical segmentation. The native Graph tab provides Time and its editing locks. CAVE services enforce account permissions and terms of use.'));
    content.append(button('All native commands and help', () => nativePanel(viewer.helpPanelState)));
  }
  function openPanel(name) {
    closePanel(); panelName = name; $('mobile-panel').hidden = false; document.body.classList.add('mobile-panel-open');
    $('panel-title').textContent = { layers: 'Layers', workspace: 'Workspace', help: 'Help', annotations: 'Annotations', spelunker: 'Spelunker tools' }[name] || name;
    $(`${name}-toggle`)?.setAttribute('aria-expanded', 'true');
    const content = $('panel-content'); content.replaceChildren();
    if (name === 'layers') renderLayers(content); else if (name === 'workspace') renderWorkspace(content); else if (name === 'help') renderHelp(content); else if (name === 'annotations') mountDisposer = annotations.mount(content); else if (name === 'spelunker') mountDisposer = spelunker.render(content);
  }
  async function share() {
    const url = new URL(location.href); url.hash = `!${encodeStateAsFragment(exportState())}`;
    if (navigator.share) { try { await navigator.share({ title: viewer.title.value || 'Neuroglancer Mobile', url: url.href }); return; } catch (error) { if (error.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url.href); notify('View link copied'); }
    catch { openPanel('workspace'); const text = $('state-import'); text.value = url.href; text.focus(); text.select(); notify('Copy the selected view link'); }
  }
  function axisIndex() { const names = viewer.coordinateSpace.value.names; return Math.max(0, names.indexOf($('axis-select').value)); }
  function moveSection(value) { const next = new Float32Array(viewer.position.value), axis = axisIndex(), bounds = viewer.coordinateSpace.value.bounds; let v = finiteNumber(value, 'Section'); const lo = bounds.lowerBounds[axis], hi = bounds.upperBounds[axis]; if (Number.isFinite(lo)) v = Math.max(lo, v); if (Number.isFinite(hi)) v = Math.min(Math.ceil(hi) - 1, v); next[axis] = v; viewer.position.value = next; }
  function stepSection(direction) { moveSection(viewer.position.value[axisIndex()] + Number($('slice-step').value) * direction); }
  function stopPlayback() { clearInterval(playback); playback = undefined; $('play').setAttribute('aria-pressed', 'false'); $('play').setAttribute('aria-label', 'Play sections'); $('play').querySelector('use').setAttribute('href', '#m-i-play'); }
  function updateControls() {
    const space = viewer.coordinateSpace.value, position = viewer.position.value;
    document.querySelector('.m-brand-subtitle').textContent = dataLayers()[0]?.name || 'Volume workspace';
    const keys = space.names.join('|');
    if ($('axis-select').dataset.names !== keys && space.rank) {
      const previous = $('axis-select').value; $('axis-select').replaceChildren(); space.names.forEach(name => { const option = node('option', '', name.toUpperCase()); option.value = name; $('axis-select').append(option); });
      $('axis-select').value = space.names.includes(previous) ? previous : space.names[Math.min(2, space.rank - 1)]; $('axis-select').dataset.names = keys;
    }
    for (const [i, name] of ['x', 'y', 'z'].entries()) {
      const element = $(`coord-${name}`); if (document.activeElement !== element) element.value = Number.isFinite(position[i]) ? Number(position[i].toFixed(3)) : 0;
      element.disabled = i >= space.rank; element.previousElementSibling.textContent = space.names[i]?.toUpperCase() || name.toUpperCase();
    }
    for (const id of ['slice-slider', 'slice-number', 'slice-prev', 'slice-next', 'play', 'fit', 'home']) $(id).disabled = !space.rank;
    if (!space.rank) stopPlayback();
    const axis = axisIndex(), lo = space.bounds.lowerBounds[axis], hi = space.bounds.upperBounds[axis];
    const slider = $('slice-slider'); slider.min = Number.isFinite(lo) ? Math.floor(lo) : -1000000; slider.max = Number.isFinite(hi) ? Math.ceil(hi) - 1 : 1000000;
    if (document.activeElement !== slider) slider.value = position[axis] || 0;
    if (document.activeElement !== $('slice-number')) $('slice-number').value = Math.round(position[axis] || 0);
    const layout = viewer.layout.toJSON(); const kind = typeof layout === 'string' ? layout : layout?.type;
    if (document.activeElement !== $('layout-select')) $('layout-select').value = kind || '';
  }
  $('panel-close').onclick = closePanel;
  for (const name of ['layers', 'workspace', 'help', 'annotations']) $(`${name}-toggle`).onclick = guard(() => panelName === name ? closePanel() : openPanel(name));
  $('advanced-toggle').onclick = () => { closePanel(); setAdvanced(!advanced); };
  $('share').onclick = guard(share);
  $('layout-select').onchange = guard(() => { viewer.layout.restoreState($('layout-select').value); const axis = { xy: 'z', xz: 'y', yz: 'x', 'xy-3d': 'z', 'xz-3d': 'y', 'yz-3d': 'x' }[$('layout-select').value]; if (axis && viewer.coordinateSpace.value.names.includes(axis)) $('axis-select').value = axis; updateControls(); });
  $('axis-select').onchange = updateControls;
  $('slice-number').onchange = guard(() => moveSection($('slice-number').value));
  $('slice-slider').oninput = guard(() => moveSection($('slice-slider').value));
  $('slice-prev').onclick = guard(() => stepSection(-1)); $('slice-next').onclick = guard(() => stepSection(1));
  $('play').onclick = () => { if (playback) return stopPlayback(); $('play').setAttribute('aria-pressed', 'true'); $('play').setAttribute('aria-label', 'Pause sections'); $('play').querySelector('use').setAttribute('href', '#m-i-pause'); playback = setInterval(() => { if (!viewer.isReady()) return; const previous = viewer.position.value[axisIndex()]; try { stepSection(1); } catch (error) { stopPlayback(); notify(error.message); return; } if (viewer.position.value[axisIndex()] === previous) stopPlayback(); }, 200); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); });
  $('coordinate-form').onsubmit = event => { event.preventDefault(); guard(() => { const next = new Float32Array(viewer.position.value); ['x', 'y', 'z'].forEach((name, i) => { if (i < next.length) next[i] = finiteNumber($(`coord-${name}`).value, name); }); viewer.position.value = next; })(event); };
  function zoom(factor) { const target = $('layout-select').value === '3d' ? viewer.projectionScale : viewer.crossSectionScale; target.value = Math.max(1e-6, Math.min(1e12, target.value * factor)); }
  $('zoom-in').onclick = () => zoom(0.5); $('zoom-out').onclick = () => zoom(2);
  $('home').onclick = () => { $('fit').click(); $('orientation-reset').click(); };
  $('orientation-reset').onclick = () => { viewer.crossSectionOrientation.reset(); viewer.projectionOrientation.reset(); };
  $('fit').onclick = guard(() => {
    const space = viewer.coordinateSpace.value, bounds = space.bounds, position = new Float32Array(viewer.position.value), extents = [];
    for (const i of viewer.displayDimensionRenderInfo.value.displayDimensionIndices) { const lo = bounds.lowerBounds[i], hi = bounds.upperBounds[i]; if (Number.isFinite(lo) && Number.isFinite(hi)) { position[i] = (lo + hi) / 2; extents.push((hi - lo) * space.scales[i]); } }
    if (!extents.length) throw new Error('The loaded data has no bounds to fit yet.'); viewer.position.value = position;
    const physical = viewer.crossSectionScale.canonicalVoxelPhysicalSize; viewer.crossSectionScale.value = Math.max(...extents) / (Math.min($('neuroglancer-container').clientWidth, $('neuroglancer-container').clientHeight) * physical) * 1.1;
    viewer.projectionScale.value = Math.max(...extents) / physical * 1.5;
  });
  $('screenshot').onclick = guard(() => viewer.showScreenshotDialog());
  $('tool-finish').onclick = guard(() => annotations.finish()); $('tool-undo').onclick = guard(() => annotations.undo()); $('tool-cancel').onclick = () => annotations.cancel();
  $('select-toggle').onclick = () => { selectMode = !selectMode; annotations.setTool('inspect'); $('select-toggle').setAttribute('aria-pressed', String(selectMode)); notify(selectMode ? 'Tap a segment to select it' : 'Pan mode'); };
  // Native panels remain the pick/render authority. Pointer handling only maps short taps to native actions.
  const pointers = new Map(); let multiTouch = false;
  $('neuroglancer-container').addEventListener('pointerdown', event => { pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, time: performance.now() }); if (pointers.size > 1) multiTouch = true; }, true);
  $('neuroglancer-container').addEventListener('pointercancel', event => { pointers.delete(event.pointerId); if (!pointers.size) multiTouch = false; }, true);
  // A release outside the container never reaches it; drop that pointer so later taps are not treated as multi-touch.
  window.addEventListener('pointerup', event => { if (!$('neuroglancer-container').contains(event.target)) { pointers.delete(event.pointerId); if (!pointers.size) multiTouch = false; } }, true);
  $('neuroglancer-container').addEventListener('pointerup', guard(async event => {
    const start = pointers.get(event.pointerId); pointers.delete(event.pointerId); const multiple = multiTouch; if (!pointers.size) multiTouch = false;
    if (!start || multiple || performance.now() - start.time > 600 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
    const panel = Array.from(viewer.display.panels).find(panel => typeof panel.handleMouseMove === 'function' && panel.element.contains(event.target));
    if (!panel) return;
    if (spelunker.handleTap(panel, event)) return;
    if (annotations.mode !== 'inspect' || panelName === 'annotations') await annotations.handleTap(panel, event);
    else if (selectMode) { panel.handleMouseMove(event.clientX, event.clientY); viewer.mouseState.updateUnconditionally(); panel.element.dispatchEvent(new CustomEvent('action:select', { bubbles: true, cancelable: true, detail: { originalEvent: event } })); }
  }), true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && panelName) closePanel(); });
  const observer = new ResizeObserver(() => { for (const [selector, property] of [['.m-header', '--m-header-height'], ['.m-bottom', '--m-footer-height']]) document.documentElement.style.setProperty(property, `${document.querySelector(selector).getBoundingClientRect().height}px`); viewer.display.scheduleRedraw(); });
  observer.observe(document.querySelector('.m-header')); observer.observe(document.querySelector('.m-bottom'));
  let updateQueued = false;
  viewer.state.changed.add(() => { if (!updateQueued) { updateQueued = true; requestAnimationFrame(() => { updateQueued = false; updateControls(); }); } });
  setAdvanced(false); updateControls();
  window.neuroglancerMobile = {
    snapshot: () => ({ ready: viewer.isReady(), position: Array.from(viewer.position.value), layout: viewer.layout.toJSON(), layers: viewer.layerManager.managedLayers.map(layer => ({ name: layer.name, ready: layer.isReady(), ...layer.toJSON() })), state: exportState(), upstream: UPSTREAM }),
    restoreState, exportState, openPanel, closePanel, setSegments, addLayer, annotations, touchKeyboard, spelunker, setAdvanced, share, shareShort,
  };
  $('boot-status').hidden = true;
}
$('reload').onclick = () => location.reload();
boot().catch(error => { console.error(error); $('boot-status').hidden = true; $('fatal-error').hidden = false; $('fatal-message').textContent = error.message || String(error); });
