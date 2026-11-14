// World / scenario model for the ground trainer.
// Frame: e = east (m), n = north (m), alt in feet. Headings in degrees (true, mag var ignored).
// Own-ship is either on the ramp (WOW) or "frozen airborne": the cockpit stays still but the jet
// moves kinematically (virtual stick / throttle) so radar, HUD, nav and weapons behave as in flight.

export const NM = 1852, FT = 0.3048, KT = 0.514444;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const wrap360 = (a) => ((a % 360) + 360) % 360;
export const wrap180 = (a) => { a = wrap360(a); return a > 180 ? a - 360 : a; };

export const TYPES = {
  // air
  'MiG-29': { kind: 'air', rcs: 5, hostile: true, radar: '29', rwr: '29', speed: 450 },
  'Su-27': { kind: 'air', rcs: 10, hostile: true, radar: '29', rwr: '29', speed: 480 },
  'MiG-21': { kind: 'air', rcs: 3, hostile: true, radar: '21', rwr: '21', speed: 420 },
  'F/A-18C': { kind: 'air', rcs: 3, hostile: false, radar: '18', rwr: '18', speed: 350 },
  'E-3A': { kind: 'air', rcs: 100, hostile: false, radar: 'E3', rwr: 'E3', speed: 300 },
  'Il-76': { kind: 'air', rcs: 80, hostile: true, radar: null, rwr: null, speed: 350 },
  // ground
  'SA-6': { kind: 'ground', rcs: 15, hostile: true, radar: '6', rwr: '6', range: 13 * NM, sam: true },
  'SA-8': { kind: 'ground', rcs: 10, hostile: true, radar: '8', rwr: '8', range: 6 * NM, sam: true },
  'SA-11': { kind: 'ground', rcs: 15, hostile: true, radar: '11', rwr: '11', range: 20 * NM, sam: true },
  'ZSU-23': { kind: 'ground', rcs: 6, hostile: true, radar: 'A', rwr: 'A', range: 1.3 * NM, aaa: true },
  'T-72': { kind: 'ground', rcs: 8, hostile: true },
  'BMP-2': { kind: 'ground', rcs: 6, hostile: true },
  'Truck': { kind: 'ground', rcs: 4, hostile: true },
  'Bunker': { kind: 'ground', rcs: 30, hostile: true, fixed: true },
  'Frigate': { kind: 'sea', rcs: 1500, hostile: true, radar: 'SW', rwr: 'SW' },
};

let _id = 1;
export class Contact {
  constructor(type, o) {
    const t = TYPES[type];
    Object.assign(this, { id: _id++, type, kind: t.kind, rcs: t.rcs, hostile: t.hostile, e: 0, n: 0, alt: 0, hdg: 0, tas: t.speed || 0, alive: true, radarOn: !!t.radar, behavior: 'straight', ...o });
    this.def = t; this.vs = 0; this.track = null; this.locked = false; this.launchT = -1;
  }
}

export class Scenario {
  constructor(sim) {
    this.sim = sim;
    this.own = { e: 0, n: 0, alt: 0, hdg: 335, pitch: 0, roll: 0, tas: 0, cas: 0, mach: 0, vs: 0, g: 1, aoa: 0, wow: true, gear: 'DOWN', fuel: 10950 };
    this.contacts = []; this.weapons = []; this.events = [];
    this.home = { name: 'BASE', e: 0, n: 0, elev: 50, tacan: { ch: 44, band: 'X', id: 'BSE' }, ils: { ch: 3, rwyHdg: 335 } };
    this.waypoints = [];
    this.bullseye = { e: 30 * NM, n: 40 * NM };
    this.name = 'cold';
    this.t = 0;
    this.stick = { x: 0, y: 0 }; this.thr = 0.7;
    this.listeners = [];
  }
  on(f) { this.listeners.push(f); }
  emit(t, d) { for (const f of this.listeners) f(t, d); }

