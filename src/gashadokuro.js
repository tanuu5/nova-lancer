// Boss: GASHADOKURO — a giant skeleton the drones welded together out of wrecks. It hangs ahead of the squadron,
// swipes and grabs with its long arms and spits debris from its jaw. Breaking an arm's glowing elbow joint scatters
// the arm; with both arms down the skull splits open over its core. Left alone, the bones fly back together.
// Same interface as the other bosses (boss.js): start / stop / update, hp / maxHp, headPos, botAim, blocksFlare.
import * as THREE from 'three';
import { G, rand, clamp, lerp, damp, TAU, emit, diff, easeOutCubic, easeInOutCubic } from './core.js';
import { railFrame, railToWorld, emissiveVertexMaterial, mergeGeometries } from './world.js';
import { explode, glow, sparks, addShake, bigFlash } from './fx.js';
import { TARGETS, enemyShot, aimAtPlayer } from './weapons.js';
import { AudioSys } from './audio.js';
import { loft, mirrorX } from './ship.js';
import { paint } from './enemies.js';

const COL = { bone: '#aaa28e', bone2: '#8a8373', dark: '#4d4842', rust: '#7f573e', seam: '#b45cff', eye: '#ff3df0', joint: '#c46cff', teeth: '#d9d3c1' };
const oct = (r) => { const a = []; for (let i = 0; i < 8; i++) { const t = i / 8 * TAU; a.push([Math.cos(t) * r, Math.sin(t) * r]); } return a; };

// ============================================================ Geometry (boss frame: +X right, +Y up, +Z toward the player)
// A bone along +Y (0 → len): octagonal shaft with knobbed ends, a rusty plate and a glowing seam — it is scrap metal.
function boneGeo(len, r0, r1 = r0 * 0.8) {
  const shaft = loft([{ z: 0, pts: oct(r0 * 1.2) }, { z: len * 0.14, pts: oct(r0) }, { z: len * 0.5, pts: oct((r0 + r1) * 0.42) }, { z: len * 0.86, pts: oct(r1) }, { z: len, pts: oct(r1 * 1.2) }]).rotateX(-Math.PI / 2);
  return [paint(shaft, COL.bone), paint(new THREE.IcosahedronGeometry(r0 * 1.45, 0), COL.bone2), paint(new THREE.IcosahedronGeometry(r1 * 1.45, 0).translate(0, len, 0), COL.bone2),
    paint(new THREE.BoxGeometry(r0 * 0.9, len * 0.46, r0 * 0.5).translate(r0 * 0.62, len * 0.46, 0), COL.rust),
    paint(new THREE.BoxGeometry(0.4, len * 0.6, 0.4).translate(0, len * 0.5, (r0 + r1) * 0.46), COL.seam, 1)];
}
const tube = (pts, r, hex, em = 0) => paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 10, r, 5, false), hex, em);

function spineGeo() {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const y = -26 + i * 6.2, z = -5 + Math.sin(i * 0.6) * 1.6;
    parts.push(paint(new THREE.CylinderGeometry(3.1, 3.3, 3.6, 8).translate(0, y, z), i % 2 ? COL.bone : COL.bone2));
    parts.push(paint(new THREE.BoxGeometry(1.4, 2.4, 6).translate(0, y + 0.4, z - 4), COL.dark));
    parts.push(paint(new THREE.BoxGeometry(11, 1.2, 1.6).translate(0, y, z - 1), COL.bone2));
  }
  parts.push(paint(new THREE.CylinderGeometry(0.7, 0.7, 52, 6).translate(0, -1, -2.4), COL.seam, 1));
  // tail of loose vertebrae trailing into the debris below
  for (let i = 0; i < 6; i++) { const k = i / 5; parts.push(paint(new THREE.IcosahedronGeometry(2.6 - k * 1.4, 0).translate(Math.sin(i) * 2, -31 - i * 4.2 - k * k * 6, -6 - i * 4.5), COL.bone2)); }
  // pelvis: two iliac wings and a ring
  for (const sx of [-1, 1]) parts.push(paint(new THREE.SphereGeometry(7, 7, 4, 0, Math.PI, 0, Math.PI).scale(1, 0.75, 0.35).rotateY(sx * 0.9).translate(sx * 8, -25, -2), COL.bone));
  parts.push(paint(new THREE.TorusGeometry(6.5, 1.6, 4, 10).rotateX(1.2).translate(0, -29, 1), COL.bone2));
  return mergeGeometries(parts);
}

