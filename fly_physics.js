// Simplified F/A-18C flight model, VTOL VR style: fly-by-wire (the stick commands load factor / roll rate),
// automatic gear, flaps, probe and wheel brakes. The only things the pilot touches are the stick and the throttle.
import * as THREE from 'three';
import { AIRFIELD } from './fly_terrain.js';

export const G = 9.80665, RHO0 = 1.225, KT = 1.943844, FT = 3.28084;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function atmo(h) {
  const hc = Math.max(0, h);
  let T, rho;
  if (hc < 11000) { T = 288.15 - 0.0065 * hc; rho = RHO0 * Math.pow(T / 288.15, 4.2559); }
  else { T = 216.65; rho = 0.3639 * Math.exp(-(hc - 11000) / 6341.6); }
  return { T, rho, a: Math.sqrt(1.4 * 287.05 * T) };
}

export const AC = {
  S: 37.16, mEmpty: 12200, fuelMax: 6000, nzMax: 7.5, nzMin: -3.0, aMax: 0.52, aMin: -0.30,
  tMil: 94000, tAb: 142000,
  eyeH: 3.05,                       // eye height above the ground on the wheels
  gearMain: { x: 1.55, z: 3.4 }, gearNose: { z: -2.6 },
  probeTip: new THREE.Vector3(0.62, -0.12, -3.7),   // refuelling probe tip relative to the eye
};

// ---- lift / drag -------------------------------------------------------------------------------------------------
const A_L = 0.314, CLA = 3.4, A_PK = 0.63, CL_L = CLA * A_L;
const KQ = CLA / (2 * (A_PK - A_L)), CL_PK = CL_L + CLA * (A_PK - A_L) - KQ * (A_PK - A_L) ** 2;
function clRaw(a) {
  if (a < A_L) return CLA * a;
  if (a < A_PK) { const d = a - A_L; return CL_L + CLA * d - KQ * d * d; }
  const plate = 1.2 * Math.sin(2 * a), plate0 = 1.2 * Math.sin(2 * A_PK);
  return plate + (CL_PK - plate0) * Math.exp(-(a - A_PK) * 6);
}
export function CL(a, flaps = 0) {
  const x = a + 0.03 + 0.07 * flaps, ax = Math.abs(x);
  const c = clRaw(Math.min(ax, Math.PI));
  return x < 0 ? -0.85 * c : c;
}
export function CD(a, cl, mach, gear, flaps) {
  const cd0 = 0.027 + 0.026 * gear + 0.012 * flaps;
  const wave = 0.034 * smooth(0.85, 1.15, mach) * (1 - 0.4 * smooth(1.3, 2.2, mach));
  const ax = Math.abs(a);
  return cd0 + wave + 0.115 * cl * cl + 1.25 * Math.sin(ax) ** 2 * smooth(0.3, 0.7, ax);
}
function invCL(target, flaps) {         // monotonic range [aMin, aMax]
  if (target >= CL(AC.aMax, flaps)) return AC.aMax;
  if (target <= CL(AC.aMin, flaps)) return AC.aMin;
  let lo = AC.aMin, hi = AC.aMax;
  for (let i = 0; i < 22; i++) { const mid = 0.5 * (lo + hi); if (CL(mid, flaps) < target) lo = mid; else hi = mid; }
  return 0.5 * (lo + hi);
}

// ---- scratch ------------------------------------------------------------------------------------------------------
const V3 = THREE.Vector3, Q = THREE.Quaternion;
const _a = new V3(), _b = new V3(), _c = new V3(), _q1 = new Q(), _q2 = new Q();
const AX_X = new V3(1, 0, 0), AX_Y = new V3(0, 1, 0), AX_FWD = new V3(0, 0, -1);

