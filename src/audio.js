// =============================================================================
// NOVA LANCER — procedural audio engine
// -----------------------------------------------------------------------------
// 100% synthesized with the Web Audio API: no samples, no files, no network.
//
//   1. Utilities
//   2. Engine state & signal graph (master / music / sfx buses, shared reverb)
//   3. Procedural buffers (noise colours, metal, crackle, reverb impulse)
//   4. Voice management (short-lived node groups, caps, cleanup)
//   5. SFX building blocks
//   6. One-shot SFX library
//   7. Continuous loops
//   8. Radio voice babble
//   9. Music instruments
//  10. Music notation compiler
//  11. Song data (all melodies are original compositions)
//  12. Sequencer / song players
//  13. Public API (AudioSys)
// =============================================================================

// -----------------------------------------------------------------------------
// 1. Utilities
// -----------------------------------------------------------------------------
const EPS = 0.0001;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const jit = (amt) => 1 + (Math.random() * 2 - 1) * amt;
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// Breakpoint envelope on an AudioParam. pts = [[dt, value, curve], ...]
// curve: 'l' linear ramp, 's' step, default exponential (values floored at EPS).
function env(p, t, pts, scale = 1) {
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    const tt = t + pt[0];
    const v = pt[1] * scale;
    if (i === 0 || pt[2] === 's') p.setValueAtTime(v, tt);
    else if (pt[2] === 'l') p.linearRampToValueAtTime(v, tt);
    else p.exponentialRampToValueAtTime(Math.max(Math.abs(v), EPS), tt);
  }
}

// Percussive amplitude envelope: 0 -> peak (linear, a) -> EPS (exponential, d).
function perc(p, t, peak, a, d) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(EPS, t + a + d);
  return t + a + d;
}

// Smoothly move a parameter towards a value (safe to call every frame).
function glide(p, v, tc, t) {
  p.cancelScheduledValues(t);
  p.setTargetAtTime(v, t, Math.max(0.001, tc));
}

// Soft-clip transfer curve for WaveShaperNodes (cached per amount).
const curveCache = new Map();
function driveCurve(amount) {
  const key = Math.round(amount * 100);
  let c = curveCache.get(key);
  if (c) return c;
  const n = 1024;
  c = new Float32Array(n);
  const k = Math.max(0.01, amount);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  curveCache.set(key, c);
  return c;
}

// Deterministic 32-bit hash (used for voice babble and repeatable variation).
function hash32(x) {
  x = (x ^ 61) ^ (x >>> 16);
  x = Math.imul(x, 0x27d4eb2d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 13;
  return x >>> 0;
}

// -----------------------------------------------------------------------------
// 2. Engine state & signal graph
// -----------------------------------------------------------------------------
//   music voices -> song buses -> musicIn -> mVol -> mDuck -> mPause -> master
//   music sends  ------------------> musicRev -> (mirrored chain) -> reverb
//   sfx voices   -> sfxIn -> sVol -> master ;  sfx sends -> sfxRev -> reverb
//   loops        -> loopBus (pause mute) -> sfxIn
//   voice babble -> radio EQ -> sfxIn
//   master -> compressor (glue/limit) -> trim -> destination
let ctx = null;
let failed = false;
let G = null;              // graph nodes
let BUF = null;            // procedural buffers
let timer = null;          // scheduler interval id
let resumeAskedAt = -1e9;  // time (ms) of the last resume() request
let isPaused = false;
const VOL = { master: 0.8, music: 0.7, sfx: 0.9 };
const volGain = (v) => clamp(v, 0, 1) * clamp(v, 0, 1) * 1.25; // perceptual slider curve

const MUSIC_TRIM = 0.62;   // overall music level (leaves headroom for SFX)
const SFX_TRIM = 0.9;
const REVERB_RETURN = 2.4;

function mkGain(v = 1) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}
function mkFilter(type, f, q = 0.707, gain = 0) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  if (gain) b.gain.value = gain;
  return b;
}
function mkShaper(amount) {
  const s = ctx.createWaveShaper();
  s.curve = driveCurve(amount);
  s.oversample = '2x';
  return s;
}
function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

function buildGraph() {
  const g = {};
  g.master = mkGain(volGain(VOL.master));
  g.comp = ctx.createDynamicsCompressor();
  g.comp.threshold.value = -12;
  g.comp.knee.value = 10;
  g.comp.ratio.value = 3.5;
  g.comp.attack.value = 0.003;
  g.comp.release.value = 0.25;
  g.out = mkGain(0.92);
  chain(g.master, g.comp, g.out, ctx.destination);

  // Shared reverb (send/return). High-passed input keeps the low end clean.
  g.verbIn = mkFilter('highpass', 170, 0.6);
  g.verb = ctx.createConvolver();
  g.verb.buffer = BUF.ir;
  g.verbRet = mkGain(REVERB_RETURN);
  chain(g.verbIn, g.verb, g.verbRet, g.master);

  // Music: dry chain and a mirrored wet chain so volume/duck/pause affect both.
  g.musicIn = mkGain(MUSIC_TRIM);
  g.musicRev = mkGain(MUSIC_TRIM);
  g.mVol = [mkGain(volGain(VOL.music)), mkGain(volGain(VOL.music))];
  g.mDuck = [mkGain(1), mkGain(1)];
  g.mPause = [mkGain(1), mkGain(1)];
  chain(g.musicIn, g.mVol[0], g.mDuck[0], g.mPause[0], g.master);
  chain(g.musicRev, g.mVol[1], g.mDuck[1], g.mPause[1], g.verbIn);

  // SFX
  g.sfxIn = mkGain(SFX_TRIM);
  g.sfxRev = mkGain(SFX_TRIM);
  g.sVol = [mkGain(volGain(VOL.sfx)), mkGain(volGain(VOL.sfx))];
  chain(g.sfxIn, g.sVol[0], g.master);
  chain(g.sfxRev, g.sVol[1], g.verbIn);

  // Loops are muted as a group while paused.
  g.loopBus = mkGain(1);
  g.loopBus.connect(g.sfxIn);

  // Radio EQ for the babble voices: band-limited, slightly saturated.
  g.radioIn = mkGain(1);
  chain(g.radioIn, mkFilter('highpass', 320, 0.8), mkFilter('lowpass', 3100, 0.9),
    mkFilter('peaking', 1700, 1.2, 4), mkShaper(2.2), mkGain(0.36), g.sfxIn);
  return g;
}

function hasPanner() {
  return !!(ctx && typeof ctx.createStereoPanner === 'function');
}

// -----------------------------------------------------------------------------
// 3. Procedural buffers
// -----------------------------------------------------------------------------
function makeBuffers() {
  const sr = ctx.sampleRate;
  const B = {};
  const len = Math.floor(sr * 2);

  // White noise (stereo, decorrelated).
  B.white = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = B.white.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  // Pink noise (Paul Kellet's refined filter), stereo.
  B.pink = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = B.pink.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }

  // Brown noise (leaky integrator), stereo.
  B.brown = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = B.brown.getChannelData(c);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
  }

  // "Metal": six detuned square waves (808-style cymbal source) + a little noise.
  const mlen = Math.floor(sr * 1);
  B.metal = ctx.createBuffer(1, mlen, sr);
  {
    const d = B.metal.getChannelData(0);
    const fr = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0].map((f) => f * 1.7);
    for (let i = 0; i < mlen; i++) {
      const t = i / sr;
      let s = 0;
      for (let k = 0; k < fr.length; k++) s += ((t * fr[k]) % 1) < 0.5 ? 1 : -1;
      d[i] = s / 6 * 0.8 + (Math.random() * 2 - 1) * 0.2;
    }
  }

  // Crackle: sparse, decaying impulses (debris, sparks, static).
  B.crackle = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = B.crackle.getChannelData(c);
    let amp = 0, ph = 0, fr = 0;
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.0016) { amp = Math.random() * 0.9 + 0.1; fr = rnd(0.2, 1.4); ph = 0; }
      d[i] = amp * Math.sin(ph) * (Math.random() < 0.5 ? 1 : 0.6);
      ph += fr;
      amp *= 0.985;
    }
  }

  B.ir = makeImpulse(2.3, sr);
  return B;
}

// Stereo reverb impulse: pre-delay, sparse early reflections, then an
// exponentially decaying diffuse tail that gets darker over time.
function makeImpulse(seconds, sr) {
  const len = Math.floor(sr * seconds);
  const ir = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * 0.012);
  const rt = seconds * 0.92;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const x = i / len;
      const decay = Math.exp(-6.9 * t / rt);
      const a = 0.9 - 0.78 * x;               // tail darkens as it decays
      lp += a * ((Math.random() * 2 - 1) - lp);
      const fadeIn = Math.min(1, t / 0.035);  // soft onset of the diffuse tail
      d[i] = lp * decay * fadeIn * 0.9;
    }
    // Early reflections (different per channel for width).
    for (let k = 0; k < 14; k++) {
      const ti = pre + Math.floor(sr * rnd(0.004, 0.085));
      if (ti < len) d[ti] += (Math.random() < 0.5 ? -1 : 1) * rnd(0.25, 0.7) * (1 - k / 16);
    }
    d[len - 1] = 0;
  }
  return ir;
}

// -----------------------------------------------------------------------------
// 4. Voice management
// -----------------------------------------------------------------------------
// A Voice owns a group of short-lived nodes. Sources are started/stopped once;
// when the last source ends (onended) every node is disconnected. Pools cap the
// number of simultaneous voices and fade out the oldest when exceeded; a
// periodic sweep catches anything whose onended never fired.
class Pool {
  constructor(max) { this.max = max; this.list = []; }
  add(v) {
    this.list.push(v);
    let active = 0;
    for (const x of this.list) if (!x.killed) active++;
    if (active > this.max) {
      for (const x of this.list) if (!x.killed && x !== v) { x.kill(); break; }
    }
  }
  remove(v) {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
  }
  sweep(now) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      if (v && now > v.end + 1.0) v.dispose();
    }
  }
}
let sfxPool = null;
let musicPool = null;

class Voice {
  constructor(pool, dest, t, gain = 1, pan = 0) {
    this.pool = pool;
    this.t = t;
    this.end = t + 0.05;
    this.nodes = [];
    this.srcs = [];
    this.live = 0;
    this.dead = false;
    this.killed = false;
    this.out = mkGain(gain);
    this.nodes.push(this.out);
    let tail = this.out;
    if (pan && hasPanner()) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      this.out.connect(p);
      this.nodes.push(p);
      tail = p;
    }
    tail.connect(dest);
    this.tail = tail;
    pool.add(this);
  }
  // Track a helper node so it is disconnected with the voice.
  keep(n) { this.nodes.push(n); return n; }
  gain(v = 1, dest = this.out) { const g = this.keep(mkGain(v)); g.connect(dest); return g; }
  filter(type, f, q = 0.707, dest = this.out, gdb = 0) { const b = this.keep(mkFilter(type, f, q, gdb)); b.connect(dest); return b; }
  shaper(amount, dest = this.out) { const s = this.keep(mkShaper(amount)); s.connect(dest); return s; }
  panner(pan, dest = this.out) {
    if (!hasPanner()) return dest;
    const p = this.keep(ctx.createStereoPanner());
    p.pan.value = clamp(pan, -1, 1);
    p.connect(dest);
    return p;
  }
  // Register a source node: start it, schedule its stop and hook cleanup.
  src(n, t0, t1, offset) {
    this.nodes.push(n);
    this.srcs.push(n);
    this.live++;
    n.onended = () => { this.live--; if (this.live <= 0) this.dispose(); };
    if (offset !== undefined) n.start(t0, offset); else n.start(t0);
    n.stop(t1);
    if (t1 > this.end) this.end = t1;
    return n;
  }
  osc(type, f, t0, t1, dest = this.out, detune = 0) {
    const o = ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    o.connect(dest);
    return this.src(o, t0, t1);
  }
  noise(kind, t0, t1, dest = this.out, rate = 1) {
    const s = ctx.createBufferSource();
    const b = BUF[kind] || BUF.white;
    s.buffer = b;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    return this.src(s, t0, t1, Math.random() * b.duration * 0.9);
  }
  send(bus, amt) {
    if (amt <= 0) return;
    const s = this.keep(mkGain(amt));
    this.tail.connect(s);
    s.connect(bus);
  }
  kill() {
    if (this.dead || this.killed) return;
    this.killed = true;
    const t = ctx.currentTime;
    try {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(0, t, 0.01);
    } catch (e) { /* ignore */ }
    for (const s of this.srcs) { try { s.stop(t + 0.07); } catch (e) { /* already stopped */ } }
    this.end = Math.min(this.end, t + 0.07);
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    for (const n of this.nodes) {
      try { n.disconnect(); } catch (e) { /* ignore */ }
      if (n.onended) n.onended = null;
    }
    this.nodes.length = 0;
    this.srcs.length = 0;
    this.pool.remove(this);
  }
}

// -----------------------------------------------------------------------------
// 5. SFX building blocks
// -----------------------------------------------------------------------------
// Apply a number or a breakpoint curve to an AudioParam.
function curve(p, t, c, scale = 1) {
  if (c === undefined || c === null) return;
  if (typeof c === 'number') p.setValueAtTime(c * scale, t);
  else env(p, t, c, scale);
}

// One synthesis layer: source -> [filter] -> [filter2] -> [shaper] -> [tremolo] -> amp -> [pan] -> voice.
//   o: oscillator type | n: noise buffer name ('white','pink','brown','metal','crackle')
//   f: frequency (number | curve)   det: detune (cents)   r: noise playbackRate curve
//   ft/ff/q, ft2/ff2/q2: filters (ff curves are scaled by pitch)
//   g: [peak, attack, decay] or a breakpoint curve     at: start offset     dur: forced length
//   sh: waveshaper drive   am: [rate, depth, type] tremolo   pan / ps: [from, to] pan sweep
//   fm: [ratio, index, decay] FM bell    vib: [rate, cents, delay]    fn: [noise, Hz] noisy FM
function layer(v, s) {
  const t = v.t + (s.at || 0);
  const p = v.p || 1;
  const amp = v.keep(mkGain(0));
  const g = s.g || [0.3, 0.005, 0.2];
  let end;
  if (Array.isArray(g[0])) { env(amp.gain, t, g); end = t + g[g.length - 1][0]; }
  else end = perc(amp.gain, t, g[0], g[1], g[2]);
  if (s.dur) end = t + s.dur;

  let out = v.out;
  if (s.ps && hasPanner()) {
    out = v.panner(s.ps[0], v.out);
    env(out.pan, t, [[0, s.ps[0]], [Math.max(0.01, end - t), s.ps[1], 'l']]);
  } else if (s.pan) out = v.panner(s.pan, v.out);
  amp.connect(out);

  let head = amp;
  const stop = end + 0.03;
  if (s.am) {
    const depth = clamp(s.am[1], 0, 1);
    const tr = v.gain(1 - depth * 0.5, head);
    const lg = v.gain(depth * 0.5, tr.gain);
    v.osc(s.am[2] || 'square', s.am[0], t, stop, lg);
    head = tr;
  }
  if (s.sh) head = v.shaper(s.sh, head);
  if (s.ft2) { const f2 = v.filter(s.ft2, 1000, s.q2 || 0.707, head); curve(f2.frequency, t, s.ff2, p); head = f2; }
  if (s.ft) { const f1 = v.filter(s.ft, 1000, s.q || 0.707, head); curve(f1.frequency, t, s.ff, p); head = f1; }

  if (s.n) {
    const rate = clamp(p, 0.25, 4);
    const src = v.noise(s.n, t, stop, head, rate);
    if (s.r) curve(src.playbackRate, t, s.r, rate);
  } else {
    const o = v.osc(s.o || 'sine', 440, t, stop, head, s.det || 0);
    curve(o.frequency, t, s.f === undefined ? 440 : s.f, p);
    const base = (typeof s.f === 'number' ? s.f : (s.f ? s.f[0][1] : 440)) * p;
    if (s.fm) {
      const mg = v.gain(0, o.frequency);
      env(mg.gain, t, [[0, base * s.fm[1]], [s.fm[2], base * s.fm[1] * 0.06]]);
      v.osc('sine', base * s.fm[0], t, stop, mg);
    }
    if (s.vib) {
      const vg = v.gain(0, o.detune);
      env(vg.gain, t, [[0, 0], [s.vib[2], 0, 'l'], [s.vib[2] + 0.25, s.vib[1], 'l']]);
      v.osc('sine', s.vib[0], t, stop, vg);
    }
    if (s.fn) {
      const ng = v.gain(s.fn[1] * p, o.frequency);
      v.noise(s.fn[0], t, stop, ng, 1);
    }
  }
  return end;
}
const L = layer;
const rev = (v, amt) => v.send(G.sfxRev, amt);

