// Player ship "LN-01 LANCER": procedural model, flight controls, damage and the chase camera.
import * as THREE from 'three';
import { G, clamp, lerp, damp, smoothstep, rand, TAU, emit, diff, easeInOutCubic } from './core.js';
import { Input } from './input.js';
import { railFrame, groundHeight } from './world.js';
import { FX, Trail, glow, sparks, splash, addShake, speedLines, explode } from './fx.js';
import { patchFog, TEX, POST } from './gfx.js';
import { AudioSys } from './audio.js';

// ============================================================ Geometry helpers
function sect(w, h, yOff = 0, belly = 1) {
  return [[w, 0], [w * 0.72, h * 0.72], [0, h], [-w * 0.72, h * 0.72], [-w, 0], [-w * 0.74, -h * 0.55 * belly], [0, -h * 0.72 * belly], [w * 0.74, -h * 0.55 * belly]]
    .map(([x, y]) => [x, y + yOff]);
}

export function loft(sections) {
  const N = sections[0].pts.length;
  const pos = [];
  const P = (s, i) => [s.pts[i][0], s.pts[i][1], s.z];
  for (let k = 0; k < sections.length - 1; k++) {
    const A = sections[k], B = sections[k + 1];
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      const a0 = P(A, i), a1 = P(A, i2), b0 = P(B, i), b1 = P(B, i2);
      pos.push(...a0, ...b1, ...b0, ...a0, ...a1, ...b1);
    }
  }
  const cap = (s, front) => {
    let cx = 0, cy = 0;
    for (const p of s.pts) { cx += p[0]; cy += p[1]; }
    cx /= N; cy /= N;
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      const c = [cx, cy, s.z], p = P(s, i), q = P(s, i2);
      if (front) pos.push(...c, ...q, ...p); else pos.push(...c, ...p, ...q);
    }
  };
  cap(sections[0], true);
  cap(sections[sections.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function mirrorX(g) {
  const m = g.index ? g.toNonIndexed() : g.clone();
  m.scale(-1, 1, 1);
  const p = m.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  m.deleteAttribute('normal');
  m.computeVertexNormals();
  return m;
}

// Planform (sx = span, sy = forward) → thin horizontal slab. Forward (+sy) maps to -Z.
export function slab(pts, thick, bevel = 0) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -thick / 2, 0);
  return g.index ? g.toNonIndexed() : g;
}

// Profile (a = backward along +Z, b = up) → thin vertical fin (thickness along X).
export function fin(pts, thick) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, steps: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(thick / 2, 0, 0);
  return g.index ? g.toNonIndexed() : g;
}

