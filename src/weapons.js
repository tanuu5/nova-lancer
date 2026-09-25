// Weapons: player lasers, charged homing shot with lock-on, smart bombs, and enemy projectiles.
import * as THREE from 'three';
import { G, rand, clamp, lerp, emit, diff } from './core.js';
import { Input } from './input.js';
import { FX, beam, glow, sparks, explode, bigFlash, addShake, splash } from './fx.js';
import { AudioSys } from './audio.js';
import { groundHeight } from './world.js';
import { POST } from './gfx.js';

// Anything the player can shoot registers here:
//   { pos: Vector3, radius, alive, lockable, hittable, hit(dmg, point, source) → 'kill' | 'hit' | 'armor' | 'none' }
export const TARGETS = new Set();

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _seg = new THREE.Vector3();

// Distance from point c to segment ab (squared)
function segDist2(a, b, c) {
  _seg.subVectors(b, a);
  const l2 = _seg.lengthSq();
  let t = l2 > 0 ? ((c.x - a.x) * _seg.x + (c.y - a.y) * _seg.y + (c.z - a.z) * _seg.z) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = a.x + _seg.x * t - c.x, y = a.y + _seg.y * t - c.y, z = a.z + _seg.z * t - c.z;
  return x * x + y * y + z * z;
}

// ============================================================ Player lasers
const lasers = [];
const LASER_COL = [[0.5, 3.2, 0.9], [0.5, 3.2, 0.9], [0.8, 1.6, 4.5]];
export const WSTATE = { fireCool: 0, holdT: 0, charge: 0, charged: false, lock: null, lockT: 0, chargeLoop: null, bomb: null, lastShot: 0, hitMark: 0, hitKill: false };

function spawnLaser(from, dir, level, inherit) {
  const speed = 620;
  lasers.push({
    p: from.clone(), prev: from.clone(), origin: from.clone(), v: dir.clone().multiplyScalar(speed).add(inherit),
    life: 1.0, level, dmg: level === 2 ? 2 : 1, r: level === 2 ? 1.5 : 1.0, len: level === 2 ? 48 : 42,
  });
}

export function firePlayerLaser(ship) {
  const run = G.run;
  const lvl = run.laser;
  const inherit = _v3.copy(ship.railFwd).multiplyScalar(G.rail.speed);
  const aim = _v.copy(ship.pos).addScaledVector(ship.fwd, 160);
  run.shots++;
  if (lvl === 0) {
    const g = ship.gunPos('nose', new THREE.Vector3());
    spawnLaser(g, ship.fwd, 0, inherit);
    glow(g, 3, 0.8, 4, 1.2, 1);
    AudioSys.sfx('laser', { pitch: rand(0.97, 1.03) });
  } else {
    for (const side of ['left', 'right']) {
      const g = ship.gunPos(side, new THREE.Vector3());
      const dir = _v2.subVectors(aim, g).normalize();
      spawnLaser(g, dir, lvl, inherit);
      const c = LASER_COL[lvl];
      glow(g, 3.2, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, 1);
    }
    AudioSys.sfx(lvl === 2 ? 'laserHyper' : 'laserTwin', { pitch: rand(0.97, 1.03) });
  }
}

