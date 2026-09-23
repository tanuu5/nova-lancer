// World: rail path, stage zones, streaming low-poly terrain, ocean, clouds, decorations and palettes.
import * as THREE from 'three';
import { G, clamp, lerp, smoothstep, Simplex2, fbm2, ridged2, mulberry32, hash2 } from './core.js';
import {
  ATMO, FOG, GLSL_NOISE, GLSL_SKY, GLSL_FOG_FN, patchFog, TEX,
  preparePalette, lerpPalette, applyPalette, makeEnvMap, LIGHTS,
} from './gfx.js';

// ============================================================ Zones & rail path
export const ZONE = { canyonStart: 4400, canyonEnd: 8000, fortStart: 8000, fortEnd: 10400, boss: 10900 };
const _zw = { ocean: 1, canyon: 0, fort: 0, boss: 0 };
export function zoneW(d, out = _zw) {
  const cIn = smoothstep(4400, 5000, d), cOut = smoothstep(7700, 8300, d), fOut = smoothstep(10300, 10900, d);
  out.canyon = cIn * (1 - cOut);
  out.fort = cOut * (1 - fOut);
  out.boss = fOut;
  out.ocean = Math.max(0, 1 - out.canyon - out.fort - out.boss);
  return out;
}

const _pw = { ocean: 1, canyon: 0, fort: 0, boss: 0 };
export function pathX(d) {
  const w = zoneW(d, _pw);
  let x = 0;
  if (w.ocean > 0) x += w.ocean * (55 * Math.sin(d * 0.0011 + 0.6) + 22 * Math.sin(d * 0.0023 + 2.0));
  if (w.canyon > 0) x += w.canyon * (125 * Math.sin((d - 4400) * 0.0017) + 38 * Math.sin(d * 0.0041));
  if (w.fort > 0) x += w.fort * (40 * Math.sin(d * 0.0013));
  return x;
}

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

// ============================================================ Terrain height field
const N1 = new Simplex2(1337), N2 = new Simplex2(4242), N3 = new Simplex2(777), N4 = new Simplex2(2024);

function oceanH(x, z, adx) {
  let h = -24 + 7 * N2.noise(x * 0.01, z * 0.01);
  const n = fbm2(N1, x * 0.0028, z * 0.0028, 4);
  const isl = smoothstep(0.1, 0.48, n);
  if (isl > 0) {
    const detail = fbm2(N2, x * 0.013, z * 0.013, 3) * 0.5 + 0.5;
    const peak = 26 + 80 * ridged2(N3, x * 0.004, z * 0.004, 3);
    const corridor = smoothstep(50, 210, adx);
    h += isl * (26 + peak * detail) * lerp(0.3, 1, corridor) + isl * 3;
  }
  const far = smoothstep(650, 1500, adx);
  if (far > 0) h = Math.max(h, lerp(h, 30 + 280 * ridged2(N4, x * 0.0011, z * 0.0011, 4), far));
  return h;
}

function canyonH(x, z, adx, d) {
  const halfW = 60 + 20 * Math.sin(d * 0.0029 + 1.0) + 7 * N1.noise(d * 0.006, 7.7);
  const wallT = smoothstep(halfW, halfW + 34, adx + 5 * N2.noise(x * 0.02, z * 0.02));
  const floor = -5 + 2.5 * N2.noise(x * 0.04, z * 0.04);
  const plateau = 118 + 45 * fbm2(N3, x * 0.003, z * 0.003, 3) + 30 * smoothstep(250, 650, adx);
  let h = lerp(floor, plateau, wallT);
  if (wallT > 0.01 && wallT < 0.995) {
    const step = 13;
    const t = h / step, fl = Math.floor(t), fr = t - fl;
    h = lerp(h, (fl + smoothstep(0.55, 0.92, fr)) * step, 0.7);
  }
  h += fbm2(N4, x * 0.035, z * 0.035, 2) * 5 * wallT;
  const far = smoothstep(500, 1400, adx);
  if (far > 0) h += far * 150 * ridged2(N1, x * 0.0015, z * 0.0015, 3);
  return h;
}