// FM bell partial (sparkles, chimes, pings).
function bell(v, at, f, peak, decay, pan = 0, bright = 1.4) {
  L(v, { at, o: 'sine', f, g: [peak, 0.002, decay], fm: [3.51, bright, decay * 0.45], pan });
  L(v, { at, o: 'sine', f: f * 2.0, g: [peak * 0.22, 0.002, decay * 0.4], pan: -pan });
}
// Short synth tone with a gate (UI beeps, jingles).
function beep(v, at, type, f, peak, len, ff = 5000, extra = {}) {
  return L(v, Object.assign({ at, o: type, f, ft: 'lowpass', ff, q: 0.8,
    g: [[0, 0], [0.004, peak, 'l'], [Math.max(0.01, len), peak * 0.75], [len + 0.06, EPS]] }, extra));
}
// Parametric explosion: len (s), weight 0..2, brightness (initial LP Hz).
function explosion(v, len, weight, bright) {
  L(v, { o: 'sine', f: [[0, 150 - 32 * weight], [len * 0.35, 40 - 8 * weight]], g: [0.5 + 0.16 * weight, 0.003, len * 0.5] });
  L(v, { o: 'triangle', f: [[0, 95 - 15 * weight], [len * 0.3, 30]], g: [0.2 + 0.1 * weight, 0.004, len * 0.4] });
  L(v, { n: 'brown', ft: 'lowpass', ff: [[0, 2400 - 450 * weight], [len, 130]], q: 0.9, sh: 1.6 + weight,
    g: [[0, 0], [0.008, 0.6, 'l'], [len * 0.3, 0.3], [len, EPS]] });
  L(v, { n: 'white', ft: 'lowpass', ff: [[0, bright], [len * 0.45, 520]], g: [0.42, 0.002, len * 0.45] });
  L(v, { n: 'crackle', at: 0.03, ft: 'highpass', ff: 1400, g: [[0, 0], [0.05, 0.28 + 0.1 * weight, 'l'], [len * 0.85, EPS]] });
}

