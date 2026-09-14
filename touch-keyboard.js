const STYLE_ID = 'neuroglancer-mobile-touch-keyboard-style';
const MODIFIERS = {
  ctrl: { label: 'Ctrl', code: 'ControlLeft', key: 'Control', keyCode: 17 },
  alt: { label: 'Alt', code: 'AltLeft', key: 'Alt', keyCode: 18 },
  shift: { label: 'Shift', code: 'ShiftLeft', key: 'Shift', keyCode: 16 },
};
const SPECIAL_KEYS = {
  Escape: ['Escape', 27], Tab: ['Tab', 9], Enter: ['Enter', 13], Backspace: ['Backspace', 8],
  ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
  Space: [' ', 32], Delete: ['Delete', 46], Home: ['Home', 36], End: ['End', 35],
  PageUp: ['PageUp', 33], PageDown: ['PageDown', 34], Insert: ['Insert', 45],
  Equal: ['=', 187, '+'], Minus: ['-', 189, '_'], Comma: [',', 188, '<'], Period: ['.', 190, '>'],
  BracketLeft: ['[', 219, '{'], BracketRight: [']', 221, '}'], Backslash: ['\\', 220, '|'],
  Slash: ['/', 191, '?'], Semicolon: [';', 186, ':'], Quote: ["'", 222, '"'], Backquote: ['`', 192, '~'],
};

function keyDetails(raw, shift) {
  let code = String(raw).trim();
  if (/^[a-z]$/i.test(code)) code = `Key${code.toUpperCase()}`;
  if (/^\d$/.test(code)) code = `Digit${code}`;
  if (/^key[a-z]$/i.test(code)) code = `Key${code.at(-1).toUpperCase()}`;
  if (/^digit\d$/i.test(code)) code = `Digit${code.at(-1)}`;
  if (/^Key[A-Z]$/.test(code)) return { code, key: shift ? code.at(-1) : code.at(-1).toLowerCase(), keyCode: code.charCodeAt(3) };
  if (/^Digit\d$/.test(code)) {
    const digit = Number(code.at(-1));
    return { code, key: shift ? ')!@#$%^&*('[digit] : String(digit), keyCode: 48 + digit };
  }
  const special = SPECIAL_KEYS[code];
  if (special) return { code, key: shift && special[2] ? special[2] : special[0], keyCode: special[1] };
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return { code, key: code, keyCode: 111 + Number(code.slice(1)) };
  throw new Error('Use a key code such as KeyA, Digit1, Space, Equal, or PageDown.');
}

function editingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest('textarea, select, [contenteditable]:not([contenteditable="false"])')) return true;
  const input = target.closest('input');
  return Boolean(input && !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file'].includes(input.type));
}

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style'); style.id = STYLE_ID;
  style.textContent = `
    .m-touch-keyboard { position:fixed; z-index:180; left:50%; bottom:calc(var(--m-footer-height, 0px) + 10px); transform:translateX(-50%); width:min(520px, calc(100vw - 20px)); max-height:calc(100dvh - var(--m-header-height, 0px) - var(--m-footer-height, 0px) - 20px); overflow:auto; overscroll-behavior:contain; padding:9px; border:1px solid #63856c; border-radius:13px; color:#edf7ee; background:#152b1d; box-shadow:0 15px 50px #0009; font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .m-touch-keyboard[hidden] { display:none!important; }
    .m-touch-keyboard-header,.m-touch-keyboard-custom,.m-touch-keyboard-mouse { display:flex; align-items:center; gap:5px; margin-bottom:6px; }
    .m-touch-keyboard-title { flex:1; min-width:0; font-size:11px; color:#aed1b7; }
    .m-touch-keyboard button { min-height:44px; min-width:44px; padding:7px 9px; border:1px solid #4a6851; border-radius:7px; color:#e7f4e9; background:#254630; font:inherit; font-size:12px; cursor:pointer; touch-action:manipulation; user-select:none; }
    .m-touch-keyboard button[aria-pressed="true"] { border-color:#a0e3ba; background:#3b6f4c; color:#ddffe7; }
    .m-touch-keyboard button:focus-visible,.m-touch-keyboard input:focus-visible { outline:2px solid #92e4ce; outline-offset:2px; }
    .m-touch-keyboard-keys { display:grid; grid-template-columns:repeat(4,minmax(44px,1fr)); gap:5px; margin:6px 0; }
    .m-touch-keyboard-custom input { min-width:0; flex:1; width:100%; min-height:44px; padding:8px; border:1px solid #52745a; border-radius:7px; background:#102017; color:#eef9f1; font:16px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .m-touch-keyboard-mouse > button { flex:1; }
    .m-touch-keyboard-note { margin:3px 2px 0; color:#b3cbb9; font-size:10px; }
  `;
  document.head.append(style);
}

