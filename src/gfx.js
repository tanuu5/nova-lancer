// Renderer, post-processing, atmosphere (sky + fog), environment maps and procedural textures.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G, clamp, lerp, damp, Simplex2, fbm2, mulberry32, smoothstep } from './core.js';

// ============================================================ Shared atmosphere uniforms
export const ATMO = {
  uSunDir: { value: new THREE.Vector3(-0.3, 0.2, -1).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
  uSunDisc: { value: 30 },
  uSunSize: { value: 0.9994 },
  uZenith: { value: new THREE.Color('#1c3a70') },
  uMid: { value: new THREE.Color('#8fb0d8') },
  uHorizon: { value: new THREE.Color('#f7b27a') },
  uGround: { value: new THREE.Color('#e49a6a') },
  uCloudColor: { value: new THREE.Color('#fff1e0') },
  uCloudShadow: { value: new THREE.Color('#7d6a86') },
  uCloudCover: { value: 0.45 },
  uStars: { value: 0 },
  uTime: { value: 0 },
  uGlow: { value: new THREE.Color(0.1, 0.05, 0.02) },
};

// Extra fog uniforms injected into every patched material (shared objects → global updates).
export const FOG = {
  uFogSunDir: ATMO.uSunDir,
  uFogSunColor: { value: new THREE.Color(0, 0, 0) },
  uFogHeightDensity: { value: 0.0 },
  uFogHeightFalloff: { value: 0.0 },
  uFogStart: { value: 150.0 },
};

// GLSL shared between sky, water and custom materials.
export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.0,0.0)), u.x), mix(hash12(i+vec2(0.0,1.0)), hash12(i+vec2(1.0,1.0)), u.x), u.y); }
float fbm5(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = m * p; a *= 0.5; } return s; }
float fbm3(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = m * p; a *= 0.5; } return s; }
`;

export const GLSL_SKY = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uGlow;
vec3 sunGlowTerm(float sd){ return uGlow * (pow(sd, 4.0) * 0.55 + pow(sd, 24.0) * 1.1); }
vec3 skyBase(vec3 d){
  float h = max(d.y, 0.0);
  float t = pow(h, 0.5);
  vec3 col = mix(mix(uHorizon, uMid, smoothstep(0.0, 0.42, t)), uZenith, smoothstep(0.3, 1.0, t));
  float sd = max(dot(d, uSunDir), 0.0);
  col += sunGlowTerm(sd) * (1.0 - smoothstep(0.0, 0.5, h) * 0.7);
  col = mix(col, uGround + sunGlowTerm(sd), smoothstep(0.0, -0.05, d.y));
  return col;
}
`;

// Fog evaluated identically for built-in and custom materials.
export const GLSL_FOG_FN = /* glsl */`
uniform float uFogStart;
vec3 applyAtmoFog(vec3 col, vec3 viewPos, vec3 fogCol, float density, vec3 sunDir, vec3 sunFogCol, float hDensity, float hFalloff){
  float dist = length(viewPos);
  vec3 rd = (vec4(viewPos, 0.0) * viewMatrix).xyz / max(dist, 1e-4);
  float d2 = max(dist - uFogStart, 0.0);
  float od = density * d2;
  if (hFalloff > 1e-5 && hDensity > 0.0 && d2 > 0.0) {
    float b = hFalloff; float ry = rd.y;
    float y0 = cameraPosition.y + ry * min(dist, uFogStart);
    float e = clamp(-d2 * ry * b, -60.0, 60.0);
    float k = abs(e) < 1e-3 ? d2 : (1.0 - exp(e)) / (ry * b);
    od += hDensity * exp(clamp(-y0 * b, -60.0, 60.0)) * k;
  }
  float f = 1.0 - exp(-od);
  float sd = max(dot(rd, sunDir), 0.0);
  vec3 fc = fogCol + sunFogCol * (pow(sd, 4.0) * 0.55 + pow(sd, 24.0) * 1.1);
  return mix(col, fc, f);
}
float atmoFogFactor(vec3 viewPos, float density){ return 1.0 - exp(-density * length(viewPos)); }
`;