function mergeGeos(list) {
  const geos = list.map(g => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
    return n;
  });
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const arr = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) { arr.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

// ============================================================ Ship model
export const SCHEMES = {
  player:   { hull: '#e9eef6', accent: '#2f6bff', accent2: '#ff7a1e', glow: '#6fd0ff', stripe: '#2f6bff' },
  kota:     { hull: '#f1ece6', accent: '#ff7a2a', accent2: '#3fc46a', glow: '#ffb070', stripe: '#ff7a2a' },
  gantetsu: { hull: '#d9dccf', accent: '#6f8a3a', accent2: '#e0b040', glow: '#c8ff9a', stripe: '#6f8a3a' },
  rio:      { hull: '#e6f0f2', accent: '#18b3a0', accent2: '#2a3d8f', glow: '#7ffff0', stripe: '#18b3a0' },
};

const flameMatCache = new Map();
function flameMaterial(hex) {
  if (flameMatCache.has(hex)) return flameMatCache.get(hex);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(hex) }, uPower: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uColor; uniform float uPower;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float t = vUv.y;            // 0 at nozzle, 1 at tip
        float core = pow(abs(dot(vN, vV)), 1.5);
        float n = n2(vec2(vUv.x * 8.0, t * 5.0 - uTime * 22.0));
        float a = pow(1.0 - t, 1.6) * (0.65 + 0.35 * n) * core;
        vec3 c = mix(uColor, vec3(1.0), pow(1.0 - t, 6.0) * 0.8);
        gl_FragColor = vec4(c * a * 1.7 * uPower, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  flameMatCache.set(hex, m);
  return m;
}

export function buildShipModel(schemeName = 'player') {
  const S = SCHEMES[schemeName];
  const mats = {
    hull: patchFog(new THREE.MeshPhysicalMaterial({ color: S.hull, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18 })),
    accent: patchFog(new THREE.MeshPhysicalMaterial({ color: S.accent, metalness: 0.35, roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.4, envMapIntensity: 0.55 })),
    accent2: patchFog(new THREE.MeshPhysicalMaterial({ color: S.accent2, metalness: 0.4, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.35 })),
    dark: patchFog(new THREE.MeshStandardMaterial({ color: '#252a34', metalness: 0.7, roughness: 0.5 })),
    glass: patchFog(new THREE.MeshPhysicalMaterial({ color: '#081626', metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, emissive: new THREE.Color('#0b3a5c'), emissiveIntensity: 0.9, envMapIntensity: 1.6 })),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(S.glow).multiplyScalar(1.5), fog: false }),
  };
  const parts = { hull: [], accent: [], accent2: [], dark: [], glass: [], glow: [] };

  // Fuselage
  const F = [
    [-5.7, 0.05, 0.05, -0.04], [-4.5, 0.34, 0.28, -0.03], [-3.0, 0.58, 0.46, 0.0], [-1.4, 0.8, 0.62, 0.05],
    [0.4, 0.95, 0.72, 0.05], [2.1, 0.88, 0.62, 0.02], [3.5, 0.62, 0.46, 0.0], [4.25, 0.46, 0.36, 0.0],
  ].map(([z, w, h, y]) => ({ z, pts: sect(w, h, y) }));
  parts.hull.push(loft(F));
  // Belly keel (dark)
  const K = [[-3.2, 0.28, 0.12, -0.42], [-0.5, 0.5, 0.18, -0.55], [2.6, 0.42, 0.14, -0.48], [3.8, 0.2, 0.08, -0.36]]
    .map(([z, w, h, y]) => ({ z, pts: sect(w, h, y) }));
  parts.dark.push(loft(K));
  // Canopy
  parts.glass.push(new THREE.SphereGeometry(1, 16, 8, 0, TAU, 0, Math.PI / 2).scale(0.5, 0.56, 1.75).translate(0, 0.48, -1.35));
  // Main wings (leading-edge strip in accent colour + white main panel)
  const lead = [[0.6, 1.0], [5.3, -1.6], [5.36, -1.98], [0.6, 0.52]];
  const main = [[0.6, 0.52], [5.36, -1.98], [5.62, -2.72], [0.6, -2.85]];
  const wingT = new THREE.Matrix4().makeRotationZ(-0.09).setPosition(0, -0.08, 0);
  const wl = slab(lead, 0.16).applyMatrix4(wingT), wm = slab(main, 0.16).applyMatrix4(wingT);
  parts.accent.push(wl, mirrorX(wl));
  parts.hull.push(wm, mirrorX(wm));
  // Winglets
  const wlt = fin([[0, 0], [1.5, 0], [1.75, 1.25], [1.15, 1.3]], 0.1);
  const wltR = wlt.clone().applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.36)).translate(5.52, -0.56, 1.45);
  parts.accent.push(wltR, mirrorX(wltR));
  // Canards
  const can = slab([[0.42, 3.45], [1.65, 2.72], [1.65, 2.42], [0.42, 2.5]], 0.08).translate(0, 0.02, 0);
  parts.accent2.push(can, mirrorX(can));
  // Twin tail fins
  const tf = fin([[0, 0], [1.9, 0], [2.3, 1.55], [1.65, 1.6]], 0.1);
  const tfR = tf.clone().applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.32)).translate(0.5, 0.42, 1.9);
  parts.accent.push(tfR, mirrorX(tfR));
  // Engine nacelles
  for (const sx of [-1, 1]) {
    const nac = new THREE.CylinderGeometry(0.32, 0.42, 4.3, 10).rotateX(Math.PI / 2).translate(1.08 * sx, -0.12, 2.0);
    parts.hull.push(nac);
    parts.dark.push(new THREE.TorusGeometry(0.32, 0.07, 6, 12).translate(1.08 * sx, -0.12, 4.15));
    parts.dark.push(new THREE.CircleGeometry(0.4, 10).rotateY(Math.PI).translate(1.08 * sx, -0.12, -0.16));
    parts.glow.push(new THREE.CircleGeometry(0.27, 12).translate(1.08 * sx, -0.12, 4.16));
    // wingtip cannons
    parts.dark.push(new THREE.CylinderGeometry(0.075, 0.09, 1.7, 6).rotateX(Math.PI / 2).translate(5.36 * sx, -0.5, 0.95));
    // nav light
  }
  // Stripe on fuselage top (accent) – a thin lofted strip
  const strip = [[-4.3, 0.1, 0.02, 0.27], [-3.0, 0.14, 0.02, 0.47], [-2.3, 0.14, 0.02, 0.56]].map(([z, w, h, y]) => ({ z, pts: sect(w, h, y) }));
  parts.accent.push(loft(strip));

  const group = new THREE.Group();
  const meshes = {};
  for (const k in parts) {
    if (!parts[k].length) continue;
    const m = new THREE.Mesh(mergeGeos(parts[k]), mats[k]);
    m.castShadow = k !== 'glow';
    m.receiveShadow = false;
    group.add(m);
    meshes[k] = m;
  }
  // Flames
  const flames = [];
  for (const sx of [-1, 1]) {
    const cone = new THREE.ConeGeometry(0.3, 1, 12, 1, true);
    cone.translate(0, -0.5, 0);           // tip at y = -1, base at y = 0
    cone.rotateX(-Math.PI / 2);           // base at z = 0, tip toward +Z
    // uv.y: cone uv.y is 1 at base(top originally)... remap so 0 = nozzle
    const uv = cone.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const f = new THREE.Mesh(cone, flameMaterial(S.glow));
    f.position.set(1.08 * sx, -0.12, 4.2);
    f.scale.set(1, 1, 2.2);
    f.renderOrder = 18;
    f.frustumCulled = false;
    group.add(f);
    flames.push(f);
  }
  return {
    group, meshes, mats, flames, scheme: S,
    nozzles: [new THREE.Vector3(-1.08, -0.12, 4.3), new THREE.Vector3(1.08, -0.12, 4.3)],
    tips: [new THREE.Vector3(-5.65, -0.55, 2.4), new THREE.Vector3(5.65, -0.55, 2.4)],
    guns: { nose: new THREE.Vector3(0, -0.05, -5.9), left: new THREE.Vector3(-5.36, -0.5, 0.0), right: new THREE.Vector3(5.36, -0.5, 0.0) },
  };
}

