// Wingmen: AI allies. After the opening they cover the leader's six from behind the chase camera and take
// turns sortieing into view; they fly in front for the rescue event (chased) and for the mission-clear shot.
import * as THREE from 'three';
import { G, rand, clamp, lerp, damp, TAU, emit, on, after } from './core.js';
import { railFrame, railToWorld, groundHeight, zoneW } from './world.js';
import { FX, Trail, glow, beam, sparks, explode } from './fx.js';
import { buildShipModel, CAM } from './ship.js';
import { enemies } from './enemies.js';
import { AudioSys } from './audio.js';

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const YUP = new THREE.Vector3(0, 1, 0);

// Front slots: the classic formation ahead of the leader (opening, sorties, mission clear).
const SLOTS = {
  kota: { ds: 36, u: 23, v: 8 },
  gantetsu: { ds: 30, u: -25, v: 5 },
  rio: { ds: 56, u: 6, v: 15 },
};
// Rear slots: covering the leader's six, behind the chase camera (which trails the leader by 19–28).
const REAR = {
  kota: { ds: -50, u: 26, v: 10 },
  gantetsu: { ds: -58, u: -28, v: 6 },
  rio: { ds: -72, u: 4, v: 18 },
};
// While overtaking or dropping back, each wingman swings this far wide of the camera (side offset, height above the lens).
const PASS = { kota: { u: 34, v: 4 }, gantetsu: { u: -34, v: 2 }, rio: { u: 12, v: 22 } };
const PASS_LO = -44, PASS_HI = 24;   // rail distance band (relative to the leader) around the camera

export class Wingman {
  constructor(id) {
    this.id = id;
    this.model = buildShipModel(id);
    this.root = new THREE.Group();
    this.root.add(this.model.group);
    this.model.group.scale.setScalar(0.95);
    G.scene.add(this.root);
    this.slot = SLOTS[id];
    this.rear = REAR[id];
    this.pass = PASS[id];
    this.stance = 'front';
    this.pos = new THREE.Vector3();
    this.trails = [new Trail(14, 0.14, [1, 1, 1], 0.4), new Trail(14, 0.14, [1, 1, 1], 0.4)];
    this.reset();
  }
  reset() {
    const sl = this.stance === 'rear' ? this.rear : this.slot;
    this.s = G.rail.d + sl.ds; this.u = sl.u; this.v = sl.v + 20;
    this.vu = 0; this.vv = 0; this.vs = 0;
    this.bank = 0; this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.mode = 'formation'; this.modeT = 0;
    this.sortieT = 0; this.rel = sl.ds;
    this.gone = false; this.fireT = rand(1, 3);
    this.root.visible = true;
    this.smoke = 0; this.damaged = false;
    this.target = null;
    this.override = null;
    for (const t of this.trails) t.started = false;
  }
  hide() { this.gone = true; this.root.visible = false; for (const t of this.trails) t.visible = false; }
  show() { this.gone = false; this.root.visible = true; for (const t of this.trails) { t.visible = true; t.started = false; } }

  // Flying ahead of the leader (in view) rather than in the rear slot
  out() { return this.stance === 'front' || this.sortieT > 0 || this.mode === 'chased' || this.mode === 'retreat'; }

  // Where the wingman wants to be (rail-relative)
  goal(dt) {
    const t = G.time + this.slot.u;
    const out = this.out(), sl = out ? this.slot : this.rear;
    let ds = sl.ds, u = sl.u, v = G.player.v * 0.5 + 14 + sl.v;
    const zw = zoneW(G.rail.d);
    if (zw.canyon > 0.3) { v = Math.max(v, 70); u *= 1.4; if (out) ds = Math.max(ds, 95); }   // stay above the canyon walls, far enough ahead to be seen up there
    if (this.mode === 'chased') { ds = 105 + Math.sin(this.modeT * 0.9) * 25; u = Math.sin(this.modeT * 0.7) * 24; v = 26 + Math.sin(this.modeT * 1.3) * 10; }
    if (this.mode === 'retreat') { ds = 60 + this.modeT * 60; u = this.slot.u * 3; v = 60 + this.modeT * 25; }
    if (this.mode === 'boss' && out) { ds = 48 + Math.sin(t * 0.3) * 18; u = this.slot.u * 2.4 + Math.sin(t * 0.4) * 15; v = 30 + this.slot.v + Math.sin(t * 0.5) * 10; }
    if (this.override) { ds = this.override.ds; u = this.override.u; v = this.override.v; }
    u += Math.sin(t * 0.8) * 3; v += Math.sin(t * 1.1) * 2;
    // Swing wide of the lens while crossing the camera, so nobody flies through it or through the leader.
    if (!this.override && Math.min(this.rel, ds) < PASS_HI && Math.max(this.rel, ds) > PASS_LO) {
      u = CAM.u + this.pass.u; v = Math.max(v, CAM.v + this.pass.v);
    }
    return { s: G.rail.d + ds, u, v };
  }

