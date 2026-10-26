// MISSION 02 "VIOLET SARGASSO" — the Sargasso drift, a graveyard of ships under a violet nebula: open space →
// asteroid belt → derelict hulls and the rotating wreck → the Kamaitachi mercenaries → the bone works → GASHADOKURO.
// The first space stage (world.space); the engine reads this file as a stage definition (fields in index.js).
import * as THREE from 'three';
import { G, rand, clamp, lerp, smoothstep, mulberry32, emit, after, easeInOutCubic, easeOutCubic } from '../core.js';
import { scheduleProp, Prop, registerProp, hitObstacle, props } from '../props.js';
import { radio, radioBusy, tip, warning } from '../hud.js';
import { WING, setWingStance, holdOut, kotaOr } from '../wingmen.js';
import { AudioSys } from '../audio.js';
import { railFrame, railToWorld, mergeGeometries, emissiveVertexMaterial } from '../world.js';
import { paint } from '../enemies.js';
import { glow, sparks, bigFlash, addShake } from '../fx.js';
import { spaceDecor } from '../space.js';
import { startRivals, engageRivals, updateRivals, retreatRivals, clearRivals, rivalUp, rivalTargets, rivalModels, RIVALS } from '../rivals.js';
import { vWing, snake, fromBehind, holders, ringOf, crossing, divers, turret, mine } from '../level.js';

const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

// ============================================================ Zones & rail path
const ZONE = { rocks: 2400, grave: 4700, wreck: 5300, rival: 6200, works: 9700, boss: 10950 };
const KOTA_BACK = 8000;     // Kota, if he bailed out in mission 01, rejoins here (mid-fight with the Kamaitachi)
const WING_REAR_AT = 640;

const _zw = {};
function zoneW(d, out = _zw) {
  const r = smoothstep(2300, 2700, d) * (1 - smoothstep(4500, 4900, d));
  const g = smoothstep(4600, 5000, d) * (1 - smoothstep(6000, 6400, d));
  const k = smoothstep(6100, 6500, d) * (1 - smoothstep(9500, 9900, d));
  const w = smoothstep(9600, 10000, d) * (1 - smoothstep(10800, 11200, d));
  out.rocks = r; out.grave = g; out.rival = k; out.works = w; out.boss = smoothstep(10800, 11200, d);
  out.drift = Math.max(0, 1 - r - g - k - w - out.boss);
  return out;
}

// A gentle weave (there is nothing out here to steer around), faded out over long stretches so the course runs
// dead straight through the rotating wreck.
function pathX(d) {
  const straight = smoothstep(3900, 5100, d) * (1 - smoothstep(5900, 7000, d));
  return (1 - straight) * (40 * Math.sin(d * 0.0009 + 0.4) + 14 * Math.sin(d * 0.0021 + 1.3));
}

function decorate(ci, KIT) {
  const z = zoneW(ci * KIT.CHUNK + KIT.CHUNK / 2, {});
  return spaceDecor(ci, KIT.CHUNK, {
    rocks: Math.round(7 + 26 * z.rocks + 8 * z.grave + 8 * z.rival + 4 * z.works + 2 * z.boss),
    junk: Math.round(3 + 16 * z.grave + 8 * z.rival + 12 * z.works + 4 * z.boss),
    huge: 0.3,
    keepOut: z.boss > 0.5 ? (u, v) => u < 60 && v > 20 : null,   // the upper left stays clear for the warp after the boss
  });
}