// ============================================================ Shield bubble
function makeShield() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uColor: { value: new THREE.Color(0.4, 0.9, 1.6) }, uHex: { value: TEX.hex } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform float uAmt; uniform vec3 uColor; uniform sampler2D uHex;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); float hx = texture2D(uHex, vUv * vec2(6.0, 3.0) + vec2(uTime * 0.2, 0.0)).r;
        float a = (f * 0.9 + hx * 0.35 * (0.4 + f)) * uAmt; gl_FragColor = vec4(uColor * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
  m.scale.set(6.4, 2.6, 6.6);
  m.renderOrder = 23;
  m.visible = false;
  return m;
}

// ============================================================ Player ship
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _back = new THREE.Vector3();
const YUP = new THREE.Vector3(0, 1, 0);

export const LIMITS = { u: 46, vMin: 2.6, vMax: 58 };

export class PlayerShip {
  constructor() {
    this.model = buildShipModel('player');
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.pivot.add(this.model.group);
    this.shield = makeShield();
    this.root.add(this.shield);
    G.scene.add(this.root);
    // blob shadow on water
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: TEX.shadow, transparent: true, depthWrite: false, fog: false }));
    this.blob.renderOrder = 1;
    G.scene.add(this.blob);
    this.trails = [
      new Trail(10, 0.16, [1, 1, 1], 0.45, false), new Trail(10, 0.16, [1, 1, 1], 0.45, false),
      new Trail(12, 0.3, [0.35, 0.75, 1.6], 0.45, true), new Trail(12, 0.3, [0.35, 0.75, 1.6], 0.45, true),
    ];
    this.pos = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.rightV = new THREE.Vector3(1, 0, 0);
    this.railPos = new THREE.Vector3(); this.railFwd = new THREE.Vector3(); this.railRight = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.reset();
  }

  reset(u = 0, v = 22) {
    this.u = u; this.v = v; this.vu = 0; this.vv = 0;
    this.bank = 0; this.yaw = 0; this.pitch = 0;
    this.rollT = 0; this.rollDir = 0; this.rollAngle = 0; this.rollCool = 0;
    this.tilt = 0;
    this.heat = 0; this.overheat = false; this.speedMul = 1; this.boostAmt = 0; this.brakeAmt = 0;
    this.boosting = false; this.braking = false;
    this.invuln = 0; this.blink = 0; this.alive = true; this.dying = 0; this.deathSpin = 0;
    this.shieldFx = 0; this.smokeT = 0; this.scrapeT = 0;
    this.controllable = true;
    this.autoPilot = null;
    this.root.visible = true;
    this.model.group.visible = true;
    this.firstFrame = true;
  }

  get rolling() { return this.rollT > 0; }

  startRoll(dir) {
    if (this.rollT > 0 || this.rollCool > 0) return;
    this.rollDir = dir; this.rollT = 0.55; this.rollAngle = 0;
    AudioSys.sfx('roll', { pan: dir * 0.3 });
  }

  // ---------------------------------------------------------- update
  update(dt) {
    const run = G.run;
    railFrame(G.rail.d, this.railPos, this.railFwd, this.railRight);
    if (this.dying > 0) { this.updateDying(dt); return; }

    // ---- input → target velocities
    let ix = 0, iy = 0, boostHeld = false, brakeHeld = false;
    if (this.controllable) {
      ix = Input.x; iy = Input.y;
      boostHeld = Input.held('boost'); brakeHeld = Input.held('brake');
      const touch = Input.device === 'touch';
      if (Input.double('rollL') || (touch && Input.pressed('rollL'))) this.startRoll(1);
      else if (Input.double('rollR') || (touch && Input.pressed('rollR'))) this.startRoll(-1);
      const tiltTarget = (Input.held('rollL') ? 1 : 0) - (Input.held('rollR') ? 1 : 0);
      this.tilt = damp(this.tilt, tiltTarget, 10, dt);
    } else if (this.autoPilot) {
      const ap = this.autoPilot;
      ix = clamp((ap.u - this.u) / 12, -1, 1); iy = clamp((ap.v - this.v) / 10, -1, 1);
      this.tilt = damp(this.tilt, 0, 6, dt);
    } else this.tilt = damp(this.tilt, 0, 6, dt);

    // ---- boost / brake heat model
    if (this.overheat) { boostHeld = brakeHeld = false; if (this.heat <= 0.001) this.overheat = false; }
    const wasBoost = this.boosting, wasBrake = this.braking;
    this.boosting = boostHeld && !brakeHeld;
    this.braking = brakeHeld && !boostHeld;
    if (this.boosting || this.braking) {
      this.heat = Math.min(1, this.heat + dt * 0.52);
      if (this.heat >= 1) { this.overheat = true; this.boosting = this.braking = false; }
    } else this.heat = Math.max(0, this.heat - dt * (this.overheat ? 0.42 : 0.55));
    if (this.boosting && !wasBoost) { AudioSys.sfx('boost'); addShake(0.12); }
    if (this.braking && !wasBrake) AudioSys.sfx('brake');
    this.boostAmt = damp(this.boostAmt, this.boosting ? 1 : 0, this.boosting ? 5 : 3, dt);
    this.brakeAmt = damp(this.brakeAmt, this.braking ? 1 : 0, 5, dt);
    this.speedMul = 1 + this.boostAmt * 0.8 - this.brakeAmt * 0.45;

    // ---- lateral / vertical motion
    // Holding a tilt (Q/E) banks hard: drift toward that side and turn sharper when steering into it.
    const intoTilt = Math.abs(this.tilt) > 0.2 && ix !== 0 && Math.sign(ix) === -Math.sign(this.tilt);
    const tvu = ix * 48 * (intoTilt ? 1 + Math.abs(this.tilt) * 0.55 : 1) - this.tilt * 16;
    const tvv = iy * 36;
    this.vu = damp(this.vu, tvu, 5.5, dt);
    this.vv = damp(this.vv, tvv, 5.5, dt);
    this.u += this.vu * dt;
    this.v += this.vv * dt;
    if (this.u > LIMITS.u) { this.u = LIMITS.u; this.vu = Math.min(this.vu, 0); }
    if (this.u < -LIMITS.u) { this.u = -LIMITS.u; this.vu = Math.max(this.vu, 0); }
    if (this.v > LIMITS.vMax) { this.v = LIMITS.vMax; this.vv = Math.min(this.vv, 0); }
    if (this.v < LIMITS.vMin) { this.v = LIMITS.vMin; this.vv = Math.max(this.vv, 0); }

    // ---- barrel roll
    if (this.rollT > 0) {
      this.rollT -= dt;
      const k = 1 - Math.max(0, this.rollT) / 0.55;
      this.rollAngle = easeInOutCubic(k) * TAU * this.rollDir;
      if (this.rollT <= 0) { this.rollAngle = 0; this.rollCool = 0.12; }
    } else this.rollCool = Math.max(0, this.rollCool - dt);

    // ---- attitude
    const nu = this.vu / 48, nv = this.vv / 36;
    this.yaw = damp(this.yaw, -nu * 0.36, 8, dt);
    this.pitch = damp(this.pitch, nv * 0.3, 8, dt);
    const bankT = -nu * 0.78 + this.tilt * 1.45;
    this.bank = damp(this.bank, bankT, 7, dt);

    // ---- world transform
    this.computePos(this.pos);
    _back.copy(this.railFwd).negate();
    _m.makeBasis(this.railRight, YUP, _back);
    _q.setFromRotationMatrix(_m);
    _e.set(this.pitch, this.yaw, this.bank + this.rollAngle, 'YXZ');
    _q2.setFromEuler(_e);
    this.quat.copy(_q).multiply(_q2);
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.rightV.set(1, 0, 0).applyQuaternion(this.quat);
    // shield bubble should not roll wildly: counter-rotate a bit
    this.shield.quaternion.identity();

    // ---- terrain collision
    this.checkGround(dt);

    // ---- invulnerability blink
    if (this.invuln > 0) {
      this.invuln -= dt;
      this.blink += dt;
      this.model.group.visible = this.invuln <= 0 || (Math.floor(this.blink * 18) % 2 === 0);
    } else this.model.group.visible = true;

    this.updateVisuals(dt);
    this.firstFrame = false;
  }

  computePos(out) {
    return out.copy(this.railPos).addScaledVector(this.railRight, this.u).setY(this.v);
  }

  checkGround(dt) {
    this.scrapeT -= dt;
    const gh = groundHeight(this.pos.x, this.pos.z);
    const clearance = this.pos.y - gh;
    if (gh > -0.5 && clearance < 1.9) {
      // Steep lateral slope → wall: push sideways. Otherwise → ground: lift up.
      const hL = groundHeight(this.pos.x - this.railRight.x * 3, this.pos.z - this.railRight.z * 3);
      const hR = groundHeight(this.pos.x + this.railRight.x * 3, this.pos.z + this.railRight.z * 3);
      const slope = (hR - hL) / 6;
      if (Math.abs(slope) > 0.6) {
        this.u -= Math.sign(slope) * Math.min(4, 2.4 - clearance * 0.1);
        this.vu = -Math.sign(slope) * 28;
      } else {
        this.v = Math.min(gh + 2.2, this.v + 7);
        this.vv = Math.max(this.vv, 16);
      }
      if (this.scrapeT <= 0) {
        this.scrapeT = 0.35;
        AudioSys.sfx('crash');
        sparks(this.pos.clone().setY(gh + 0.8), new THREE.Vector3(0, 1, 0), 18, [6, 4, 2], 30, 1);
        addShake(0.35);
        if (this.invuln <= 0) this.damage(9, true);
      }
    }
    // water skim spray
    if (gh < 0 && this.pos.y < 7 && this.dying <= 0) {
      if (Math.random() < 0.9) {
        const k = 1 - this.pos.y / 7;
        const bx = this.pos.x + rand(-2, 2), bz = this.pos.z + rand(0, 4);
        FX.smoke.spawn(bx, 0.3, bz, rand(-4, 4), rand(4, 11) * k, rand(4, 14), 0.9, 1.2, 4.5, [0.95, 0.97, 1, 0.6 * k], [0.9, 0.93, 0.97, 0], 1, { grav: 16, fadeIn: 0.04 });
      }
    }
  }

  damage(amount, terrain = false) {
    if (!this.alive || this.dying > 0) return false;
    if (this.invuln > 0 && !terrain) return false;
    const run = G.run;
    const amt = amount * diff().dmg;
    run.shield = Math.max(0, run.shield - amt);
    run.damageTaken += amt;
    this.invuln = terrain ? 0.6 : 1.1;
    this.blink = 0;
    POST.damage = Math.min(1, POST.damage + 0.55 + amt / 40);
    POST.ca = 0.012;
    addShake(0.45 + amt / 40);
    AudioSys.sfx('playerHit');
    AudioSys.duckMusic(0.35, 0.4);
    sparks(this.pos, null, 16, [7, 3.5, 1.5], 36, 1);
    emit('playerDamaged', amt);
    if (run.shield <= 0) this.die();
    return true;
  }

  die() {
    if (this.dying > 0) return;
    this.dying = 2.2;
    this.alive = false;
    this.controllable = false;
    this.deathSpin = (Math.random() < 0.5 ? -1 : 1) * 6;
    AudioSys.sfx('explodeM');
    explode(this.pos, 1.2, { water: false });
    emit('playerDying');
  }

  updateDying(dt) {
    this.dying -= dt;
    this.vv -= 30 * dt;
    this.v += this.vv * dt;
    this.u += this.vu * dt;
    this.bank += this.deathSpin * dt;
    this.pitch = damp(this.pitch, -0.6, 2, dt);
    this.computePos(this.pos);
    _back.copy(this.railFwd).negate();
    _m.makeBasis(this.railRight, YUP, _back);
    _q.setFromRotationMatrix(_m);
    _e.set(this.pitch, this.yaw, this.bank, 'YXZ');
    _q2.setFromEuler(_e);
    this.quat.copy(_q).multiply(_q2);
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.03;
      FX.add.spawn(this.pos.x, this.pos.y, this.pos.z, rand(-2, 2), rand(-1, 3), rand(-2, 2), 0.4, 1.5, 3.5, [4, 1.8, 0.5, 1], [1, 0.2, 0, 0], 1);
      FX.smoke.spawn(this.pos.x, this.pos.y, this.pos.z, rand(-2, 2), rand(1, 4), rand(4, 10), 1.8, 2, 7, [0.12, 0.11, 0.12, 0.8], [0.3, 0.3, 0.32, 0], 1, { fadeIn: 0.06 });
    }
    const gh = Math.max(0, groundHeight(this.pos.x, this.pos.z));
    if (this.dying <= 0 || this.pos.y < gh + 1) {
      this.dying = 0;
      explode(this.pos, 2.4);
      AudioSys.sfx('explodeL');
      this.root.visible = false;
      this.blob.visible = false;
      for (const t of this.trails) t.visible = false;
      emit('playerDead');
    }
    for (const t of this.trails) t.intensity = 0;
  }

  updateVisuals(dt) {
    const run = G.run;
    const t = G.time;
    // engine flames
    const power = 0.75 + this.boostAmt * 0.9 - this.brakeAmt * 0.45 + Math.sin(t * 60) * 0.05;
    for (const f of this.model.flames) {
      f.scale.z = lerp(f.scale.z, 1.6 + this.boostAmt * 3.2 - this.brakeAmt * 1.0, 0.3);
      f.scale.x = f.scale.y = 0.9 + this.boostAmt * 0.3;
      f.material.uniforms.uTime.value = t;
      f.material.uniforms.uPower.value = power;
    }
    if (!this.model.group.visible) return;
    // nozzle glows & wingtip trails
    const gc = this.model.scheme.glow;
    for (let i = 0; i < 2; i++) {
      _v.copy(this.model.nozzles[i]).applyQuaternion(this.quat).add(this.pos);
      glow(_v, 1.0 + this.boostAmt * 1.4, 0.3 * power, 0.7 * power, 1.3 * power, 0.7);
      this.trails[2 + i].push(_v);
      this.trails[2 + i].intensity = this.boostAmt;
      _v2.copy(this.model.tips[i]).applyQuaternion(this.quat).add(this.pos);
      this.trails[i].push(_v2);
      this.trails[i].intensity = clamp(Math.abs(this.vu) / 50 + this.boostAmt * 0.8 + Math.abs(this.tilt) * 0.6 + (this.rollT > 0 ? 1 : 0), 0, 1);
    }
    // navigation lights
    const blinkOn = (t % 1.2) < 0.08;
    if (blinkOn) {
      _v.copy(this.model.tips[0]).applyQuaternion(this.quat).add(this.pos); glow(_v, 0.7, 1.6, 0.15, 0.15, 1);
      _v.copy(this.model.tips[1]).applyQuaternion(this.quat).add(this.pos); glow(_v, 0.7, 0.15, 1.6, 0.3, 1);
    }
    // shield effect
    this.shieldFx = Math.max(0, this.shieldFx - dt * 2.5);
    this.shield.visible = this.shieldFx > 0.01;
    this.shield.material.uniforms.uAmt.value = this.shieldFx;
    this.shield.material.uniforms.uTime.value = t;
    // low-shield smoke
    if (run && run.shield < run.maxShield * 0.3) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.05;
        _v.set(rand(-1, 1), 0.3, 2.5).applyQuaternion(this.quat).add(this.pos);
        FX.smoke.spawn(_v.x, _v.y, _v.z, rand(-1, 1), rand(1, 3), rand(2, 6), 1.1, 0.9, 3.4, [0.12, 0.12, 0.13, 0.6], [0.3, 0.3, 0.32, 0], 1, { fadeIn: 0.05 });
        if (Math.random() < 0.2) sparks(_v, null, 2, [6, 3, 1], 12, 1);
      }
    }
    // speed lines
    if (this.boostAmt > 0.2) speedLines(this.boostAmt, this.railFwd);
    // blob shadow on the water
    const gh = groundHeight(this.pos.x, this.pos.z);
    if (gh < 0) {
      this.blob.visible = true;
      const k = clamp(1 - this.pos.y / 60, 0, 1);
      this.blob.position.set(this.pos.x, 0.05, this.pos.z);
      this.blob.scale.set(9 * (1.4 - k * 0.4), 1, 11 * (1.4 - k * 0.4));
      this.blob.rotation.y = Math.atan2(this.railFwd.x, this.railFwd.z) + Math.PI;
      this.blob.material.opacity = 0.55 * k;
    } else this.blob.visible = false;
  }

  updateTrails(cam) { for (const tr of this.trails) tr.update(cam); }

  deflectFx() {
    this.shieldFx = 1;
    AudioSys.sfx('deflect', { pitch: rand(0.95, 1.1) });
  }

  // World position of a named gun
  gunPos(name, out) { return out.copy(this.model.guns[name]).applyQuaternion(this.quat).add(this.pos); }
}