function installFogChunks() {
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\n varying vec3 vFogViewPos;\n#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG\n vFogViewPos = mvPosition.xyz;\n#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogViewPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
  uniform vec3 uFogSunDir; uniform vec3 uFogSunColor; uniform float uFogHeightDensity; uniform float uFogHeightFalloff;
  ${GLSL_FOG_FN}
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogD = fogDensity;
  #else
    float fogD = 3.0 / max(fogFar, 1.0);
  #endif
  gl_FragColor.rgb = applyAtmoFog(gl_FragColor.rgb, vFogViewPos, fogColor, fogD, uFogSunDir, uFogSunColor, uFogHeightDensity, uFogHeightFalloff);
#endif`;
}

// Attach the shared fog uniforms to a built-in material (keeps an existing onBeforeCompile).
export function patchFog(mat, extra) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FOG);
    if (extra) extra(shader);
  };
  if (extra) mat.customProgramCacheKey = () => 'fog+' + extra.toString();
  return mat;
}

// ============================================================ Renderer / composer
let composer, renderPass, bloomPass, outputPass, finalPass;
export const GFX = {};
let basePixelRatio = 1, dynScale = 1;
const frameTimes = [];

export const POST = {
  vignette: 0.42, grain: 0.035, ca: 0.0012, radial: 0, flash: 0, flashColor: new THREE.Color(1, 1, 1),
  damage: 0, fade: 1, fadeColor: new THREE.Color(0, 0, 0), letterbox: 0, sunVis: 0, sunPos: new THREE.Vector2(0.5, 0.5),
  radialCenter: new THREE.Vector2(0.5, 0.5), exposure: 1.0, bloom: 0.75,
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 }, uAspect: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.4 }, uGrain: { value: 0.03 }, uCA: { value: 0.001 },
    uRadial: { value: 0 }, uRadialCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uDamage: { value: 0 }, uFade: { value: 0 }, uFadeColor: { value: new THREE.Color(0, 0, 0) },
    uLetterbox: { value: 0 },
    uSunPos: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 }, uSunCol: { value: new THREE.Color(1, 0.8, 0.6) },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uAspect, uVignette, uGrain, uCA, uRadial, uFlash, uDamage, uFade, uLetterbox, uSunVis;
    uniform vec2 uRes, uRadialCenter, uSunPos; uniform vec3 uFlashColor, uFadeColor, uSunCol;
    varying vec2 vUv;
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec3 sampleCA(vec2 uv, vec2 dir, float amt){
      return vec3(texture2D(tDiffuse, uv + dir * amt).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - dir * amt).b);
    }
    float circ(vec2 uv, vec2 c, float r, float soft){ float d = length((uv - c) * vec2(uAspect, 1.0)); return smoothstep(r, r * soft, d); }
    void main(){
      vec2 uv = vUv;
      vec2 fc = uv - 0.5;
      float r = length(fc * vec2(uAspect, 1.0));
      float ca = uCA * (0.35 + r * r * 3.0);
      vec3 col;
      if (uRadial > 0.002) {
        vec2 dir = uv - uRadialCenter;
        float edge = smoothstep(0.05, 0.5, length(dir * vec2(uAspect, 1.0)));
        col = vec3(0.0);
        for (int i = 0; i < 10; i++) {
          float s = 1.0 - uRadial * 0.011 * float(i) * edge;
          col += sampleCA(uRadialCenter + dir * s, fc, ca);
        }
        col *= 0.1;
      } else {
        col = sampleCA(uv, fc, ca);
      }
      // Lens flare
      if (uSunVis > 0.003) {
        vec2 sp = uSunPos; vec2 axis = vec2(0.5) - sp;
        vec3 fl = vec3(0.0);
        fl += vec3(0.35, 0.55, 1.0) * circ(uv, sp + axis * 0.55, 0.035, 0.6) * 0.10;
        fl += vec3(1.0, 0.55, 0.25) * circ(uv, sp + axis * 0.85, 0.06, 0.85) * 0.07;
        fl += vec3(0.4, 1.0, 0.6) * circ(uv, sp + axis * 1.25, 0.02, 0.2) * 0.12;
        fl += vec3(0.6, 0.4, 1.0) * circ(uv, sp + axis * 1.55, 0.11, 0.9) * 0.05;
        fl += vec3(1.0, 0.8, 0.5) * circ(uv, sp + axis * 1.9, 0.045, 0.4) * 0.08;
        // ring halo
        float dd = length((uv - (sp + axis * 1.1)) * vec2(uAspect, 1.0));
        fl += vec3(0.5, 0.7, 1.0) * smoothstep(0.035, 0.0, abs(dd - 0.23)) * 0.012;
        // anamorphic streak + glow
        vec2 ds = (uv - sp) * vec2(uAspect, 1.0);
        fl += uSunCol * exp(-abs(ds.y) * 220.0) * exp(-abs(ds.x) * 2.6) * 0.35;
        fl += uSunCol * exp(-dot(ds, ds) * 30.0) * 0.18;
        col += fl * uSunVis;
      }
      // Damage: red edges
      col = mix(col, vec3(0.9, 0.05, 0.08), uDamage * smoothstep(0.25, 0.95, r) * 0.85);
      // Vignette
      col *= 1.0 - uVignette * smoothstep(0.38, 1.1, r);
      col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
      col += (h12(uv * uRes + fract(uTime * 7.13) * 91.7) - 0.5) * uGrain;
      float lb = uLetterbox * 0.115;
      col *= step(lb, uv.y) * step(uv.y, 1.0 - lb);
      col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function initRenderer(container) {
  installFogChunks();
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.id = 'gl';
  container.prepend(renderer.domElement);
  G.renderer = renderer;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xf0b080, 0.0004);
  G.scene = scene;
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 9000);
  G.camera = camera;

  basePixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(basePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.42, 1.05);
  // Safety net: never let NaN/Inf or extreme fireflies into the blur chain (they smear into black blocks).
  const hp = bloomPass.materialHighPassFilter;
  hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );',
    'vec4 texel = texture2D( tDiffuse, vUv );\n\t\t\tif (any(isnan(texel)) || any(isinf(texel))) texel = vec4(0.0);\n\t\t\ttexel = min(texel, vec4(60.0));');
  hp.needsUpdate = true;
  composer.addPass(bloomPass);
  outputPass = new OutputPass();
  composer.addPass(outputPass);
  finalPass = new ShaderPass(FinalShader);
  composer.addPass(finalPass);
  Object.assign(GFX, { composer, renderPass, bloomPass, outputPass, finalPass });

  window.addEventListener('resize', resize);
  resize();
  applyQuality(G.settings.quality);
  return renderer;
}