// -----------------------------------------------------------------------------
// 6. One-shot SFX library   (fn(voice, opts); voice.p = pitch multiplier)
// -----------------------------------------------------------------------------
const SFX = {
  laser(v) {
    L(v, { o: 'square', f: [[0, 1850], [0.11, 360]], ft: 'lowpass', ff: [[0, 7000], [0.11, 1400]], q: 2, g: [0.13, 0.002, 0.115] });
    L(v, { o: 'sawtooth', f: [[0, 1870], [0.1, 380]], det: 12, ft: 'lowpass', ff: 5000, g: [0.08, 0.002, 0.1] });
    L(v, { o: 'sine', f: [[0, 950], [0.09, 240]], g: [0.14, 0.002, 0.09] });
    L(v, { n: 'white', ft: 'highpass', ff: 3500, g: [0.16, 0.001, 0.014] });
  },

  laserTwin(v) {
    for (const [pan, m, at] of [[-0.45, 0.985, 0], [0.45, 1.015, 0.007]]) {
      L(v, { at, pan, o: 'square', f: [[0, 1720 * m], [0.12, 330 * m]], ft: 'lowpass', ff: [[0, 6500], [0.12, 1300]], q: 2, g: [0.1, 0.002, 0.13] });
      L(v, { at, pan, o: 'sawtooth', f: [[0, 1740 * m], [0.12, 342 * m]], det: 10, ft: 'lowpass', ff: 4500, g: [0.06, 0.002, 0.12] });
    }
    L(v, { o: 'triangle', f: [[0, 720], [0.12, 170]], g: [0.16, 0.002, 0.12] });
    L(v, { n: 'white', ft: 'highpass', ff: 3000, g: [0.15, 0.001, 0.016] });
  },

  laserHyper(v) {
    const sweep = [[0, 520], [0.018, 1350], [0.2, 190]];
    for (const [det, pan] of [[-14, -0.35], [0, 0], [14, 0.35]]) {
      L(v, { pan, det, o: 'sawtooth', f: sweep, ft: 'bandpass', ff: [[0, 1500], [0.02, 4200], [0.2, 480]], q: 4, g: [0.12, 0.003, 0.2] });
    }
    L(v, { o: 'square', f: [[0, 260], [0.018, 675], [0.2, 95]], ft: 'lowpass', ff: 1800, g: [0.1, 0.003, 0.19] });
    L(v, { o: 'sine', f: [[0, 180], [0.2, 58]], g: [0.2, 0.003, 0.18] });
    L(v, { n: 'white', ft: 'bandpass', ff: [[0, 6000], [0.08, 1500]], q: 1.2, g: [0.12, 0.001, 0.05] });
  },

  chargeReady(v) {
    bell(v, 0, 2093, 0.13, 0.16, -0.2);
    bell(v, 0.075, 2637, 0.13, 0.3, 0.2);
    L(v, { o: 'triangle', f: 1046.5, g: [0.05, 0.002, 0.12] });
    rev(v, 0.25);
  },

  lockOn(v) {
    for (const [at, f] of [[0, 1975], [0.072, 1975]]) {
      beep(v, at, 'square', f, 0.07, 0.035, 5200);
      beep(v, at, 'sine', f * 2, 0.03, 0.03, 9000);
    }
  },

  chargeShot(v) {
    L(v, { o: 'sine', f: [[0, 120], [0.55, 38]], g: [0.5, 0.004, 0.6] });
    for (const d of [-9, 9]) {
      L(v, { o: 'sawtooth', det: d, f: [[0, 240], [0.45, 55]], ft: 'lowpass', ff: [[0, 3200], [0.5, 260]], q: 7, g: [0.18, 0.005, 0.5] });
    }
    L(v, { o: 'square', f: [[0, 1400], [0.09, 280]], ft: 'lowpass', ff: 4000, g: [0.1, 0.002, 0.09] });
    L(v, { n: 'pink', ft: 'bandpass', ff: [[0, 3500], [0.55, 380]], q: 1.4, g: [[0, 0], [0.03, 0.4, 'l'], [0.6, EPS]] });
    rev(v, 0.3);
  },

  bombLaunch(v) {
    L(v, { o: 'sine', f: [[0, 170], [0.14, 55]], g: [0.4, 0.003, 0.16] });
    L(v, { n: 'pink', ft: 'bandpass', ff: [[0, 450], [0.5, 2600], [0.8, 1800]], q: 1.1, g: [[0, 0], [0.06, 0.5, 'l'], [0.35, 0.35], [0.85, EPS]] });
    L(v, { n: 'brown', ft: 'lowpass', ff: 380, g: [[0, 0], [0.04, 0.45, 'l'], [0.7, EPS]] });
    L(v, { n: 'white', ft: 'highpass', ff: [[0, 2500], [0.6, 6000]], g: [[0, 0], [0.08, 0.1, 'l'], [0.7, EPS]] });
    rev(v, 0.2);
  },

  bombBlast(v) {
    L(v, { o: 'square', f: [[0, 900], [0.05, 80]], ft: 'lowpass', ff: 2500, g: [0.26, 0.001, 0.06] });
    L(v, { o: 'sine', f: [[0, 76], [1.2, 24]], g: [0.85, 0.006, 1.7] });
    L(v, { o: 'triangle', f: [[0, 110], [0.9, 30]], g: [0.3, 0.004, 1.0] });
    L(v, { n: 'brown', ft: 'lowpass', ff: [[0, 1400], [2.4, 110]], q: 0.8, sh: 2.5, g: [[0, 0], [0.012, 0.75, 'l'], [0.4, 0.45], [2.5, EPS]] });
    L(v, { n: 'white', ft: 'lowpass', ff: [[0, 8000], [0.7, 500]], g: [0.5, 0.003, 0.9] });
    L(v, { n: 'crackle', at: 0.08, ft: 'highpass', ff: 1200, g: [[0, 0], [0.1, 0.42, 'l'], [2.0, EPS]] });
    L(v, { n: 'pink', at: 0.18, ft: 'lowpass', ff: [[0, 2500], [1.8, 300]], g: [[0, 0], [0.15, 0.3, 'l'], [2.1, EPS]] });
    rev(v, 0.5);
  },

  explodeS(v) { explosion(v, 0.6, 0, 7000); rev(v, 0.14); },

  explodeM(v) {
    explosion(v, 1.2, 1, 6000);
    L(v, { at: 0.07, n: 'pink', ft: 'lowpass', ff: [[0, 2600], [0.8, 260]], g: [0.25, 0.01, 0.8] });
    rev(v, 0.24);
  },

  explodeL(v) {
    explosion(v, 2.0, 2, 5500);
    L(v, { at: 0.13, o: 'sine', f: [[0, 95], [0.6, 30]], g: [0.45, 0.004, 0.7] });
    L(v, { at: 0.13, n: 'white', ft: 'lowpass', ff: [[0, 5000], [0.6, 400]], g: [0.3, 0.003, 0.6] });
    L(v, { at: 0.3, n: 'crackle', ft: 'bandpass', ff: 2500, q: 0.8, g: [[0, 0], [0.1, 0.3, 'l'], [1.5, EPS]] });
    rev(v, 0.36);
  },

  hitEnemy(v) {
    L(v, { n: 'white', ft: 'highpass', ff: 2500, g: [0.18, 0.001, 0.02] });
    for (const [f, a, d] of [[1870, 0.08, 0.08], [2950, 0.06, 0.06], [4230, 0.045, 0.045], [1240, 0.05, 0.1]]) {
      L(v, { o: 'sine', f, g: [a, 0.001, d] });
    }
    L(v, { o: 'triangle', f: [[0, 420], [0.05, 190]], g: [0.13, 0.001, 0.05] });
    L(v, { n: 'metal', ft: 'bandpass', ff: 5200, q: 3, g: [0.1, 0.001, 0.05] });
  },

  playerHit(v) {
    L(v, { n: 'white', ft: 'lowpass', ff: [[0, 4500], [0.2, 700]], sh: 4, g: [0.42, 0.002, 0.2] });
    L(v, { o: 'square', f: [[0, 170], [0.16, 48]], ft: 'lowpass', ff: 1400, sh: 3, g: [0.24, 0.002, 0.17] });
    L(v, { o: 'sine', f: [[0, 110], [0.25, 40]], g: [0.42, 0.002, 0.28] });
    for (const [f, a, d] of [[523, 0.06, 0.7], [527.5, 0.045, 0.75], [1308, 0.045, 0.55], [2215, 0.035, 0.4], [3151, 0.025, 0.3]]) {
      L(v, { at: 0.004, o: 'sine', f, g: [a, 0.002, d] });
    }
    L(v, { at: 0.07, n: 'crackle', ft: 'bandpass', ff: 2200, q: 1.5, g: [[0, 0], [0.01, 0.35, 'l'], [0.18, 0.25], [0.3, EPS]] });
    L(v, { at: 0.07, n: 'white', ft: 'bandpass', ff: 1800, q: 2.5, am: [47, 0.8], g: [[0, 0], [0.01, 0.12, 'l'], [0.2, 0.08], [0.28, EPS]] });
    rev(v, 0.2);
  },

  crash(v) {
    L(v, { o: 'sawtooth', f: [[0, 95], [0.5, 70]], fn: ['white', 70], ft: 'bandpass', ff: 900, q: 1.2, sh: 3,
      g: [[0, 0], [0.01, 0.3, 'l'], [0.35, 0.24], [0.55, EPS]] });
    L(v, { n: 'metal', ft: 'bandpass', ff: [[0, 3000], [0.5, 1800]], q: 2, am: [31, 0.6, 'sawtooth'],
      g: [[0, 0], [0.01, 0.26, 'l'], [0.3, 0.2], [0.5, EPS]] });
    L(v, { n: 'white', ft: 'highpass', ff: 4000, am: [23, 0.7], g: [[0, 0], [0.01, 0.16, 'l'], [0.45, EPS]] });
    L(v, { o: 'sine', f: [[0, 90], [0.2, 45]], g: [0.32, 0.002, 0.2] });
  },

  deflect(v) {
    L(v, { o: 'sine', f: [[0, 3400], [0.4, 3050]], g: [0.15, 0.001, 0.4] });
    L(v, { o: 'sine', f: [[0, 5130], [0.3, 4580]], g: [0.06, 0.001, 0.25] });
    L(v, { o: 'triangle', f: [[0, 5200], [0.16, 1300]], g: [0.09, 0.001, 0.16] });
    L(v, { n: 'white', ft: 'highpass', ff: 5000, g: [0.18, 0.001, 0.012] });
    rev(v, 0.25);
  },

  roll(v, o) {
    const s = num(o && o.pan, 0) < 0 ? -1 : 1;
    L(v, { n: 'pink', ft: 'bandpass', ff: [[0, 380], [0.24, 2600], [0.55, 450]], q: 2.2, ps: [-0.6 * s, 0.6 * s],
      g: [[0, 0], [0.14, 0.5, 'l'], [0.3, 0.36], [0.56, EPS]] });
    L(v, { n: 'white', ft: 'bandpass', ff: [[0, 1500], [0.25, 6000], [0.5, 1800]], q: 3, ps: [-0.4 * s, 0.4 * s],
      g: [[0, 0], [0.15, 0.1, 'l'], [0.5, EPS]] });
  },

  boost(v) {
    L(v, { n: 'pink', ft: 'bandpass', ff: [[0, 500], [0.7, 3200]], q: 1.2, g: [[0, 0], [0.05, 0.45, 'l'], [0.4, 0.3], [0.95, EPS]] });
    L(v, { n: 'brown', ft: 'lowpass', ff: 420, g: [[0, 0], [0.03, 0.42, 'l'], [0.8, EPS]] });
    L(v, { o: 'sawtooth', det: -6, f: [[0, 160], [0.7, 520]], ft: 'lowpass', ff: [[0, 500], [0.7, 2400]], q: 3,
      g: [[0, 0], [0.08, 0.1, 'l'], [0.5, 0.07], [0.9, EPS]] });
    L(v, { o: 'sine', f: [[0, 130], [0.12, 50]], g: [0.36, 0.003, 0.14] });
    rev(v, 0.15);
  },

  brake(v) {
    L(v, { n: 'white', ft: 'bandpass', ff: [[0, 4200], [0.65, 650]], q: 1.4, g: [[0, 0], [0.03, 0.3, 'l'], [0.3, 0.2], [0.75, EPS]] });
    L(v, { n: 'pink', ft: 'lowpass', ff: [[0, 1800], [0.6, 300]], g: [[0, 0], [0.02, 0.26, 'l'], [0.6, EPS]] });
    L(v, { o: 'sawtooth', f: [[0, 340], [0.6, 110]], ft: 'lowpass', ff: 900, g: [[0, 0], [0.02, 0.07, 'l'], [0.6, EPS]] });
  },

  ring(v) {
    const notes = [1318.5, 1661.2, 1975.5, 2637.0];
    notes.forEach((f, i) => bell(v, i * 0.045, f, 0.1, 0.55, (i % 2 ? 0.35 : -0.35)));
    L(v, { n: 'white', ft: 'highpass', ff: 7500, g: [[0, 0], [0.05, 0.05, 'l'], [0.5, EPS]] });
    rev(v, 0.35);
  },

  goldRing(v) {
    const notes = [1046.5, 1318.5, 1568.0, 2093.0, 2637.0, 3136.0];
    notes.forEach((f, i) => bell(v, i * 0.05, f, 0.09, 0.95, [-0.5, 0.5, -0.25, 0.25, -0.1, 0.1][i]));
    for (const [f, pan] of [[2093, -0.4], [2099.5, 0.4], [3136, -0.2], [3143, 0.2]]) {
      L(v, { at: 0.12, pan, o: 'sine', f, am: [7, 0.6, 'sine'], g: [[0, 0], [0.3, 0.035, 'l'], [0.8, 0.025], [1.6, EPS]] });
    }
    for (const m of [72, 76, 79]) {
      L(v, { o: 'sawtooth', f: mtof(m), det: m === 76 ? 7 : -7, ft: 'lowpass', ff: 2200,
        g: [[0, 0], [0.06, 0.035, 'l'], [0.5, 0.03], [1.4, EPS]] });
    }
    L(v, { n: 'white', ft: 'highpass', ff: 8000, g: [[0, 0], [0.2, 0.05, 'l'], [1.3, EPS]] });
    rev(v, 0.5);
  },

  item(v) {
    [880, 1108.7, 1318.5, 1760].forEach((f, i) => {
      bell(v, i * 0.04, f, 0.1, 0.35, i % 2 ? 0.2 : -0.2, 1.1);
      L(v, { at: i * 0.04, o: 'triangle', f, g: [0.05, 0.002, 0.12] });
    });
    rev(v, 0.25);
  },

  powerUp(v) {
    const seq = [523.25, 659.25, 783.99, 1046.5];
    seq.forEach((f, i) => {
      const last = i === seq.length - 1;
      beep(v, i * 0.065, 'square', f, 0.07, last ? 0.32 : 0.05, 4200, last ? { vib: [6, 18, 0.1] } : {});
      beep(v, i * 0.065, 'sawtooth', f * 0.5, 0.05, last ? 0.32 : 0.05, 2400);
    });
    bell(v, 0.195, 2093, 0.07, 0.6, 0, 1.2);
    rev(v, 0.3);
  },

  shieldUp(v) {
    L(v, { o: 'triangle', f: [[0, 300], [0.6, 1200]], ft: 'lowpass', ff: 3000, g: [[0, 0], [0.1, 0.16, 'l'], [0.5, 0.12], [0.9, EPS]] });
    L(v, { o: 'sine', f: [[0, 150], [0.6, 600]], g: [[0, 0], [0.1, 0.1, 'l'], [0.8, EPS]] });
    for (const [f, pan] of [[2400, -0.4], [2412, 0.4]]) {
      L(v, { at: 0.2, pan, o: 'sine', f, am: [9, 0.7, 'sine'], g: [[0, 0], [0.3, 0.035, 'l'], [1.0, EPS]] });
    }
    L(v, { n: 'white', ft: 'bandpass', ff: [[0, 800], [0.7, 5000]], q: 3, g: [[0, 0], [0.3, 0.1, 'l'], [0.9, EPS]] });
    rev(v, 0.4);
  },

  extraLife(v) {
    // Original 1UP jingle: rising figure, turn, leap to the octave.
    const seq = [[86, 0.075], [90, 0.075], [93, 0.075], [90, 0.075], [95, 0.075], [98, 0.45]];
    let at = 0;
    for (const [m, len] of seq) {
      const f = mtof(m);
      beep(v, at, 'square', f, 0.065, len * 0.9, 5000, len > 0.2 ? { vib: [6.5, 15, 0.12] } : {});
      bell(v, at, f * 0.5, 0.045, len + 0.3, 0, 1.0);
      at += len;
    }
    bell(v, 0.375, mtof(93), 0.05, 0.9, -0.3);
    bell(v, 0.375, mtof(90), 0.05, 0.9, 0.3);
    rev(v, 0.3);
  },

  enemyShot(v) {
    L(v, { o: 'sawtooth', f: [[0, 900], [0.15, 180]], ft: 'lowpass', ff: [[0, 3000], [0.15, 700]], q: 3, sh: 2.5, g: [0.11, 0.002, 0.15] });
    L(v, { o: 'square', f: [[0, 452], [0.15, 92]], ft: 'lowpass', ff: 1600, g: [0.08, 0.002, 0.14] });
    L(v, { n: 'white', ft: 'bandpass', ff: 2500, q: 1, g: [0.11, 0.001, 0.02] });
  },

  missile(v) {
    L(v, { n: 'white', ft: 'bandpass', ff: [[0, 2800], [0.4, 1100]], q: 1, g: [[0, 0], [0.015, 0.33, 'l'], [0.12, 0.24], [0.45, EPS]] });
    L(v, { n: 'white', ft: 'highpass', ff: 6000, g: [[0, 0], [0.01, 0.1, 'l'], [0.35, EPS]] });
    L(v, { o: 'sine', f: [[0, 200], [0.1, 80]], g: [0.24, 0.002, 0.1] });
    rev(v, 0.12);
  },

  lowShield(v) {
    for (const at of [0, 0.13]) {
      beep(v, at, 'square', 880, 0.075, 0.07, 2800);
      beep(v, at, 'sine', 1760, 0.03, 0.07, 8000);
    }
  },

  checkpoint(v) {
    const seq = [[88, 0.08], [84, 0.08], [91, 0.08], [96, 0.42]];
    let at = 0;
    for (const [m, len] of seq) {
      beep(v, at, 'square', mtof(m), 0.06, len * 0.9, 4500);
      bell(v, at, mtof(m), 0.05, len + 0.25, 0, 1.0);
      at += len;
    }
    rev(v, 0.3);
  },

  uiMove(v) {
    L(v, { o: 'square', f: [[0, 1200], [0.03, 1280]], ft: 'lowpass', ff: 4000, g: [0.05, 0.001, 0.035] });
    L(v, { o: 'sine', f: 2400, g: [0.025, 0.001, 0.03] });
  },

  uiSelect(v) {
    beep(v, 0, 'square', 880, 0.06, 0.045, 3800);
    beep(v, 0.055, 'square', 1318.5, 0.06, 0.1, 4200);
    bell(v, 0.055, 2637, 0.04, 0.3, 0, 1.0);
    rev(v, 0.15);
  },

  uiBack(v) {
    beep(v, 0, 'triangle', 700, 0.1, 0.05, 3000);
    beep(v, 0.06, 'triangle', 466, 0.1, 0.09, 2500);
    beep(v, 0.06, 'square', 466, 0.03, 0.08, 1800);
  },

  pause(v) {
    bell(v, 0, 987.8, 0.08, 0.7, -0.2, 1.0);
    bell(v, 0.07, 1318.5, 0.08, 0.8, 0.2, 1.0);
    L(v, { o: 'sine', f: 659.25, g: [0.06, 0.004, 0.6] });
    rev(v, 0.35);
  },

  splash(v) {
    L(v, { o: 'sine', f: [[0, 62], [0.6, 28]], g: [0.6, 0.005, 0.9] });
    L(v, { n: 'white', ft: 'lowpass', ff: [[0, 4500], [1.8, 1200]], g: [[0, 0], [0.04, 0.5, 'l'], [0.4, 0.36], [2.0, EPS]] });
    L(v, { n: 'white', ft: 'highpass', ff: 3000, g: [[0, 0], [0.25, 0.2, 'l'], [1.9, EPS]] });
    L(v, { n: 'brown', ft: 'lowpass', ff: 600, g: [[0, 0], [0.03, 0.45, 'l'], [1.6, EPS]] });
    L(v, { at: 0.35, n: 'pink', ft: 'bandpass', ff: 900, q: 0.6, am: [5, 0.5, 'sine'], g: [[0, 0], [0.2, 0.25, 'l'], [1.6, EPS]] });
    for (let i = 0; i < 22; i++) {
      const at = rnd(0.25, 1.9);
      const f = rnd(500, 1800);
      L(v, { at, pan: rnd(-0.8, 0.8), o: 'sine', f: [[0, f], [0.045, f * 1.6]], g: [rnd(0.015, 0.05), 0.002, 0.05] });
    }
    rev(v, 0.45);
  },

  roar(v) {
    const env1 = [[0, 0], [0.15, 0.42, 'l'], [1.2, 0.34], [1.8, EPS]];
    const pitch = [[0, 48], [0.35, 72], [1.2, 64], [1.8, 40]];
    L(v, { o: 'sawtooth', f: pitch, fn: ['brown', 18], ft: 'bandpass', ff: [[0, 300], [0.4, 760], [1.3, 520], [1.8, 300]], q: 3,
      sh: 6, am: [28, 0.5, 'sine'], g: env1 });
    L(v, { o: 'sawtooth', f: pitch.map(([t, f]) => [t, f * 1.5]), fn: ['brown', 25], ft: 'bandpass',
      ff: [[0, 900], [0.4, 1700], [1.3, 1200], [1.8, 800]], q: 4, sh: 4, g: [[0, 0], [0.2, 0.26, 'l'], [1.2, 0.2], [1.8, EPS]] });
    L(v, { o: 'square', f: pitch.map(([t, f]) => [t, f * 3.1]), fn: ['white', 40], ft: 'bandpass', ff: 2200, q: 5,
      am: [97, 1, 'sine'], g: [[0, 0], [0.25, 0.12, 'l'], [1.3, 0.09], [1.8, EPS]] });
    L(v, { o: 'sine', f: [[0, 40], [0.4, 55], [1.8, 32]], g: [[0, 0], [0.1, 0.45, 'l'], [1.3, 0.35], [1.9, EPS]] });
    L(v, { n: 'pink', ft: 'bandpass', ff: [[0, 500], [0.5, 1200], [1.8, 400]], q: 1, g: [[0, 0], [0.2, 0.22, 'l'], [1.8, EPS]] });
    L(v, { n: 'metal', ft: 'bandpass', ff: [[0, 1200], [0.5, 2000], [1.8, 900]], q: 2, am: [13, 0.8, 'sawtooth'],
      g: [[0, 0], [0.3, 0.14, 'l'], [1.7, EPS]] });
    rev(v, 0.45);
  },

  radio(v) {
    L(v, { n: 'crackle', ft: 'bandpass', ff: 1900, q: 1.2, g: [[0, 0], [0.005, 0.35, 'l'], [0.1, 0.3], [0.14, EPS]] });
    L(v, { n: 'white', ft: 'bandpass', ff: 2400, q: 2, am: [60, 0.9], g: [[0, 0], [0.005, 0.12, 'l'], [0.13, EPS]] });
    beep(v, 0.15, 'square', 1320, 0.055, 0.05, 3000);
    beep(v, 0.23, 'square', 1760, 0.055, 0.06, 3000);
  },

  gateClose(v) {
    L(v, { o: 'sine', f: 1180, g: [0.07, 0.001, 0.08] });
    L(v, { o: 'sine', f: 2090, g: [0.05, 0.001, 0.06] });
    L(v, { at: 0.02, o: 'sine', f: [[0, 95], [0.3, 38]], g: [0.75, 0.003, 0.45] });
    L(v, { at: 0.02, n: 'brown', ft: 'lowpass', ff: [[0, 1800], [0.3, 200]], sh: 2.5, g: [0.55, 0.002, 0.3] });
    [[180, 0.09, 1.0], [297, 0.08, 0.8], [431, 0.06, 0.7], [612, 0.05, 0.55], [845, 0.04, 0.45]].forEach(([f, a, d]) => {
      L(v, { at: 0.02, o: 'sine', f, g: [a, 0.002, d] });
    });
    L(v, { at: 0.05, n: 'crackle', ft: 'bandpass', ff: 1200, g: [0.2, 0.005, 0.35] });
    rev(v, 0.4);
  },

  countTick(v) {
    beep(v, 0, 'square', 2400, 0.035, 0.012, 6000);
    L(v, { o: 'sine', f: 4800, g: [0.018, 0.001, 0.02] });
  },

  rankStamp(v) {
    L(v, { o: 'sine', f: [[0, 130], [0.35, 42]], g: [0.7, 0.002, 0.45] });
    L(v, { n: 'white', ft: 'lowpass', ff: [[0, 6000], [0.3, 600]], g: [0.42, 0.001, 0.3] });
    L(v, { n: 'metal', ft: 'highpass', ff: 5000, g: [0.14, 0.002, 1.3] });
    L(v, { n: 'white', ft: 'highpass', ff: 7000, g: [0.08, 0.002, 1.1] });
    [[1568, 0.06], [2349.3, 0.1], [3136, 0.14]].forEach(([f, at], i) => bell(v, at, f, 0.07, 0.9, (i - 1) * 0.4));
    rev(v, 0.4);
  },

  warning(v) {
    beep(v, 0, 'sawtooth', 880, 0.08, 0.2, 2000, { vib: [9, 20, 0] });
    beep(v, 0.23, 'sawtooth', 660, 0.08, 0.2, 1800, { vib: [9, 20, 0] });
    beep(v, 0, 'square', 440, 0.03, 0.2, 1200);
    beep(v, 0.23, 'square', 330, 0.03, 0.2, 1200);
  },
};

