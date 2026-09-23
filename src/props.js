// Level props: rings, items, rock arches, sea stacks, toppling pillars, bridges, towers and energy gates.
import * as THREE from 'three';
import { G, rand, clamp, lerp, damp, TAU, emit, Simplex2, easeInCubic, easeOutCubic } from './core.js';
import { railFrame, railToWorld, groundHeight, emissiveVertexMaterial, mergeGeometries } from './world.js';
import { FX, explode, glow, sparks, addShake, splash } from './fx.js';
import { TARGETS } from './weapons.js';
import { AudioSys } from './audio.js';
import { paint } from './enemies.js';
import { patchFog, ATMO } from './gfx.js';

const NZ = new Simplex2(31337);
function rocky(g0, amp, freq = 0.08) {
  const g = g0.index ? g0.toNonIndexed() : g0.clone();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n1 = NZ.noise(x * freq + 3.1, y * freq - z * freq * 0.7);
    const n2 = NZ.noise(z * freq * 1.3 - 5.2, x * freq * 0.9 + y * freq);
    p.setXYZ(i, x + n1 * amp, y + n2 * amp * 0.6, z + (n1 - n2) * amp * 0.8);
  }
  g.computeVertexNormals();
  return g;
}

const GEO = {};
let rockMat, metalMat, ringMats, curtainMat, itemMats;

function buildGeos() {
  // Rock arch: half torus standing across the path + legs into the sea
  const arch = new THREE.TorusGeometry(36, 8, 7, 16, Math.PI);
  const legL = new THREE.CylinderGeometry(9, 12, 34, 7, 3).translate(-36, -16, 0);
  const legR = new THREE.CylinderGeometry(9, 12, 34, 7, 3).translate(36, -16, 0);
  GEO.arch = mergeGeometries([paint(rocky(arch, 3.2, 0.06), '#8a6f5c'), paint(rocky(legL, 3, 0.07), '#7a6252'), paint(rocky(legR, 3, 0.07), '#7a6252'),
    paint(rocky(new THREE.TorusGeometry(36.5, 8.3, 5, 16, Math.PI).scale(1, 1, 0.3).translate(0, 1.5, 0), 2, 0.1), '#5f8f3a')]);
  // Sea stack
  GEO.stack = mergeGeometries([paint(rocky(new THREE.CylinderGeometry(6, 10, 110, 8, 6).translate(0, 40, 0), 3.5, 0.05), '#857060'),
    paint(rocky(new THREE.ConeGeometry(7, 8, 8).translate(0, 98, 0), 1.5, 0.2), '#5c8d38')]);
  // Toppling stone column (pivot at base)
  GEO.pillar = mergeGeometries([paint(rocky(new THREE.CylinderGeometry(4.2, 5.4, 78, 8, 8).translate(0, 39, 0), 2.2, 0.06), '#b86a3e'),
    paint(rocky(new THREE.CylinderGeometry(5.8, 5.2, 6, 8).translate(0, 79, 0), 1.2, 0.2), '#9c4f2c')]);
  // Bridge spanning the canyon (length along X = lateral)
  const deck = new THREE.BoxGeometry(320, 5, 13);
  const rails = [new THREE.BoxGeometry(320, 1.4, 0.8).translate(0, 3.2, 6.1), new THREE.BoxGeometry(320, 1.4, 0.8).translate(0, 3.2, -6.1)];
  const lights = [];
  for (let x = -150; x <= 150; x += 25) lights.push(paint(new THREE.BoxGeometry(1.2, 0.6, 14).translate(x, -2.8, 0), '#ff4a2a', 1));
  const supports = [];
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) supports.push(paint(new THREE.BoxGeometry(3, 26, 3).rotateZ(sx * (0.5 + k * 0.15)).translate(sx * (70 + k * 10), -14, 0), '#3a3e46'));
  GEO.bridge = mergeGeometries([paint(deck, '#4a4f5a'), ...rails.map(r => paint(r, '#2c3038')), ...lights, ...supports]);
  // Tower (fortress obstacle)
  const tw = [];
  tw.push(paint(new THREE.BoxGeometry(14, 1, 14).translate(0, 0.5, 0), '#3a3f4a'));
  GEO.towerCap = mergeGeometries([paint(new THREE.BoxGeometry(16, 3, 16), '#2c3039'), paint(new THREE.CylinderGeometry(0.4, 0.6, 14, 5).translate(4, 8, 4), '#8a8f99'),
    paint(new THREE.OctahedronGeometry(1.1).translate(4, 15.5, 4), '#ff2a2a', 1), paint(new THREE.BoxGeometry(16.4, 0.6, 16.4).translate(0, -1.2, 0), '#ffae2a', 1)]);
  GEO.towerBody = mergeGeometries([paint(new THREE.BoxGeometry(14, 1, 14).translate(0, 0.5, 0), '#434956')]);
  // Gate pylon
  GEO.pylon = mergeGeometries([paint(new THREE.BoxGeometry(6, 46, 6).translate(0, 23, 0), '#3c414c'), paint(new THREE.BoxGeometry(6.4, 2, 6.4).translate(0, 46, 0), '#2a2e36'),
    ...[8, 18, 28, 38].map(y => paint(new THREE.BoxGeometry(6.3, 1.2, 6.3).translate(0, y, 0), '#39e0ff', 1)),
    paint(new THREE.CylinderGeometry(2.2, 2.2, 3, 8).translate(0, 48.5, 0), '#39e0ff', 1)]);
  // Rings
  GEO.ring = new THREE.TorusGeometry(6.2, 0.6, 10, 40);
  GEO.bigRing = new THREE.TorusGeometry(14, 1.1, 10, 56);
  // Items
  GEO.itemLaser = mergeGeometries([paint(new THREE.OctahedronGeometry(1.6), '#46ff7a', 0.9), paint(new THREE.TorusGeometry(2.4, 0.22, 6, 24), '#c9ffd8', 0.6)]);
  GEO.itemBomb = mergeGeometries([paint(new THREE.CapsuleGeometry(1.1, 1.8, 4, 8).rotateZ(Math.PI / 2), '#ff5a2a', 0.5), paint(new THREE.TorusGeometry(2.4, 0.22, 6, 24), '#ffd1b0', 0.6),
    ...[0, 1, 2, 3].map(i => paint(new THREE.BoxGeometry(0.1, 1.2, 0.8).translate(0, 0.9, 0).rotateX(i * Math.PI / 2).translate(1.6, 0, 0), '#3a3e46'))]);
  GEO.itemShield = mergeGeometries([paint(new THREE.IcosahedronGeometry(1.5, 0), '#46b8ff', 0.9), paint(new THREE.TorusGeometry(2.4, 0.22, 6, 24), '#cfe9ff', 0.6)]);
}