function ribsGeo() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const y = 15 - i * 6.6, w = 17 - i * 1.3, r = 1.45 - i * 0.1;
    const side = [[2.5, y, -5], [w - 4, y - 1, -2.5], [w, y - 3, 4.5], [w * 0.55, y - 5, 11.5 - i * 0.6], [2, y - 6, 13 - i * 0.7]];
    const g = tube(side, r, i % 2 ? COL.bone2 : COL.bone);
    parts.push(g, paint(mirrorX(g), i % 2 ? COL.bone2 : COL.bone));
    if (i % 2 === 0) { const s2 = side.map(([x, yy, z]) => [x * 0.98, yy + 0.9, z + 0.4]); const gl = tube(s2, 0.3, COL.seam, 1); parts.push(gl, paint(mirrorX(gl), COL.seam, 1)); }
  }
  parts.push(paint(new THREE.BoxGeometry(3.4, 30, 2.2).rotateX(0.12).translate(0, 1, 13), COL.bone2));
  // shoulders: collarbones, shoulder blades and the shoulder balls
  for (const sx of [-1, 1]) {
    parts.push(tube([[sx * 2, 23, 7], [sx * 10, 23, 5], [sx * 17, 19.5, 1]], 1.5, COL.bone));
    parts.push(paint(new THREE.BoxGeometry(10, 13, 1.8).rotateY(sx * 0.5).translate(sx * 13, 14, -6), COL.dark));
    parts.push(paint(new THREE.IcosahedronGeometry(4.6, 0).translate(sx * 18, 18, 0), COL.bone2));
  }
  return mergeGeometries(parts);
}

// Skull pieces, built about the skull centre. The face plates and jaw are built about their hinges.
const SK = { y: 31, z: 3 };   // skull centre in the boss frame
function skullGeos() {
  const cap = mergeGeometries([
    paint(new THREE.SphereGeometry(12.5, 10, 6, 0, TAU, 0, Math.PI / 2).scale(1, 0.86, 1.08), COL.bone),
    paint(new THREE.BoxGeometry(0.5, 0.5, 22).translate(0, 10.6, 0), COL.seam, 1),
    paint(new THREE.BoxGeometry(6, 2, 9).rotateZ(0.3).translate(-5, 8.6, -2), COL.rust),
    paint(new THREE.BoxGeometry(5, 1.6, 7).rotateZ(-0.4).translate(6, 8, 3), COL.dark),
  ]);
  const back = mergeGeometries([
    paint(new THREE.BoxGeometry(20, 11, 13).translate(0, -4, -3.5), COL.bone2),
    paint(new THREE.SphereGeometry(2.3, 8, 6).translate(-5.2, 0.6, 7.2), COL.eye, 1),
    paint(new THREE.SphereGeometry(2.3, 8, 6).translate(5.2, 0.6, 7.2), COL.eye, 1),
    paint(new THREE.BoxGeometry(16, 1.4, 1).translate(0, -8.5, 8.6), COL.dark),
  ]);
  // left face plate: outline with an eye socket and half the nose hole, hinged at its outer edge (x = -11)
  const s = new THREE.Shape([[0, 9.5], [-6, 9], [-10.6, 5], [-11, -1], [-8.4, -7.5], [0, -8.6]].map(([x, y]) => new THREE.Vector2(x + 11, y)));
  const eye = new THREE.Path(); eye.absarc(-5.2 + 11, 0.6, 3.3, 0, TAU, true); s.holes.push(eye);
  const nose = new THREE.Path([[0, -2.2], [-1.9, -5.6], [0, -5.9]].map(([x, y]) => new THREE.Vector2(x + 11, y))); s.holes.push(nose);
  const plate = new THREE.ExtrudeGeometry(s, { depth: 2, bevelEnabled: false, curveSegments: 10 });
  const teeth = [];
  for (let i = 0; i < 4; i++) teeth.push(paint(new THREE.BoxGeometry(1.5, 2.6, 1.4).translate(11 - 1.2 - i * 2.1, -9.5, 1.2), COL.teeth));
  const faceL = mergeGeometries([paint(plate, COL.bone), paint(new THREE.TorusGeometry(3.6, 0.45, 4, 12).translate(-5.2 + 11, 0.6, 2.1), COL.dark), ...teeth]);
  const faceR = mirrorX(faceL);
  // jaw, hinged at the back of the skull
  const jparts = [paint(new THREE.BoxGeometry(17, 2.8, 3.4).translate(0, -1, 15), COL.bone)];
  for (const sx of [-1, 1]) jparts.push(paint(new THREE.BoxGeometry(2.6, 3, 16).rotateX(-0.12).translate(sx * 7.6, 0, 7.5), COL.bone2));
  for (let i = 0; i < 7; i++) jparts.push(paint(new THREE.ConeGeometry(0.75, 2.4, 4).translate(-6 + i * 2, 1.4, 14.6), COL.teeth));
  jparts.push(paint(new THREE.BoxGeometry(12, 0.5, 0.5).translate(0, 0.4, 16.8), COL.seam, 1));
  return { cap, back, faceL, faceR, jaw: mergeGeometries(jparts) };
}