// ============================================================ Sky palettes (space: mid / horizon = nebula colours)
const SPACE_BASE = { waterDeep: '#000000', waterScatter: '#000000', fogHeight: 0, fogFalloff: 0, sunDisc: 7, sunElev: 26, sunAz: 62 };   // the star off to the right lights the rocks from the side
const PALETTES = {
  nebula: {
    ...SPACE_BASE, zenith: '#07051a', mid: '#4b2694', horizon: '#c43e8e', fog: '#24143f', sun: '#fff1da', cloud: '#ffb8e6', cloudShadow: '#0b0717',
    hemiSky: '#9c88e2', hemiGround: '#2a2046', light: '#f2e8ff', sunLight: 2.6, fogDensity: 0.00032, fogStart: 280,
    glow: 0.3, cloudCover: 1.0, hemi: 1.45, stars: 1.0, exposure: 1.0, bloom: 0.55, env: 0.9,
  },
  graveyard: {
    ...SPACE_BASE, zenith: '#050616', mid: '#352684', horizon: '#2f8ea6', fog: '#16183a', sun: '#e8f0ff', cloud: '#a8f2ff', cloudShadow: '#080714',
    hemiSky: '#7f8ce0', hemiGround: '#1c1e40', light: '#e0e8ff', sunLight: 2.3, fogDensity: 0.00036, fogStart: 240,
    glow: 0.26, cloudCover: 0.9, hemi: 1.4, stars: 0.9, exposure: 1.02, bloom: 0.55, env: 0.85,
  },
  works: {
    ...SPACE_BASE, zenith: '#0a0518', mid: '#5a2482', horizon: '#e0663e', fog: '#2c1530', sun: '#ffe2c0', cloud: '#ffc79a', cloudShadow: '#0e0712',
    hemiSky: '#c08ac8', hemiGround: '#3a1e2a', light: '#ffe0c8', sunLight: 2.5, fogDensity: 0.00036, fogStart: 240,
    glow: 0.34, cloudCover: 1.0, hemi: 1.4, stars: 0.85, exposure: 1.04, bloom: 0.6, env: 0.85,
  },
  boss: {
    ...SPACE_BASE, zenith: '#0c0414', mid: '#601c6c', horizon: '#e43c6a', fog: '#2e1028', sun: '#ffd8d0', cloud: '#ffa6c8', cloudShadow: '#100510',
    hemiSky: '#c07ab8', hemiGround: '#3a1630', light: '#ffd6e0', sunLight: 2.4, fogDensity: 0.0003, fogStart: 260,
    glow: 0.36, cloudCover: 1.1, hemi: 1.45, stars: 0.9, exposure: 1.02, bloom: 0.62, env: 0.85,
  },
};
const PALETTE_KEYS = [
  { at: 0, name: 'nebula' }, { at: 4300, name: 'nebula' }, { at: 5100, name: 'graveyard' }, { at: 9100, name: 'graveyard' },
  { at: 10000, name: 'works' }, { at: 10700, name: 'works' }, { at: 11500, name: 'boss' },
];

// ============================================================ Set pieces of the bone works
let worksMat = null;
const wMat = () => worksMat || (worksMat = emissiveVertexMaterial({ roughness: 0.55, metalness: 0.45 }, 3.2));
const BONE = '#aaa28e', BONE2 = '#8a8373', STEEL = '#3e4350', HOT = '#ff8a3a', SEAM = '#b45cff';
const tubeOf = (pts, r, hex, em = 0, seg = 16) => paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), seg, r, 6, false), hex, em);
// half-ellipse arch over the course in the plane z (u from -A to A, apex at v0 + B)
const archPts = (A, v0, B, z, n = 9) => Array.from({ length: n }, (_, i) => { const t = i / (n - 1) * Math.PI; return [-Math.cos(t) * A, v0 + Math.sin(t) * B, z]; });

// The skeleton under construction: rib arches over the course, a spine overhead, scaffolds and furnaces.
class Ribcage extends Prop {
  constructor(s, o) {
    super('ribcage', s, o);
    const parts = [], rnd = mulberry32(77), L = this.len;
    // ribs: tall enough to stay clear of the play area (|u| ≤ 46, v ≤ 58) all the way round
    for (let z = 0; z <= L; z += 70) {
      const k = 1 - Math.abs(z / L - 0.5) * 0.5;
      parts.push(tubeOf(archPts(110, -70, 200, -z), 5.5 * k, z % 140 ? BONE : BONE2));
      parts.push(tubeOf(archPts(108, -66, 196, -z + 4, 7), 0.8, SEAM, 1));
    }
    for (let z = -20; z <= L + 20; z += 14) parts.push(paint(new THREE.BoxGeometry(12, 9, 9).translate(0, 125, -z), z % 28 ? BONE2 : BONE), paint(new THREE.BoxGeometry(3, 8, 3).translate(0, 133, -z), STEEL));
    parts.push(paint(new THREE.CylinderGeometry(1.4, 1.4, L + 40, 6).rotateX(Math.PI / 2).translate(0, 119, -L / 2), SEAM, 1));
    for (const sx of [-1, 1]) {
      for (let z = 35; z < L; z += 70) {
        const x = sx * (78 + rnd() * 16);
        parts.push(paint(new THREE.BoxGeometry(2.4, 120, 2.4).translate(x, 0, -z), STEEL), paint(new THREE.BoxGeometry(2.4, 120, 2.4).translate(x + sx * 10, 0, -z), STEEL));
        for (let y = -40; y < 60; y += 24) parts.push(paint(new THREE.BoxGeometry(12, 1.2, 1.2).translate(x + sx * 5, y, -z), STEEL));
        parts.push(paint(new THREE.BoxGeometry(18, 1.6, 14).translate(x + sx * 4, 18 + rnd() * 20, -z), '#4a4f5c'));
      }
      for (let z = 100; z < L; z += 210) {
        parts.push(paint(new THREE.CylinderGeometry(14, 16, 50, 10).translate(sx * 150, -10, -z), '#2c2e36'));
        parts.push(paint(new THREE.CylinderGeometry(11, 11, 4, 10).translate(sx * 150, 16, -z), HOT, 1));
        parts.push(paint(new THREE.TorusGeometry(15, 1.2, 4, 12).rotateX(Math.PI / 2).translate(sx * 150, 6, -z), HOT, 1));
      }
    }
    this.mesh = new THREE.Mesh(mergeGeometries(parts), wMat());
    this.root.add(this.mesh);
  }
  update(dt) {
    // welding sparks along the bones and furnace heat
    if (Math.random() < dt * 9) {
      const z = rand(0, this.len), side = Math.random() < 0.5 ? -1 : 1;
      railToWorld(this.s + z, side * rand(70, 96), rand(-30, 60), _v);
      sparks(_v, null, 10, [6, 4, 1.6], 24, 1);
      glow(_v, 6, 5, 3, 1.2, 0.9);
    }
  }
}