function initMaterials() {
  rockMat = emissiveVertexMaterial({ roughness: 0.9, metalness: 0 }, 3);
  metalMat = emissiveVertexMaterial({ roughness: 0.5, metalness: 0.5 }, 4);
  itemMats = emissiveVertexMaterial({ roughness: 0.3, metalness: 0.3 }, 3);
  ringMats = {
    silver: patchFog(new THREE.MeshPhysicalMaterial({ color: '#e8eef8', metalness: 1, roughness: 0.15, clearcoat: 1, emissive: new THREE.Color('#6fa8ff'), emissiveIntensity: 0.35 })),
    gold: patchFog(new THREE.MeshPhysicalMaterial({ color: '#ffcf4a', metalness: 1, roughness: 0.18, clearcoat: 1, emissive: new THREE.Color('#ff9a1a'), emissiveIntensity: 0.55 })),
    check: patchFog(new THREE.MeshPhysicalMaterial({ color: '#7fe8ff', metalness: 0.8, roughness: 0.2, emissive: new THREE.Color('#22c8ff'), emissiveIntensity: 1.2 })),
  };
  curtainMat = new THREE.ShaderMaterial({
    uniforms: { uTime: ATMO.uTime, uAlpha: { value: 1 } },
    vertexShader: /* glsl */`varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform float uAlpha; varying vec2 vUv; varying float vD;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }
      void main(){
        float bands = sin(vUv.y * 60.0 - uTime * 12.0) * 0.5 + 0.5;
        float zig = abs(fract(vUv.x * 18.0 + sin(vUv.y * 20.0 + uTime * 6.0) * 0.3) - 0.5) * 2.0;
        float bolt = smoothstep(0.9, 1.0, zig) * step(0.5, h(floor(vec2(vUv.x * 18.0, uTime * 20.0))));
        float edge = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
        float a = (0.18 + 0.25 * bands + bolt * 1.2) * edge * uAlpha * exp(-vD * 0.0006) * smoothstep(6.0, 45.0, vD);
        gl_FragColor = vec4(vec3(0.3, 1.6, 3.2) * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ============================================================ Prop base
const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3();
export const props = [];
const schedule = [];

function orientToRail(obj, s) {
  railFrame(s, _p, _f, _r);
  obj.rotation.set(0, Math.atan2(-_f.x, -_f.z), 0);
}

class Prop {
  constructor(type, s, o) {
    this.type = type; this.s = s; this.u = o.u ?? 0; this.v = o.v ?? 0; this.o = o;
    this.t = 0; this.alive = true;
    this.root = new THREE.Group();
    railToWorld(s, 0, 0, this.root.position);   // root on the rail centre line; children offset by u in local X
    orientToRail(this.root, s);
    this.wp = railToWorld(s, this.u, this.v, new THREE.Vector3());
    G.scene.add(this.root);
    this.targets = [];
  }
  addTarget(t) { this.targets.push(t); TARGETS.add(t); }
  dispose() {
    this.alive = false;
    for (const t of this.targets) { t.alive = false; TARGETS.delete(t); }
    G.scene.remove(this.root);
  }
  // relative rail coords of the player
  rel() { const P = G.player; return { ds: G.rail.d - this.s, u: P.u - this.u, v: P.v }; }
  update(dt) {}
}

// ---------------------------------------------------------------- Rings & checkpoint
class Ring extends Prop {
  constructor(s, o) {
    super('ring', s, o);
    this.kind = o.kind || 'silver';
    const big = this.kind === 'check';
    this.R = big ? 14 : 6.2;
    this.mesh = new THREE.Mesh(big ? GEO.bigRing : GEO.ring, ringMats[this.kind]);
    this.mesh.position.set(this.u, this.v, 0);
    this.root.add(this.mesh);
    this.collected = false;
    this.prevDs = -1e9;
  }
  update(dt) {
    this.t += dt;
    this.mesh.rotation.z = this.t * (this.kind === 'gold' ? 1.4 : 0.7);
    const wp = this.wp;
    if (!this.collected) {
      const c = this.kind === 'gold' ? [4, 2.6, 0.6] : this.kind === 'check' ? [0.6, 2.6, 4] : [2.2, 2.6, 3.4];
      glow(wp, this.R * 2.4, c[0] * 0.25, c[1] * 0.25, c[2] * 0.25, 0.6);
      const r = this.rel();
      if (this.prevDs < 0 && r.ds >= 0) {
        const d = Math.hypot(r.u, r.v - this.v);
        if (d < this.R + 1.2 && G.player.alive) {
          this.collected = true;
          emit('ring', this.kind, this);
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * TAU;
            _p.set(Math.cos(a) * this.R, Math.sin(a) * this.R, 0).applyEuler(this.root.rotation).add(wp);
            FX.add.spawn(_p.x, _p.y, _p.z, (_p.x - wp.x) * 3, (_p.y - wp.y) * 3, (_p.z - wp.z) * 3, 0.6, 1.2, 0.2, [c[0], c[1], c[2], 1], [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3, 0], 2, { drag: 2 });
          }
        }
      }
      this.prevDs = r.ds;
    } else {
      this.mesh.scale.multiplyScalar(1 + dt * 3);
      this.fade = (this.fade ?? 1) - dt * 2.5;
      if (this.fade <= 0) this.mesh.visible = false;
    }
  }
}

// ---------------------------------------------------------------- Items (floating power-ups)
export class Item extends Prop {
  constructor(s, o) {
    super('item', s, o);
    this.kind = o.kind || 'laser';
    const g = this.kind === 'laser' ? GEO.itemLaser : this.kind === 'bomb' ? GEO.itemBomb : GEO.itemShield;
    this.mesh = new THREE.Mesh(g, itemMats);
    this.mesh.position.set(this.u, this.v, 0);
    this.root.add(this.mesh);
    this.hold = o.hold ?? 0; // follow the player forward for a while (dropped items)
  }
  update(dt) {
    this.t += dt;
    if (this.hold > 0) { this.hold -= dt; this.s = G.rail.d + Math.max(35, (this.o.ahead ?? 80) - this.t * 20); railToWorld(this.s, 0, 0, this.root.position); orientToRail(this.root, this.s); }
    this.mesh.rotation.y = this.t * 2.2;
    this.mesh.position.y = this.v + Math.sin(this.t * 3) * 0.6;
    const wp = railToWorld(this.s, this.u, this.mesh.position.y, _v);
    const c = this.kind === 'laser' ? [0.5, 3, 1] : this.kind === 'bomb' ? [3, 1, 0.4] : [0.6, 1.6, 3.4];
    glow(wp, 9 + Math.sin(this.t * 6), c[0] * 0.4, c[1] * 0.4, c[2] * 0.4, 0.8);
    const P = G.player;
    if (P.alive && P.pos.distanceTo(wp) < 7.5) {
      emit('item', this.kind, this);
      sparks(wp, null, 20, c, 30, 1);
      this.dispose();
    }
  }
}

// ---------------------------------------------------------------- Rock arch
class Arch extends Prop {
  constructor(s, o) {
    super('arch', s, o);
    this.mesh = new THREE.Mesh(GEO.arch, rockMat);
    this.mesh.position.x = this.u;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.root.add(this.mesh);
  }
  update(dt) {
    const r = this.rel();
    if (Math.abs(r.ds) < 10) {
      const d = Math.hypot(r.u, r.v);
      const inTube = Math.abs(d - 36) < 8.5 + 1.5 && r.v > -2;
      const inLeg = Math.abs(Math.abs(r.u) - 36) < 11 && r.v < 2;
      if ((inTube || inLeg) && G.player.alive) hitObstacle(r.u > 0 ? -1 : 1, d < 36 ? -1 : 1);
    }
  }
}

// ---------------------------------------------------------------- Sea stack
class Stack extends Prop {
  constructor(s, o) {
    super('stack', s, o);
    this.mesh = new THREE.Mesh(GEO.stack, rockMat);
    this.mesh.position.set(this.u, -12, 0);
    this.mesh.scale.setScalar(o.scale ?? 1);
    this.mesh.rotation.y = rand(0, TAU);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.root.add(this.mesh);
    this.rad = 8 * (o.scale ?? 1);
  }
  update(dt) {
    const r = this.rel();
    if (Math.abs(r.ds) < this.rad + 2 && Math.hypot(r.ds, r.u) < this.rad + 2 && G.player.alive) hitObstacle(r.u > 0 ? 1 : -1, 0);
  }
}

// ---------------------------------------------------------------- Toppling pillar (canyon)
class Pillar extends Prop {
  constructor(s, o) {
    super('pillar', s, o);
    this.side = o.side ?? 1;
    this.pivot = new THREE.Group();
    railToWorld(s, this.u, 0, _p);
    this.pivot.position.set(this.u, Math.max(-4, groundHeight(_p.x, _p.z)) - 1, 0);
    this.mesh = new THREE.Mesh(GEO.pillar, rockMat);
    this.mesh.castShadow = true;
    this.pivot.add(this.mesh);
    this.root.add(this.pivot);
    this.angle = 0; this.falling = false; this.fallT = 0; this.maxAngle = o.maxAngle ?? 1.12;
    this.hp = 14;
    const self = this;
    this.target = {
      pos: new THREE.Vector3(), radius: 7, alive: true, lockable: true, hittable: true,
      hit(dmg) { if (!self.alive) return 'none'; self.hp -= dmg; self.flash = 1; if (self.hp <= 0) { self.shatter(); return 'kill'; } return 'hit'; },
    };
    this.addTarget(this.target);
  }
  shatter() {
    this.target.alive = false;
    const top = _v.set(0, 40, 0).applyMatrix4(this.mesh.matrixWorld);
    for (let i = 0; i < 4; i++) explode(_p.set(0, 12 + i * 18, 0).applyMatrix4(this.mesh.matrixWorld), 1.6, { debris: 6 });
    AudioSys.sfx('explodeL');
    addShake(0.5);
    emit('propDestroyed', this, top.clone());
    this.dispose();
  }
  update(dt) {
    this.t += dt;
    const r = this.rel();
    if (!this.falling && r.ds > -(this.o.trigger ?? 420)) { this.falling = true; AudioSys.sfx('gateClose', { vol: 0.7 }); }
    if (this.falling && this.angle < this.maxAngle) {
      this.fallT += dt;
      this.angle = Math.min(this.maxAngle, easeInCubic(this.fallT / 1.9) * this.maxAngle);
      if (this.angle >= this.maxAngle) { addShake(0.4); AudioSys.sfx('explodeM', { vol: 0.8, pitch: 0.6 }); sparks(_v.set(0, 70, 0).applyMatrix4(this.mesh.matrixWorld), null, 20, [4, 3, 2], 20, 1); }
    }
    this.pivot.rotation.z = this.angle * this.side;
    this.mesh.updateMatrixWorld(true);
    this.target.pos.set(0, 36, 0).applyMatrix4(this.mesh.matrixWorld);
    // capsule collision in rail-local (u,v): from base to tip
    if (Math.abs(r.ds) < 7 && G.player.alive) {
      const bu = this.u, bv = this.pivot.position.y;
      const tu = bu - Math.sin(this.angle * this.side) * 80, tv = bv + Math.cos(this.angle) * 80;
      const d = distToSeg2(G.player.u - 0, G.player.v, bu, bv, tu, tv);
      if (d < 6.5) hitObstacle(G.player.u > (bu + tu) / 2 ? 1 : -1, 1);
    }
  }
}

function distToSeg2(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(ax + vx * t - px, ay + vy * t - py);
}

// ---------------------------------------------------------------- Bridge
class Bridge extends Prop {
  constructor(s, o) {
    super('bridge', s, o);
    this.mesh = new THREE.Mesh(GEO.bridge, metalMat);
    this.mesh.position.set(this.u, o.v ?? 30, 0);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.root.add(this.mesh);
    this.h = o.v ?? 30;
  }
  update(dt) {
    const r = this.rel();
    if (Math.abs(r.ds) < 8 && r.v > this.h - 4.5 && r.v < this.h + 4.5 && G.player.alive) hitObstacle(0, r.v > this.h ? 1 : -1);
  }
}

// ---------------------------------------------------------------- Tower
const towerBodyMat = () => {
  // reuse building window shader from world decorations via a dedicated material instance
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45 });
  patchFog(m, (shader) => {
    shader.uniforms.uTime = ATMO.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vLN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n{ vec4 wp4 = vec4(transformed,1.0); vWP = (modelMatrix * wp4).xyz; vLN = normal; }');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vLN; uniform float uTime;\nfloat bh2(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 an = abs(vLN); vec2 wc = an.x > 0.5 ? vWP.zy : (an.z > 0.5 ? vWP.xy : vec2(0.0));
          if (an.y < 0.5) { vec2 cell = floor(wc / vec2(2.8, 3.6)); vec2 f = fract(wc / vec2(2.8, 3.6));
            float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.72);
            float on = step(0.4, bh2(cell)); vec3 wcol = mix(vec3(1.0, 0.6, 0.28), vec3(0.35, 0.85, 1.0), step(0.75, bh2(cell + 3.0)));
            totalEmissiveRadiance += wcol * win * on * 1.8; } }`);
  });
  return m;
};
let _towerMat = null;
class Tower extends Prop {
  constructor(s, o) {
    super('tower', s, o);
    if (!_towerMat) _towerMat = towerBodyMat();
    this.h = o.h ?? 80;
    this.body = new THREE.Mesh(new THREE.BoxGeometry(14, this.h, 14).translate(0, this.h / 2, 0), _towerMat);
    this.body.castShadow = true; this.body.receiveShadow = true;
    railToWorld(s, this.u, 0, _p);
    const gy = groundHeight(_p.x, _p.z);
    this.base = gy;
    this.body.position.set(this.u, gy, 0);
    this.cap = new THREE.Mesh(GEO.towerCap, metalMat);
    this.cap.position.set(this.u, gy + this.h + 1.5, 0);
    this.root.add(this.body, this.cap);
  }
  update(dt) {
    const r = this.rel();
    if (Math.abs(r.ds) < 9 && Math.abs(r.u) < 9 && r.v < this.base + this.h + 3 && G.player.alive) hitObstacle(r.u > 0 ? 1 : -1, 0);
  }
}

