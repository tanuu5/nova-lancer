// MISSION 01 "AZURE COAST" — planet Aquelia: sunset ocean → red-rock canyon → fortress → sea-dragon boss MIZUCHI.
// Everything that belongs to this mission lives here: the course, height field, ground colours, decorations,
// sky palettes, the event script, boss radio, clear lines and result rules. The engine reads it as a stage
// definition (field list in src/stages/index.js).
import * as THREE from 'three';
import { G, rand, lerp, smoothstep, Simplex2, fbm2, ridged2, mulberry32, hash2, emit, after } from '../core.js';
import { spawnEnemy, makeGroup } from '../enemies.js';
import { scheduleProp, spawnProp } from '../props.js';
import { radio, tip, warning, addMarker } from '../hud.js';
import { WING, setWingStance, holdOut, kotaOr } from '../wingmen.js';
import { AudioSys } from '../audio.js';
import { crossView } from '../flyby.js';
import { D, K, vWing, snake, fromBehind, holders, ringOf, crossing, divers, turret, mine } from '../level.js';

// ============================================================ Zones & rail path
const ZONE = { canyonStart: 4400, canyonEnd: 8000, fortStart: 8000, fortEnd: 10400, boss: 10900 };
const _zw = { ocean: 1, canyon: 0, fort: 0, boss: 0 };
function zoneW(d, out = _zw) {
  const cIn = smoothstep(4400, 5000, d), cOut = smoothstep(7700, 8300, d), fOut = smoothstep(10300, 10900, d);
  out.canyon = cIn * (1 - cOut);
  out.fort = cOut * (1 - fOut);
  out.boss = fOut;
  out.ocean = Math.max(0, 1 - out.canyon - out.fort - out.boss);
  return out;
}

