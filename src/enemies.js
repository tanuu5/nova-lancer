// Enemies: procedural models, rail-space movement patterns, firing behaviours and the enemy manager.
import * as THREE from 'three';
import { G, rand, clamp, lerp, damp, TAU, emit, diff, easeOutCubic, easeInOutCubic, after } from './core.js';
import { railFrame, railToWorld, groundHeight, emissiveVertexMaterial, mergeGeometries } from './world.js';
import { FX, explode, glow, sparks, addShake } from './fx.js';
import { TARGETS, enemyShot, aimAtPlayer } from './weapons.js';
import { AudioSys } from './audio.js';
import { loft, slab, fin, mirrorX } from './ship.js';

// ============================================================ Model helpers
export function paint(g0, hex, em = 0) {
  const g = g0.index ? g0.toNonIndexed() : g0.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.computeVertexNormals();
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const ca = new Float32Array(n * 3), ea = new Float32Array(n);
  for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; ea[i] = em; }
  g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  g.setAttribute('aEmit', new THREE.BufferAttribute(ea, 1));
  return g;
}
export const diamond = (w, h, y = 0) => [[w, y], [0, y + h], [-w, y], [0, y - h]];
const hexSect = (w, h, y = 0) => [[w, y], [w * 0.5, y + h], [-w * 0.5, y + h], [-w, y], [-w * 0.5, y - h], [w * 0.5, y - h]];
const sym = (g, hex, em = 0) => [paint(g, hex, em), paint(mirrorX(g), hex, em)];

function modelDart() {
  const body = loft([{ z: -3.3, pts: diamond(0.06, 0.06) }, { z: -1.8, pts: diamond(0.5, 0.38) }, { z: 0.8, pts: diamond(0.75, 0.55) }, { z: 2.3, pts: diamond(0.36, 0.3) }]);
  const wing = slab([[0.4, 1.2], [3.5, -0.5], [3.7, -1.1], [0.5, 2.1 - 4.1]], 0.14);
  const tail = fin([[0, 0], [1.2, 0], [1.5, 0.95], [0.9, 1.05]], 0.1).translate(0, 0.3, 0.7);
  return mergeGeometries([
    paint(body, '#3b3448'), ...sym(wing, '#b8243f'), paint(tail, '#b8243f'),
    paint(new THREE.OctahedronGeometry(0.34, 0).scale(1, 0.8, 1.6).translate(0, 0.28, -1.5), '#ff2d7a', 1),
    paint(new THREE.BoxGeometry(0.55, 0.32, 0.2).translate(0, 0, 2.35), '#ff8a2a', 1),
  ]);
}

function modelInterceptor() {
  const body = loft([{ z: -4.0, pts: diamond(0.05, 0.05) }, { z: -2.0, pts: diamond(0.42, 0.34) }, { z: 1.0, pts: diamond(0.62, 0.45) }, { z: 2.6, pts: diamond(0.3, 0.25) }]);
  const wing = slab([[0.4, 0.2], [3.0, -2.0], [3.1, -2.5], [0.4, -2.3]], 0.12);
  const can = slab([[0.3, 2.4], [1.3, 1.8], [1.3, 1.6], [0.3, 1.7]], 0.08);
  return mergeGeometries([
    paint(body, '#d9dbe2'), ...sym(wing, '#c42a36'), ...sym(can, '#2a2d38'),
    paint(new THREE.OctahedronGeometry(0.3, 0).scale(1, 0.8, 1.8).translate(0, 0.26, -1.7), '#ff3030', 1),
    paint(new THREE.BoxGeometry(0.5, 0.3, 0.2).translate(0, 0, 2.65), '#ff6a3a', 1),
  ]);
}