// ---------------------------------------------------------------- Energy gate
class Gate extends Prop {
  constructor(s, o) {
    super('gate', s, o);
    this.w = o.w ?? 30;
    this.pylons = [];
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(GEO.pylon, emissiveVertexMaterial({ roughness: 0.5, metalness: 0.5 }, 3.5));
      railToWorld(s, this.u + sx * this.w, 0, _p);
      m.position.set(this.u + sx * this.w, Math.max(0, groundHeight(_p.x, _p.z)), 0);
      m.castShadow = true;
      this.root.add(m);
      const self = this;
      const tgt = {
        pos: new THREE.Vector3(), radius: 5, alive: true, lockable: true, hittable: true, hp: 7, mesh: m,
        hit(dmg) { if (!tgt.alive) return 'none'; tgt.hp -= dmg; m.material.userData.flash.value = 1; if (tgt.hp <= 0) { self.destroyPylon(tgt); return 'kill'; } return 'hit'; },
      };
      this.pylons.push(tgt);
      this.addTarget(tgt);
    }
    this.curtain = new THREE.Mesh(new THREE.PlaneGeometry(this.w * 2 - 6, 44).translate(0, 24, 0), curtainMat.clone());
    this.curtain.material.uniforms.uTime = ATMO.uTime;
    this.curtain.position.x = this.u;
    this.root.add(this.curtain);
    this.active = true;
    this.hitDone = false;
  }
  destroyPylon(t) {
    t.alive = false;
    t.mesh.visible = false;
    explode(t.pos, 2.2);
    AudioSys.sfx('explodeL');
    emit('propDestroyed', this, t.pos.clone());
    if (this.active) { this.active = false; AudioSys.sfx('gateClose', { pitch: 1.4 }); }
  }
  update(dt) {
    for (const t of this.pylons) {
      if (t.alive) t.pos.set(0, 30, 0).applyMatrix4(t.mesh.matrixWorld);
      t.mesh.material.userData.flash.value = Math.max(0, t.mesh.material.userData.flash.value - dt * 5);
    }
    const u = this.curtain.material.uniforms.uAlpha;
    u.value = damp(u.value, this.active ? 1 : 0, 6, dt);
    this.curtain.visible = u.value > 0.02;
    const r = this.rel();
    if (Math.abs(r.ds) < 3 && G.player.alive) {
      if (Math.abs(r.u) > this.w - 3.5 && Math.abs(r.u) < this.w + 3.5 && r.v < 48) hitObstacle(r.u > 0 ? 1 : -1, 0);
      else if (this.active && !this.hitDone && Math.abs(r.u) < this.w && r.v < 46) {
        this.hitDone = true;
        G.player.damage(16);
        sparks(G.player.pos, null, 30, [1, 4, 7], 40, 1);
        AudioSys.sfx('crash', { pitch: 1.5 });
      }
    }
  }
}

