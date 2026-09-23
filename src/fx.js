// Visual effects: instanced particles (additive + alpha), immediate glow sprites, laser beams,
// ribbon trails, debris and composite effects (explosions, splashes, sparks, speed lines).
import * as THREE from 'three';
import { G, rand, clamp, lerp, TAU } from './core.js';
import { TEX, FOG, GLSL_FOG_FN, flashLight, POST } from './gfx.js';
import { WATER_U, terrainHeight } from './world.js';

const QUAD = new THREE.PlaneGeometry(1, 1);

const PARTICLE_VS = /* glsl */`
  attribute vec3 iPos; attribute vec4 iColor; attribute vec4 iData; attribute vec3 iVel;
  varying vec2 vUv; varying vec4 vColor; varying vec3 vView;
  void main(){
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    vec2 corner = position.xy;
    float size = iData.x;
    vec2 off;
    if (iData.w > 0.0) {
      vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
      vec2 dir = vv.xy; float len = length(dir);
      dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
      vec2 perp = vec2(-dir.y, dir.x);
      float L = size + len * iData.w;
      off = dir * corner.x * L + perp * corner.y * size;
    } else {
      float c = cos(iData.y), s = sin(iData.y);
      off = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
    }
    mv.xy += off;
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
    float fr = iData.z;
    float col = mod(fr, 2.0), row = floor(fr / 2.0 + 0.01);
    vUv = vec2((uv.x + col) * 0.5, (uv.y + (1.0 - row)) * 0.5);
    vColor = iColor;
  }`;

const ADD_FS = /* glsl */`
  uniform sampler2D map; uniform float fogDensity;
  varying vec2 vUv; varying vec4 vColor; varying vec3 vView;
  void main(){
    vec4 t = texture2D(map, vUv);
    float fog = exp(-fogDensity * 0.85 * length(vView));
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a * fog);
  }`;

const ALPHA_FS = /* glsl */`
  uniform sampler2D map; uniform vec3 fogColor; uniform float fogDensity;
  uniform vec3 uFogSunDir; uniform vec3 uFogSunColor; uniform float uFogHeightDensity; uniform float uFogHeightFalloff;
  varying vec2 vUv; varying vec4 vColor; varying vec3 vView;
  ${GLSL_FOG_FN}
  void main(){
    vec4 t = texture2D(map, vUv);
    vec3 col = vColor.rgb * t.rgb;
    col = applyAtmoFog(col, vView, fogColor, fogDensity, uFogSunDir, uFogSunColor, uFogHeightDensity, uFogHeightFalloff);
    gl_FragColor = vec4(col, vColor.a * t.a);
  }`;

function makeInstancedQuad(max) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = QUAD.index;
  geo.setAttribute('position', QUAD.attributes.position);
  geo.setAttribute('uv', QUAD.attributes.uv);
  const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
  geo.setAttribute('iPos', mk(3));
  geo.setAttribute('iColor', mk(4));
  geo.setAttribute('iData', mk(4));
  geo.setAttribute('iVel', mk(3));
  geo.instanceCount = 0;
  return geo;
}