  update(dt) {
    if (this.gone) return;
    this.modeT += dt;
    if (this.sortieT > 0) this.sortieT -= dt;
    const g = this.goal(dt);
    const k = this.mode === 'chased' ? 2.2 : 1.6;
    const tvu = clamp((g.u - this.u) * k, -60, 60), tvv = clamp((g.v - this.v) * k, -45, 45), tvs = clamp((g.s - this.s) * k, -80, 120);
    this.vu = damp(this.vu, tvu, 3, dt); this.vv = damp(this.vv, tvv, 3, dt); this.vs = damp(this.vs, tvs, 3, dt);
    this.u += this.vu * dt; this.v += this.vv * dt; this.s += G.rail.speed * dt + this.vs * dt;
    const rel = this.s - G.rail.d;
    // whoosh as a wingman overtakes the leader into view
    if (this.rel < -4 && rel >= -4 && this.vs > 20 && G.state === 'play') AudioSys.sfx('roll', { vol: 0.32, pitch: 0.8, pan: Math.sign(this.pass.u) * 0.7 });
    this.rel = rel;
    railToWorld(this.s, this.u, this.v, this.pos);
    const gh = groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y < gh + 6) { this.pos.y = gh + 6; this.v = this.pos.y; this.vv = Math.max(this.vv, 5); }
    if (this.pos.y < 3) { this.pos.y = 3; this.v = 3; }
    // attitude
    this.yaw = damp(this.yaw, -this.vu / 60 * 0.4, 5, dt);
    this.pitch = damp(this.pitch, this.vv / 45 * 0.3, 5, dt);
    this.bank = damp(this.bank, -this.vu / 60 * 0.9, 5, dt);
    if (this.roll > 0) this.roll = Math.max(0, this.roll - dt * TAU * 1.8);
    railFrame(this.s, _p, _f, _r);
    _m.makeBasis(_r, YUP, _v.copy(_f).negate());
    _q.setFromRotationMatrix(_m);
    _e.set(this.pitch, this.yaw, this.bank + this.roll, 'YXZ');
    _q2.setFromEuler(_e);
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(_q).multiply(_q2);
    // engines + trails
    for (let i = 0; i < 2; i++) {
      _v.copy(this.model.nozzles[i]).multiplyScalar(0.95).applyQuaternion(this.root.quaternion).add(this.pos);
      glow(_v, 1.0, 0.4, 0.7, 1.1, 0.7);
      _v2.copy(this.model.tips[i]).multiplyScalar(0.95).applyQuaternion(this.root.quaternion).add(this.pos);
      this.trails[i].push(_v2);
      this.trails[i].intensity = clamp(Math.abs(this.vu) / 50 + 0.15, 0, 1);
    }
    for (const f of this.model.flames) { f.material.uniforms.uTime.value = G.time; f.material.uniforms.uPower.value = 0.8; f.scale.z = 1.8; }
    if (this.damaged) {
      this.smoke -= dt;
      if (this.smoke <= 0) { this.smoke = 0.06; FX.smoke.spawn(this.pos.x, this.pos.y, this.pos.z, rand(-1, 1), rand(1, 3), rand(3, 7), 1.2, 1, 4, [0.15, 0.15, 0.16, 0.6], [0.3, 0.3, 0.32, 0], 1, { fadeIn: 0.05 }); }
    }
    if (this.mode === 'retreat' && this.modeT > 6) this.hide();
    this.tryFire(dt);
  }

  tryFire(dt) {
    if (this.mode === 'retreat') return;
    this.fireT -= dt;
    if (this.fireT > 0) return;
    this.fireT = this.sortieT > 0 ? rand(0.9, 1.8) : this.out() ? rand(1.8, 3.6) : rand(2.6, 5);
    // pick an enemy ahead of the leader (chasers in the rescue event are left to the player)
    let best = null, bd = 1e9;
    for (const e of enemies) {
      if (!e.alive || !e.hittable || e.type === 'gunship' || e.patternName === 'circle' || e.patternName === 'chase' || e.def.ground) continue;
      const ahead = e.s - G.rail.d;
      if (ahead < 40 || ahead > 360 || e.s < this.s + 20) continue;
      const d = e.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    // tracer burst; from the rear slot it streaks past the leader from behind
    const kill = Math.random() < 0.12 && best.type !== 'raptor' && best.type !== 'carrier';
    const tt = bd / BOLT_SPEED;
    railFrame(best.s, _p, _f, _r);
    _v.copy(best.pos).addScaledVector(_f, G.rail.speed * tt);                               // lead the target along the rail
    if (!kill) _v.add(_v2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 8)));   // near miss
    const dir = _v.sub(this.pos).normalize();
    const life = kill ? tt : tt * 1.6 + 0.05;                                                  // misses fly on past
    for (let i = 0; i < 2; i++) bolts.push({ p: this.pos.clone().addScaledVector(dir, 6 - i * 22), d: dir.clone(), life: life + i * 0.025 });
    if (kill) {
      const b = best;
      after(tt, () => { if (b.alive && G.state === 'play') b.hit(99, b.pos, 'wingman'); });
    }
  }

  barrelRoll() { this.roll = TAU; }

  updateTrails(cam) { if (!this.gone) for (const t of this.trails) t.update(cam); }
}

