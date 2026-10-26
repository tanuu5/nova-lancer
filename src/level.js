// Stage runner: plays the current stage's script (events keyed to rail distance) and provides the wave helpers
// that stage scripts are written with. The scripts themselves live in src/stages/.
import { G, on } from './core.js';
import { spawnEnemy, wave } from './enemies.js';
import { clearSchedule, resetProps } from './props.js';
import { clearMarkers } from './hud.js';
import { setWingStance } from './wingmen.js';

const EVENTS = [];
let idx = 0;
let stage = null;

export const D = () => G.rail.d;
export const K = (k) => `<kbd>${k}</kbd>`;

// ------------------------------------------------------------ Wave helpers
export function vWing(type, n, dist, v, opts = {}) {
  return wave(type, 'approach', n, (i) => {
    const c = i - (n - 1) / 2;
    return { s: D() + dist + Math.abs(c) * 14, u: (opts.u ?? 0) + c * 11, v: v + Math.abs(c) * 3, speed: opts.speed ?? 28, au: opts.au ?? 6, fu: 0.9, ph: 0, av: 3 };
  }, opts);
}
export function snake(type, n, dist, u0, v, opts = {}) {
  return wave(type, 'approach', n, (i) => ({ s: D() + dist + i * 32, u: u0, au: opts.au ?? 26, fu: 1.3, ph: i * 0.55, v, av: 6, fv: 1.7, speed: opts.speed ?? 22 }), opts);
}
export function fromBehind(type, n, opts = {}) {
  return wave(type, 'behind', n, (i) => ({ rel: 62 + i * 7, u0: (i % 2 ? 1 : -1) * (12 + i * 4), u: (i - (n - 1) / 2) * 14, v0: 34, v: 18 + (i % 3) * 7, dist: 110 + (i % 2) * 30, stay: opts.stay ?? 6, ph: i }), opts);
}
export function holders(type, n, dist, opts = {}) {
  return wave(type, 'hold', n, (i) => ({ s: D() + 700, dist: dist + i * 25, enter: 2.4, stay: opts.stay ?? 7, u: (i - (n - 1) / 2) * 30, au: 16, fu: 0.7, ph: i * 1.7, v: opts.v ?? 26, av: 8 }), opts);
}
export function ringOf(type, n, dist, opts = {}) {
  return wave(type, 'circle', n, (i) => ({ s: D() + 700, dist, enter: 2.6, stay: opts.stay ?? 7, r: opts.r ?? 18, a0: i / n * Math.PI * 2, spin: 1.3, u: opts.u ?? 0, v: opts.v ?? 26 }), opts);
}
export function crossing(type, n, dist, dir, v, opts = {}) {
  return wave(type, 'cross', n, (i) => ({ dist: dist + i * 6, u0: -dir * (100 + i * 18), su: dir * 42, v: v + (i % 2) * 6, av: 4, ph: i }), opts);
}
export function divers(type, n, opts = {}) {
  return wave(type, 'dive', n, (i) => ({ s: D() + 520 + i * 40, speed: 20, dur: 3.5, v0: 110, v: 14 + (i % 2) * 8, u: (i - (n - 1) / 2) * 18, au: 8, ph: i }), opts);
}
export function turret(s, u, opts = {}) { return spawnEnemy(opts.type || 'turret', 'fixed', { s, u, v: opts.v ?? 0, onGround: opts.onGround, minY: opts.minY }, opts); }
export function mine(s, u, v) { return spawnEnemy('mine', 'fixed', { s, u, v, bob: 3, ph: Math.random() * 6 }); }

// ------------------------------------------------------------ Runner
// Boss events go to whichever stage is loaded; the listeners are registered once for the whole session.
export function initLevel() {
  on('bossPhase', (p) => stage?.onBossPhase?.(p));
  on('bossCharge', () => stage?.onBossCharge?.());
  on('bossDying', () => stage?.onBossDying?.());
  on('bossPartDown', (left) => stage?.onBossPartDown?.(left));
}

export function loadStageScript(def) {
  stage = def;
  EVENTS.length = 0;
  clearSchedule();
  def.script((d, fn) => EVENTS.push({ d, fn }));
  EVENTS.sort((a, b) => a.d - b.d);
}

export function startLevel(fromD) {
  setWingStance(fromD < stage.wingRearAt ? 'front' : 'rear');
  idx = 0;
  while (idx < EVENTS.length && EVENTS[idx].d < fromD) idx++;
  resetProps(fromD);
  clearMarkers();
}

export function updateLevel() {
  while (idx < EVENTS.length && G.rail.d >= EVENTS[idx].d) { const e = EVENTS[idx++]; e.fn(); }
}