export function applyQuality(q) {
  const renderer = G.renderer;
  if (!renderer) return;
  G.quality = q;
  const dpr = window.devicePixelRatio || 1;
  if (q === 'low') { basePixelRatio = Math.min(dpr, 1) * 0.75; renderer.shadowMap.enabled = false; bloomPass.enabled = true; }
  else if (q === 'medium') { basePixelRatio = Math.min(dpr, 1.25); renderer.shadowMap.enabled = true; bloomPass.enabled = true; }
  else { basePixelRatio = Math.min(dpr, q === 'high' ? 2 : 1.5); renderer.shadowMap.enabled = true; bloomPass.enabled = true; }
  dynScale = 1;
  // Force materials to recompile if shadow state changed.
  G.scene?.traverse(o => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach(mm => { mm.needsUpdate = true; }); } });
  resize();
}

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = clamp(basePixelRatio * dynScale, 0.5, 2);
  G.renderer.setPixelRatio(pr);
  G.renderer.setSize(w, h);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  G.camera.aspect = w / h;
  G.camera.updateProjectionMatrix();
  finalPass.uniforms.uAspect.value = w / h;
  finalPass.uniforms.uRes.value.set(w * pr, h * pr);
}

// Adaptive resolution: keep frame time near budget.
let dynCooldown = 0;
function adaptResolution(rdt) {
  if (G.settings.quality !== 'auto') return;
  frameTimes.push(rdt);
  if (frameTimes.length > 45) frameTimes.shift();
  dynCooldown -= rdt;
  if (dynCooldown > 0 || frameTimes.length < 45) return;
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const med = sorted[(sorted.length / 2) | 0];
  if (med > 1 / 50 && dynScale > 0.55) { dynScale = Math.max(0.55, dynScale - 0.1); resize(); dynCooldown = 1.5; frameTimes.length = 0; }
  else if (med < 1 / 75 && dynScale < 1) { dynScale = Math.min(1, dynScale + 0.05); resize(); dynCooldown = 3; frameTimes.length = 0; }
}