export class Flight {
  constructor(terrain) {
    this.terrain = terrain;
    this.pos = new V3(); this.vel = new V3();
    this.qw = new Q(); this.qb = new Q();
    this.alpha = 0; this.p = 0;
    this.mode = 'air';                      // 'air' | 'ground' | 'crashed'
    this.g = { psi: 0, theta: 0, speed: 0 };
    this.fuel = 3200; this.lever = 0.6;
    this.eng = { mil: 0.6, ab: 0 };
    this.gear = 0; this.flaps = 0; this.probe = 0;
    this.nz = 1; this.agl = 0; this.crashReason = ''; this.events = [];
    this.thrust = 0; this.flameout = false;
  }
  get mass() { return AC.mEmpty + this.fuel; }
  get speed() { return this.mode === 'ground' ? this.g.speed : this.vel.length(); }
  get mach() { return this.speed / atmo(this.pos.y).a; }
  get ias() { const { rho } = atmo(this.pos.y); return this.speed * Math.sqrt(rho / RHO0); }
  get heading() { const f = _a.copy(AX_FWD).applyQuaternion(this.qb); return (Math.atan2(f.x, -f.z) + 2 * Math.PI) % (2 * Math.PI); }
  get pitch() { return Math.asin(clamp(_a.copy(AX_FWD).applyQuaternion(this.qb).y, -1, 1)); }
  get bank() { const r = _a.copy(AX_X).applyQuaternion(this.qb), u = _b.copy(AX_Y).applyQuaternion(this.qb); return Math.atan2(-r.y, u.y); }
  event(t) { this.events.push(t); }

  // modes: air = in flight over the island; runway = ready for take-off; tanker handled by Sim
  place({ x, y, z, heading = 0, speed = 150, bank = 0, fuel, lever, ground = false }) {
    this.pos.set(x, y, z); this.mode = ground ? 'ground' : 'air'; this.crashReason = ''; this.gearWant = ground ? 1 : 0; this.touch = null;
    const f = new V3(Math.sin(heading), 0, -Math.cos(heading));
    if (ground) {
      this.g.psi = heading; this.g.theta = 0; this.g.speed = 0; this.vel.set(0, 0, 0);
      this.gear = 1; this.flaps = 1; this.alpha = 0;
    } else {
      this.vel.copy(f).multiplyScalar(speed);
      this.qw.setFromUnitVectors(AX_FWD, f);
      this.qw.multiply(_q1.setFromAxisAngle(AX_FWD, bank));
      this.alpha = 0.06; this.gear = 0; this.flaps = 0;
    }
    if (fuel !== undefined) this.fuel = fuel;
    if (lever !== undefined) { this.lever = lever; this.eng.mil = lever <= 0.75 ? 0.04 + 0.96 * Math.pow(lever / 0.75, 1.15) : 1; this.eng.ab = lever > 0.75 ? (lever - 0.75) / 0.25 : 0; }
    this.p = 0; this.flameout = false;
    this.updateBody();
  }

  updateBody() {
    if (this.mode === 'ground') {
      this.qb.setFromAxisAngle(AX_Y, -this.g.psi).multiply(_q1.setFromAxisAngle(AX_X, this.g.theta));
    } else {
      this.qb.copy(this.qw).multiply(_q1.setFromAxisAngle(AX_X, this.alpha));
    }
  }

  engine(dt, lever, rho, mach) {
    const e = this.eng, tgtMil = lever <= 0.75 ? 0.04 + 0.96 * Math.pow(lever / 0.75, 1.15) : 1, tgtAb = lever > 0.75 ? (lever - 0.75) / 0.25 : 0;
    const k = (tgt, cur, up, dn) => cur + (tgt - cur) * (1 - Math.exp(-dt / (tgt > cur ? up : dn)));
    e.mil = k(tgtMil, e.mil, 1.3, 0.8); e.ab = k(tgtAb, e.ab, 0.9, 0.35);
    const lapse = Math.pow(rho / RHO0, 0.75) * (1 + 0.15 * Math.min(mach, 1.6));
    let T = lapse * (AC.tMil * e.mil + (AC.tAb - AC.tMil) * e.ab);
    const ff = 0.35 + 1.75 * e.mil + 7.0 * e.ab;
    this.fuel = Math.max(0, this.fuel - ff * dt * (0.6 + 0.4 * Math.sqrt(rho / RHO0)));
    this.flameout = this.fuel <= 0;
    if (this.flameout) T = 0;
    this.thrust = T; this.fuelFlow = ff;
    return T;
  }

