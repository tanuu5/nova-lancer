// Wingmen: AI allies flying in formation. They fire at enemies, can be chased (rescue event) and can retreat.
import * as THREE from 'three';
import { G, rand, clamp, lerp, damp, TAU, emit, after } from './core.js';
import { railFrame, railToWorld, groundHeight, zoneW } from './world.js';
import { FX, Trail, glow, beam, sparks, explode } from './fx.js';
import { buildShipModel } from './ship.js';
import { enemies } from './enemies.js';
import { AudioSys } from './audio.js';

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const YUP = new THREE.Vector3(0, 1, 0);

const SLOTS = {
  kota: { ds: 36, u: 23, v: 8 },
  gantetsu: { ds: 30, u: -25, v: 5 },
  rio: { ds: 56, u: 6, v: 15 },
};

export class Wingman {
  constructor(id) {
    this.id = id;
    this.model = buildShipModel(id);
    this.root = new THREE.Group();
    this.root.add(this.model.group);
    this.model.group.scale.setScalar(0.95);
    G.scene.add(this.root);
    this.slot = SLOTS[id];
    this.pos = new THREE.Vector3();
    this.trails = [new Trail(14, 0.14, [1, 1, 1], 0.4), new Trail(14, 0.14, [1, 1, 1], 0.4)];
    this.reset();
  }
  reset() {
    this.s = G.rail.d + this.slot.ds; this.u = this.slot.u; this.v = this.slot.v + 20;
    this.vu = 0; this.vv = 0; this.vs = 0;
    this.bank = 0; this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.mode = 'formation'; this.modeT = 0;
    this.gone = false; this.fireT = rand(1, 3);
    this.root.visible = true;
    this.smoke = 0; this.damaged = false;
    this.target = null;
    this.override = null;
    for (const t of this.trails) t.started = false;
  }
  hide() { this.gone = true; this.root.visible = false; for (const t of this.trails) t.visible = false; }
  show() { this.gone = false; this.root.visible = true; for (const t of this.trails) { t.visible = true; t.started = false; } }

  // Where the wingman wants to be (rail-relative)
  goal(dt) {
    const t = G.time + this.slot.u;
    let ds = this.slot.ds, u = this.slot.u, v = G.player.v * 0.5 + 14 + this.slot.v;
    const zw = zoneW(G.rail.d);
    if (zw.canyon > 0.3) { v = Math.max(v, 70); u *= 1.4; }            // stay above the canyon walls
    if (this.mode === 'chased') { ds = 105 + Math.sin(this.modeT * 0.9) * 25; u = Math.sin(this.modeT * 0.7) * 24; v = 26 + Math.sin(this.modeT * 1.3) * 10; }
    if (this.mode === 'retreat') { ds = 60 + this.modeT * 60; u = this.slot.u * 3; v = 60 + this.modeT * 25; }
    if (this.mode === 'boss') { ds = 40 + Math.sin(t * 0.3) * 20; u = this.slot.u * 2.4 + Math.sin(t * 0.4) * 15; v = 30 + this.slot.v + Math.sin(t * 0.5) * 10; }
    if (this.override) { ds = this.override.ds; u = this.override.u; v = this.override.v; }
    u += Math.sin(t * 0.8) * 3; v += Math.sin(t * 1.1) * 2;
    return { s: G.rail.d + ds, u, v };
  }

  update(dt) {
    if (this.gone) return;
    this.modeT += dt;
    const g = this.goal(dt);
    const k = this.mode === 'chased' ? 2.2 : 1.6;
    const tvu = clamp((g.u - this.u) * k, -60, 60), tvv = clamp((g.v - this.v) * k, -45, 45), tvs = clamp((g.s - this.s) * k, -80, 120);
    this.vu = damp(this.vu, tvu, 3, dt); this.vv = damp(this.vv, tvv, 3, dt); this.vs = damp(this.vs, tvs, 3, dt);
    this.u += this.vu * dt; this.v += this.vv * dt; this.s += G.rail.speed * dt + this.vs * dt;
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
    this.fireT = rand(1.8, 3.6);
    // pick a visible enemy ahead
    let best = null, bd = 1e9;
    for (const e of enemies) {
      if (!e.alive || !e.hittable || e.type === 'gunship' || e.patternName === 'circle' || e.def.ground) continue;
      const d = e.pos.distanceTo(this.pos);
      if (d < 320 && d < bd && e.s > this.s + 20) { bd = d; best = e; }
    }
    if (!best) return;
    // visual laser burst
    const dir = _v.subVectors(best.pos, this.pos).normalize();
    for (let i = 0; i < 2; i++) {
      const from = this.pos.clone().addScaledVector(dir, 6 + i * 20);
      const to = from.clone().addScaledVector(dir, 14);
      FX.beams.add(from, to, 0.35, 0.6, 3, 1);
    }
    if (Math.random() < 0.12 && best.type !== 'raptor' && best.type !== 'carrier') {
      const b = best;
      after(0.18, () => { if (b.alive && G.state === 'play') b.hit(99, b.pos, 'wingman'); });
    }
  }

  barrelRoll() { this.roll = TAU; }

  updateTrails(cam) { if (!this.gone) for (const t of this.trails) t.update(cam); }
}

export const WING = { list: [], byId: {} };

export function initWingmen() {
  for (const id of ['kota', 'gantetsu', 'rio']) {
    const w = new Wingman(id);
    WING.list.push(w);
    WING.byId[id] = w;
  }
}
export function resetWingmen(visible = true) {
  for (const w of WING.list) { w.reset(); if (!visible) w.hide(); else w.show(); }
}
export function updateWingmen(dt) { for (const w of WING.list) w.update(dt); }
export function updateWingmenTrails(cam) { for (const w of WING.list) w.updateTrails(cam); }
export function setWingMode(mode) { for (const w of WING.list) if (!w.gone && w.mode !== 'retreat') { w.mode = mode; w.modeT = 0; } }