/** A keyboard and modifier accessory for the original Neuroglancer controls. */
export function createTouchKeyboard(viewer, { notify = () => {} } = {}) {
  installStyle();
  let disposed = false, shown = false, lastNativeFocus = viewer.element, lastPanel, lastPoint;
  const modifiers = { ctrl: false, alt: false, shift: false }, disposers = [];
  const root = document.createElement('section'); root.className = 'm-touch-keyboard'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Native keyboard controls'); root.setAttribute('aria-modal', 'false');
  const header = document.createElement('div'); header.className = 'm-touch-keyboard-header';
  const title = document.createElement('span'); title.className = 'm-touch-keyboard-title'; title.textContent = 'Native keys'; header.append(title);
  const modifierButtons = new Map();

  function on(target, name, listener, options) {
    target.addEventListener(name, listener, options); disposers.push(() => target.removeEventListener(name, listener, options));
  }
  function nativeElement(target) {
    return target instanceof Element && !root.contains(target) && (viewer.element.contains(target)
      || Boolean(target.closest('.overlay,.neuroglancer-context-menu,.neuroglancer-tool-palette-dropdown')));
  }
  function currentPanel() {
    if (lastPanel?.element?.isConnected) return lastPanel;
    return Array.from(viewer.display.panels).find(panel => typeof panel.handleMouseMove === 'function' && panel.element.isConnected);
  }
  function keyTarget() {
    if (lastNativeFocus === viewer.element) return currentPanel()?.element || viewer.element;
    if (lastNativeFocus?.isConnected && nativeElement(lastNativeFocus)) return lastNativeFocus;
    return currentPanel()?.element || viewer.element;
  }
  function eventFlags() { return { ctrlKey: modifiers.ctrl, altKey: modifiers.alt, shiftKey: modifiers.shift, metaKey: false }; }
  function dispatchKey(type, details, target = keyTarget()) {
    const event = new KeyboardEvent(type, { ...details, ...eventFlags(), bubbles: true, cancelable: true, composed: true, repeat: false });
    if (details.keyCode && event.keyCode !== details.keyCode) {
      Object.defineProperty(event, 'keyCode', { value: details.keyCode });
      Object.defineProperty(event, 'which', { value: details.keyCode });
    }
    target.dispatchEvent(event); return event;
  }
  function setModifier(name, value) {
    if (!(name in modifiers)) throw new Error(`Unknown modifier: ${name}`);
    if (modifiers[name] === Boolean(value)) return;
    modifiers[name] = Boolean(value); modifierButtons.get(name).setAttribute('aria-pressed', String(modifiers[name]));
    dispatchKey(modifiers[name] ? 'keydown' : 'keyup', MODIFIERS[name]);
  }
  function clearModifiers() {
    for (const name of Object.keys(modifiers)) setModifier(name, false);
  }
  function nextFocus(target) {
    const candidates = Array.from(document.querySelectorAll('input,textarea,select,button,a[href],[tabindex]')).filter(element =>
      nativeElement(element) && !element.disabled && element.tabIndex >= 0 && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    if (!candidates.length) return;
    const current = candidates.indexOf(target), direction = modifiers.shift ? -1 : 1;
    const next = current < 0 ? (direction > 0 ? 0 : candidates.length - 1) : (current + direction + candidates.length) % candidates.length;
    candidates[next].focus({ preventScroll: true }); lastNativeFocus = candidates[next];
    candidates[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function pressKey(code) {
    if (disposed) return false;
    const details = keyDetails(code, modifiers.shift), target = keyTarget();
    const event = dispatchKey('keydown', details, target); dispatchKey('keyup', details, target);
    if (details.code === 'Tab' && !event.defaultPrevented) nextFocus(target);
    return event.defaultPrevented;
  }
  function clickAtPoint(secondary = false) {
    const panel = currentPanel();
    if (!panel) { notify('Open an image or 3D view first.'); return false; }
    const bounds = panel.element.getBoundingClientRect();
    const point = lastPoint?.panel === panel && lastPoint.x >= bounds.left && lastPoint.x <= bounds.right && lastPoint.y >= bounds.top && lastPoint.y <= bounds.bottom
      ? lastPoint : { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    panel.handleMouseMove(point.x, point.y); lastNativeFocus = panel.element;
    const detail = { ...eventFlags(), bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y,
      button: secondary ? 2 : 0, buttons: secondary ? 2 : 1, detail: 1, view: window };
    panel.element.dispatchEvent(new MouseEvent('mousedown', detail));
    panel.element.dispatchEvent(new MouseEvent('mouseup', { ...detail, buttons: 0 }));
    panel.element.dispatchEvent(new MouseEvent(secondary ? 'contextmenu' : 'click', { ...detail, buttons: 0 }));
    return true;
  }
  function actionButton(text, action, label = text) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.setAttribute('aria-label', label);
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => { try { action(); } catch (error) { notify(error.message || String(error)); } });
    return button;
  }
  for (const [name, spec] of Object.entries(MODIFIERS)) {
    const button = actionButton(spec.label, () => setModifier(name, !modifiers[name]), `Toggle ${spec.label} modifier`);
    button.dataset.touchModifier = name; button.setAttribute('aria-pressed', 'false'); modifierButtons.set(name, button); header.append(button);
  }
  const clear = actionButton('Clear', clearModifiers, 'Clear keyboard modifiers'); clear.dataset.touchKeyboardClear = ''; header.append(clear);
  const dismiss = actionButton('×', close, 'Close native keyboard'); dismiss.dataset.touchKeyboardClose = ''; header.append(dismiss);
  const keys = document.createElement('div'); keys.className = 'm-touch-keyboard-keys';
  for (const [label, code] of [['Esc', 'Escape'], ['Tab', 'Tab'], ['Enter', 'Enter'], ['⌫', 'Backspace'], ['←', 'ArrowLeft'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['→', 'ArrowRight']]) {
    const button = actionButton(label, () => pressKey(code), `Send ${code}`); button.dataset.touchKey = code; keys.append(button);
  }
  const custom = document.createElement('form'); custom.className = 'm-touch-keyboard-custom';
  const codeInput = document.createElement('input'); codeInput.type = 'text'; codeInput.placeholder = 'KeyA, Digit1, Space…';
  codeInput.autocapitalize = 'off'; codeInput.autocomplete = 'off'; codeInput.spellcheck = false; codeInput.setAttribute('aria-label', 'Native key code');
  const send = actionButton('Send key', () => pressKey(codeInput.value)); send.dataset.touchKeyboardSend = ''; custom.append(codeInput, send);
  custom.addEventListener('submit', event => { event.preventDefault(); try { pressKey(codeInput.value); } catch (error) { notify(error.message || String(error)); } });
  const mouse = document.createElement('div'); mouse.className = 'm-touch-keyboard-mouse';
  const primary = actionButton('Click at point', () => clickAtPoint(false), 'Primary click at the last viewer point'); primary.dataset.touchClick = 'primary';
  const secondary = actionButton('Right click', () => clickAtPoint(true), 'Right click at the last viewer point'); secondary.dataset.touchClick = 'secondary'; mouse.append(primary, secondary);
  const note = document.createElement('p'); note.className = 'm-touch-keyboard-note'; note.textContent = 'Keys go to your last native field or view. Use the device keyboard for text. Close clears all modifiers.';
  root.append(header, keys, custom, mouse, note); document.body.append(root);

  on(document, 'focusin', event => { if (nativeElement(event.target)) lastNativeFocus = event.target; }, true);
  on(document, 'pointerdown', event => {
    if (!nativeElement(event.target)) return;
    lastNativeFocus = event.target;
    const panel = Array.from(viewer.display.panels).find(panel => typeof panel.handleMouseMove === 'function' && panel.element.contains(event.target));
    if (panel) { lastPanel = panel; lastNativeFocus = panel.element; lastPoint = { panel, x: event.clientX, y: event.clientY }; }
  }, true);
  const applyModifiers = event => {
    if (!shown || !nativeElement(event.target) || editingTarget(event.target)) return;
    for (const [name, property] of [['ctrl', 'ctrlKey'], ['alt', 'altKey'], ['shift', 'shiftKey']]) {
      if (!modifiers[name] || event[property]) continue;
      Object.defineProperty(event, property, { configurable: true, value: true });
    }
  };
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) on(document, type, applyModifiers, true);
  on(window, 'blur', clearModifiers);
  on(document, 'visibilitychange', () => { if (document.hidden) clearModifiers(); });

  function open() {
    if (disposed) return;
    const focused = document.activeElement; if (nativeElement(focused)) lastNativeFocus = focused;
    shown = true; root.hidden = false;
  }
  function close() {
    if (disposed) return;
    clearModifiers(); shown = false; root.hidden = true;
    if (lastNativeFocus?.isConnected) lastNativeFocus.focus?.({ preventScroll: true });
  }
  return {
    open, close, pressKey, setModifier, clearModifiers, clickAtPoint,
    snapshot: () => ({ open: shown, modifiers: { ...modifiers }, target: keyTarget().tagName, hasViewerPoint: Boolean(lastPoint) }),
    dispose() { if (disposed) return; close(); disposed = true; disposers.forEach(dispose => dispose()); root.remove(); },
  };
}