export function renderFrame(rdt) {
  const u = finalPass.uniforms;
  u.uTime.value = G.clock;
  u.uVignette.value = POST.vignette;
  u.uGrain.value = POST.grain;
  u.uCA.value = POST.ca;
  u.uRadial.value = POST.radial;
  u.uRadialCenter.value.copy(POST.radialCenter);
  u.uFlash.value = POST.flash;
  u.uFlashColor.value.copy(POST.flashColor);
  u.uDamage.value = POST.damage;
  u.uFade.value = POST.fade;
  u.uFadeColor.value.copy(POST.fadeColor);
  u.uLetterbox.value = POST.letterbox;
  u.uSunVis.value = POST.sunVis;
  u.uSunPos.value.copy(POST.sunPos);
  u.uSunCol.value.copy(ATMO.uSunColor.value).multiplyScalar(0.6);
  bloomPass.strength = POST.bloom;
  G.renderer.toneMappingExposure = POST.exposure;
  composer.render(rdt);
  adaptResolution(rdt);
}

// Decay transient post effects (call every frame with real dt)
export function updatePost(rdt) {
  POST.flash = damp(POST.flash, 0, 7, rdt);
  POST.damage = damp(POST.damage, 0, 2.2, rdt);
}

// ============================================================ Sky
let skyMesh = null;
export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: ATMO,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCloudColor; uniform vec3 uCloudShadow; uniform float uCloudCover; uniform float uStars; uniform float uTime; uniform float uSunDisc; uniform float uSunSize;
      varying vec3 vDir;
      ${GLSL_NOISE}
      ${GLSL_SKY}
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = skyBase(d);
        float sd = dot(d, uSunDir);
        if (uStars > 0.001 && d.y > -0.02) {
          vec3 sp = d * 260.0; vec3 id = floor(sp); vec3 f = fract(sp) - 0.5;
          float h = hash13(id);
          float st = step(0.9975, h) * smoothstep(0.32, 0.0, length(f)) * (0.55 + 0.45 * sin(uTime * 2.5 + h * 300.0));
          col += vec3(0.9, 0.95, 1.0) * st * uStars * 2.5 * smoothstep(-0.02, 0.25, d.y);
        }
        // Sun disc
        float disc = smoothstep(uSunSize - 0.00012, uSunSize + 0.00004, sd);
        col += uSunColor * disc * uSunDisc;
        // Clouds (high layer, projected onto a dome)
        if (d.y > 0.0 && uCloudCover > 0.001) {
          vec2 p = d.xz / (d.y + 0.07) * 0.85 + vec2(uTime * 0.010, uTime * 0.003);
          float n = fbm5(p);
          float c = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.28, n);
          float n2 = fbm3(p + uSunDir.xz * 0.14);
          float lit = clamp((n - n2) * 3.2 + 0.5, 0.0, 1.0);
          vec3 cc = mix(uCloudShadow, uCloudColor, lit);
          cc += uSunColor * 0.25 * pow(max(sd, 0.0), 10.0) * (1.0 - c * 0.6);
          float fade = smoothstep(0.0, 0.1, d.y);
          col = mix(col, cc, c * fade * 0.92);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
  skyMesh.renderOrder = -100;
  skyMesh.frustumCulled = false;
  skyMesh.onBeforeRender = (r, s, cam) => { skyMesh.position.copy(cam.position); skyMesh.updateMatrixWorld(); };
  G.scene.add(skyMesh);
  return skyMesh;
}