function modelRaptor() {
  const pod = loft([{ z: -3.6, pts: hexSect(0.1, 0.1) }, { z: -2.2, pts: hexSect(0.8, 0.55) }, { z: 1.0, pts: hexSect(1.0, 0.7) }, { z: 2.6, pts: hexSect(0.6, 0.45) }]);
  const boom = new THREE.BoxGeometry(0.7, 0.7, 5.8).translate(2.3, -0.1, 0.8);
  const wing = slab([[0.8, 0.6], [4.4, -0.8], [4.4, -1.8], [0.8, -1.6]], 0.2);
  const tfin = fin([[0, 0], [1.4, 0], [1.7, 1.3], [1.1, 1.35]], 0.12).translate(2.3, 0.25, 2.2);
  return mergeGeometries([
    paint(pod, '#3e4838'), ...sym(boom, '#343b30'), ...sym(wing, '#3e4838'), ...sym(tfin, '#d6a21f'),
    paint(new THREE.BoxGeometry(1.1, 0.18, 0.5).translate(0, 0.45, -2.0), '#ff3b1f', 1),
    ...sym(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 8).rotateX(Math.PI / 2).translate(2.3, -0.1, 3.75), '#ff7a2a', 1),
    ...sym(new THREE.BoxGeometry(0.72, 0.72, 0.6).translate(2.3, -0.1, -2.3), '#d6a21f'),
  ]);
}

function modelDrone() {
  const disc = new THREE.CylinderGeometry(1.6, 1.9, 0.45, 8);
  const dome = new THREE.SphereGeometry(0.8, 8, 4, 0, TAU, 0, Math.PI / 2).translate(0, 0.2, 0);
  const ring = new THREE.TorusGeometry(1.75, 0.12, 4, 16).rotateX(Math.PI / 2);
  return mergeGeometries([paint(disc, '#474c59'), paint(dome, '#ff3a5c', 1), paint(ring, '#ff7a30', 0.8),
    ...sym(new THREE.BoxGeometry(0.4, 0.2, 1.4).translate(2.1, 0, 0), '#2c2f38')]);
}

function modelMine() {
  const parts = [paint(new THREE.IcosahedronGeometry(1.8, 0), '#2e2b36'), paint(new THREE.TorusGeometry(1.9, 0.18, 4, 18), '#ff2a2a', 1)];
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, -0.7, 0]];
  for (const d of dirs) {
    const c = new THREE.ConeGeometry(0.35, 1.4, 5).translate(0, 2.3, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...d).normalize());
    c.applyQuaternion(q);
    parts.push(paint(c, '#7a7f8a'));
  }
  return mergeGeometries(parts);
}

function modelCarrier() {
  const body = new THREE.OctahedronGeometry(2.2, 0).scale(1.2, 0.8, 1.5);
  const box = new THREE.BoxGeometry(2.2, 1.4, 2.2).translate(0, -1.2, 0);
  return mergeGeometries([paint(body, '#c9a03a'), paint(box, '#3a3f4a'), paint(new THREE.TorusGeometry(1.5, 0.15, 4, 12).rotateX(Math.PI / 2).translate(0, -0.2, 0), '#46e0ff', 1),
    ...sym(new THREE.BoxGeometry(2.2, 0.15, 1.2).translate(2.4, 0, 0), '#8a6a22')]);
}

function modelGunship() {
  const hull = loft([
    { z: -14, pts: hexSect(0.4, 0.4) }, { z: -10, pts: hexSect(2.6, 1.8) }, { z: 0, pts: hexSect(3.6, 2.4) }, { z: 9, pts: hexSect(3.2, 2.2) }, { z: 13, pts: hexSect(2.2, 1.6) },
  ]);
  const parts = [paint(hull, '#3b3f4f')];
  parts.push(paint(new THREE.BoxGeometry(2.8, 2.0, 5).translate(0, 3.0, 3), '#2e3240'));
  parts.push(paint(new THREE.BoxGeometry(2.4, 0.3, 1.2).translate(0, 3.6, 0.8), '#ffb84a', 1));
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      parts.push(paint(new THREE.CylinderGeometry(1.1, 1.3, 6, 8).rotateX(Math.PI / 2).translate(4.2 * sx, 1.1 * sy, 9), '#2a2d38'));
      parts.push(paint(new THREE.CircleGeometry(0.9, 8).translate(4.2 * sx, 1.1 * sy, 12.05), '#ff7a2a', 1));
    }
    parts.push(paint(new THREE.BoxGeometry(0.4, 0.3, 18).translate(3.65 * sx, 0, -1), '#a8323a'));
  }
  parts.push(...sym(slab([[3.4, 4], [9, -3], [9, -6], [3.4, -6]], 0.5), '#343847'));
  return mergeGeometries([...parts, ...[-5, 1, 7].map(z => paint(new THREE.SphereGeometry(1.1, 8, 4, 0, TAU, 0, Math.PI / 2).translate(0, 2.3, z), '#59606b'))]);
}