// ============================================================ Chase camera
const cp = new THREE.Vector3(), cf = new THREE.Vector3(), cr = new THREE.Vector3(), look = new THREE.Vector3();
export const CAM = { u: 0, v: 22, fov: 62, roll: 0, lookAhead: 34, override: null, pos: new THREE.Vector3(), target: new THREE.Vector3() };

export function resetCamera(ship) {
  CAM.u = ship.u * 0.72; CAM.v = ship.v * 0.9 + 6.8; CAM.roll = 0; CAM.fov = 62;
}

export function updateCamera(dt, ship) {
  const cam = G.camera;
  if (CAM.override) {
    const o = CAM.override;
    cam.position.copy(o.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(o.target);
    if (o.roll) cam.rotateZ(o.roll);
    CAM.fov = damp(CAM.fov, o.fov ?? 62, 3, dt);
  } else {
    const back = 22 + ship.boostAmt * 6 - ship.brakeAmt * 3;
    railFrame(G.rail.d - back, cp, cf, cr);
    CAM.u = damp(CAM.u, ship.u * 0.72, 4.5, dt);
    CAM.v = damp(CAM.v, ship.v * 0.9 + 6.8, 4.5, dt);
    cam.position.copy(cp).addScaledVector(cr, CAM.u).setY(CAM.v);
    const gh = groundHeight(cam.position.x, cam.position.z);
    if (cam.position.y < gh + 3) cam.position.y = gh + 3;
    if (cam.position.y < 1.5) cam.position.y = 1.5;
    look.copy(ship.pos).addScaledVector(ship.railFwd, CAM.lookAhead);
    look.y += 1.5;
    look.addScaledVector(ship.railRight, ship.u * 0.12);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    CAM.roll = damp(CAM.roll, ship.bank * 0.14 + ship.tilt * -0.05, 4, dt);
    cam.rotateZ(CAM.roll);
    CAM.fov = damp(CAM.fov, 62 + ship.boostAmt * 14 - ship.brakeAmt * 7, 4, dt);
  }
  // shake
  if (G.shake > 0.001) {
    const s = G.shake * G.shake;
    const t = G.clock * 38;
    cam.position.x += (Math.sin(t * 1.13) + Math.sin(t * 2.71) * 0.5) * s * 1.4;
    cam.position.y += (Math.sin(t * 1.37 + 1.2) + Math.sin(t * 3.1) * 0.5) * s * 1.1;
    cam.rotateZ((Math.sin(t * 0.93) * 0.04) * s);
    G.shake = Math.max(0, G.shake - G.rdt * 1.6);
  }
  // Portrait screens: widen the vertical FOV so the horizontal view stays usable (~45° minimum).
  const minV = 2 * Math.atan(Math.tan(22.5 * Math.PI / 180) / cam.aspect) * 180 / Math.PI;
  cam.fov = Math.max(CAM.fov, Math.min(minV, 88));
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  CAM.pos.copy(cam.position);
}