// Arm pieces (each along +Y from its own origin): upper arm, elbow joint, forearm (two bones), clawed hand.
const ARM = { a: 46, b: 44 };
function armGeos() {
  const upper = mergeGeometries(boneGeo(ARM.a, 2.8, 2.3));
  const fore = mergeGeometries([...boneGeo(ARM.b, 2.0, 1.6).map(g => g.translate(-1.4, 0, 0)), ...boneGeo(ARM.b, 1.6, 1.3).map(g => g.translate(1.6, 0, 0))]);
  const joint = mergeGeometries([paint(new THREE.IcosahedronGeometry(4.6, 1), COL.joint, 1), paint(new THREE.TorusGeometry(5.2, 0.9, 4, 10), COL.dark),
    paint(new THREE.TorusGeometry(5.2, 0.9, 4, 10).rotateY(Math.PI / 2), COL.dark)]);
  const hp = [paint(new THREE.BoxGeometry(9, 9, 2.2).translate(0, 4, 0), COL.bone2), paint(new THREE.BoxGeometry(6, 0.5, 0.5).translate(0, 5, 1.3), COL.seam, 1)];
  for (let f = 0; f < 4; f++) {
    const x = -3.6 + f * 2.4;
    let y = 8.5, z = 0;
    for (let k = 0; k < 3; k++) {
      const L = 4.2 - k * 0.6, a = 0.25 + k * 0.35;
      hp.push(paint(new THREE.BoxGeometry(1.4, L, 1.4).translate(0, L / 2, 0).rotateX(a).translate(x, y, z), k === 2 ? COL.dark : COL.bone));
      y += Math.cos(a) * L; z += Math.sin(a) * L;
    }
    hp.push(paint(new THREE.ConeGeometry(0.7, 3, 4).rotateX(1.6).translate(x, y, z + 1.4), COL.teeth));
  }
  hp.push(paint(new THREE.BoxGeometry(1.6, 6, 1.6).translate(0, 3, 0).rotateZ(-1.0).rotateX(0.5).translate(-4.6, 2, 0.6), COL.bone));
  return { upper, fore, joint, hand: mergeGeometries(hp) };
}

// ============================================================ Boss
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, 1);
const SHOULDER = [new THREE.Vector3(-18, 18, 0), new THREE.Vector3(18, 18, 0)];
const REST = [new THREE.Vector3(-30, -4, 36), new THREE.Vector3(30, -4, 36)];

// A loose piece: follows its assembled ("home") pose, drifts free when scattered, and flies back on cue.
class Piece {
  constructor(mesh) { this.mesh = mesh; this.mode = 'home'; this.hp = new THREE.Vector3(); this.hq = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.w = new THREE.Vector3(); this.p0 = new THREE.Vector3(); this.q0 = new THREE.Quaternion(); this.t = 0; this.dur = 1; this.delay = 0; }
  scatter(push, spin = 1.6) {
    this.p.copy(this.mesh.position); this.q.copy(this.mesh.quaternion);
    this.v.copy(push); this.w.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spin);
    this.mode = 'free';
  }
  gather(dur, delay = 0) { this.p0.copy(this.mode === 'home' ? this.mesh.position : this.p); this.q0.copy(this.mode === 'home' ? this.mesh.quaternion : this.q); this.mode = 'back'; this.t = 0; this.dur = dur; this.delay = delay; }
  update(dt) {
    const m = this.mesh;
    if (this.mode === 'home') { m.position.copy(this.hp); m.quaternion.copy(this.hq); return; }
    if (this.mode === 'free') {
      this.v.multiplyScalar(Math.exp(-0.7 * dt));
      this.p.addScaledVector(this.v, dt);
      _q.setFromAxisAngle(_v.copy(this.w).normalize(), this.w.length() * dt);
      this.q.premultiply(_q);
      m.position.copy(this.p); m.quaternion.copy(this.q);
      return;
    }
    this.t += dt;
    const k = easeInOutCubic(clamp((this.t - this.delay) / this.dur, 0, 1));
    m.position.lerpVectors(this.p0, this.hp, k);
    m.quaternion.slerpQuaternions(this.q0, this.hq, k);
    if (this.t >= this.delay + this.dur) { this.mode = 'home'; this.snapped = true; }
  }
}