function modelTurretBase() {
  return mergeGeometries([paint(new THREE.CylinderGeometry(2.6, 3.2, 2.4, 8).translate(0, 1.2, 0), '#3a3f47'),
    paint(new THREE.TorusGeometry(2.7, 0.15, 4, 16).rotateX(Math.PI / 2).translate(0, 2.2, 0), '#ff3a2a', 0.8)]);
}
function modelTurretHead() {
  return mergeGeometries([
    paint(new THREE.SphereGeometry(1.9, 10, 5, 0, TAU, 0, Math.PI / 2), '#5a616d'),
    ...[-0.55, 0.55].map(x => paint(new THREE.CylinderGeometry(0.22, 0.26, 3.2, 6).rotateX(Math.PI / 2).translate(x, 0.8, -2.2), '#26292f')),
    paint(new THREE.BoxGeometry(0.9, 0.35, 0.3).translate(0, 1.25, -1.55), '#ff2a2a', 1),
  ]);
}
function modelAAHead() {
  return mergeGeometries([
    paint(new THREE.BoxGeometry(3.2, 1.6, 2.6).translate(0, 0.8, 0), '#4c5260'),
    ...[-1.1, -0.37, 0.37, 1.1].map(x => paint(new THREE.CylinderGeometry(0.16, 0.2, 3.6, 5).rotateX(Math.PI / 2).translate(x, 1.1, -2.6), '#26292f')),
    paint(new THREE.BoxGeometry(2.4, 0.25, 0.25).translate(0, 1.7, -1.3), '#ffae2a', 1),
  ]);
}

const GEO = {};
function geo(name) {
  if (!GEO[name]) GEO[name] = ({ dart: modelDart, interceptor: modelInterceptor, raptor: modelRaptor, drone: modelDrone, mine: modelMine, carrier: modelCarrier, gunship: modelGunship, turretBase: modelTurretBase, turretHead: modelTurretHead, aaHead: modelAAHead })[name]();
  return GEO[name];
}

// ============================================================ Definitions
export const DEFS = {
  dart:        { hp: 1,  r: 4.6, scale: 1.4,  score: 100,  hits: 1, expl: 1.1, fire: { rate: 0.3, kind: 'orb', speed: 170 }, sfx: 'explodeS' },
  interceptor: { hp: 2,  r: 4.6, scale: 1.35, score: 150,  hits: 1, expl: 1.1, fire: { rate: 0.45, kind: 'laser', speed: 240 }, sfx: 'explodeS' },
  raptor:      { hp: 5,  r: 6.4, scale: 1.3,  score: 300,  hits: 1, expl: 1.8, fire: { rate: 0.65, kind: 'spread3', speed: 155 }, sfx: 'explodeM' },
  drone:       { hp: 1,  r: 3.8, scale: 1.4,  score: 50,   hits: 1, expl: 0.8, fire: null, sfx: 'explodeS' },
  mine:        { hp: 2,  r: 3.6, scale: 1.2,  score: 100,  hits: 1, expl: 1.3, fire: null, sfx: 'explodeM', proximity: 11 },
  carrier:     { hp: 4,  r: 4.8, scale: 1.3,  score: 300,  hits: 1, expl: 1.4, fire: null, sfx: 'explodeM' },
  gunship:     { hp: 38, r: 13,  scale: 1.2,  score: 2000, hits: 5, expl: 4.2, fire: { rate: 1.1, kind: 'spread5', speed: 130 }, sfx: 'explodeL' },
  turret:      { hp: 3,  r: 4.2, scale: 1.2,  score: 200,  hits: 1, expl: 1.4, fire: { rate: 0.55, kind: 'burst', speed: 175 }, sfx: 'explodeM', ground: true },
  aagun:       { hp: 4,  r: 4.4, scale: 1.2,  score: 300,  hits: 1, expl: 1.5, fire: { rate: 0.75, kind: 'flak', speed: 170 }, sfx: 'explodeM', ground: true },
};