function updateLasers(dt) {
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i];
    L.life -= dt;
    L.prev.copy(L.p);
    L.p.addScaledVector(L.v, dt);
    let dead = L.life <= 0;
    if (!dead) {
      // targets
      for (const t of TARGETS) {
        if (!t.alive || !t.hittable) continue;
        const rr = t.radius + L.r;
        if (segDist2(L.prev, L.p, t.pos) < rr * rr) {
          const res = t.hit(L.dmg, L.p, 'laser');
          if (res !== 'none') {
            G.run.shotsHit++;
            if (res !== 'armor') { WSTATE.hitMark = 0.18; WSTATE.hitKill = res === 'kill'; }
            dead = true;
            if (res === 'armor') { sparks(L.p, _v.copy(L.v).normalize().negate(), 6, [3, 3.5, 4], 25, 1); AudioSys.sfx('hitEnemy', { vol: 0.6 }); }
            else if (res === 'hit') { sparks(L.p, null, 8, [6, 4, 1.5], 30, 1); AudioSys.sfx('hitEnemy'); }
            break;
          }
        }
      }
    }
    if (!dead) {
      const gh = groundHeight(L.p.x, L.p.z);
      if (L.p.y < gh) { dead = true; sparks(L.p.setY(gh + 0.3), new THREE.Vector3(0, 1, 0), 6, [5, 4, 2], 20, 1); }
      else if (L.p.y < 0) { dead = true; splash(L.p.setY(0), 0.18); }
    }
    if (dead) { lasers.splice(i, 1); continue; }
    const c = LASER_COL[L.level];
    _v.copy(L.v).normalize();
    // The bolt flies away from the chase camera, so it is heavily foreshortened: draw a long streak
    // (never reaching back past the muzzle) plus a bright head so it still reads at a distance.
    const len = Math.min(L.len, L.p.distanceTo(L.origin));
    _v2.copy(L.p).addScaledVector(_v, -len);
    beam(_v2, L.p, L.level === 2 ? 1.0 : 0.8, c[0], c[1], c[2]);
    glow(L.p, L.level === 2 ? 4.0 : 3.4, c[0] * 0.75, c[1] * 0.75, c[2] * 0.75, 1);
  }
}

// ============================================================ Charge shot & lock-on
const chargeShots = [];
const _ndc = new THREE.Vector3();

// Find a lockable target near the aim line (screen-space proximity to the far reticle).
function findLock(ship) {
  const cam = G.camera;
  const far = _v.copy(ship.pos).addScaledVector(ship.fwd, 130);
  _ndc.copy(far).project(cam);
  const rx = _ndc.x, ry = _ndc.y;
  let best = null, bestScore = 0.16;
  for (const t of TARGETS) {
    if (!t.alive || !t.lockable || !t.hittable) continue;
    const dist = t.pos.distanceTo(ship.pos);
    if (dist > 900 || dist < 15) continue;
    _v2.copy(t.pos).sub(ship.pos);
    if (_v2.dot(ship.railFwd) < 0) continue;
    _ndc.copy(t.pos).project(cam);
    if (_ndc.z > 1) continue;
    const dx = (_ndc.x - rx) * cam.aspect, dy = _ndc.y - ry;
    const s = Math.sqrt(dx * dx + dy * dy);
    if (s < bestScore) { bestScore = s; best = t; }
  }
  return best;
}

function fireChargeShot(ship) {
  const g = ship.gunPos('nose', new THREE.Vector3());
  const v = ship.fwd.clone().multiplyScalar(420).addScaledVector(ship.railFwd, G.rail.speed);
  chargeShots.push({ p: g, v, life: 2.6, target: WSTATE.lock, trailT: 0 });
  AudioSys.sfx('chargeShot');
  addShake(0.1);
  G.run.shots++;
}

export function detonate(pos, radius, damage, source, color = [0.6, 3.5, 1]) {
  let kills = 0;
  for (const t of TARGETS) {
    if (!t.alive || !t.hittable) continue;
    const d = t.pos.distanceTo(pos) - t.radius;
    if (d < radius) {
      const res = t.hit(damage, t.pos, source);
      if (res === 'kill') kills++;
    }
  }
  // clear enemy bullets in radius
  for (let i = ebullets.length - 1; i >= 0; i--) {
    if (ebullets[i].p.distanceTo(pos) < radius) { glow(ebullets[i].p, 3, 2, 2, 2, 1); removeBullet(i); }
  }
  // visuals
  FX.add.spawn(pos.x, pos.y, pos.z, 0, 0, 0, 0.35, radius * 0.3, radius * 1.3, [color[0] * 2, color[1] * 2, color[2] * 2, 1], [color[0] * 0.3, color[1] * 0.3, color[2] * 0.3, 0], 0);
  FX.add.spawn(pos.x, pos.y, pos.z, 0, 0, 0, 0.5, radius * 0.2, radius * 1.8, [color[0], color[1], color[2], 0.9], [0.1, 0.3, 0.1, 0], 3);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, b = Math.random() * 2 - 1, s = Math.sqrt(1 - b * b), sp = rand(30, 90);
    FX.add.spawn(pos.x, pos.y, pos.z, Math.cos(a) * s * sp, b * sp, Math.sin(a) * s * sp, rand(0.3, 0.7), 0.5, 0.1, [color[0] * 2, color[1] * 2, color[2] * 2, 1], [0, 0.5, 0, 0], 0, { stretch: 0.04, drag: 2 });
  }
  if (kills >= 2) emit('combo', kills, pos);
  return kills;
}

