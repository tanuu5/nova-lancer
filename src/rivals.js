// Rival squadron: the Kamaitachi mercenaries. Three named fighters with their own moves, flown in rail space
// (rel = distance ahead of the leader, u, v) like everything else:
//   TSUMUJI  holds ahead, sprays shots and throws whirlwind rings (shockwaves) — fly through the eye or around them
//   KIRI     drops behind the camera, lines up on the player and dashes through with her blade wings
//   HARI     keeps out of the fight and repairs a damaged sibling with a beam; hitting Hari breaks it off
// Mission 02 fights them as a mid-boss (they withdraw when beaten or when the stretch of course runs out).
import * as THREE from 'three';
import { G, rand, clamp, lerp, damp, TAU, diff, after } from './core.js';
import { railFrame, railToWorld, emissiveVertexMaterial, mergeGeometries } from './world.js';
import { FX, Trail, explode, glow, beam, sparks, addShake } from './fx.js';
import { TARGETS, enemyShot, aimAtPlayer } from './weapons.js';
import { AudioSys } from './audio.js';
import { loft, slab, fin, mirrorX } from './ship.js';
import { paint, diamond } from './enemies.js';
import { addMarker } from './hud.js';

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const YUP = new THREE.Vector3(0, 1, 0);
const sym = (g, hex, em = 0) => [paint(g, hex, em), paint(mirrorX(g), hex, em)];

// ============================================================ Models (nose toward -Z, like the player's ship)
const COL = {
  tsumuji: { hull: '#d3d9c8', main: '#2faa5c', dark: '#1c2621', glow: '#8affb4', trail: [0.5, 2.2, 1.0] },
  kiri:    { hull: '#2b2633', main: '#d33550', dark: '#121016', glow: '#ff6a8a', trail: [2.6, 0.5, 0.8], blade: '#e9ecf2' },
  hari:    { hull: '#e6d9b8', main: '#e2ae22', dark: '#3a3124', glow: '#ffe07a', trail: [2.2, 1.8, 0.6] },
};
// The sickle wing (kama): swept forward to a hooked tip.
const SICKLE = [[0.5, 0.4], [2.4, 1.0], [4.3, 2.3], [5.4, 3.9], [4.8, 2.0], [3.1, -0.3], [1.4, -1.5], [0.5, -1.6]];

function modelKama(id) {
  const C = COL[id];
  const body = loft([
    { z: -5.4, pts: diamond(0.05, 0.05) }, { z: -3.4, pts: diamond(0.5, 0.42) }, { z: -0.6, pts: diamond(0.82, 0.6) },
    { z: 2.4, pts: diamond(0.66, 0.5) }, { z: 3.7, pts: diamond(0.34, 0.28) },
  ]);
  const parts = [paint(body, C.hull)];
  parts.push(paint(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2).scale(0.42, 0.42, 1.25).translate(0, 0.32, -1.9), '#0d1622'));
  parts.push(...sym(slab(SICKLE, 0.13), C.main));
  parts.push(...sym(slab([[0.5, 0.2], [2.6, 0.75], [2.5, 0.4], [0.5, -0.2]], 0.15).translate(0, 0.06, 0), C.dark));
  const tf = fin([[0, 0], [1.5, 0], [1.9, 1.3], [1.3, 1.35]], 0.1);
  parts.push(...sym(tf.clone().applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.45)).translate(0.45, 0.35, 1.9), C.main));
  for (const sx of [-1, 1]) parts.push(paint(new THREE.CircleGeometry(0.26, 10).translate(0.42 * sx, 0, 3.72), C.glow, 1));
  if (id === 'tsumuji') {
    // wind fans on the wingtips (the whirlwind)
    for (const sx of [-1, 1]) {
      parts.push(paint(new THREE.TorusGeometry(0.9, 0.12, 4, 14).rotateY(Math.PI / 2).translate(5.3 * sx, 0, -3.5), C.glow, 1));
      parts.push(paint(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 6).rotateZ(Math.PI / 2).translate(5.3 * sx, 0, -3.5), C.dark));
    }
  } else if (id === 'kiri') {
    // bright blade edges along the wings' leading edges
    parts.push(...sym(slab([[0.6, 0.62], [2.4, 1.22], [4.3, 2.52], [5.55, 4.25], [4.35, 2.2], [2.4, 0.95], [0.6, 0.42]], 0.06).translate(0, 0.02, 0), C.blade, 0.35));
    parts.push(paint(new THREE.BoxGeometry(0.08, 0.5, 2.6).translate(0, 0.45, 0.6), C.main));
  }
  return mergeGeometries(parts);
}