// ============================================================ Patterns (rail space: s = distance, u = lateral, v = height)
const PAT = {
  // Fly head-on toward the player, weaving
  approach(e, dt) {
    const P = e.P;
    e.s -= (P.speed ?? 40) * dt;
    e.u = (P.u ?? 0) + (P.au ?? 0) * Math.sin(e.t * (P.fu ?? 1.2) + (P.ph ?? 0));
    e.v = (P.v ?? 20) + (P.av ?? 0) * Math.sin(e.t * (P.fv ?? 1.5) + (P.ph ?? 0) * 1.3);
  },
  // Enter from far ahead, hold a distance ahead of the player while drifting, then leave
  hold(e, dt) {
    const P = e.P;
    const dist = P.dist ?? 140, enter = P.enter ?? 2.2, stay = P.stay ?? 7;
    const tgt = G.rail.d + dist;
    if (e.t < enter) e.s = lerp(e.sEnter, tgt, easeOutCubic(e.t / enter));
    else if (e.t < enter + stay) e.s = tgt + Math.sin(e.t * 0.7 + (P.ph ?? 0)) * 12;
    else { e.s += (G.rail.speed + 70) * dt; e.v += 22 * dt; }
    e.u = (P.u ?? 0) + (P.au ?? 18) * Math.sin(e.t * (P.fu ?? 0.8) + (P.ph ?? 0));
    e.v = e.t < enter + stay ? (P.v ?? 22) + (P.av ?? 8) * Math.sin(e.t * (P.fv ?? 1.1) + (P.ph ?? 0) * 2) : e.v;
    if (e.t >= enter + stay + 6) e.remove();
  },
  // Start behind the camera, overtake the player, then turn and hold
  behind(e, dt) {
    const P = e.P;
    const rel = P.rel ?? 70;
    if (e.phase === 0) {
      e.s = G.rail.d - 45 + rel * e.t;
      e.u = lerp(P.u0 ?? 0, P.u ?? 0, clamp(e.t / 2.5, 0, 1));
      e.v = lerp(P.v0 ?? 30, P.v ?? 22, clamp(e.t / 2.5, 0, 1));
      if (e.s > G.rail.d + (P.dist ?? 120)) { e.phase = 1; e.t0 = e.t; }
    } else {
      const k = e.t - e.t0;
      e.s = G.rail.d + (P.dist ?? 120) + Math.sin(k * 0.8) * 10;
      e.u = (P.u ?? 0) + 16 * Math.sin(k * 0.9 + (P.ph ?? 0));
      e.v = (P.v ?? 22) + 6 * Math.sin(k * 1.3 + (P.ph ?? 0));
      if (k > (P.stay ?? 6)) { e.s += 200 * (k - (P.stay ?? 6)); e.v += 30 * dt; }
      if (k > (P.stay ?? 6) + 3) e.remove();
    }
  },
  // Cross the screen laterally at a fixed distance ahead
  cross(e, dt) {
    const P = e.P;
    e.s = G.rail.d + (P.dist ?? 160) - (P.close ?? 0) * e.t;
    e.u = (P.u0 ?? -90) + (P.su ?? 30) * e.t;
    e.v = (P.v ?? 22) + (P.av ?? 6) * Math.sin(e.t * 2 + (P.ph ?? 0));
    if (Math.abs(e.u) > 140 && e.t > 2) e.remove();
  },
  // World-stationary (turrets, mines, props)
  fixed(e, dt) {
    const P = e.P;
    if (P.bob) e.v = P.v + Math.sin(e.t * 1.6 + (P.ph ?? 0)) * P.bob;
  },
  // Dive from high above, sweep down past the player's altitude, then climb away
  dive(e, dt) {
    const P = e.P;
    e.s -= (P.speed ?? 30) * dt;
    const k = e.t / (P.dur ?? 4);
    e.v = lerp(P.v0 ?? 90, P.v ?? 15, Math.sin(Math.min(1, k) * Math.PI * 0.5)) + (k > 1 ? (k - 1) * 60 : 0);
    e.u = (P.u ?? 0) + (P.au ?? 10) * Math.sin(e.t * 1.2 + (P.ph ?? 0));
  },
  // Ring formation spinning around a centre that holds ahead of the player
  circle(e, dt) {
    const P = e.P;
    const dist = P.dist ?? 170, enter = P.enter ?? 2.5, stay = P.stay ?? 8;
    const tgt = G.rail.d + dist;
    const cs = e.t < enter ? lerp(e.sEnter, tgt, easeOutCubic(e.t / enter)) : (e.t < enter + stay ? tgt : tgt + (e.t - enter - stay) * 150);
    const rr = (P.r ?? 16) * (0.6 + 0.4 * Math.min(1, e.t / enter));
    const a = (P.a0 ?? 0) + e.t * (P.spin ?? 1.4);
    e.s = cs;
    e.u = (P.u ?? 0) + Math.cos(a) * rr;
    e.v = (P.v ?? 24) + Math.sin(a) * rr;
    if (e.t > enter + stay + 3) e.remove();
  },
  // Follow a moving anchor (e.g. chasing a wingman)
  chase(e, dt) {
    const P = e.P, A = P.anchor;
    if (!A || A.gone) { e.s += 160 * dt; e.v += 20 * dt; if (e.t > 12) e.remove(); return; }
    e.s = damp(e.s, A.s - (P.back ?? 18), 3, dt);
    e.u = damp(e.u, A.u + (P.ou ?? 0) + Math.sin(e.t * 2 + (P.ph ?? 0)) * 3, 3, dt);
    e.v = damp(e.v, A.v + (P.ov ?? 0) + Math.cos(e.t * 1.7 + (P.ph ?? 0)) * 2, 3, dt);
  },
  // Slow flyby across the path (gunship)
  flyby(e, dt) {
    const P = e.P;
    const enter = P.enter ?? 3;
    const tgt = G.rail.d + (P.dist ?? 220);
    e.s = e.t < enter ? lerp(e.sEnter, tgt, easeOutCubic(e.t / enter)) : tgt - (e.t - enter) * (P.close ?? 4);
    e.u = (P.u0 ?? 60) + (P.su ?? -9) * e.t;
    e.v = (P.v ?? 34) + Math.sin(e.t * 0.6) * 5;
    if (e.t > (P.life ?? 22)) { e.s += 120 * (e.t - (P.life ?? 22)); }
    if (e.t > (P.life ?? 22) + 4) e.remove();
  },
};