// Per-sound options: gap = minimum retrigger interval (s), jit = random pitch spread.
// vol = loudness trim (balanced by offline level analysis).
const SFX_META = {
  laser: { gap: 0.03, jit: 0.02, vol: 1.25 }, laserTwin: { gap: 0.03, jit: 0.02, vol: 1.25 },
  laserHyper: { gap: 0.03, jit: 0.02, vol: 1.3 }, hitEnemy: { gap: 0.035, jit: 0.04, vol: 1.3 },
  enemyShot: { gap: 0.03, jit: 0.04, vol: 1.4 }, deflect: { gap: 0.03, jit: 0.03 },
  explodeS: { gap: 0.04, jit: 0.04, vol: 0.72 }, explodeM: { gap: 0.05, jit: 0.035, vol: 0.8 },
  explodeL: { gap: 0.07, jit: 0.03, vol: 0.72 }, bombBlast: { gap: 0.1, jit: 0.02, vol: 0.72 },
  chargeShot: { vol: 0.72 }, playerHit: { gap: 0.06, jit: 0.03, vol: 0.8 }, gateClose: { vol: 0.85 },
  crash: { gap: 0.12, jit: 0.04 }, roll: { gap: 0.1, jit: 0.03, vol: 2.0 },
  missile: { gap: 0.04, jit: 0.04 }, countTick: { gap: 0.02, jit: 0.02, vol: 2.5 },
  uiMove: { gap: 0.02, vol: 2.2 }, uiSelect: { vol: 1.6 }, uiBack: { vol: 1.6 }, pause: { vol: 1.3 },
  lowShield: { gap: 0.2, vol: 1.8 }, warning: { gap: 0.2, vol: 1.8 }, radio: { vol: 1.8 },
  lockOn: { gap: 0.06, vol: 1.6 }, chargeReady: { gap: 0.1, vol: 1.3 },
  splash: { gap: 0.2 }, roar: { gap: 0.25 }, ring: { gap: 0.05, vol: 1.2 }, item: { gap: 0.05, vol: 1.3 },
  powerUp: { vol: 1.3 },
};
const lastPlayed = Object.create(null);

// -----------------------------------------------------------------------------
// 7. Continuous loops
// -----------------------------------------------------------------------------
// Each loop owns persistent sources feeding its own fade gain -> loopBus.
// set(params) only touches AudioParams through cancel+setTargetAtTime, and is
// skipped when nothing changed, so it is cheap to call every frame.
const activeLoops = new Set();
const dyingLoops = new Set();
const MAX_LOOPS = 16;
const NOOP_HANDLE = Object.freeze({ set() {}, stop() {} });

class LoopSound {
  constructor(name) {
    this.name = name;
    this.t = ctx.currentTime + 0.01;
    this.nodes = [];
    this.srcs = [];
    this.stopped = false;
    this.dead = false;
    this.stopAt = Infinity;
    this.key = '';
    this.out = mkGain(0);
    this.out.connect(G.loopBus);
    this.nodes.push(this.out);
    this.update = null;
    activeLoops.add(this);
    if (activeLoops.size > MAX_LOOPS) {
      for (const l of activeLoops) { if (l !== this) { l.stop(0.1); break; } }
    }
  }
  keep(n) { this.nodes.push(n); return n; }
  gain(v, dest) { const g = this.keep(mkGain(v)); g.connect(dest); return g; }
  filter(type, f, q, dest) { const b = this.keep(mkFilter(type, f, q)); b.connect(dest); return b; }
  src(n) {
    this.nodes.push(n);
    this.srcs.push(n);
    n.onended = () => { if (this.stopped) this.dispose(); };
    return n;
  }
  osc(type, f, dest, detune = 0) {
    const o = this.src(ctx.createOscillator());
    o.type = type;
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    o.connect(dest);
    o.start(this.t);
    return o;
  }
  noise(kind, dest, rate = 1) {
    const s = this.src(ctx.createBufferSource());
    s.buffer = BUF[kind];
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(this.t, Math.random() * s.buffer.duration * 0.9);
    return s;
  }
  fadeIn(time, level = 1) {
    this.out.gain.setValueAtTime(0, this.t);
    this.out.gain.linearRampToValueAtTime(level, this.t + time);
  }
  set(params) {
    if (this.stopped || !this.update) return;
    this.update(params || {}, ctx.currentTime);
  }
  stop(fade) {
    if (this.stopped) return;
    this.stopped = true;
    activeLoops.delete(this);
    dyingLoops.add(this);
    const t = ctx.currentTime;
    const f = Math.max(0.01, num(fade, 0.2));
    glide(this.out.gain, 0, f / 5, t);
    this.stopAt = t + f + 0.05;
    for (const s of this.srcs) { try { s.stop(this.stopAt); } catch (e) { /* ignore */ } }
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    for (const n of this.nodes) {
      try { n.disconnect(); } catch (e) { /* ignore */ }
      if (n.onended) n.onended = null;
    }
    this.nodes.length = 0;
    this.srcs.length = 0;
    activeLoops.delete(this);
    dyingLoops.delete(this);
  }
}

const LOOPS = {
  // Subtle layered jet hum: saw drone + band-passed air rush + turbine whine.
  engine(lp) {
    const droneLvl = lp.gain(0.055, lp.out);
    const droneF = lp.filter('lowpass', 300, 1.1, droneLvl);
    const s1 = lp.osc('sawtooth', 70, droneF);
    const s2 = lp.osc('sawtooth', 70.4, droneF, 8);
    const sub = lp.osc('sine', 35, lp.gain(0.05, lp.out));

    const rushG = lp.gain(0.04, lp.out);
    const rushF = lp.filter('bandpass', 900, 0.8, rushG);
    lp.noise('pink', rushF);
    const turb = lp.gain(0.01, rushG.gain);
    const turbL = lp.osc('sine', 6.3, turb);

    const whineG = lp.gain(0.0, lp.out);
    const whineF = lp.filter('bandpass', 1800, 6, whineG);
    const w1 = lp.osc('triangle', 1800, whineF);
    const w2 = lp.osc('sine', 2710, whineF);

    const hissG = lp.gain(0.006, lp.out);
    lp.noise('white', lp.filter('highpass', 5200, 0.7, hissG));

    lp.fadeIn(0.5, 0.7);
    lp.update = (p, now) => {
      const speed = clamp(num(p.speed, 1), 0.2, 2.5);
      const boost = !!p.boost;
      const brake = !!p.brake;
      const key = speed.toFixed(2) + (boost ? 'B' : '') + (brake ? 'K' : '');
      if (key === lp.key) return;
      lp.key = key;
      const k = speed * (boost ? 1.3 : 1) * (brake ? 0.72 : 1);
      const tc = boost ? 0.22 : brake ? 0.3 : 0.4;
      glide(s1.frequency, 44 + 26 * k, tc, now);
      glide(s2.frequency, 44.3 + 26 * k, tc, now);
      glide(sub.frequency, 22 + 13 * k, tc, now);
      glide(droneF.frequency, 150 + 240 * k + (boost ? 260 : 0), tc, now);
      glide(droneLvl.gain, 0.04 + 0.025 * k, tc, now);
      glide(rushF.frequency, 450 + 800 * k + (boost ? 1100 : 0), tc, now);
      glide(rushG.gain, Math.max(0.01, 0.02 + 0.03 * k + (boost ? 0.045 : 0) - (brake ? 0.012 : 0)), tc, now);
      glide(turbL.frequency, 5 + 3 * k, tc, now);
      glide(w1.frequency, boost ? 2900 : 1350 + 350 * k, boost ? 0.45 : 0.5, now);
      glide(w2.frequency, boost ? 4350 : 2030 + 520 * k, boost ? 0.45 : 0.5, now);
      glide(whineF.frequency, boost ? 3000 : 1400 + 350 * k, boost ? 0.45 : 0.5, now);
      glide(whineG.gain, boost ? 0.02 : 0.0025 * k, boost ? 0.25 : 0.4, now);
      glide(hissG.gain, brake ? 0.03 : 0.004 + 0.004 * k, 0.2, now);
    };
    lp.update({ speed: 1 }, lp.t);
  },

  // Charge whine 300 -> 1200 Hz, tremolo speeds up; stable shimmer when full.
  charge(lp) {
    const g = lp.gain(0.03, lp.out);
    const trem = lp.gain(0.65, g);
    const bp = lp.filter('bandpass', 700, 2.2, trem);
    const o1 = lp.osc('sawtooth', 300, bp);
    const o2 = lp.osc('sine', 301, trem);
    const lfoG = lp.gain(0.35, trem.gain);
    const lfo = lp.osc('sine', 4, lfoG);
    const shimG = lp.gain(0, lp.out);
    const sh1 = lp.osc('sine', 2400, shimG);
    const sh2 = lp.osc('sine', 2407, shimG);
    lp.fadeIn(0.06);
    lp.update = (p, now) => {
      const lv = clamp(num(p.level, 0), 0, 1);
      const key = String(Math.round(lv * 200));
      if (key === lp.key) return;
      lp.key = key;
      const f = 300 + 900 * lv;
      const full = lv >= 0.999;
      glide(o1.frequency, f, 0.04, now);
      glide(o2.frequency, f * 2.003, 0.04, now);
      glide(bp.frequency, f * 2.2, 0.05, now);
      glide(lfo.frequency, full ? 5 : 4 + 20 * lv, 0.08, now);
      glide(lfoG.gain, full ? 0.05 : 0.35, 0.06, now);
      glide(shimG.gain, full ? 0.03 : 0, 0.08, now);
      glide(sh1.frequency, 2400 * (full ? 1 : 0.9), 0.1, now);
      glide(sh2.frequency, 2407 * (full ? 1 : 0.9), 0.1, now);
      glide(g.gain, 0.025 + 0.055 * lv, 0.06, now);
    };
    lp.update({ level: 0 }, lp.t);
  },

  // Boss beam charging: rising whine + electrical crackle (self-animating).
  beamCharge(lp) {
    const t = lp.t;
    const whG = lp.gain(0, lp.out);
    env(whG.gain, t, [[0, 0], [0.3, 0.05, 'l'], [2.0, 0.12, 'l']]);
    const bp = lp.filter('bandpass', 400, 5, whG);
    env(bp.frequency, t, [[0, 400], [2.2, 3600]]);
    const o1 = lp.osc('sawtooth', 200, bp);
    const o2 = lp.osc('square', 300, bp, 12);
    env(o1.frequency, t, [[0, 200], [2.2, 1800]]);
    env(o2.frequency, t, [[0, 300], [2.2, 2700]]);
    const crG = lp.gain(0, lp.out);
    env(crG.gain, t, [[0, 0.04], [2.0, 0.35, 'l']]);
    lp.noise('crackle', lp.filter('highpass', 1800, 0.7, crG), 1.3);
    const buzzG = lp.gain(0, lp.out);
    env(buzzG.gain, t, [[0, 0], [2.0, 0.06, 'l']]);
    const trem = lp.gain(0.5, buzzG);
    lp.osc('square', 17, lp.gain(0.5, trem.gain));
    lp.osc('sawtooth', 60, lp.filter('bandpass', 1200, 3, trem));
    const subG = lp.gain(0, lp.out);
    env(subG.gain, t, [[0, 0], [2.0, 0.22, 'l']]);
    const sub = lp.osc('sine', 40, subG);
    env(sub.frequency, t, [[0, 40], [2.0, 70]]);
    lp.fadeIn(0.05);
  },

  // Boss beam firing: distorted buzzing roar with filter/amplitude wobble.
  beam(lp) {
    const g = lp.gain(0.11, lp.out);
    const trem = lp.gain(0.75, g);
    lp.osc('sine', 11, lp.gain(0.25, trem.gain));
    const lpf = lp.filter('lowpass', 1800, 2, trem);
    lp.osc('sine', 8, lp.gain(700, lpf.frequency));
    const sh = lp.keep(mkShaper(5));
    sh.connect(lpf);
    lp.osc('sawtooth', 70, sh);
    lp.osc('sawtooth', 70.8, sh, 5);
    lp.osc('sawtooth', 140.5, sh);
    const roarG = lp.gain(0.22, lp.out);
    lp.noise('brown', lp.filter('bandpass', 420, 0.8, roarG));
    const szG = lp.gain(0.9, lp.gain(0.05, lp.out));
    lp.osc('square', 23, lp.gain(0.5, szG.gain));
    lp.noise('white', lp.filter('highpass', 5000, 0.7, szG));
    lp.osc('sine', 45, lp.gain(0.22, lp.out));
    lp.fadeIn(0.06);
  },

  // Boss-approach siren: smooth two-tone 880/660 Hz every 0.35 s, softened.
  siren(lp) {
    const g = lp.gain(0.06, lp.out);
    const tone = lp.filter('lowpass', 1700, 1, g);
    const pk = lp.filter('peaking', 1200, 1, tone);
    pk.gain.value = 3;
    const o1 = lp.osc('sawtooth', 770, pk);
    const o2 = lp.osc('square', 770, lp.gain(0.35, pk), 6);
    const smooth = lp.keep(mkFilter('lowpass', 30, 0.7));
    const depth = lp.keep(mkGain(110));
    smooth.connect(depth);
    depth.connect(o1.frequency);
    depth.connect(o2.frequency);
    lp.osc('square', 1 / 0.7, smooth);
    const vib = lp.gain(5, o1.frequency);
    lp.osc('sine', 6, vib);
    lp.fadeIn(0.12);
  },
};

