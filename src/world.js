// World: rail frame, streaming low-poly terrain, ocean, clouds, decoration kit and palettes.
// What the land looks like along the course is up to the current stage (see useStageWorld).
import * as THREE from 'three';
import { G, clamp, lerp, smoothstep, mulberry32 } from './core.js';
import {
  ATMO, FOG, GLSL_NOISE, GLSL_SKY, GLSL_FOG_FN, patchFog, TEX,
  preparePalette, lerpPalette, applyPalette, makeEnvMap, bakeSpaceSky, LIGHTS,
} from './gfx.js';

// ============================================================ Stage geography (installed by useStageWorld)
// The course, height field, ground colours, decorations and sky palettes come from the current stage
// definition (src/stages/). Other modules call these through the live bindings below.
let SW = null;                          // current stage's world definition
export let zoneW = () => ({});          // zone weights at rail distance d (the stage's own keys; wingmen climb when .canyon is high)
export let pathX = () => 0;             // x of the rail centre line at distance d
export let terrainHeight = () => 0;     // terrain height at world (x, z)
let faceColor = (x, y, z, ny, out) => out.setRGB(0.5, 0.5, 0.5);
const SPACE_FLOOR = -1e4;               // "ground height" in space: far below anything that flies


// Rail frame at distance d: position on the path (y = 0), forward, right, up.
export function railFrame(d, pos, fwd, right) {
  const x = pathX(d);
  const slope = (pathX(d + 2) - pathX(d - 2)) * 0.25;
  if (pos) pos.set(x, 0, -d);
  if (fwd) fwd.set(slope, 0, -1).normalize();
  if (right) right.set(1, 0, slope).normalize();
}

const _rp = new THREE.Vector3(), _rr = new THREE.Vector3(), _rf = new THREE.Vector3();
export function railToWorld(s, u, v, out) {
  railFrame(s, _rp, null, _rr);
  return out.copy(_rp).addScaledVector(_rr, u).setY(v);
}

// Convert a world position to rail coordinates → out.x = s, out.y = u, out.z = v.
export function worldToRail(p, out) {
  let s = -p.z;
  for (let i = 0; i < 3; i++) {
    railFrame(s, _rp, _rf, _rr);
    const along = (p.x - _rp.x) * _rf.x + (p.z - _rp.z) * _rf.z;
    s += along * Math.abs(_rf.z);
  }
  railFrame(s, _rp, _rf, _rr);
  out.set(s, (p.x - _rp.x) * _rr.x + (p.z - _rp.z) * _rr.z, p.y);
  return out;
}

// ============================================================ Terrain mesh streaming
const CHUNK = 160, ZSTEP = 8, ZN = CHUNK / ZSTEP;
const XS = (() => {
  const half = [0];
  let x = 0, step = 8;
  while (x < 2700) { if (x >= 232) step *= 1.13; x += step; half.push(x); }
  const full = [];
  for (let i = half.length - 1; i > 0; i--) full.push(-half[i]);
  for (let i = 0; i < half.length; i++) full.push(half[i]);
  return full;
})();
const XN = XS.length;
const XMID = (XN - 1) / 2;

// Height as rendered by the mesh (bilinear inside the sheared grid cell) – used for collisions.
export function groundHeight(x, z) {
  const d = -z;
  const r0 = Math.floor(d / ZSTEP);
  const fr = d / ZSTEP - r0;
  const hRow = (r) => {
    const dr = r * ZSTEP;
    const lx = x - pathX(dr);
    // inner uniform region: columns every 8 m
    const cf = lx / 8;
    if (Math.abs(lx) < 230) {
      const c0 = Math.floor(cf), t = cf - c0;
      const x0 = pathX(dr) + c0 * 8;
      return lerp(terrainHeight(x0, -dr), terrainHeight(x0 + 8, -dr), t);
    }
    return terrainHeight(x, -dr);
  };
  return lerp(hRow(r0), hRow(r0 + 1), fr);
}