function particleMaterial(additive) {
  return new THREE.ShaderMaterial({
    uniforms: additive
      ? { map: { value: TEX.atlas }, fogDensity: WATER_U.fogDensity }
      : { map: { value: TEX.atlas }, fogColor: WATER_U.fogColor, fogDensity: WATER_U.fogDensity, ...FOG },
    vertexShader: PARTICLE_VS,
    fragmentShader: additive ? ADD_FS : ALPHA_FS,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// ------------------------------------------------------------ Simulated particles
class ParticleSystem {
  constructor(max, additive) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    this.rot = new Float32Array(max); this.rotV = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.frame = new Float32Array(max); this.stretch = new Float32Array(max); this.fadeIn = new Float32Array(max); this.cpow = new Float32Array(max);
    this.geo = makeInstancedQuad(max);
    this.mesh = new THREE.Mesh(this.geo, particleMaterial(additive));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
    G.scene.add(this.mesh);
  }
  spawn(px, py, pz, vx, vy, vz, life, s0, s1, c0, c1, frame = 0, o = null) {
    let i = this.n;
    if (i >= this.max) i = (Math.random() * this.max) | 0; else this.n++;
    const i3 = i * 3, i4 = i * 4;
    this.p[i3] = px; this.p[i3 + 1] = py; this.p[i3 + 2] = pz;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    for (let k = 0; k < 4; k++) { this.c0[i4 + k] = c0[k]; this.c1[i4 + k] = c1[k]; }
    this.frame[i] = frame;
    this.rot[i] = o?.rot ?? Math.random() * TAU;
    this.rotV[i] = o?.rotV ?? 0;
    this.drag[i] = o?.drag ?? 0;
    this.grav[i] = o?.grav ?? 0;
    this.stretch[i] = o?.stretch ?? 0;
    this.fadeIn[i] = o?.fadeIn ?? 0;
    this.cpow[i] = o?.cpow ?? 1;
    return i;
  }
  copy(a, b) {
    const a3 = a * 3, b3 = b * 3, a4 = a * 4, b4 = b * 4;
    for (let k = 0; k < 3; k++) { this.p[b3 + k] = this.p[a3 + k]; this.v[b3 + k] = this.v[a3 + k]; }
    for (let k = 0; k < 4; k++) { this.c0[b4 + k] = this.c0[a4 + k]; this.c1[b4 + k] = this.c1[a4 + k]; }
    this.life[b] = this.life[a]; this.maxLife[b] = this.maxLife[a];
    this.s0[b] = this.s0[a]; this.s1[b] = this.s1[a];
    this.rot[b] = this.rot[a]; this.rotV[b] = this.rotV[a];
    this.drag[b] = this.drag[a]; this.grav[b] = this.grav[a];
    this.frame[b] = this.frame[a]; this.stretch[b] = this.stretch[a]; this.fadeIn[b] = this.fadeIn[a]; this.cpow[b] = this.cpow[a];
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
  update(dt) {
    const A = this.geo.attributes;
    const P = A.iPos.array, C = A.iColor.array, D = A.iData.array, V = A.iVel.array;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.n--; if (i !== this.n) { this.copy(this.n, i); } i--; continue; }
      const i3 = i * 3, i4 = i * 4;
      const dr = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1;
      this.v[i3] *= dr; this.v[i3 + 1] = this.v[i3 + 1] * dr - this.grav[i] * dt; this.v[i3 + 2] *= dr;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      this.rot[i] += this.rotV[i] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const et = 1 - (1 - t) * (1 - t);
      P[i3] = this.p[i3]; P[i3 + 1] = this.p[i3 + 1]; P[i3 + 2] = this.p[i3 + 2];
      V[i3] = this.v[i3]; V[i3 + 1] = this.v[i3 + 1]; V[i3 + 2] = this.v[i3 + 2];
      let fade = 1;
      if (this.fadeIn[i] > 0) fade = Math.min(1, (t * this.maxLife[i]) / this.fadeIn[i]);
      const ct = this.cpow[i] === 1 ? t : Math.pow(t, this.cpow[i]);
      C[i4] = lerp(this.c0[i4], this.c1[i4], ct);
      C[i4 + 1] = lerp(this.c0[i4 + 1], this.c1[i4 + 1], ct);
      C[i4 + 2] = lerp(this.c0[i4 + 2], this.c1[i4 + 2], ct);
      C[i4 + 3] = lerp(this.c0[i4 + 3], this.c1[i4 + 3], t) * fade;
      D[i4] = lerp(this.s0[i], this.s1[i], et);
      D[i4 + 1] = this.rot[i];
      D[i4 + 2] = this.frame[i];
      D[i4 + 3] = this.stretch[i];
    }
    this.geo.instanceCount = this.n;
    for (const k of ['iPos', 'iColor', 'iData', 'iVel']) {
      const a = A[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, this.n) * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------ Immediate-mode glow sprites (cleared every frame)
class GlowBatch {
  constructor(max) {
    this.max = max; this.n = 0;
    this.geo = makeInstancedQuad(max);
    this.mesh = new THREE.Mesh(this.geo, particleMaterial(true));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    G.scene.add(this.mesh);
  }
  add(p, size, r, g, b, a = 1, frame = 0, rot = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const A = this.geo.attributes;
    A.iPos.array.set([p.x, p.y, p.z], i * 3);
    A.iColor.array.set([r, g, b, a], i * 4);
    A.iData.array.set([size, rot, frame, 0], i * 4);
  }
  flush() {
    const A = this.geo.attributes;
    this.geo.instanceCount = this.n;
    for (const k of ['iPos', 'iColor', 'iData']) {
      const a = A[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, this.n) * a.itemSize);
      a.needsUpdate = true;
    }
  }
  reset() { this.n = 0; }
}

// ------------------------------------------------------------ Beams (camera-facing capsules between two points)
class BeamBatch {
  constructor(max) {
    this.max = max; this.n = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = QUAD.index;
    geo.setAttribute('position', QUAD.attributes.position);
    geo.setAttribute('uv', QUAD.attributes.uv);
    const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    geo.setAttribute('iA', mk(3));
    geo.setAttribute('iB', mk(3));
    geo.setAttribute('iC', mk(4));
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { fogDensity: WATER_U.fogDensity },
      vertexShader: /* glsl */`
        attribute vec3 iA; attribute vec3 iB; attribute vec4 iC;
        varying vec2 vUv; varying vec3 vCol; varying float vView;
        void main(){
          vec3 a = (viewMatrix * vec4(iA, 1.0)).xyz;
          vec3 b = (viewMatrix * vec4(iB, 1.0)).xyz;
          float t = position.y + 0.5;
          vec3 axis = b - a;
          float len = length(axis);
          vec3 ad = len > 1e-4 ? axis / len : vec3(0.0, 0.0, -1.0);
          vec3 p = mix(a, b, t);
          vec3 cr = cross(ad, p);
          float cl = length(cr);
          vec3 side = cl > 1e-5 ? cr / cl : vec3(1.0, 0.0, 0.0);
          float w = iC.w;
          p += ad * (t * 2.0 - 1.0) * w;
          p += side * position.x * w * 2.0;
          vView = length(p);
          gl_Position = projectionMatrix * vec4(p, 1.0);
          vUv = vec2(position.x * 2.0, t);
          vCol = iC.rgb;
        }`,
      fragmentShader: /* glsl */`
        uniform float fogDensity;
        varying vec2 vUv; varying vec3 vCol; varying float vView;
        void main(){
          float x = vUv.x;
          float core = exp(-x * x * 18.0);
          float halo = exp(-x * x * 3.0) * 0.55;
          float ends = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
          vec3 c = vCol * halo + vec3(1.0) * core * dot(vCol, vec3(0.33)) * 0.8;
          float fog = exp(-fogDensity * 0.7 * vView);
          gl_FragColor = vec4(c * ends * fog, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
    G.scene.add(this.mesh);
  }
  add(a, b, width, r, g, bl) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const A = this.geo.attributes;
    A.iA.array[i * 3] = a.x; A.iA.array[i * 3 + 1] = a.y; A.iA.array[i * 3 + 2] = a.z;
    A.iB.array[i * 3] = b.x; A.iB.array[i * 3 + 1] = b.y; A.iB.array[i * 3 + 2] = b.z;
    A.iC.array[i * 4] = r; A.iC.array[i * 4 + 1] = g; A.iC.array[i * 4 + 2] = bl; A.iC.array[i * 4 + 3] = width;
  }
  flush() {
    this.geo.instanceCount = this.n;
    for (const k of ['iA', 'iB', 'iC']) {
      const a = this.geo.attributes[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, this.n) * a.itemSize);
      a.needsUpdate = true;
    }
  }
  reset() { this.n = 0; }
}

// ------------------------------------------------------------ Ribbon trails
const trailMatCache = new Map();
function trailMaterial(additive) {
  const key = additive ? 'add' : 'alpha';
  if (trailMatCache.has(key)) return trailMatCache.get(key);
  const m = new THREE.ShaderMaterial({
    uniforms: { fogDensity: WATER_U.fogDensity },
    vertexShader: /* glsl */`
      attribute vec4 aCol; varying vec4 vCol; varying float vD; varying float vS;
      attribute float aSide;
      void main(){ vCol = aCol; vS = aSide; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform float fogDensity; varying vec4 vCol; varying float vD; varying float vS;
      void main(){ float edge = 1.0 - vS * vS; float f = exp(-fogDensity * vD); gl_FragColor = vec4(vCol.rgb, vCol.a * edge * f); }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  trailMatCache.set(key, m);
  return m;
}

export class Trail {
  constructor(n = 22, width = 0.5, color = [1, 1, 1], alpha = 0.6, additive = false) {
    this.n = n; this.width = width; this.color = color; this.alpha = alpha; this.intensity = 1;
    this.pts = []; for (let i = 0; i < n; i++) this.pts.push(new THREE.Vector3());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(n * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const side = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, trailMaterial(additive));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 19 : 12;
    this.started = false;
    G.scene.add(this.mesh);
  }
  reset(p) { for (const q of this.pts) q.copy(p); this.started = true; }
  push(p) {
    if (!this.started) this.reset(p);
    for (let i = this.n - 1; i > 0; i--) this.pts[i].copy(this.pts[i - 1]);
    this.pts[0].copy(p);
  }
  update(cam) {
    const pos = this.geo.attributes.position.array, col = this.geo.attributes.aCol.array;
    const t = new THREE.Vector3(), toCam = new THREE.Vector3(), side = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      const a = this.pts[Math.max(0, i - 1)], b = this.pts[Math.min(this.n - 1, i + 1)];
      t.subVectors(a, b);
      toCam.subVectors(cam, this.pts[i]);
      side.crossVectors(t, toCam);
      const l = side.length();
      if (l > 1e-6) side.multiplyScalar(1 / l); else side.set(0, 1, 0);
      const k = 1 - i / (this.n - 1);
      const w = this.width * (0.25 + 0.75 * k);
      const p = this.pts[i];
      pos.set([p.x - side.x * w, p.y - side.y * w, p.z - side.z * w, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w], i * 6);
      const a2 = this.alpha * k * k * this.intensity;
      col.set([this.color[0], this.color[1], this.color[2], a2, this.color[0], this.color[1], this.color[2], a2], i * 8);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aCol.needsUpdate = true;
  }
  set visible(v) { this.mesh.visible = v; }
  dispose() { G.scene.remove(this.mesh); this.geo.dispose(); }
}

// ------------------------------------------------------------ Debris
class Debris {
  constructor(max) {
    this.max = max;
    const g = new THREE.TetrahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x55525a, roughness: 0.75, metalness: 0.25 });
    mat.onBeforeCompile = (shader) => { Object.assign(shader.uniforms, FOG); };
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    G.scene.add(this.mesh);
    this.items = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(); this.pv = new THREE.Vector3();
  }
  spawn(p, v, size, burning = true) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ p: p.clone(), v: v.clone(), r: new THREE.Vector3(rand(0, 6), rand(0, 6), rand(0, 6)), rv: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), size, life: rand(1.2, 2.6), burning, emit: 0 });
  }
  clear() { this.items.length = 0; this.mesh.count = 0; }
  update(dt) {
    let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.life -= dt;
      d.v.y -= 28 * dt;
      d.v.multiplyScalar(Math.exp(-0.4 * dt));
      d.p.addScaledVector(d.v, dt);
      d.r.addScaledVector(d.rv, dt);
      const ground = d.p.y < 0.3 ? 0 : -999;
      if (d.life <= 0 || d.p.y < ground) {
        if (d.p.y < 0.5 && d.life > 0) splash(d.p, 0.35 * d.size);
        this.items.splice(i, 1);
        continue;
      }
      if (d.burning) {
        d.emit -= dt;
        if (d.emit <= 0) {
          d.emit = 0.035;
          FX.smoke.spawn(d.p.x, d.p.y, d.p.z, 0, 0, 0, 0.45, 0.9 * d.size, 1.8 * d.size, [2.6, 1.2, 0.35, 0.9], [0.15, 0.12, 0.12, 0], 1, { cpow: 0.5 });
          FX.smoke.spawn(d.p.x, d.p.y, d.p.z, rand(-1, 1), rand(1, 3), rand(-1, 1), 1.1, 0.8 * d.size, 3 * d.size, [0.16, 0.15, 0.16, 0.55], [0.3, 0.29, 0.3, 0], 1, { fadeIn: 0.08 });
        }
      }
    }
    for (const d of this.items) {
      this.e.set(d.r.x, d.r.y, d.r.z);
      this.q.setFromEuler(this.e);
      this.s.setScalar(d.size * Math.min(1, d.life * 2));
      this.m.compose(d.p, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------ Public FX API
export const FX = { add: null, smoke: null, glow: null, beams: null, debris: null };

export function initFX() {
  FX.add = new ParticleSystem(4000, true);
  FX.smoke = new ParticleSystem(1800, false);
  FX.glow = new GlowBatch(600);
  FX.beams = new BeamBatch(400);
  FX.debris = new Debris(160);
}

export function clearFX() {
  FX.add.clear(); FX.smoke.clear(); FX.debris.clear();
}

// Called at the beginning of each frame (before gameplay pushes immediate geometry)
export function beginFXFrame() { FX.glow.reset(); FX.beams.reset(); }

export function updateFX(dt) {
  FX.add.update(dt);
  FX.smoke.update(dt);
  FX.debris.update(dt);
  FX.glow.flush();
  FX.beams.flush();
}

const _d = new THREE.Vector3();
function randDir(out) {
  const u = Math.random() * 2 - 1, a = Math.random() * TAU, s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}

export function addShake(amount) { G.shake = Math.min(1.2, G.shake + amount * (G.settings.shake ? 1 : 0.25)); }

// Explosion. size ~1 for a small fighter; 2-3 for heavies; 5+ for huge.
// Layers: short additive flash → alpha-blended HDR fireballs that cool into smoke → sparks → lingering smoke → ring → debris.
export function explode(pos, size = 1, opts = {}) {
  const s = size, rs = Math.sqrt(size);
  const tint = opts.tint || [1, 1, 1];
  // hot core flash (brief)
  FX.add.spawn(pos.x, pos.y, pos.z, 0, 0, 0, 0.1 * rs + 0.05, 3 * s, 11 * s, [2.8 * tint[0], 1.9 * tint[1], 1.1 * tint[2], 1], [1.2, 0.4, 0.1, 0], 0);
  // fireball billows: HDR orange that cools to dark smoke (normal blending → no white-out when they overlap)
  const nf = Math.round(7 * s) + 2;
  for (let i = 0; i < nf; i++) {
    randDir(_d);
    const sp = rand(2.5, 11) * rs;
    const o = rand(0, 1.4) * s;
    FX.smoke.spawn(pos.x + _d.x * o, pos.y + _d.y * o, pos.z + _d.z * o, _d.x * sp, _d.y * sp + 2.5, _d.z * sp,
      rand(0.8, 1.35) * rs, rand(2.4, 3.8) * s, rand(6.5, 10) * s,
      [4.2 * tint[0], 1.35 * tint[1], 0.28 * tint[2], 1], [0.12, 0.1, 0.1, 0], 1, { rotV: rand(-1.5, 1.5), drag: 2.4, cpow: 0.55 });
  }
  // a few additive hot spots inside the fireball
  const nh = Math.round(2 * s) + 1;
  for (let i = 0; i < nh; i++) {
    randDir(_d);
    FX.add.spawn(pos.x + _d.x * s, pos.y + _d.y * s, pos.z + _d.z * s, _d.x * 4, _d.y * 4 + 2, _d.z * 4, rand(0.25, 0.4) * rs, 2 * s, 5 * s, [2.4, 0.8, 0.12, 0.8], [0.5, 0.08, 0.0, 0], 1, { rotV: rand(-2, 2), drag: 2 });
  }
  // sparks
  const ns = Math.round(12 * s);
  for (let i = 0; i < ns; i++) {
    randDir(_d);
    const sp = rand(25, 70) * rs;
    FX.add.spawn(pos.x, pos.y, pos.z, _d.x * sp, _d.y * sp, _d.z * sp, rand(0.3, 0.8), rand(0.22, 0.4) * rs, 0.08,
      [5, 3.2, 1.4, 1], [2.2, 0.6, 0.1, 0], 0, { stretch: 0.05, drag: 1.4, grav: 18 });
  }
  // lingering smoke
  const nsm = Math.round(5 * s);
  for (let i = 0; i < nsm; i++) {
    randDir(_d);
    const sp = rand(2, 6) * rs;
    FX.smoke.spawn(pos.x + _d.x * s, pos.y + _d.y * s, pos.z + _d.z * s, _d.x * sp, _d.y * sp + 3, _d.z * sp,
      rand(1.6, 2.8) * rs, 4 * s, rand(12, 17) * s, [0.2, 0.18, 0.19, 0.7], [0.34, 0.32, 0.34, 0], 1, { fadeIn: 0.3, drag: 1.1, rotV: rand(-0.6, 0.6) });
  }
  // shockwave ring
  FX.add.spawn(pos.x, pos.y, pos.z, 0, 0, 0, 0.35, 1.5 * s, 16 * s, [1.0, 0.72, 0.45, 0.6], [0.4, 0.15, 0.05, 0], 3, { rot: 0 });
  // debris
  const nd = opts.debris ?? Math.round(4 * s);
  for (let i = 0; i < nd; i++) {
    randDir(_d);
    const v = new THREE.Vector3(_d.x * rand(12, 35) * rs, Math.abs(_d.y) * rand(10, 30) * rs + 5, _d.z * rand(12, 35) * rs);
    if (opts.vel) v.addScaledVector(opts.vel, 0.6);
    FX.debris.spawn(pos, v, rand(0.35, 0.9) * rs, Math.random() < 0.6);
  }
  flashLight(pos, 0xff9955, 900 * s, 0.22 + 0.1 * rs);
  // camera shake scaled by distance
  const dist = G.camera.position.distanceTo(pos);
  addShake(clamp(0.5 * s / Math.max(1, dist / 30), 0, 0.8));
  if (pos.y < 6 && opts.water !== false) splash(pos, s * 0.8);
}

export function bigFlash(strength = 1, color = [1, 1, 1]) {
  POST.flash = Math.max(POST.flash, 0.65 * strength);
  POST.flashColor.setRGB(color[0], color[1], color[2]);
}

// Water/terrain splash
export function splash(pos, size = 1) {
  const n = Math.round(10 * size) + 3;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, r = rand(0, 2) * size;
    const up = rand(12, 30) * Math.sqrt(size);
    FX.smoke.spawn(pos.x + Math.cos(a) * r, 0.3, pos.z + Math.sin(a) * r, Math.cos(a) * rand(2, 7) * size, up, Math.sin(a) * rand(2, 7) * size,
      rand(0.9, 1.6), rand(1.2, 2.2) * size, rand(4, 7) * size, [0.95, 0.97, 1.0, 0.85], [0.8, 0.85, 0.9, 0], 1, { grav: 26, drag: 0.6, fadeIn: 0.05 });
  }
  FX.smoke.spawn(pos.x, 1, pos.z, 0, 3, 0, 1.6, 4 * size, 14 * size, [0.85, 0.9, 0.95, 0.45], [0.8, 0.85, 0.9, 0], 1, { fadeIn: 0.1 });
}

// Directional spark burst (laser hits, scrapes)
export function sparks(pos, dir, count = 8, color = [6, 4.5, 2], speed = 40, spread = 0.8) {
  for (let i = 0; i < count; i++) {
    randDir(_d);
    const vx = (dir ? dir.x : 0) + _d.x * spread, vy = (dir ? dir.y : 0) + _d.y * spread, vz = (dir ? dir.z : 0) + _d.z * spread;
    const sp = speed * rand(0.4, 1.2);
    FX.add.spawn(pos.x, pos.y, pos.z, vx * sp, vy * sp, vz * sp, rand(0.15, 0.4), rand(0.18, 0.3), 0.05,
      [color[0], color[1], color[2], 1], [color[0] * 0.4, color[1] * 0.2, color[2] * 0.1, 0], 0, { stretch: 0.045, drag: 2, grav: 10 });
  }
  FX.add.spawn(pos.x, pos.y, pos.z, 0, 0, 0, 0.1, 1.5, 3.5, [color[0], color[1], color[2], 1], [color[0], color[1], color[2], 0], 0);
}

// Glint for hits that don't hurt (armor)
export function ricochet(pos) { sparks(pos, null, 5, [3, 3.5, 4], 30, 1); }

// Speed lines while boosting: short streaks rushing past the camera
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
export function speedLines(amount, fwd) {
  const cam = G.camera;
  if (Math.random() > amount) return;
  _f.copy(fwd);
  _r.set(1, 0, 0).applyQuaternion(cam.quaternion);
  _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
  const n = 2;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, rr = rand(5, 16);
    const p = cam.position.clone().addScaledVector(_f, rand(30, 60)).addScaledVector(_r, Math.cos(a) * rr * 1.5).addScaledVector(_u, Math.sin(a) * rr);
    FX.add.spawn(p.x, p.y, p.z, -_f.x * 260, -_f.y * 260, -_f.z * 260, 0.28, 0.06, 0.04, [2.2, 2.4, 2.8, 0.55], [1.5, 1.8, 2.2, 0], 0, { stretch: 0.05 });
  }
}

// Soft engine glow sprite helper
export function glow(p, size, r, g, b, a = 1, frame = 0, rot = 0) { FX.glow.add(p, size, r, g, b, a, frame, rot); }
export function beam(a, b, width, r, g, bl) { FX.beams.add(a, b, width, r, g, bl); }
