// Scripted fly-bys: a ship model that streaks across a moment of a cut-scene
// (the black machine crossing the sky after mission 01).
import * as THREE from 'three';
import { G, clamp } from './core.js';
import { railFrame } from './world.js';
import { buildShipModel } from './ship.js';
import { glow } from './fx.js';

const models = {};
const active = [];
const UP = new THREE.Vector3(0, 1, 0), ZAXIS = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _fwd = new THREE.Vector3();
const _m = new THREE.Matrix4(), _qr = new THREE.Quaternion();

function model(scheme) {
  let m = models[scheme];
  if (!m) { m = models[scheme] = buildShipModel(scheme); G.scene.add(m.group); }
  m.group.visible = true;
  return m;
}

// A straight line in the world, carried along with the rail so the camera rig doesn't outrun it.
export function flyby(scheme, from, to, dur) {
  active.push({ m: model(scheme), from: from.clone(), to: to.clone(), dur, t: 0, d0: G.rail.d });
}

// Cross the view from just outside its left edge to just outside its right edge, `dist` metres away and high in
// the sky (between the horizon and the top of the letterboxed frame). The path is laid out from the camera every
// frame, so an orbiting cut-scene camera can't make the ship stall or turn back on screen.
export function crossView(scheme, { dist = 280, dur = 2.1 } = {}) {
  G.camera.getWorldDirection(_dir);
  const half = G.camera.fov * Math.PI / 360;
  const top = Math.asin(clamp(_dir.y, -1, 1)) + half * 0.72;            // top edge of the frame, as an angle above the horizon
  const elev = clamp(top * 0.8, 0.05, Math.max(0.05, top - 0.03));
  active.push({ m: model(scheme), view: true, dist, elev, dur, t: 0 });
}

export function updateFlybys(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const f = active[i];
    f.t += dt;
    const k = clamp(f.t / f.dur, 0, 1);
    const g = f.m.group;
    if (f.view) {
      const cam = G.camera;
      cam.getWorldDirection(_dir);
      _dir.y = 0;
      _dir.normalize();
      _right.crossVectors(_dir, UP).normalize();
      const w = f.dist * Math.tan(cam.fov * Math.PI / 360) * cam.aspect * 1.3;
      g.position.copy(cam.position).addScaledVector(_dir, f.dist * Math.cos(f.elev)).addScaledVector(_right, (k * 2 - 1) * w);
      g.position.y += f.dist * Math.sin(f.elev);
      _fwd.copy(_right);
    } else {
      railFrame(f.d0, _p0); railFrame(G.rail.d, _p1);
      g.position.lerpVectors(f.from, f.to, k).add(_p1).sub(_p0);
      _fwd.subVectors(f.to, f.from).divideScalar(f.dur);
      _fwd.z -= G.rail.speed;   // its own line plus the rail's travel
      _fwd.normalize();
    }
    // nose along the direction of travel (the model points along local -Z), banked a little
    _right.crossVectors(_fwd, UP).normalize();
    _m.makeBasis(_right, _v.crossVectors(_right, _fwd), _fwd.negate());
    g.quaternion.setFromRotationMatrix(_m).multiply(_qr.setFromAxisAngle(ZAXIS, -0.35));
    for (const fl of f.m.flames) { fl.material.uniforms.uTime.value = G.time; fl.material.uniforms.uPower.value = 1; fl.scale.z = 2.2; }
    for (const n of f.m.nozzles) { _v.copy(n).applyQuaternion(g.quaternion).add(g.position); glow(_v, 2.2, 3, 0.5, 0.4, 0.9); }
    if (k >= 1) { g.visible = false; active.splice(i, 1); }
  }
}

export function clearFlybys() {
  for (const f of active) f.m.group.visible = false;
  active.length = 0;
}