  autoConfig(dt, agl, V, refuelNear) {
    let want = this.gearWant ?? 0;
    if (this.mode === 'ground') want = 1;
    else if (want === 0 && agl < 420 && V < 125) want = 1;
    else if (want === 1 && (agl > 650 || V > 165)) want = 0;
    this.gearWant = want;
    this.gear = clamp(this.gear + clamp(want - this.gear, -dt / 4, dt / 4), 0, 1);
    this.flaps = clamp(this.flaps + clamp(this.gear - this.flaps, -dt / 3, dt / 3), 0, 1);
    this.probe = clamp(this.probe + clamp((refuelNear ? 1 : 0) - this.probe, -dt / 2.5, dt / 2.5), 0, 1);
  }

  crash(reason) { if (this.mode === 'crashed') return; this.mode = 'crashed'; this.crashReason = reason; this.event('crash'); }

  step(dt, inp, refuelNear = false) {
    if (this.mode === 'crashed') return;
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let i = 0; i < n && this.mode !== 'crashed'; i++) {
      if (this.mode === 'air') this.stepAir(h, inp, refuelNear); else this.stepGround(h, inp, refuelNear);
    }
    this.updateBody();
  }

  stepAir(dt, inp, refuelNear) {
    const s = this, { rho, a } = atmo(s.pos.y);
    const V = Math.max(s.vel.length(), 0.5), mach = V / a, q = 0.5 * rho * V * V, m = s.mass;
    const gh = s.terrain.heightAt(s.pos.x, s.pos.z);
    s.agl = s.pos.y - gh - AC.eyeH;
    s.autoConfig(dt, s.agl, V, refuelNear);

    // wind frame: parallel-transport onto the velocity vector, then roll about it
    const vhat = _a.copy(s.vel).multiplyScalar(1 / V);
    const fw = _b.copy(AX_FWD).applyQuaternion(s.qw);
    s.qw.premultiply(_q1.setFromUnitVectors(fw, vhat)).normalize();
    // roll rate command
    const sp = clamp(1 - 0.6 * clamp(s.alpha / 0.5, 0, 1), 0.3, 1) * clamp((V - 55) / 85, 0.25, 1);
    const pCmd = inp.roll * 3.6 * sp;
    s.p += (pCmd - s.p) * (1 - Math.exp(-dt / 0.15));
    s.qw.multiply(_q1.setFromAxisAngle(AX_FWD, s.p * dt)).normalize();
    const hv = _c.copy(AX_Y).applyQuaternion(s.qw);                 // lift direction (wind-frame up)

    // g-command pitch with level-turn compensation
    const hy = hv.y;
    const nzh = hy > 0.35 ? 1 / hy : hy > 0 ? 2.857 * (hy / 0.35) : 0;
    const sp_ = clamp(inp.pitch, -1, 1);
    const nzc = clamp(sp_ >= 0 ? nzh + sp_ * (AC.nzMax - nzh) : nzh + sp_ * (nzh - AC.nzMin), AC.nzMin, AC.nzMax);
    const clReq = nzc * m * G / Math.max(q * AC.S, 250 * AC.S);
    const aCmd = invCL(clReq, s.flaps);
    const da = clamp((aCmd - s.alpha) * 6.5, -1.4, 1.4);
    s.alpha += da * dt;

    // forces
    const cl = CL(s.alpha, s.flaps), cd = CD(s.alpha, cl, mach, s.gear, s.flaps);
    const T = s.engine(dt, inp.lever ?? s.lever, rho, mach);
    const qb = _q2.copy(s.qw).multiply(_q1.setFromAxisAngle(AX_X, s.alpha));
    const fwdB = new V3().copy(AX_FWD).applyQuaternion(qb);
    const upB = new V3().copy(AX_Y).applyQuaternion(qb);
    const sf = new V3().copy(fwdB).multiplyScalar(T / m).addScaledVector(hv, cl * q * AC.S / m).addScaledVector(vhat, -cd * q * AC.S / m);
    s.nz = sf.dot(upB) / G;
    s.vel.addScaledVector(sf, dt); s.vel.y -= G * dt;
    s.pos.addScaledVector(s.vel, dt);
    s.qb.copy(qb);

    // ---- collisions with the ground
    const gh2 = s.terrain.heightAt(s.pos.x, s.pos.z);
    const pts = s.gear > 0.85
      ? [[0, -AC.eyeH, AC.gearNose.z], [-AC.gearMain.x, -AC.eyeH, AC.gearMain.z], [AC.gearMain.x, -AC.eyeH, AC.gearMain.z]]
      : [[0, -1.6, 0.5], [0, -1.6, -2.5], [0, -1.6, 4]];
    let touch = false;
    for (const p of pts) { _a.set(p[0], p[1], p[2]).applyQuaternion(qb).add(s.pos); if (_a.y < s.terrain.heightAt(_a.x, _a.z)) { touch = true; break; } }
    if (!touch && s.pos.y - gh2 < 1.2) touch = true;
    if (touch) s.touchdown(fwdB, upB, gh2);
  }

  touchdown(fwdB, upB, gh) {
    const s = this, sink = -s.vel.y, vh = Math.hypot(s.vel.x, s.vel.z), pitch = Math.asin(clamp(fwdB.y, -1, 1));
    const slope = s.terrain.slopeAt(s.pos.x, s.pos.z);
    const onField = Math.abs(s.pos.x - AIRFIELD.x) < AIRFIELD.flatHalfX && Math.abs(s.pos.z - AIRFIELD.z) < AIRFIELD.flatHalfZ;
    if (gh <= 0.2) return s.crash('Tu as percuté la mer');
    if (s.gear < 0.85) return s.crash(vh > 60 ? 'Collision avec le sol' : 'Atterrissage train rentré');
    if (sink > (onField ? 7.0 : 4.5)) return s.crash('Atterrissage trop dur');
    if (upB.y < 0.95) return s.crash('Collision avec le sol (assiette)');
    if (pitch < -0.06 || pitch > 0.32) return s.crash(pitch < 0 ? 'Train avant écrasé' : 'Queue au sol');
    if (slope > (onField ? 0.17 : 0.10) || vh > (onField ? 105 : 60)) return s.crash(onField ? 'Atterrissage trop rapide' : 'Atterrissage hors piste');
    s.mode = 'ground';
    s.g.psi = Math.atan2(fwdB.x, -fwdB.z); s.g.theta = Math.max(0, pitch); s.g.speed = vh;
    s.vel.set(Math.sin(s.g.psi) * vh, 0, -Math.cos(s.g.psi) * vh);
    s.event('touchdown'); s.touch = { sink, vh };
  }

  stepGround(dt, inp, refuelNear) {
    const s = this, g = s.g, { rho, a } = atmo(s.pos.y);
    const m = s.mass, V = g.speed, q = 0.5 * rho * V * V;
    s.autoConfig(dt, 0, V, refuelNear);
    s.agl = 0;
    const T = s.engine(dt, inp.lever ?? s.lever, rho, V / a);
    const lever = clamp(inp.pitch, -1, 1);
    // rotation
    const auth = clamp((V * V) / (70 * 70), 0, 1);
    const thT = lever > 0.05 && V > 50 ? lever * 0.24 * auth : 0;
    const rate = thT > g.theta ? 0.22 : (lever < -0.05 ? 0.5 : 0.18);
    g.theta += clamp(thT - g.theta, -rate * dt, rate * dt);
    g.theta = clamp(g.theta, 0, 0.26);
    const cl = CL(g.theta, s.flaps), lift = cl * q * AC.S;
    const cd = CD(g.theta, cl, V / a, s.gear, s.flaps);
    const gh = s.terrain.heightAt(s.pos.x, s.pos.z);
    const onField = Math.abs(s.pos.x - AIRFIELD.x) < AIRFIELD.flatHalfX && Math.abs(s.pos.z - AIRFIELD.z) < AIRFIELD.flatHalfZ;
    const onRunway = Math.abs(s.pos.x - AIRFIELD.x) < AIRFIELD.halfWid && Math.abs(s.pos.z - AIRFIELD.z) < AIRFIELD.halfLen + 200;
    const normal = Math.max(0, m * G - lift);
    const brake = (inp.lever ?? s.lever) < 0.05 && V < 75 ? 0.40 : 0;
    const mu = (onRunway ? 0.018 : onField ? 0.07 : 0.2) + brake;
    let acc = (T * Math.cos(g.theta) - cd * q * AC.S) / m - (V > 0.05 ? mu * normal / m : 0);
    if (V < 0.05 && acc < 0) acc = 0;
    g.speed = Math.max(0, V + acc * dt);
    // steering (nose wheel / differential brakes) with the stick roll
    const steer = inp.roll * (0.5 / (1 + (V / 18) ** 2) + 0.045) * Math.min(1, V / 2.5);
    g.psi += steer * dt;
    s.vel.set(Math.sin(g.psi) * g.speed, 0, -Math.cos(g.psi) * g.speed);
    s.pos.x += s.vel.x * dt; s.pos.z += s.vel.z * dt;
    const gh2 = s.terrain.heightAt(s.pos.x, s.pos.z);
    s.pos.y = gh2 + AC.eyeH * Math.cos(g.theta) + AC.gearMain.z * Math.sin(g.theta);
    s.nz = 1; s.alpha = g.theta;
    if (gh2 <= 0.2) return s.crash('Tu as roulé dans la mer');
    if (!onField && g.speed > 35) return s.crash('Sortie de piste à vitesse élevée');
    if (s.terrain.slopeAt(s.pos.x, s.pos.z) > 0.2) return s.crash('Terrain trop pentu');
    // lift-off
    if (g.theta > 0.04 && lift > m * G * 1.02) {
      s.mode = 'air';
      s.vel.y = 1.2; s.pos.y += 0.4;
      const f = new V3(Math.sin(g.psi), 0, -Math.cos(g.psi));
      s.vel.set(f.x * g.speed, 1.2, f.z * g.speed);
      s.qw.setFromUnitVectors(AX_FWD, s.vel.clone().normalize());
      s.alpha = g.theta - Math.asin(clamp(s.vel.y / s.vel.length(), -1, 1)); s.p = 0; s.gearWant = 1;
      s.event('liftoff');
    }
  }
}