function updateChargeShots(dt) {
  for (let i = chargeShots.length - 1; i >= 0; i--) {
    const S = chargeShots[i];
    S.life -= dt;
    if (S.target && S.target.alive && S.target.hittable) {
      _v.subVectors(S.target.pos, S.p);
      const dist = _v.length();
      const speed = S.v.length();
      _v.multiplyScalar(1 / Math.max(dist, 0.001));
      _v2.copy(S.v).multiplyScalar(1 / speed);
      _v2.lerp(_v, clamp(dt * 7, 0, 1)).normalize();
      S.v.copy(_v2).multiplyScalar(Math.min(speed + dt * 400, 700));
      if (dist < S.target.radius + 3) S.life = 0;
    }
    S.p.addScaledVector(S.v, dt);
    // hit anything on the way
    if (S.life > 0) {
      for (const t of TARGETS) {
        if (!t.alive || !t.hittable) continue;
        if (t.pos.distanceTo(S.p) < t.radius + 2.5) { S.life = 0; break; }
      }
    }
    if (S.life > 0 && S.p.y < groundHeight(S.p.x, S.p.z)) S.life = 0;
    if (S.life <= 0) {
      detonate(S.p, 26, 12, 'charge');
      AudioSys.sfx('explodeM', { pitch: 1.2 });
      chargeShots.splice(i, 1);
      continue;
    }
    const pulse = 1 + Math.sin(G.time * 40) * 0.15;
    glow(S.p, 7 * pulse, 0.8, 4, 1.2, 1);
    glow(S.p, 2.5, 3, 5, 3, 1, 2, G.time * 6);
    S.trailT -= dt;
    if (S.trailT <= 0) {
      S.trailT = 0.012;
      FX.add.spawn(S.p.x, S.p.y, S.p.z, rand(-3, 3), rand(-3, 3), rand(-3, 3), 0.35, 2.8, 0.4, [0.5, 3, 0.9, 0.8], [0.1, 0.8, 0.2, 0], 0);
    }
  }
}

// ============================================================ Bombs
function launchBomb(ship) {
  const g = ship.gunPos('nose', new THREE.Vector3());
  const target = WSTATE.lock || findLock(ship);
  WSTATE.bomb = { p: g, v: ship.fwd.clone().multiplyScalar(260).addScaledVector(ship.railFwd, G.rail.speed), life: 0.85, target, trailT: 0 };
  G.run.bombs--;
  AudioSys.sfx('bombLaunch');
  emit('bombUsed');
}

const blasts = [];
function detonateBomb(b) {
  blasts.push({ p: b.p.clone(), t: 0, done: new Set() });
  AudioSys.sfx('bombBlast');
  AudioSys.duckMusic(0.6, 1.2);
  bigFlash(0.9, [1, 0.85, 0.7]);
  addShake(0.9);
  explode(b.p, 3, { debris: 0 });
  WSTATE.bomb = null;
}

let blastMesh = null;
function ensureBlastMesh() {
  if (blastMesh) return;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        float rim = pow(1.0 - abs(dot(vN, vV)), 2.2);
        float n = n3(vP * 3.0 + uT * 4.0) * 0.6 + n3(vP * 7.0 - uT * 6.0) * 0.4;
        float a = pow(1.0 - uT, 1.5);
        vec3 hot = mix(vec3(7.0, 4.2, 1.6), vec3(4.0, 1.0, 0.35), smoothstep(0.0, 0.5, uT));
        vec3 c = mix(hot, vec3(1.2, 0.25, 1.6), smoothstep(0.4, 1.0, uT));
        float body = rim * (0.55 + 0.9 * n) + smoothstep(0.55, 0.9, n) * 0.25 * (1.0 - uT);
        gl_FragColor = vec4(c * body * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  blastMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), mat);
  blastMesh.visible = false;
  blastMesh.renderOrder = 24;
  G.scene.add(blastMesh);
}