// -----------------------------------------------------------------------------
// 8. Radio voice babble (gibberish "voices" for typed radio text)
// -----------------------------------------------------------------------------
// A glottal source (saw/square) through three parallel formant band-passes,
// then the shared radio EQ + saturation. Vowel comes from the kana itself when
// possible; pitch/length/contour variation is a deterministic hash of the char.
const VOICE_DEF = {
  kota:     { f0: 500, spread: 0.11, form: 1.22, len: 0.055, wave: 'sawtooth', bounce: 0.16, gain: 0.8 },
  gantetsu: { f0: 140, spread: 0.06, form: 0.82, len: 0.085, wave: 'sawtooth', bounce: -0.05, noise: 0.45, fry: 38, gain: 1.35 },
  rio:      { f0: 360, spread: 0.07, form: 1.12, len: 0.07, wave: 'sawtooth', bounce: 0.04, soft: 2400, gain: 0.9 },
  hou:      { f0: 250, spread: 0.09, form: 0.98, len: 0.085, wave: 'sawtooth', bounce: 0.02, vib: [6.2, 0.05], gain: 0.9 },
  mizuchi:  { f0: 110, spread: 0.05, form: 0.9, len: 0.075, wave: 'square', bounce: 0, ring: 377, gain: 0.8 },
};
const FORMANTS = {
  a: [800, 1250, 2600], i: [300, 2250, 3000], u: [340, 1300, 2400],
  e: [470, 1900, 2600], o: [500, 900, 2450], n: [260, 1150, 2300],
};
const SKIP_CHARS = /[\s　、。，．,.!?！？…‥「」『』（）()[\]【】〈〉《》ー－〜~・:：;；"'“”‘’\-—–_/\\|*#@&%+=<>^`っッ]/;
let kanaVowel = null;
function vowelOf(ch, h) {
  if (!kanaVowel) {
    kanaVowel = new Map();
    const rows = {
      a: 'あかさたなはまやらわがざだばぱぁゃゎ', i: 'いきしちにひみりぎじぢびぴぃ',
      u: 'うくすつぬふむゆるぐずづぶぷぅゅゔ', e: 'えけせてねへめれげぜでべぺぇ',
      o: 'おこそとのほもよろをごぞどぼぽぉょ', n: 'ん',
    };
    for (const k in rows) {
      for (const c of rows[k]) {
        kanaVowel.set(c, k);
        kanaVowel.set(String.fromCharCode(c.charCodeAt(0) + 0x60), k); // katakana
      }
    }
  }
  const k = kanaVowel.get(ch);
  if (k) return k;
  const lc = ch.toLowerCase();
  if ('aiueo'.includes(lc) && lc.length === 1) return lc;
  return 'aiueo'[h % 5];
}

const lastBlip = Object.create(null);
function babble(who, ch) {
  if (typeof ch !== 'string' || !ch.length) return;
  const c = String.fromCodePoint(ch.codePointAt(0));
  if (SKIP_CHARS.test(c)) return;
  const P = VOICE_DEF[who] || VOICE_DEF.rio;
  const now = ctx.currentTime;
  if (now - (lastBlip[who] || -1) < 0.028) return;
  lastBlip[who] = now;

  const code = c.codePointAt(0);
  const h = hash32(code * 7919 + 17);
  const vw = vowelOf(c, h >>> 16);
  const pm = 1 + ((h & 0xff) / 255 * 2 - 1) * P.spread;
  const len = P.len * (0.85 + ((h >>> 8) & 0xff) / 255 * 0.35) * (vw === 'n' ? 1.2 : 1);
  const contour = (h >>> 24) & 3;
  const f0 = P.f0 * pm;
  const t = now + 0.005;
  const stop = t + len + 0.03;

  const v = new Voice(sfxPool, G.radioIn, t, P.gain * (vw === 'n' ? 0.7 : 1));
  const amp = v.gain(0);
  env(amp.gain, t, [[0, 0], [0.008, 0.5, 'l'], [len * 0.65, 0.42], [len, EPS]]);
  const F = FORMANTS[vw];
  const mix = v.keep(mkGain(1));
  [[F[0], 6, 1.0], [F[1], 9, 0.55], [F[2], 12, 0.28]].forEach(([f, q, a]) => {
    const bp = v.filter('bandpass', f * P.form, q, v.gain(a * 3.2, amp));
    mix.connect(bp);
  });
  let srcDest = mix;
  if (P.soft) srcDest = v.filter('lowpass', P.soft, 0.7, mix);
  if (P.ring) {
    const rm = v.gain(0, srcDest);          // true ring modulation: gain driven by a sine
    v.osc('sine', P.ring * (0.95 + (h & 7) * 0.02), t, stop, rm.gain);
    const clean = v.gain(0.35, srcDest);
    srcDest = v.gain(1, rm);
    srcDest.connect(clean);
  }
  if (P.fry) {
    const fry = v.gain(0.6, srcDest);
    v.osc('square', P.fry, t, stop, v.gain(0.4, fry.gain));
    srcDest = fry;
  }
  const o = v.osc(P.wave, f0, t, stop, srcDest);
  const b = P.bounce;
  if (contour === 0) env(o.frequency, t, [[0, f0 * (1 + b)], [len * 0.4, f0], [len, f0 * 0.97]]);
  else if (contour === 1) env(o.frequency, t, [[0, f0 * 0.92], [len, f0 * (1.06 + b * 0.5)]]);
  else if (contour === 2) env(o.frequency, t, [[0, f0 * (1.08 + b * 0.5)], [len, f0 * 0.9]]);
  else env(o.frequency, t, [[0, f0 * 0.95], [len * 0.45, f0 * (1.07 + b)], [len, f0 * 0.93]]);
  if (P.vib) v.osc('sine', P.vib[0], t, stop, v.gain(f0 * P.vib[1], o.frequency));
  if (P.noise) v.noise('white', t, stop, v.gain(P.noise, mix));
  if (who === 'mizuchi') v.osc('square', f0 * 2.01, t, stop, v.gain(0.3, srcDest));
}

// -----------------------------------------------------------------------------
// 9. Music instruments
// -----------------------------------------------------------------------------
// Instruments are functions (player, time, event). Each note is a Voice in
// musicPool routed into the song's instrument buses (see SongPlayer).

// ADSR on a gain param (setTarget based; robust for any note length).
function adsr(p, t, dur, a, dc, s, r, peak) {
  a = Math.min(a, dur * 0.5);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(peak * s, t + a, Math.max(0.005, dc / 3));
  p.setTargetAtTime(0, t + dur, Math.max(0.005, r / 5));
  return t + dur + r * 1.25;
}
// Rise-then-settle filter envelope.
function fenv(p, t, lo, hi, sus, a, dc) {
  p.setValueAtTime(lo, t);
  p.linearRampToValueAtTime(hi, t + a);
  p.setTargetAtTime(sus, t + a, Math.max(0.005, dc / 3));
}
const cap = (f) => Math.min(f, 16000);

const INST = {
  // Lead brass: three detuned saws, filter envelope, scoop/glide, delayed vibrato.
  lead(sp, t, e) {
    const f = mtof(e.n), d = e.d, vel = e.v;
    const v = new Voice(musicPool, sp.bus.lead, t, 1);
    const amp = v.gain(0);
    const end = adsr(amp.gain, t, d, 0.03, 0.3, 0.78, 0.16, 0.13 * vel);
    const lpf = v.filter('lowpass', f * 2, 1.6, amp);
    fenv(lpf.frequency, t, cap(f * 1.3), cap(f * (4.5 + 3 * vel) + 400), cap(f * 3 + 300), 0.05, 0.35);
    const vib = d > 0.32 ? v.keep(mkGain(0)) : null;
    if (vib) {
      env(vib.gain, t, [[0, 0], [0.26, 0, 'l'], [0.6, 13, 'l']]);
      v.osc('sine', 5.4, t, end, vib);
    }
    for (const [det, type, lvl] of [[-8, 'sawtooth', 1], [0, 'sawtooth', 1], [8, 'sawtooth', 1], [-1200, 'triangle', 0.6]]) {
      const o = v.osc(type, f, t, end, lvl === 1 ? lpf : v.gain(lvl, lpf), det);
      const from = e.g ? mtof(e.g) : f * 0.985;
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(f, t + (e.g ? 0.07 : 0.035));
      if (vib) vib.connect(o.detune);
    }
  },

  // Gentle lead (flute/ocarina-like) for calm cues.
  soft(sp, t, e) {
    const f = mtof(e.n), d = e.d, vel = e.v;
    const v = new Voice(musicPool, sp.bus.lead, t, 1);
    const amp = v.gain(0);
    const end = adsr(amp.gain, t, d, 0.07, 0.4, 0.8, 0.45, 0.16 * vel);
    const lpf = v.filter('lowpass', cap(f * 4), 0.8, amp);
    const vib = v.keep(mkGain(0));
    env(vib.gain, t, [[0, 0], [0.2, 0, 'l'], [0.55, 12, 'l']]);
    v.osc('sine', 5, t, end, vib);
    for (const [type, lvl, mul] of [['triangle', 1, 1], ['sine', 0.5, 2], ['sawtooth', 0.12, 1]]) {
      const o = v.osc(type, f * mul, t, end, v.gain(lvl, lpf));
      if (e.g) { o.frequency.setValueAtTime(mtof(e.g) * mul, t); o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.09); }
      vib.connect(o.detune);
    }
    v.noise('white', t, t + 0.08, v.filter('bandpass', cap(f * 3), 2, v.gain(0.015 * vel, amp)));
  },

  // Synth-strings pad: two detuned saws per note spread hard L/R.
  pad(sp, t, e) {
    const d = e.d, vel = e.v, ns = e.ns;
    const v = new Voice(musicPool, sp.bus.pad, t, 1);
    const amp = v.gain(0);
    const att = e.sw ? d * 0.85 : (e.a || 0.35);
    const end = adsr(amp.gain, t, d, att, 0.6, 0.85, e.r || 0.9, 0.066 * vel * (4 / Math.max(3, ns.length)));
    const merge = v.keep(ctx.createChannelMerger(2));
    merge.connect(amp);
    const bright = e.sw ? 1 : 0;
    const fl = v.keep(mkFilter('lowpass', 1800, 0.5));
    const fr = v.keep(mkFilter('lowpass', 1800, 0.5));
    fl.connect(merge, 0, 0);
    fr.connect(merge, 0, 1);
    for (const fp of [fl.frequency, fr.frequency]) {
      if (bright) env(fp, t, [[0, 700], [d, 3200]]);
      else { fp.setValueAtTime(1100, t); fp.linearRampToValueAtTime(2100 + 900 * vel, t + att + 0.2); }
    }
    const lfo = v.keep(mkGain(4));
    v.osc('sine', 4.7, t, end, lfo);
    for (const m of ns) {
      const f = mtof(m);
      const a = v.osc('sawtooth', f, t, end, fl, -9);
      const b = v.osc('sawtooth', f, t, end, fr, 9);
      lfo.connect(a.detune);
    }
  },

  // Brass stab chord: short, bright, punchy.
  stab(sp, t, e) {
    const d = e.d, vel = e.v, ns = e.ns;
    const v = new Voice(musicPool, sp.bus.brass, t, 1);
    const amp = v.gain(0);
    const end = adsr(amp.gain, t, d, 0.008, 0.14, 0.55, 0.12, 0.09 * vel * (3 / Math.max(3, ns.length)));
    const lpf = v.filter('lowpass', 1000, 1.2, amp);
    fenv(lpf.frequency, t, 700, 2600 + 2400 * vel, 1400, 0.02, 0.2);
    for (const m of ns) {
      const f = mtof(m);
      v.osc('sawtooth', f, t, end, lpf, -7);
      v.osc('sawtooth', f, t, end, lpf, 7);
    }
  },

  // Pluck / arpeggio.
  pluck(sp, t, e) {
    const f = mtof(e.n), vel = e.v;
    const v = new Voice(musicPool, sp.bus.arp, t, 1, e.pan || 0);
    const amp = v.gain(0);
    const end = perc(amp.gain, t, 0.1 * vel, 0.002, 0.2 + Math.min(0.2, e.d));
    const lpf = v.filter('lowpass', 3000, 3, amp);
    fenv(lpf.frequency, t, cap(f * 8), cap(f * 8), cap(f * 1.6 + 300), 0.001, 0.12);
    v.osc('square', f, t, end, lpf);
    v.osc('sawtooth', f * 2, t, end, v.gain(0.3, lpf), 5);
  },

  // FM bell (sparkle arps, results screen).
  bell(sp, t, e) {
    const f = mtof(e.n), vel = e.v;
    const v = new Voice(musicPool, sp.bus.arp, t, 1, e.pan || 0);
    const amp = v.gain(0);
    const end = perc(amp.gain, t, 0.1 * vel, 0.002, 1.1);
    const o = v.osc('sine', f, t, end, amp);
    const mg = v.gain(0, o.frequency);
    env(mg.gain, t, [[0, f * 1.6], [0.6, f * 0.1]]);
    v.osc('sine', f * 3.5, t, end, mg);
    v.osc('sine', f * 2, t, t + 0.4, v.gain(0.2, amp));
  },

  // Punchy bass: saw + sine sub, resonant filter envelope (bus adds drive).
  bass(sp, t, e) {
    const f = mtof(e.n), d = e.d, vel = e.v;
    const v = new Voice(musicPool, sp.bus.bass, t, 1);
    const amp = v.gain(0);
    const end = adsr(amp.gain, t, d, 0.004, 0.18, 0.72, 0.05, 0.2 * vel);
    const lpf = v.filter('lowpass', 400, 5, amp);
    fenv(lpf.frequency, t, cap(f * 2), cap(260 + f * 2 + 1700 * vel), cap(f * 2.2 + 140), 0.006, 0.16);
    v.osc('sawtooth', f, t, end, lpf);
    v.osc('square', f * 0.5, t, end, v.gain(0.25, lpf));
    v.osc('sine', f, t, end, v.gain(0.8, amp));
  },

  kick(sp, t, e) {
    const vel = e.v;
    const v = new Voice(musicPool, sp.bus.drums, t, 1);
    const amp = v.gain(0);
    const end = perc(amp.gain, t, 0.55 * vel, 0.001, 0.34);
    const o = v.osc('sine', 165, t, end, amp);
    env(o.frequency, t, [[0, 170], [0.03, 90], [0.14, 46]]);
    const knock = v.osc('triangle', 300, t, t + 0.03, v.gain(0.35, amp));
    knock.frequency.setValueAtTime(300, t);
    knock.frequency.exponentialRampToValueAtTime(90, t + 0.025);
    const ck = v.gain(0);
    perc(ck.gain, t, 0.22 * vel, 0.0005, 0.012);
    v.noise('white', t, t + 0.03, v.filter('bandpass', 3500, 0.9, ck));
  },

  snare(sp, t, e) {
    const vel = e.v;
    const v = new Voice(musicPool, sp.bus.drums, t, 1);
    v.send(sp.rev, 0.14);
    const nz = v.gain(0);
    const end = perc(nz.gain, t, 0.3 * vel, 0.001, 0.17);
    v.noise('white', t, end, v.filter('highpass', 900, 0.7, v.filter('peaking', 3200, 0.8, nz, 5)));
    const body = v.gain(0);
    perc(body.gain, t, 0.26 * vel, 0.001, 0.08);
    const o = v.osc('triangle', 195, t, t + 0.12, body);
    o.frequency.setValueAtTime(195, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.05);
    const b2 = v.gain(0);
    perc(b2.gain, t, 0.1 * vel, 0.001, 0.05);
    v.osc('sine', 330, t, t + 0.08, b2);
  },

  hat(sp, t, e) {
    const vel = e.v, open = !!e.open;
    const v = new Voice(musicPool, sp.bus.drums, t, 1, 0.22);
    const amp = v.gain(0);
    const end = perc(amp.gain, t, (open ? 0.1 : 0.085) * vel, 0.001, open ? 0.24 : 0.04);
    const hp = v.filter('highpass', 7000, 0.7, v.filter('peaking', 10500, 1, amp, 4));
    v.noise('metal', t, end, hp);
    v.noise('white', t, end, v.gain(0.35, hp));
  },

  crash(sp, t, e) {
    const vel = e.v;
    const v = new Voice(musicPool, sp.bus.drums, t, 1);
    v.send(sp.rev, 0.2);
    const amp = v.gain(0);
    const end = perc(amp.gain, t, 0.14 * vel, 0.002, 1.7);
    const hp = v.filter('highpass', 4200, 0.6, amp);
    v.noise('metal', t, end, hp, 0.9);
    v.noise('white', t, end, v.gain(0.7, v.filter('highpass', 6000, 0.6, amp)));
  },

  // Reverse-cymbal swell that lands on the next downbeat.
  swell(sp, t, e) {
    const d = e.d, vel = e.v;
    const v = new Voice(musicPool, sp.bus.drums, t, 1);
    v.send(sp.rev, 0.3);
    const amp = v.gain(0);
    env(amp.gain, t, [[0, EPS], [d, 0.14 * vel], [d + 0.03, EPS]]);
    const hp = v.filter('highpass', 2500, 0.7, amp);
    const lpf = v.filter('lowpass', 2000, 0.7, hp);
    env(lpf.frequency, t, [[0, 1500], [d, 14000]]);
    v.noise('white', t, t + d + 0.05, lpf);
    v.noise('metal', t, t + d + 0.05, v.gain(0.5, lpf));
  },

  tom(sp, t, e) {
    const vel = e.v, k = e.k || 2;
    const base = [0, 200, 150, 108, 80][k] || 150;
    const v = new Voice(musicPool, sp.bus.drums, t, 1, (k - 2) * 0.3);
    v.send(sp.rev, 0.12);
    const amp = v.gain(0);
    const end = perc(amp.gain, t, 0.38 * vel, 0.001, 0.36);
    const o = v.osc('sine', base, t, end, amp);
    env(o.frequency, t, [[0, base], [0.28, base * 0.62]]);
    const o2 = v.osc('triangle', base * 1.5, t, t + 0.1, v.gain(0.3, amp));
    env(o2.frequency, t, [[0, base * 1.5], [0.08, base]]);
    const ck = v.gain(0);
    perc(ck.gain, t, 0.1 * vel, 0.0005, 0.03);
    v.noise('white', t, t + 0.05, v.filter('lowpass', 3000, 0.7, ck));
  },

  // Orchestral timpani: inharmonic membrane partials + mallet thump.
  timp(sp, t, e) {
    const f = mtof(e.n), vel = e.v;
    const v = new Voice(musicPool, sp.bus.timp, t, 1);
    const amp = v.gain(1);
    let end = t;
    [[1, 0.22, 1.5], [1.5, 0.1, 1.0], [1.98, 0.05, 0.7], [2.44, 0.025, 0.45]].forEach(([r, a, d]) => {
      const g = v.gain(0, amp);
      end = Math.max(end, perc(g.gain, t, a * vel, 0.003, d));
      const o = v.osc('sine', f * r, t, t + d + 0.05, g);
      o.frequency.setValueAtTime(f * r * 1.025, t);
      o.frequency.exponentialRampToValueAtTime(f * r, t + 0.06);
    });
    const th = v.gain(0, amp);
    perc(th.gain, t, 0.13 * vel, 0.001, 0.06);
    v.noise('pink', t, t + 0.1, v.filter('lowpass', 900, 0.7, th));
  },
};

