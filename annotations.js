import { AnnotationSource, AnnotationType, annotationToJson } from 'neuroglancer/unstable/annotation/index.js';
import { getAnnotationTypeRenderHandler } from 'neuroglancer/unstable/annotation/type_handler.js';
import { getSelectedAnnotation } from 'neuroglancer/unstable/annotation/selection.js';
import { makeLayer } from 'neuroglancer/unstable/layer/index.js';
import { getChunkPositionFromCombinedGlobalLocalPositions } from 'neuroglancer/unstable/render_coordinate_transform.js';

const TOOL_IDS = {
  point: 'annotatePoint', line: 'annotateLine', box: 'annotateBoundingBox',
  ellipsoid: 'annotateSphere', polyline: 'annotatePolyline',
};
const MODES = { inspect: 'Select', point: 'Point', line: 'Line', box: 'Box', ellipsoid: 'Ellipsoid', polyline: 'Polyline', move: 'Move handle', delete: 'Delete' };
const HELP = {
  inspect: 'Tap an annotation to select it. Edit its coordinates, description, properties, or related segments below.',
  point: 'Tap the image to place a point. Each tap adds one annotation.',
  line: 'Tap the start, then the end of the line.',
  box: 'Tap opposite corners of the bounding box. Change section between taps for a 3D box.',
  ellipsoid: 'Tap the center, then a corner defining the radii. Change section between taps for depth.',
  polyline: 'Tap each vertex, then Finish. Undo removes the last vertex while drawing.',
  move: 'Tap an annotation or one of its handles, then tap its destination. Coordinates below also allow precise edits.',
  delete: 'Tap an annotation to delete it. Undo restores it.',
};
const HISTORY_LIMIT = 40;
const HISTORY_BYTES = 8 * 1024 * 1024;
const TYPE_LABELS = ['Point', 'Line', 'Box', 'Ellipsoid', 'Polyline'];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, action, title = text) {
  const node = element('button', 'mobile-annotation-button', text);
  node.type = 'button'; node.title = title;
  node.addEventListener('click', action);
  return node;
}
function cloneJSON(value) { return JSON.parse(JSON.stringify(value)); }
function downloadJSON(value, name) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parse into a temporary upstream source before touching the live source. */
function validateAnnotationRows(rows, source) {
  if (!Array.isArray(rows)) throw new Error('Expected an array of Neuroglancer annotations.');
  if (rows.length > 100000) throw new Error('Import at most 100,000 local annotations at a time.');
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id.length) throw new Error('Each annotation needs a nonempty string ID.');
    if (ids.has(row.id)) throw new Error(`Duplicate annotation ID: ${row.id}`);
    ids.add(row.id);
  }
  const parser = new AnnotationSource(source.rank, source.relationships, source.properties);
  try { parser.restoreState(rows); return Array.from(parser); }
  finally { parser.dispose(); }
}

/** Transform a picked global position through the actual annotation source transform. */
function annotationPosition(mouseState, annotationLayer) {
  const transform = annotationLayer.chunkTransform.value;
  if (transform.error !== undefined) throw new Error('The annotation transform is not ready.');
  const point = new Float32Array(transform.modelTransform.unpaddedRank);
  const valid = getChunkPositionFromCombinedGlobalLocalPositions(point, mouseState.unsnappedPosition,
    annotationLayer.localPosition.value, transform.layerRank, transform.combinedGlobalLocalToChunkTransform);
  if (!valid || Array.from(point).some(v => !Number.isFinite(v))) throw new Error('Cannot map this position into the annotation coordinates.');
  return point;
}

