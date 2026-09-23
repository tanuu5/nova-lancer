// Boss: MIZUCHI — a mechanical sea-dragon. Its body is a chain simulated in rail-relative space so it
// always reads well from the chase camera. Phase 1: dorsal turrets. Phase 2: jaw core + sweeping beam.
import * as THREE from 'three';
import { G, rand, clamp, lerp, damp, TAU, emit, diff, easeOutCubic, easeInOutCubic } from './core.js';
import { railFrame, railToWorld, emissiveVertexMaterial, mergeGeometries } from './world.js';
import { FX, explode, glow, beam, sparks, splash, addShake, bigFlash } from './fx.js';
import { TARGETS, enemyShot, aimAtPlayer } from './weapons.js';
import { AudioSys } from './audio.js';
import { loft, slab, fin, mirrorX } from './ship.js';
import { paint } from './enemies.js';
import { POST } from './gfx.js';

const hexS = (w, h, y = 0) => [[w, y], [w * 0.62, y + h], [-w * 0.62, y + h], [-w, y], [-w * 0.7, y - h * 0.8], [w * 0.7, y - h * 0.8]];
const oct = (r, y = 0, sy = 1) => { const a = []; for (let i = 0; i < 8; i++) { const t = i / 8 * TAU; a.push([Math.cos(t) * r, y + Math.sin(t) * r * sy]); } return a; };
const sym = (g, hex, em = 0) => [paint(g, hex, em), paint(mirrorX(g), hex, em)];

const COL = { armor: '#2f4260', plate: '#4a6284', trim: '#d4a64a', eye: '#ff2238', seam: '#27ffd2', teeth: '#e8e1cc', belly: '#223049', membrane: '#9a2436' };

function headGeo() {
  const skull = loft([
    { z: -13, pts: hexS(1.3, 0.9, 0.7) }, { z: -9, pts: hexS(3.3, 1.8, 1.1) }, { z: -3, pts: hexS(4.8, 2.6, 1.5) },
    { z: 3, pts: hexS(5.6, 3.2, 1.7) }, { z: 8, pts: hexS(4.5, 2.7, 1.3) },
  ]);
  const parts = [paint(skull, COL.armor)];
  // brow plates & snout plate
  parts.push(...sym(slab([[1.2, 3.6], [4.6, 1.4], [5.2, -2.6], [2.0, -1.8]], 0.5).translate(0, 4.3, 0), COL.plate));
  parts.push(paint(slab([[-1.1, 12.8], [1.1, 12.8], [2.2, 4], [-2.2, 4]], 0.5).translate(0, 2.3, 0), COL.plate));
  // eyes
  parts.push(...sym(new THREE.OctahedronGeometry(1, 0).scale(1.1, 0.7, 1.6).translate(4.2, 2.3, -2.6), COL.eye, 1));
  // glowing seams along the skull
  parts.push(...sym(new THREE.BoxGeometry(0.25, 0.25, 12).translate(4.3, 0.6, -1).rotateY(0.08), COL.eye, 1));
  // horns
  for (const sx of [-1, 1]) {
    const h = new THREE.ConeGeometry(1.1, 11, 6).rotateX(-Math.PI / 2 + 0.5).rotateZ(-sx * 0.35).translate(sx * 3.2, 5.6, 8.5);
    parts.push(paint(h, COL.trim));
    const h2 = new THREE.ConeGeometry(0.6, 6, 5).rotateX(-Math.PI / 2 + 0.2).rotateZ(-sx * 0.9).translate(sx * 5.2, 3.2, 6.5);
    parts.push(paint(h2, COL.trim));
  }
  // crest fins
  for (let k = 0; k < 3; k++) parts.push(paint(fin([[0, 0], [3, 0], [4.2, 3.2 - k * 0.6], [2.2, 3.0 - k * 0.6]], 0.35).translate(0, 4.4 - k * 0.3, -1 + k * 3.6), COL.trim));
  // upper teeth
  for (let k = 0; k < 6; k++) {
    const z = -11.5 + k * 1.7, x = 0.9 + k * 0.55;
    for (const sx of [-1, 1]) parts.push(paint(new THREE.ConeGeometry(0.28, 1.4, 4).rotateX(Math.PI).translate(sx * x, -0.5, z), COL.teeth));
  }
  // barbels (mechanical whiskers)
  for (const sx of [-1, 1]) {
    const b = new THREE.ConeGeometry(0.28, 16, 5).rotateX(Math.PI / 2).rotateY(sx * 0.35).rotateX(-0.12).translate(sx * 4.5, 0.2, -2);
    parts.push(paint(b, COL.trim));
  }
  return mergeGeometries(parts);
}

