// Stores management (SMS), weapon selection / release and fly-out simulation.
import { NM, FT, KT, wrap180, wrap360 } from './scenario.js';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export const WPN = {
  'AIM-9X': { cat: 'AA', short: '9X', seeker: 'IR', speed: 2.6, tmax: 25, rmaxBase: 9, rmin: 0.25 },
  'AIM-9M': { cat: 'AA', short: '9M', seeker: 'IR', speed: 2.4, tmax: 22, rmaxBase: 7, rmin: 0.3 },
  'AIM-7M': { cat: 'AA', short: '7M', seeker: 'SARH', speed: 3.0, tmax: 45, rmaxBase: 24, rmin: 0.6 },
  'AIM-120C': { cat: 'AA', short: '120C', seeker: 'ARH', speed: 3.6, tmax: 70, rmaxBase: 38, rmin: 0.8 },
  'MK-82': { cat: 'AG', short: 'MK82', type: 'bomb', drag: 0.06 },
  'MK-84': { cat: 'AG', short: 'MK84', type: 'bomb', drag: 0.05 },
  'GBU-12': { cat: 'AG', short: 'GB12', type: 'lgb', drag: 0.05 },
  'GBU-38': { cat: 'AG', short: 'GB38', type: 'jdam', drag: 0.05 },
  'GBU-31': { cat: 'AG', short: 'GB31', type: 'jdam', drag: 0.05 },
  'AGM-65F': { cat: 'AG', short: '65F', type: 'mav', speed: 1.1, tmax: 60, rmaxBase: 12 },
  'AGM-88C': { cat: 'AG', short: '88C', type: 'harm', speed: 2.0, tmax: 90, rmaxBase: 45 },
  'LITENING': { cat: 'POD', short: 'LTNG' },
  'FUEL': { cat: 'TANK', short: 'FUEL' },
};

export const LOADOUTS = {
  aa: { 1: 'AIM-9X', 2: 'AIM-120C', 3: 'AIM-120C', 4: 'AIM-7M', 5: 'FUEL', 6: 'AIM-7M', 7: 'AIM-120C', 8: 'AIM-120C', 9: 'AIM-9X' },
  ag: { 1: 'AIM-9X', 2: 'GBU-38', 3: 'GBU-12', 4: 'LITENING', 5: 'FUEL', 6: 'AIM-120C', 7: 'AGM-65F', 8: 'AGM-88C', 9: 'AIM-9X' },
  nav: { 1: 'AIM-9X', 2: 'MK-82', 3: 'MK-82', 4: 'LITENING', 5: 'FUEL', 6: 'AIM-120C', 7: 'MK-82', 8: 'MK-82', 9: 'AIM-9X' },
};

export class Weapons {
  constructor(sim, scn, radar) {
    this.sim = sim; this.scn = scn; this.radar = radar;
    this.reset('aa');
  }
  reset(loadout = 'aa') {
    const L = LOADOUTS[loadout] || LOADOUTS.aa;
    this.stations = {};
    for (let i = 1; i <= 9; i++) this.stations[i] = L[i] ? { type: L[i], qty: 1, def: WPN[L[i]] } : null;
    this.gun = { rounds: 578, rate: 'HIGH', firing: false, bullets: [] };
    this.master = 'NAV';         // NAV | AA | AG
    this.aaSel = null;           // weapon type selected in A/A
    this.agSel = null;           // station selected in A/G
    this.inFlight = [];          // missiles / bombs in flight
    this.seeker = { caged: true, tone: 0, track: null, az: 0, el: -3 };
    this.ag = { mode: 'CCIP', fuze: 'INST', qty: 1, jdamMode: 'TOO', jdamAlignT: 0, lgbCode: 1688, mavCaged: true, mavTrack: null, mavLos: { az: 0, el: -8 }, harmMode: 'TOO', harmTgt: null };
    this.sim.masterArmSim = false;
    this.lastShot = 0;
  }