function updateBombs(dt, ship) {
  const b = WSTATE.bomb;
  if (b) {
    b.life -= dt;
    if (b.target && b.target.alive) {
      _v.subVectors(b.target.pos, b.p).normalize();
      const sp = b.v.length();
      _v2.copy(b.v).normalize().lerp(_v, clamp(dt * 5, 0, 1)).normalize();
      b.v.copy(_v2).multiplyScalar(sp);
      if (b.target.pos.distanceTo(b.p) < b.target.radius + 4) b.life = 0;
    }
    b.p.addScaledVector(b.v, dt);
    if (b.p.y < groundHeight(b.p.x, b.p.z) + 1) b.life = 0;
    glow(b.p, 5, 4, 1.4, 0.5, 1);
    glow(b.p, 2, 6, 5, 4, 1, 2, G.time * 5);
    b.trailT -= dt;
    if (b.trailT <= 0) {
      b.trailT = 0.01;
      FX.smoke.spawn(b.p.x, b.p.y, b.p.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 0.8, 0.8, 3, [0.7, 0.7, 0.72, 0.6], [0.6, 0.6, 0.62, 0], 1);
    }
    if (b.life <= 0) detonateBomb(b);
  }
  ensureBlastMesh();
  let anyBlast = false;
  for (let i = blasts.length - 1; i >= 0; i--) {
    const B = blasts[i];
    B.t += dt;
    const k = B.t / 0.75;
    if (k >= 1) { blasts.splice(i, 1); continue; }
    anyBlast = true;
    const r = 80 * (1 - Math.pow(1 - k, 3));
    blastMesh.visible = true;
    blastMesh.position.copy(B.p);
    blastMesh.scale.setScalar(Math.max(0.1, r));
    blastMesh.material.uniforms.uT.value = k;
    let kills = 0;
    for (const t of TARGETS) {
      if (!t.alive || !t.hittable || B.done.has(t)) continue;
      if (t.pos.distanceTo(B.p) - t.radius < r) {
        B.done.add(t);
        if (t.hit(40, t.pos, 'bomb') === 'kill') kills++;
      }
    }
    for (let j = ebullets.length - 1; j >= 0; j--) if (ebullets[j].p.distanceTo(B.p) < r) removeBullet(j);
    if (kills >= 2) emit('combo', kills, B.p);
  }
  if (!anyBlast && blastMesh) blastMesh.visible = false;
}

// ============================================================ Player weapon control (called by the ship's owner each frame)
export function updatePlayerWeapons(dt, ship, canFire) {
  WSTATE.fireCool -= dt;
  WSTATE.hitMark = Math.max(0, WSTATE.hitMark - dt);
  if (canFire && ship.alive) {
    if (Input.pressed('fire') && WSTATE.fireCool <= 0) {
      firePlayerLaser(ship);
      WSTATE.fireCool = 0.075;
      WSTATE.holdT = 0;
    }
    if (Input.held('fire')) {
      WSTATE.holdT += dt;
      if (WSTATE.holdT > 0.28) {
        if (!WSTATE.chargeLoop) WSTATE.chargeLoop = AudioSys.loop('charge');
        const prev = WSTATE.charge;
        WSTATE.charge = Math.min(1, WSTATE.charge + dt / 0.6);
        WSTATE.chargeLoop.set({ level: WSTATE.charge });
        if (prev < 1 && WSTATE.charge >= 1) { WSTATE.charged = true; AudioSys.sfx('chargeReady'); }
      }
    }
    if (WSTATE.charged) {
      const lk = findLock(ship);
      if (lk && lk !== WSTATE.lock) { WSTATE.lock = lk; WSTATE.lockT = 0; AudioSys.sfx('lockOn'); }
      if (WSTATE.lock && (!WSTATE.lock.alive || !WSTATE.lock.hittable)) WSTATE.lock = null;
      WSTATE.lockT += dt;
    }
    if (Input.released('fire')) {
      if (WSTATE.charged) fireChargeShot(ship);
      resetCharge();
    }
    if (Input.pressed('bomb')) {
      if (WSTATE.bomb) WSTATE.bomb.life = 0;
      else if (G.run.bombs > 0) launchBomb(ship);
    }
    // charge orb at the nose
    if (WSTATE.charge > 0.05) {
      const g = ship.gunPos('nose', _v);
      const s = WSTATE.charge;
      const pulse = WSTATE.charged ? 1 + Math.sin(G.time * 30) * 0.12 : 1;
      glow(g, (1.5 + s * 5) * pulse, 0.6 * s, 3.5 * s, 1 * s, 1);
      if (WSTATE.charged) glow(g, 2.5, 2, 4, 2, 1, 2, G.time * 4);
    }
  } else if (!canFire) resetCharge();
  updateLasers(dt);
  updateChargeShots(dt);
  updateBombs(dt, ship);
}