function jawGeo() {
  // built with the hinge at the origin (hinge sits at z = +6 in head space)
  const jaw = loft([{ z: -18, pts: hexS(1.1, 0.6, -0.9) }, { z: -12, pts: hexS(2.9, 1.1, -1.3) }, { z: -6, pts: hexS(4.1, 1.4, -1.5) }, { z: 0, pts: hexS(4.3, 1.3, -1.1) }]);
  const parts = [paint(jaw, COL.plate)];
  for (let k = 0; k < 6; k++) {
    const z = -17 + k * 1.8, x = 0.8 + k * 0.52;
    for (const sx of [-1, 1]) parts.push(paint(new THREE.ConeGeometry(0.26, 1.3, 4).translate(sx * x, 0.1, z), COL.teeth));
  }
  parts.push(paint(new THREE.BoxGeometry(5, 0.3, 10).translate(0, -0.3, -8), COL.membrane, 0.5));
  return mergeGeometries(parts);
}

function segGeo(kind) {
  const r = 5;
  const body = loft([{ z: -4.8, pts: oct(r * 0.86, 0, 0.9) }, { z: -2, pts: oct(r, 0, 0.92) }, { z: 2.2, pts: oct(r * 0.96, 0, 0.92) }, { z: 4.8, pts: oct(r * 0.82, 0, 0.9) }]);
  const parts = [paint(body, COL.armor)];
  parts.push(paint(slab([[-2.6, 4.2], [2.6, 4.2], [3.2, -4.2], [-3.2, -4.2]], 0.6).translate(0, r * 0.9, 0), COL.plate));
  parts.push(paint(fin([[0, 0], [5.5, 0], [7.2, 4.2], [3.4, 3.8]], 0.5).translate(0, r * 0.95, -3.5), kind === 'tail' ? COL.trim : COL.plate));
  parts.push(paint(fin([[0.4, 0], [4.8, 0], [6.3, 3.4], [3.3, 3.2]], 0.1).translate(0, r * 0.95 + 0.2, -3.0), COL.membrane, 0.3));
  parts.push(...sym(slab([[4.2, 1.5], [8.4, -1.2], [8.8, -3.2], [4.2, -2.4]], 0.35).translate(0, -1.2, 0), COL.plate));
  parts.push(paint(new THREE.TorusGeometry(r * 0.86, 0.28, 4, 16).translate(0, 0, 4.75), COL.seam, 1));
  parts.push(paint(slab([[-2.2, 4], [2.2, 4], [2.6, -4], [-2.6, -4]], 0.5).translate(0, -r * 0.86, 0), COL.belly));
  if (kind === 'tail') {
    parts.push(paint(fin([[0, 0], [7, 0], [11, 8], [4, 5]], 0.4).translate(0, 0, 3), COL.trim));
    parts.push(paint(fin([[0, 0], [7, 0], [11, -8], [4, -5]], 0.4).translate(0, 0, 3), COL.trim));
  }
  return mergeGeometries(parts);
}

function turretGeo() {
  // barrels point +Z (Object3D.lookAt aims +Z at the target)
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(2.1, 2.5, 1.2, 8), COL.plate),
    paint(new THREE.SphereGeometry(1.8, 10, 5, 0, TAU, 0, Math.PI / 2).translate(0, 0.5, 0), COL.armor),
    ...[-0.6, 0.6].map(x => paint(new THREE.CylinderGeometry(0.25, 0.3, 3.4, 6).rotateX(Math.PI / 2).translate(x, 1.2, 2.2), '#1a1d24')),
    paint(new THREE.BoxGeometry(1.4, 0.4, 0.4).translate(0, 1.7, 1.2), COL.eye, 1),
  ]);
}