  // ---------------------------------------------------------------- selection
  setMaster(m) { this.master = this.master === m ? 'NAV' : m; if (this.master === 'AA' && !this.aaSel) this.selectAA('AIM-9'); if (this.master === 'AG' && !this.agSel) this.cycleAG(); this.radar.gunSelected(this.master === 'AA' && this.aaSel === 'GUN'); this.sim.log('masterMode', { m: this.master }); }
  stationsOf(prefix) { return Object.entries(this.stations).filter(([k, s]) => s && s.qty > 0 && s.type.startsWith(prefix)).map(([k]) => +k); }
  selectAA(kind) {
    this.master = 'AA';
    const map = { 'AIM-7': 'AIM-7', 'AIM-9': 'AIM-9', 'AIM-120': 'AIM-120' };
    if (kind === 'GUN') { this.aaSel = 'GUN'; this.radar.gunSelected(true); this.sim.log('wpnSel', { w: 'GUN' }); return; }
    const st = this.stationsOf(map[kind]);
    this.radar.gunSelected(false);
    if (!st.length) { this.aaSel = null; return; }
    // repeated selection steps to the next station of that type
    if (this.aaSel && this.aaSel.startsWith(kind) && this.aaStation) {
      const i = st.indexOf(this.aaStation); this.aaStation = st[(i + 1) % st.length];
    } else this.aaStation = st[0];
    this.aaSel = this.stations[this.aaStation].type;
    this.seeker.caged = true; this.seeker.track = null;
    this.sim.log('wpnSel', { w: this.aaSel, st: this.aaStation });
  }
  cycleAG(station) {
    const ag = Object.entries(this.stations).filter(([k, s]) => s && s.qty > 0 && s.def.cat === 'AG').map(([k]) => +k);
    if (!ag.length) { this.agSel = null; return; }
    if (station && ag.includes(station)) this.agSel = station;
    else { const i = ag.indexOf(this.agSel); this.agSel = ag[(i + 1) % ag.length]; }
    const t = this.stations[this.agSel].def.type;
    if (t === 'jdam' && !this.ag.jdamAlignT) this.ag.jdamAlignT = this.sim.t;
    this.sim.log('wpnSel', { w: this.stations[this.agSel].type, st: this.agSel });
  }
  agDef() { return this.agSel ? this.stations[this.agSel] : null; }
  armed() { return this.sim.sw.masterArm === 'ARM' || this.sim.masterArmSim; }
  aaCount(prefix) { return this.stationsOf(prefix).length; }

  // ---------------------------------------------------------------- launch zones
  dlz(type, trk) {
    const o = this.scn.own, w = WPN[type];
    if (!trk || !w || !w.rmaxBase) return null;
    const altF = 0.55 + Math.min(1.2, ((o.alt + trk.alt) / 2) / 30000) * 0.75;
    const asp = Math.abs(trk.aspect ?? 0);
    const aspF = 1 - 0.55 * (asp / 180);
    const spdF = 0.8 + (o.mach || 0.5) * 0.35;
    const rmax = w.rmaxBase * altF * aspF * spdF;
    return { rmax, rne: rmax * (w.seeker === 'IR' ? 0.55 : 0.42), rmin: w.rmin, rng: trk.rng };
  }