// ------------------------------------------------------------ Tracer bolts
const BOLT_SPEED = 900;
const bolts = [];
function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.life -= dt;
    if (b.life <= 0) { bolts.splice(i, 1); continue; }
    b.p.addScaledVector(b.d, BOLT_SPEED * dt);
    _v.copy(b.p).addScaledVector(b.d, -16);
    beam(_v, b.p, 0.35, 0.6, 3, 1);
  }
}

// ------------------------------------------------------------ Sorties: one wingman at a time leaves the rear slot to fly in view
const SORTIE = { wait: 0, cool: 0 };
const SORTIE_GAP = 9;                       // seconds of quiet after a sortie before the next one
function canSortie(w) {
  return G.state === 'play' && !w.gone && w.stance === 'rear' && w.mode !== 'chased' && w.mode !== 'retreat' && !w.override && w.sortieT <= 0
    && !WING.list.some(o => o.mode === 'chased');
}
function startSortie(w, dur = rand(5.5, 7)) {
  w.sortieT = dur;
  w.fireT = Math.min(w.fireT, rand(0.6, 1.2));
  SORTIE.cool = dur + SORTIE_GAP;
  SORTIE.wait = dur + rand(13, 22);
  if (Math.random() < 0.4) after(rand(1.8, 2.6), () => { if (w.sortieT > 0 && !w.gone) { w.barrelRoll(); AudioSys.sfx('roll', { vol: 0.3, pan: Math.sign(w.pass.u) * 0.6 }); } });
}
function updateSorties(dt) {
  SORTIE.cool -= dt; SORTIE.wait -= dt;
  if (SORTIE.wait > 0 || SORTIE.cool > 0) return;
  const pool = WING.list.filter(canSortie);
  if (pool.length) startSortie(pool[Math.floor(Math.random() * pool.length)]);
  else SORTIE.wait = 3;
}

export const WING = { list: [], byId: {} };

export function initWingmen() {
  for (const id of ['kota', 'gantetsu', 'rio']) {
    const w = new Wingman(id);
    WING.list.push(w);
    WING.byId[id] = w;
  }
  // a wingman who starts talking flies out where the player can see them (if nobody has just been out)
  on('radioStart', (who) => { const w = WING.byId[who]; if (w && SORTIE.cool <= 0 && canSortie(w)) startSortie(w); });
}
export function resetWingmen(visible = true) {
  bolts.length = 0;
  SORTIE.wait = rand(10, 16); SORTIE.cool = 6;
  for (const w of WING.list) { w.reset(); if (!visible) w.hide(); else w.show(); }
}
export function updateWingmen(dt) { for (const w of WING.list) w.update(dt); updateSorties(dt); updateBolts(dt); }
export function updateWingmenTrails(cam) { for (const w of WING.list) w.updateTrails(cam); }
export function setWingMode(mode) { for (const w of WING.list) if (!w.gone && w.mode !== 'retreat') { w.mode = mode; w.modeT = 0; } }
// 'front' = formation ahead of the leader, 'rear' = behind the camera with occasional sorties.
// `stagger` spaces the change out between wingmen (seconds); without it the change is immediate.
export function setWingStance(stance, stagger = 0) {
  WING.list.forEach((w, i) => { if (stagger) after(i * stagger, () => { w.stance = stance; }); else w.stance = stance; });
  if (stance === 'rear') { SORTIE.wait = Math.max(SORTIE.wait, rand(10, 16)); SORTIE.cool = Math.max(SORTIE.cool, 6); }
}
// Send everyone out at once (staggered), e.g. when the boss surfaces.
export function sortieAll(delay = 0, dur = 7) {
  WING.list.forEach((w, i) => after(delay + i * 0.45, () => { if (canSortie(w)) startSortie(w, dur - i * 0.45); }));
}
// Keep a wingman out in front for a while (e.g. after being rescued).
export function holdOut(w, dur) { w.sortieT = Math.max(w.sortieT, dur); SORTIE.cool = Math.max(SORTIE.cool, dur + SORTIE_GAP); }