  // ---------------------------------------------------------------- geometry
  rel(c) {
    const o = this.own;
    const de = c.e - o.e, dn = c.n - o.n, du = (c.alt - o.alt) * FT;
    const rng = Math.hypot(de, dn), slant = Math.hypot(rng, du);
    const brg = wrap360(Math.atan2(de, dn) * R2D);
    const az = wrap180(brg - o.hdg);
    const el = Math.atan2(du, rng) * R2D - o.pitch;
    // closure (kt) and aspect
    const vo = [Math.sin(o.hdg * D2R) * o.tas, Math.cos(o.hdg * D2R) * o.tas];
    const vc = [Math.sin((c.hdg || 0) * D2R) * (c.tas || 0), Math.cos((c.hdg || 0) * D2R) * (c.tas || 0)];
    const ux = de / (rng || 1), uy = dn / (rng || 1);
    const vc_ = -((vc[0] - vo[0]) * ux + (vc[1] - vo[1]) * uy);
    const aspect = wrap180(brg + 180 - (c.hdg || 0));      // 0 = hot (nose-on), 180 = tail
    return { de, dn, du, rng, slant, rngNm: slant / NM, brg, az, el, vc: vc_, aspect };
  }
  bullsRel(e, n) {   // bearing/range from bullseye
    const de = e - this.bullseye.e, dn = n - this.bullseye.n;
    return { brg: wrap360(Math.atan2(de, dn) * R2D), rng: Math.hypot(de, dn) / NM };
  }
  toCockpitDir(c) {   // unit vector in cockpit (three.js) frame toward a contact, for HUD / TPOD
    const r = this.rel(c);
    const az = r.az * D2R, el = Math.atan2(r.du, r.rng);
    const o = this.own;
    const pitch = o.pitch * D2R, roll = o.roll * D2R;
    // body frame: x right, y up, z back
    let x = Math.sin(az) * Math.cos(el), y = Math.sin(el), z = -Math.cos(az) * Math.cos(el);
    // remove pitch then roll
    let y1 = y * Math.cos(pitch) + z * Math.sin(pitch), z1 = -y * Math.sin(pitch) + z * Math.cos(pitch);
    let x2 = x * Math.cos(roll) - y1 * Math.sin(roll), y2 = x * Math.sin(roll) + y1 * Math.cos(roll);   // right bank (roll > 0): right horizon rises
    return [x2, y2, z1];
  }