// ============================================================ Lights
export const LIGHTS = { sun: null, hemi: null, flash: [] };
export function createLights() {
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 900;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  G.scene.add(sun);
  G.scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0x8fb4ff, 0x4a3a30, 0.6);
  G.scene.add(hemi);
  LIGHTS.sun = sun; LIGHTS.hemi = hemi;
  for (let i = 0; i < 3; i++) {
    const pl = new THREE.PointLight(0xffaa55, 0, 160, 1.6);
    pl.userData.life = 0; pl.userData.maxLife = 1; pl.userData.peak = 0;
    G.scene.add(pl);
    LIGHTS.flash.push(pl);
  }
}

export function flashLight(pos, color, intensity, life = 0.35) {
  let best = LIGHTS.flash[0];
  for (const l of LIGHTS.flash) if (l.userData.life <= 0 || l.intensity < best.intensity) best = l;
  best.position.copy(pos);
  best.color.set(color);
  best.userData.peak = intensity;
  best.userData.life = life;
  best.userData.maxLife = life;
  best.intensity = intensity;
}

export function updateLights(dt, focus) {
  for (const l of LIGHTS.flash) {
    if (l.userData.life > 0) {
      l.userData.life -= dt;
      const t = Math.max(0, l.userData.life / l.userData.maxLife);
      l.intensity = l.userData.peak * t * t;
    } else l.intensity = 0;
  }
  if (focus) {
    const sun = LIGHTS.sun;
    const dir = ATMO.uSunDir.value;
    // Snap the shadow camera to texel increments to avoid shimmering.
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(dir, 400);
    sun.target.updateMatrixWorld();
  }
}

// ============================================================ Environment maps
let pmrem = null;
export function makeEnvMap(palette) {
  if (!pmrem) pmrem = new THREE.PMREMGenerator(G.renderer);
  const envScene = new THREE.Scene();
  const uniforms = THREE.UniformsUtils.clone(ATMO);
  applyPaletteToUniforms(palette, uniforms);
  uniforms.uSunDisc.value = 6;
  const mat = skyMesh.material.clone();
  mat.uniforms = uniforms;
  const m = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat);
  m.onBeforeRender = () => {};
  envScene.add(m);
  const rt = pmrem.fromScene(envScene, 0.02, 0.1, 200);
  m.geometry.dispose(); mat.dispose();
  return rt.texture;
}

