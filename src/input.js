// Unified input: keyboard, mouse, gamepad (standard mapping) and on-screen touch controls.
import { G, clamp } from './core.js';

// Physical bindings per action. Codes are KeyboardEvent.code, 'Mouse0/2', 'Pad<n>' or 'Touch<name>'.
const BIND = {
  left:    ['KeyA', 'ArrowLeft', 'Pad14'],
  right:   ['KeyD', 'ArrowRight', 'Pad15'],
  up:      ['KeyW', 'ArrowUp', 'Pad12'],
  down:    ['KeyS', 'ArrowDown', 'Pad13'],
  fire:    ['KeyJ', 'Space', 'KeyZ', 'Mouse0', 'Pad0', 'TouchFire'],
  bomb:    ['KeyK', 'KeyB', 'KeyX', 'Mouse2', 'Pad1', 'Pad3', 'TouchBomb'],
  boost:   ['KeyL', 'ShiftLeft', 'ShiftRight', 'KeyC', 'Pad7', 'TouchBoost'],
  brake:   ['KeyI', 'KeyV', 'Pad6', 'Pad2', 'TouchBrake'],
  rollL:   ['KeyQ', 'KeyU', 'Pad4', 'TouchRollL'],
  rollR:   ['KeyE', 'KeyO', 'Pad5', 'TouchRollR'],
  pause:   ['Escape', 'KeyP', 'Pad9'],
  confirm: ['Enter', 'NumpadEnter', 'Space', 'KeyJ', 'KeyZ', 'Pad0'],
  back:    ['Escape', 'Backspace', 'KeyX', 'KeyK', 'Pad1'],
  mUp:     ['ArrowUp', 'KeyW', 'Pad12', 'PadSU'],
  mDown:   ['ArrowDown', 'KeyS', 'Pad13', 'PadSD'],
  mLeft:   ['ArrowLeft', 'KeyA', 'Pad14', 'PadSL'],
  mRight:  ['ArrowRight', 'KeyD', 'Pad15', 'PadSR'],
};

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyJ', 'KeyK', 'KeyL', 'KeyI', 'KeyQ', 'KeyE', 'KeyU', 'KeyO', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyP', 'ShiftLeft', 'ShiftRight']);

const held = new Set();
const justDown = new Set();
const justUp = new Set();
const actionPrevHeld = {};
const actionHeld = {};
const actionPressed = {};
const actionReleased = {};
const actionDouble = {};
const lastPressTime = {};
const menuRepeat = {};
let anyPress = false;
let stickX = 0, stickY = 0;          // gamepad analog
let touchX = 0, touchY = 0;          // touch stick
let padPrev = [];
let now = 0;

export const Input = {
  x: 0, y: 0,
  device: 'keyboard',
  touchEnabled: false,
  held: a => !!actionHeld[a],
  pressed: a => !!actionPressed[a],
  released: a => !!actionReleased[a],
  double: a => !!actionDouble[a],
  any: () => anyPress,
  menu: a => !!menuRepeat[a],
  setTouchStick(x, y) { touchX = x; touchY = y; },
  touchButton(code, down) {
    if (down) { if (!held.has(code)) justDown.add(code); held.add(code); anyPress = true; this.device = 'touch'; }
    else { if (held.has(code)) justUp.add(code); held.delete(code); }
  },
  clearAll() { held.clear(); justDown.clear(); justUp.clear(); touchX = touchY = 0; },
};

