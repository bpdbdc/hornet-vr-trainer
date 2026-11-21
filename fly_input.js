// Controls: right controller = stick (tilt it like a joystick), left controller = throttle (push / pull).
// Everything else is optional: A / B / X pick the start, Y re-centres the seat. Keyboard / mouse fallback on desktop.
import * as THREE from 'three';
import { XRControllerModelFactory } from './XRControllerModelFactory.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const MAXA = 0.40;            // stick deflection for full authority (rad, ~23 deg)
const TRAVEL = 0.20;          // throttle travel for the full range (m)
const dead = (v, d) => Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d);

export function leverFromRaw(r) { return r < 0.75 ? r : r < 0.83 ? 0.75 : 0.75 + (r - 0.83) / 0.17 * 0.25; }   // detent at MIL
export function rawFromLever(l) { return l <= 0.75 ? l : 0.83 + (l - 0.75) / 0.25 * 0.17; }

export class Controls {
  constructor(renderer, rig, holder, sim, hooks) {
    this.renderer = renderer; this.holder = holder; this.sim = sim; this.hooks = hooks;
    this.src = { left: null, right: null }; this.grabR = null; this.grabL = null; this.raw = rawFromLever(sim.input.lever);
    this.btn = {}; this.keys = {}; this.sp = 0; this.sr = 0; this.kp = 0; this.kr = 0;
    const factory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i); rig.add(grip);
      grip.add(factory.createControllerModel(grip));
      grip.addEventListener('connected', (e) => { const h = e.data && e.data.handedness; if (h === 'left' || h === 'right') this.src[h] = { src: e.data, grip }; });
      grip.addEventListener('disconnected', () => { for (const h of ['left', 'right']) if (this.src[h] && this.src[h].grip === grip) this.src[h] = null; });
    }
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; if (e.code === 'Digit1') hooks.spawn('air'); if (e.code === 'Digit2') hooks.spawn('tanker'); if (e.code === 'Digit3') hooks.spawn('runway'); if (e.code === 'KeyC') hooks.recenter(); });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    this.qH = new THREE.Quaternion(); this.tmp = new THREE.Vector3(); this.q2 = new THREE.Quaternion();
  }

  pulse(hand, v = 0.5, ms = 80) { try { const a = this.src[hand]?.src.gamepad?.hapticActuators?.[0]; if (a && a.pulse) a.pulse(v, ms); } catch (e) { /* no haptics */ } }

  setLever(l) { this.raw = rawFromLever(l); }

  pose(h) {                                  // controller pose in cockpit (holder) coordinates
    const g = this.src[h].grip; this.qH.copy(this.holder.quaternion).invert();
    const p = this.tmp.copy(g.position).sub(this.holder.position).applyQuaternion(this.qH).clone();
    const q = this.q2.copy(this.qH).multiply(g.quaternion).clone();
    return { p, q };
  }

  edge(name, down) { const was = this.btn[name]; this.btn[name] = down; return down && !was; }

  update(dt) {
    const inp = this.sim.input; let pitch = 0, roll = 0, vr = false;
    const R = this.src.right, L = this.src.left;
    if (R && R.src.gamepad) {
      vr = true; const gp = R.src.gamepad, bt = gp.buttons, ax = gp.axes;
      const grab = (bt[0] && bt[0].pressed) || (bt[1] && bt[1].pressed);
      if (this.edge('Rg', grab)) { const { q } = this.pose('right'); this.grabR = { aL: new THREE.Vector3(0, 1, 0).applyQuaternion(q.clone().invert()) }; this.pulse('right', 0.3, 40); }
      if (!grab) this.grabR = null;
      if (this.grabR) {
        const { q } = this.pose('right'); const a = this.grabR.aL.clone().applyQuaternion(q);
        const leanX = Math.atan2(a.x, a.y), leanZ = Math.atan2(a.z, a.y);
        roll = dead(clamp(leanX / MAXA, -1, 1), 0.05); pitch = dead(clamp(leanZ / MAXA, -1, 1), 0.05);
      } else {
        const sx = ax[2] ?? 0, sy = ax[3] ?? 0; roll = dead(sx, 0.2); pitch = dead(sy, 0.2);
      }
      if (this.edge('A', bt[4] && bt[4].pressed)) this.hooks.spawn('air');
      if (this.edge('B', bt[5] && bt[5].pressed)) this.hooks.spawn('tanker');
    }
    if (L && L.src.gamepad) {
      vr = true; const gp = L.src.gamepad, bt = gp.buttons, ax = gp.axes;
      const grab = (bt[0] && bt[0].pressed) || (bt[1] && bt[1].pressed);
      if (this.edge('Lg', grab)) { const { p } = this.pose('left'); this.grabL = { z0: p.z, raw0: this.raw }; this.pulse('left', 0.3, 40); }
      if (!grab) this.grabL = null;
      if (this.grabL) { const { p } = this.pose('left'); this.raw = clamp(this.grabL.raw0 + (this.grabL.z0 - p.z) / TRAVEL, 0, 1); }
      const ty = dead(ax[3] ?? 0, 0.15); if (ty) this.raw = clamp(this.raw - ty * 0.45 * dt, 0, 1);
      if (this.edge('X', bt[4] && bt[4].pressed)) this.hooks.spawn('runway');
      if (this.edge('Y', bt[5] && bt[5].pressed)) this.hooks.recenter();
    }
    // keyboard fallback
    const k = this.keys;
    const kp = (k.ArrowDown ? 1 : 0) - (k.ArrowUp ? 1 : 0), kr = (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0);
    this.kp += clamp(kp - this.kp, -dt * 3, dt * 3); this.kr += clamp(kr - this.kr, -dt * 3, dt * 3);
    if (k.ShiftLeft || k.KeyW || k.PageUp) this.raw = clamp(this.raw + dt * 0.45, 0, 1);
    if (k.ControlLeft || k.KeyS || k.PageDown) this.raw = clamp(this.raw - dt * 0.45, 0, 1);
    if (!vr) { pitch = this.kp; roll = this.kr; }
    // smoothing (removes hand tremor without adding noticeable lag)
    const a = 1 - Math.exp(-dt / 0.045);
    this.sp += (pitch - this.sp) * a; this.sr += (roll - this.sr) * a;
    inp.pitch = this.sp; inp.roll = this.sr; inp.lever = leverFromRaw(this.raw);
    this.gripping = { stick: !!this.grabR, throttle: !!this.grabL };
  }
}