// ============================================================ Boss
const N = 16;
const TURRETS = [2, 4, 6, 8, 10, 12];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export class Boss {
  constructor() {
    this.mat = emissiveVertexMaterial({ roughness: 0.4, metalness: 0.65 }, 3.2);
    this.root = new THREE.Group();
    // head
    this.head = new THREE.Group();
    this.skull = new THREE.Mesh(headGeo(), this.mat);
    this.jawPivot = new THREE.Group();
    this.jawPivot.position.set(0, -0.5, 6);
    this.jaw = new THREE.Mesh(jawGeo(), this.mat);
    this.jawPivot.add(this.jaw);
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.6, 1.2) });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 2), this.coreMat);
    this.core.position.set(0, -0.8, -3.5);
    this.head.add(this.skull, this.jawPivot, this.core);
    this.head.scale.setScalar(1.7);
    this.skull.castShadow = this.jaw.castShadow = true;
    this.root.add(this.head);
    // body
    const gBody = segGeo('body'), gTail = segGeo('tail'), gTur = turretGeo();
    this.segs = [];
    for (let i = 0; i < N; i++) {
      const tail = i >= N - 2;
      const scale = 1.35 * (i < 3 ? 1.05 - i * 0.02 : lerp(1.0, 0.4, (i - 3) / (N - 3)));
      const mesh = new THREE.Mesh(tail && i === N - 1 ? gTail : gBody, this.mat);
      mesh.scale.setScalar(scale);
      mesh.castShadow = true;
      this.root.add(mesh);
      const seg = { mesh, scale, pos: new THREE.Vector3(), prevY: 0, turret: null, fire: 0 };
      if (TURRETS.includes(i)) {
        const tm = new THREE.Mesh(gTur, this.mat);
        tm.castShadow = true;
        this.root.add(tm);
        seg.turret = { mesh: tm, hp: 10, alive: true, pos: new THREE.Vector3(), fireT: rand(1, 3) };
      }
      this.segs.push(seg);
    }
    // rail-relative chain nodes: 0 = head, i+1 = segment i
    this.nodes = [];
    for (let i = 0; i <= N; i++) this.nodes.push({ s: 0, u: 0, v: 0 });
    this.spacing = [];
    for (let i = 0; i < N; i++) this.spacing.push(i === 0 ? 20 : 10.2 * this.segs[i].scale + 1.2);
    this.headPos = new THREE.Vector3();
    this.mouthPos = new THREE.Vector3();
    this.headQuat = new THREE.Quaternion();
    this.buildTargets();
    this.active = false;
  }

  buildTargets() {
    const self = this;
    this.coreT = {
      pos: new THREE.Vector3(), radius: 5.8, alive: true, lockable: true, hittable: false, hp: 150,
      hit(dmg, p, src) {
        if (!self.active || self.phase === 'dying') return 'none';
        if (self.jawOpen < 0.55) { sparks(p || this.pos, null, 6, [3, 3.5, 4], 25, 1); return 'armor'; }
        this.hp -= dmg * (src === 'bomb' ? 0.6 : 1);
        self.flash = 1;
        emit('bossHit');
        if (this.hp <= 0) { this.hp = 0; self.die(); return 'kill'; }
        return 'hit';
      },
    };
    this.headT = { pos: new THREE.Vector3(), radius: 12, alive: true, lockable: false, hittable: true, hit: () => 'armor' };
    this.segT = this.segs.map((s) => ({ pos: s.pos, radius: 5.5 * s.scale, alive: true, lockable: false, hittable: true, hit: () => 'armor' }));
    this.turT = [];
    for (const s of this.segs) {
      if (!s.turret) continue;
      const tr = s.turret;
      const t = {
        pos: tr.pos, radius: 5.2, alive: true, lockable: true, hittable: true,
        hit(dmg, p, src) {
          if (!tr.alive) return 'none';
          tr.hp -= dmg;
          tr.flash = 1;
          emit('bossHit');
          if (tr.hp <= 0) { self.destroyTurret(s); return 'kill'; }
          return 'hit';
        },
      };
      tr.target = t;
      this.turT.push(t);
    }
  }

  get maxHp() { return 60 + 150; }
  get hp() { let h = this.coreT.hp; for (const s of this.segs) if (s.turret && s.turret.alive) h += Math.max(0, s.turret.hp); return h; }

  start() {
    this.active = true;
    this.phase = 'intro'; this.pt = 0; this.t = 0;
    this.jawOpen = 0; this.jawTarget = 0; this.flash = 0;
    this.enraged = false; this.cycle = 0; this.sub = 'approach'; this.subT = 0;
    this.face = 0; this.beamLoop = null; this.chargeLoop = null; this.beamDir = 1; this.beamTick = 0;
    this.missileT = 6; this.diveT = 12; this.diving = 0; this.burstT = 4; this.passDone = false;
    this.roared = false; this.reported = false; this.deadT = 0; this.deathIdx = 0;
    this.coreT.hp = 150; this.coreT.alive = true;
    for (const s of this.segs) if (s.turret) { s.turret.hp = 10; s.turret.alive = true; s.turret.mesh.visible = true; s.turret.target.alive = true; s.turret.flash = 0; }
    for (const s of this.segs) { s.mesh.visible = true; s.burn = 0; s.dead = false; }
    this.head.visible = true;
    this.mat.userData.tint.value.setRGB(1, 1, 1);
    this.mat.userData.emit.value = 3.2;
    // start submerged far ahead
    this.hs = 330; this.hu = 0; this.hv = -70;
    for (let i = 0; i <= N; i++) { const n = this.nodes[i]; n.s = 330 + i * 11; n.u = Math.sin(i * 0.5) * 10; n.v = -70 - i * 2; }
    G.scene.add(this.root);
    for (const t of [this.coreT, this.headT, ...this.segT, ...this.turT]) TARGETS.add(t);
    this.segs.forEach(s => { s.prevY = -50; });
    this.headPrevY = -50;
  }

  stop() {
    this.active = false;
    G.scene.remove(this.root);
    for (const t of [this.coreT, this.headT, ...this.segT, ...this.turT]) TARGETS.delete(t);
    if (this.beamLoop) { this.beamLoop.stop(0.2); this.beamLoop = null; }
    if (this.chargeLoop) { this.chargeLoop.stop(0.2); this.chargeLoop = null; }
  }

  destroyTurret(seg) {
    const tr = seg.turret;
    tr.alive = false; tr.target.alive = false;
    tr.mesh.visible = false;
    explode(tr.pos, 2.4);
    AudioSys.sfx('explodeL');
    addShake(0.35);
    seg.burn = 1;
    emit('bossTurretDown', this.turretsLeft());
    if (this.turretsLeft() === 0) this.enterPhase2();
  }
  turretsLeft() { let n = 0; for (const s of this.segs) if (s.turret && s.turret.alive) n++; return n; }

  enterPhase2() {
    this.phase = 'p2'; this.pt = 0; this.sub = 'weave'; this.subT = 1.5;
    AudioSys.sfx('roar', { pitch: 1.1 });
    addShake(0.5);
    emit('bossPhase', 2);
  }

  die() {
    this.phase = 'dying'; this.pt = 0;
    this.coreT.alive = false;
    this.jawTarget = 1;
    if (this.beamLoop) { this.beamLoop.stop(0.1); this.beamLoop = null; }
    if (this.chargeLoop) { this.chargeLoop.stop(0.1); this.chargeLoop = null; }
    AudioSys.sfx('roar', { pitch: 0.8 });
    bigFlash(0.8, [1, 0.6, 0.6]);
    addShake(1);
    G.slowMo = 0.3;
    this.deathIdx = N - 1;
    this.deathT = 0.6;
    emit('bossDying');
  }

  // ---------------------------------------------------------------- behaviour
  update(dt) {
    if (!this.active) return;
    this.t += dt; this.pt += dt;
    const P = G.player;
    let ts = this.hs, tu = this.hu, tv = this.hv, faceK = 0;
    const T = this.t;
    switch (this.phase) {
      case 'intro': {
        const k = this.pt;
        if (k < 1.6) { tv = -70; ts = 300; }
        else if (k < 4.2) { const e = easeOutCubic((k - 1.6) / 2.6); tv = lerp(-70, 58, e); ts = 300 - e * 40; tu = Math.sin(k) * 6; }
        else { const e = easeInOutCubic((k - 4.2) / 1.8); tv = lerp(58, 34, e); ts = 260 - e * 20; faceK = 0.4; }
        if (k > 1.2 && !this.roared) { this.roared = true; AudioSys.sfx('roar'); addShake(0.8); }
        if (k < 1.6) { // churning sea
          railToWorld(G.rail.d + 300, rand(-30, 30), 0, _v);
          if (Math.random() < 0.6) splash(_v, rand(0.8, 1.8));
          addShake(0.02);
        }
        if (k > 6) { this.phase = 'p1'; this.pt = 0; emit('bossPhase', 1); }
        break;
      }
      case 'p1': {
        ts = 178 + 28 * Math.sin(T * 0.37);
        tu = 52 * Math.sin(T * 0.29);
        tv = 34 + 13 * Math.sin(T * 0.47 + 1);
        this.diveT -= dt;
        if (this.diveT <= 0 && this.diving <= 0) { this.diving = 4.2; this.diveT = 15; this.diveU = rand(-50, 50); }
        if (this.diving > 0) {
          this.diving -= dt;
          const k = 1 - this.diving / 4.2;
          tv = k < 0.5 ? lerp(tv, -45, easeInOutCubic(k * 2)) : lerp(-45, tv, easeInOutCubic((k - 0.5) * 2));
          tu = lerp(tu, this.diveU, Math.sin(k * Math.PI));
        }
        faceK = 0.25;
        this.turretFire(dt);
        this.tailMissiles(dt, 9);
        break;
      }
      case 'p2': {
        this.subT -= dt;
        const enr = this.enraged;
        switch (this.sub) {
          case 'weave':
            ts = 185 + 25 * Math.sin(T * 0.5); tu = 55 * Math.sin(T * (enr ? 0.45 : 0.33)); tv = 32 + 12 * Math.sin(T * 0.6);
            this.jawTarget = 0; faceK = 0.2;
            this.tailMissiles(dt, enr ? 5 : 7);
            if (enr) this.ringBursts(dt);
            if (this.subT <= 0) {
              if (enr && !this.passDone && this.cycle % 2 === 1) { this.sub = 'pass'; this.subT = 5.6; this.passSide = P.u > 0 ? -1 : 1; this.passDone = true; AudioSys.sfx('roar', { pitch: 1.2 }); }
              else { this.sub = 'approach'; this.subT = 2.2; }
            }
            break;
          case 'approach':
            ts = damp(this.hs, 128, 2, dt); tu = damp(this.hu, P.u * 0.4, 2, dt); tv = damp(this.hv, clamp(P.v + 8, 18, 46), 2, dt);
            faceK = 1; this.jawTarget = 0.2;
            if (this.subT <= 0) { this.sub = 'charge'; this.subT = enr ? 1.3 : 1.8; this.chargeLoop = AudioSys.loop('beamCharge'); emit('bossCharge'); }
            break;
          case 'charge':
            ts = 128 + Math.sin(T * 2) * 4; tu = damp(this.hu, P.u * 0.5, 1.5, dt); tv = damp(this.hv, clamp(P.v + 6, 18, 46), 1.5, dt);
            faceK = 1; this.jawTarget = 1;
            this.chargeFx(dt);
            if (this.subT <= 0) {
              if (this.chargeLoop) { this.chargeLoop.stop(0.05); this.chargeLoop = null; }
              this.sub = 'beam'; this.subT = enr ? 2.0 : 2.5; this.beamT = 0; this.beamDir = P.u > 0 ? -1 : 1; this.beamLoop = AudioSys.loop('beam'); addShake(0.4);
            }
            break;
          case 'beam':
            ts = 128; tu = this.hu; tv = this.hv; faceK = 1; this.jawTarget = 1;
            this.beamFx(dt);
            if (this.subT <= 0) { if (this.beamLoop) { this.beamLoop.stop(0.15); this.beamLoop = null; } this.sub = 'open'; this.subT = enr ? 2.4 : 3.2; }
            break;
          case 'open':
            ts = 128 + Math.sin(T * 1.5) * 6; tu = damp(this.hu, P.u * 0.3 + Math.sin(T) * 12, 1, dt); tv = damp(this.hv, 26 + Math.sin(T * 1.3) * 6, 1, dt);
            faceK = 1; this.jawTarget = 1;
            if (Math.random() < dt * 1.2) this.mouthSpread();
            if (this.subT <= 0) { this.sub = 'weave'; this.subT = enr ? 3.5 : 5; this.cycle++; }
            break;
          case 'pass': {
            const k = 1 - this.subT / 5.6;
            ts = k < 0.5 ? lerp(230, -70, easeInOutCubic(k * 2)) : lerp(-70, 240, easeInOutCubic((k - 0.5) * 2));
            tu = this.passSide * 62; tv = 20 + Math.sin(k * TAU) * 6; faceK = 0; this.jawTarget = 0.4;
            if (this.subT <= 0) { this.sub = 'weave'; this.subT = 3; this.cycle++; }
            break;
          }
        }
        if (!this.enraged && this.coreT.hp < 75) {
          this.enraged = true; this.passDone = false;
          this.mat.userData.tint.value.setRGB(1.35, 0.7, 0.72);
          this.mat.userData.emit.value = 5;
          AudioSys.sfx('roar', { pitch: 1.3 });
          emit('bossPhase', 3);
        }
        break;
      }
      case 'dying': {
        tv = this.hv - dt * 8; ts = this.hs + dt * 10; tu = this.hu; this.jawTarget = 1; faceK = 0.5;
        this.deathT -= G.rdt;
        if (this.deathT <= 0 && this.deathIdx >= -1) {
          this.deathT = 0.13;
          if (this.deathIdx >= 0) {
            const s = this.segs[this.deathIdx];
            explode(s.pos, 2.6 * s.scale + 0.8, { debris: 5 });
            AudioSys.sfx(this.deathIdx % 2 ? 'explodeM' : 'explodeL', { vol: 0.8 });
            s.mesh.visible = false; if (s.turret) s.turret.mesh.visible = false; s.dead = true;
          } else {
            explode(this.headPos, 6, { debris: 14 });
            explode(this.headPos.clone().add(_v.set(0, 6, 0)), 4);
            AudioSys.sfx('explodeL'); AudioSys.sfx('bombBlast');
            bigFlash(1, [1, 0.9, 0.8]);
            addShake(1.2);
            this.head.visible = false;
            splash(_v.copy(this.headPos).setY(0), 5);
            G.slowMo = 1;
            this.deadT = 0;
          }
          this.deathIdx--;
        }
        if (this.deathIdx < -1) { this.deadT = (this.deadT || 0) + G.rdt; if (this.deadT > 2.2 && !this.reported) { this.reported = true; emit('bossDefeated'); } }
        break;
      }
    }
    // head motion (critically damped toward the target)
    const k = this.phase === 'intro' ? 3.2 : (this.sub === 'pass' ? 3.5 : 2.2);
    this.hs = damp(this.hs, ts, k, dt); this.hu = damp(this.hu, tu, k, dt); this.hv = damp(this.hv, tv, k, dt);
    this.jawOpen = damp(this.jawOpen, this.jawTarget, 5, dt);
    this.face = damp(this.face, faceK, 3, dt);
    this.simulate(dt);
    this.place(dt);
    this.collide(dt);
  }

  simulate(dt) {
    const n = this.nodes;
    n[0].s = this.hs; n[0].u = this.hu; n[0].v = this.hv;
    for (let i = 1; i <= N; i++) {
      const a = n[i - 1], b = n[i];
      b.s += 5 * dt;                          // drift away from the player so the body stays extended
      b.u -= Math.sign(n[0].u || 1) * 4.5 * dt; // …and sweep to the side opposite the head → S-shaped silhouette
      if (this.phase === 'dying') b.v -= 6 * dt * (i / N);
      let ds = b.s - a.s, du = b.u - a.u, dv = b.v - a.v;
      const len = Math.sqrt(ds * ds + du * du + dv * dv) || 1;
      const k = this.spacing[i - 1] / len;
      b.s = a.s + ds * k; b.u = a.u + du * k; b.v = a.v + dv * k;
    }
  }

  place(dt) {
    const d = G.rail.d;
    const n = this.nodes;
    const T = this.t;
    // head
    railToWorld(d + n[0].s, n[0].u, n[0].v, this.headPos);
    const wpos = [];
    for (let i = 1; i <= N; i++) {
      const w = Math.min(1, i / 4);
      const ph = i * 0.55 - T * 2.4;
      const s = this.segs[i - 1];
      railToWorld(d + n[i].s, n[i].u + Math.sin(ph) * 7 * w, n[i].v + Math.sin(ph * 0.8 + 1) * 3.5 * w, s.pos);
      wpos.push(s.pos);
    }
    // segment orientation: -Z toward the previous node
    for (let i = 0; i < N; i++) {
      const s = this.segs[i];
      const prev = i === 0 ? this.headPos : this.segs[i - 1].pos;
      _m.lookAt(s.pos, prev, _up);
      s.mesh.quaternion.setFromRotationMatrix(_m);
      s.mesh.position.copy(s.pos);
      if (s.turret) {
        const tr = s.turret;
        tr.pos.set(0, 5.4, 0).multiplyScalar(s.scale).applyQuaternion(s.mesh.quaternion).add(s.pos);
        tr.mesh.position.copy(tr.pos);
        tr.mesh.scale.setScalar(s.scale * 1.25);
        tr.mesh.lookAt(G.player.pos);
        tr.flash = Math.max(0, (tr.flash || 0) - dt * 6);
      }
      // water crossing splashes
      if ((s.prevY < 0) !== (s.pos.y < 0) && this.phase !== 'dying') splash(_v.copy(s.pos).setY(0), 1.6 * s.scale);
      s.prevY = s.pos.y;
      if (s.burn > 0 && s.pos.y > 0 && Math.random() < dt * 25) {
        FX.add.spawn(s.pos.x + rand(-2, 2), s.pos.y + 4 * s.scale, s.pos.z + rand(-2, 2), 0, rand(3, 6), 0, 0.5, 2, 4, [4, 1.6, 0.4, 1], [0.8, 0.2, 0, 0], 1);
        FX.smoke.spawn(s.pos.x, s.pos.y + 5 * s.scale, s.pos.z, rand(-1, 1), rand(3, 7), rand(1, 4), 1.6, 2, 7, [0.1, 0.1, 0.11, 0.7], [0.25, 0.25, 0.27, 0], 1, { fadeIn: 0.06 });
      }
    }
    // head orientation: along the neck, blended toward facing the player
    _m.lookAt(this.headPos, _v.copy(this.headPos).add(_v2.subVectors(this.headPos, this.segs[0].pos)), _up);
    // lookAt(eye, target) gives +Z from target to eye; we want -Z forward → target in front
    const qNeck = new THREE.Quaternion().setFromRotationMatrix(_m);
    _m.lookAt(this.headPos, G.player.pos, _up);
    const qFace = new THREE.Quaternion().setFromRotationMatrix(_m);
    this.headQuat.copy(qNeck).slerp(qFace, this.face);
    this.head.position.copy(this.headPos);
    this.head.quaternion.copy(this.headQuat);
    if ((this.headPrevY < 0) !== (this.headPos.y < 0)) { splash(_v.copy(this.headPos).setY(0), 3.2); AudioSys.sfx('splash', { vol: 0.8 }); addShake(0.3); }
    this.headPrevY = this.headPos.y;
    // jaw & core
    this.jawPivot.rotation.x = -this.jawOpen * 0.62;
    this.head.updateMatrixWorld(true);
    this.core.getWorldPosition(this.coreT.pos);
    this.mouthPos.set(0, -1, -13).applyMatrix4(this.head.matrixWorld);
    this.headT.pos.copy(this.headPos);
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 10);
    const open = this.jawOpen;
    this.coreMat.color.setRGB(3 + 5 * open * pulse + this.flash * 6, 0.5 + 1 * open + this.flash * 5, 1.1 + 1.5 * open + this.flash * 5);
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mat.userData.flash.value = this.flash * 0.6;
    // hittability: parts underwater can't be hit
    this.coreT.hittable = this.phase !== 'intro' && this.phase !== 'dying' && this.headPos.y > -2;
    this.coreT.lockable = open > 0.55;
    this.headT.hittable = this.headPos.y > -2 && open < 0.55;
    for (let i = 0; i < N; i++) {
      const s = this.segs[i];
      this.segT[i].hittable = !s.dead && s.pos.y > -3;
      if (s.turret) s.turret.target.hittable = s.turret.alive && s.pos.y > -1 && this.phase !== 'intro';
    }
    if (open > 0.3) glow(this.coreT.pos, 7 * open * pulse, 3 * open, 0.4 * open, 0.9 * open, 0.9);
    // eyes glow
    for (const sx of [-1, 1]) { _v.set(sx * 4.2, 2.3, -2.6).applyMatrix4(this.head.matrixWorld); glow(_v, 5, 4, 0.3, 0.5, 0.9); }
  }

  collide(dt) {
    const P = G.player;
    if (!P.alive || this.phase === 'intro' || this.phase === 'dying') return;
    const hitR = (p, r) => p.distanceToSquared(P.pos) < (r + 2.4) * (r + 2.4);
    let hit = hitR(this.headPos, 11);
    for (let i = 0; i < N && !hit; i++) if (!this.segs[i].dead && hitR(this.segs[i].pos, 5 * this.segs[i].scale)) hit = true;
    if (hit && P.damage(16)) { P.vu = (P.u > 0 ? 1 : -1) * 30; P.vv = 20; }
  }

  turretFire(dt) {
    for (const s of this.segs) {
      const tr = s.turret;
      if (!tr || !tr.alive || s.pos.y < 0) continue;
      tr.fireT -= dt;
      if (tr.fireT <= 0) {
        tr.fireT = rand(1.7, 2.9) / diff().fire;
        const dist = tr.pos.distanceTo(G.player.pos);
        if (dist > 40 && dist < 600) {
          enemyShot(tr.pos, aimAtPlayer(tr.pos, 150, 0.03), 'orb');
          AudioSys.sfx('enemyShot', { vol: 0.5, pitch: 0.8 });
        }
      }
    }
  }

  tailMissiles(dt, every) {
    this.missileT -= dt;
    if (this.missileT > 0) return;
    this.missileT = every / diff().fire;
    const tail = this.segs[N - 1];
    if (tail.pos.y < 2) return;
    for (let i = 0; i < 2; i++) {
      const v = aimAtPlayer(tail.pos, 70, 0).add(_v.set(rand(-30, 30), 55, rand(-10, 10)));
      enemyShot(tail.pos, v, 'missile', { turn: 1.5, life: 6 });
    }
    AudioSys.sfx('missile');
  }

  ringBursts(dt) {
    this.burstT -= dt;
    if (this.burstT > 0) return;
    this.burstT = rand(2.2, 3.2) / diff().fire;
    const s = this.segs[(Math.random() * 10 + 1) | 0];
    if (s.pos.y < 2 || s.dead) return;
    const P = G.player;
    const base = aimAtPlayer(s.pos, 120, 0);
    const axis = base.clone().normalize();
    const perp = new THREE.Vector3().crossVectors(axis, _up).normalize();
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU;
      const off = perp.clone().applyAxisAngle(axis, a).multiplyScalar(26);
      enemyShot(s.pos, base.clone().add(off), 'orb');
    }
    AudioSys.sfx('enemyShot', { pitch: 0.7 });
  }

  mouthSpread() {
    const base = aimAtPlayer(this.mouthPos, 150, 0);
    for (const a of [-0.2, -0.1, 0, 0.1, 0.2]) enemyShot(this.mouthPos, base.clone().applyAxisAngle(_up, a), 'big');
    AudioSys.sfx('enemyShot', { pitch: 0.6 });
  }

  chargeFx(dt) {
    const k = 1 - Math.max(0, this.subT) / 1.8;
    glow(this.mouthPos, 6 + k * 16, 5, 0.6, 1.2, 1);
    glow(this.mouthPos, 3 + k * 6, 6, 5, 5, 1, 2, this.t * 3);
    if (Math.random() < 0.8) {
      const a = Math.random() * TAU, b = Math.random() * TAU, r = 18;
      _v.set(Math.cos(a) * Math.cos(b) * r, Math.sin(b) * r, Math.sin(a) * Math.cos(b) * r).add(this.mouthPos);
      FX.add.spawn(_v.x, _v.y, _v.z, (this.mouthPos.x - _v.x) * 3, (this.mouthPos.y - _v.y) * 3, (this.mouthPos.z - _v.z) * 3, 0.33, 0.6, 0.2, [5, 1, 2, 1], [5, 3, 3, 0], 0, { stretch: 0.04 });
    }
    POST.ca = Math.max(POST.ca, 0.004 * k);
  }

  beamFx(dt) {
    const P = G.player;
    this.beamT += dt;
    const dur = this.enraged ? 2.0 : 2.5;
    const k = clamp(this.beamT / dur, 0, 1);
    // sweep across the player's plane
    const u = P.u * 0.3 + lerp(-58, 58, this.beamDir > 0 ? k : 1 - k);
    const v = clamp(P.v * 0.8 + 6, 6, 50);
    railToWorld(G.rail.d - 10, u, v, _v);
    const dir = _v2.subVectors(_v, this.mouthPos).normalize();
    const end = this.mouthPos.clone().addScaledVector(dir, 700);
    const w = 1 + Math.sin(this.t * 60) * 0.08;
    FX.beams.add(this.mouthPos, end, 5.5 * w, 3.5, 0.35, 0.8);
    FX.beams.add(this.mouthPos, end, 1.6 * w, 4, 3, 3.5);
    glow(this.mouthPos, 16, 5, 1, 1.6, 1);
    // water impact
    if (dir.y < -0.02) {
      const tHit = -this.mouthPos.y / dir.y;
      if (tHit > 0 && tHit < 700) {
        _v.copy(this.mouthPos).addScaledVector(dir, tHit);
        if (Math.random() < 0.7) splash(_v, 0.9);
        glow(_v.setY(1), 14, 3, 0.6, 1, 0.8);
      }
    }
    // damage
    this.beamTick -= dt;
    const seg = _v.copy(P.pos).sub(this.mouthPos);
    const along = seg.dot(dir);
    const perpD = Math.sqrt(Math.max(0, seg.lengthSq() - along * along));
    if (along > 0 && perpD < 5.2 && P.alive && this.beamTick <= 0) {
      this.beamTick = 0.2;
      P.damage(11);
    }
    addShake(0.02);
  }
}

export const BOSS = { inst: null };
export function initBoss() { BOSS.inst = new Boss(); }