// One low rib across the course: pass under it or over it.
class LowRib extends Prop {
  constructor(s, o) {
    super('lowrib', s, o);
    this.pts = archPts(70, -10, 54, 0, 15);
    this.mesh = new THREE.Mesh(mergeGeometries([tubeOf(this.pts, 4.6, BONE, 0, 24), tubeOf(archPts(70, -8, 51.5, 3, 15), 0.7, SEAM, 1, 24)]), wMat());
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
  }
  update(dt) {
    const r = this.rel();
    if (Math.abs(r.ds) < 5 && G.player.alive) {
      let best = 1e9, bv = 0;
      for (const [x, y] of this.pts) { const d = Math.hypot(G.player.u - x, G.player.v - y); if (d < best) { best = d; bv = y; } }
      if (best < 4.6 + 2.4) hitObstacle(0, G.player.v > bv ? 1 : -1);
    }
  }
}
registerProp('ribcage', Ribcage);
registerProp('lowrib', LowRib);

// ============================================================ The warp after the boss: the finished skeleton is taken away
const WARP = { on: false, t: 0, group: null, ring: null, frame: null };
const WARP_AT = { rel: 1150, u: -330, v: 280 };   // rail-relative position of the gate (up and to the left)

function warpModel() {
  if (WARP.group) return WARP.group;
  const g = new THREE.Group();
  // the frame: a spine of welded hull sections with rib hoops, far bigger than anything else out here
  const parts = [], rnd = mulberry32(5);
  for (let i = 0; i < 26; i++) {
    const z = i * 26, k = Math.sin((i + 1) / 27 * Math.PI);
    parts.push(paint(new THREE.CylinderGeometry(9, 10, 18, 8).rotateX(Math.PI / 2).translate(0, Math.sin(i * 0.3) * 6, -z), i % 2 ? BONE : BONE2));
    if (i > 2 && i < 22 && i % 2 === 0) {
      const R = 30 + 70 * k;
      parts.push(tubeOf(archPts(R, Math.sin(i * 0.3) * 6, R * 0.8, -z, 9), 3.2, BONE));
      parts.push(tubeOf(archPts(R, Math.sin(i * 0.3) * 6, -R * 0.8, -z, 9), 3.2, BONE2));
    }
    if (rnd() < 0.4) parts.push(paint(new THREE.BoxGeometry(2, 2, 2).translate(rand(-30, 30), rand(-30, 30), -z), HOT, 1));
  }
  parts.push(paint(new THREE.IcosahedronGeometry(26, 1).scale(1, 0.85, 1.25).translate(0, 4, 30), BONE));
  WARP.frame = new THREE.Mesh(mergeGeometries(parts), wMat());
  g.add(WARP.frame);
  // the gate: a swirling disc drawn on one quad
  WARP.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uA: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uT; uniform float uA; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0; float d = length(p), a = atan(p.y, p.x);
        float rim = exp(-pow((d - 0.82) / 0.07, 2.0));
        float swirl = 0.5 + 0.5 * sin(a * 6.0 + d * 14.0 - uT * 6.0);
        float inner = smoothstep(0.85, 0.0, d) * (0.35 + 0.4 * swirl);
        vec3 c = vec3(0.7, 0.4, 1.6) * rim * 2.2 + mix(vec3(0.15, 0.05, 0.4), vec3(0.6, 0.9, 1.8), swirl) * inner;
        gl_FragColor = vec4(c * uA * smoothstep(1.0, 0.92, d), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  WARP.ring.renderOrder = 6;
  g.add(WARP.ring);
  g.visible = false;
  WARP.group = g;
  return g;
}
function startWarp() {
  warpModel();
  G.scene.add(WARP.group);
  WARP.on = true; WARP.t = 0; WARP.group.visible = true; WARP.flashed = false;
  AudioSys.sfx('roar', { vol: 0.5, pitch: 0.45 });
}
function stopWarp() { if (WARP.group) { WARP.group.visible = false; G.scene.remove(WARP.group); } WARP.on = false; }
// gate opens (0–1 s), the frame slides in and shrinks into it (1–4.4 s), the gate snaps shut (4.6 s)
function updateWarp(dt) {
  if (!WARP.on) return;
  const t = (WARP.t += dt), g = WARP.group, d = G.rail.d;
  railFrame(d + WARP_AT.rel, _p, _f, _r);
  railToWorld(d + WARP_AT.rel, WARP_AT.u, WARP_AT.v, g.position);
  g.rotation.set(0, Math.atan2(-_f.x, -_f.z), 0);
  const open = t < 4.6 ? easeOutCubic(clamp(t / 1.0, 0, 1)) : clamp(1 - (t - 4.6) / 0.25, 0, 1);
  const R = 210 * open;
  WARP.ring.scale.setScalar(Math.max(0.01, R * 2.2));
  WARP.ring.material.uniforms.uT.value = t;
  WARP.ring.material.uniforms.uA.value = open;
  // the frame is a serpent's spine and ribs, kilometres long, drawn in head first
  const k = easeInOutCubic(clamp((t - 0.6) / 3.8, 0, 1));
  WARP.frame.position.set(lerp(1100, 0, k), lerp(-420, 0, k), lerp(900, -100, k));
  WARP.frame.rotation.set(lerp(0.15, 0, k), lerp(-1.0, -0.15, k), lerp(0.25, 0, k));
  WARP.frame.scale.setScalar(Math.max(0.01, 2.3 * (1 - smoothstep(0.7, 1, k))));
  WARP.frame.visible = k < 0.999;
  if (open > 0.05) { g.updateMatrixWorld(); glow(_v.set(0, 0, 0).applyMatrix4(g.matrixWorld), R * 1.3, 1.0, 0.5, 2.2, 0.5 * open); }
  if (t > 4.6 && !WARP.flashed) { WARP.flashed = true; bigFlash(0.7, [0.85, 0.7, 1]); AudioSys.sfx('bombBlast', { vol: 0.6, pitch: 0.6 }); addShake(0.3); }
  if (t > 5.2) stopWarp();
}
// Camera for the warp: behind and below the leader, looking past him at the gate.
function warpShot(t, o, ship) {
  if (t < 4.4) return false;
  if (!WARP.group) return false;
  railFrame(G.rail.d, _p, _f, _r);
  const k = clamp((t - 4.4) / 9, 0, 1);
  o.pos.copy(ship.pos).addScaledVector(_f, -24 - 6 * k).addScaledVector(_r, 12).setY(ship.pos.y - 5 + 2 * k);
  // look between the leader and the gate, leaning toward the gate
  railToWorld(G.rail.d + WARP_AT.rel, WARP_AT.u, WARP_AT.v, _v);
  _v.sub(o.pos).normalize();
  o.target.subVectors(ship.pos, o.pos).normalize().addScaledVector(_v, 1.6).add(o.pos);
  o.fov = 56;
  return true;
}

// ============================================================ Script
// Scripted exchanges that must keep their order: each line (or function) waits until the radio is free; lines not
// yet said when the course reaches `until` are dropped (functions still run), so a talk never spills into the next scene.
const SEQ = [];
const sayBy = (until, ...lines) => { for (const L of lines) SEQ.push({ L, until }); };
const say = (...lines) => sayBy(G.rail.d + 1500, ...lines);
function updateSeq() {
  while (SEQ.length && G.rail.d > SEQ[0].until) { const { L } = SEQ.shift(); if (typeof L === 'function') L(); }   // actions still run
  if (SEQ.length && !radioBusy()) { const { L } = SEQ.shift(); if (typeof L === 'function') L(); else radio(...L); }
}

function script(at) {
  // ===== DRIFT =====
  at(120, () => radio('hou', 'サルガッソ宙域に入った。信号の発信源は、この奥だ。', { hold: 2.2 }));
  at(520, () => kotaOr('うわぁ、宇宙だ！　星がすっごく近いよ！', 'rio', 'コタはアケボノで修理中。しばらく3機で行くわ。'));
  at(WING_REAR_AT, () => setWingStance('rear', 0.5));
  at(700, () => vWing('dart', 5, 760, 26, { noFire: true }));
  at(820, () => radio('gantetsu', '無人機だ。上にも下にも回り込まれるな。'));
  at(1100, () => ringOf('drone', 8, 200, { r: 20, v: 30 }));
  at(1250, () => radio('rio', '漂ってる岩や残骸は、撃てば砕けるものもあるわ。'));
  at(1400, () => snake('dart', 5, 720, -20, 24));
  at(1650, () => { fromBehind('dart', 6); kotaOr('後ろからも来るよ！　抜かせて撃っちゃえ！', 'gantetsu', '後ろだ。抜かせてから撃て。', { prio: 1 }); });
  at(1900, () => crossing('drone', 6, 230, 1, 30));
  at(2150, () => holders('raptor', 2, 170, { v: 30 }));
  at(2300, () => radio('gantetsu', '小惑星帯だ。でかい岩は避けろ。小さいのは砕いて進め。'));

  // ===== ASTEROID BELT =====
  at(2600, () => snake('interceptor', 4, 700, 18, 32));
  at(2800, () => { for (let i = 0; i < 8; i++) mine(3150 + i * 55, rand(-36, 36), rand(10, 50)); });
  at(3000, () => { holders('carrier', 1, 150, { carry: 'laser', carryIndex: 0, stay: 8, v: 28 }); kotaOr('あの輸送機、何か積んでるよ！　撃ち落として！', 'rio', 'あの輸送機、何か積んでるわ。撃ち落として！'); });
  at(3300, () => divers('dart', 4));
  at(3550, () => radio('rio', '前方に大きな岩塊！', { prio: 1 }));
  at(3680, () => radio('gantetsu', '右へ抜けろ！', { prio: 1, hold: 1.2 }));
  at(3800, () => fromBehind('interceptor', 4));
  at(4100, () => ringOf('drone', 10, 200, { r: 22, v: 28 }));
  at(4400, () => crossing('dart', 6, 220, -1, 30));
  at(4600, () => radio('hou', '前方に大型艦の残骸を多数確認。……ここが「船の墓場」か。', { hold: 2 }));

  // ===== SHIP GRAVEYARD =====
  at(4800, () => { holders('raptor', 2, 170, { v: 26 }); turret(5150, 62, { onGround: false, v: 33 }); turret(5230, 58, { onGround: false, v: 33 }); });
  at(5000, () => radio('gantetsu', '前の船……まだ回っているぞ。', { prio: 1 }));
  at(5130, () => radio('rio', '中を抜けるしかないわ！　隔壁の穴をくぐって！', { prio: 1 }));
  at(5200, () => tip('回転する隔壁の、穴をくぐり抜けろ', 4));
  at(5380, () => ringOf('drone', 6, 170, { r: 13, v: 30, stay: 4 }));
  at(5760, () => kotaOr('ふぅ、抜けたぁ……！', 'rio', 'ふぅ……抜けたわね。'));
  at(5850, () => crossing('drone', 6, 230, 1, 26));
  at(6120, () => radio('rio', '中間地点よ。……待って、何か来る。'));

  // ===== KAMAITACHI ===== (they talk on the way in and only fight once the exchange is over)
  at(6250, () => {
    G.run.rivalsDown = 0; G.run.rivalsBeaten = false; G.run.saidHired = false;   // (again after a restart from the checkpoint)
    radio('rio', '後方から高速の機影、3つ！　無人機じゃないわ！', { prio: 2, hold: 1.4 });
    after(0.6, () => startRivals(onRival));
    say(['tsumuji', 'よう、ヒヨッコども！　オレたちはカマイタチ隊だ！', { hold: 1.3 }], ['kiri', '……斬る。', { hold: 1.0 }], ['hari', 'あ、あの……ごめんなさいっ！', { hold: 1.2 }],
      ['gantetsu', '傭兵か。……誰に雇われた。', { hold: 1.2 }], () => engageRivals(), ['tsumuji', '旦那からの依頼でね。悪く思うなよ！']);
  });
  at(7700, () => engageRivals());   // in case the radio was held up
  at(KOTA_BACK, () => kotaReturns());
  at(9600, () => {
    if (!RIVALS.list.some(r => r.alive)) return;
    if (rivalUp('tsumuji')) radio('tsumuji', 'ちっ、時間切れだ。報酬分は働いたぜ！', { prio: 1 });
    if (rivalUp('kiri')) radio('kiri', '……次は、斬る。');
    retreatRivals();
    afterRivals();
  });

  // ===== BONE WORKS =====
  at(9950, () => sayBy(10700, ['hou', '発信源は近い。……なんだ、あれは。', { prio: 1, hold: 1.4 }], ['rio', '無人機が残骸を溶かして、何かを組み立ててる……！']));
  at(10100, () => { holders('raptor', 2, 170, { v: 30 }); turret(10320, -44, { onGround: false, v: 8 }); turret(10400, 44, { onGround: false, v: 8 }); });
  at(10250, () => ringOf('drone', 10, 200, { r: 22, v: 30 }));
  at(10450, () => fromBehind('interceptor', 5));
  at(10560, () => radio('gantetsu', '骨の下をくぐれ。頭をぶつけるなよ！', { prio: 1 }));

  // ===== BOSS =====
  at(10750, () => { radio('hou', '待て……周りの残骸が動いている！　集まってくるぞ！', { prio: 2, hold: 1.4 }); warning(true); AudioSys.stopMusic(1.2); G.warnLoop = AudioSys.loop('siren'); });
  at(10900, () => { G.run.checkpoint = 10900; });
  at(10950, () => { warning(false); if (G.warnLoop) { G.warnLoop.stop(0.5); G.warnLoop = null; } emit('bossStart'); });

  // ----- props -----
  scheduleProp('ring', 1150, { u: 0, v: 26 });
  scheduleProp('ring', 1800, { u: -20, v: 34 });
  scheduleProp('ring', 2650, { u: 18, v: 22 });
  scheduleProp('ring', 3350, { kind: 'gold', u: -40, v: 50 });
  scheduleProp('ring', 4200, { u: 0, v: 30 });
  scheduleProp('ring', 4900, { u: -10, v: 28 });
  scheduleProp('ring', 5470, { u: 0, v: 30 });
  scheduleProp('ring', 5590, { kind: 'gold', u: 30, v: 48 });
  scheduleProp('ring', 6050, { kind: 'check', u: 0, v: 28 });
  scheduleProp('ring', 7300, { u: 20, v: 30 });
  scheduleProp('ring', 8300, { u: -20, v: 26 });
  scheduleProp('ring', 9100, { u: 0, v: 34 });
  scheduleProp('ring', 9900, { u: 0, v: 22 });
  scheduleProp('ring', 10370, { kind: 'gold', u: 0, v: 55 });
  scheduleProp('ring', 10520, { u: -16, v: 24 });
  // asteroid belt: big rocks to fly around, small ones to break
  for (const [s, u, v, r] of [[2700, 30, 40, 14], [2850, -32, 14, 12], [3050, 6, 46, 16], [3200, -20, 30, 10], [3450, 36, 10, 13], [4250, 28, 26, 15], [4450, -30, 44, 12]]) scheduleProp('rock', s, { u, v, r, seed: s });
  scheduleProp('rock', 3900, { u: -12, v: 24, r: 26, seed: 1 });
  scheduleProp('fragment', 3900, { u: -42, v: 5 });   // 槍のかけら②: in the narrow gap left of the big rock ("右へ抜けろ")
  for (const [s, u, v, r] of [[2560, -10, 24, 5], [2760, 14, 32, 4.5], [2960, -24, 40, 5.5], [3130, 22, 18, 4], [3260, -4, 12, 5], [3520, -18, 44, 4.5], [3640, 12, 30, 6],
    [4020, 30, 46, 4.5], [4110, -2, 14, 5], [4320, -14, 34, 5], [4520, 8, 20, 4.5], [4660, 24, 40, 5], [5060, -26, 36, 4], [5130, 10, 16, 4.5]]) scheduleProp('rubble', s, { u, v, r, seed: s });
  // ship graveyard
  scheduleProp('hulk', 4750, { u: -104, v: 22, r: 36, len: 330, roll: 0.3, seed: 3 });
  scheduleProp('hulk', 4880, { u: 108, v: 52, r: 30, len: 300, roll: 1.2, seed: 4 });
  scheduleProp('hulk', 5000, { u: 66, v: 6, r: 22, len: 170, roll: 2.1, seed: 5 });
  scheduleProp('spinwreck', 5300, {
    len: 420, r: 62, v: 30, spin: 0.3,
    walls: [{ at: 110, holes: [[0, 25, 15], [0, -25, 15]] }, { at: 220, holes: [[25, 0, 15], [-25, 0, 15]] }, { at: 330, holes: [[0, 23, 17.5]] }],
  });
  scheduleProp('hulk', 8300, { u: -96, v: 70, r: 28, len: 260, roll: 0.8, seed: 6 });
  // bone works
  scheduleProp('ribcage', 9980, { len: 560 });
  scheduleProp('lowrib', 10650, {});
}

// Kamaitachi radio and score (rivals.js calls back here).
function onRival(type, r) {
  const run = G.run;
  if (type === 'wave') radio('gantetsu', '衝撃波だ！　輪の内か外へ抜けろ！', { prio: 1 });
  else if (type === 'dash') kotaOr('キリが後ろに回ったよ！　来る！', 'rio', 'キリが後ろに回ったわ！　来るわよ！', { prio: 1 });
  else if (type === 'repair') { radio('hari', 'に、兄ちゃん、いま直すから……！', { prio: 1 }); after(2.6, () => radio('gantetsu', '整備役を先に落とせ。切りがないぞ。')); }
  else if (type === 'flinch' && !run.saidFlinch) { run.saidFlinch = true; radio('hari', 'ひゃっ！？　う、撃たないでぇ！'); }
  else if (type === 'waveHit' && !run.saidWaveHit) { run.saidWaveHit = true; radio('gantetsu', '体勢を立て直せ！', { hold: 1 }); }
  else if (type === 'cut' && !run.saidCut) { run.saidCut = true; radio('rio', 'キリの刃、まともに受けたら危ないわ！'); }
  else if (type === 'down') {
    run.rivalsDown = (run.rivalsDown || 0) + 1;
    const pts = { tsumuji: [5, 3000], kiri: [5, 3000], hari: [3, 1500] }[r.id];
    run.hits += pts[0];
    emit('bonus', pts[1], r.pos.clone(), `${r.def.name} +${pts[0]}`);
    const line = { tsumuji: 'ぐあっ！？　やるじゃねえか……！', kiri: '……不覚。', hari: 'ご、ごめん、先に下がるね……！' }[r.id];
    radio(r.id, line, { prio: 1 });
    if (!rivalUp('tsumuji') && !rivalUp('kiri') && !run.rivalsBeaten) {
      run.rivalsBeaten = true;
      say(['tsumuji', 'ちっ、撤収だ！　覚えてろよ、ランサー隊！'], () => { if (rivalUp('hari')) radio('hari', 'ま、待ってよ、兄ちゃーん！'); retreatRivals(); });
      afterRivals();
    }
  }
}

// once the mercenaries have gone: who hired them? (said before the bone works come into view)
function afterRivals() {
  if (G.run.saidHired) return;
  G.run.saidHired = true;
  sayBy(9950, ['rio', '「旦那」……裏に誰かいるのね。', { hold: 1.4 }], ['gantetsu', '敵には、指揮官がいるということだ。', { hold: 1.4 }]);
}

function kotaReturns() {
  const kota = WING.byId.kota;
  if (!kota.gone) return;
  kota.show(); kota.reset(); holdOut(kota, 6);
  G.run.kotaBack = true;
  radio('kota', 'お待たせ、隊長！　ランサー2、戦線復帰！', { prio: 1 });
  after(2.8, () => radio('rio', 'コタ！　修理、間に合ったのね！'));
}

// ------------------------------------------------------------ Boss radio
let saidCharge = false;   // the swipe warning is given once per session
function onBossPhase(p) {
  if (p === 1) radio('rio', '光ってる腕の関節を撃って！　腕ごと崩せるはずよ！', { prio: 1 });
  if (p === 2) radio('rio', '頭蓋骨が開いた！　中のコアを狙って！', { prio: 2 });
  if (p === 3) { radio('gashadokuro', '……ホネ……ホネヲ、ヨコセ……', { prio: 2, hold: 1.2 }); kotaOr('まだ動くの！？　しつこいなぁ！', 'gantetsu', 'まだ動くか……しぶといな。'); }
  if (p === 4 && !G.run.saidRebuild) { G.run.saidRebuild = true; kotaOr('また組み上がった！？', 'rio', 'また組み上がっていく……！', { prio: 1 }); after(2.2, () => radio('gantetsu', '何度でも崩せ。中身を叩くまでだ。')); }
  if (p === 5 && !G.run.saidLone) { G.run.saidLone = true; radio('rio', '崩した腕が戻っていく……！　両腕を続けて崩して！', { prio: 1 }); }
}
function onBossCharge() { if (!saidCharge) { saidCharge = true; radio('gantetsu', '腕が来るぞ！　上か下へかわせ！', { prio: 2, hold: 1 }); } }
function onBossDying() { radio('gashadokuro', 'ガ……ガガ……ホネ、ニ……カエ、ル……', { prio: 2, hold: 0.8 }); }
function onBossPartDown(left) { if (left === 1) radio('rio', '片腕が崩れたわ！　もう片方も！', { prio: 1 }); }

// ------------------------------------------------------------ Definition
export default {
  id: 'violet',
  no: 2,
  title: 'VIOLET SARGASSO',
  place: 'サルガッソ宙域',
  sub: 'サルガッソ宙域　船の墓場',
  resultSub: 'サルガッソ宙域 船の墓場 突破',
  music: 'stage2',
  bossAt: 10750,
  checkpoints: [0, 6050, 10900],
  wingRearAt: WING_REAR_AT,
  world: { space: { band: [0.3, 1, -0.25] }, zones: ZONE, zoneW, pathX, decorate, palettes: PALETTES, paletteKeys: PALETTE_KEYS },
  script,
  onSetup(d, run) {
    clearRivals(); stopWarp(); SEQ.length = 0;
    if ((run.squad & 1) && d < KOTA_BACK) WING.byId.kota.hide();   // still being repaired after mission 01
  },
  onUpdate(dt) { updateRivals(dt); updateWarp(dt); if (G.state === 'play') updateSeq(); },
  onExit() { clearRivals(); stopWarp(); SEQ.length = 0; },
  warm: () => [...rivalModels(), warpModel()],
  boss: {
    id: 'gashadokuro', en: 'GASHADOKURO', title: '機械獣　ガシャドクロ', bar: '機械獣 ガシャドクロ', bannerAt: 4.4,
    introLines: [
      { who: 'gashadokuro', text: '……ホネ、タリナイ。オマエノ、ホネモ……ヨコセ。', hold: 0.8 },
      { who: 'rio', text: '残骸が集まって……骸骨になった！？', hold: 0.8 },
      { who: 'gantetsu', text: '……昔話の「がしゃどくろ」そのものだな。', hold: 0.8 },
      { who: 'hou', text: '以後、目標を「ガシャドクロ」と呼称する。各機、迎撃せよ！', hold: 1.2 },
    ],
  },
  onBossPhase, onBossCharge, onBossDying, onBossPartDown,
  // The finished skeleton the drones were building is pulled into a warp and taken away (its answer comes in 06).
  // The radio stays quiet while the gate is open: on phones the radio panel sits across the top of the screen.
  clearTime: 14.6,
  onClear(run) {
    after(1.4, () => kotaOr('やったー！　骸骨、バラバラだ！', 'rio', '目標、沈黙。……やったわ、隊長。', { prio: 2 }));
    after(2.6, () => radio('hou', 'よくやった。……待て、宙域の奥に巨大な重力反応！', { prio: 1, hold: 1.0 }));
    after(4.4, () => { startWarp(); bigFlash(0.5, [0.8, 0.6, 1]); });
    after(10.0, () => { radio('gantetsu', '……持っていかれたか。', { prio: 1, hold: 1.0 }); radio('rio', 'あれ……いったい何の骨なの？', { hold: 2.0 }); });
  },
  clearShot: warpShot,
  onFragment() {
    radio('rio', G.run.frags & 1 ? 'また、あの光……！　アクエリアのかけらと同じ金属よ。' : 'この光……古い金属のかけら？　難破船の積み荷かしら。', { prio: 1 });
  },
  absent(run) { return []; },   // Kota is back by the end of the mission in any case
  rank: { S: 120, A: 95, B: 65, medal: 110 },
  resultNote(run) { return `カマイタチ隊 撃退 <b>${run.rivalsDown || 0}/3</b>` + (run.gotFrag ? '　槍のかけら <b>取得</b>' : ''); },
  squadAfter(run, squad) { return squad & ~1; },   // Kota's repairs are done

  // ---- story mode
  map: { target: 'sargasso' },
  briefing: {
    lines: (carry) => [
      { who: 'hou', text: 'ランサー隊、ミズチの残骸の信号を追った結果が出た。' },
      { who: 'rio', text: '発信源はサルガッソ宙域。古い難破船が流れ着く「船の墓場」よ。' },
      { who: 'rio', text: '信号は今も出続けてる。宙域の奥で、何かが動いてるわ。' },
      { who: 'hou', text: '小惑星帯と残骸のあいだを抜け、発信源を突き止めろ。' },
      ...(carry && carry.squad & 1 ? [{ who: 'hou', text: 'コタの機体は修理中だ。間に合いしだい、合流させる。' }] : []),
      { who: 'hou', text: '何が待っているか、わからん。……気を抜くな、ランサー1。' },
    ],
    objective: 'サルガッソ宙域を抜け、信号の発信源を突き止めよ',
  },
  talk: [
    { who: 'rio', text: 'ガシャドクロの残骸を調べたわ。あれは、骨格を組み立てる現場の「番人」だったみたい。' },
    { who: 'gantetsu', text: '……運び去られた骨は、どこへ行った。' },
    { who: 'rio', text: 'ワープの行き先は追えなかった。でも、あの形……船の骨組みじゃない。生き物の骨格よ。' },
    { who: 'kota', text: 'あんなにでっかい生き物なんて、いるわけないよね……？' },
    { who: 'hou', text: '傭兵の言う「旦那」も気になる。……敵には、頭がいる。' },
    { who: 'rio', text: '手がかりがもう一つ。機械獣が、惑星アリディアの古い遺跡を掘り返してるわ。' },
    { who: 'hou', text: '次の目標はアリディアだ。ランサー隊、補給を急げ。' },
  ],

  // dev-build test bot: shoot the rivals too, and steer for the open hole of the rotating wreck
  botTargets: () => rivalTargets(),
  botSteer() {
    for (const p of props) if (p.type === 'spinwreck') { const h = p.nextHole(); if (h) return h; }
    return null;
  },
};