  // ---------------------------------------------------------------- A/A release (trigger)
  trigger(down) {
    if (this.master !== 'AA') return;
    if (this.aaSel === 'GUN') { this.gun.firing = down && this.armed() && this.gun.rounds > 0 && !this.scn.own.wow; return; }
    if (!down || !this.aaSel || !this.armed() || this.scn.own.wow) return;
    if (this.sim.t - this.lastShot < 1.0) return;
    const st = this.aaStation; const s = this.stations[st]; if (!s || s.qty <= 0) return;
    const w = s.def; const trk = this.radar.lsTrack();
    let target = null;
    if (w.seeker === 'IR') target = this.seeker.track || (trk ? trk.c : null);
    if (w.seeker === 'SARH') { if (this.radar.mode !== 'STT') { this.sim.log('noLaunch', { why: 'AIM-7 sans STT' }); return; } target = this.radar.stt; }
    if (w.seeker === 'ARH') { if (!(this.radar.mode === 'STT' || this.radar.mode === 'TWS') || !trk) { target = null; } else target = trk.c; }
    s.qty = 0; this.lastShot = this.sim.t;
    const o = this.scn.own;
    const m = { kind: 'AA', type: s.type, w, e: o.e, n: o.n, alt: o.alt, hdg: o.hdg, spd: o.tas * KT + 50, t: 0, target, st, active: w.seeker !== 'ARH', pitbull: false, dlz: target ? this.dlz(s.type, trk) : null };
    if (w.seeker === 'ARH' && target) { m.tta = 0; }
    this.inFlight.push(m);
    if (w.seeker === 'SARH' && this.radar.mode === 'TWS' && trk) this.radar.lock(trk.c);
    this.sim.log('launch', { type: s.type, st, tgt: target && target.type });
    this.scn.emit('launch', m);
    if (target && (w.seeker !== 'IR')) target.defensive = 6 + Math.random() * 6;
    // step to the next missile of the same type
    const next = this.stationsOf(s.type.slice(0, 5));
    if (next.length) { this.aaStation = next[0]; this.aaSel = this.stations[next[0]].type; } else this.aaSel = null;
  }

  // ---------------------------------------------------------------- A/G release (pickle)
  pickle(down) {
    if (!down || this.master !== 'AG' || !this.armed() || this.scn.own.wow) return;
    const s = this.agDef(); if (!s || s.qty <= 0) return;
    const w = s.def, o = this.scn.own, tgt = this.sim.agTarget;
    if (w.type === 'jdam') {
      if (!tgt) { this.sim.log('noLaunch', { why: 'JDAM sans cible désignée' }); return; }
      if (this.sim.t - this.ag.jdamAlignT < 30) { this.sim.log('noLaunch', { why: 'JDAM non aligné' }); return; }
    }
    if (w.type === 'mav' && !this.ag.mavTrack) { this.sim.log('noLaunch', { why: 'Maverick sans verrouillage' }); return; }
    if (w.type === 'harm' && !this.ag.harmTgt) { this.sim.log('noLaunch', { why: 'HARM sans émetteur sélectionné' }); return; }
    s.qty = 0;
    const vx = Math.sin(o.hdg * D2R) * o.tas * KT, vy = Math.cos(o.hdg * D2R) * o.tas * KT, vz = o.tas * KT * Math.sin(o.pitch * D2R);
    const m = { kind: w.type, type: s.type, w, e: o.e, n: o.n, alt: o.alt, vx, vy, vz, t: 0, st: this.agSel, tgt: tgt ? { ...tgt } : null };
    if (w.type === 'mav') m.target = this.ag.mavTrack, m.spd = o.tas * KT + 30;
    if (w.type === 'harm') m.target = this.ag.harmTgt, m.spd = o.tas * KT + 50;
    if (w.type === 'bomb' && this.ag.mode === 'CCIP') m.tgt = null;
    this.inFlight.push(m);
    this.sim.log('release', { type: s.type, st: this.agSel });
    this.scn.emit('release', m);
    this.cycleAG();
  }

  // ---------------------------------------------------------------- CCIP / AUTO solution
  ccip() {
    const o = this.scn.own; if (o.wow) return null;
    const v = o.tas * KT, h = (o.alt - 0) * FT;
    const vz = v * Math.sin(o.pitch * D2R), vh = v * Math.cos(o.pitch * D2R);
    const tf = (vz + Math.sqrt(vz * vz + 2 * 9.81 * h)) / 9.81;
    const drag = 0.92;
    const ground = vh * tf * drag;
    const depression = Math.atan2(h, ground) * R2D;    // below horizon
    return { tof: tf, ground, depression, el: -(depression) - o.pitch };   // HUD elevation relative to waterline (deg)
  }
  jdamLar() {
    const t = this.sim.agTarget; if (!t) return null;
    const o = this.scn.own; const r = Math.hypot(t.e - o.e, t.n - o.n) / NM;
    const rmax = 6 + (o.alt / 1000) * 0.45 + (o.mach || 0.6) * 4, rmin = 1.0;
    return { r, rmax, rmin, inRng: r < rmax && r > rmin };
  }