export function createAnnotationController(viewer, { notify = () => {}, onChange = () => {}, onActivate = () => {} } = {}) {
  let mode = 'inspect', disposed = false, operation = 0, container, managed, selectedId, moveTarget;
  let root, layerSelect, list, form, status, toolButtons, undoButton, redoButton, finishButton;
  let ownedTool, ownedLayer, renderScheduled = false;
  const subscriptions = [], sourceBindings = new Map(), histories = new Map();
  let sourceEventsMuted = false;

  const report = error => { notify(error instanceof Error ? error.message : String(error)); };
  const guard = action => () => { Promise.resolve().then(action).catch(report); };
  const localLayers = () => viewer.layerManager.managedLayers.filter(layer => layer.layer?.localAnnotations);
  const sourceOf = layer => layer?.layer?.localAnnotations;
  const currentSource = () => sourceOf(managed);
  const currentTool = () => managed?.layer?.tool?.value;
  const schemaKey = source => JSON.stringify({ rank: source.rank, relationships: source.relationships, properties: source.properties.value });

  function keepDrawingSurfaceVisible() {
    const location = viewer.selectionDetailsState?.location;
    // Native tools pin their current annotation after every preview/update.
    // Keep that selection, but prevent its details sheet covering the next tap.
    if (mode !== 'inspect' && location?.visible) location.visible = false;
  }

  function scheduleRender() {
    if (renderScheduled || disposed) return;
    renderScheduled = true;
    requestAnimationFrame(() => { renderScheduled = false; if (!disposed) render(); });
  }

  function capture(source) {
    if (disposed || sourceEventsMuted || !source) return;
    const record = histories.get(source);
    if (!record) return;
    clearTimeout(record.timer);
    const snapshot = JSON.stringify(source.toJSON());
    const schema = schemaKey(source);
    if (record.schema !== schema) {
      // A native schema/transform edit invalidates old geometry/property snapshots.
      record.schema = schema; record.current = snapshot; record.undo.length = 0; record.redo.length = 0;
      scheduleRender(); return;
    }
    if (snapshot === record.current) return;
    record.undo.push(record.current); record.redo.length = 0; record.current = snapshot;
    while (record.undo.length > HISTORY_LIMIT || record.undo.reduce((sum, x) => sum + x.length * 2, 0) > HISTORY_BYTES) record.undo.shift();
    onChange(); scheduleRender();
  }

  function reconcile() {
    if (disposed) return;
    keepDrawingSurfaceVisible();
    const layers = localLayers(), sources = new Set(layers.map(sourceOf));
    for (const [source, disposers] of sourceBindings) {
      if (sources.has(source)) continue;
      disposers.forEach(dispose => dispose());
      clearTimeout(histories.get(source)?.timer);
      sourceBindings.delete(source); histories.delete(source);
    }
    for (const source of sources) {
      if (sourceBindings.has(source)) continue;
      const record = { current: JSON.stringify(source.toJSON()), schema: schemaKey(source), undo: [], redo: [], timer: undefined };
      histories.set(source, record);
      sourceBindings.set(source, [
        source.changed.add(() => {
          if (sourceEventsMuted) return;
          clearTimeout(record.timer);
          record.timer = setTimeout(() => capture(source), 350);
          scheduleRender();
        }),
        source.childCommitted.add(() => capture(source)),
        source.childDeleted.add(() => capture(source)),
      ]);
    }
    const nativeSelected = viewer.selectedLayer.layer;
    if (sourceOf(nativeSelected) && nativeSelected !== managed) {
      managed = nativeSelected; selectedId = undefined; moveTarget = undefined;
    } else if (!layers.includes(managed)) {
      managed = layers[0]; selectedId = undefined; moveTarget = undefined;
    }
    const context = managed?.layer?.getSelectedAnnotationContext?.();
    if (context && context.annotationLayerState.source === currentSource()) selectedId = context.annotationId;
    const nativeToolId = managed?.layer?.tool?.toJSON?.();
    const nativeMode = Object.keys(TOOL_IDS).find(key => TOOL_IDS[key] === nativeToolId);
    if (nativeMode && currentTool() !== ownedTool) mode = nativeMode;
    scheduleRender();
  }

  function cancelTool() {
    // Native cancellation disposes tool state and removes any uncommitted geometry.
    if (ownedLayer && ownedTool && ownedLayer.tool?.value === ownedTool) ownedLayer.tool.reset();
    else currentTool()?.deactivate?.();
    ownedTool = undefined; ownedLayer = undefined; moveTarget = undefined;
  }

  function cancel() {
    operation++; cancelTool(); mode = 'inspect'; scheduleRender(); onChange();
  }

  async function ensureLayer() {
    reconcile();
    if (currentSource()) return managed;
    const layer = makeLayer(viewer.layerSpecification, 'Mobile annotations', {
      type: 'annotation', source: 'local://annotations', annotationColor: '#ffd166', annotations: [],
    });
    viewer.layerSpecification.add(layer);
    viewer.selectedLayer.layer = layer; managed = layer;
    const deadline = performance.now() + 10000;
    while (!sourceOf(layer)) {
      if (disposed || layer.wasDisposed) throw new Error('The annotation layer was removed.');
      if (performance.now() > deadline) throw new Error('The local annotation layer is not ready. Load an image or restore valid dimensions first.');
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    reconcile(); onChange(); return layer;
  }

  async function setTool(nextMode) {
    if (!(nextMode in MODES)) throw new Error(`Unknown annotation tool: ${nextMode}`);
    onActivate(nextMode);
    operation++; const generation = operation;
    cancelTool(); mode = nextMode; scheduleRender();
    if (TOOL_IDS[nextMode]) {
      const layer = await ensureLayer();
      if (generation !== operation || disposed) return false;
      viewer.selectedLayer.layer = layer;
      layer.layer.tool.restoreState(TOOL_IDS[nextMode]);
      ownedTool = layer.layer.tool.value; ownedLayer = layer.layer;
    }
    scheduleRender(); onChange(); return true;
  }

  function selectedContext() {
    const source = currentSource();
    if (!source || !selectedId || !source.get(selectedId)) throw new Error('Select a local annotation first.');
    const annotationLayer = managed.layer.annotationStates.states.find(state => state.source === source);
    if (!annotationLayer) throw new Error('The annotation source is not ready.');
    return { source, annotationLayer, id: selectedId, annotation: source.get(selectedId) };
  }

  function select(layer, annotationLayer, id) {
    if (!layer || !sourceOf(layer) || annotationLayer.source !== sourceOf(layer)) {
      throw new Error('Mobile edits apply to local annotation layers. Use the native panel to inspect this source.');
    }
    managed = layer; selectedId = id; viewer.selectedLayer.layer = layer;
    layer.layer.selectAnnotation(annotationLayer, id, true);
    scheduleRender();
  }

  function mutate(source, id, next) {
    capture(source);
    const reference = source.getReference(id);
    try { source.update(reference, next); source.commit(reference); }
    finally { reference.dispose(); }
    capture(source); onChange(); scheduleRender();
  }

  function deleteSelected() {
    const { source, id } = selectedContext();
    cancelTool(); capture(source);
    const reference = source.getReference(id);
    try { source.delete(reference); }
    finally { reference.dispose(); }
    selectedId = undefined; capture(source); onChange(); scheduleRender();
  }

  function handleTap(panel, event) {
    if (disposed) return false;
    try {
      if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        if (typeof panel?.handleMouseMove === 'function') panel.handleMouseMove(event.clientX, event.clientY);
        else (panel?.element || panel)?.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, clientX: event.clientX, clientY: event.clientY,
        }));
      }
      if (!viewer.mouseState.updateUnconditionally()) throw new Error('Wait for this view to render before placing or picking annotations.');
      if (TOOL_IDS[mode]) {
        if (!currentTool()) throw new Error('Choose an annotation tool after the layer finishes loading.');
        currentTool().trigger(viewer.mouseState);
        keepDrawingSurfaceVisible();
        reconcile(); return true;
      }
      if (mode === 'move' && moveTarget) {
        const { source, id, annotationLayer, partIndex } = moveTarget;
        const previous = source.get(id);
        if (!previous) throw new Error('The annotation to move no longer exists.');
        const point = annotationPosition(viewer.mouseState, annotationLayer);
        const handler = getAnnotationTypeRenderHandler(previous.type);
        mutate(source, id, handler.updateViaRepresentativePoint(previous, point, partIndex));
        moveTarget = undefined; notify('Annotation moved'); scheduleRender(); return true;
      }
      const picked = getSelectedAnnotation(viewer.mouseState, viewer.layerManager);
      if (!picked) {
        if (mode !== 'inspect') notify('Tap a visible local annotation or its handle.');
        return mode !== 'inspect';
      }
      select(picked.layer, picked.annotationLayer, picked.id);
      if (mode === 'delete') deleteSelected();
      else if (mode === 'move') {
        moveTarget = { source: picked.annotationLayer.source, annotationLayer: picked.annotationLayer,
          id: picked.id, partIndex: picked.partIndex };
        notify('Now tap the destination'); scheduleRender();
      }
      return true;
    } catch (error) { report(error); return mode !== 'inspect'; }
  }

  function finish() {
    const tool = currentTool();
    if (!tool?.inProgressAnnotation?.value) { notify('There is no unfinished annotation.'); return false; }
    if (typeof tool.complete === 'function') {
      const progress = tool.inProgressAnnotation.value;
      if (progress.reference.value?.type === AnnotationType.POLYLINE && progress.reference.value.points.length < 3) {
        notify('A polyline needs at least two vertices.'); return false;
      }
      tool.complete();
    } else {
      // For two-tap tools, confirm the current preview without needing a keyboard.
      const progress = tool.inProgressAnnotation.value;
      progress.annotationLayer.source.commit(progress.reference);
      progress.disposer(); tool.inProgressAnnotation.value = undefined;
    }
    capture(currentSource()); reconcile(); return true;
  }

  function restoreHistory(direction) {
    const source = currentSource();
    if (!source) return false;
    const tool = currentTool();
    if (direction === 'undo' && tool?.inProgressAnnotation?.value && typeof tool.undo === 'function') {
      tool.undo(); scheduleRender(); return true;
    }
    if (tool?.inProgressAnnotation?.value) { cancel(); return true; }
    capture(source);
    const record = histories.get(source), from = record?.[direction];
    if (!from?.length) return false;
    cancelTool(); mode = 'inspect';
    const next = from.pop(), opposite = direction === 'undo' ? record.redo : record.undo;
    opposite.push(record.current);
    sourceEventsMuted = true;
    try { source.restoreState(JSON.parse(next)); record.current = next; }
    finally { sourceEventsMuted = false; }
    if (!source.get(selectedId)) selectedId = undefined;
    onChange(); scheduleRender(); return true;
  }

  function exportAnnotations() {
    if (!managed) throw new Error('Create or select a local annotation layer first.');
    const spec = cloneJSON(managed.toJSON());
    downloadJSON(spec, `${managed.name.replace(/[^a-z0-9_-]/gi, '-') || 'annotations'}.json`);
    return spec;
  }

  async function importAnnotations(value) {
    await ensureLayer();
    const source = currentSource();
    const rows = Array.isArray(value) ? value : value?.annotations;
    if (!Array.isArray(rows)) throw new Error('Import an annotation array or a Neuroglancer annotation layer. Full viewer states use the State import control.');
    if (!Array.isArray(value)) {
      const incomingProperties = value.annotationProperties || [];
      const currentProperties = managed.toJSON().annotationProperties || [];
      const incomingRelationships = value.annotationRelationships || ['segments'];
      const currentRelationships = source.relationships;
      if (JSON.stringify(incomingProperties) !== JSON.stringify(currentProperties) || JSON.stringify(incomingRelationships) !== JSON.stringify(currentRelationships)) {
        throw new Error('This layer has a different annotation schema. Import its full layer through State, or create the matching schema in the native Schema tab first.');
      }
    }
    const annotations = validateAnnotationRows(rows, source);
    const existing = new Set(Array.from(source, annotation => annotation.id));
    for (const annotation of annotations) if (existing.has(annotation.id)) throw new Error(`Annotation ID already exists: ${annotation.id}. Import was not applied.`);
    cancel(); capture(source);
    sourceEventsMuted = true;
    try { for (const annotation of annotations) source.add(annotation).dispose(); }
    finally { sourceEventsMuted = false; }
    capture(source); notify(`Imported ${annotations.length} annotations`); onChange(); scheduleRender();
    return annotations.length;
  }

  function editor() {
    if (!form || (form.contains(document.activeElement) && document.activeElement.matches('input, textarea, select'))) return;
    form.replaceChildren();
    const source = currentSource(), annotation = source?.get(selectedId);
    if (!annotation) return;
    const original = annotationToJson(annotation, source), inputs = new Map();
    const title = element('h3', '', `${TYPE_LABELS[annotation.type]} · ${annotation.id}`);
    form.append(title);
    const addField = (label, input) => {
      const wrapper = element('label', 'mobile-annotation-field');
      wrapper.append(element('span', '', label), input); form.append(wrapper); return input;
    };
    const description = element('textarea'); description.rows = 2; description.value = annotation.description || '';
    description.setAttribute('aria-label', 'Annotation description'); addField('Description', description);
    const dimensions = source.watchableTransform?.value?.inputSpace?.names || viewer.coordinateSpace.value.names;
    function vectorField(key, label, coordinates) {
      const row = element('fieldset', 'mobile-annotation-coordinate-row');
      row.append(element('legend', '', label));
      const entries = coordinates.map((value, i) => {
        const labelNode = element('label', 'mobile-annotation-coordinate');
        const input = element('input'); input.type = 'number'; input.step = 'any'; input.value = value;
        input.setAttribute('aria-label', `${label} ${dimensions[i] || `dimension ${i + 1}`}`);
        labelNode.append(element('span', '', dimensions[i] || `${i + 1}`), input); row.append(labelNode); return input;
      });
      form.append(row); inputs.set(key, entries);
    }
    if (annotation.type === AnnotationType.POINT) vectorField('point', 'Position', original.point);
    else if (annotation.type === AnnotationType.LINE || annotation.type === AnnotationType.AXIS_ALIGNED_BOUNDING_BOX) {
      vectorField('pointA', 'Start', original.pointA); vectorField('pointB', 'End', original.pointB);
    } else if (annotation.type === AnnotationType.ELLIPSOID) {
      vectorField('center', 'Center', original.center); vectorField('radii', 'Radii', original.radii);
    } else original.points.forEach((point, i) => vectorField(`points.${i}`, `Vertex ${i + 1}`, point));
    const propertyInputs = source.properties.value.map((spec, i) => {
      const input = element(spec.type === 'bool' || spec.enumValues?.length ? 'select' : 'input');
      if (spec.enumValues?.length) {
        spec.enumValues.forEach((value, index) => {
          const option = element('option', '', spec.enumLabels?.[index] || String(value)); option.value = value; input.append(option);
        });
        input.value = annotation.properties[i];
      } else if (spec.type === 'bool') {
        for (const [value, label] of [[0, 'False'], [1, 'True']]) { const option = element('option', '', label); option.value = value; input.append(option); }
        input.value = annotation.properties[i];
      } else {
        input.type = spec.type === 'rgb' ? 'color' : spec.type === 'rgba' ? 'text' : 'number';
        if (input.type === 'number') input.step = spec.type === 'float32' ? 'any' : '1';
        input.value = original.props?.[i] ?? spec.default;
      }
      input.setAttribute('aria-label', `Property ${spec.identifier}`); addField(spec.identifier, input); return input;
    });
    const relationshipInputs = source.relationships.map((name, i) => {
      const input = element('input'); input.type = 'text'; input.inputMode = 'text';
      input.value = (original.segments?.[i] || []).join(', ');
      input.placeholder = 'Decimal IDs, separated by commas'; input.setAttribute('aria-label', `Related segments ${name}`);
      addField(`Related segments · ${name}`, input); return input;
    });
    const save = button('Save changes', guard(() => {
      const next = cloneJSON(original); next.description = description.value;
      for (const [key, entries] of inputs) {
        const values = entries.map(input => {
          if (input.value.trim() === '' || !Number.isFinite(input.valueAsNumber)) throw new Error('All coordinates must be finite numbers.');
          if (key === 'radii' && input.valueAsNumber < 0) throw new Error('Ellipsoid radii cannot be negative.');
          return input.valueAsNumber;
        });
        if (key.startsWith('points.')) next.points[Number(key.slice(7))] = values; else next[key] = values;
      }
      if (propertyInputs.length) next.props = propertyInputs.map((input, i) => {
        const type = source.properties.value[i].type;
        if (type === 'rgb' || type === 'rgba') return input.value;
        if (input.value.trim() === '' || !Number.isFinite(Number(input.value))) throw new Error('Annotation properties must have valid values.');
        return Number(input.value);
      });
      next.segments = relationshipInputs.map(input => input.value.trim() ? input.value.split(/[\s,]+/).filter(Boolean) : []);
      const [validated] = validateAnnotationRows([next], source);
      mutate(source, annotation.id, validated); notify('Annotation saved');
    }));
    form.append(save, button('Delete selected', guard(deleteSelected)), button('Native annotation panel', () => {
      viewer.selectedLayer.layer = managed; viewer.selectedLayer.visible = true;
    }));
    if (annotation.type === AnnotationType.POLYLINE) {
      const vertices = element('div', 'mobile-annotation-actions');
      vertices.append(button('Add vertex at end', guard(() => {
        const next = cloneJSON(annotationToJson(source.get(annotation.id), source));
        next.points.push([...next.points.at(-1)]);
        mutate(source, annotation.id, validateAnnotationRows([next], source)[0]);
      })), button('Remove last vertex', guard(() => {
        const next = cloneJSON(annotationToJson(source.get(annotation.id), source));
        if (next.points.length <= 2) throw new Error('A polyline needs at least two vertices.');
        next.points.pop(); mutate(source, annotation.id, validateAnnotationRows([next], source)[0]);
      })));
      form.append(vertices);
    }
  }

  function render() {
    if (!root) return;
    const layers = localLayers(), source = currentSource();
    const selectedLayerIndex = layers.indexOf(managed);
    const optionSignature = layers.map(layer => layer.name).join('\0');
    if (layerSelect.dataset.signature !== optionSignature) {
      layerSelect.replaceChildren();
      layers.forEach((layer, index) => { const option = element('option', '', layer.name); option.value = index; layerSelect.append(option); });
      layerSelect.dataset.signature = optionSignature;
    }
    layerSelect.value = selectedLayerIndex; layerSelect.disabled = layers.length === 0;
    for (const [key, node] of toolButtons) node.setAttribute('aria-pressed', String(key === mode));
    status.textContent = moveTarget ? 'Tap the destination for the selected annotation handle.' : HELP[mode];
    const progress = currentTool()?.inProgressAnnotation?.value;
    finishButton.disabled = !progress;
    const record = histories.get(source);
    undoButton.disabled = !progress && !record?.undo.length; redoButton.disabled = !record?.redo.length;
    const items = source ? Array.from(source).filter(annotation => !source.pending.has(annotation.id)) : [];
    // Keep large imports navigable without constructing 100,000 DOM nodes.
    const filter = root.querySelector('[data-annotation-filter]').value.trim().toLowerCase();
    const matches = items.filter(annotation => !filter || `${annotation.id} ${annotation.description || ''}`.toLowerCase().includes(filter));
    list.replaceChildren(element('p', 'mobile-annotation-count', `${items.length} annotations${matches.length > 200 ? ' · showing first 200 matches' : ''}`));
    for (const annotation of matches.slice(0, 200)) {
      const node = button(`${TYPE_LABELS[annotation.type]} · ${annotation.description || annotation.id}`, guard(() => {
        const annotationLayer = managed.layer.annotationStates.states.find(state => state.source === source);
        select(managed, annotationLayer, annotation.id);
      }));
      node.setAttribute('aria-pressed', String(annotation.id === selectedId));
      node.dataset.annotationId = annotation.id; list.append(node);
    }
    editor();
  }

  function mount(target) {
    if (disposed) throw new Error('The annotation controller has been disposed.');
    root?.remove(); container = target;
    root = element('section', 'mobile-annotations'); root.setAttribute('aria-label', 'Local annotations');
    const row = element('div', 'mobile-annotation-actions');
    layerSelect = element('select'); layerSelect.setAttribute('aria-label', 'Local annotation layer');
    layerSelect.addEventListener('change', () => {
      cancel(); managed = localLayers()[Number(layerSelect.value)]; selectedId = undefined;
      if (managed) viewer.selectedLayer.layer = managed; scheduleRender();
    });
    row.append(layerSelect, button('New layer', guard(async () => {
      cancel(); managed = undefined;
      const layer = makeLayer(viewer.layerSpecification, 'Mobile annotations', { type: 'annotation', source: 'local://annotations', annotations: [] });
      viewer.layerSpecification.add(layer); viewer.selectedLayer.layer = layer;
      onChange(); reconcile();
    })));
    const toolbar = element('div', 'mobile-annotation-tools'); toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Annotation tools');
    toolButtons = new Map(Object.entries(MODES).map(([key, label]) => {
      const node = button(label, guard(() => setTool(key))); node.dataset.annotationTool = key; toolbar.append(node); return [key, node];
    }));
    status = element('p', 'mobile-annotation-help'); status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'mobile-annotation-actions');
    finishButton = button('Finish', guard(finish));
    undoButton = button('Undo', guard(() => restoreHistory('undo')));
    redoButton = button('Redo', guard(() => restoreHistory('redo')));
    actions.append(finishButton, button('Cancel', cancel), undoButton, redoButton);
    const transfer = element('div', 'mobile-annotation-actions');
    const upload = element('input'); upload.type = 'file'; upload.accept = '.json,application/json'; upload.hidden = true;
    upload.addEventListener('change', async () => {
      try {
        const file = upload.files[0]; if (!file) return;
        if (file.size > 16 * 1024 * 1024) throw new Error('Annotation JSON imports are limited to 16 MiB.');
        await importAnnotations(JSON.parse(await file.text()));
      } catch (error) { report(error); }
      finally { upload.value = ''; }
    });
    transfer.append(button('Import annotations', () => upload.click()), button('Export layer JSON', guard(exportAnnotations)), upload);
    const filter = element('input'); filter.type = 'search'; filter.placeholder = 'Find annotation by ID or description';
    filter.setAttribute('aria-label', 'Find annotation'); filter.dataset.annotationFilter = ''; filter.addEventListener('input', scheduleRender);
    list = element('div', 'mobile-annotation-list'); form = element('div', 'mobile-annotation-editor');
    root.append(row, toolbar, status, actions, transfer, filter, list, form); container.append(root);
    reconcile(); render();
    const mountedRoot = root;
    // Closing the mobile sheet removes its DOM but leaves the selected native
    // placement tool alive, so the next tap can place an annotation on the image.
    return () => {
      mountedRoot.remove();
      if (root === mountedRoot) { root = undefined; container = undefined; }
    };
  }

  for (const signal of [viewer.layerManager.layersChanged, viewer.layerManager.readyStateChanged,
    viewer.layerManager.specificationChanged, viewer.selectedLayer.changed, viewer.selectionDetailsState.changed]) {
    if (signal?.add) subscriptions.push(signal.add(reconcile));
  }
  reconcile();
  const api = {
    mount, setTool, cancel, finish, handleTap, undo: () => restoreHistory('undo'), redo: () => restoreHistory('redo'),
    importAnnotations, exportAnnotations, deleteSelected,
    get mode() { return mode; },
    snapshot: () => ({ mode, layer: managed?.name, selectedId, pending: currentSource()?.pending.size || 0,
      annotationCount: currentSource() ? currentSource().toJSON().length : 0,
      annotations: currentSource()?.toJSON() || [], undo: histories.get(currentSource())?.undo.length || 0,
      redo: histories.get(currentSource())?.redo.length || 0, moving: Boolean(moveTarget) }),
    dispose() {
      if (disposed) return;
      cancel(); disposed = true;
      subscriptions.forEach(dispose => dispose());
      for (const disposers of sourceBindings.values()) disposers.forEach(dispose => dispose());
      for (const record of histories.values()) clearTimeout(record.timer);
      sourceBindings.clear(); histories.clear(); root?.remove();
    },
  };
  return api;
}
