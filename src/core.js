// Core utilities, math, noise and the shared game-state object.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp01((v - a) / (b - a));
export const remap = (v, a, b, c, d) => c + (d - c) * clamp01((v - a) / (b - a));
export const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const chance = p => Math.random() < p;
export const pick = arr => arr[(Math.random() * arr.length) | 0];
export const sgn = v => (v < 0 ? -1 : 1);
export const easeOutCubic = t => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = t => clamp01(t) ** 3;
export const easeInOutCubic = t => (t = clamp01(t), t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = t => { t = clamp01(t); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const wrapAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cheap deterministic hash → [0,1)
export function hash2(x, y) {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((y | 0) ^ 0x1b873593, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- Simplex noise (2D)
const GRAD2 = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);
const F2 = 0.3660254037844386, G2 = 0.21132486540518713;

export class Simplex2 {
  constructor(seed = 1) {
    const r = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    this.pm8 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.pm8[i] = (this.perm[i] & 7) * 2; }
  }
  noise(xin, yin) {
    const perm = this.perm, pm = this.pm8;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = pm[ii + perm[jj]]; t0 *= t0; n += t0 * t0 * (GRAD2[g] * x0 + GRAD2[g + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = pm[ii + i1 + perm[jj + j1]]; t1 *= t1; n += t1 * t1 * (GRAD2[g] * x1 + GRAD2[g + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = pm[ii + 1 + perm[jj + 1]]; t2 *= t2; n += t2 * t2 * (GRAD2[g] * x2 + GRAD2[g + 1] * y2); }
    return 70 * n;
  }
}

export function fbm2(n, x, y, oct = 4, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let o = 0; o < oct; o++) { s += a * n.noise(x * f, y * f); norm += a; a *= gain; f *= lac; }
  return s / norm;
}

export function ridged2(n, x, y, oct = 4, lac = 2.1, gain = 0.5) {
  let a = 1, f = 1, s = 0, norm = 0, w = 1;
  for (let o = 0; o < oct; o++) {
    let v = 1 - Math.abs(n.noise(x * f, y * f));
    v *= v * w;
    w = clamp01(v * 1.5);
    s += a * v; norm += a; a *= gain; f *= lac;
  }
  return s / norm;
}

// ---------------------------------------------------------------- Shared state
export const G = {
  renderer: null,
  scene: null,
  camera: null,
  state: 'loading',     // loading | splash | title | play | clear | results | gameover
  paused: false,
  clock: 0,             // real seconds since boot
  time: 0,              // gameplay seconds (scaled)
  dt: 0,                // scaled delta
  rdt: 0,               // real delta
  timeScale: 1,
  hitStop: 0,
  slowMo: 1,
  rail: { d: 0, speed: 100, targetSpeed: 100 },
  run: null,            // per-attempt stats, see newRun()
  player: null,
  shake: 0,
  cinematic: null,      // active camera cinematic
  settings: null,
  lowPerf: false,
};

export function newRun(difficulty = 'normal') {
  return {
    difficulty,
    score: 0,
    hits: 0,
    lives: 3,
    bombs: 3,
    laser: 0,           // 0 single, 1 twin, 2 hyper
    shield: 100,
    maxShield: 100,
    goldRings: 0,
    checkpoint: 0,      // rail distance to respawn from
    shots: 0,
    shotsHit: 0,
    damageTaken: 0,
    rings: 0,
    deaths: 0,
    startTime: 0,
    time: 0,
    bossTime: 0,
    savedKota: false,
    medal: false,
    continues: 0,
  };
}

export const DIFF = {
  easy:   { dmg: 0.6, fire: 0.6, bulletSpeed: 0.85, label: 'EASY' },
  normal: { dmg: 1.0, fire: 1.0, bulletSpeed: 1.0, label: 'NORMAL' },
  hard:   { dmg: 1.45, fire: 1.45, bulletSpeed: 1.15, label: 'HARD' },
};
export const diff = () => DIFF[G.run?.difficulty || G.settings?.difficulty || 'normal'] || DIFF.normal;

// ---------------------------------------------------------------- Persistence (best-effort)
const SETTINGS_KEY = 'novaLancer.settings.v1';
const BEST_KEY = 'novaLancer.best.v1';
export const DEFAULT_SETTINGS = {
  master: 0.8, music: 0.65, sfx: 0.9,
  invertY: false, shake: true, quality: 'auto', difficulty: 'normal',
};

export function loadSettings() {
  let s = { ...DEFAULT_SETTINGS };
  try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) s = { ...s, ...JSON.parse(raw) }; } catch (e) { /* storage unavailable */ }
  return s;
}
export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings)); } catch (e) { /* ignore */ }
}
export function loadBest() {
  try { const raw = localStorage.getItem(BEST_KEY); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
  return { score: 0, hits: 0, rank: '-' };
}
export function saveBest(b) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- Tiny event bus
const listeners = new Map();
export function on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); }
export function emit(ev, a, b, c) { const l = listeners.get(ev); if (l) for (const fn of l) fn(a, b, c); }

// ---------------------------------------------------------------- Helpers
export function colorLinear(hex) { return new THREE.Color(hex); }
export function hdr(hex, k) { return new THREE.Color(hex).multiplyScalar(k); }

// Scheduled callbacks in gameplay time (paused with the game)
const timers = [];
export function after(sec, fn) { timers.push({ t: G.time + sec, fn }); }
export function updateTimers() {
  for (let i = timers.length - 1; i >= 0; i--) {
    if (G.time >= timers[i].t) { const fn = timers[i].fn; timers.splice(i, 1); fn(); }
  }
}
export function clearTimers() { timers.length = 0; }