  // ---------------------------------------------------------------- step
  step(dt) {
    const scn = this.scn, o = scn.own;
    // IR seeker (AIM-9): slaved to L&S if available, else boresight; tone when a hot target is in the FOV
    if (this.master === 'AA' && this.aaSel && WPN[this.aaSel] && WPN[this.aaSel].seeker === 'IR') {
      const trk = this.radar.lsTrack();
      let best = null, bd = 99;
      const fov = this.seeker.caged ? 2.5 : 4;
      const cAz = trk ? trk.az : 0, cEl = trk ? trk.el : -3;
      for (const c of scn.contacts) {
        if (!c.alive || c.kind !== 'air') continue;
        const r = scn.rel(c); if (r.rngNm > 10) continue;
        const d = Math.hypot(r.az - (this.seeker.track === c ? r.az : cAz), r.el - (this.seeker.track === c ? r.el : cEl));
        const tailBonus = Math.abs(r.aspect) > 90 ? 1 : 0.7;
        if (d < fov && d < bd && Math.random() < tailBonus) { bd = d; best = c; }
      }
      if (!this.seeker.caged && this.seeker.track && this.seeker.track.alive && scn.rel(this.seeker.track).rngNm < 10) best = this.seeker.track;
      this.seeker.tone = best ? 1 : 0.25;
      if (best && !this.seeker.caged) this.seeker.track = best; else if (this.seeker.caged) this.seeker.track = best;
      if (this.seeker.track) { const r = scn.rel(this.seeker.track); this.seeker.az = r.az; this.seeker.el = r.el; } else { this.seeker.az = cAz; this.seeker.el = cEl; }
    } else this.seeker.tone = 0;
    // gun
    if (this.gun.firing && this.gun.rounds > 0) {
      const n = Math.min(this.gun.rounds, Math.ceil((this.gun.rate === 'HIGH' ? 100 : 66) * dt));
      this.gun.rounds -= n;
      const trk = this.radar.mode === 'STT' ? this.radar.stt : null;
      for (const c of scn.contacts) {
        if (!c.alive || c.kind !== 'air') continue;
        const r = scn.rel(c);
        if (r.slant / FT > 4000) continue;
        const tof = r.slant / 1050;
        const lead = trk === c ? 0 : 1.5;
        if (Math.hypot(r.az, r.el - 2 + lead) < 1.2 && Math.random() < 0.06 * n) scn.kill(c, 'GUN');
      }
      if (this.gun.rounds <= 0) this.gun.firing = false;
    }
    // missiles / bombs
    for (const m of this.inFlight) {
      m.t += dt;
      if (m.kind === 'AA') this.stepAA(m, dt); else this.stepAG(m, dt);
    }
    this.inFlight = this.inFlight.filter(m => !m.done);
  }

  stepAA(m, dt) {
    const scn = this.scn, w = m.w;
    const vmax = w.speed * 300;
    m.spd = Math.min(vmax, m.spd + 250 * dt);
    if (m.t > w.tmax * 0.6) m.spd *= (1 - 0.15 * dt);
    let tgt = m.target;
    if (w.seeker === 'SARH' && (this.radar.mode !== 'STT' || this.radar.stt !== tgt)) tgt = null;   // lost illumination
    if (w.seeker === 'ARH' && tgt && !m.pitbull) {
      const dd = Math.hypot(tgt.e - m.e, tgt.n - m.n) / NM;
      if (dd < 10) { m.pitbull = true; this.sim.log('pitbull', { type: m.type }); }
    }
    if (tgt && tgt.alive) {
      const de = tgt.e - m.e, dn = tgt.n - m.n, du = (tgt.alt - m.alt) * FT;
      const d = Math.hypot(de, dn, du);
      const brg = Math.atan2(de, dn) * R2D;
      m.hdg += Math.max(-25 * dt, Math.min(25 * dt, wrap180(brg - m.hdg)));
      m.alt += Math.max(-300, Math.min(300, du / FT / 4)) * dt * 3;
      m.ttg = d / Math.max(50, m.spd);
      if (d < 60) {
        const z = m.dlz; let pk = 0.85;
        if (z) { if (z.rng > z.rmax) pk = 0.25; else if (z.rng > z.rne) pk = tgt.defensive > 0 ? 0.45 : 0.7; else pk = 0.9; }
        if (Math.random() < pk) { scn.kill(tgt, m.type); this.sim.log('hit', { type: m.type, tgt: tgt.type }); }
        else this.sim.log('miss', { type: m.type });
        m.done = true;
      }
    }
    m.e += Math.sin(m.hdg * D2R) * m.spd * dt; m.n += Math.cos(m.hdg * D2R) * m.spd * dt;
    if (m.t > w.tmax) { m.done = true; this.sim.log('miss', { type: m.type, why: 'tmax' }); }
  }