// ============================================================ Enemy
const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export const enemies = [];
const pools = new Map();

export class Enemy {
  constructor(type) {
    this.type = type;
    this.def = DEFS[type];
    this.mat = emissiveVertexMaterial({ roughness: 0.5, metalness: 0.35 }, 3.2);
    this.root = new THREE.Group();
    if (type === 'turret' || type === 'aagun') {
      this.base = new THREE.Mesh(geo('turretBase'), this.mat);
      this.head = new THREE.Mesh(geo(type === 'turret' ? 'turretHead' : 'aaHead'), this.mat);
      this.head.position.y = 2.4;
      this.root.add(this.base, this.head);
      this.base.castShadow = this.head.castShadow = true;
    } else {
      this.mesh = new THREE.Mesh(geo(type), this.mat);
      this.mesh.castShadow = true;
      this.root.add(this.mesh);
    }
    this.root.scale.setScalar(this.def.scale || 1);
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.radius = this.def.r;
  }

  spawn(pattern, P, opts = {}) {
    this.pattern = PAT[pattern];
    this.patternName = pattern;
    this.P = P;
    this.t = 0; this.phase = 0; this.t0 = 0;
    this.hp = Math.ceil(this.def.hp * (opts.hpMul ?? 1));
    this.maxHp = this.hp;
    this.alive = true; this.hittable = true; this.lockable = true;
    this.s = P.s ?? (G.rail.d + (P.ahead ?? 600));
    this.sEnter = this.s;
    this.u = P.u ?? P.u0 ?? 0;
    this.v = P.v ?? P.v0 ?? 20;
    this.carry = opts.carry || null;
    this.group = opts.group || null;
    this.fireT = rand(0.6, 1.6) / (this.def.fire ? this.def.fire.rate * diff().fire : 1);
    this.noFire = !!opts.noFire;
    this.bank = 0;
    this.flash = 0;
    this.onDeath = opts.onDeath || null;
    this.credit = opts.credit ?? true;
    this.mat.userData.flash.value = 0;
    this.mat.userData.emit.value = 3.2;
    this.first = true;
    this.pattern(this, 0);
    this.place();
    this.prev.copy(this.pos);
    G.scene.add(this.root);
    TARGETS.add(this);
    enemies.push(this);
    if (this.group) this.group.members++;
    return this;
  }

