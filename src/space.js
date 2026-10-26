// Space stages: drifting asteroids and wreckage for a stage's decorate(), and the props that live out there —
// obstacle rocks, breakable rubble, derelict hulls and the rotating wreck the course flies straight through.
// (The nebula sky and "no ground, no sea, no gravity" are switched on by the stage world: world.useStageWorld.)
import * as THREE from 'three';
import { G, rand, TAU, mulberry32, Simplex2, emit } from './core.js';
import { railToWorld, emissiveVertexMaterial, mergeGeometries } from './world.js';
import { patchFog, ATMO } from './gfx.js';
import { paint } from './enemies.js';
import { Prop, registerProp, hitObstacle } from './props.js';
import { FX, sparks, glow } from './fx.js';
import { AudioSys } from './audio.js';

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

// ============================================================ Materials
// Vertex-coloured standard material with an emissive mask (aEmit) that also tumbles each instance of an
// InstancedMesh on its own axis (axis and rate hashed from the instance position, so nothing extra is stored).
export function spinMaterial(opts = {}, spin = 1) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.05, ...opts });
  const uSpin = { value: spin };
  patchFog(mat, (shader) => {
    shader.uniforms.uTime = ATMO.uTime;
    shader.uniforms.uSpin = uSpin;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aEmit; varying float vEmit; uniform float uTime; uniform float uSpin;
mat3 spinRot(vec3 ax, float a){ float s = sin(a), c = cos(a), oc = 1.0 - c;
  return mat3(oc * ax.x * ax.x + c, oc * ax.x * ax.y + ax.z * s, oc * ax.z * ax.x - ax.y * s,
              oc * ax.x * ax.y - ax.z * s, oc * ax.y * ax.y + c, oc * ax.y * ax.z + ax.x * s,
              oc * ax.z * ax.x + ax.y * s, oc * ax.y * ax.z - ax.x * s, oc * ax.z * ax.z + c); }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
mat3 sR = mat3(1.0);
#ifdef USE_INSTANCING
{ vec3 iT = instanceMatrix[3].xyz; float h = fract(sin(dot(iT, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 ax = normalize(vec3(fract(h * 13.17), fract(h * 7.71), fract(h * 3.37)) - 0.5 + 1e-3);
  sR = spinRot(ax, uTime * uSpin * (0.12 + 0.45 * h) + h * 6.2832); }
#endif
objectNormal = sR * objectNormal;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = sR * transformed; vEmit = aEmit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEmit;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vEmit * 3.0;');
  });
  return mat;
}

let MATS = null;
export function spaceMats() {
  if (!MATS) MATS = {
    rock: spinMaterial({ roughness: 0.95, metalness: 0.04, envMapIntensity: 0.5 }, 1),
    junk: spinMaterial({ roughness: 0.55, metalness: 0.5 }, 1.6),
    hull: emissiveVertexMaterial({ roughness: 0.62, metalness: 0.45 }, 3),
  };
  return MATS;
}

// ============================================================ Geometry
const NZ = new Simplex2(9091);
// Lumpy low-poly asteroid (unit size); faces shaded from dark basalt to dusty grey, with a few rust-red patches.
// `round` keeps it close to a sphere (for props, whose collision is a sphere); decor rocks are squashed and stretched.
function asteroid(seed, detail, round) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const r = mulberry32(seed);
  const ox = r() * 50, oy = r() * 50, w = round ? 0.12 : 1;
  const sx = 1 + (r() - 0.5) * 0.5 * w, sy = 1 - (0.08 + r() * 0.3) * w, sz = 1 + (r() - 0.5) * 0.5 * w;
  let rMax = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + NZ.noise(x * 1.6 + ox, y * 1.6 + z * 1.2 + oy) * 0.24 + NZ.noise(x * 4.3 - oy, z * 4.3 + y * 2.1) * 0.07;
    p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
    rMax = Math.max(rMax, Math.hypot(x * k * sx, y * k * sy, z * k * sz));
  }
  g.scale(1 / rMax, 1 / rMax, 1 / rMax);   // unit size = the farthest point, so a prop's collision sphere sits inside what you see
  g.computeVertexNormals();
  const n = p.count, col = new Float32Array(n * 3), em = new Float32Array(n);
  const dark = new THREE.Color('#4a4452'), mid = new THREE.Color('#857c8a'), dust = new THREE.Color('#b0a6b0'), rust = new THREE.Color('#8a5a4c'), c = new THREE.Color();
  for (let i = 0; i < n; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const t = NZ.noise(cx * 2.2 + ox, cz * 2.2 - cy * 1.7) * 0.5 + 0.5;
    c.copy(dark).lerp(mid, t);
    if (t > 0.72) c.lerp(dust, (t - 0.72) * 3);
    if (NZ.noise(cx * 3.1 - 7, cy * 3.1 + cz) > 0.55) c.lerp(rust, 0.6);
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
  g.deleteAttribute('uv');
  return g;
}

const GEO = {};
export function rockGeo(i) { return GEO['rock' + i] || (GEO['rock' + i] = asteroid(31 + i * 977, i < 3 ? 1 : 2, i >= 3)); }   // 0–2 decor, 3–4 close up

// Tumbling scrap for the wreck fields: a bent hull plate, a girder, a cargo pod.
function junkGeo(i) {
  if (GEO['junk' + i]) return GEO['junk' + i];
  let g;
  if (i === 0) g = mergeGeometries([paint(new THREE.BoxGeometry(2.2, 0.16, 1.6).translate(0, 0, -0.75), '#59606e'), paint(new THREE.BoxGeometry(2.2, 0.16, 1.4).rotateX(0.45).translate(0, 0.32, 0.72), '#4a505c'),
    paint(new THREE.BoxGeometry(0.2, 0.2, 2.8).translate(0.9, 0.12, 0), '#2c3038'), paint(new THREE.BoxGeometry(0.5, 0.06, 0.3).translate(-0.4, 0.12, -1.0), '#ff9a3a', 1)]);
  else if (i === 1) g = mergeGeometries([paint(new THREE.BoxGeometry(0.22, 1.1, 3.6), '#5b5048'), paint(new THREE.BoxGeometry(1.0, 0.16, 3.6).translate(0, 0.55, 0), '#6a6058'),
    paint(new THREE.BoxGeometry(1.0, 0.16, 3.6).translate(0, -0.55, 0), '#6a6058')]);
  else g = mergeGeometries([paint(new THREE.CylinderGeometry(0.8, 0.8, 2.6, 8).rotateX(Math.PI / 2), '#8a6a3a'), paint(new THREE.TorusGeometry(0.82, 0.1, 4, 8).translate(0, 0, 0.9), '#2c3038'),
    paint(new THREE.TorusGeometry(0.82, 0.1, 4, 8).translate(0, 0, -0.9), '#2c3038'), paint(new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(0, 0.82, 0), '#57e3ff', 1)]);
  return (GEO['junk' + i] = g);
}

// A ship's hull (or what is left of it): a ring of plates every `ring` metres with some plates missing, rib frames
// and strip lights inside, running from z = 0 to z = -len around the Z axis.
export function hullParts(parts, { R, len, segs = 16, ring = 30, gap = 0.18, seed = 1, plate = '#4a4f5e', plate2 = '#3d4250', rib = '#2b2f38', lights = ['#ffb347', '#57e3ff'] }) {
  const rnd = mulberry32(seed);
  const rings = Math.max(1, Math.round(len / ring)), L = len / rings, w = 2 * R * Math.sin(Math.PI / segs);
  for (let k = 0; k < rings; k++) {
    const z = -(k + 0.5) * L;
    for (let j = 0; j < segs; j++) {
      if (rnd() < gap) continue;
      const a = (j + 0.5) / segs * TAU;
      const g = new THREE.BoxGeometry(w * 1.03, 1.5, L * (0.9 + rnd() * 0.08));
      g.rotateZ(a - Math.PI / 2).translate(R * Math.cos(a), R * Math.sin(a), z + (rnd() - 0.5) * 1.6);
      parts.push(paint(g, rnd() < 0.7 ? plate : plate2));
    }
    parts.push(paint(new THREE.TorusGeometry(R - 0.8, 1.4, 4, segs).translate(0, 0, -k * L), rib));
    if (rnd() < 0.7) {
      const a = rnd() * TAU, r = R - 1.8;
      parts.push(paint(new THREE.BoxGeometry(0.7, 0.5, L * 0.7).rotateZ(a - Math.PI / 2).translate(r * Math.cos(a), r * Math.sin(a), z), lights[(rnd() * lights.length) | 0], 1));
    }
  }
  parts.push(paint(new THREE.TorusGeometry(R - 0.8, 1.4, 4, segs).translate(0, 0, -len), rib));
  return parts;
}

// ============================================================ Decorations
// Fills one stretch of course (chunk ci) with tumbling rocks and scrap around the corridor, never inside it.
// rocks / junk: how many; huge: chance of one far, mountain-sized rock; keepOut(u, v): part of the sky to leave
// empty (for a cut-scene's view). Returns the meshes it added to the scene.
export function spaceDecor(ci, CHUNK, { rocks = 10, junk = 0, huge = 0, seed = 0, keepOut = null } = {}) {
  const rnd = mulberry32(ci * 7919 + 101 + seed);
  const d0 = ci * CHUNK;
  const rb = [[], [], []], jb = [[], [], []];
  // the farther out, the bigger, so the field reads in depth
  const put = (list, R0, R1, sMin, sMax) => {
    const d = d0 + rnd() * CHUNK, a = rnd() * TAU, R = R0 + Math.pow(rnd(), 1.5) * (R1 - R0);
    const u = Math.cos(a) * R, v = 30 + Math.sin(a) * R * 0.72;
    railToWorld(d, u, v, _v);
    _q.setFromEuler(_e.set(rnd() * TAU, rnd() * TAU, rnd() * TAU));
    const sz = (sMin + Math.pow(rnd(), 3) * (sMax - sMin)) * (0.6 + R / 450);
    _s.set(sz, sz * (0.7 + rnd() * 0.3), sz);
    if (!keepOut || !keepOut(u, v)) list.push(_m.compose(_v, _q, _s).clone());
  };
  for (let i = 0; i < rocks; i++) put(rb[(rnd() * 3) | 0], 95, 900, 1.5, 24);
  for (let i = 0; i < junk; i++) put(jb[(rnd() * 3) | 0], 80, 500, 1.5, 6);
  if (rnd() < huge) put(rb[0], 900, 1500, 70, 160);
  const out = [], M = spaceMats();
  const add = (geo, mat, list) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    G.scene.add(im); out.push(im);
  };
  rb.forEach((l, i) => add(rockGeo(i), M.rock, l));
  jb.forEach((l, i) => add(junkGeo(i), M.junk, l));
  return out;
}