// -----------------------------------------------------------------------------
// 10. Music notation compiler
// -----------------------------------------------------------------------------
// Songs are written as compact text and compiled once into an array of
// 16th-note steps, each holding the events that start on it.
//
//  chords : one token per bar ("Em C D Em"); "G,A" splits a bar into halves,
//           four comma parts = one chord per beat; "%" repeats the previous chord.
//  melody : "E5:4 D5:2 r:2 F#5:4/3 ..." pitch+octave, ':' duration in 16ths
//           (sticky, fractions allowed for triplets). Suffix '~' glides from the
//           previous note, '>' accents, "'" plays staccato. 'r' is a rest.
//  pattern lists (bass/arp/stab/drums/timp): pattern names per bar, cycled;
//           '-' = nothing in that bar.
//  bass   : r/R root, o/O octave, 5 fifth, f fifth below, 3 third, 7 seventh,
//           b flat-2 (phrygian), p chromatic approach to the next chord, '-' tie
//  arp    : digits index into ascending chord tones, '-' tie, '.' rest
//  stab   : x/X chord stab, '-' extend
//  drums  : tracks k s h o c t(1-4) w(swell to bar end); X accent, x, o ghost
//  timp   : r/R root, 5 fifth, z = 32nd-note roll step (crescendos over a run)
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUAL = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6], aug: [0, 4, 8], add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14], 5: [0, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14], '7sus4': [0, 5, 7, 10], dim7: [0, 3, 6, 9], '7b9': [0, 4, 7, 10, 13],
};
const pcOf = (l, acc) => (PC[l] + (acc === '#' ? 1 : acc === 'b' ? 11 : 0)) % 12;

function parseChord(tok) {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(tok);
  if (!m || !QUAL[m[3]]) throw new Error('bad chord ' + tok);
  const root = pcOf(m[1], m[2]);
  const iv = QUAL[m[3]];
  const pcs = [];
  for (const i of iv) { const p = (root + i) % 12; if (!pcs.includes(p)) pcs.push(p); }
  return { root, iv, pcs, bass: m[4] ? pcOf(m[4], m[5]) : root };
}

function parseDur(s) {
  if (s.includes('/')) { const [a, b] = s.split('/'); return +a / +b; }
  return +s;
}