// ============================================================ Palettes
const _c = new THREE.Color();
const _c2 = new THREE.Color();
export function sunDirFrom(elevDeg, azDeg, out = new THREE.Vector3()) {
  const e = elevDeg * Math.PI / 180, a = azDeg * Math.PI / 180;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

const COLOR_KEYS = ['zenith', 'mid', 'horizon', 'fog', 'sun', 'cloud', 'cloudShadow', 'hemiSky', 'hemiGround', 'waterDeep', 'waterScatter', 'light'];
const NUM_KEYS = ['sunElev', 'sunAz', 'sunDisc', 'sunLight', 'fogDensity', 'fogStart', 'fogHeight', 'fogFalloff', 'glow', 'cloudCover', 'hemi', 'stars', 'exposure', 'bloom', 'env'];

export function lerpPalette(a, b, t, out = {}) {
  for (const k of COLOR_KEYS) {
    if (!out[k] || !(out[k] instanceof THREE.Color)) out[k] = new THREE.Color();
    out[k].copy(a[k]).lerp(b[k], t);
  }
  for (const k of NUM_KEYS) out[k] = lerp(a[k], b[k], t);
  return out;
}

export function preparePalette(p) {
  const o = {};
  for (const k of COLOR_KEYS) o[k] = new THREE.Color(p[k]);
  for (const k of NUM_KEYS) o[k] = p[k];
  return o;
}

export function applyPaletteToUniforms(p, U) {
  sunDirFrom(p.sunElev, p.sunAz, U.uSunDir.value);
  U.uSunColor.value.copy(p.sun);
  U.uSunDisc.value = p.sunDisc;
  U.uZenith.value.copy(p.zenith);
  U.uMid.value.copy(p.mid);
  U.uHorizon.value.copy(p.horizon);
  U.uGround.value.copy(p.fog);
  U.uCloudColor.value.copy(p.cloud);
  U.uCloudShadow.value.copy(p.cloudShadow);
  U.uCloudCover.value = p.cloudCover;
  U.uStars.value = p.stars;
  U.uGlow.value.copy(p.sun).multiplyScalar(p.glow);
}

export function applyPalette(p) {
  applyPaletteToUniforms(p, ATMO);
  const scene = G.scene;
  scene.fog.color.copy(p.fog);
  scene.fog.density = p.fogDensity;
  FOG.uFogSunColor.value.copy(p.sun).multiplyScalar(p.glow);
  FOG.uFogHeightDensity.value = p.fogHeight;
  FOG.uFogHeightFalloff.value = p.fogFalloff;
  FOG.uFogStart.value = p.fogStart;
  LIGHTS.sun.color.copy(p.light);
  LIGHTS.sun.intensity = p.sunLight;
  LIGHTS.hemi.color.copy(p.hemiSky);
  LIGHTS.hemi.groundColor.copy(p.hemiGround);
  LIGHTS.hemi.intensity = p.hemi;
  scene.environmentIntensity = p.env;
  POST.exposure = p.exposure;
  POST.bloom = p.bloom;
}

// ============================================================ Procedural textures
export const TEX = {};

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

export function makeTextures() {
  const noise = new Simplex2(99);
  // ---- Particle atlas (2x2): 0 glow, 1 smoke, 2 star/flare, 3 ring
  const S = 256;
  const atlas = canvas(S * 2, S * 2);
  const ctx = atlas.getContext('2d');
  const img = ctx.createImageData(S * 2, S * 2);
  const data = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
      const r = Math.sqrt(u * u + v * v);
      // glow
      let a = Math.exp(-r * r * 4.5) * (1 - smoothstep(0.85, 1, r));
      put(data, x, y, 255, 255, 255, a);
      // smoke
      const n = fbm2(noise, u * 2.2 + 5, v * 2.2 + 3, 5) * 0.5 + 0.5;
      const n2 = fbm2(noise, u * 4.1 - 7, v * 4.1 + 1, 3) * 0.5 + 0.5;
      let sm = clamp((1 - r) * 1.35, 0, 1);
      sm = Math.pow(sm, 1.3) * smoothstep(0.25, 0.75, n * 0.75 + sm * 0.45);
      const shade = 200 + 55 * clamp((0.5 - v * 0.5) * 0.7 + n2 * 0.5, 0, 1);
      put(data, x + S, y, shade, shade, shade, clamp(sm, 0, 1));
      // star / flare
      const ang = Math.atan2(v, u);
      const rays = Math.pow(Math.abs(Math.cos(ang * 2)), 60) * Math.exp(-r * 2.4) + Math.pow(Math.abs(Math.cos(ang * 2 + Math.PI / 4)), 90) * Math.exp(-r * 4) * 0.5;
      const core = Math.exp(-r * r * 30);
      put(data, x, y + S, 255, 255, 255, clamp(rays + core, 0, 1) * (1 - smoothstep(0.9, 1, r)));
      // ring
      const ring = Math.exp(-Math.pow((r - 0.78) / 0.07, 2)) + Math.exp(-Math.pow((r - 0.78) / 0.22, 2)) * 0.3;
      put(data, x + S, y + S, 255, 255, 255, clamp(ring, 0, 1) * (1 - smoothstep(0.95, 1, r)));
    }
  }
  function put(d, x, y, r, g, b, a) {
    const i = (y * S * 2 + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  TEX.atlas = new THREE.CanvasTexture(atlas);
  TEX.atlas.colorSpace = THREE.NoColorSpace;
  TEX.atlas.generateMipmaps = true;
  TEX.atlas.minFilter = THREE.LinearMipmapLinearFilter;

  // ---- Cloud billboard texture
  const C = 256;
  const cc = canvas(C, C);
  const cctx = cc.getContext('2d');
  const cimg = cctx.createImageData(C, C);
  const rnd = mulberry32(7);
  const blobs = [];
  for (let i = 0; i < 9; i++) blobs.push([rnd() * 0.9 - 0.45, rnd() * 0.35 - 0.1, 0.22 + rnd() * 0.22]);
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const u = (x + 0.5) / C * 2 - 1, v = (y + 0.5) / C * 2 - 1;
      let dens = 0;
      for (const [bx, by, br] of blobs) {
        const dx = u - bx, dy = (v - by) * 1.35;
        dens += Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / br);
      }
      const n = fbm2(noise, u * 3 + 11, v * 3 - 4, 5) * 0.5 + 0.5;
      dens = dens * (0.55 + 0.7 * n);
      dens *= smoothstep(1.0, 0.55, Math.abs(u)) * smoothstep(1.0, 0.45, Math.abs(v));
      const a = smoothstep(0.18, 0.75, dens);
      const shade = clamp(0.62 + (-v) * 0.35 + (n - 0.5) * 0.35, 0.3, 1);
      const i = (y * C + x) * 4;
      cimg.data[i] = cimg.data[i + 1] = cimg.data[i + 2] = Math.round(shade * 255);
      cimg.data[i + 3] = Math.round(a * 255);
    }
  }
  cctx.putImageData(cimg, 0, 0);
  TEX.cloud = new THREE.CanvasTexture(cc);
  TEX.cloud.colorSpace = THREE.NoColorSpace;

  // ---- Soft round shadow blob
  const sh = canvas(128, 128);
  const shctx = sh.getContext('2d');
  const grd = shctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.4)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  shctx.fillStyle = grd; shctx.fillRect(0, 0, 128, 128);
  TEX.shadow = new THREE.CanvasTexture(sh);

  // ---- Hex grid (shield / energy)
  const hx = canvas(256, 256);
  const hctx = hx.getContext('2d');
  hctx.fillStyle = '#000'; hctx.fillRect(0, 0, 256, 256);
  hctx.strokeStyle = '#fff'; hctx.lineWidth = 3;
  const R = 22, w = Math.sqrt(3) * R;
  for (let row = -1; row < 9; row++) {
    for (let col = -1; col < 8; col++) {
      const cx = col * w + (row & 1 ? w / 2 : 0), cy = row * R * 1.5;
      hctx.beginPath();
      for (let k = 0; k < 6; k++) { const an = Math.PI / 6 + k * Math.PI / 3; const px = cx + R * Math.cos(an), py = cy + R * Math.sin(an); k ? hctx.lineTo(px, py) : hctx.moveTo(px, py); }
      hctx.closePath(); hctx.stroke();
    }
  }
  TEX.hex = new THREE.CanvasTexture(hx);
  TEX.hex.wrapS = TEX.hex.wrapT = THREE.RepeatWrapping;
  TEX.hex.colorSpace = THREE.NoColorSpace;
  return TEX;
}