const _pw = { ocean: 1, canyon: 0, fort: 0, boss: 0 };
function pathX(d) {
  const w = zoneW(d, _pw);
  let x = 0;
  if (w.ocean > 0) x += w.ocean * (55 * Math.sin(d * 0.0011 + 0.6) + 22 * Math.sin(d * 0.0023 + 2.0));
  if (w.canyon > 0) x += w.canyon * (125 * Math.sin((d - 4400) * 0.0017) + 38 * Math.sin(d * 0.0041));
  if (w.fort > 0) x += w.fort * (40 * Math.sin(d * 0.0013));
  return x;
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
function terrainHeight(x, z) {
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

// ============================================================ Ground colours
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

// ============================================================ Decorations (trees, rocks, buildings)
// Called for each terrain chunk; KIT holds the shared geometries/materials from world.js. Returns the meshes it added.
function decorate(ci, KIT) {
  const { CHUNK, treeGeo, rockGeo, bldgGeo, decoMat, bldgMat, lightGeo, lightGeoCyan, lightMat } = KIT;
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
  return list;
}

// ============================================================ Sky palettes along the course
const PALETTES = {
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
const PALETTE_KEYS = [
  { at: 0, name: 'sunset' }, { at: 4200, name: 'sunset' }, { at: 5400, name: 'canyon' }, { at: 7400, name: 'canyon' },
  { at: 8600, name: 'dusk' }, { at: 10200, name: 'dusk' }, { at: 11300, name: 'twilight' },
];

// ============================================================ Script
const WING_REAR_AT = 640;   // the wingmen fly in front until here, then mostly behind the camera

function script(at) {
  // ===== OCEAN =====
  at(120, () => radio('hou', 'こちらホウ。所属不明機の編隊を捕捉した。全機、迎撃せよ！', { hold: 2.2 }));
  at(520, () => radio('kota', 'よーし、いっくぞー！　隊長、しっかりついてくからね！'));
  at(330, () => tip(`${K('W')}${K('A')}${K('S')}${K('D')} / 矢印キー：移動　${K('J')} / ${K('Space')}：ショット`, 6, '左下をドラッグで移動 ／ FIRE でショット'));
  at(WING_REAR_AT, () => setWingStance('rear', 0.5));   // after Kota's "I'll stick with you": the squadron drops back to cover the leader
  at(700, () => { vWing('dart', 5, 760, 20, { noFire: true }); });
  at(820, () => radio('gantetsu', '前方に敵編隊。落ち着いて、一機ずつ確実に落とせ。'));
  at(1250, () => snake('dart', 5, 720, 18, 20));
  at(1400, () => { scheduleNow('ring', 1750, { u: -8, v: 18 }); });
  at(960, () => radio('rio', '前方にリング。通るとシールドが回復するわ。'));
  at(1700, () => { fromBehind('dart', 6); radio('kota', '後ろから来るよ！　抜かせて撃っちゃえ！', { prio: 1 }); });
  at(2150, () => crossing('dart', 5, 230, 1, 24));
  at(2350, () => radio('gantetsu', '岩のアーチだ。くぐり抜けろ！'));
  at(2500, () => { holders('raptor', 2, 170); });
  at(2560, () => { radio('gantetsu', '敵弾はローリングではじける。傾けるキーを素早く2回だ！', { prio: 1 }); tip(`${K('Q')} / ${K('E')} を素早く2回：ローリング（敵弾をはじく）`, 7, 'ROLL ボタン：ローリング（敵弾をはじく）'); });
  at(3000, () => { ringOf('drone', 8, 190, { r: 20 }); radio('rio', 'ショットを長押しでチャージ！　ロックオンしてまとめて吹き飛ばして！', { prio: 1 }); tip(`ショット長押し → チャージ完了で離す：ロックオン弾`, 7, 'FIRE 長押し → 離す：ロックオン弾'); });
  at(3400, () => { holders('carrier', 1, 150, { carry: 'laser', carryIndex: 0, stay: 8, v: 24 }); snake('dart', 3, 650, -20, 26); radio('kota', 'あの輸送機、何か積んでるよ！　撃ち落として！'); });
  at(3850, () => rescueKota());
  at(4300, () => { fromBehind('interceptor', 4, { stay: 5 }); });
  at(4500, () => { radio('gantetsu', '峡谷に入るぞ。岩壁に擦るなよ。'); tip(`${K('L')} / ${K('Shift')}：ブースト　${K('I')} / ${K('V')}：ブレーキ`, 6, 'BOOST / BRAKE ボタンで加減速'); });
  at(4680, () => { gunshipFlyby(); });

  // ===== CANYON =====
  at(4950, () => radio('rio', '岩柱が倒れてくる！　撃てば砕けるわ！', { prio: 1 }));
  at(5250, () => divers('dart', 4));
  at(5500, () => { turret(5850, -34); turret(5930, 30); turret(6010, -12); });
  at(5900, () => { holders('raptor', 1, 160, { v: 22 }); snake('dart', 4, 700, 10, 22, { au: 18 }); });
  at(6150, () => { radio('rio', '中間地点を通過。いい調子よ、隊長。'); });
  at(6300, () => { turret(6720, -26, { onGround: false, v: 33 }); turret(6720, 26, { onGround: false, v: 33 }); radio('gantetsu', '橋の上に砲台だ。下をくぐるか、先に潰せ！'); });
  at(6700, () => { ringOf('drone', 10, 200, { r: 22, v: 30 }); });
  at(7050, () => { for (let i = 0; i < 8; i++) mine(7450 + i * 45, rand(-30, 30), rand(10, 40)); kotaOr('機雷だ！　近づくと爆発するよ！', 'rio', '機雷よ！　近づくと爆発するわ！'); });
  at(7300, () => { fromBehind('interceptor', 5); kotaOr('また後ろ！　しつこいなぁ、もう！', 'gantetsu', 'また後ろだ。抜かせてから撃て。', { prio: 1 }); });
  at(7700, () => { holders('raptor', 2, 170, { v: 30 }); crossing('drone', 6, 240, -1, 20); });

  // ===== FORTRESS =====
  at(7900, () => radio('hou', '前方に敵の前線基地を確認。防衛網を突破せよ！', { hold: 2 }));
  at(8150, () => { turret(8600, -60, { type: 'aagun' }); turret(8700, 60, { type: 'aagun' }); turret(8850, -58, { type: 'aagun' }); });
  at(8300, () => { divers('interceptor', 4); });
  at(8650, () => { radio('gantetsu', 'エネルギーゲートだ！　両脇の発生装置を撃て！', { prio: 1 }); });
  at(8900, () => { vWing('dart', 7, 700, 24, { speed: 34 }); });
  at(9250, () => { turret(9600, -40); turret(9660, 40); turret(9760, 0); turret(9850, -20, { type: 'aagun' }); });
  at(9500, () => { crossing('dart', 6, 220, -1, 30); });
  at(9800, () => { fromBehind('interceptor', 6); holders('raptor', 2, 190, { v: 34 }); });
  at(10150, () => { ringOf('drone', 10, 200, { r: 24, v: 28 }); });
  at(10350, () => radio('gantetsu', '基地を抜けるぞ！　全機、上昇して海へ出ろ！'));

  // ===== BOSS =====
  at(10550, () => { radio('hou', '待て……海中から巨大な反応！　警戒しろ！', { prio: 2, hold: 1.4 }); warning(true); AudioSys.stopMusic(1.2); G.warnLoop = AudioSys.loop('siren'); });
  at(10720, () => { G.run.checkpoint = 10700; });
  at(10760, () => { warning(false); if (G.warnLoop) { G.warnLoop.stop(0.5); G.warnLoop = null; } emit('bossStart'); });

  // ----- props -----
  scheduleProp('ring', 1150, { u: 0, v: 22 });
  scheduleProp('arch', 2650, { u: 0 });
  scheduleProp('ring', 2650, { u: 0, v: 14 });
  scheduleProp('fragment', 2650, { u: 0, v: 53 });   // 槍のかけら①: over the arch instead of through it
  scheduleProp('stack', 2960, { u: -28, scale: 1 });
  scheduleProp('stack', 3080, { u: 32, scale: 1.1 });
  scheduleProp('stack', 3230, { u: 2, scale: 0.9 });
  scheduleProp('ring', 3600, { u: 20, v: 30 });
  scheduleProp('ring', 4150, { kind: 'gold', u: -34, v: 9 });
  scheduleProp('pillar', 5350, { u: 36, side: 1 });
  scheduleProp('ring', 5500, { u: 0, v: 18 });
  scheduleProp('pillar', 5750, { u: -36, side: -1 });
  scheduleProp('ring', 6100, { kind: 'check', u: 0, v: 24 });
  scheduleProp('bridge', 6720, { u: 0, v: 30 });
  scheduleProp('ring', 6720, { u: 0, v: 14 });
  scheduleProp('ring', 6900, { kind: 'gold', u: 38, v: 50 });
  scheduleProp('pillar', 7250, { u: 34, side: 1, maxAngle: 1.0 });
  scheduleProp('ring', 7600, { u: -14, v: 26 });
  scheduleProp('tower', 8400, { u: -24, h: 95 });
  scheduleProp('tower', 8520, { u: 26, h: 75 });
  scheduleProp('tower', 8640, { u: 0, h: 38 });
  scheduleProp('gate', 9050, { u: 0, w: 30 });
  scheduleProp('ring', 9250, { u: 0, v: 20 });
  scheduleProp('tower', 9450, { u: 30, h: 110 });
  scheduleProp('tower', 9560, { u: -30, h: 85 });
  scheduleProp('gate', 9900, { u: 0, w: 28 });
  scheduleProp('ring', 10000, { kind: 'gold', u: 0, v: 56 });
  scheduleProp('ring', 10300, { u: 0, v: 26 });
}

function scheduleNow(type, s, o) { spawnProp(type, s, o); }

// Gunship crossing overhead, carrying a bomb
function gunshipFlyby() {
  spawnEnemy('gunship', 'flyby', { s: D() + 900, dist: 260, enter: 4, close: 3, u0: 80, su: -8, v: 40, life: 20 }, { carry: 'bomb' });
  radio('gantetsu', '大型艦だ！　砲撃に注意しつつ集中攻撃しろ！', { prio: 1 });
  tip(`大型艦には ${K('K')} / ${K('B')} のスマートボムが有効`, 5, '大型艦には BOMB が有効');
}

// Wingman rescue event
function rescueKota() {
  const kota = WING.byId.kota;
  if (!kota || kota.gone) return;
  kota.mode = 'chased'; kota.modeT = 0;
  radio('kota', 'うわっ！　後ろに付かれた！　隊長、助けてー！', { prio: 2 });
  const anchor = kota;
  const marker = addMarker(kota.pos, 'KOTA', '#ffb070');
  let resolved = false;
  const group = makeGroup(() => {
    if (resolved) return;
    resolved = true;
    marker.active = false;
    kota.mode = 'formation'; kota.modeT = 0; kota.barrelRoll();
    holdOut(kota, 5);
    if (group.byPlayer > 0) { G.run.savedKota = true; emit('bonus', 3000, kota.pos.clone(), 'RESCUE +3000'); }
    radio('kota', '助かったぁ！　隊長、恩に着るよ！', { prio: 1 });
  });
  for (let i = 0; i < 3; i++) {
    spawnEnemy('dart', 'chase', { anchor, back: 20 + i * 9, ou: (i - 1) * 7, ov: (i - 1) * 3, ph: i, s: kota.s - 40, u: kota.u, v: kota.v }, { group, noFire: true });
  }
  after(16, () => {
    if (resolved) return;
    resolved = true;
    marker.active = false;
    kota.mode = 'retreat'; kota.modeT = 0; kota.damaged = true;
    G.run.kotaLost = true;
    radio('kota', 'くっ……被弾した！　ごめん、いったん離脱する！', { prio: 1 });
  });
}

// ------------------------------------------------------------ Boss radio
let firstCharge = true;   // the beam warning is given once per session
function onBossPhase(p) {
  if (p === 1) { radio('rio', 'まずは背中の砲台を叩いて！', { prio: 1 }); }
  if (p === 2) { radio('rio', '砲台は全滅！　口が開いた瞬間、中のコアを狙って！', { prio: 2 }); }
  if (p === 3) { radio('mizuchi', '……ハイジョ……ハイジョ、スル……', { prio: 2, hold: 1.2 }); kotaOr('お、怒ってる！？　みんな気をつけて！', 'rio', '動きが変わった……！　みんな気をつけて！'); }
}
function onBossCharge() { if (firstCharge) { firstCharge = false; radio('gantetsu', 'ビームが来るぞ！　射線から外れろ！', { prio: 2, hold: 1 }); } }
function onBossDying() { radio('mizuchi', 'ガ……ガガ……キノウ、テイ……シ……', { prio: 2, hold: 0.8 }); }
function onBossPartDown(left) {   // turrets left on the back (6 at first)
  if (left === 5) kotaOr('ひとつ潰した！　その調子！', 'gantetsu', 'ひとつ潰した。その調子だ。');
  if (left === 2) radio('rio', '砲台、残り2基よ！');
}

// ------------------------------------------------------------ Definition
export default {
  id: 'azure',
  no: 1,
  title: 'AZURE COAST',
  place: '惑星アクエリア',
  sub: '惑星アクエリア　沿岸防衛線',           // mission-start banner
  resultSub: '惑星アクエリア 沿岸防衛線 突破',  // results panel
  music: 'stage1',
  bossAt: 10500,                  // a restart past here is the boss restart (no stage music, BOSS banner)
  checkpoints: [0, 6100, 10700],  // supply ring, boss approach (set by the ring and by the script)
  wingRearAt: WING_REAR_AT,
  attract: [150, 3800],           // title-screen fly-through over the sunset sea
  world: { zones: ZONE, zoneW, pathX, terrainHeight, faceColor, decorate, palettes: PALETTES, paletteKeys: PALETTE_KEYS, water: true, clouds: true },
  script,
  // restarting past the rescue after Kota bailed out: he stays out of the fight
  onSetup(d, run) { if (run.kotaLost && d > 3850) WING.byId.kota.hide(); },
  // The first machine beast: Rio recognises the sea dragon of her grandmother's tales, and HQ adopts the name.
  boss: {
    id: 'mizuchi', en: 'MIZUCHI', title: '機械獣　ミズチ', bar: '機械獣 ミズチ', bannerAt: 4.6,
    introLines: [
      { who: 'mizuchi', text: '……侵入者ヲ確認。排除スル。', hold: 0.8 },
      { who: 'rio', text: 'ミズチ……おばあちゃんの昔話の海竜と同じ……！', hold: 1.0 },
      { who: 'hou', text: '……以後、目標を「ミズチ」と呼称する。各機、迎撃せよ！', hold: 1.2 },
    ],
  },
  onBossPhase, onBossCharge, onBossDying, onBossPartDown,
  // While the squadron circles, a black machine crosses far above (it returns in mission 04). The radio is quiet
  // while it passes: on phones the radio panel sits across the top of the screen, where the sky is.
  clearTime: 13.6,
  onClear(run) {
    after(1.4, () => run.kotaLost
      ? radio('rio', '目標の沈黙を確認。……お見事よ、隊長。', { prio: 2 })
      : radio('kota', 'やったー！　隊長、最高だよ！', { prio: 2 }));
    after(1.6, () => radio('hou', 'よくやった、ランサー隊。アクエリアは守られた。', { hold: 1.2 }));
    after(7.0, () => { crossView('ibuki'); AudioSys.sfx('roll', { vol: 0.45, pitch: 0.6 }); });
    after(9.2, () => { radio('gantetsu', '……今の機体は……', { prio: 1, hold: 1.6 }); radio('rio', '……レーダーには、何も映っていないわ。', { hold: 1.6 }); });
  },
  onFragment() { radio('rio', '今の光……何かの破片？　ずいぶん古い金属みたい……', { prio: 1 }); },
  absent(run) { return run.kotaLost ? ['kota'] : []; },   // wingmen missing from the clear formation
  rank: { S: 125, A: 100, B: 70, medal: 115 },             // hits needed (S also needs no deaths)
  resultNote(run) { return (run.savedKota ? 'コタ救出 <b>成功</b>' : 'コタ救出 <b>失敗</b>') + (run.gotFrag ? '　槍のかけら <b>取得</b>' : ''); },
  squadAfter(run, squad) { return run.kotaLost ? squad | 1 : squad; },   // Kota bailed out: under repair at the start of mission 02

  // ---- story mode
  map: { target: 'aquelia' },
  briefing: {
    lines: [
      { who: 'hou', text: 'ランサー隊、聞こえるか。ホウだ。' },
      { who: 'hou', text: '一時間前、惑星アクエリアの沿岸に、所属不明の機械の軍勢が上陸した。' },
      { who: 'hou', text: '敵は海から次々と現れ、沿岸に前線基地を築いている。' },
      { who: 'hou', text: '海上から進入し、峡谷を抜けて、敵の前線基地を突破せよ。' },
      { who: 'hou', text: '……無理をするな、ランサー1。全員で帰ってこい。' },
    ],
    objective: 'アクエリア沿岸の敵部隊を撃破し、前線基地を突破せよ',
  },
  talk: [
    { who: 'rio', text: 'ミズチの残骸から、信号を拾ったわ。どこかへ向けて、何かを送り続けてる。' },
    { who: 'rio', text: '発信源は……サルガッソ宙域。難破船が漂う「船の墓場」よ。' },
    { who: 'gantetsu', text: '……あんな所に、何がある。' },
    { who: 'hou', text: '確かめるしかあるまい。ランサー隊、補給が済みしだい、サルガッソへ向かえ。' },
    { who: 'kota', text: '休む暇なしだね……。でも、行こう、隊長！' },
  ],
};