// ---------------------------------------------------------------- Obstacle hit response
let obstacleCool = 0;
function hitObstacle(pushU, pushV) {
  const P = G.player;
  if (obstacleCool > 0) return;
  obstacleCool = 0.5;
  if (pushU) { P.vu = pushU * 30; P.u += pushU * 2; }
  if (pushV) { P.vv = pushV * 25; P.v += pushV * 2; }
  P.damage(15, true);
  sparks(P.pos, null, 24, [6, 4, 2], 35, 1);
  AudioSys.sfx('crash');
  addShake(0.6);
}

// ============================================================ Manager
const TYPES = { ring: Ring, item: Item, arch: Arch, stack: Stack, pillar: Pillar, bridge: Bridge, tower: Tower, gate: Gate };

export function initProps() { buildGeos(); initMaterials(); }

export function scheduleProp(type, s, o = {}) { schedule.push({ type, s, o, spawned: false }); }
export function clearSchedule() { schedule.length = 0; }

export function spawnProp(type, s, o = {}) {
  const p = new TYPES[type](s, o);
  props.push(p);
  return p;
}

export function updateProps(dt) {
  obstacleCool = Math.max(0, obstacleCool - dt);
  const d = G.rail.d;
  for (const it of schedule) {
    if (!it.spawned && d > it.s - 2700 && d < it.s + 40) { it.spawned = true; spawnProp(it.type, it.s, it.o); }
  }
  for (let i = props.length - 1; i >= 0; i--) {
    const p = props[i];
    if (!p.alive) { props.splice(i, 1); continue; }
    p.update(dt);
    if (p.s < d - 120) { p.dispose(); props.splice(i, 1); }
  }
}

export function resetProps(fromD) {
  for (const p of props) p.dispose();
  props.length = 0;
  for (const it of schedule) it.spawned = it.s < fromD;
}