  place() {
    if (this.def.ground) {
      railToWorld(this.s, this.u, 0, this.pos);
      if (this.P.onGround !== false) this.pos.y = Math.max(groundHeight(this.pos.x, this.pos.z), this.P.minY ?? -99);
      else this.pos.y = this.v;
    } else {
      railToWorld(this.s, this.u, this.v, this.pos);
      const gh = groundHeight(this.pos.x, this.pos.z);
      const minY = Math.max(gh + 4, 3);
      if (this.pos.y < minY) { this.pos.y = minY; this.v = minY; }
    }
  }

  update(dt) {
    this.t += dt;
    this.prev.copy(this.pos);
    this.pattern(this, dt);
    if (!this.alive) return;
    this.place();
    if (dt > 0) this.vel.subVectors(this.pos, this.prev).multiplyScalar(1 / dt);
    this.root.position.copy(this.pos);
    this.orient(dt);
    // hit flash
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mat.userData.flash.value = this.flash * 2.2;
    if (this.type === 'mine') { this.mat.userData.emit.value = 2 + Math.sin(this.t * 8) * 1.8; this.root.rotation.x += dt * 0.7; this.root.rotation.y += dt * 1.1; }
    // behaviour
    const P = G.player;
    const toP = _v.subVectors(P.pos, this.pos);
    const dist = toP.length();
    if (this.def.proximity && P.alive && dist < this.def.proximity) { P.damage(12); this.kill('self'); return; }
    // collide with player (chasers overtaking from behind the camera can't be seen, so they don't ram)
    const unseen = this.patternName === 'chase' && this.s < G.rail.d + 10;
    if (P.alive && !this.def.ground && !unseen && dist < this.radius + 2.2 && this.type !== 'gunship') {
      if (P.damage(14)) { this.hit(99, this.pos, 'ram'); return; }
    } else if (P.alive && this.type === 'gunship' && dist < this.radius) { P.damage(18); }
    this.tryFire(dt, dist);
    // despawn when well behind the camera (chasers start back there with the wingman they're tailing)
    if (this.s < G.rail.d - (this.patternName === 'chase' ? 200 : 60) && this.t > 1) this.remove();
    // glow accents
    if (this.type === 'carrier') glow(this.pos, 6 + Math.sin(this.t * 6) * 1, 0.4, 2.2, 3, 0.6);
    // damaged heavies trail smoke and sparks
    if (this.maxHp > 2 && this.hp <= this.maxHp * 0.5 && !this.def.ground) {
      this.smokeT = (this.smokeT || 0) - dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.05;
        const k = this.def.scale || 1;
        FX.smoke.spawn(this.pos.x, this.pos.y, this.pos.z, rand(-1, 1), rand(1, 3), rand(-1, 1), 1.2, 1.2 * k, 4.5 * k, [0.12, 0.11, 0.12, 0.65], [0.3, 0.29, 0.3, 0], 1, { fadeIn: 0.05 });
        if (Math.random() < 0.3) FX.smoke.spawn(this.pos.x, this.pos.y, this.pos.z, 0, 0, 0, 0.3, 1.2 * k, 2.2 * k, [3.5, 1.2, 0.25, 0.9], [0.2, 0.1, 0.1, 0], 1, { cpow: 0.5 });
      }
    }
  }

  orient(dt) {
    if (this.def.ground) {
      // turret heads track the player
      const P = G.player;
      _v.subVectors(P.pos, this.pos);
      const yaw = Math.atan2(-_v.x, -_v.z);
      this.head.rotation.y = yaw;
      this.head.rotation.x = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)) * 0.5, -0.1, 0.7);
      return;
    }
    const sp = this.vel.length();
    if (sp < 0.5) return;
    _f.copy(this.vel).multiplyScalar(1 / sp);
    // bank from lateral acceleration
    railFrame(this.s, _p, null, _r);
    const lat = (this.vel.x * _r.x + this.vel.z * _r.z);
    this.bank = damp(this.bank, clamp(-lat / 40, -1.1, 1.1) * Math.sign(-_f.z || 1), 4, dt);
    _m.lookAt(_v2.set(0, 0, 0), _f, _up);
    _q.setFromRotationMatrix(_m);
    const target = _q.multiply(new THREE.Quaternion().setFromAxisAngle(_v2.set(0, 0, 1), this.bank));
    // lookAt makes -Z?  Object3D.lookAt semantics: matrix.lookAt(eye, target) makes +Z point from target to eye.
    if (this.first) { this.quat.copy(target); this.first = false; }
    else this.quat.slerp(target, clamp(dt * 8, 0, 1));
    this.root.quaternion.copy(this.quat);
  }

  tryFire(dt, dist) {
    const F = this.def.fire;
    if (!F || this.noFire || !G.player.alive) return;
    if (this.s < G.rail.d + 25 || dist > 650 || dist < 45) return;
    this.fireT -= dt;
    if (this.fireT > 0) return;
    this.fireT = rand(0.7, 1.3) / (F.rate * diff().fire);
    const muzzle = _p.copy(this.pos);
    switch (F.kind) {
      case 'orb': enemyShot(muzzle, aimAtPlayer(muzzle, F.speed, 0.03), 'orb'); break;
      case 'laser': enemyShot(muzzle, aimAtPlayer(muzzle, F.speed, 0.02), 'laser'); break;
      case 'spread3': {
        const base = aimAtPlayer(muzzle, F.speed, 0);
        for (const a of [-0.13, 0, 0.13]) enemyShot(muzzle, base.clone().applyAxisAngle(_up, a), 'orb');
        break;
      }
      case 'spread5': {
        const base = aimAtPlayer(muzzle, F.speed, 0);
        for (const a of [-0.3, -0.15, 0, 0.15, 0.3]) enemyShot(muzzle, base.clone().applyAxisAngle(_up, a), 'orb');
        if (Math.random() < 0.5) enemyShot(muzzle, aimAtPlayer(muzzle, 90, 0).setY(40), 'missile', { turn: 1.4 });
        break;
      }
      case 'burst': {
        const head = _v2.copy(this.pos); head.y += 3.8;
        const hp = head.clone();
        for (let i = 0; i < 3; i++) after(i * 0.12, () => { if (this.alive && G.player.alive) enemyShot(hp, aimAtPlayer(hp, F.speed, 0.025), 'laser'); });
        break;
      }
      case 'flak': {
        const head = _v2.copy(this.pos); head.y += 4.3;
        const P = G.player;
        const fuse = clamp(dist / F.speed, 0.5, 3);
        const lead = _v.copy(P.pos).addScaledVector(P.railFwd, G.rail.speed * fuse).add(_r.set(rand(-9, 9), rand(-5, 7), rand(-9, 9)));
        const vel = lead.sub(head).multiplyScalar(1 / fuse);
        enemyShot(head, vel, 'flak', { fuse });
        break;
      }
    }
    AudioSys.sfx('enemyShot', { vol: 0.55, pan: clamp((this.pos.x - G.camera.position.x) / 60, -1, 1) });
  }

  // Target interface
  hit(dmg, point, source) {
    if (!this.alive) return 'none';
    this.hp -= dmg;
    this.flash = 1;
    if (this.hp <= 0) { this.kill(source); return 'kill'; }
    return 'hit';
  }

  kill(source) {
    if (!this.alive) return;
    this.alive = false;
    const big = this.def.expl;
    explode(this.pos, big, { vel: this.vel });
    AudioSys.sfx(this.def.sfx, { pan: clamp((this.pos.x - G.camera.position.x) / 60, -1, 1) });
    const credited = source !== 'self' && source !== 'wingman' && this.credit;
    if (credited) emit('enemyKilled', this, source);
    if (this.carry) emit('dropItem', this.carry, this.pos.clone(), this.s, this.u, this.v);
    if (this.group) { this.group.killed++; if (credited) this.group.byPlayer++; if (this.group.killed >= this.group.members && this.group.onClear) this.group.onClear(this.group); }
    if (this.onDeath) this.onDeath(this, source);
    this.cleanup();
  }

  remove() {
    if (!this.alive && !this.root.parent) return;
    this.alive = false;
    if (this.group) { this.group.gone = (this.group.gone || 0) + 1; }
    this.cleanup();
  }

  cleanup() {
    TARGETS.delete(this);
    G.scene.remove(this.root);
    const i = enemies.indexOf(this);
    if (i >= 0) enemies.splice(i, 1);
    if (!pools.has(this.type)) pools.set(this.type, []);
    pools.get(this.type).push(this);
  }
}