// ============================================================ Props
// Big asteroid near the course: fly around it (shots spark off it).
class Rock extends Prop {
  constructor(s, o) {
    super('rock', s, o);
    this.R = o.r ?? 18;
    this.mesh = new THREE.Mesh(rockGeo(3 + ((o.seed ?? 0) & 1)), spaceMats().rock);
    this.mesh.position.set(this.u, this.v, 0);
    this.mesh.scale.setScalar(this.R);
    this.mesh.rotation.set(rand(0, TAU), rand(0, TAU), 0);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.root.add(this.mesh);
    this.spin = [rand(-0.25, 0.25), rand(-0.25, 0.25)];
    this.addTarget({ pos: this.wp, radius: this.R * 0.8, alive: true, lockable: false, hittable: true, hit: () => 'armor' });
  }
  update(dt) {
    this.mesh.rotation.x += this.spin[0] * dt; this.mesh.rotation.y += this.spin[1] * dt;
    const r = this.rel();
    if (Math.abs(r.ds) < this.R + 3 && G.player.alive) {
      const dv = r.v - this.v;
      if (Math.hypot(r.ds, r.u, dv) < this.R * 0.86 + 2.2) hitObstacle(r.u >= 0 ? 1 : -1, Math.abs(dv) > Math.abs(r.u) ? Math.sign(dv) : 0);
    }
  }
}