export class Gashadokuro {
  constructor() {
    // a faint glow of its own keeps the bones readable when the light is behind it
    this.mat = emissiveVertexMaterial({ roughness: 0.6, metalness: 0.35, emissive: new THREE.Color('#221d18') }, 3.2);
    this.root = new THREE.Group();
    const mk = (g) => { const m = new THREE.Mesh(g, this.mat); m.castShadow = true; this.root.add(m); return m; };
    this.spine = new Piece(mk(spineGeo()));
    this.ribs = new Piece(mk(ribsGeo()));
    const S = skullGeos();
    this.cap = new Piece(mk(S.cap)); this.back = new Piece(mk(S.back));
    this.faceL = new Piece(mk(S.faceL)); this.faceR = new Piece(mk(S.faceR)); this.jaw = new Piece(mk(S.jaw));
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.8, 3.5) });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(3.8, 2), this.coreMat);
    this.root.add(this.core);
    const A = armGeos();
    this.arms = [0, 1].map(i => {
      const side = i ? 1 : -1;
      const geo = (g) => (side > 0 ? mirrorX(g) : g);
      return {
        i, side, state: 'on', offT: 0, act: 'idle', actT: 0, hp: 18,
        upper: new Piece(mk(geo(A.upper))), joint: new Piece(mk(A.joint)), fore: new Piece(mk(geo(A.fore))), hand: new Piece(mk(geo(A.hand))),
        tgt: REST[i].clone(), cur: REST[i].clone(), elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), handW: new THREE.Vector3(), elbowW: new THREE.Vector3(), foreW: new THREE.Vector3(),
        sweep: null, hitDone: false,
      };
    });
    this.pieces = [this.spine, this.ribs, this.cap, this.back, this.faceL, this.faceR, this.jaw, ...this.arms.flatMap(a => [a.upper, a.joint, a.fore, a.hand])];
    this.headPos = new THREE.Vector3(); this.mouthPos = new THREE.Vector3();
    this.buildTargets();
    this.active = false;
  }

  buildTargets() {
    const self = this;
    this.coreT = {
      pos: new THREE.Vector3(), radius: 5.5, alive: true, lockable: false, hittable: false, hp: 150,
      hit(dmg, p, src) {
        if (!self.active || self.phase === 'dying') return 'none';
        if (self.openK < 0.6) { sparks(p || this.pos, null, 6, [3, 3.5, 4], 25, 1); return 'armor'; }
        this.hp -= dmg * (src === 'bomb' ? 0.6 : 1);
        self.flash = 1;
        emit('bossHit');
        if (this.hp <= 0) { this.hp = 0; self.die(); return 'kill'; }
        return 'hit';
      },
    };
    this.skullT = { pos: new THREE.Vector3(), radius: 14, alive: true, lockable: false, hittable: true, hit: () => 'armor' };
    this.chestT = { pos: new THREE.Vector3(), radius: 17, alive: true, lockable: false, hittable: true, hit: () => 'armor' };
    for (const a of this.arms) {
      a.jointT = {
        pos: a.elbowW, radius: 5.4, alive: true, lockable: true, hittable: true,
        hit(dmg, p, src) {
          if (a.state !== 'on' || self.phase !== 'fight') return 'none';
          a.hp -= dmg; a.flash = 1; self.flash = Math.max(self.flash, 0.4);
          emit('bossHit');
          if (a.hp <= 0) { self.breakArm(a); return 'kill'; }
          return 'hit';
        },
      };
      a.boneT = [{ pos: a.foreW, radius: 4.6, alive: true, lockable: false, hittable: true, hit: () => 'armor' }, { pos: a.handW, radius: 6, alive: true, lockable: false, hittable: true, hit: () => 'armor' }];
    }
    this.targets = [this.coreT, this.skullT, this.chestT, ...this.arms.flatMap(a => [a.jointT, ...a.boneT])];
  }

  get maxHp() { return 150; }
  get hp() { return this.coreT.hp; }

  start() {
    this.active = true;
    this.phase = 'intro'; this.pt = 0; this.t = 0;
    this.flash = 0; this.openK = 0; this.openT = 0; this.jawK = 0; this.jawT = 0;
    this.enraged = false; this.roared = false; this.nextAct = 2.2; this.turn = 0; this.volleyT = 4; this.burstT = 3; this.reported = false; this.deathIdx = 0; this.deadT = 0;
    this.coreT.hp = 150; this.coreT.alive = true;
    this.hs = 330; this.hu = 0; this.hv = 24; this.sway = 0;
    this.mat.userData.tint.value.setRGB(1, 1, 1);
    this.mat.userData.emit.value = 3.2;
    for (const p of this.pieces) { p.mesh.visible = true; p.snapped = false; }
    this.core.visible = true;
    for (const a of this.arms) { a.state = 'on'; a.hp = 18; a.act = 'idle'; a.actT = 0; a.flash = 0; a.cur.copy(REST[a.i]); a.tgt.copy(REST[a.i]); }
    G.scene.add(this.root);
    this.place(0);
    this.pose(0);
    // everything starts as wreckage scattered around, and flies in to assemble itself
    for (const p of this.pieces) {
      p.p.set(rand(-140, 140), rand(-90, 70), rand(-160, 60)); p.q.setFromEuler(new THREE.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU)));
      p.mode = 'free'; p.v.set(0, 0, 0); p.w.set(0, 0, 0);
      p.gather(rand(1.5, 2.4), rand(0.4, 2.6));
    }
    this.spine.gather(1.8, 0.2); this.ribs.gather(1.8, 0.9);
    for (const t of this.targets) { t.alive = true; TARGETS.add(t); }
  }

  stop() {
    this.active = false;
    G.scene.remove(this.root);
    for (const t of this.targets) TARGETS.delete(t);
  }

  // ---------------------------------------------------------------- arms
  breakArm(a) {
    a.state = 'off'; a.offT = 0; a.act = 'idle';
    explode(a.elbowW, 2.6, { debris: 8 });
    AudioSys.sfx('explodeL'); addShake(0.5);
    const k = a.side;
    a.upper.scatter(_v.set(k * rand(10, 20), rand(-4, 8), rand(-8, 4)));
    a.joint.scatter(_v.set(k * rand(4, 10), rand(-12, -4), rand(0, 8)), 3);
    a.fore.scatter(_v.set(k * rand(14, 26), rand(-10, 4), rand(4, 14)));
    a.hand.scatter(_v.set(k * rand(10, 22), rand(-16, -4), rand(6, 16)), 2.4);
    this.coreT.hp = Math.max(1, this.coreT.hp - 14);
    const left = this.arms.filter(o => o.state === 'on').length;
    emit('bossPartDown', left);
    if (left === 0) this.openSkull();
  }
  rebuildArm(a, delay = 0) {
    a.state = 'back'; a.hp = this.enraged ? 15 : 18; a.act = 'idle'; a.cur.copy(REST[a.i]); a.tgt.copy(REST[a.i]);
    for (const [p, d] of [[a.upper, 0], [a.joint, 0.15], [a.fore, 0.3], [a.hand, 0.45]]) p.gather(1.3, delay + d);
  }
  openSkull() {
    this.phase = 'open'; this.openT = this.enraged ? 5.2 : 6.5;
    AudioSys.sfx('roar', { pitch: 0.75 });
    addShake(0.6);
    emit('bossPhase', 2);
  }
  closeSkull() {
    this.phase = 'fight'; this.nextAct = 2.4;
    for (const a of this.arms) if (a.state === 'off') this.rebuildArm(a, a.i * 0.25);
    AudioSys.sfx('gateClose', { pitch: 0.6 });
    emit('bossPhase', 4);
  }

  // Two-bone IK: elbow and wrist for a hand target (boss frame), elbows bent down and back — inside the play area,
  // where the player can reach the joints.
  solveArm(a) {
    const S = SHOULDER[a.i], H = a.cur;
    const d = _v.subVectors(H, S);
    let L = d.length();
    const dir = d.multiplyScalar(1 / (L || 1));
    L = clamp(L, Math.abs(ARM.a - ARM.b) + 1, ARM.a + ARM.b - 0.5);
    const x = (ARM.a * ARM.a - ARM.b * ARM.b + L * L) / (2 * L), h = Math.sqrt(Math.max(0, ARM.a * ARM.a - x * x));
    const pole = _v2.set(a.side * 0.35, -0.75, -0.6);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    a.elbow.copy(S).addScaledVector(dir, x).addScaledVector(pole, h);
    a.wrist.copy(S).addScaledVector(dir, L);
  }
  // Point a piece's +Y from `from` toward `to`, its +Z toward the player where possible.
  aim(piece, from, to) {
    _y.subVectors(to, from).normalize();
    _z.copy(FWD).addScaledVector(_y, -FWD.dot(_y));
    if (_z.lengthSq() < 1e-4) _z.set(1, 0, 0);
    _z.normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z);
    piece.hq.setFromRotationMatrix(_m);
    piece.hp.copy(from);
  }

  // Assembled pose of every piece this frame (skull opening, breathing, arms from IK).
  pose(dt) {
    const T = this.t, br = Math.sin(T * 1.3) * 0.6;
    this.spine.hp.set(0, br * 0.3, 0); this.spine.hq.identity();
    this.ribs.hp.set(0, br, 0); this.ribs.hq.setFromAxisAngle(_v.set(1, 0, 0), Math.sin(T * 1.3) * 0.02);
    const o = easeInOutCubic(this.openK), nod = Math.sin(T * 0.9) * 0.06 - this.jawK * 0.05;
    const sk = _v3.set(0, SK.y + br, SK.z);
    _q.setFromAxisAngle(_v.set(1, 0, 0), nod);
    const sub = (piece, x, y, z, rx, ry) => { piece.hp.set(x, y, z).applyQuaternion(_q).add(sk); piece.hq.copy(_q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0))); };
    sub(this.back, 0, 0, 0, 0, 0);
    sub(this.cap, 0, 1 + o * 9, -o * 3, -o * 0.55, 0);
    sub(this.faceL, -11 - o * 3, 0, 7.5 + o * 4, 0, -o * 1.15);
    sub(this.faceR, 11 + o * 3, 0, 7.5 + o * 4, 0, o * 1.15);
    sub(this.jaw, 0, -8 - o * 2, -2, 0.12 + this.jawK * 0.55 + o * 0.35, 0);
    this.core.position.copy(sk).add(_v.set(0, -1, 1.5));
    for (const a of this.arms) {
      this.solveArm(a);
      this.aim(a.upper, SHOULDER[a.i], a.elbow);
      this.aim(a.fore, a.elbow, a.wrist);
      this.aim(a.hand, a.wrist, _v.copy(a.wrist).sub(a.elbow).add(a.wrist));
      a.joint.hp.copy(a.elbow); a.joint.hq.setFromAxisAngle(_v.set(0, 1, 0), T * 1.5 * a.side);
    }
  }

  // Root follows (hs, hu, hv) in rail space, facing the player.
  place(dt) {
    const d = G.rail.d;
    railFrame(d + this.hs, _p, _f, _r);
    railToWorld(d + this.hs, this.hu, this.hv, this.root.position);
    this.root.rotation.set(0, Math.atan2(-_f.x, -_f.z), 0);
    this.root.rotateZ(this.sway);
    this.root.updateMatrixWorld(true);
  }

  // hand target in rail terms (rel ahead of the player, u, v) → boss frame
  toLocal(rel, u, v, out) { return out.set(u - this.hu, v - this.hv, this.hs - rel); }

  // ---------------------------------------------------------------- behaviour
  update(dt) {
    if (!this.active) return;
    this.t += dt; this.pt += dt;
    const P = G.player, T = this.t;
    let ths = 150 + Math.sin(T * 0.4) * 12, thu = Math.sin(T * 0.27) * 22 + P.u * 0.25, thv = 24 + Math.sin(T * 0.5) * 3;
    switch (this.phase) {
      case 'intro':
        ths = this.pt < 1 ? 330 : 165; thv = 24;
        if (this.pt > 2.2 && Math.random() < dt * 12) { const p = this.pieces[(Math.random() * this.pieces.length) | 0]; if (p.mode === 'back') sparks(_v.copy(p.mesh.position).applyMatrix4(this.root.matrixWorld), null, 6, [4, 2.5, 5], 26, 1); }
        if (this.pt > 4.6 && !this.roared) { this.roared = true; AudioSys.sfx('roar', { pitch: 0.8 }); addShake(0.8); }
        if (this.pt > 6) { this.phase = 'fight'; this.pt = 0; emit('bossPhase', 1); }
        break;
      case 'fight': {
        this.nextAct -= dt;
        const busy = this.arms.some(a => a.act !== 'idle');
        if (!busy && this.nextAct <= 0) this.pickAct();
        for (const a of this.arms) if (a.act !== 'idle' && a.lunge) { ths = a.lunge; thu = a.lungeU; }
        this.volleys(dt, busy ? 2 : 1);
        // a lone scattered arm doesn't stay apart for long
        for (const a of this.arms) if (a.state === 'off' && (a.offT += dt) > 16) { this.rebuildArm(a); emit('bossPhase', 5); }
        break;
      }
      case 'open':
        ths = 128 + Math.sin(T * 0.8) * 6; thv = 22;
        this.openT -= dt;
        if (Math.random() < dt * 0.8) this.volley(4);
        if (this.openT <= 0) this.closeSkull();
        break;
      case 'dying':
        this.dying(dt);
        break;
    }
    this.openK = damp(this.openK, this.phase === 'open' ? 1 : 0, this.phase === 'open' ? 5 : 3.5, dt);
    this.jawT -= dt; this.jawK = damp(this.jawK, this.jawT > 0 ? 1 : 0, 8, dt);
    const k = this.phase === 'intro' ? 2 : 1.6;
    this.hs = damp(this.hs, ths, k, dt); this.hu = damp(this.hu, thu, 1.2, dt); this.hv = damp(this.hv, thv, 1.5, dt);
    this.sway = damp(this.sway, -(thu - this.hu) * 0.004 + Math.sin(T * 0.6) * 0.03, 2, dt);
    if (this.phase !== 'dying') for (const a of this.arms) this.armAct(a, dt);
    if (!this.enraged && this.coreT.hp < 75 && this.phase !== 'dying') {
      this.enraged = true;
      this.mat.userData.tint.value.setRGB(1.3, 0.78, 0.82);
      this.mat.userData.emit.value = 5;
      AudioSys.sfx('roar', { pitch: 1.2 });
      emit('bossPhase', 3);
    }
    this.place(dt);
    this.pose(dt);
    for (const p of this.pieces) p.update(dt);
    for (const a of this.arms) if (a.state === 'back' && a.upper.mode === 'home' && a.hand.mode === 'home') { a.state = 'on'; a.hp = this.enraged ? 15 : 18; sparks(_v.copy(a.elbow).applyMatrix4(this.root.matrixWorld), null, 18, [4, 2.5, 6], 30, 1); AudioSys.sfx('gateClose', { pitch: 1.3, vol: 0.7 }); }
    if (this.phase === 'intro') for (const p of this.pieces) if (p.snapped) { p.snapped = false; AudioSys.sfx('gateClose', { pitch: rand(0.8, 1.2), vol: 0.35 }); }
    this.world(dt);
    this.collide();
  }

  pickAct() {
    const on = this.arms.filter(a => a.state === 'on');
    const enr = this.enraged;
    if (!on.length) { this.volley(6); this.nextAct = 1.6; return; }
    const a = on.length === 2 ? this.arms[this.turn++ % 2] : on[0];
    const swipe = Math.random() < 0.55;
    a.act = swipe ? 'raise' : 'reach'; a.actT = 0; a.hitDone = false;
    if (swipe) { a.lunge = 60; a.lungeU = 0; emit('bossCharge'); }
    else { a.lunge = 74; a.lungeU = G.player.u * 0.5; }
    AudioSys.sfx('roar', { pitch: 1.5, vol: 0.5 });
    this.nextAct = (enr ? 1.2 : 2.0) / diff().fire;
  }

  // One arm's current move: idle sway, swipe (raise → sweep across just ahead of the player → recover),
  // or grab (reach to hover over the player → lunge → pull back).
  armAct(a, dt) {
    const P = G.player, T = this.t, enr = this.enraged ? 0.8 : 1;
    a.actT += dt;
    a.flash = Math.max(0, (a.flash || 0) - dt * 6);
    let sp = 3;
    switch (a.act) {
      case 'idle':
        a.tgt.copy(REST[a.i]).add(_v.set(Math.sin(T * 0.8 + a.i * 2) * 5, Math.sin(T * 1.1 + a.i) * 4, Math.sin(T * 0.6 + a.i) * 4));
        a.lunge = 0;
        break;
      case 'raise':
        a.tgt.set(a.side * 62, 24, 42); sp = 2.6;
        if (a.actT > 1.25 * enr) { a.act = 'sweep'; a.actT = 0; a.sv = clamp(P.v, 6, 54); AudioSys.sfx('boost', { pitch: 0.55 }); }
        break;
      case 'sweep': {
        const k = easeInOutCubic(a.actT / (0.9 * enr));
        this.toLocal(2, a.side * lerp(58, -58, k), a.sv, a.tgt); sp = 14;
        glow(a.handW, 16, 1.6, 0.6, 2.4, 0.6);
        if (a.actT > 0.9 * enr) { a.act = 'recover'; a.actT = 0; }
        break;
      }
      case 'reach':
        this.toLocal(55, P.u, P.v, a.tgt); sp = 3.2;
        glow(a.handW, 10 + Math.sin(T * 20) * 3, 2.4, 0.6, 2.6, 0.8);
        if (a.actT > 0.95 * enr) { a.act = 'grab'; a.actT = 0; a.gu = P.u; a.gv = P.v; AudioSys.sfx('boost', { pitch: 0.7 }); }
        break;
      case 'grab':
        this.toLocal(a.actT < 0.4 ? lerp(55, 3, easeOutCubic(a.actT / 0.4)) : 3, a.gu, a.gv, a.tgt); sp = 16;
        if (a.actT > 0.75) { a.act = 'recover'; a.actT = 0; }
        break;
      case 'recover':
        a.tgt.copy(REST[a.i]); sp = 2.2; a.lunge = 0;
        if (a.actT > 1.0) a.act = 'idle';
        break;
    }
    a.cur.x = damp(a.cur.x, a.tgt.x, sp, dt); a.cur.y = damp(a.cur.y, a.tgt.y, sp, dt); a.cur.z = damp(a.cur.z, a.tgt.z, sp, dt);
  }

  volleys(dt, slow) {
    this.volleyT -= dt / slow;
    if (this.volleyT <= 0) { this.volleyT = (this.enraged ? 3.2 : 4.6) / diff().fire; this.volley(5); }
    if (this.enraged) {
      this.burstT -= dt;
      if (this.burstT <= 0) { this.burstT = rand(2.6, 3.6) / diff().fire; this.ribBurst(); }
    }
  }
  volley(n) {
    this.jawT = 0.9;
    const base = aimAtPlayer(this.mouthPos, 140, 0);
    for (let i = 0; i < n; i++) enemyShot(this.mouthPos, base.clone().applyAxisAngle(_v.set(0, 1, 0), (i - (n - 1) / 2) * 0.13), 'big');
    AudioSys.sfx('enemyShot', { pitch: 0.55 });
  }
  ribBurst() {
    _v.set(rand(-14, 14), rand(-6, 14), 12).applyMatrix4(this.root.matrixWorld);
    const base = aimAtPlayer(_v, 120, 0), axis = base.clone().normalize(), perp = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
    for (let i = 0; i < 10; i++) enemyShot(_v, base.clone().add(perp.clone().applyAxisAngle(axis, i / 10 * TAU).multiplyScalar(24)), 'orb');
    AudioSys.sfx('enemyShot', { pitch: 0.7 });
  }

  // World positions of targets and glows, and hit-ability by state.
  world(dt) {
    const M = this.root.matrixWorld;
    this.headPos.set(0, SK.y, SK.z).applyMatrix4(M);
    this.mouthPos.set(0, SK.y - 9, SK.z + 14).applyMatrix4(M);
    this.core.getWorldPosition(this.coreT.pos);
    this.skullT.pos.copy(this.headPos);
    this.chestT.pos.set(0, 4, 4).applyMatrix4(M);
    const open = this.openK > 0.6, fight = this.phase === 'fight' || this.phase === 'open';
    this.coreT.lockable = open && fight;
    this.coreT.hittable = fight && this.openK > 0.25;
    this.skullT.hittable = fight && !open;
    this.chestT.hittable = fight;
    for (const a of this.arms) {
      a.elbowW.copy(a.joint.mesh.position).applyMatrix4(M);
      a.handW.copy(a.hand.mesh.position).add(_v.set(0, 9, 0).applyQuaternion(a.hand.mesh.quaternion)).applyMatrix4(M);
      a.foreW.copy(a.fore.mesh.position).add(_v.set(0, ARM.b * 0.55, 0).applyQuaternion(a.fore.mesh.quaternion)).applyMatrix4(M);
      const on = a.state === 'on' && this.phase === 'fight';
      a.jointT.hittable = on; a.jointT.lockable = on;
      for (const t of a.boneT) t.hittable = a.state === 'on' && fight;
      if (a.state === 'on' && this.phase !== 'intro') glow(a.elbowW, 9 + Math.sin(this.t * 6 + a.i) * 2 + a.flash * 8, 2.2 + a.flash * 3, 0.9, 3 + a.flash * 2, 0.8);
    }
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 9), o = this.openK;
    this.coreMat.color.setRGB(2.4 + 5 * o * pulse + this.flash * 6, 0.5 + 1.2 * o + this.flash * 5, 2 + 3 * o * pulse + this.flash * 5);
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mat.userData.flash.value = this.flash * 0.5;
    if (o > 0.3) glow(this.coreT.pos, 9 * o * pulse, 3 * o, 0.6 * o, 2.6 * o, 0.9);
    if (this.phase !== 'dying') for (const sx of [-1, 1]) { _v.set(sx * 5.2, SK.y + 0.6, SK.z + 8).applyMatrix4(M); glow(_v, 6 + this.jawK * 3, 4, 0.5, 3.5, 0.9); }
    if (this.jawK > 0.2) glow(this.mouthPos, 8 * this.jawK, 3, 0.8, 3, 0.8);
  }

  collide() {
    const P = G.player;
    if (!P.alive || this.phase === 'intro' || this.phase === 'dying') return;
    for (const a of this.arms) {
      if (a.state !== 'on' || (a.act !== 'sweep' && a.act !== 'grab') || a.hitDone) continue;
      if (a.handW.distanceTo(P.pos) < 9 || a.foreW.distanceTo(P.pos) < 6.5) {
        a.hitDone = true;
        if (P.damage(16)) { P.vu = (P.u > a.handW.x ? 1 : -1) * 30; P.vv = (P.v > 30 ? 1 : -1) * 20; addShake(0.6); AudioSys.sfx('crash', { pitch: 0.6 }); }
      }
    }
  }

  // ---------------------------------------------------------------- death
  die() {
    this.phase = 'dying'; this.pt = 0;
    this.coreT.alive = false;
    AudioSys.sfx('roar', { pitch: 0.6 });
    bigFlash(0.8, [1, 0.6, 1]);
    addShake(1);
    G.slowMo = 0.3;
    this.deathT = 0.5; this.deathIdx = 0;
    this.deathList = [...this.arms.flatMap(a => [a.hand, a.fore, a.joint, a.upper]), this.ribs, this.spine, this.jaw, this.faceL, this.faceR, this.cap];
    emit('bossDying');
  }
  dying(dt) {
    this.deathT -= G.rdt;
    if (this.deathT <= 0 && this.deathIdx <= this.deathList.length) {
      this.deathT = 0.14;
      const M = this.root.matrixWorld;
      if (this.deathIdx < this.deathList.length) {
        const p = this.deathList[this.deathIdx];
        _v.copy(p.mesh.position).applyMatrix4(M);
        explode(_v, p === this.ribs || p === this.spine ? 4 : 2.4, { debris: 6 });
        AudioSys.sfx(this.deathIdx % 2 ? 'explodeM' : 'explodeL', { vol: 0.8 });
        p.scatter(_v2.set(rand(-30, 30), rand(-20, 20), rand(-10, 25)), 2.5);
      } else {
        explode(this.headPos, 6, { debris: 14 });
        explode(_v.copy(this.headPos).add(_v2.set(0, 8, 0)), 4);
        AudioSys.sfx('explodeL'); AudioSys.sfx('bombBlast');
        bigFlash(1, [1, 0.85, 1]);
        addShake(1.2);
        this.back.scatter(_v2.set(0, 6, -10), 1.5);
        this.core.visible = false;
        G.slowMo = 1;
        this.deadT = 0;
      }
      this.deathIdx++;
    }
    if (this.deathIdx > this.deathList.length) {
      this.deadT += G.rdt;
      for (const p of this.pieces) if (p.mode === 'free' && this.deadT > 0.6) p.mesh.visible = Math.random() < 1 - this.deadT * 0.3;
      if (this.deadT > 2.2 && !this.reported) { this.reported = true; for (const p of this.pieces) p.mesh.visible = false; emit('bossDefeated'); }
    }
  }

  // ---------------------------------------------------------------- interface for main / the test bot
  botAim() {
    for (const a of this.arms) if (a.state === 'on' && this.phase === 'fight') return a.elbowW;
    if (this.openK > 0.6) return this.coreT.pos;
    return this.headPos;
  }
  blocksFlare(sun) {
    if (this.phase === 'dying' && this.deathIdx > this.deathList.length) return false;
    _v.copy(this.headPos).project(G.camera);
    return Math.hypot(_v.x - sun.x, _v.y - sun.y) < 0.14 && _v.z < 1;
  }
}