function parseMelody(str) {
  const notes = [];
  let pos = 0, dur = 4, prev = null;
  for (const tok of str.trim().split(/\s+/)) {
    if (!tok) continue;
    const m = /^([A-Gr])([#b]?)(\d?)(?::([\d./]+))?([~>']*)$/.exec(tok);
    if (!m) throw new Error('bad note ' + tok);
    if (m[4]) dur = parseDur(m[4]);
    if (m[1] !== 'r') {
      const n = 12 * (+m[3] + 1) + pcOf(m[1], m[2]);
      notes.push({ at: pos, n, d: dur, acc: m[5].includes('>'), stac: m[5].includes("'"), g: m[5].includes('~') ? prev : null });
      prev = n;
    } else prev = null;
    pos += dur;
  }
  return { notes, len: pos };
}

// Place pitch class pc nearest to `near`, clamped into [lo, hi].
function place(pc, near, lo, hi) {
  let best = null, bd = 1e9;
  for (let n = lo; n <= hi; n++) {
    if (n % 12 !== pc) continue;
    const d = Math.abs(n - near);
    if (d < bd) { bd = d; best = n; }
  }
  return best === null ? lo + ((pc - lo) % 12 + 12) % 12 : best;
}

// Voice-led chord voicing inside [lo, hi] (count = 3 or 4 notes).
function voiceChord(ch, prev, lo, hi, count) {
  const pcs = ch.pcs.slice(0, 4);
  let best = null, bs = 1e9;
  for (let k = 0; k < pcs.length; k++) {
    for (let base = lo; base < lo + 12; base++) {
      if (base % 12 !== pcs[k]) continue;
      const notes = [base];
      for (let j = 1; j < pcs.length; j++) {
        const pc = pcs[(k + j) % pcs.length];
        let n = notes[notes.length - 1] + 1;
        while (n % 12 !== pc) n++;
        notes.push(n);
      }
      while (notes.length < count) notes.push(notes[notes.length - pcs.length] + 12);
      notes.length = Math.min(notes.length, Math.max(count, 3));
      if (notes[notes.length - 1] > hi) continue;
      const center = notes.reduce((a, b) => a + b, 0) / notes.length;
      let score;
      if (prev) {
        const pc2 = prev.reduce((a, b) => a + b, 0) / prev.length;
        score = Math.abs(center - pc2) * 2;
        for (const n of notes) score += Math.min(...prev.map((p) => Math.abs(p - n))) * 0.5;
      } else score = Math.abs(center - (lo + hi) / 2);
      if (score < bs) { bs = score; best = notes; }
    }
  }
  return best || pcs.map((pc) => place(pc, (lo + hi) >> 1, lo, hi)).sort((a, b) => a - b);
}

function listFor(spec, bars) {
  if (!spec) return new Array(bars).fill('-');
  const toks = spec.trim().split(/\s+/);
  return Array.from({ length: bars }, (_, i) => toks[i % toks.length]);
}

function velOf(c) {
  return c === 'X' || c === 'R' || c === 'O' ? 1 : c === 'o' ? 0.45 : 0.8;
}

function compileSection(song, sec) {
  const bars = sec.bars, N = bars * 16;
  const steps = Array.from({ length: N }, () => []);
  const V = sec.vel || 1;
  const push = (at, ev) => {
    const s = Math.floor(at + 1e-6);
    if (s < 0 || s >= N) return;
    ev.off = Math.max(0, at - s);
    steps[s].push(ev);
  };

  // Chord timeline.
  const segs = [];
  let prevChord = null;
  listFor(sec.chords, bars).forEach((tok, b) => {
    const parts = tok.split(',');
    const len = 16 / parts.length;
    parts.forEach((p, i) => {
      const ch = p === '%' ? prevChord : parseChord(p);
      prevChord = ch;
      segs.push({ at: b * 16 + i * len, len, ch });
    });
  });
  const chordAt = (s) => { for (let i = segs.length - 1; i >= 0; i--) if (segs[i].at <= s) return segs[i]; return segs[0]; };
  const nextChordAfter = (s) => { for (const g of segs) if (g.at > s) return g.ch; return segs[0].ch; };

  // Pads and chord stabs (voice-led).
  let pv = null, sv = null;
  if (sec.pad) {
    for (const g of segs) {
      pv = voiceChord(g.ch, pv, sec.padLo || 55, sec.padHi || 79, 4);
      push(g.at, { i: 'pad', ns: pv, d: g.len, v: (sec.padVel || 0.9) * V, sw: sec.pad === 'swell' });
    }
  }
  const runLen = (pat, i) => { let d = 1; while (pat[i + d] === '-') d++; return d; };

  listFor(sec.stab, bars).forEach((name, b) => {
    const pat = STAB[name];
    if (!pat) return;
    for (let i = 0; i < 16; i++) {
      const c = pat[i];
      if (c !== 'x' && c !== 'X') continue;
      const s = b * 16 + i;
      sv = voiceChord(chordAt(s).ch, sv, 58, 77, 3);
      push(s, { i: 'stab', ns: sv, d: runLen(pat, i) * 0.8, v: velOf(c) * V });
    }
  });

  // Bass.
  let bprev = 40;
  listFor(sec.bass, bars).forEach((name, b) => {
    const pat = BASS[name];
    if (!pat) return;
    for (let i = 0; i < 16; i++) {
      const c = pat[i];
      if (c === '.' || c === '-' || c === undefined) continue;
      const s = b * 16 + i;
      const ch = chordAt(s).ch;
      const root = place(ch.bass, bprev, 31, 45);
      let n = root;
      if (c === 'o' || c === 'O') n = root + 12;
      else if (c === '5') n = root + 7;
      else if (c === 'f') n = root - 5;
      else if (c === '3') n = root + (ch.iv.includes(3) ? 3 : ch.iv.includes(4) ? 4 : 7);
      else if (c === '7') n = root + (ch.iv.includes(11) ? 11 : 10);
      else if (c === 'b') n = root + 1;
      else if (c === 'p') n = place(nextChordAfter(s).bass, root, 31, 45) - 1;
      if (c === 'r' || c === 'R') bprev = root;
      const d = runLen(pat, i);
      push(s, { i: 'bass', n, d: d * 0.92, v: velOf(c) * V });
    }
  });

  // Arpeggios.
  let arpIdx = 0;
  const arpLo = sec.arpLo || 64;
  listFor(sec.arp, bars).forEach((name, b) => {
    const pat = ARP[name];
    if (!pat) return;
    for (let i = 0; i < 16; i++) {
      const c = pat[i % pat.length];
      if (c < '0' || c > '9') continue;
      const s = b * 16 + i;
      const ch = chordAt(s).ch;
      const tones = [];
      for (let n = arpLo; tones.length < 10; n++) if (ch.pcs.includes(n % 12)) tones.push(n);
      const n = tones[+c];
      push(s, { i: sec.arpInst || 'pluck', n, d: runLen(pat, i % pat.length), v: (i % 4 === 0 ? 1 : 0.8) * (sec.arpVel || 1) * V, pan: (arpIdx++ % 2 ? 0.3 : -0.3) });
    }
  });

  // Drums.
  listFor(sec.drums, bars).forEach((name, b) => {
    const pat = DRUM[name];
    if (!pat) return;
    for (const tr in pat) {
      const str = pat[tr];
      for (let i = 0; i < 16; i++) {
        const c = str[i];
        if (!c || c === '.') continue;
        const s = b * 16 + i;
        const vel = velOf(c) * V;
        if (tr === 'k') push(s, { i: 'kick', v: vel });
        else if (tr === 's') push(s, { i: 'snare', v: vel });
        else if (tr === 'h') push(s, { i: 'hat', v: vel });
        else if (tr === 'o') push(s, { i: 'hat', v: vel, open: true });
        else if (tr === 'c') push(s, { i: 'crash', v: vel });
        else if (tr === 't') push(s, { i: 'tom', k: +c || 2, v: 0.85 * V });
        else if (tr === 'w') push(s, { i: 'swell', d: 16 - i, v: vel });
      }
    }
  });

  // Timpani.
  listFor(sec.timp, bars).forEach((name, b) => {
    const pat = TIMP[name];
    if (!pat) return;
    let run = 0;
    for (let i = 0; i < 16; i++) {
      const c = pat[i];
      const s = b * 16 + i;
      if (c === 'z') {
        let total = run; while (pat[i + total - run] === 'z') total++;
        const k = (run + 1) / Math.max(1, total);
        const root = place(chordAt(s).ch.root, 45, 38, 50);
        push(s, { i: 'timp', n: root, v: (0.25 + 0.6 * k) * V });
        push(s + 0.5, { i: 'timp', n: root, v: (0.22 + 0.6 * k) * V });
        run++;
        continue;
      }
      run = 0;
      if (!c || c === '.') continue;
      const ch = chordAt(s).ch;
      const root = place(ch.root, 45, 38, 50);
      push(s, { i: 'timp', n: c === '5' ? place((ch.root + 7) % 12, root + 5, 38, 55) : root, v: velOf(c) * V });
    }
  });

  // Lead melody (+ optional harmony) and counter-melody.
  const scale = song.scale;
  const addLine = (str, inst, velMul, harm, oct) => {
    const mel = parseMelody(str);
    for (const nt of mel.notes) {
      const gate = nt.stac ? 0.5 : 0.94;
      const pos = nt.at % 16;
      const metric = pos < 1e-6 ? 1 : pos % 4 < 1e-6 ? 0.9 : 0.84;   // natural phrasing
      const ev = { i: inst, n: nt.n + (oct || 0), d: nt.d * gate, v: (nt.acc ? 1 : metric) * velMul * V, g: nt.g !== null ? nt.g + (oct || 0) : null };
      push(nt.at, ev);
      if (harm) {
        // Chord tones and long notes: nearest chord tone 3..9 semitones below.
        // Short passing notes: parallel diatonic third (or a minor third).
        let h = nt.n - 3;
        const ch = chordAt(Math.floor(nt.at + 1e-6)).ch;
        const isChordTone = ch.pcs.includes(nt.n % 12);
        let found = false;
        if (harm === 'oct') { h = nt.n - 12; found = true; }
        else if (isChordTone || nt.d >= 3) {
          for (let k = 3; k <= 9; k++) if (ch.pcs.includes((nt.n - k + 120) % 12)) { h = nt.n - k; found = true; break; }
        }
        if (!found) {
          const idx = scale.indexOf(nt.n % 12);
          if (idx >= 0) { const pc = scale[(idx + scale.length - 2) % scale.length]; h = nt.n - 1; while (h % 12 !== pc) h--; }
        }
        push(nt.at, { i: inst, n: h + (oct || 0), d: ev.d, v: ev.v * 0.55, g: null });
      }
    }
  };
  if (sec.lead) addLine(sec.lead, sec.leadInst || 'lead', sec.leadVel || 1, sec.harm, sec.leadOct);
  if (sec.counter) addLine(sec.counter, sec.counterInst || 'soft', sec.counterVel || 0.7, null, 0);

  return { steps, bars, bpm: sec.bpm || song.bpm };
}

function compileSong(def) {
  const out = {};
  for (const k in def.sections) out[k] = compileSection(def, def.sections[k]);
  return out;
}

// -----------------------------------------------------------------------------
// 11. Song data — patterns and original compositions
// -----------------------------------------------------------------------------
const DRUM = {
  // stage 1 (driving rock)
  intro:  { k: 'X.......X.x.....', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
  introC: { c: 'X...............', k: 'X.......X.x.....', s: '....X.......X...', h: '..x.x.x.x.x.x.x.' },
  drive:  { k: 'X.......X.x.....', s: '....X.......X...', h: 'x.xox.x.x.xox.x.' },
  driveC: { c: 'X...............', k: 'X.......X.x.....', s: '....X.......X...', h: '..xox.x.x.xox.x.' },
  drive2: { k: 'X.....x.X.x...x.', s: '....X.......X..o', h: 'x.xox.xox.xox.x.' },
  hook:   { k: 'X...X...X...X...', s: '....X.......X...', h: 'x...x...x...x...', o: '..x...x...x...x.' },
  hookC:  { c: 'X...............', k: 'X...X...X...X...', s: '....X.......X...', o: '..x...x...x...x.' },
  fillA:  { k: 'X.......X.......', s: '....X...x.x.XxXX', h: 'x.x.x.x.........' },
  fillAw: { k: 'X.......X.......', s: '....X...x.x.XxXX', h: 'x.x.x.x.........', w: '....x...........' },
  fillT:  { k: 'X.......X.......', s: '....X...........', t: '........1122.3.4', h: 'x.x.x.x.........' },
  half:   { k: 'X.........x.....', s: '........X.......', h: 'x.x.x.x.x.x.x.x.' },
  halfC:  { c: 'X...............', k: 'X.........x.....', s: '........X.......', h: '..x.x.x.x.x.x.x.' },
  build:  { k: 'X...X...X...X...', s: 'o.o.o.o.xxxxXXXX', w: '........x.......' },
  // title (majestic march)
  tMarch:  { k: 'X.......X.......', s: '....x.......x..o', h: 'o.o.o.o.o.o.o.o.' },
  tMarchC: { c: 'X...............', k: 'X.......X.......', s: '....x.......x..o', h: '..o.o.o.o.o.o.o.' },
  tBig:    { k: 'X.....x.X.......', s: '....X.......X.xx', h: 'x.x.x.x.x.x.x.x.' },
  tBigC:   { c: 'X...............', k: 'X.....x.X.......', s: '....X.......X.xx', h: '..x.x.x.x.x.x.x.' },
  tFill:   { k: 'X.......X.......', s: '....X...........', t: '........1.2.3.44', h: 'o.o.o.o.........' },
  tSwell:  { w: 'x...............' },
  // boss (aggressive)
  bIntro: { c: 'X...............', k: 'X.......X.......', s: '............X.XX' },
  bBeat:  { k: 'X..X..X.X..X..X.', s: '....X.......X...', h: 'xoxoxoxoxoxoxoxo' },
  bBeatC: { c: 'X...............', k: 'X..X..X.X..X..X.', s: '....X.......X...', h: '..xoxoxoxoxoxoxo' },
  bFill:  { k: 'X..X..X.X.......', s: '....X...........', t: '........11223344', h: 'xoxoxoxo........' },
  bFill2: { k: 'X..X..X.X.......', s: '....X...XxXxXXXX', h: 'xoxoxoxo........' },
  // clear / results / game over
  fan1:   { c: 'X...............', k: 'X...............' },
  fanB:   { k: 'X.......X.......', s: '....x.......x...' },
  fanRoll:{ k: 'X.......X.......', s: 'o.o.o.o.xxxxXXXX' },
  res:    { k: 'x.......x.......', h: '..o...o...o...o.' },
  resB:   { k: 'x.........x.....', s: '....o.......o...', h: 'o.o.o.o.o.o.o.o.' },
};

const BASS = {
  drive8:  'R-r-r-r-R-r-o-r-',
  drive8b: 'R-r-r-o-r-r-5-p-',
  hook8:   'R-r-o-r-R-r-o-r-',
  pulse:   'R.r.r.r.R.r.r.r.',
  long:    'R---------------',
  half:    'R-------r-------',
  walk:    'R---r---5---o---',
  ost16:   'RrorrbrrRror5bro',
  ost16b:  'RrrrRrrrRrrrRrbr',
  res:     'R-------5-------',
};

const ARP = {
  arpA:  '0123012301230123',
  arpB:  '0123432101234321',
  arpC:  '2310231023102310',
  arp8:  '0.1.2.3.4.3.2.1.',
  bell4: '0...2...4...2...',
  bell8: '4.2.3.1.4.2.5.3.',
  ost:   '0102010201020102',
};

const STAB = {
  syncA: '......x-..x...x-',
  syncB: 'X-.x-.x-....X-..',
  push:  '..............X-',
  hits4: 'X-..X-..X-..X-..',
  boss1: 'X..X..X..X..X.X.',
  boss2: 'X-..............',
  fanf:  'X---------------',
};

const TIMP = {
  hit1:  'R...............',
  hit13: 'R.......r.......',
  roll:  'zzzzzzzzzzzzzzzz',
  roll2: '........zzzzzzzz',
  march: 'R...5...R...5...',
  boss:  'R.....r.R.....5.',
};

const SONGS = {
  // ---------------------------------------------------------------------------
  // TITLE — "Lancer's Oath". D major, 104 BPM. Swell(2) -> A(8) -> B(8), looped.
  title: {
    bpm: 104, scale: [2, 4, 6, 7, 9, 11, 1], intro: [], loop: ['S', 'A', 'B'],
    mix: { lead: 1.05, pad: 1.0, arp: 0.9, timp: 0.8 },
    sections: {
      S: {
        bars: 2, chords: 'Dsus2 Asus4,A', pad: 'swell', padVel: 1, bass: 'long',
        timp: 'roll2 roll', drums: '- tSwell', arp: 'bell4', arpInst: 'bell', arpLo: 74, arpVel: 0.8,
      },
      A: {
        bars: 8, chords: 'D A/C# Bm G,A D C G/B Asus4,A', pad: 'hold', padVel: 0.8,
        bass: 'walk', drums: 'tMarchC tMarch tMarch tFill tMarchC tMarch tMarch tFill',
        timp: 'hit13 hit1 hit1 roll2 hit13 hit1 hit1 roll2', arp: 'arp8', arpLo: 66, arpVel: 0.8, harm: 'dia3',
        lead:
          'A4:4/3 A4 A4 D5:6 E5:2 F#5:4 ' +
          'E5:6 D5:2 C#5:2 D5:2 E5:4 ' +
          'F#5:4/3 F#5 F#5 B5:6 A5:2 F#5:4 ' +
          'G5:6 F#5:2 E5:8 ' +
          'D5:4/3 D5 D5 A5:6 G5:2 F#5:4 ' +
          'G5:6 E5:2 C5:4 E5:4 ' +
          'D5:4 G5:4 B5:6 A5:2 ' +
          'A5:12 r:4',
      },
      B: {
        bars: 8, chords: 'G A F#m Bm Em7 A Bm,G Asus4,A', pad: 'hold', padVel: 1,
        bass: 'walk', drums: 'tBigC tBig tBig tBig tBigC tBig tBig tFill',
        timp: 'march march march march march march march roll', arp: 'arpB', arpLo: 66, arpVel: 0.55,
        stab: '- - - - - - - push', leadVel: 0.95,
        lead:
          'G5:6 F#5:2 D5:4 B4:4 ' +
          'C#5:6 D5:2 E5:8 ' +
          'F#5:6 E5:2 C#5:4 A4:4 ' +
          'B4:4 C#5:2 D5:2 F#5:8 ' +
          'G5:6 F#5:2 E5:4 B4:4 ' +
          'C#5:4 E5:4 A5:8 ' +
          'F#5:4 A5:4 G5:4 B5:4 ' +
          'A5:12 r:4',
      },
    },
  },

  // ---------------------------------------------------------------------------
  // STAGE 1 — "Skyline Run". E minor verse / G major hook, 150 BPM.
  // Intro(4, once) -> A(8) -> B(8) -> A2(8) -> B2(8) -> C(8) -> back to A.
  stage1: {
    bpm: 150, scale: [4, 6, 7, 9, 11, 0, 2], intro: ['I'], loop: ['A', 'B', 'A2', 'B2', 'C'],
    mix: { lead: 1.2, arp: 0.75, brass: 0.8, bass: 0.85 },
    sections: {
      I: { bars: 4, chords: 'Em Em C D', bass: 'drive8 drive8 drive8 drive8b', drums: 'introC intro intro fillAw' },
      A: {
        bars: 8, chords: 'Em C D Em Em C Am D', pad: 'hold', padVel: 0.55,
        bass: 'drive8 drive8 drive8 drive8b', drums: 'driveC drive drive drive2 drive drive drive fillA',
        stab: 'syncA', arp: 'arpA', arpVel: 0.75,
        lead:
          'E5:3 D5:1 E5:2 B4:2 r:4 G4:2 A4:2 ' +
          'C5:3 B4:1 G4:2 E4:6 r:4 ' +
          'D5:3 C5:1 D5:2 A4:2 r:4 F#4:2 A4:2 ' +
          'B4:6 G4:2 E4:8 ' +
          'E5:3 D5:1 E5:2 G5:2 r:4 B5:2 A5:2 ' +
          'G5:6 E5:2 C5:4 E5:4 ' +
          "A5:3 G5:1 E5:2 C5:2 r:2 A4:2 C5:2 E5:2 " +
          'D5:4 E5:2 F#5:2 A5:4 r:4',
      },
      B: {
        bars: 8, chords: 'G D/F# Em C G D7/F# C D', pad: 'hold', padVel: 0.9,
        bass: 'hook8', drums: 'hookC hook hook hook hookC hook hook fillT',
        stab: 'push', arp: 'arpB', arpVel: 0.8,
        lead:
          'D5:2 G5:2 A5:2 B5:6 A5:2 G5:2 ' +
          'A5:6 F#5:2 D5:8 ' +
          'E5:2 G5:2 A5:2 B5:6 A5:2 G5:2 ' +
          'E5:6 G5:2 C6:8 ' +
          'D6:2 B5:2 G5:2 D6:6 C6:2 B5:2 ' +
          'C6:6 A5:2 F#5:8 ' +
          'G5:2 A5:2 G5:2 E5:6 G5:4 ' +
          'A5:4 B5:2 A5:2 F#5:4 D5:4',
      },
      A2: null, // filled below (variation of A)
      B2: null, // filled below (variation of B)
      C: {
        bars: 8, chords: 'Am Em/G C D Am Em/G F B7', pad: 'hold', padVel: 1,
        bass: 'half half half half half half half pulse', drums: 'halfC half half half halfC half build build',
        arp: 'arp8', arpVel: 0.7, timp: 'hit1 - - - hit1 - - roll2', leadVel: 0.9,
        lead:
          'A4:4 C5:4 E5:8 ' +
          'D5:4 B4:4 G4:8 ' +
          'E5:4 G5:4 C6:6 B5:2 ' +
          'A5:12 F#5:4 ' +
          'E5:4 A5:4 C6:8 ' +
          'B5:4 G5:4 E5:8 ' +
          'F5:4 A5:4 C6:6 A5:2 ' +
          'B5:8 A5:4 F#5:2 D#5:2',
      },
    },
  },

  // ---------------------------------------------------------------------------
  // BOSS — "Leviathan Engine". A minor with phrygian Bb, 168 BPM.
  // Intro(2, once) -> A(8) -> B(8) -> A2(8) -> T(4 turnaround) -> back to A.
  boss: {
    bpm: 168, scale: [9, 11, 0, 2, 4, 5, 7], intro: ['I'], loop: ['A', 'B', 'A2', 'T'],
    mix: { lead: 1.15, bass: 0.9, brass: 0.9, pad: 0.8 },
    sections: {
      I: { bars: 2, chords: 'Am Bb,E', bass: 'ost16', drums: 'bIntro bFill2', stab: 'boss2 boss1', timp: 'hit1 roll2' },
      A: {
        bars: 8, chords: 'Am Am Bb Am Am Am F E7', pad: 'hold', padVel: 0.6,
        bass: 'ost16', drums: 'bBeatC bBeat bBeat bFill bBeatC bBeat bBeat bFill',
        stab: 'boss2', timp: 'boss - boss - boss - boss roll2',
        lead:
          'A4:6 C5:2 E5:8 ' +
          'F5:4 E5:4 D#5:2 E5:6 ' +
          'F5:6 D5:2 Bb4:8 ' +
          'A4:4 B4:2 C5:2 E5:8 ' +
          'A5:6 G5:2 E5:4 C5:4 ' +
          'D5:4 E5:2 F5:2 E5:8 ' +
          'F5:6 A5:2 C6:8 ' +
          'B5:4 G#5:4 E5:4 D5:4',
      },
      B: {
        bars: 8, chords: 'Dm Bb C Am Dm Bb E E7', pad: 'hold', padVel: 0.7,
        bass: 'ost16b', drums: 'bBeatC bBeat bBeat bFill bBeatC bBeat bBeat bFill2',
        stab: 'boss1', arp: 'ost', arpLo: 69, arpVel: 0.6,
        lead:
          'D5:2 F5:2 A5:4 A5:2 G5:2 F5:2 E5:2 ' +
          'F5:6 D5:2 Bb4:4 D5:4 ' +
          'E5:2 G5:2 C6:4 C6:2 B5:2 A5:2 G5:2 ' +
          'A5:12 E5:4 ' +
          'D5:2 F5:2 A5:4 A5:2 G5:2 F5:2 E5:2 ' +
          'F5:2 G5:2 Bb5:4 Bb5:2 A5:2 G5:2 F5:2 ' +
          'E5:4 G#5:4 B5:8 ' +
          'D6:4 C6:4 B5:4 G#5:4',
      },
      A2: null, // filled below
      T: {
        bars: 4, chords: 'F E F E7', pad: 'hold', padVel: 0.8, bass: 'ost16 ost16b ost16 ost16b',
        drums: 'bBeatC bBeat bBeat bFill', stab: 'boss1', timp: 'hit1 hit1 hit1 roll', leadVel: 1,
        lead: 'F5:16 E5:16 F5:8 G5:8 G#5:16',
      },
    },
  },

  // ---------------------------------------------------------------------------
  // CLEAR — victory fanfare (C major, 128 BPM, 4 bars ≈ 7.5 s) flowing into a
  // warm results loop (90 BPM, 16 bars ≈ 42.7 s).
  clear: {
    bpm: 128, scale: [0, 2, 4, 5, 7, 9, 11], intro: ['F'], loop: ['R1', 'R2'],
    mix: { lead: 1.0, pad: 1.0, arp: 0.8 },
    sections: {
      F: {
        bars: 4, chords: 'C F,G Ab,Bb C', pad: 'hold', padVel: 1, bass: 'half half half long',
        drums: 'fan1 fanB fanRoll fan1', timp: 'hit1 hit13 roll hit1', stab: '- - - fanf', harm: 'dia3',
        lead:
          'G4:4/3 G4 G4 C5:4 E5:4 G5:4 ' +
          'A5:6 F5:2 G5:6 D5:2 ' +
          'C6:6 Ab5:2 Bb5:6 D6:2 ' +
          'E6:14 r:2',
      },
      R1: {
        bars: 8, bpm: 90, chords: 'F G Em7 Am Dm7 G Cadd9 C', pad: 'hold', padVel: 0.8,
        bass: 'res', drums: 'res', arp: 'bell4', arpInst: 'bell', arpLo: 72, arpVel: 0.7,
        leadInst: 'soft', leadVel: 0.9,
        lead:
          'C5:4 F5:4 A5:6 G5:2 ' +
          'G5:8 D5:8 ' +
          'E5:4 G5:4 B5:6 A5:2 ' +
          'A5:12 E5:4 ' +
          'F5:4 A5:4 C6:6 B5:2 ' +
          'B5:6 A5:2 G5:8 ' +
          'D5:4 E5:4 G5:8 ' +
          'E5:12 r:4',
      },
      R2: {
        bars: 8, bpm: 90, chords: 'F G Em7 Am Dm7 G Cadd9 C', pad: 'hold', padVel: 0.85,
        bass: 'res', drums: 'resB', arp: 'bell8', arpInst: 'bell', arpLo: 72, arpVel: 0.6,
        counterInst: 'soft', counterVel: 0.75,
        counter:
          'A4:8 C5:8 B4:8 D5:8 G4:8 B4:8 C5:8 E5:8 ' +
          'F4:8 A4:8 B4:8 D5:8 E5:8 D5:8 C5:16',
      },
    },
  },

  // ---------------------------------------------------------------------------
  // GAME OVER — 2 bars at 96 BPM (5 s), A minor, sighing descent. No loop.
  gameover: {
    bpm: 96, scale: [9, 11, 0, 2, 4, 5, 7], intro: ['G'], loop: [],
    mix: { lead: 1.5, pad: 1.4, bass: 0.9, timp: 1.2 },
    sections: {
      G: {
        bars: 2, chords: 'Am,Dm E,Am', pad: 'hold', padVel: 0.9, bass: 'half', timp: 'hit1',
        leadInst: 'soft', leadVel: 0.95,
        lead: 'A5:6 E5:2 F5:6 D5:2 B4:6 G#4:2 A4:8',
      },
    },
  },
};

// Variations built from existing sections.
{
  const S1 = SONGS.stage1.sections;
  S1.A2 = Object.assign({}, S1.A, {
    stab: 'syncB', arp: 'arpC', drums: 'driveC drive2 drive2 drive2 drive drive2 drive2 fillT',
    counterInst: 'soft', counterVel: 0.5,
    counter: 'B5:16 C6:16 A5:16 B5:16 B5:16 C6:16 C6:16 A5:16',
  });
  S1.B2 = Object.assign({}, S1.B, {
    harm: 'dia3', stab: 'hits4 push hits4 push hits4 push hits4 push',
    drums: 'hookC hook hook hook hookC hook hook build', timp: '- - - - - - - roll2',
  });
  const SB = SONGS.boss.sections;
  SB.A2 = Object.assign({}, SB.A, { harm: 'dia3', stab: 'boss1', arp: 'arpB', arpLo: 69, arpVel: 0.55 });
}

// -----------------------------------------------------------------------------
// 12. Sequencer / song players
// -----------------------------------------------------------------------------
// Lookahead scheduling: a 25 ms timer schedules every 16th-note step that falls
// inside the next LOOKAHEAD seconds with sample-accurate AudioContext times.
// Steps that are already in the past are skipped (never played late in a
// burst); the grid position is preserved so the groove stays intact.
const LOOKAHEAD = 0.16;
const LOOKAHEAD_HIDDEN = 1.2;   // hidden tabs may throttle timers to ~1 Hz
const compiled = Object.create(null);
const players = new Set();
let current = null;
let pendingSong = null;
let duckEnd = 0;
let duckLevel = 1;

function getCompiled(name) {
  if (!compiled[name]) compiled[name] = compileSong(SONGS[name]);
  return compiled[name];
}

class SongPlayer {
  constructor(name, t0) {
    const def = SONGS[name];
    this.name = name;
    this.def = def;
    this.secs = getCompiled(name);
    this.order = def.intro.concat(def.loop);
    this.loopStart = def.intro.length;
    this.idx = 0;
    this.step = 0;
    this.next = t0;
    this.done = false;
    this.stopAt = Infinity;
    this.disposeAt = Infinity;
    this.nodes = [];

    const now = ctx.currentTime;
    this.out = this.g(0);
    this.rev = this.g(0);
    for (const g of [this.out, this.rev]) {
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(1, Math.max(now + 0.01, t0));
    }
    this.out.connect(G.musicIn);
    this.rev.connect(G.musicRev);

    // Tempo-synced stereo ping-pong delay (dotted eighth) for lead and arps.
    const dt = (60 / def.bpm) * 0.75;
    this.dIn = this.g(1);
    const hp = this.keep(mkFilter('highpass', 350, 0.7));
    const lp = this.keep(mkFilter('lowpass', 3400, 0.7));
    const dl = this.keep(ctx.createDelay(2));
    const dr = this.keep(ctx.createDelay(2));
    dl.delayTime.value = dt;
    dr.delayTime.value = dt;
    const fb = this.g(0.34);
    const merge = this.keep(ctx.createChannelMerger(2));
    const wet = this.g(0.5);
    chain(this.dIn, hp, lp, dl, dr, fb, dl);
    dl.connect(merge, 0, 0);
    dr.connect(merge, 0, 1);
    merge.connect(wet);
    wet.connect(this.out);

    const mix = Object.assign({ lead: 1, pad: 1, brass: 1, arp: 1, bass: 1, drums: 1, timp: 1 }, def.mix);
    const bus = (lvl, revAmt, dlyAmt) => {
      const b = this.g(lvl);
      b.connect(this.out);
      if (revAmt) { const s = this.g(revAmt); b.connect(s); s.connect(this.rev); }
      if (dlyAmt) { const s = this.g(dlyAmt); b.connect(s); s.connect(this.dIn); }
      return b;
    };
    this.bus = {
      lead: bus(mix.lead, 0.26, 0.34),
      pad: bus(mix.pad, 0.42, 0),
      brass: bus(mix.brass, 0.22, 0),
      arp: bus(mix.arp, 0.2, 0.3),
      drums: bus(mix.drums * 0.8, 0.05, 0),
      timp: bus(mix.timp, 0.3, 0),
      bass: this.g(mix.bass * 0.7),
    };
    const drive = this.keep(mkShaper(1.4));
    const bassLp = this.keep(mkFilter('lowpass', 3200, 0.7));
    chain(this.bus.bass, drive, bassLp, this.out);
  }
  keep(n) { this.nodes.push(n); return n; }
  g(v) { return this.keep(mkGain(v)); }

  advance() {
    const sec = this.secs[this.order[this.idx]];
    this.next += 60 / sec.bpm / 4;
    if (++this.step >= sec.steps.length) {
      this.step = 0;
      if (++this.idx >= this.order.length) {
        if (this.def.loop.length) this.idx = this.loopStart;
        else { this.done = true; this.disposeAt = Math.min(this.disposeAt, this.next + 5); }
      }
    }
  }

  schedule(until, now) {
    if (this.done || now >= this.stopAt) return;
    // Resync: skip steps that are already due or past (e.g. after a backgrounded
    // tab) instead of bursting them out late; the grid position is preserved.
    let guard = 0;
    while (!this.done && this.next < now + 0.005 && guard++ < 200000) this.advance();
    while (!this.done && this.next < until && this.next < this.stopAt) {
      const sec = this.secs[this.order[this.idx]];
      const sd = 60 / sec.bpm / 4;
      const t = this.next;
      for (const e of sec.steps[this.step]) this.play(e, t + e.off * sd, sd);
      this.advance();
    }
  }

  play(e, t, sd) {
    const fn = INST[e.i];
    if (!fn) return;
    const ev = Object.assign({}, e);
    if (e.d !== undefined) ev.d = Math.max(0.03, e.d * sd);
    if (e.i === 'hat' || e.i === 'pluck') ev.v *= 0.9 + Math.random() * 0.2;   // light humanization
    try { fn(this, t, ev); } catch (err) { /* never let one note break the song */ }
  }

  fadeOut(t, fade) {
    if (this.stopAt !== Infinity) return;
    const f = Math.max(0.03, fade);
    for (const g of [this.out, this.rev]) glide(g.gain, 0, f / 4.5, t);
    this.stopAt = t + f;
    this.disposeAt = Math.min(this.disposeAt, t + f + 3.5);
  }

  dispose() {
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    this.nodes.length = 0;
    this.done = true;
  }
}

function tick() {
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    if (ctx.state === 'running') {
      const hidden = typeof document !== 'undefined' && document.hidden;
      const until = now + (hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
      for (const p of players) p.schedule(until, now);
    }
    for (const p of players) {
      if (p === current && p.done) current = null;          // one-shot song finished
      if (now > p.disposeAt) { p.dispose(); players.delete(p); }
    }
    sfxPool.sweep(now);
    musicPool.sweep(now);
    for (const l of dyingLoops) if (now > l.stopAt + 0.6) l.dispose();
  } catch (e) { /* keep the timer alive */ }
}

function startSong(name, fade) {
  const now = ctx.currentTime;
  if (current) current.fadeOut(now, fade);
  current = new SongPlayer(name, now + 0.06);
  players.add(current);
  current.schedule(now + LOOKAHEAD, now);
}

// -----------------------------------------------------------------------------
// 13. Public API
// -----------------------------------------------------------------------------
function canPlay() {
  if (!ctx || failed) return false;
  if (ctx.state === 'running') return true;
  // Right after a resume() request (user gesture) the state flips shortly.
  return ctx.state !== 'closed' && nowMs() - resumeAskedAt < 1000;
}

function makeHandle(lp) {
  return {
    set(params) { try { lp.set(params); } catch (e) { /* ignore */ } },
    stop(fade) { try { lp.stop(fade === undefined ? 0.2 : fade); } catch (e) { /* ignore */ } },
  };
}

function createContext() {
  const AC = typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext);
  if (!AC) { failed = true; return; }
  try {
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    BUF = makeBuffers();
    G = buildGraph();
    sfxPool = new Pool(40);
    musicPool = new Pool(48);
    // iOS unlock: play one silent sample inside the gesture.
    try {
      const b = ctx.createBufferSource();
      b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      b.connect(ctx.destination);
      b.onended = () => { try { b.disconnect(); } catch (e) { /* ignore */ } };
      b.start(0);
    } catch (e) { /* ignore */ }
    if (isPaused) {
      for (const g of G.mPause) g.gain.value = 0.25;
      G.loopBus.gain.value = 0;
    }
    timer = setInterval(tick, 25);
    if (timer && typeof timer.unref === 'function') timer.unref();
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
          try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
        }
      });
    }
  } catch (e) {
    failed = true;
    try { if (ctx && ctx.close) ctx.close(); } catch (e2) { /* ignore */ }
    ctx = null;
    G = null;
  }
}