  // ---------------------------------------------------------------- presets
  // inverse of toCockpitDir: cockpit-frame unit vector -> {az (true, deg), el (deg)} in the local level frame
  bodyToWorld(d) {
    const o = this.own, pitch = o.pitch * D2R, roll = o.roll * D2R;
    const [x2, y2, z1] = d;
    const x = x2 * Math.cos(roll) + y2 * Math.sin(roll), y1 = -x2 * Math.sin(roll) + y2 * Math.cos(roll);
    const y = y1 * Math.cos(pitch) - z1 * Math.sin(pitch), z = y1 * Math.sin(pitch) + z1 * Math.cos(pitch);
    return { az: wrap360(Math.atan2(x, -z) * R2D + o.hdg), el: Math.atan2(y, Math.hypot(x, z)) * R2D };
  }
  load(name) {
    this.name = name; this.contacts = []; this.weapons = []; this.t = 0;
    const o = this.own;
    Object.assign(o, { e: 0, n: 0, alt: this.home.elev, hdg: 335, pitch: 0, roll: 0, tas: 0, cas: 0, mach: 0, vs: 0, g: 1, aoa: 0, wow: true, gear: 'DOWN', fuel: 10950 });
    this.waypoints = [
      { name: 'WP0', e: 0, n: 0, elev: 50 },
      { name: 'WP1', e: 10 * NM, n: 25 * NM, elev: 0 },
      { name: 'WP2', e: 25 * NM, n: 45 * NM, elev: 0 },
      { name: 'WP3', e: 40 * NM, n: 30 * NM, elev: 0 },
    ];
    if (name === 'aa' || name === 'ag' || name === 'nav') {
      Object.assign(o, { wow: false, gear: 'UP', alt: name === 'aa' ? 22000 : name === 'ag' ? 16000 : 12000, tas: name === 'aa' ? 450 : 420, hdg: name === 'aa' ? 10 : name === 'ag' ? 30 : 20, e: 0, n: 5 * NM });
      this.thr = 0.78;
    }
    if (name === 'aa') {
      const lead = new Contact('MiG-29', { e: 4 * NM, n: 50 * NM, alt: 25000, hdg: 195, tas: 480, behavior: 'inbound', callsign: 'BANDIT 1' });
      const wing = new Contact('MiG-29', { e: 6 * NM, n: 51 * NM, alt: 24000, hdg: 195, tas: 480, behavior: 'inbound' });
      const cap1 = new Contact('Su-27', { e: 30 * NM, n: 70 * NM, alt: 30000, hdg: 270, tas: 420, behavior: 'orbit', center: [25 * NM, 70 * NM], radius: 8 * NM });
      const cap2 = new Contact('Su-27', { e: 32 * NM, n: 72 * NM, alt: 30500, hdg: 270, tas: 420, behavior: 'orbit', center: [25 * NM, 70 * NM], radius: 8 * NM, phase: 0.3 });
      const frd1 = new Contact('F/A-18C', { e: -8 * NM, n: 8 * NM, alt: 21000, hdg: 10, tas: 450, behavior: 'straight', link16: true, callsign: 'ENFIELD 2' });
      const awacs = new Contact('E-3A', { e: -20 * NM, n: -60 * NM, alt: 32000, hdg: 90, tas: 300, behavior: 'orbit', center: [-20 * NM, -60 * NM], radius: 15 * NM, link16: true, callsign: 'DARKSTAR' });
      const tanker = new Contact('Il-76', { e: 40 * NM, n: 90 * NM, alt: 28000, hdg: 180, tas: 350, behavior: 'straight' });
      this.contacts.push(lead, wing, cap1, cap2, frd1, awacs, tanker);
    }
    if (name === 'ag') {
      const tgt = { e: 12 * NM, n: 28 * NM };
      this.waypoints[1] = { name: 'TGT', e: tgt.e, n: tgt.n, elev: 0 };
      this.contacts.push(
        new Contact('SA-6', { e: tgt.e + 2500, n: tgt.n + 3500, alt: 0, behavior: 'static' }),
        new Contact('ZSU-23', { e: tgt.e + 400, n: tgt.n - 300, alt: 0, behavior: 'static' }),
        new Contact('T-72', { e: tgt.e - 200, n: tgt.n + 150, alt: 0, behavior: 'static' }),
        new Contact('T-72', { e: tgt.e - 140, n: tgt.n + 190, alt: 0, behavior: 'static' }),
        new Contact('BMP-2', { e: tgt.e - 60, n: tgt.n + 240, alt: 0, behavior: 'static' }),
        new Contact('Truck', { e: tgt.e + 900, n: tgt.n + 50, alt: 0, hdg: 90, tas: 20, behavior: 'straight' }),
        new Contact('Bunker', { e: tgt.e, n: tgt.n, alt: 0, behavior: 'static' }),
        new Contact('SA-8', { e: tgt.e - 6000, n: tgt.n + 8000, alt: 0, behavior: 'static' }),
        new Contact('Frigate', { e: 40 * NM, n: 20 * NM, alt: 0, hdg: 0, tas: 12, behavior: 'straight' }),
        new Contact('E-3A', { e: -20 * NM, n: -60 * NM, alt: 32000, hdg: 90, tas: 300, behavior: 'orbit', center: [-20 * NM, -60 * NM], radius: 15 * NM, link16: true, callsign: 'DARKSTAR' }),
      );
    }
    if (name === 'nav') {
      this.contacts.push(new Contact('E-3A', { e: -20 * NM, n: -60 * NM, alt: 32000, hdg: 90, tas: 300, behavior: 'orbit', center: [-20 * NM, -60 * NM], radius: 15 * NM, link16: true, callsign: 'DARKSTAR' }));
    }
    this.sim.waypoints = this.waypoints.map(w => ({ lat: '', lon: '', elev: w.elev, ...w }));
    this.emit('load', name);
  }