// Small drifting rock: a few shots break it (+1 hit); flying into it breaks it too, but hurts.
class Rubble extends Prop {
  constructor(s, o) {
    super('rubble', s, o);
    this.R = o.r ?? 5;
    this.mesh = new THREE.Mesh(rockGeo(3 + ((o.seed ?? 0) & 1)), spaceMats().rock);
    this.mesh.scale.setScalar(this.R);
    this.mesh.rotation.set(rand(0, TAU), rand(0, TAU), 0);
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    this.du = o.du ?? rand(-3, 3); this.dv = o.dv ?? rand(-2, 2);
    this.spin = [rand(-1.2, 1.2), rand(-1.2, 1.2)];
    this.hp = o.hp ?? 4;
    const self = this;
    this.target = {
      pos: new THREE.Vector3(), radius: this.R + 1, alive: true, lockable: true, hittable: true,
      hit(dmg) { if (!self.alive) return 'none'; self.hp -= dmg; if (self.hp <= 0) { self.shatter(true); return 'kill'; } sparks(this.pos, null, 5, [3, 2.6, 2.2], 20, 1); return 'hit'; },
    };
    this.addTarget(this.target);
    this.place();
  }
  place() { this.mesh.position.set(this.u, this.v, 0); railToWorld(this.s, this.u, this.v, this.target.pos); }
  shatter(byPlayer) {
    const p = this.target.pos.clone(), k = this.R / 5;
    for (let i = 0; i < 7; i++) {
      _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(10, 26) * Math.sqrt(k));
      FX.debris.spawn(p, _v, rand(0.5, 1.1) * k, false);
    }
    for (let i = 0; i < 6; i++) FX.smoke.spawn(p.x, p.y, p.z, rand(-6, 6), rand(-6, 6), rand(-6, 6), rand(0.8, 1.4), 2 * k, 7 * k, [0.42, 0.38, 0.45, 0.6], [0.3, 0.28, 0.33, 0], 1, { fadeIn: 0.05, drag: 1.5 });
    sparks(p, null, 14, [4, 3, 2.2], 30, 1);
    AudioSys.sfx('explodeM', { pitch: 1.35, vol: 0.7 });
    if (byPlayer) emit('propDestroyed', this, p);
    this.dispose();
  }
  update(dt) {
    this.u += this.du * dt; this.v += this.dv * dt;
    this.mesh.rotation.x += this.spin[0] * dt; this.mesh.rotation.y += this.spin[1] * dt;
    this.place();
    const r = this.rel();
    if (Math.abs(r.ds) < this.R + 3 && G.player.alive && Math.hypot(r.ds, r.u, r.v - this.v) < this.R * 0.9 + 2.2) {
      hitObstacle(r.u >= 0 ? 1 : -1, 0);
      this.shatter(false);
    }
  }
}