// ---- tanker ----------------------------------------------------------------------------------------------------
export class Tanker {
  constructor() {
    this.center = new V3(-7500, 0, -9500); this.R = 6000; this.alt = 4600; this.V = 135;
    this.psi = 0.3; this.t = 0;
    this.pos = new V3(); this.vel = new V3(); this.q = new Q(); this.bank = 0;
    this.pod = new V3(10.0, -3.2, 3.0);
    this.rest = new V3(10.0, -6.8, 26.0);
    this.basket = this.rest.clone();        // basket position in tanker frame
    this.state = 'idle'; this.hold = 0; this.lock = 0; this.fuelFlow = 0;
    this.update(0);
  }
  update(dt) {
    this.t += dt;
    const w = this.V / this.R; this.psi += w * dt;
    this.pos.set(this.center.x - this.R * Math.cos(this.psi), this.alt, this.center.z - this.R * Math.sin(this.psi));
    this.vel.set(Math.sin(this.psi) * this.V, 0, -Math.cos(this.psi) * this.V);
    this.bank = Math.atan(this.V * w / G);
    this.q.setFromAxisAngle(AX_Y, -this.psi).multiply(_q1.setFromAxisAngle(AX_FWD, this.bank));
  }
  toWorld(rel, out = new V3()) { return out.copy(rel).applyQuaternion(this.q).add(this.pos); }
  toLocal(world, out = new V3()) { return out.copy(world).sub(this.pos).applyQuaternion(_q2.copy(this.q).invert()); }
  wobble(out) {
    const t = this.t;
    return out.set(0.22 * Math.sin(0.9 * t) + 0.1 * Math.sin(2.3 * t + 1), 0.18 * Math.sin(0.7 * t + 2) + 0.08 * Math.sin(1.9 * t), 0);
  }