export function resetCharge() {
  WSTATE.holdT = 0; WSTATE.charge = 0; WSTATE.charged = false; WSTATE.lock = null;
  if (WSTATE.chargeLoop) { WSTATE.chargeLoop.stop(0.08); WSTATE.chargeLoop = null; }
}

// ============================================================ Enemy projectiles
export const ebullets = [];
const EB = {
  orb:    { r: 1.2, dmg: 8, col: [4, 0.6, 1.2] },
  laser:  { r: 1.0, dmg: 8, col: [4.5, 0.8, 0.5] },
  big:    { r: 2.4, dmg: 14, col: [5, 1.2, 3] },
  missile:{ r: 1.6, dmg: 14, col: [4, 2, 0.8] },
  flak:   { r: 0.8, dmg: 10, col: [4, 3, 1.5] },
};

export function enemyShot(pos, vel, type = 'orb', opts = {}) {
  const d = EB[type];
  const b = { p: pos.clone(), v: vel.clone(), type, life: opts.life ?? 4.5, r: d.r, dmg: (opts.dmg ?? d.dmg), reflected: false, fuse: opts.fuse ?? 0, turn: opts.turn ?? 0, trailT: 0, hp: 1 };
  ebullets.push(b);
  if (type === 'missile') {
    const tgt = { pos: b.p, radius: 2.2, alive: true, lockable: false, hittable: true, hit: () => { b.life = 0; b.shotDown = true; tgt.alive = false; return 'kill'; } };
    b.tgt = tgt;
    TARGETS.add(tgt);
  }
  return b;
}

// Aim with lead at the player
export function aimAtPlayer(from, speed, spread = 0, out = new THREE.Vector3()) {
  const P = G.player;
  const pv = _v3.copy(P.railFwd).multiplyScalar(G.rail.speed).addScaledVector(P.railRight, P.vu).add(_v.set(0, P.vv, 0));
  const dist = from.distanceTo(P.pos);
  const t = dist / (speed + G.rail.speed * 0.3);
  out.copy(P.pos).addScaledVector(pv, t * 0.85).sub(from).normalize();
  if (spread > 0) { out.x += rand(-spread, spread); out.y += rand(-spread, spread) * 0.6; out.z += rand(-spread, spread); out.normalize(); }
  return out.multiplyScalar(speed * diff().bulletSpeed);
}

function removeBullet(i) {
  const b = ebullets[i];
  if (b.tgt) { b.tgt.alive = false; TARGETS.delete(b.tgt); }
  ebullets.splice(i, 1);
}