// A derelict hull lying along the course (axis at u, v; reaching `len` metres forward from s).
class Hulk extends Prop {
  constructor(s, o) {
    super('hulk', s, o);
    this.R = o.r ?? 26;
    const parts = hullParts([], { R: this.R, len: this.len, segs: 12, ring: 26, gap: o.gap ?? 0.3, seed: o.seed ?? 7 });
    this.mesh = new THREE.Mesh(mergeGeometries(parts), spaceMats().hull);
    this.mesh.position.set(this.u, this.v, 0);
    this.mesh.rotation.z = o.roll ?? 0;
    this.root.add(this.mesh);
  }
  update(dt) {
    const r = this.rel();
    if (r.ds > -4 && r.ds < this.len + 4 && G.player.alive && Math.hypot(r.u, r.v - this.v) < this.R + 2.4) hitObstacle(r.u >= 0 ? 1 : -1, 0);
  }
}

// The rotating wreck: a dead ship turning about the course, flown through from end to end. Its bulkheads turn
// with it; only the holes in them are open. o: len, r (hull radius), v (axis height), spin (rad/s),
// walls: [{ at: metres from the entrance, holes: [[x, y, r], ...] }] in the wreck's own (turning) frame.
class SpinWreck extends Prop {
  constructor(s, o) {
    super('spinwreck', s, o);
    this.R = o.r ?? 62; this.axisV = o.v ?? 30; this.w = o.spin ?? 0.3; this.ang = o.phase ?? 0;
    this.walls = (o.walls || []).map(w => ({ ...w, prev: null }));
    this.spinG = new THREE.Group();
    this.spinG.position.set(this.u, this.axisV, 0);
    this.spinG.rotation.z = this.ang;
    this.spinG.add(new THREE.Mesh(wreckGeo(this.R, this.len, this.walls), spaceMats().hull));
    this.root.add(this.spinG);
  }
  // hole i of a wall, turned with the wreck → [x, y, r] relative to the axis
  hole(w, i) {
    const [hx, hy, hr] = w.holes[i], c = Math.cos(this.ang), s = Math.sin(this.ang);
    return [hx * c - hy * s, hx * s + hy * c, hr];
  }
  // the hole nearest to rail position (u, v) on the next wall ahead of the player (for the test bot)
  nextHole() {
    const ds = G.rail.d - this.s;
    for (const w of this.walls) {
      if (ds > w.at || ds < w.at - 160) continue;
      let best = null, bd = 1e9;
      for (let i = 0; i < w.holes.length; i++) {
        const [x, y] = this.hole(w, i);
        const d = Math.hypot(G.player.u - this.u - x, G.player.v - this.axisV - y);
        if (d < bd) { bd = d; best = { u: this.u + x, v: this.axisV + y }; }
      }
      return best;
    }
    return null;
  }
  cross(w) {
    const P = G.player, x = P.u - this.u, y = P.v - this.axisV;
    let near = null, bd = 1e9;
    for (let i = 0; i < w.holes.length; i++) {
      const [cx, cy, hr] = this.hole(w, i), d = Math.hypot(x - cx, y - cy);
      if (d < hr - 1.6) return;                       // through the hole
      if (d - hr < bd) { bd = d - hr; near = [cx, cy]; }
    }
    hitObstacle(Math.sign(near[0] - x) || 1, Math.sign(near[1] - y) || 1);
  }
  update(dt) {
    this.t += dt;
    this.ang += this.w * dt;
    this.spinG.rotation.z = this.ang;
    const ds = G.rail.d - this.s;
    for (const w of this.walls) {
      const k = ds - w.at;
      if (w.prev !== null && w.prev < 0 && k >= 0 && G.player.alive) this.cross(w);
      w.prev = k;
      // the hole rims flicker like failing warning lights
      if (k > -400 && k < 0) for (let i = 0; i < w.holes.length; i++) {
        const [x, y, hr] = this.hole(w, i);
        if (Math.random() < dt * 3) { railToWorld(this.s + w.at, this.u + x + rand(-hr, hr) * 0.7, this.axisV + y + rand(-hr, hr) * 0.7, _v); glow(_v, 5, 4, 2, 0.6, 0.9); }
      }
    }
    // sparks from torn cables while the player is inside
    if (ds > 0 && ds < this.len && Math.random() < dt * 6) {
      const a = rand(0, TAU), r = this.R - 3;
      railToWorld(G.rail.d + rand(40, 160), this.u + Math.cos(a + this.ang) * r, this.axisV + Math.sin(a + this.ang) * r, _v);
      sparks(_v, null, 8, [5, 3.5, 1.4], 18, 1);
    }
  }
}