  // returns {connected, flow}. `fl` is the Flight object
  refuel(dt, fl, tipWorld) {
    const tip = this.toLocal(tipWorld, new V3());
    const relVel = _c.copy(fl.vel).sub(this.vel).applyQuaternion(_q2.copy(this.q).invert());
    const wob = this.wobble(new V3()), restW = this.rest.clone().add(wob);
    this.lock = Math.max(0, this.lock - dt);
    this.fuelFlow = 0;
    if (this.state === 'connected') {
      const dz = tip.z - this.rest.z, dxy = Math.hypot(tip.x - this.rest.x, tip.y - this.rest.y);
      if (dz < -6 || dz > 5 || dxy > 3.2 || fl.probe < 0.6) { this.state = 'idle'; this.lock = 2.0; fl.event('disconnect'); }
      else {
        this.basket.copy(tip);
        if (fl.fuel < AC.fuelMax - 0.5) { const f = Math.min(55 * dt, AC.fuelMax - fl.fuel); fl.fuel += f; this.fuelFlow = f / dt; this.hold = 0; }
        else { this.hold += dt; if (this.hold > 2.5) { this.state = 'idle'; this.lock = 8; fl.event('full'); } }
      }
    }
    if (this.state !== 'connected') {
      this.basket.lerp(restW, 1 - Math.exp(-dt * 2.5));
      const dx0 = tip.x - this.basket.x, dy0 = tip.y - this.basket.y, dz0 = tip.z - this.basket.z;
      if (fl.probe > 0.9 && this.lock <= 0 && dz0 > -8 && dz0 < 14 && Math.hypot(dx0, dy0) < 2.5) {   // the drogue is gently pulled toward the probe (wake / hose dynamics)
        const k = 1 - Math.exp(-dt * 1.1);
        this.basket.x += clamp(dx0 * k, -0.5 * dt * 3, 0.5 * dt * 3); this.basket.y += clamp(dy0 * k, -0.5 * dt * 3, 0.5 * dt * 3);
      }
      const d = _a.copy(tip).sub(this.basket);
      const near = fl.probe > 0.9 && this.lock <= 0 && fl.fuel < AC.fuelMax - 50;
      this.state = near && Math.hypot(tip.x - restW.x, tip.y - restW.y) < 6 && Math.abs(tip.z - restW.z) < 25 ? 'ready' : 'idle';
      if (near && Math.hypot(d.x, d.y) < 1.0 && d.z > -0.7 && d.z < 0.6 && relVel.z < 0 && -relVel.z < 14) { this.state = 'connected'; this.hold = 0; fl.event('connect'); }
    }
    return this.state === 'connected';
  }