export function updateEnemyBullets(dt, ship) {
  for (let i = ebullets.length - 1; i >= 0; i--) {
    const b = ebullets[i];
    b.life -= dt;
    if (b.type === 'missile' && !b.reflected && ship.alive) {
      _v.subVectors(ship.pos, b.p).normalize();
      const sp = b.v.length();
      _v2.copy(b.v).normalize().lerp(_v, clamp(dt * (b.turn || 1.6), 0, 1)).normalize();
      b.v.copy(_v2).multiplyScalar(Math.min(sp + dt * 40, 230));
    }
    b.p.addScaledVector(b.v, dt);
    if (b.life <= 0) {
      if (b.shotDown) { explode(b.p, 0.6, { debris: 0 }); AudioSys.sfx('explodeS', { vol: 0.7 }); emit('missileDown', b.p); }
      removeBullet(i); continue;
    }
    // flak burst
    if (b.type === 'flak') {
      b.fuse -= dt;
      if (b.fuse <= 0) {
        explode(b.p, 0.7, { debris: 0, water: false });
        AudioSys.sfx('explodeS', { vol: 0.5, pitch: 1.3 });
        if (ship.alive && b.p.distanceTo(ship.pos) < 9) { if (!ship.rolling) ship.damage(b.dmg); else ship.deflectFx(); }
        removeBullet(i); continue;
      }
    }
    // collision with player
    if (!b.reflected && ship.alive && ship.dying <= 0) {
      const rr = b.r + 2.1;
      if (b.p.distanceToSquared(ship.pos) < rr * rr) {
        if (ship.rolling && b.type !== 'big') {
          // deflect back toward where it came from
          b.reflected = true;
          b.v.multiplyScalar(-1.3).add(_v.set(rand(-20, 20), rand(-10, 20), 0));
          b.life = 1.5;
          ship.deflectFx();
          sparks(b.p, null, 8, [3, 5, 7], 30, 1);
          emit('deflect');
          continue;
        }
        if (ship.damage(b.dmg)) { explode(b.p, 0.4, { debris: 0, water: false }); }
        removeBullet(i); continue;
      }
    }
    // reflected shots can hit enemies
    if (b.reflected) {
      for (const t of TARGETS) {
        if (!t.alive || !t.hittable || t === b.tgt) continue;
        if (t.pos.distanceTo(b.p) < t.radius + b.r) { t.hit(3, b.p, 'reflect'); b.life = 0; break; }
      }
    }
    // terrain
    if (b.p.y < 0.2 || b.p.y < groundHeight(b.p.x, b.p.z)) {
      if (b.p.y < 1) splash(b.p, 0.2); else sparks(b.p, null, 4, [4, 2, 1], 15, 1);
      removeBullet(i); continue;
    }
    // behind camera → remove
    if (-b.p.z < G.rail.d - 60) { removeBullet(i); continue; }
    // render
    const c = b.reflected ? [1, 3, 5] : EB[b.type].col;
    if (b.type === 'laser') {
      _v.copy(b.v).normalize();
      _v2.copy(b.p).addScaledVector(_v, -9);
      beam(_v2, b.p, 0.5, c[0], c[1], c[2]);
    } else if (b.type === 'missile') {
      glow(b.p, 2.4, c[0], c[1], c[2], 1);
      b.trailT -= dt;
      if (b.trailT <= 0) {
        b.trailT = 0.016;
        FX.smoke.spawn(b.p.x, b.p.y, b.p.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 1.0, 0.7, 2.6, [0.75, 0.74, 0.76, 0.7], [0.6, 0.6, 0.62, 0], 1);
      }
    } else {
      const pulse = 1 + Math.sin(G.time * 25 + i) * 0.18;
      const s = b.type === 'big' ? 6 : b.type === 'flak' ? 2 : 3.6;
      glow(b.p, s * pulse, c[0], c[1], c[2], 1);
      glow(b.p, s * 0.35, 3, 3, 3, 1);
      _v.copy(b.v).normalize();
      _v2.copy(b.p).addScaledVector(_v, -s * 0.9);
      beam(_v2, b.p, s * 0.18, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5);
    }
  }
}

export function clearWeapons() {
  lasers.length = 0; chargeShots.length = 0; blasts.length = 0;
  for (let i = ebullets.length - 1; i >= 0; i--) removeBullet(i);
  WSTATE.bomb = null;
  resetCharge();
  if (blastMesh) blastMesh.visible = false;
}

export function lockTarget() { return WSTATE.lock; }