let terrainMat = null;
const chunks = new Map();
const decoByChunk = new Map();
export const __worldDebug = { chunks, decoByChunk };   // read by the dev-build fingerprint (main.js __fp)

function buildChunk(ci) {
  if (SW.space) { chunks.set(ci, null); buildDecorations(ci); return; }   // nothing underfoot: only the stage's decorations
  const d0 = ci * CHUNK;
  const rows = ZN + 1;
  const px = new Float32Array(rows * XN), py = new Float32Array(rows * XN), pz = new Float32Array(rows * XN);
  for (let r = 0; r < rows; r++) {
    const d = d0 + r * ZSTEP;
    const cx = pathX(d);
    for (let c = 0; c < XN; c++) {
      const x = cx + XS[c], z = -d;
      const i = r * XN + c;
      px[i] = x; pz[i] = z; py[i] = terrainHeight(x, z);
    }
  }
  const triCount = ZN * (XN - 1) * 2;
  const pos = new Float32Array(triCount * 9);
  const nor = new Float32Array(triCount * 9);
  const col = new Float32Array(triCount * 9);
  let o = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), c3 = new THREE.Color();
  const tri = (a, b, c) => {
    e1.set(px[b] - px[a], py[b] - py[a], pz[b] - pz[a]);
    e2.set(px[c] - px[a], py[c] - py[a], pz[c] - pz[a]);
    n.crossVectors(e1, e2).normalize();
    const cx = (px[a] + px[b] + px[c]) / 3, cy = (py[a] + py[b] + py[c]) / 3, cz = (pz[a] + pz[b] + pz[c]) / 3;
    faceColor(cx, cy, cz, n.y, c3);
    for (const v of [a, b, c]) {
      pos[o] = px[v]; pos[o + 1] = py[v]; pos[o + 2] = pz[v];
      nor[o] = n.x; nor[o + 1] = n.y; nor[o + 2] = n.z;
      col[o] = c3.r; col[o + 1] = c3.g; col[o + 2] = c3.b;
      o += 3;
    }
  };
  for (let r = 0; r < ZN; r++) {
    for (let c = 0; c < XN - 1; c++) {
      const a = r * XN + c, b = a + 1, cN = a + XN, dN = cN + 1;
      // rows go toward -z as r increases; winding chosen so normals face up
      if ((r + c) & 1) { tri(a, b, cN); tri(b, dN, cN); }
      else { tri(a, b, dN); tri(a, dN, cN); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, terrainMat);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  G.scene.add(mesh);
  chunks.set(ci, mesh);
  buildDecorations(ci);
}

function disposeChunk(ci) {
  const m = chunks.get(ci);
  if (m) { G.scene.remove(m); m.geometry.dispose(); }
  chunks.delete(ci);
  const deco = decoByChunk.get(ci);
  if (deco) { for (const o of deco) { G.scene.remove(o); o.dispose?.(); } decoByChunk.delete(ci); }
}

export function updateTerrain(d, force = false) {
  const first = Math.floor((d - 260) / CHUNK), last = Math.floor((d + 3300) / CHUNK);
  for (const ci of [...chunks.keys()]) if (ci < first - 1 || ci > last + 3) disposeChunk(ci);
  let built = 0;
  for (let ci = Math.max(0, first); ci <= last; ci++) {
    if (!chunks.has(ci)) { buildChunk(ci); built++; if (!force && built >= 1) break; }
  }
}

export function resetTerrain() { for (const ci of [...chunks.keys()]) disposeChunk(ci); }

// ============================================================ Decorations (trees, rocks, buildings)
let treeGeo, rockGeo, bldgGeo, decoMat, bldgMat, lightGeo, lightGeoCyan, lightMat;
const DECO = {};   // the kit handed to the stage's decorate(ci, DECO)

function mergeColored(parts) {
  // parts: [geometry, color(hex|Color), emissive(0..1)]
  const geos = [];
  for (const [g0, hex, em = 0] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const ca = new Float32Array(n * 3), ea = new Float32Array(n);
    for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; ea[i] = em; }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    g.setAttribute('aEmit', new THREE.BufferAttribute(ea, 1));
    geos.push(g);
  }
  return mergeGeometries(geos);
}