  stepAG(m, dt) {
    const scn = this.scn;
    if (m.kind === 'bomb' || m.kind === 'lgb' || m.kind === 'jdam') {
      // ballistic, with guidance for JDAM (coordinates) and LGB (laser spot)
      const guided = (m.kind === 'jdam' && m.tgt) || (m.kind === 'lgb' && this.sim.laserOn && this.sim.agTarget);
      const tg = m.kind === 'lgb' ? this.sim.agTarget : m.tgt;
      if (guided && tg) {
        // guided glide: fly the line of sight to the target, limited by the weapon's lift/drag
        const de = tg.e - m.e, dn = tg.n - m.n, h = Math.max(1, m.alt * FT), dist = Math.max(1, Math.hypot(de, dn));
        const LD = m.kind === 'jdam' ? 5.5 : 3.2;
        const vh = Math.max(170, Math.hypot(m.vx, m.vy) * (1 - 0.012 * dt));
        m.vx += (de / dist * vh - m.vx) * Math.min(1, dt * 1.5); m.vy += (dn / dist * vh - m.vy) * Math.min(1, dt * 1.5);
        const vzCmd = -Math.max(h / dist, 1 / LD) * vh;
        m.vz += (vzCmd - m.vz) * Math.min(1, dt * 1.2);
      } else {
        m.vx *= (1 - (m.w.drag || 0.05) * 0.1 * dt); m.vy *= (1 - (m.w.drag || 0.05) * 0.1 * dt);
        m.vz -= 9.81 * dt;
      }
      m.e += m.vx * dt; m.n += m.vy * dt; m.alt += m.vz * dt / FT;
      if (m.alt <= 0) { this.impact(m, m.kind === 'bomb' ? 70 : 25); }
    } else if (m.kind === 'mav' || m.kind === 'harm') {
      const tgt = m.target; m.spd = Math.min(m.w.speed * 340, m.spd + 150 * dt);
      if (tgt && tgt.alive && (m.kind === 'mav' || tgt.radarOn || m.t < 3)) {
        const de = tgt.e - m.e, dn = tgt.n - m.n, du = (tgt.alt - m.alt) * FT;
        const d = Math.hypot(de, dn, du);
        m.vx = de / d * m.spd; m.vy = dn / d * m.spd; m.vz = du / d * m.spd;
        if (d < 30) { this.impact(m, 20, tgt); return; }
      } else { m.vz -= 9.81 * dt; }
      m.e += m.vx * dt; m.n += m.vy * dt; m.alt += m.vz * dt / FT;
      if (m.alt <= 0 || m.t > m.w.tmax) this.impact(m, 20);
    }
  }
  impact(m, radius, direct) {
    m.done = true;
    const scn = this.scn;
    let hit = 0;
    for (const c of scn.contacts) {
      if (!c.alive || c.kind === 'air') continue;
      const d = Math.hypot(c.e - m.e, c.n - m.n);
      if (c === direct || d < radius) { scn.kill(c, m.type); hit++; }
    }
    scn.emit('impact', { e: m.e, n: m.n, type: m.type });
    this.sim.log('impact', { type: m.type, kills: hit });
  }
}