function isTypingTarget(t) {
  return t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

export function initInput(canvasEl) {
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (PREVENT.has(e.code) && G.state !== 'loading') e.preventDefault();
    Input.device = 'keyboard';
    if (e.repeat) return;
    held.add(e.code); justDown.add(e.code); anyPress = true;
  }, { passive: false });
  window.addEventListener('keyup', e => {
    if (held.has(e.code)) justUp.add(e.code);
    held.delete(e.code);
  });
  window.addEventListener('blur', () => {
    for (const c of held) justUp.add(c);
    held.clear();
  });
  const target = canvasEl || window;
  target.addEventListener('mousedown', e => {
    const code = e.button === 2 ? 'Mouse2' : e.button === 0 ? 'Mouse0' : null;
    if (!code) return;
    held.add(code); justDown.add(code); anyPress = true; Input.device = 'keyboard';
  });
  window.addEventListener('mouseup', e => {
    const code = e.button === 2 ? 'Mouse2' : e.button === 0 ? 'Mouse0' : null;
    if (!code) return;
    if (held.has(code)) justUp.add(code);
    held.delete(code);
  });
  target.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('gamepadconnected', () => { Input.device = 'gamepad'; });
}

function pollGamepad() {
  stickX = 0; stickY = 0;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let pad = null;
  for (const p of pads) { if (p && p.connected) { pad = p; break; } }
  if (!pad) { padPrev.length = 0; return; }
  const dz = 0.18;
  const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
  const mag = Math.hypot(ax, ay);
  if (mag > dz) {
    const k = Math.min(1, (mag - dz) / (1 - dz)) / mag;
    stickX = ax * k; stickY = -ay * k;
    Input.device = 'gamepad';
  }
  for (let i = 0; i < pad.buttons.length; i++) {
    const b = pad.buttons[i];
    const pressed = b.pressed || b.value > 0.5;
    const code = 'Pad' + i;
    if (pressed && !padPrev[i]) { held.add(code); justDown.add(code); anyPress = true; Input.device = 'gamepad'; }
    else if (!pressed && padPrev[i]) { held.delete(code); justUp.add(code); }
    padPrev[i] = pressed;
  }
  // Virtual stick "buttons" for menu navigation
  const dirs = [['PadSU', -ay > 0.6], ['PadSD', ay > 0.6], ['PadSL', ax < -0.6], ['PadSR', ax > 0.6]];
  for (const [code, on] of dirs) {
    if (on && !held.has(code)) { held.add(code); justDown.add(code); }
    else if (!on && held.has(code)) { held.delete(code); justUp.add(code); }
  }
}

// Call once at the start of every frame.
export function updateInput(realDt) {
  now += realDt;
  pollGamepad();
  for (const a in BIND) {
    const codes = BIND[a];
    let h = false, p = false, r = false;
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (held.has(c)) h = true;
      if (justDown.has(c)) p = true;
      if (justUp.has(c)) r = true;
    }
    const wasHeld = !!actionPrevHeld[a];
    actionHeld[a] = h;
    actionPressed[a] = p;
    actionReleased[a] = r && !h;
    actionPrevHeld[a] = h;
    actionDouble[a] = false;
    if (p) {
      if (now - (lastPressTime[a] ?? -9) < 0.3) { actionDouble[a] = true; lastPressTime[a] = -9; }
      else lastPressTime[a] = now;
    }
    // Menu auto-repeat
    if (a[0] === 'm') {
      menuRepeat[a] = false;
      if (p) { menuRepeat[a] = true; menuRepeat[a + 'T'] = now + 0.38; }
      else if (h && now >= (menuRepeat[a + 'T'] || 0) && wasHeld) { menuRepeat[a] = true; menuRepeat[a + 'T'] = now + 0.09; }
    }
  }
  // Analog stick menus
  // Movement axes
  let x = (actionHeld.right ? 1 : 0) - (actionHeld.left ? 1 : 0);
  let y = (actionHeld.up ? 1 : 0) - (actionHeld.down ? 1 : 0);
  if (Math.abs(stickX) > Math.abs(x)) x = stickX;
  if (Math.abs(stickY) > Math.abs(y)) y = stickY;
  if (Math.abs(touchX) > 0.02 || Math.abs(touchY) > 0.02) { x = touchX; y = touchY; }
  if (G.settings && G.settings.invertY) y = -y;
  Input.x = clamp(x, -1, 1);
  Input.y = clamp(y, -1, 1);
}

// Call once at the end of every frame.
export function endInputFrame() {
  justDown.clear();
  justUp.clear();
  anyPress = false;
}