// Hari flies a stubby workshop of a plane: round body, short wings, a crane arm and a repair emitter under the nose.
function modelHari() {
  const C = COL.hari;
  const body = loft([
    { z: -3.6, pts: diamond(0.1, 0.1) }, { z: -2.4, pts: diamond(0.9, 0.75) }, { z: 0.2, pts: diamond(1.25, 1.0) },
    { z: 2.3, pts: diamond(0.9, 0.7) }, { z: 3.0, pts: diamond(0.45, 0.35) },
  ]);
  const parts = [paint(body, C.hull)];
  parts.push(paint(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2).scale(0.6, 0.55, 1.1).translate(0, 0.62, -1.2), '#0d1622'));
  parts.push(...sym(slab([[0.9, 0.6], [3.2, 0.1], [3.4, -0.9], [0.9, -1.4]], 0.16), C.main));
  parts.push(...sym(new THREE.BoxGeometry(0.6, 0.6, 1.6).translate(3.3, -0.1, -0.4), C.dark));
  parts.push(...sym(fin([[0, 0], [1.2, 0], [1.4, 1.0], [0.9, 1.0]], 0.1).applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.3)).translate(0.6, 0.5, 1.6), C.main));
  parts.push(paint(new THREE.BoxGeometry(0.25, 0.25, 1.8).rotateX(0.5).translate(0, -1.0, -2.4), C.dark));
  parts.push(paint(new THREE.BoxGeometry(0.7, 0.18, 0.3).translate(0, -1.45, -3.3), '#8a8f99'));
  parts.push(paint(new THREE.OctahedronGeometry(0.42, 0).translate(0, -0.85, -3.55), '#7ffff0', 1));
  for (const sx of [-1, 1]) parts.push(paint(new THREE.CircleGeometry(0.3, 10).translate(0.5 * sx, 0, 3.02), C.glow, 1));
  return mergeGeometries(parts);
}