// Hull + bulkheads of the rotating wreck (built in its turning frame: axis = Z, entrance at z = 0).
function wreckGeo(R, len, walls) {
  const parts = hullParts([], { R, len, segs: 16, ring: 30, gap: 0.16, seed: 21, plate: '#4d4f5c', plate2: '#5a4a48' });
  for (const w of walls) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, R - 0.6, 0, TAU, false);
    for (const [x, y, r] of w.holes) { const h = new THREE.Path(); h.absarc(x, y, r, 0, TAU, true); shape.holes.push(h); }
    const disc = new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, -w.at - 1.2);
    parts.push(paint(disc, '#3a3d48'));
    for (const [x, y, r] of w.holes) {
      parts.push(paint(new THREE.TorusGeometry(r + 0.6, 0.55, 4, 24).translate(x, y, -w.at + 1.3), '#e08a36', 0.45));
      parts.push(paint(new THREE.TorusGeometry(r + 2.2, 0.35, 3, 24).translate(x, y, -w.at + 1.3), '#2a2c33'));
    }
    // struts radiating from the hub
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; parts.push(paint(new THREE.BoxGeometry(2, R * 0.9, 2).translate(0, R * 0.45, 0).rotateZ(a).translate(0, 0, -w.at + 1.6), '#2c2f38')); }
    parts.push(paint(new THREE.CylinderGeometry(5, 5, 3.4, 8).rotateX(Math.PI / 2).translate(0, 0, -w.at + 1.5), '#585c68'));
    parts.push(paint(new THREE.CylinderGeometry(2.4, 2.4, 3.6, 8).rotateX(Math.PI / 2).translate(0, 0, -w.at + 1.7), '#ff5a3a', 0.6));
  }
  // outside: thrusters around the entrance (the stern) and a bridge tower near the far end
  for (let k = 0; k < 4; k++) {
    const a = (k + 0.5) / 4 * TAU, r = R + 11;
    parts.push(paint(new THREE.CylinderGeometry(9, 12, 34, 10).rotateX(Math.PI / 2).translate(r * Math.cos(a), r * Math.sin(a), -10), '#3a3e48'));
    parts.push(paint(new THREE.CircleGeometry(8, 10).translate(r * Math.cos(a), r * Math.sin(a), 7.1), '#1a1c22'));
  }
  parts.push(paint(new THREE.BoxGeometry(22, 12, 70).translate(0, R + 6, -len + 70), '#454956'));
  parts.push(paint(new THREE.BoxGeometry(12, 22, 18).translate(0, R + 22, -len + 60), '#3c404c'));
  parts.push(paint(new THREE.BoxGeometry(10.5, 2, 1).translate(0, R + 28, -len + 50.6), '#ffd27a', 1));
  parts.push(paint(new THREE.CylinderGeometry(0.4, 0.6, 24, 5).translate(0, R + 44, -len + 62), '#8a8f99'));
  return mergeGeometries(parts);
}

registerProp('rock', Rock);
registerProp('rubble', Rubble);
registerProp('hulk', Hulk);
registerProp('spinwreck', SpinWreck);