export function spawnEnemy(type, pattern, P, opts) {
  const pool = pools.get(type);
  const e = pool && pool.length ? pool.pop() : new Enemy(type);
  return e.spawn(pattern, P, opts);
}

export function makeGroup(onClear) { return { members: 0, killed: 0, byPlayer: 0, onClear }; }

export function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.alive) e.update(dt);
  }
}

export function clearEnemies() {
  for (let i = enemies.length - 1; i >= 0; i--) enemies[i].remove();
  enemies.length = 0;
}

// Pre-build geometry/programs so the first spawn doesn't hitch.
export function warmEnemies() {
  for (const t of Object.keys(DEFS)) {
    const e = new Enemy(t);
    if (!pools.has(t)) pools.set(t, []);
    pools.get(t).push(e);
    e.root.position.set(0, -500, 0);
    G.scene.add(e.root);
  }
}
export function unwarmEnemies() {
  for (const [, list] of pools) for (const e of list) G.scene.remove(e.root);
}

// ============================================================ Formation helpers for the level script
export function wave(type, pattern, n, fn, opts = {}) {
  const group = makeGroup(opts.onClear);
  const list = [];
  for (let i = 0; i < n; i++) {
    const P = fn(i, n);
    list.push(spawnEnemy(type, pattern, P, { ...opts, group, carry: opts.carryIndex === i ? opts.carry : null }));
  }
  group.list = list;
  return group;
}