// ============================================================ Whirlwind ring (Tsumuji's shockwave)
let ringMat = null;
function ringMaterial() {
  if (ringMat) return ringMat;
  ringMat = new THREE.ShaderMaterial({
    uniforms: { uR: { value: 10 }, uSize: { value: 30 }, uA: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uR; uniform float uSize; uniform float uA; uniform float uTime; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0 * uSize;
        float d = length(p), a = atan(p.y, p.x);
        float band = exp(-pow((d - uR) / 2.6, 2.0));
        float swirl = 0.55 + 0.45 * sin(a * 9.0 - uTime * 14.0 + d * 0.4);
        float inner = exp(-pow((d - uR + 3.2) / 1.2, 2.0)) * 0.35;
        vec3 c = vec3(0.55, 1.0, 0.72) * band * (0.6 + 0.6 * swirl) + vec3(0.8, 1.0, 0.9) * inner;
        gl_FragColor = vec4(c * uA, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  return ringMat;
}

const waves = [];
const RING_SPEED = 95;    // closing speed relative to the leader (m/s)
function launchWave(from) {
  const P = G.player;
  const rA = 18;
  // put the player's current position on the ring when it arrives: centre rA away, as far inside the play area as possible
  let best = null, bs = -1e9;
  for (let i = 0; i < 8; i++) {
    const th = rand(0, TAU), cu = P.u - Math.cos(th) * rA, cv = P.v - Math.sin(th) * rA;
    const score = -Math.max(0, Math.abs(cu) - 34) - Math.max(0, Math.abs(cv - 30) - 20);
    if (score > bs) { bs = score; best = [cu, cv]; }
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMaterial().clone());
  mesh.renderOrder = 20; mesh.frustumCulled = false;
  G.scene.add(mesh);
  const rel0 = Math.max(30, from.rel);
  waves.push({ s: G.rail.d + rel0, rel0, u0: from.u, v0: from.v, cu: best[0], cv: best[1], rA, prev: rel0, mesh, t: 0, done: false });
  AudioSys.sfx('boost', { pitch: 0.6, vol: 0.8 });
  AudioSys.sfx('roll', { pitch: 0.5, vol: 0.7 });
}

function updateWaves(dt) {
  const P = G.player;
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i];
    w.t += dt;
    w.s += (G.rail.speed - RING_SPEED) * dt;
    const rel = w.s - G.rail.d, k = clamp(rel / w.rel0, 0, 1);
    const r = lerp(w.rA, 4, k), u = lerp(w.cu, w.u0, k), v = lerp(w.cv, w.v0, k);
    if (!w.done && w.prev > 0 && rel <= 0 && P.alive) {
      w.done = true;
      const d = Math.hypot(P.u - u, P.v - v);
      if (Math.abs(d - r) < 5.2) {
        if (P.rolling) { P.deflectFx(); }
        else if (P.damage(10)) {
          const out = d > r ? 1 : -1, nu = (P.u - u) / (d || 1), nv = (P.v - v) / (d || 1);
          P.vu += nu * 48 * out; P.vv += nv * 32 * out; P.bank += (Math.random() < 0.5 ? -1 : 1) * 1.4;
          addShake(0.5);
          AudioSys.sfx('crash', { pitch: 0.7 });
          RIVALS.onEvent?.('waveHit');
        }
      }
    }
    w.prev = rel;
    railFrame(w.s, _p, _f, _r);
    railToWorld(w.s, u, v, w.mesh.position);
    w.mesh.rotation.set(0, Math.atan2(-_f.x, -_f.z), 0);
    w.mesh.scale.setScalar((r + 5) * 2);
    const U = w.mesh.material.uniforms;
    // fades in as it leaves Tsumuji and is gone a few metres past the player (well before it reaches the camera)
    U.uR.value = r; U.uSize.value = r + 5; U.uTime.value = w.t; U.uA.value = clamp(w.t * 4, 0, 1) * clamp((rel + 4) / 10, 0, 1);
    if (rel < -30) { G.scene.remove(w.mesh); w.mesh.material.dispose(); w.mesh.geometry.dispose(); waves.splice(i, 1); }
  }
}

// ============================================================ Rival fighter
const DEF = {
  tsumuji: { hp: 30, scale: 1.7, name: 'TSUMUJI' },
  kiri:    { hp: 26, scale: 1.7, name: 'KIRI' },
  hari:    { hp: 12, scale: 1.55, name: 'HARI' },
};
const PASS_LO = -44, PASS_HI = 24;   // band around the chase camera that fighters swing wide of (like the wingmen)

class Rival {
  constructor(id) {
    this.id = id;
    this.def = DEF[id];
    this.mat = emissiveVertexMaterial({ roughness: 0.42, metalness: 0.5 }, 3.2);
    this.root = new THREE.Group();
    this.mesh = new THREE.Mesh(id === 'hari' ? modelHari() : modelKama(id), this.mat);
    this.mesh.scale.setScalar(this.def.scale);
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    this.pos = new THREE.Vector3(); this.prev = new THREE.Vector3();
    const tc = COL[id].trail;
    this.trails = [new Trail(18, 0.2, tc, 0.55, true), new Trail(18, 0.2, tc, 0.55, true)];
    for (const t of this.trails) t.visible = false;
    this.tips = id === 'hari' ? [new THREE.Vector3(-3.4, 0, -0.4), new THREE.Vector3(3.4, 0, -0.4)] : [new THREE.Vector3(-5.4, 0, -3.9), new THREE.Vector3(5.4, 0, -3.9)];
    const self = this;
    this.target = { pos: this.pos, radius: 6.5, alive: false, lockable: true, hittable: true, hit: (dmg, p, src) => self.hit(dmg, p, src) };
    this.active = false;
  }

  spawn(rel, u, v, delay) {
    this.active = true; this.state = 'wait'; this.st = -delay;
    this.rel = rel; this.u = u; this.v = v; this.vr = 0; this.vu = 0; this.vv = 0;
    this.hp = this.maxHp = this.def.hp; this.flash = 0; this.bank = 0; this.yaw = 0; this.pitch = 0;
    this.fireT = rand(1.5, 2.5); this.waveT = 5; this.gone = false; this.dashHit = false; this.healing = false;
    this.root.visible = false;
    G.scene.add(this.root);
    for (const t of this.trails) { t.visible = false; t.started = false; }
    this.target.alive = true;
    TARGETS.add(this.target);
    this.place();
  }
  get s() { return G.rail.d + this.rel; }
  get alive() { return this.active && this.state !== 'down' && this.state !== 'retreat' && this.state !== 'wait'; }
  set(state) { this.state = state; this.st = 0; }

  hit(dmg, p, src) {
    if (!this.alive || this.rel < 12 || !RIVALS.engaged) return 'none';   // out of reach while they talk on the way in
    this.hp -= dmg * (src === 'bomb' ? 0.5 : 1);
    this.flash = 1;
    if (this.id === 'hari' && this.state === 'repair') { this.set('flinch'); RIVALS.onEvent?.('flinch', this); }
    if (this.hp <= 0) { this.goDown(); return 'kill'; }
    return 'hit';
  }
  goDown() {
    this.hp = 0;
    this.target.alive = false;
    this.set('down');
    explode(this.pos, 1.3, { debris: 4 });
    AudioSys.sfx('explodeM');
    addShake(0.3);
    if (this.marker) this.marker.active = false;
    RIVALS.onEvent?.('down', this);
  }
  retreat() { if (this.alive) { this.target.alive = false; this.set('retreat'); if (this.marker) this.marker.active = false; } }
  remove() {
    this.active = false; this.target.alive = false;
    TARGETS.delete(this.target);
    G.scene.remove(this.root);
    for (const t of this.trails) t.visible = false;
    if (this.marker) this.marker.active = false;
  }

  // ---------------------------------------------------------------- behaviour (goal in rail space)
  update(dt) {
    this.st += dt;
    const P = G.player, T = G.time, sq = RIVALS;
    let gr = this.rel, gu = this.u, gv = this.v, k = 1.6;
    switch (this.state) {
      case 'wait':
        if (this.st >= 0) { this.set('enter'); this.root.visible = true; for (const t of this.trails) t.visible = true; }
        break;
      case 'enter':
        gr = this.id === 'hari' ? 150 : 95; gu = this.u * 0.6; gv = 36; k = 1.3;
        if (this.rel > 60) this.set(this.id === 'hari' ? 'support' : 'front');
        break;
      case 'front':
        gr = (this.id === 'kiri' ? 66 : 82) + Math.sin(T * 0.5 + this.u) * 12 + (sq.engaged ? 0 : 40);
        gu = P.u * 0.4 + Math.sin(T * (this.id === 'kiri' ? 0.9 : 0.6)) * 28;
        gv = 30 + Math.sin(T * 0.8 + 1) * 12;
        if (!sq.engaged) break;
        this.shoot(dt);
        if (this.id === 'tsumuji') this.whirl(dt);
        if (this.id === 'kiri' && this.st > 3.4) { this.set('drop'); this.dashHit = false; }
        break;
      case 'charge':   // Tsumuji winding up a whirlwind
        gr = 92; gu = this.u; gv = this.v; k = 2;
        glow(this.pos, 6 + this.st * 12, 0.6, 2.4, 1.1, 0.9);
        if (Math.random() < 0.7) sparks(this.pos, null, 2, [1, 4, 2], 22, 1);
        if (this.st > 1.0) { launchWave(this); this.set('front'); this.waveT = rand(6.5, 8) / diff().fire; if (!sq.saidWave) { sq.saidWave = true; sq.onEvent?.('wave', this); } }
        break;
      case 'drop':     // Kiri falls back past the camera
        gr = -58; gu = Math.sign(this.u || 1) * 40; gv = 44; k = 2.2;
        if (!this.marker || !this.marker.active) this.marker = addMarker(this.pos, 'KIRI', '#ff6a8a');
        if (this.rel < -40) { this.set('aim'); AudioSys.sfx('warning', { vol: 0.6 }); if (!sq.saidDash) { sq.saidDash = true; sq.onEvent?.('dash', this); } }
        break;
      case 'aim':      // lining up behind the player
        gr = -58; gu = P.u + Math.sin(T * 3) * 2; gv = P.v; k = 3;
        if (this.st > 1.05) { this.set('dash'); this.du = P.u; this.dv = P.v; AudioSys.sfx('boost', { pitch: 1.3 }); }
        break;
      case 'dash':     // straight through the player's line at blade speed
        this.vr = 240; gr = this.rel; gu = this.du; gv = this.dv;
        if (this.rel > 150) { this.set('front'); if (this.marker) this.marker.active = false; }
        break;
      case 'support':  // Hari keeps out of the way…
        gr = 125 + Math.sin(T * 0.4) * 10; gu = -Math.sign(P.u || 1) * 30 + Math.sin(T * 0.7) * 8; gv = 46 + Math.sin(T * 0.9) * 4;
        if (this.st > 1.5 && sq.engaged) { const m = this.patient(); if (m) { this.ward = m; this.set('repair'); } }
        break;
      case 'repair': { // …until a sibling needs fixing
        const m = this.ward;
        if (!m || !m.alive || m.hp >= m.maxHp * 0.97) { this.healing = false; this.set('support'); break; }
        gr = m.rel + 16; gu = m.u + (m.u > 0 ? -7 : 7); gv = m.v + 5; k = 2.2;
        this.healing = this.pos.distanceTo(m.pos) < 20;
        if (this.healing) {
          m.hp = Math.min(m.maxHp, m.hp + 5.5 * dt);
          _v.copy(this.pos).add(_v2.set(0, -1.2, 0));
          beam(_v, m.pos, 0.7 + Math.sin(T * 30) * 0.1, 0.5, 3.2, 2.4);
          glow(m.pos, 7 + Math.sin(T * 12) * 1.5, 0.5, 2.6, 1.8, 0.8);
          if (Math.random() < dt * 20) sparks(m.pos, null, 2, [1, 4, 3], 14, 1);
          if (!sq.saidRepair) { sq.saidRepair = true; sq.onEvent?.('repair', this); }
        }
        break;
      }
      case 'flinch':
        gr = 175; gu = -Math.sign(P.u || 1) * 40; gv = 52; k = 2.4; this.healing = false;
        if (this.st > 1.8) this.set('support');
        break;
      case 'down':
        gr = this.rel - 30; gu = this.u * 1.2; gv = this.v + 25; k = 1;
        this.bank += dt * 7;
        if (Math.random() < dt * 40) FX.smoke.spawn(this.pos.x, this.pos.y, this.pos.z, rand(-1, 1), rand(1, 3), rand(2, 6), 1.3, 1.2, 4.5, [0.13, 0.12, 0.13, 0.7], [0.3, 0.3, 0.32, 0], 1, { fadeIn: 0.05 });
        if (Math.random() < dt * 8) sparks(this.pos, null, 4, [6, 3.5, 1.4], 22, 1);
        if (this.st > 3.2) this.remove();
        break;
      case 'retreat':
        gr = 520; gu = this.u * 1.5; gv = 110; k = 1.2;
        if (this.st > 3.6) this.remove();
        break;
    }
    if (!this.active) return;
    if (this.state !== 'wait') this.move(dt, gr, gu, gv, k);
    this.place();
    this.orient(dt);
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mat.userData.flash.value = this.flash * 2;
    this.collide(dt);
    for (let i = 0; i < 2; i++) {
      _v.copy(this.tips[i]).multiplyScalar(this.def.scale).applyQuaternion(this.root.quaternion).add(this.pos);
      this.trails[i].push(_v);
      this.trails[i].intensity = this.state === 'dash' ? 1 : clamp(Math.abs(this.vu) / 50 + 0.25, 0, 0.8);
    }
    _v.set(0, 0, 3.9 * this.def.scale).applyQuaternion(this.root.quaternion).add(this.pos);
    const c = COL[this.id].trail;
    glow(_v, 1.6, c[0], c[1], c[2], 0.8);
  }

  // a damaged, fighting sibling (Hari's patient)
  patient() {
    let best = null;
    for (const m of RIVALS.list) if (m !== this && m.alive && m.hp < m.maxHp * 0.72 && (!best || m.hp / m.maxHp < best.hp / best.maxHp)) best = m;
    return best;
  }

  move(dt, gr, gu, gv, k) {
    // swing wide of the camera and the leader while crossing the band around them
    if (this.state !== 'dash' && Math.min(this.rel, gr) < PASS_HI && Math.max(this.rel, gr) > PASS_LO) { gu = (this.u >= 0 ? 1 : -1) * 42; gv = Math.max(gv, 44); }
    if (this.state === 'dash') { this.rel += this.vr * dt; this.u = damp(this.u, gu, 10, dt); this.v = damp(this.v, gv, 10, dt); return; }
    const tvr = clamp((gr - this.rel) * k, -90, 140), tvu = clamp((gu - this.u) * k, -60, 60), tvv = clamp((gv - this.v) * k, -45, 45);
    this.vr = damp(this.vr, tvr, 3, dt); this.vu = damp(this.vu, tvu, 3, dt); this.vv = damp(this.vv, tvv, 3, dt);
    this.rel += this.vr * dt; this.u += this.vu * dt; this.v += this.vv * dt;
    if (this.v < 4) { this.v = 4; this.vv = Math.max(this.vv, 0); }
  }

  place() { this.prev.copy(this.pos); railToWorld(G.rail.d + this.rel, this.u, this.v, this.pos); this.root.position.copy(this.pos); }

  orient(dt) {
    this.yaw = damp(this.yaw, -this.vu / 60 * 0.4, 5, dt);
    this.pitch = damp(this.pitch, this.vv / 45 * 0.3, 5, dt);
    if (this.state !== 'down') this.bank = damp(this.bank, -this.vu / 60 * 1.0, 5, dt);
    railFrame(G.rail.d + this.rel, _p, _f, _r);
    _m.makeBasis(_r, YUP, _v.copy(_f).negate());
    _q.setFromRotationMatrix(_m);
    _q2.setFromEuler(_e.set(this.pitch, this.yaw, this.bank, 'YXZ'));
    this.root.quaternion.copy(_q).multiply(_q2);
  }

  shoot(dt) {
    const P = G.player;
    this.fireT -= dt;
    if (this.fireT > 0 || this.rel < 40 || !P.alive) return;
    this.fireT = (this.id === 'kiri' ? rand(1.5, 2.0) : rand(2.0, 2.8)) / diff().fire;
    if (this.id === 'kiri') {
      for (let i = 0; i < 3; i++) after(i * 0.12, () => { if (this.alive && G.player.alive) enemyShot(this.pos, aimAtPlayer(this.pos, 230, 0.025), 'laser'); });
    } else {
      const base = aimAtPlayer(this.pos, 150, 0);
      for (const a of [-0.12, 0, 0.12]) enemyShot(this.pos, base.clone().applyAxisAngle(YUP, a), 'orb');
    }
    AudioSys.sfx('enemyShot', { vol: 0.6 });
  }

  whirl(dt) {
    this.waveT -= dt;
    if (this.waveT <= 0 && this.rel > 60) { this.set('charge'); AudioSys.sfx('chargeReady', { pitch: 0.7 }); }
  }

  collide() {
    const P = G.player;
    if (!P.alive || this.state === 'wait' || this.state === 'down' || this.state === 'retreat') return;
    if (this.state === 'dash') {
      // distance from the player to this frame's stretch of the dash
      _v.subVectors(this.pos, this.prev);
      const l2 = _v.lengthSq();
      const t = l2 > 0 ? clamp(_v2.subVectors(P.pos, this.prev).dot(_v) / l2, 0, 1) : 0;
      _v2.copy(this.prev).addScaledVector(_v, t);
      if (!this.dashHit && _v2.distanceTo(P.pos) < 6.2) {
        this.dashHit = true;
        if (P.rolling) P.deflectFx();
        else if (P.damage(14)) { P.vu += (P.u > this.u ? 1 : -1) * 30; RIVALS.onEvent?.('cut', this); }
      }
      return;
    }
    if (this.rel > -10 && this.pos.distanceTo(P.pos) < 6.4 && P.damage(12)) P.vu += (P.u > this.u ? 1 : -1) * 30;
  }
}

// ============================================================ Squad
export const RIVALS = { list: [], on: false, onEvent: null };
let built = false;
function build() { if (built) return; built = true; for (const id of ['tsumuji', 'kiri', 'hari']) RIVALS.list.push(new Rival(id)); }

// Bring the three in from behind the camera, a beat apart; they hold fire until engageRivals(). onEvent(type, rival)
// receives 'wave', 'dash', 'repair', 'flinch', 'down', 'waveHit', 'cut' (for the stage's radio lines and scoring).
export function startRivals(onEvent) {
  build();
  RIVALS.on = true; RIVALS.engaged = false; RIVALS.onEvent = onEvent; RIVALS.saidWave = RIVALS.saidDash = RIVALS.saidRepair = false;
  const [t, k, h] = RIVALS.list;
  t.spawn(-70, 26, 40, 0);
  k.spawn(-75, -30, 46, 0.5);
  h.spawn(-80, 4, 54, 1.1);
}
export function updateRivals(dt) {
  if (!RIVALS.on) return;
  for (const r of RIVALS.list) if (r.active) r.update(dt);
  updateWaves(dt);
}
export function engageRivals() { RIVALS.engaged = true; for (const r of RIVALS.list) { r.fireT = rand(0.6, 1.4); r.waveT = 2.5; r.st = 0; } }
export function retreatRivals() { for (const r of RIVALS.list) r.retreat(); }
export function clearRivals() {
  for (const r of RIVALS.list) if (r.active) r.remove();
  for (const w of waves) { G.scene.remove(w.mesh); w.mesh.material.dispose(); w.mesh.geometry.dispose(); }
  waves.length = 0;
  RIVALS.on = false;
}
export const rivalUp = (id) => RIVALS.list.find(r => r.id === id && r.alive);
export function rivalTargets() { return RIVALS.list.filter(r => r.alive); }
// Roots of the three models (so their shaders can be compiled before they first appear).
export function rivalModels() { build(); return RIVALS.list.map(r => r.root); }
