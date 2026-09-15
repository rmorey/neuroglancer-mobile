import { restoreTool } from 'neuroglancer/unstable/ui/tool.js';
import './spelunker-controls.css';

const TOOLS = {
  merge: { id: 'grapheneMergeSegments', label: 'Merge', action: 'annotate', selector: '.graphene-merge-segments', submit: 'Submit merge', clear: 'Clear pending merges' },
  multicut: { id: 'grapheneMulticutSegments', label: 'Split / multicut', action: 'set-anchor', selector: '.graphene-multicut', submit: 'Submit multicut', clear: 'Clear multicut' },
  path: { id: 'grapheneFindPath', label: 'Find path', action: 'add-point', selector: '.graphene-find-path', submit: 'Submit Find Path', clear: 'Clear Find Path' },
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function setText(element, text) { if (element.textContent !== text) element.textContent = text; }
function editingTarget(target) {
  return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
}

/** Touch access to Spelunker's native tools. Picking, edits, history and review stay in the engine. */
export function createSpelunkerControls(viewer, {
  notify = () => {}, closePanel = () => {}, touchKeyboard, layerDetails = () => {}, onActivate = () => {}, onActivated = () => {}, onCanvasAction = () => {},
} = {}) {
  let disposed = false, active, showDetails = false, lastTouch, updateQueued = false, statusObserver;
  const disposers = [], listeners = new Set(), panelDisposers = new Set();
  const strip = node('section', 'm-spelunker-strip');
  strip.hidden = true; strip.setAttribute('aria-label', 'Active Spelunker tool');
  const title = node('strong', 'm-spelunker-title');
  const status = node('p', 'm-spelunker-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const actions = node('div', 'm-spelunker-actions');

  function run(action) {
    return event => {
      try { Promise.resolve(action(event)).catch(error => notify(error.message || String(error))); }
      catch (error) { notify(error.message || String(error)); }
    };
  }
  function button(label, action, name) {
    const element = node('button', 'm-button', label); element.type = 'button';
    if (name) element.dataset.spelunkerAction = name;
    // Toolbar actions retain the last native editing field's focus.
    element.addEventListener('pointerdown', event => event.preventDefault());
    element.addEventListener('mousedown', event => event.preventDefault());
    element.addEventListener('click', run(action)); return element;
  }
  function on(target, event, callback, options) {
    target.addEventListener(event, callback, options);
    disposers.push(() => target.removeEventListener(event, callback, options));
  }
  function watch(signal, callback = queueUpdate, list = disposers) {
    if (signal?.add) list.push(signal.add(callback));
  }
  function managed(name, type) {
    const layers = viewer.layerManager.managedLayers;
    const result = name ? viewer.layerManager.getLayerByName(name)
      : layers.find(item => item === viewer.selectedLayer.layer && item.layer?.type === type)
        || layers.find(item => item.layer?.type === type);
    if (!result || result.layer?.type !== type) throw new Error(`Choose a ${type} layer first.`);
    return result;
  }
  function graphOf(layer) { return layer?.graphConnection?.value; }
  function current() {
    if (!active || !active.binder.isActive(active.tool)) return undefined;
    return active;
  }
  function nativeBody() {
    const operation = current();
    return operation ? document.querySelector(TOOLS[operation.name].selector) : undefined;
  }
  function nativeButton(action) {
    const operation = current(); if (!operation) return undefined;
    const title = TOOLS[operation.name][action];
    return Array.from(nativeBody()?.querySelectorAll('[title]') || []).find(element => element.title === title);
  }
  function busy() {
    const operation = current(); if (!operation) return false;
    return Boolean(nativeButton('submit')?.classList.contains('disabled')
      || (operation.name === 'merge' && graphOf(operation.managed.layer)?.state?.mergeState?.merges.value.some(item => item.locked)));
  }
  function queueUpdate() {
    if (disposed || updateQueued) return;
    updateQueued = true;
    queueMicrotask(() => { updateQueued = false; if (!disposed) update(); });
  }
  function update() {
    const operation = current();
    if (operation && graphOf(operation.managed.layer) !== operation.graph) { cancel(); return; }
    strip.hidden = !operation;
    document.body.classList.toggle('m-spelunker-active', Boolean(operation));
    document.body.classList.toggle('m-spelunker-details', Boolean(operation && showDetails));
    if (operation) {
      setText(title, `${TOOLS[operation.name].label} · ${operation.managed.name}`);
      const state = graphOf(operation.managed.layer)?.state;
      let message;
      if (operation.name === 'multicut') {
        const cut = state.multicutState;
        message = `${cut.blueGroup.value ? 'Blue' : 'Red'} anchors · ${cut.sinks.size} red / ${cut.sources.size} blue. Tap a visible segment to add an anchor.`;
        setText(swapButton, cut.blueGroup.value ? 'Use red' : 'Use blue');
        swapButton.dataset.group = cut.blueGroup.value ? 'blue' : 'red';
      } else if (operation.name === 'merge') {
        const merge = state.mergeState, pairs = merge.merges.value;
        message = `${pairs.filter(item => item.source).length} merge pair(s). ${pairs.some(item => !item.source) ? 'Tap the second visible segment.' : 'Tap two visible segments to connect them.'}${merge.autoSubmit.value ? ' Auto-submit is on.' : ''}`;
      } else {
        const path = state.findPathState;
        message = !path.source.value ? 'Tap a visible segment for the start point.'
          : !path.target.value ? 'Tap a visible segment for the end point.'
            : `${path.centroids.value.length ? 'Path ready.' : 'Endpoints selected.'} Submit to calculate the path; Clear to choose new endpoints.`;
      }
      setText(status, busy() ? `Submitting… ${message}` : message);
      submitButton.disabled = busy(); clearButton.disabled = busy();
      swapButton.hidden = operation.name !== 'multicut'; swapButton.disabled = busy();
      detailsButton.setAttribute('aria-expanded', String(showDetails));
    }
    for (const listener of listeners) listener();
  }
  function activate(name, layerName) {
    if (disposed) return false;
    if (!(name in TOOLS)) throw new Error('Choose Merge, Split / multicut, or Find path.');
    const target = managed(layerName, 'segmentation'), layer = target.layer, graph = graphOf(layer);
    if (!graph?.state?.multicutState || !graph?.state?.mergeState || !graph?.state?.findPathState) {
      throw new Error('This tool requires a loaded Graphene segmentation source. Open the layer controls to configure it.');
    }
    if (name !== 'path' && graph.segmentsState.timestamp.value !== undefined) {
      throw new Error('Historical segmentation is read-only. Use the native Time control to return to the latest state before editing.');
    }
    const tool = restoreTool(layer, TOOLS[name].id);
    if (!tool) throw new Error('The selected layer does not support this tool.');
    const operation = { name, managed: target, graph, tool, binder: layer.toolBinder.globalBinder, disposers: [] };
    onActivate(); touchKeyboard?.close(); closePanel(); cancel();
    active = operation; showDetails = false;
    tool.registerDisposer(() => {
      operation.disposers.forEach(dispose => dispose());
      if (active === operation) active = undefined;
      queueUpdate();
    });
    for (const signal of [graph.state.multicutState.changed, graph.state.mergeState.changed,
      graph.state.mergeState.autoSubmit.changed, graph.state.findPathState.changed]) watch(signal, queueUpdate, operation.disposers);
    if (name === 'merge') {
      let previewQueued = false;
      watch(viewer.mouseState.changed, () => {
        if (previewQueued) return;
        previewQueued = true;
        queueMicrotask(() => {
          previewQueued = false;
          // Native line previews pin their annotation again on pointer movement.
          // Apply mobile presentation after those handlers, without changing the selection.
          if (current() === operation && viewer.mouseState.active && layer.tool.value?.inProgressAnnotation?.value) onCanvasAction();
        });
      }, operation.disposers);
    }
    operation.binder.activateDirect(tool);
    if (!operation.binder.isActive(tool)) { update(); return false; }
    observeStatus();
    onActivated();
    // Merge's legacy line tool requires the native selected layer. The other tools own their layer directly.
    update(); return true;
  }
  function cancel() {
    const operation = current();
    if (operation) {
      // Empty keys cannot be persisted bindings. This public native API disposes the activation synchronously.
      operation.binder.activate('');
    }
    active = undefined; showDetails = false;
    if (!disposed) update();
  }
  function clickNative(action) {
    const operation = current(); if (!operation) return false;
    if (busy()) { notify('Wait for the current request to finish.'); return false; }
    const control = nativeButton(action);
    if (!control || control.classList.contains('disabled') || control.getAttribute('aria-disabled') === 'true') return false;
    control.click(); queueUpdate(); return true;
  }
  function submit() { return clickNative('submit'); }
  function clear() { return clickNative('clear'); }
  function swapGroup() {
    if (current()?.name !== 'multicut' || busy()) return false;
    const control = nativeBody()?.querySelector('[title="Swap group"]');
    if (!control) return false;
    control.click(); update(); return true;
  }
  function details(value = !showDetails) { showDetails = Boolean(value); update(); return showDetails; }
  function handleTap(panel, event) {
    const operation = current();
    if (!operation || !['touch', 'pen'].includes(event.pointerType) || editingTarget(event.target)) return false;
    if (!viewer.layerManager.managedLayers.includes(operation.managed) || graphOf(operation.managed.layer) !== operation.graph) { cancel(); return false; }
    if (operation.name === 'merge' && viewer.selectedLayer.layer !== operation.managed) {
      notify('Select the merge layer again or close the merge tool to change layers.'); return true;
    }
    if (busy()) { notify('Wait for the current request to finish.'); return true; }
    panel.handleMouseMove(event.clientX, event.clientY); viewer.mouseState.updateUnconditionally();
    // Native actions consult native picking and enforce visible-root, timestamp and backend guards.
    panel.element.dispatchEvent(new CustomEvent(`action:${TOOLS[operation.name].action}`, {
      bubbles: true, cancelable: true, detail: { originalEvent: event },
    }));
    onCanvasAction();
    lastTouch = { panel, x: event.clientX, y: event.clientY, time: performance.now() };
    event.preventDefault(); queueUpdate(); return true;
  }
  function openLayerControls(layerName, tab) {
    const target = layerName ? viewer.layerManager.getLayerByName(layerName) : current()?.managed || viewer.selectedLayer.layer;
    if (!target?.layer) throw new Error('Choose a layer first.');
    const tabId = tab || (graphOf(target.layer) ? 'graph' : 'source');
    if (!target.layer.tabs.options.has(tabId)) throw new Error(`This layer does not have a ${tabId} tab.`);
    layerDetails(target);
    const panel = target.layer.panels.panels.find(item => item.tabs.includes(tabId)) || target.layer.panels.panels[0];
    panel.selectedTab.value = tabId; panel.location.visible = true;
  }
  function annotationLayer(layerName) { return managed(layerName, 'annotation').layer; }
  function startReview(layerName) {
    const layer = annotationLayer(layerName);
    let entry;
    for (const state of layer.annotationStates.states) {
      const first = state.source[Symbol.iterator]().next();
      if (!first.done) { entry = { state, annotation: first.value }; break; }
    }
    if (!entry) throw new Error('No loaded annotations are available in this layer.');
    layer.selectAnnotation(entry.state, entry.annotation.id, true); queueUpdate();
    return entry.annotation.id;
  }
  function navigateAnnotation(direction, layerName) {
    if (direction !== -1 && direction !== 1) throw new Error('Annotation direction must be -1 or 1.');
    const layer = annotationLayer(layerName);
    if (!layer.getSelectedAnnotationContext()) throw new Error('Select an annotation or choose Select first to begin review.');
    layer.dispatchLayerEvent(direction < 0 ? 'select-previous' : 'select-next'); queueUpdate();
    return layer.getSelectedAnnotationContext()?.annotationId;
  }
  function setSwapVisibleSegments(value, layerName) {
    annotationLayer(layerName).annotationDisplayState.swapVisibleSegmentsOnMove.value = Boolean(value); queueUpdate();
  }
  function snapshot() {
    const operation = current(), graph = operation && graphOf(operation.managed.layer);
    return {
      active: operation?.name ?? null, layer: operation?.managed.name ?? null, details: Boolean(operation && showDetails), busy: busy(),
      group: operation?.name === 'multicut' ? (graph.state.multicutState.blueGroup.value ? 'blue' : 'red') : null,
      status: operation ? status.textContent : '',
      segmentationLayers: viewer.layerManager.managedLayers.filter(item => item.layer?.type === 'segmentation').map(item => ({
        name: item.name, graphene: Boolean(graphOf(item.layer)?.state?.multicutState),
        historical: graphOf(item.layer)?.segmentsState?.timestamp.value !== undefined,
      })),
    };
  }

  const submitButton = button('Submit', submit, 'submit');
  const swapButton = button('Use blue', swapGroup, 'swap-group');
  const clearButton = button('Clear', clear, 'clear');
  const detailsButton = button('Details', () => details(), 'details');
  const cancelButton = button('Close', cancel, 'cancel'); cancelButton.setAttribute('aria-label', 'Close Spelunker tool');
  actions.append(submitButton, swapButton, clearButton, detailsButton, cancelButton);
  strip.append(title, status, actions); document.body.append(strip);

  function render(content) {
    if (disposed) return () => {};
    const root = node('div', 'm-spelunker-panel'), graphSelect = node('select', 'm-field'), reviewSelect = node('select', 'm-field');
    graphSelect.setAttribute('aria-label', 'Spelunker segmentation layer'); reviewSelect.setAttribute('aria-label', 'Spelunker annotation layer');
    const hint = node('p', 'm-muted'), toolButtons = node('div', 'm-spelunker-grid');
    const tools = Object.entries(TOOLS).map(([name, spec]) => button(spec.label, () => activate(name, graphSelect.value), name));
    toolButtons.append(...tools);
    const native = button('Time, sources and full layer controls', () => openLayerControls(graphSelect.value), 'layer-controls');
    const reviewButtons = node('div', 'm-spelunker-grid');
    const start = button('Select first', () => startReview(reviewSelect.value), 'review-start');
    const previous = button('Previous', () => navigateAnnotation(-1, reviewSelect.value), 'review-previous');
    const next = button('Next', () => navigateAnnotation(1, reviewSelect.value), 'review-next');
    reviewButtons.append(start, previous, next);
    const swapLabel = node('label', 'm-spelunker-toggle');
    const swap = node('input'); swap.type = 'checkbox'; swap.setAttribute('aria-label', 'Swap visible segments when moving to annotation');
    swap.addEventListener('change', run(() => setSwapVisibleSegments(swap.checked, reviewSelect.value)));
    swapLabel.append(swap, node('span', '', 'Swap visible segments when moving to annotation'));
    const annotationControls = button('Annotation tags, properties and linked segments', () => openLayerControls(reviewSelect.value, 'annotations'), 'annotation-controls');
    root.append(node('h3', '', 'Graphene proofreading'), graphSelect, hint, toolButtons, native,
      node('p', 'm-muted', 'Tap visible segments in a slice or 3D view. Drag to pan or rotate; pinch to zoom. Details shows the original tool options and request results.'),
      node('h3', '', 'Annotation review'), reviewSelect, reviewButtons, swapLabel, annotationControls);
    content.append(root);
    function options(select, type) {
      const layers = viewer.layerManager.managedLayers.filter(item => item.layer?.type === type);
      const signature = layers.map(item => item.name).join('\u0000');
      if (select.dataset.options !== signature) {
        const prior = select.value; select.replaceChildren();
        for (const layer of layers) { const option = node('option', '', layer.name); option.value = layer.name; select.append(option); }
        if (!layers.length) { const option = node('option', '', `No ${type} layers`); option.value = ''; select.append(option); }
        if (layers.some(item => item.name === prior)) select.value = prior;
        else if (layers.some(item => item === viewer.selectedLayer.layer)) select.value = viewer.selectedLayer.layer.name;
        select.dataset.options = signature;
      }
      select.disabled = layers.length === 0;
    }
    function refresh() {
      options(graphSelect, 'segmentation'); options(reviewSelect, 'annotation');
      const layer = viewer.layerManager.getLayerByName(graphSelect.value)?.layer, graph = graphOf(layer);
      const supported = Boolean(graph?.state?.multicutState && graph?.state?.mergeState && graph?.state?.findPathState);
      const historical = graph?.segmentsState?.timestamp.value !== undefined;
      setText(hint, supported ? (historical ? 'Historical segmentation: merge and split are disabled. Time is controlled in the native layer panel.' : 'Latest segmentation. Merge and split submit edits through this source’s authenticated service.')
        : 'Add a Graphene segmentation source in Layers to enable merge, split and path tools.');
      tools.forEach((element, index) => { element.disabled = !supported || (historical && index < 2); });
      native.disabled = !layer;
      const annotation = viewer.layerManager.getLayerByName(reviewSelect.value)?.layer;
      start.disabled = !annotation; previous.disabled = next.disabled = !annotation?.getSelectedAnnotationContext?.();
      swap.disabled = !annotation; swap.checked = Boolean(annotation?.annotationDisplayState.swapVisibleSegmentsOnMove.value);
      annotationControls.disabled = !annotation;
    }
    graphSelect.addEventListener('change', refresh); reviewSelect.addEventListener('change', refresh);
    listeners.add(refresh); refresh();
    const cleanup = () => { listeners.delete(refresh); panelDisposers.delete(cleanup); root.remove(); };
    panelDisposers.add(cleanup); return cleanup;
  }

  watch(viewer.state.changed); watch(viewer.globalToolBinder.changed); watch(viewer.layerManager.readyStateChanged);
  watch(viewer.layerManager.layersChanged, () => {
    if (active && !viewer.layerManager.managedLayers.includes(active.managed)) cancel();
    queueUpdate();
  });
  function observeStatus() {
    if (statusObserver) return;
    const statusContainer = document.getElementById('neuroglancer-status-container');
    if (!statusContainer) return;
    statusObserver = new MutationObserver(queueUpdate);
    statusObserver.observe(statusContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  observeStatus(); disposers.push(() => statusObserver?.disconnect());
  // A touch tap has already dispatched its one native action. Suppress its synthetic mouse copy only.
  const suppressCompatibilityMouse = event => {
    if (!lastTouch || performance.now() - lastTouch.time > 750 || event.sourceCapabilities?.firesTouchEvents === false
      || !lastTouch.panel.element.contains(event.target) || Math.hypot(event.clientX - lastTouch.x, event.clientY - lastTouch.y) > 2) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  for (const event of ['mousedown', 'mouseup', 'click', 'dblclick']) on(document, event, suppressCompatibilityMouse, true);
  const resize = new ResizeObserver(() => document.documentElement.style.setProperty('--m-spelunker-strip-height', `${strip.getBoundingClientRect().height}px`));
  resize.observe(strip); disposers.push(() => resize.disconnect());
  return {
    render, activate, cancel, submit, clear, swapGroup, details, handleTap, openLayerControls,
    startReview, navigateAnnotation, setSwapVisibleSegments, snapshot,
    dispose() {
      if (disposed) return;
      cancel(); disposed = true; disposers.forEach(dispose => dispose());
      for (const cleanup of [...panelDisposers]) cleanup();
      listeners.clear(); strip.remove(); document.documentElement.style.removeProperty('--m-spelunker-strip-height');
      document.body.classList.remove('m-spelunker-active', 'm-spelunker-details');
    },
  };
}