function fortH(x, z, adx) {
  let h = 1.4;
  h += smoothstep(92, 97, adx) * 5;                                   // raised decks
  h += smoothstep(176, 180, adx) * (1 - smoothstep(196, 200, adx)) * 30; // outer walls
  const far = smoothstep(320, 950, adx);
  if (far > 0) h = lerp(h, 25 + 170 * ridged2(N3, x * 0.0016, z * 0.0016, 4), far);
  return h;
}

function bossH(x, z, adx) {
  let h = -30 + 6 * N2.noise(x * 0.008, z * 0.008);
  const far = smoothstep(900, 1700, adx);
  if (far > 0) h = lerp(h, 20 + 240 * ridged2(N4, x * 0.001, z * 0.001, 4), far);
  return h;
}

const _hw = { ocean: 1, canyon: 0, fort: 0, boss: 0 };
export function terrainHeight(x, z) {
  const d = -z;
  const adx = Math.abs(x - pathX(d));
  const w = zoneW(d, _hw);
  let h = 0;
  if (w.ocean > 0.001) h += w.ocean * oceanH(x, z, adx);
  if (w.canyon > 0.001) h += w.canyon * canyonH(x, z, adx, d);
  if (w.fort > 0.001) h += w.fort * fortH(x, z, adx);
  if (w.boss > 0.001) h += w.boss * bossH(x, z, adx);
  return h;
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

const _cw = { ocean: 1, canyon: 0, fort: 0, boss: 0 };
const _col = new THREE.Color();
const PAL = {
  deep: new THREE.Color('#1f4a4f'), shallow: new THREE.Color('#3f7d6f'), sand: new THREE.Color('#e3cf98'),
  grass: new THREE.Color('#5e8f35'), grass2: new THREE.Color('#7aa845'), rock: new THREE.Color('#7b6f63'), rock2: new THREE.Color('#948a7c'),
  peak: new THREE.Color('#c8c2ba'), snow: new THREE.Color('#f1f3f6'),
  bed: new THREE.Color('#5b4636'),
  strata: ['#b4532f', '#d27b45', '#e6a468', '#9b4528', '#d98c57', '#c36a3b'].map(c => new THREE.Color(c)),
  mesa: new THREE.Color('#b27b4a'), scrub: new THREE.Color('#7e8a45'),
  metal: new THREE.Color('#2e333b'), metalLine: new THREE.Color('#4d5561'), runway: new THREE.Color('#262a31'), deck: new THREE.Color('#474d57'), wall: new THREE.Color('#2b2f37'),
  hazard: new THREE.Color('#d9a02a'), duskRock: new THREE.Color('#5d4a60'), duskPeak: new THREE.Color('#8a7690'),
};

function faceColor(x, y, z, ny, out) {
  const w = zoneW(-z, _cw);
  const jitter = 0.9 + 0.2 * hash2(Math.floor(x * 3.1), Math.floor(z * 2.7));
  let r = 0, g = 0, b = 0;
  const add = (c, k) => { r += c.r * k; g += c.g * k; b += c.b * k; };
  if (w.ocean + w.boss > 0.001) {
    const k = w.ocean + w.boss;
    let c;
    if (y < -9) c = PAL.deep;
    else if (y < -0.8) c = _col.copy(PAL.deep).lerp(PAL.shallow, (y + 9) / 8.2);
    else if (y < 2.6) c = PAL.sand;
    else if (y > 230) c = PAL.snow;
    else if (y > 140) c = PAL.peak;
    else if (ny < 0.72) c = (hash2(x | 0, z | 0) > 0.5 ? PAL.rock : PAL.rock2);
    else c = (y > 40 && ny < 0.86) ? PAL.rock2 : (hash2((x * 0.2) | 0, (z * 0.2) | 0) > 0.5 ? PAL.grass : PAL.grass2);
    add(c === _col ? _col : c, k);
  }
  if (w.canyon > 0.001) {
    let c;
    if (y < 0.5) c = PAL.bed;
    else if (ny > 0.9 && y > 80) c = hash2((x * 0.1) | 0, (z * 0.1) | 0) > 0.8 ? PAL.scrub : PAL.mesa;
    else {
      const band = Math.floor((y + 4 * N3.noise(x * 0.01, z * 0.01)) / 9);
      c = PAL.strata[((band % 6) + 6) % 6];
    }
    add(c, w.canyon);
  }
  if (w.fort > 0.001) {
    let c;
    if (y > 40) c = ny > 0.8 ? PAL.duskPeak : PAL.duskRock;
    else if (y > 20) c = PAL.wall;
    else if (y > 4) c = PAL.deck;
    else {
      // city-block pattern: dark service roads every 48 m, lighter deck plates in between
      const lx = x - pathX(-z);
      const bx = Math.floor(lx / 8), bz = Math.floor(z / 8);
      const road = (((bx % 6) + 6) % 6 === 0) || (((bz % 6) + 6) % 6 === 0);
      c = Math.abs(lx) < 10 ? PAL.runway : road ? PAL.metal : PAL.metalLine;
    }
    add(c, w.fort);
  }
  out.setRGB(r * jitter, g * jitter, b * jitter);
  return out;
}

let terrainMat = null;
const chunks = new Map();
const decoByChunk = new Map();

function buildChunk(ci) {
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
  if (m) { G.scene.remove(m); m.geometry.dispose(); chunks.delete(ci); }
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
}

function buildDecorations(ci) {
  const list = [];
  const rnd = mulberry32(ci * 7919 + 13);
  const d0 = ci * CHUNK;
  const w = zoneW(d0 + CHUNK / 2, { ocean: 1, canyon: 0, fort: 0, boss: 0 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  // Trees on islands (ocean) and scrub on mesas (canyon)
  if (w.ocean + w.canyon > 0.2) {
    const trees = [];
    for (let i = 0; i < 160 && trees.length < 70; i++) {
      const d = d0 + rnd() * CHUNK;
      const lx = (rnd() * 2 - 1) * 700;
      const x = pathX(d) + lx, z = -d;
      const h = terrainHeight(x, z);
      const ok = w.canyon > 0.5 ? (h > 95 && h < 200) : (h > 3.2 && h < 70);
      if (!ok) continue;
      const hx = terrainHeight(x + 3, z), hz = terrainHeight(x, z + 3);
      if (Math.abs(hx - h) > 2.4 || Math.abs(hz - h) > 2.4) continue;
      const sc = (w.canyon > 0.5 ? 0.6 : 0.8) + rnd() * 0.9;
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      s.set(sc, sc * (0.85 + rnd() * 0.4), sc);
      p.set(x, h - 0.4, z);
      trees.push(m4.compose(p, q, s).clone());
    }
    if (trees.length) {
      const im = new THREE.InstancedMesh(treeGeo, decoMat, trees.length);
      trees.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      G.scene.add(im); list.push(im);
    }
  }
  // Rocks in canyon river / ocean shallows
  if (w.canyon > 0.3 || w.ocean > 0.3) {
    const rocks = [];
    for (let i = 0; i < 40 && rocks.length < 22; i++) {
      const d = d0 + rnd() * CHUNK;
      const lx = (rnd() * 2 - 1) * (w.canyon > 0.3 ? 70 : 500);
      const x = pathX(d) + lx, z = -d;
      const h = terrainHeight(x, z);
      if (h < -3.5 || h > (w.canyon > 0.3 ? 8 : 30)) continue;
      const sc = 0.6 + rnd() * 1.6;
      q.setFromEuler(new THREE.Euler(rnd() * 0.5, rnd() * 6.28, rnd() * 0.5));
      s.set(sc, sc, sc);
      p.set(x, h, z);
      rocks.push(m4.compose(p, q, s).clone());
    }
    if (rocks.length) {
      const im = new THREE.InstancedMesh(rockGeo, decoMat, rocks.length);
      rocks.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      G.scene.add(im); list.push(im);
    }
  }
  // Fortress buildings + runway lights
  if (w.fort > 0.4) {
    const bl = [], lights = [];
    for (let i = 0; i < 14; i++) {
      const d = d0 + rnd() * CHUNK;
      const side = rnd() < 0.5 ? -1 : 1;
      const lx = side * (70 + rnd() * 95);
      const x = pathX(d) + lx, z = -d;
      const base = terrainHeight(x, z);
      const hgt = 14 + rnd() * rnd() * 70;
      const wx = 10 + rnd() * 20, wz = 10 + rnd() * 22;
      q.setFromAxisAngle(up, (rnd() - 0.5) * 0.3);
      s.set(wx, hgt, wz);
      p.set(x, base - 0.5, z);
      bl.push(m4.compose(p, q, s).clone());
      if (hgt > 40) { p.set(x, base + hgt + 1.2, z); s.set(1, 1, 1); lights.push(m4.compose(p, q, s).clone()); }
    }
    // runway lights along the corridor edges
    for (let k = 0; k < CHUNK; k += 20) {
      const d = d0 + k;
      for (const side of [-1, 1]) {
        const x = pathX(d) + side * 52, z = -d;
        p.set(x, terrainHeight(x, z) + 0.4, z); s.set(0.8, 0.5, 0.8);
        lights.push(m4.compose(p, q.identity(), s).clone());
      }
    }
    if (bl.length) {
      const im = new THREE.InstancedMesh(bldgGeo, bldgMat, bl.length);
      bl.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      G.scene.add(im); list.push(im);
    }
    if (lights.length) {
      const im = new THREE.InstancedMesh(lightGeo, lightMat, lights.length);
      lights.forEach((m, i) => im.setMatrixAt(i, m));
      im.computeBoundingSphere();
      G.scene.add(im); list.push(im);
    }
    // glowing runway centre-line dashes
    const dashes = [];
    for (let k = 0; k < CHUNK; k += 16) {
      const d = d0 + k;
      const x = pathX(d), z = -d;
      const slope = (pathX(d + 2) - pathX(d - 2)) * 0.25;
      q.setFromAxisAngle(up, -Math.atan(slope));
      p.set(x, terrainHeight(x, z) + 0.25, z); s.set(1, 1, 1);
      dashes.push(m4.compose(p, q, s).clone());
    }
    const dm = new THREE.InstancedMesh(lightGeoCyan, lightMat, dashes.length);
    dashes.forEach((m, i) => dm.setMatrixAt(i, m));
    dm.computeBoundingSphere();
    G.scene.add(dm); list.push(dm);
  }
  decoByChunk.set(ci, list);
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
const RAW_PALETTES = {
  sunset: {
    zenith: '#2a58a6', mid: '#9dc0e8', horizon: '#ffc38c', fog: '#f0b88f', sun: '#ffd6a0', cloud: '#fff1e2', cloudShadow: '#a08aa6',
    hemiSky: '#a8c2ee', hemiGround: '#6d5242', waterDeep: '#0b3550', waterScatter: '#1d6a70', light: '#ffd9ae',
    sunElev: 11, sunAz: -38, sunDisc: 10, sunLight: 2.7, fogDensity: 0.0007, fogStart: 220, fogHeight: 0.0009, fogFalloff: 0.016,
    glow: 0.34, cloudCover: 0.36, hemi: 1.0, stars: 0, exposure: 0.92, bloom: 0.42, env: 0.85,
  },
  canyon: {
    zenith: '#3160ae', mid: '#a3c2e6', horizon: '#ffb37a', fog: '#eba47c', sun: '#ffcf96', cloud: '#ffeedd', cloudShadow: '#b08a8e',
    hemiSky: '#b4c6ea', hemiGround: '#7f4b31', waterDeep: '#1f3a3d', waterScatter: '#3d6552', light: '#ffcf98',
    sunElev: 15, sunAz: -42, sunDisc: 10, sunLight: 3.0, fogDensity: 0.00062, fogStart: 240, fogHeight: 0.0012, fogFalloff: 0.012,
    glow: 0.34, cloudCover: 0.3, hemi: 0.95, stars: 0, exposure: 0.92, bloom: 0.42, env: 0.8,
  },
  dusk: {
    zenith: '#1a1d52', mid: '#9a5c9c', horizon: '#ff8c6e', fog: '#b9657e', sun: '#ff9b6e', cloud: '#ffb0a8', cloudShadow: '#5a3a6e',
    hemiSky: '#7a78c0', hemiGround: '#3f2d40', waterDeep: '#141638', waterScatter: '#3a2b62', light: '#ffab86',
    sunElev: 4.5, sunAz: -30, sunDisc: 9, sunLight: 2.0, fogDensity: 0.0007, fogStart: 200, fogHeight: 0.001, fogFalloff: 0.014,
    glow: 0.5, cloudCover: 0.5, hemi: 1.05, stars: 0.25, exposure: 1.05, bloom: 0.58, env: 0.8,
  },
  twilight: {
    zenith: '#0b1236', mid: '#5a4696', horizon: '#e27566', fog: '#6e4c7e', sun: '#ff8456', cloud: '#e98a90', cloudShadow: '#2b2248',
    hemiSky: '#6c78c8', hemiGround: '#2c2340', waterDeep: '#0b1030', waterScatter: '#2c2c6a', light: '#ffb49a',
    sunElev: 1.4, sunAz: -24, sunDisc: 9, sunLight: 1.5, fogDensity: 0.00062, fogStart: 220, fogHeight: 0.0008, fogFalloff: 0.014,
    glow: 0.6, cloudCover: 0.35, hemi: 1.15, stars: 0.85, exposure: 1.1, bloom: 0.6, env: 0.9,
  },
};
export const PALETTES = {};
const PALETTE_KEYS = [
  { at: 0, name: 'sunset' }, { at: 4200, name: 'sunset' }, { at: 5400, name: 'canyon' }, { at: 7400, name: 'canyon' },
  { at: 8600, name: 'dusk' }, { at: 10200, name: 'dusk' }, { at: 11300, name: 'twilight' },
];
const envMaps = {};
let currentEnv = null;
const curPal = {};

export function paletteAt(d, out = curPal) {
  let a = PALETTE_KEYS[0], b = PALETTE_KEYS[0];
  for (let i = 0; i < PALETTE_KEYS.length; i++) {
    if (PALETTE_KEYS[i].at <= d) { a = PALETTE_KEYS[i]; b = PALETTE_KEYS[Math.min(i + 1, PALETTE_KEYS.length - 1)]; }
  }
  const t = b.at > a.at ? smoothstep(a.at, b.at, d) : 0;
  lerpPalette(PALETTES[a.name], PALETTES[b.name], t, out);
  out._dominant = t < 0.5 ? a.name : b.name;
  return out;
}

// ============================================================ Init / update
export function initWorld() {
  for (const k in RAW_PALETTES) PALETTES[k] = preparePalette(RAW_PALETTES[k]);
  terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.0, envMapIntensity: 0.55 });
  patchFog(terrainMat);
  initDecorations();
  createWater();
  createClouds();
  for (const k in PALETTES) envMaps[k] = makeEnvMap(PALETTES[k]);
}

export function setWorldAtmosphere(d) {
  const p = paletteAt(d);
  applyPalette(p);
  WATER_U.uDeep.value.copy(p.waterDeep);
  WATER_U.uScatter.value.copy(p.waterScatter);
  WATER_U.fogColor.value.copy(p.fog);
  WATER_U.fogDensity.value = p.fogDensity;
  const env = envMaps[p._dominant];
  if (env && env !== currentEnv) { G.scene.environment = env; currentEnv = env; }
  return p;
}

export function updateWorld(dt, d, focus) {
  ATMO.uTime.value += dt;
  const p = setWorldAtmosphere(d);
  updateTerrain(d);
  const cam = G.camera.position;
  water.position.set(Math.round(cam.x / 50) * 50, 0, Math.round(cam.z / 50) * 50);
  updateClouds(d, p.cloudCover);
}