  // crude collision against the tanker airframe (boxes in tanker frame)
  collides(worldPts) {
    for (const wp of worldPts) {
      const p = this.toLocal(wp, new V3());
      if (Math.abs(p.x) < 2.7 && Math.abs(p.y) < 2.7 && p.z > -22 && p.z < 21) return true;                      // fuselage
      if (Math.abs(p.x) < 21 && Math.abs(p.y + 0.6) < 0.9 && p.z > -3 && p.z < 8) return true;                  // wing
      if (Math.abs(p.x) < 7 && Math.abs(p.y - 4) < 4.2 && p.z > 15 && p.z < 22) return true;                    // tail
    }
    return false;
  }
}

// ---- whole simulation -----------------------------------------------------------------------------------------------
export class Sim {
  constructor(terrain) {
    this.terrain = terrain; this.fl = new Flight(terrain); this.tk = new Tanker();
    this.input = { pitch: 0, roll: 0, lever: 0.6 };
    this.msgs = []; this.t = 0; this.crashT = 0; this.spawnMode = 'air'; this.connected = false; this.tankerDist = 1e9;
    this.reset('air');
  }
  say(text, dur = 4) { this.msgs.push({ text, until: this.t + dur }); if (this.msgs.length > 4) this.msgs.shift(); }
  reset(mode = this.spawnMode) {
    this.spawnMode = mode; this.helpT = this.t + 16; this.msgs.length = 0; const f = this.fl, tk = this.tk;
    this.input.pitch = this.input.roll = 0; this.crashT = 0; this.connected = false; tk.state = 'idle'; tk.lock = 0;
    if (mode === 'runway') {
      f.place({ x: 0, y: 0, z: AIRFIELD.halfLen - 100, heading: 0, ground: true, fuel: 3600, lever: 0 });
      f.pos.y = AIRFIELD.elev + AC.eyeH; this.input.lever = 0;
      this.say('Piste : gaz à fond (main gauche), tire le manche vers toi à ~135 kt', 7);
    } else if (mode === 'tanker') {
      tk.update(0);
      const rel = new V3(tk.rest.x - AC.probeTip.x, tk.rest.y - AC.probeTip.y - 0.7, tk.rest.z + 260);
      const w = tk.toWorld(rel);
      f.place({ x: w.x, y: w.y, z: w.z, heading: tk.psi, speed: tk.V + 12, bank: tk.bank, fuel: 1400, lever: 0.3 });
      this.input.lever = 0.3;
      this.say('Ravitaillement : rejoins le panier (cercle) derrière l\'aile droite du ravitailleur', 8);
    } else {
      f.place({ x: 20, y: 2200, z: 9000, heading: 0, speed: 190, fuel: 3200, lever: 0.62 });
      this.input.lever = 0.62;
      this.say('Piste droit devant. Ravitailleur au nord-ouest. A / B / X : changer de départ', 8);
    }
    this.fl.updateBody();
  }
  step(dt) {
    dt = Math.min(dt, 0.05); this.t += dt;
    const f = this.fl, tk = this.tk;
    this.msgs = this.msgs.filter(m => m.until > this.t);
    tk.update(dt);
    this.tankerDist = f.pos.distanceTo(tk.pos);
    if (f.mode === 'crashed') {
      this.crashT += dt;
      if (this.crashT > 4) this.reset(this.spawnMode === 'runway' ? 'runway' : this.spawnMode);
      return;
    }
    f.step(dt, { ...this.input, lever: this.input.lever }, this.tankerDist < 2500);
    f.updateBody();
    const tip = AC.probeTip.clone().applyQuaternion(f.qb).add(f.pos);
    const was = this.connected;
    this.connected = this.tankerDist < 400 ? tk.refuel(dt, f, tip) : (tk.state = 'idle', tk.basket.lerp(tk.rest, 1 - Math.exp(-dt * 2.5)), false);
    if (this.tankerDist < 120 && f.mode === 'air') {
      const pts = [f.pos, tip, new V3(-5.5, -1.2, 3).applyQuaternion(f.qb).add(f.pos), new V3(5.5, -1.2, 3).applyQuaternion(f.qb).add(f.pos), new V3(0, -0.9, -5.5).applyQuaternion(f.qb).add(f.pos), new V3(0, 0, 8).applyQuaternion(f.qb).add(f.pos)];
      if (tk.collides(pts)) f.crash('Collision avec le ravitailleur');
    }
    for (const ev of f.events.splice(0)) {
      if (this.onEvent) this.onEvent(ev);
      if (ev === 'connect') this.say('CONNECTÉ — plein en cours', 4);
      else if (ev === 'disconnect') this.say('Déconnecté', 3);
      else if (ev === 'full') this.say('Réservoirs pleins — déconnexion', 5);
      else if (ev === 'crash') { this.say(f.crashReason + ' — nouveau départ dans 4 s', 4); }
      else if (ev === 'liftoff') this.say('Décollage', 3);
      else if (ev === 'touchdown') this.say(`Posé  (${(f.touch.sink * 196.85).toFixed(0)} ft/min)`, 4);
    }
    if (f.flameout && f.mode === 'air' && !this._fo) { this._fo = true; this.say('PLUS DE CARBURANT', 6); } else if (!f.flameout) this._fo = false;
  }
}