// Minimal merge (avoids importing addons for this simple use).
export function mergeGeometries(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  const names = Object.keys(geos[0].attributes);
  for (const name of names) {
    const size = geos[0].attributes[name].itemSize;
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of geos) { const a = g.attributes[name]; arr.set(a.array, off); off += a.count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

// Emissive-mask extension for vertex-colored standard materials (aEmit attribute).
export function emissiveVertexMaterial(opts = {}, emitBoost = 3) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2, ...opts });
  mat.userData.emit = { value: emitBoost };
  mat.userData.flash = { value: 0 };
  mat.userData.tint = { value: new THREE.Color(1, 1, 1) };
  const extra = (shader) => {
    shader.uniforms.uEmitBoost = mat.userData.emit;
    shader.uniforms.uFlash = mat.userData.flash;
    shader.uniforms.uTint = mat.userData.tint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEmit;\nvarying float vEmit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = aEmit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEmit;\nuniform float uEmitBoost;\nuniform float uFlash;\nuniform vec3 uTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(uTint, vec3(1.0), vEmit);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vEmit * uEmitBoost + vec3(uFlash);');
  };
  patchFog(mat, extra);
  return mat;
}

function initDecorations() {
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 4, 5).translate(0, 2, 0);
  const crown = new THREE.IcosahedronGeometry(3.2, 0).scale(1, 1.25, 1).translate(0, 6.2, 0);
  const crown2 = new THREE.IcosahedronGeometry(2.2, 0).translate(1.1, 8.4, 0.4);
  treeGeo = mergeColored([[trunk, '#6b4a32'], [crown, '#3f7a34'], [crown2, '#56913c']]);
  const rock = new THREE.DodecahedronGeometry(3, 0);
  const rp = rock.attributes.position;
  const rr = mulberry32(5);
  for (let i = 0; i < rp.count; i++) rp.setXYZ(i, rp.getX(i) * (0.8 + rr() * 0.4), rp.getY(i) * (0.6 + rr() * 0.3), rp.getZ(i) * (0.8 + rr() * 0.4));
  rockGeo = mergeColored([[rock, '#857563']]);
  // building: box body + roof trim + window band (emissive handled in shader via world pos)
  const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  bldgGeo = mergeColored([[body, '#3c424d']]);
  lightGeo = mergeColored([[new THREE.OctahedronGeometry(0.9, 0), '#ff3a2a', 1]]);
  lightGeoCyan = mergeColored([[new THREE.BoxGeometry(1.2, 0.25, 4.5), '#39d8ff', 1]]);

  decoMat = emissiveVertexMaterial({ roughness: 0.9, metalness: 0 });
  lightMat = emissiveVertexMaterial({ roughness: 0.4, metalness: 0 }, 6);

  bldgMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45 });
  patchFog(bldgMat, (shader) => {
    shader.uniforms.uTime = ATMO.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vLN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n{ vec4 wp4 = vec4(transformed,1.0);\n#ifdef USE_INSTANCING\n wp4 = instanceMatrix * wp4;\n#endif\n vWP = (modelMatrix * wp4).xyz; vLN = normal; }');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vLN; uniform float uTime;\nfloat bh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 an = abs(vLN);
          vec2 wc = an.x > 0.5 ? vWP.zy : (an.z > 0.5 ? vWP.xy : vec2(0.0));
          if (an.y < 0.5) {
            vec2 cell = floor(wc / vec2(3.2, 4.0));
            vec2 f = fract(wc / vec2(3.2, 4.0));
            float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.7);
            float on = step(0.45, bh(cell));
            vec3 wcol = mix(vec3(1.0, 0.62, 0.3), vec3(0.4, 0.8, 1.0), step(0.8, bh(cell + 7.0)));
            totalEmissiveRadiance += wcol * win * on * 1.6 * step(3.0, vWP.y);
          } else if (vLN.y > 0.5) {
            // roof edge beacon line
          }
        }`);
  });
  Object.assign(DECO, { CHUNK, treeGeo, rockGeo, bldgGeo, decoMat, bldgMat, lightGeo, lightGeoCyan, lightMat });
}

function buildDecorations(ci) {
  decoByChunk.set(ci, SW.decorate ? SW.decorate(ci, DECO) : []);
}

// ============================================================ Ocean
let water = null;
export const WATER_U = {
  uTime: ATMO.uTime,
  uDeep: { value: new THREE.Color('#0d3a4f') },
  uScatter: { value: new THREE.Color('#1f6b6b') },
  fogColor: { value: new THREE.Color() },
  fogDensity: { value: 0.0005 },
};

function createWater() {
  const uniforms = { ...ATMO, ...FOG, ...WATER_U };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vWorld; varying vec3 vView;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vView = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uDeep; uniform vec3 uScatter; uniform vec3 fogColor; uniform float fogDensity;
      uniform vec3 uFogSunDir; uniform vec3 uFogSunColor; uniform float uFogHeightDensity; uniform float uFogHeightFalloff;
      uniform float uSunDisc;
      varying vec3 vWorld; varying vec3 vView;
      ${GLSL_NOISE}
      ${GLSL_SKY}
      ${GLSL_FOG_FN}
      vec2 wv(vec2 p, vec2 dir, float freq, float amp, float speed){
        float ph = dot(p, dir) * freq + uTime * speed;
        return dir * (cos(ph) * amp * freq);
      }
      void main(){
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / dist;
        vec2 p = vWorld.xz;
        vec2 g = vec2(0.0);
        g += wv(p, normalize(vec2(0.8, 0.6)), 0.09, 0.9, 1.4);
        g += wv(p, normalize(vec2(-0.5, 0.86)), 0.13, 0.55, 1.9);
        g += wv(p, normalize(vec2(0.2, -0.98)), 0.21, 0.32, 2.6);
        g += wv(p, normalize(vec2(-0.9, -0.3)), 0.37, 0.16, 3.3);
        g += wv(p, normalize(vec2(0.6, -0.7)), 0.61, 0.08, 4.4);
        // fine ripples
        vec2 q = p * 0.35 + vec2(uTime * 0.6, -uTime * 0.45);
        float e = 0.35;
        float n0 = fbm3(q);
        g += vec2(fbm3(q + vec2(e, 0.0)) - n0, fbm3(q + vec2(0.0, e)) - n0) * 1.4;
        float atten = 1.0 / (1.0 + dist * 0.0022);
        g *= atten;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        float ndv = max(dot(n, v), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 r = reflect(-v, n);
        r.y = abs(r.y) + 0.002;
        r = normalize(r);
        vec3 sky = skyBase(r);
        float sunFacing = pow(max(dot(-v, uSunDir) * 0.5 + 0.5, 0.0), 3.0);
        vec3 body = uDeep + uScatter * (0.25 + 0.75 * clamp(0.5 + dot(g, uSunDir.xz) * 2.0, 0.0, 1.0)) * (0.5 + sunFacing);
        vec3 col = mix(body, sky, fres);
        float sd = max(dot(r, uSunDir), 0.0);
        float far = smoothstep(200.0, 2500.0, dist);
        float spec = pow(sd, mix(1400.0, 300.0, far)) * mix(30.0, 9.0, far) + pow(sd, 90.0) * 0.8 + pow(sd, 10.0) * 0.06;
        col += uSunColor * spec;
        // whitecaps
        float foam = smoothstep(0.68, 0.86, fbm3(p * 0.045 + vec2(uTime * 0.03, 0.0))) * smoothstep(0.1, 0.35, length(g)) * (1.0 - far);
        col = mix(col, vec3(0.8, 0.82, 0.85) * (0.6 + 0.4 * dot(uSunColor, vec3(0.33))), foam * 0.35);
        col = applyAtmoFog(col, vView, fogColor, fogDensity, uFogSunDir, uFogSunColor, uFogHeightDensity, uFogHeightFalloff);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  water = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000, 1, 1).rotateX(-Math.PI / 2), mat);
  water.frustumCulled = false;
  water.renderOrder = -10;
  G.scene.add(water);
}

// ============================================================ Clouds (billboards)
let clouds = null;
const CLOUD_N = 90;
const cloudData = [];
function createClouds() {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(CLOUD_N * 4), 4);
  const iMisc = new THREE.InstancedBufferAttribute(new Float32Array(CLOUD_N * 2), 2);
  iPos.setUsage(THREE.DynamicDrawUsage); iMisc.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iMisc', iMisc);
  geo.instanceCount = CLOUD_N;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...ATMO, ...FOG, map: { value: TEX.cloud }, fogColor: WATER_U.fogColor, fogDensity: WATER_U.fogDensity },
    vertexShader: /* glsl */`
      attribute vec4 iPos; attribute vec2 iMisc;
      varying vec2 vUv; varying float vA; varying vec3 vView; varying vec3 vWDir;
      void main(){
        vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
        float c = cos(iMisc.x), s = sin(iMisc.x);
        vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
        mv.xy += q * vec2(iPos.w * 1.6, iPos.w * 0.9);
        vView = mv.xyz;
        vWDir = normalize(iPos.xyz - cameraPosition);
        vUv = uv; vA = iMisc.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec3 uCloudColor; uniform vec3 uCloudShadow; uniform vec3 fogColor; uniform float fogDensity;
      uniform vec3 uFogSunDir; uniform vec3 uFogSunColor; uniform float uFogHeightDensity; uniform float uFogHeightFalloff;
      uniform vec3 uSunColor;
      varying vec2 vUv; varying float vA; varying vec3 vView; varying vec3 vWDir;
      ${GLSL_FOG_FN}
      void main(){
        vec4 t = texture2D(map, vUv);
        float sd = max(dot(vWDir, uFogSunDir), 0.0);
        vec3 col = mix(uCloudShadow, uCloudColor, t.r);
        col += uSunColor * pow(sd, 6.0) * 0.35 * (1.0 - t.a);
        float near = smoothstep(40.0, 160.0, length(vView));
        col = applyAtmoFog(col, vView, fogColor, fogDensity * 0.8, uFogSunDir, uFogSunColor, 0.0, 0.0);
        gl_FragColor = vec4(col, t.a * vA * near);
      }`,
    transparent: true,
    depthWrite: false,
  });
  clouds = new THREE.Mesh(geo, mat);
  clouds.frustumCulled = false;
  clouds.renderOrder = 5;
  G.scene.add(clouds);
  for (let i = 0; i < CLOUD_N; i++) cloudData.push({ x: 0, y: 0, z: 0, s: 0, r: 0, a: 0, alive: false });
}

function respawnCloud(c, d, spread) {
  const dd = d + (spread ? Math.random() * 3600 - 200 : 3200 + Math.random() * 400);
  const lx = (Math.random() * 2 - 1) * 1600;
  c.x = pathX(dd) + lx; c.z = -dd;
  const low = Math.random() < 0.18;
  c.y = low ? 55 + Math.random() * 30 : 150 + Math.random() * 140;
  c.s = (low ? 60 : 120) + Math.random() * 160;
  c.r = (Math.random() - 0.5) * 0.3;
  c.a = low ? 0.55 : 0.85;
  c.alive = true;
}

const _cd = [];
function updateClouds(d, cover) {
  const cam = G.camera.position;
  for (const c of cloudData) {
    if (!c.alive) respawnCloud(c, d, true);
    else if (-c.z < d - 300) respawnCloud(c, d, false);
  }
  // sort back-to-front
  _cd.length = 0;
  for (const c of cloudData) { c.dist = (c.x - cam.x) ** 2 + (c.y - cam.y) ** 2 + (c.z - cam.z) ** 2; _cd.push(c); }
  _cd.sort((a, b) => b.dist - a.dist);
  const ip = clouds.geometry.attributes.iPos, im = clouds.geometry.attributes.iMisc;
  const vis = clamp(cover * 1.6, 0, 1);
  for (let i = 0; i < _cd.length; i++) {
    const c = _cd[i];
    ip.array[i * 4] = c.x; ip.array[i * 4 + 1] = c.y; ip.array[i * 4 + 2] = c.z; ip.array[i * 4 + 3] = c.s;
    im.array[i * 2] = c.r; im.array[i * 2 + 1] = c.a * vis;
  }
  ip.needsUpdate = true; im.needsUpdate = true;
}

// ============================================================ Palettes along the stage
let currentEnv = null;
const curPal = {};

export function paletteAt(d, out = curPal) {
  const KEYS = SW.paletteKeys, PAL = SW._pal;
  let a = KEYS[0], b = KEYS[0];
  for (let i = 0; i < KEYS.length; i++) {
    if (KEYS[i].at <= d) { a = KEYS[i]; b = KEYS[Math.min(i + 1, KEYS.length - 1)]; }
  }
  const t = b.at > a.at ? smoothstep(a.at, b.at, d) : 0;
  lerpPalette(PAL[a.name], PAL[b.name], t, out);
  out._dominant = t < 0.5 ? a.name : b.name;
  return out;
}

// ============================================================ Init / update
export function initWorld() {
  terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.0, envMapIntensity: 0.55 });
  patchFog(terrainMat);
  initDecorations();
  createWater();
  createClouds();
}

// Switch the world to a stage: geography, palettes (prepared once per stage, with their env maps), sea and clouds.
// `space` (true or { band }) makes it a space stage: no terrain, sea or clouds, no gravity, and a nebula sky that is
// baked once per stage (band: the normal of the nebula's brightest plane). Its palettes read as nebula colours:
// zenith = deep space, mid / horizon = the two nebula colours, cloud = bright cores, cloudShadow = dust, cloudCover = strength.
export function useStageWorld(def) {
  SW = def.world;
  zoneW = SW.zoneW; pathX = SW.pathX;
  terrainHeight = SW.terrainHeight || (() => SPACE_FLOOR); faceColor = SW.faceColor || faceColor;
  G.space = !!SW.space;
  G.sea = !SW.space && SW.water !== false;
  if (SW.space && !SW._skyMap) SW._skyMap = bakeSpaceSky(SW.space.band);
  ATMO.uSpace.value = SW.space ? 1 : 0;
  if (SW.space) ATMO.uSpaceMap.value = SW._skyMap;
  if (!SW._pal) {
    SW._pal = {}; SW._env = {};
    for (const k in SW.palettes) SW._pal[k] = preparePalette(SW.palettes[k]);
    for (const k in SW._pal) SW._env[k] = makeEnvMap(SW._pal[k]);
  }
  water.visible = G.sea;
  clouds.visible = !SW.space && SW.clouds !== false;
  resetTerrain();
}

export function setWorldAtmosphere(d) {
  const p = paletteAt(d);
  applyPalette(p);
  WATER_U.uDeep.value.copy(p.waterDeep);
  WATER_U.uScatter.value.copy(p.waterScatter);
  WATER_U.fogColor.value.copy(p.fog);
  WATER_U.fogDensity.value = p.fogDensity;
  const env = SW._env[p._dominant];
  if (env && env !== currentEnv) { G.scene.environment = env; currentEnv = env; }
  return p;
}

export function updateWorld(dt, d, focus) {
  ATMO.uTime.value += dt;
  const p = setWorldAtmosphere(d);
  updateTerrain(d);
  const cam = G.camera.position;
  water.position.set(Math.round(cam.x / 50) * 50, 0, Math.round(cam.z / 50) * 50);
  if (clouds.visible) updateClouds(d, p.cloudCover);
}