export const AudioSys = {
  init() {
    if (failed) return;
    try {
      const fresh = !ctx;
      if (fresh) createContext();
      if (!ctx) return;
      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        resumeAskedAt = nowMs();
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      if (fresh && pendingSong) {
        const ps = pendingSong;
        pendingSong = null;
        startSong(ps.name, 0);
      }
    } catch (e) { /* never throw from a gesture handler */ }
  },

  get ready() {
    return !!ctx && ctx.state === 'running';
  },

  setVolume(kind, v) {
    if (!Object.prototype.hasOwnProperty.call(VOL, kind)) return;
    VOL[kind] = clamp(num(v, VOL[kind]), 0, 1);
    if (!ctx) return;
    try {
      const t = ctx.currentTime, g = volGain(VOL[kind]);
      if (kind === 'master') glide(G.master.gain, g, 0.05, t);
      else for (const n of (kind === 'music' ? G.mVol : G.sVol)) glide(n.gain, g, 0.05, t);
    } catch (e) { /* ignore */ }
  },

  playMusic(name, opts) {
    if (!Object.prototype.hasOwnProperty.call(SONGS, name)) return;
    const fade = clamp(num(opts && opts.fade, 1), 0, 20);
    if (!ctx) { if (!failed) pendingSong = { name }; return; }
    try {
      if (current && current.name === name && !current.done && current.stopAt === Infinity) return;
      startSong(name, fade);
    } catch (e) { /* ignore */ }
  },

  stopMusic(fade) {
    pendingSong = null;
    if (!ctx || !current) return;
    try {
      current.fadeOut(ctx.currentTime, clamp(num(fade, 1), 0, 20));
      current = null;
    } catch (e) { /* ignore */ }
  },

  duckMusic(amount, seconds) {
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      let level = 1 - clamp(num(amount, 0.5), 0, 1);
      let end = now + clamp(num(seconds, 0.6), 0, 30);
      if (now < duckEnd) { level = Math.min(level, duckLevel); end = Math.max(end, duckEnd); }
      duckLevel = level;
      duckEnd = end;
      for (const g of G.mDuck) {
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(level, now, 0.03);
        g.gain.setTargetAtTime(1, end, 0.22);
      }
    } catch (e) { /* ignore */ }
  },

  sfx(name, opts) {
    const fn = SFX[name];
    if (!fn || !canPlay()) return;
    try {
      const meta = SFX_META[name] || {};
      const now = ctx.currentTime;
      if (now - (lastPlayed[name] === undefined ? -1 : lastPlayed[name]) < (meta.gap || 0.012)) return;
      lastPlayed[name] = now;
      const o = opts || {};
      const vol = clamp(num(o.vol, 1), 0, 4);
      if (vol <= 0) return;
      let pitch = clamp(num(o.pitch, 1), 0.1, 8);
      if (meta.jit) pitch *= jit(meta.jit);
      const v = new Voice(sfxPool, G.sfxIn, now + 0.006, vol * (meta.vol || 1), clamp(num(o.pan, 0), -1, 1));
      v.p = pitch;
      fn(v, o);
    } catch (e) { /* ignore */ }
  },

  loop(name, opts) {
    const def = LOOPS[name];
    if (!def || !ctx || failed) return NOOP_HANDLE;
    try {
      const lp = new LoopSound(name);
      def(lp);
      if (opts && typeof opts === 'object') lp.set(opts);
      return makeHandle(lp);
    } catch (e) {
      return NOOP_HANDLE;
    }
  },

  voiceBlip(voice, ch) {
    if (!canPlay()) return;
    try { babble(voice, ch); } catch (e) { /* ignore */ }
  },

  setPaused(p) {
    isPaused = !!p;
    if (!ctx) return;
    try {
      const t = ctx.currentTime;
      for (const g of G.mPause) glide(g.gain, isPaused ? 0.25 : 1, 0.08, t);
      glide(G.loopBus.gain, isPaused ? 0 : 1, isPaused ? 0.025 : 0.08, t);
    } catch (e) { /* ignore */ }
  },
};

// Test/debug hooks (not used by the game).
export const __audioInternals = {
  SONGS, SFX, LOOPS, compileSong, parseMelody, parseChord, tick,
  get ctx() { return ctx; },
  get graph() { return G; },
  get current() { return current; },
  get players() { return players; },
  get pools() { return { sfx: sfxPool, music: musicPool }; },
  get loops() { return { active: activeLoops, dying: dyingLoops }; },
};