  // ---------------------------------------------------------------- update
  step(dt) {
    this.t += dt;
    const o = this.own, s = this.sim;
    if (!o.wow) {
      // kinematics: stick x = bank command, stick y = pitch command, throttle -> speed
      const bankCmd = this.ap?.hold ? 0 : this.stick.x * 75;
      o.roll += (bankCmd - o.roll) * Math.min(1, dt * 2.2);
      const pitchCmd = this.stick.y * 20;
      if (!this.ap?.alt) o.pitch += (pitchCmd - o.pitch) * Math.min(1, dt * 1.5);
      else o.pitch += ((this.ap.altTarget - o.alt) / 400 - o.pitch) * Math.min(1, dt * 0.8);
      o.pitch = Math.max(-30, Math.min(30, o.pitch));
      const vms = o.tas * KT;
      const turn = (9.81 * Math.tan(o.roll * D2R) / Math.max(vms, 50)) * R2D;
      o.hdg = wrap360(o.hdg + turn * dt);
      o.vs = vms * Math.sin(o.pitch * D2R) / FT * 60;
      o.alt = Math.max(500, o.alt + o.vs / 60 * dt);
      const tTarget = 220 + this.thr * 400 - Math.max(0, o.pitch) * 4;
      o.tas += (tTarget - o.tas) * Math.min(1, dt * 0.15);
      o.e += Math.sin(o.hdg * D2R) * vms * dt; o.n += Math.cos(o.hdg * D2R) * vms * dt;
      o.g = 1 / Math.cos(o.roll * D2R);
      const rho = Math.pow(1 - 6.8756e-6 * o.alt, 4.2559);
      o.cas = o.tas * Math.sqrt(rho);
      o.mach = o.tas / (661.5 * Math.sqrt(Math.max(0.7, 1 - 6.8756e-6 * o.alt)));
      o.aoa = 3 + (o.g - 1) * 2.5 + Math.max(0, 300 - o.cas) / 40;
      o.fuel = Math.max(0, o.fuel - dt * (0.9 + this.thr * 2.5));
    } else {
      o.tas = o.cas = o.mach = o.vs = 0; o.g = 1; o.aoa = 0;
    }
    for (const c of this.contacts) {
      if (!c.alive) continue;
      if (c.behavior === 'inbound' && !c.merged) {
        const b = wrap360(Math.atan2(o.e - c.e, o.n - c.n) * R2D);
        c.hdg += Math.max(-3 * dt, Math.min(3 * dt, wrap180(b - c.hdg)));
        if (this.rel(c).rngNm < 3) c.merged = true;
      }
      if (c.behavior === 'orbit') {
        c.phase = (c.phase || 0) + dt * (c.tas * KT) / (2 * Math.PI * c.radius);
        const a = c.phase * 2 * Math.PI;
        c.e = c.center[0] + Math.sin(a) * c.radius; c.n = c.center[1] + Math.cos(a) * c.radius;
        c.hdg = wrap360(a * R2D + 90);
      } else if (c.behavior !== 'static' && c.tas) {
        c.e += Math.sin(c.hdg * D2R) * c.tas * KT * dt; c.n += Math.cos(c.hdg * D2R) * c.tas * KT * dt;
      }
      if (c.defensive > 0) { c.defensive -= dt; c.hdg = wrap360(c.hdg + 9 * dt); c.alt += (c.alt > 8000 ? -150 : 0) * dt; }
    }
  }

  kill(c, by) { if (!c.alive) return; c.alive = false; c.radarOn = false; this.emit('kill', { c, by }); }

  // ---------------------------------------------------------------- hot start (ready on the ramp / airborne)
  hotStart(cockpit) {
    const s = this.sim;
    const sw = {
      battery: 'ON', genL: 'NORM', genR: 'NORM', apu: 'OFF', crank: 'OFF', throttleL: 'IDLE', throttleR: 'IDLE',
      ddiL: 'DAY', ddiR: 'DAY', ampcdBrt: 0.8, hudSymBrt: 0.8, hudBlkLvl: 0.4, hudAlt: 'BARO', hudAtt: 'AUTO',
      canopy: 'HOLD', seatArm: 'ARMED', ins: 'IFA', radar: 'OPR', obogs: 'ON', oxyFlow: 'ON', hookBypass: 'FIELD',
      flaps: this.own.wow ? 'HALF' : 'AUTO', antiSkid: 'ON', pitot: 'AUTO', ecm: 'STBY', dispenser: 'ON', ufcBrt: 0.8,
      parkBrake: this.own.wow ? 'SET' : 'RELEASED', ltMode: 'DAY', consoles: 0.3, instPnl: 0.3, volMidsA: 0.6, volMidsB: 0.6,
      flir: 'ON', ltdr: 'ARM', radaltIdx: 200, sbyAdiCaged: false, rwrPwr: true, ifeiBrt: 0.8, posLt: 0.6, formLt: 0.4, strobe: 'BRT',
    };
    if (cockpit) cockpit.applySwitches(sw); else Object.assign(s.sw, sw);
    for (const k of ['L', 'R']) Object.assign(s.eng[k], { n2: k === 'L' ? 64 : 65.5, n1: 63, egt: 450, ff: 560, noz: 78, oil: 82, lit: true, started: true, lightoffN2: 25, peakEgt: 560 });
    if (!this.own.wow) for (const k of ['L', 'R']) Object.assign(s.eng[k], { n2: 88, n1: 86, egt: 640, ff: 3600, noz: 30, oil: 95 });
    Object.assign(s.hyd, { h1: 3000, h2: 3000, brake: 3000 });
    s.apu.n = 0; s.apu.everStarted = true;
    s.canopyPos = 0; s.bleedValves = { L: true, R: true };
    Object.assign(s.ins, { mode: 'IFA', aligned: true, alignT: 480, qual: 0.5, noAtt: false });
    s.fcs.xs = false; s.fcs.resetDone = true; s.fcs.bit = 'GO'; s.fcs.bitDone = true;
    s.bitPage.blinking = false; s.bitPage.stopped = true;
    s.iff.on = true; s.dl.link16 = true; s.toTrimDone = true; s.bingo = 3000;
    s.cautionsAck = new Set(s.cautions()); s.masterCaution = false;
  }
}
