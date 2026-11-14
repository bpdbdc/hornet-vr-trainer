// Systems simulation for the F/A-18C cold start, tuned to the DCS module behaviour
// described in Chuck's guide (04/2025) and the ED Early Access guide.
// All switch positions live in `sw` (written by the cockpit controls); everything else is derived.

export const ENGINE = {
  CRANK_MAX: 26.5,      // % N2 reached by the ATS when cranking (DCS ~25-26 %)
  CRANK_RATE: 1.9,      // %/s while motoring
  LIGHT_MIN: 12,        // below this N2 fuel will not light (hung / no start)
  IDLE_L: 64.0,
  IDLE_R: 65.5,
  EGT_IDLE: 450,
  FF_IDLE: 560,
  NOZ_IDLE: 78,
  OIL_IDLE: 82,
};

function approach(v, target, rate, dt) {
  const d = target - v;
  const s = Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  return v + s;
}

export class Sim {
  constructor() {
    this.listeners = [];
    this.reset();
  }

  reset() {
    this.t = 0;
    // ---- switch / control positions (strings match control state names) ----
    this.sw = {
      battery: 'OFF', genL: 'NORM', genR: 'NORM', genTie: 'NORM', extPwr: 'NORM',
      apu: 'OFF', crank: 'OFF',
      throttleL: 'OFF', throttleR: 'OFF',
      fireTest: 'NORM', bleed: 'NORM', bleedAug: 'IN',
      ltTest: 'OFF', ltMode: 'DAY',
      ddiL: 'OFF', ddiR: 'OFF', ampcdBrt: 0, hudSymBrt: 0, hudBlkLvl: 0, hudBal: 0.5, hudAoa: 0.5,
      hudAlt: 'BARO', hudAtt: 'INS', hudRej: 'NORM', hudVideo: 'OFF', hudSymMode: 'DAY',
      canopy: 'HOLD', seatArm: 'SAFE', harness: 'LOCK', parkBrake: 'SET',
      masterArm: 'SAFE', ins: 'OFF', radar: 'OFF', flir: 'OFF', ltdr: 'SAFE', lstNflr: 'OFF',
      obogs: 'OFF', oxyFlow: 'OFF', hookBypass: 'CARRIER', flaps: 'AUTO', antiSkid: 'OFF',
      launchBar: 'RETRACT', ldgTaxi: 'OFF', fcsGain: 'NORM', fcsBit: 'OFF', toTrim: 'OUT',
      pitot: 'AUTO', engAntiIce: 'OFF', windshield: 'OFF', cabinPress: 'NORM', ecsMode: 'AUTO',
      radaltIdx: 0, sbyAdiCaged: true, rwrPwr: false, ecm: 'OFF', dispenser: 'OFF', auxRel: 'NORM',
      strobe: 'OFF', posLt: 0, formLt: 0, intrWing: 'NORM', wingFold: 'SPREAD',
      mc: 'NORM', hydIsol: 'NORM', avCool: 'NORM', irCool: 'OFF', spin: 'NORM', hmd: 0,
      probe: 'RETRACT', extWing: 'NORM', extCtr: 'NORM', dump: 'OFF', intWing: 'NORM',
      fuelTanksSw: 'NORM', gearHandle: 'DOWN', selJett: 'SAFE', iffMaster: 'NORM', mode4: 'OFF', crypto: 'NORM',
      ilsMode: 'UFC', ilsChan: 1, comm1Ant: 'AUTO', iffAnt: 'BOTH', gxmt: 'OFF', relay: 'OFF',
      volTcn: 0.3, volMidsA: 0.3, volMidsB: 0.3, volRwr: 0.5, volWpn: 0.5, volAux: 0.5, volIcs: 0.5, volVox: 0.5,
      comm1Vol: 0.5, comm2Vol: 0.5, ufcBrt: 0.7, adf: 'OFF',
      consoles: 0, instPnl: 0, flood: 0, warnCaut: 0.5, chart: 0,
      ky58: 'OFF', baroSet: 29.92,
    };
    // ---- derived systems ----
    this.apu = { n: 0, running: false, ready: false, offTimer: -1, everStarted: false };
    this.eng = {
      L: { n2: 0, n1: 0, egt: 15, ff: 0, noz: 0, oil: 0, lit: false, lightoffN2: null, peakEgt: 15, started: false },
      R: { n2: 0, n1: 0, egt: 15, ff: 0, noz: 0, oil: 0, lit: false, lightoffN2: null, peakEgt: 15, started: false },
    };
    this.hyd = { h1: 0, h2: 0, brake: 3000 };
    this.elec = { batt: false, genL: false, genR: false, ac: false, uBatt: 24.5, eBatt: 24.5 };
    this.canopyPos = 1.0;     // 1 = fully open
    this.fireTest = { active: null, t: 0, doneA: false, doneB: false, playing: false };
    this.bleedValves = { L: true, R: true };   // open
    this.bleedTrack = [];                       // positions visited since last NORM
    this.ins = { mode: 'OFF', alignT: 0, alignTotal: 480, aligned: false, stdHdg: false, stdHdgAvailable: true, gps: true, qual: 10.0, noAtt: true };
    this.fcs = { xs: true, resetDone: false, bit: 'PBIT GO', bitT: 0, bitDone: false };
    this.cautionsAck = new Set();
    this.masterCaution = false;
    this.mcPressTimes = [];
    this.stacked = false;
    this.bitPage = { blinking: true, stopped: false };
    this.bingo = 0;
    this.radaltOn = false;
    this.toTrimDone = false;
    this.hudOn = false;
    this.iff = { on: false, holdT: 0, mode4A: true };
    this.dl = { link16: false, freq: 127, holdT: 0 };
    // ---- tactical / scenario hooks (set by main.js) ----
    this.agTarget = null; this.laserOn = false; this.laserFire = false; this.wyptIdx = 0;
    this.masterArmSim = false; this.ufcEmcon = false;
    this.lockLt = false; this.shootLt = false; this.shootFlash = false;
    this.rwrLt = { AI: false, SAM: false, CW: false, AAA: false };
    this.thrAxis = { L: 0, R: 0 };        // 0 = IDLE, 1 = MIL, 1.0-1.3 = afterburner (HOTAS)
    this.speedBrake = 0; this.spdBrkCmd = 'RET';
    this.fuelInt = 10950; this.fuelTotal = 10950;
    this.warn = {};                       // voice / caution latches
    this.events = [];
    this.emit('reset');
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const f of this.listeners) f(type, data, this); }
  log(type, data) {
    const d = data && data.type !== undefined ? { ...data, what: data.type } : data;   // keep the event type when data carries a 'type'
    this.events.push({ t: this.t, ...d, type }); this.emit('event', { ...d, type });
  }

  // called by controls when a switch changes
  set(key, value, meta = {}) {
    const old = this.sw[key];
    if (old === value) return;
    this.sw[key] = value;
    this.onSwitch(key, value, old, meta);
    this.log('switch', { key, value, old, user: meta.user !== false });
  }

  onSwitch(key, v, old) {
    if (key === 'bleed') {
      // rotating the BLEED AIR knob 360 deg from NORM back to NORM re-opens the bleed valves
      if (v !== 'NORM') this.bleedTrack.push(v);
      else {
        const seen = new Set(this.bleedTrack);
        if (seen.has('R OFF') && seen.has('OFF') && seen.has('L OFF')) {
          if (!this.bleedValves.L || !this.bleedValves.R) this.log('bleedReset', {});
          this.bleedValves = { L: true, R: true };
        }
        this.bleedTrack = [];
      }
    }
    if (key === 'apu' && v === 'ON' && this.elec.batt) {
      this.apu.everStarted = true;
    }
    if (key === 'fcsReset' && v === 'PRESS') this.fcsReset();
    if (key === 'toTrim' && v === 'PRESS') { if (this.elec.ac || this.elec.batt) { this.toTrimDone = true; this.log('toTrim', {}); } }
  }

  fcsReset() {
    const hydOk = this.hyd.h1 > 1500 || this.hyd.h2 > 1500;
    if (this.elec.ac && hydOk) {
      if (this.fcs.xs) this.log('fcsResetOk', {});
      this.fcs.xs = false; this.fcs.resetDone = true;
    } else this.log('fcsResetNoEffect', {});
  }

  pressMasterCaution() {
    if (!this.elec.batt) return;
    const now = this.t;
    this.mcPressTimes = this.mcPressTimes.filter(t => now - t < 1.2);
    this.mcPressTimes.push(now);
    this.masterCaution = false;
    for (const c of this.cautions()) this.cautionsAck.add(c);
    if (this.mcPressTimes.length >= 2) { this.stacked = !this.stacked; this.mcPressTimes = []; this.log('restack', {}); }
    this.log('masterCaution', {});
  }

  startFcsBit() {
    // FCS BIT: FCS BIT switch held + FCS OSB on the FCS-MC page, WOW, both hydraulic systems up
    if (this.sw.fcsBit !== 'ON') return false;
    if (!(this.hyd.h1 > 2000 && this.hyd.h2 > 2000)) { this.log('fcsBitRefused', {}); return false; }
    this.fcs.bit = 'IN TEST'; this.fcs.bitT = 0; this.log('fcsBitStart', {});
    return true;
  }

  // ------------------------------------------------------------------
  step(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const sw = this.sw, e = this.eng;

    // ---- electrical ----
    this.elec.batt = sw.battery === 'ON' || sw.battery === 'ORIDE';
    this.elec.genL = e.L.n2 > 56 && sw.genL === 'NORM';
    this.elec.genR = e.R.n2 > 56 && sw.genR === 'NORM';
    this.elec.ac = this.elec.genL || this.elec.genR;
    const dcOn = this.elec.batt || this.elec.ac;

    // ---- APU ----
    const apu = this.apu;
    const apuCmd = sw.apu === 'ON' && this.elec.batt;
    if (apuCmd) apu.n = approach(apu.n, 100, 100 / 14, dt); else apu.n = approach(apu.n, 0, 100 / 10, dt);
    apu.running = apu.n > 5;
    apu.ready = apu.n >= 98;
    // automatic shutdown ~60 s after both engines are stabilised at idle (DCS)
    const bothIdle = e.L.n2 > 60 && e.R.n2 > 60;
    if (sw.apu === 'ON' && bothIdle) {
      if (apu.offTimer < 0) apu.offTimer = 0;
      apu.offTimer += dt;
      if (apu.offTimer > 60) { this.set('apu', 'OFF', { user: false }); this.log('apuAutoOff', {}); apu.offTimer = -1; }
    } else if (!bothIdle) apu.offTimer = -1;

    // ---- engines ----
    for (const side of ['L', 'R']) {
      const g = e[side];
      const thr = side === 'L' ? sw.throttleL : sw.throttleR;
      const fuelOn = thr !== 'OFF' && dcOn;
      const cranking = sw.crank === side && apu.ready && !g.lit;
      if (!g.lit) {
        if (cranking) g.n2 = approach(g.n2, ENGINE.CRANK_MAX, ENGINE.CRANK_RATE, dt);
        else g.n2 = approach(g.n2, 0, 2.5, dt);
        if (fuelOn && g.n2 >= ENGINE.LIGHT_MIN && (cranking || g.n2 > 20)) {
          if (g.lightoffN2 === null) { g.lightoffN2 = g.n2; g.lightT = 0; this.log('fuelIn', { side, n2: g.n2 }); }
          g.lightT += dt;
          if (g.lightT > 1.8) { g.lit = true; this.log('lightoff', { side, n2: g.lightoffN2 }); }
        } else if (!fuelOn) { g.lightoffN2 = null; }
      } else {
        if (!fuelOn) { g.lit = false; g.lightoffN2 = null; g.started = false; this.log('shutdown', { side }); }
      }
      const idle = side === 'L' ? ENGINE.IDLE_L : ENGINE.IDLE_R;
      if (g.lit) {
        // accelerate to idle: faster in the middle of the range
        const k = g.n2 < 45 ? 1.25 : (g.n2 < 58 ? 1.6 : (g.started ? 9 : 0.6));
        const ax = g.started ? Math.max(0, Math.min(1.3, this.thrAxis[side] || 0)) : 0;
        const n2Cmd = idle + (100 - idle) * Math.min(1, ax);
        g.n2 = approach(g.n2, n2Cmd, k, dt);
        g.ab = ax > 1.0 && g.n2 > 97;
        if (!g.started && g.n2 > idle - 1.5) { g.started = true; this.log('engineStable', { side }); }
        // EGT: overshoot that depends on how early fuel was introduced (hot start below ~18 %)
        const lo = g.lightoffN2 ?? 25;
        g.peakTarget = 560 + Math.max(0, 25 - lo) * 27;
        const pw = Math.max(0, (g.n2 - idle) / (100 - idle));
        const egtTarget = g.n2 < idle - 8 ? g.peakTarget : ENGINE.EGT_IDLE + pw * 360 + (g.ab ? 20 : 0);
        g.egt = approach(g.egt, egtTarget, g.n2 < idle - 8 ? 140 : 18, dt);
        g.peakEgt = Math.max(g.peakEgt, g.egt);
        const abx = g.ab ? (Math.min(1.3, this.thrAxis[side]) - 1) / 0.3 : 0;
        g.ff = approach(g.ff, g.n2 < 40 ? 900 : ENGINE.FF_IDLE + pw * pw * 9400 + abx * 21000, g.started ? 4000 : 220, dt);
        // nozzle: ~78 % open at ground idle, closes towards MIL, opens again in AB
        const nozT = g.n2 > 50 ? (g.ab ? 40 + abx * 60 : ENGINE.NOZ_IDLE - pw * 70) : 10;
        g.noz = approach(g.noz, Math.max(0, nozT), g.started ? 40 : 9, dt);
        g.oil = approach(g.oil, ENGINE.OIL_IDLE * Math.min(1, g.n2 / idle) + pw * 18, 12, dt);
      } else {
        g.egt = approach(g.egt, 15 + (g.n2 > 1 ? 20 : 0), 25, dt);
        g.ff = approach(g.ff, g.lightoffN2 !== null ? 300 : 0, 400, dt);
        g.noz = approach(g.noz, 0, 10, dt);
        g.oil = approach(g.oil, g.n2 * 0.9, 10, dt);
      }
      g.n1 = Math.max(0, g.n2 * 1.08 - 6);
    }
    // ENG CRANK switch is magnetically held: drops to OFF when the cranked engine is started (or APU lost)
    if (sw.crank !== 'OFF') {
      const g = e[sw.crank];
      if (g.lit && g.n2 > 60) { this.set('crank', 'OFF', { user: false }); }
      else if (!apu.running && sw.crank !== 'OFF' && this.elec.batt === false) this.set('crank', 'OFF', { user: false });
    }

    // ---- hydraulics ----
    this.hyd.h1 = approach(this.hyd.h1, 3000 * Math.max(0, Math.min(1, (e.L.n2 - 12) / 40)), 900, dt);
    this.hyd.h2 = approach(this.hyd.h2, 3000 * Math.max(0, Math.min(1, (e.R.n2 - 12) / 40)), 900, dt);
    if (this.hyd.h2 > 2800) this.hyd.brake = approach(this.hyd.brake, 3000, 200, dt);

    // ---- canopy ----
    const canopyPowered = this.elec.batt;
    if (canopyPowered && sw.canopy === 'CLOSE') this.canopyPos = approach(this.canopyPos, 0, 1 / 7, dt);
    if (canopyPowered && sw.canopy === 'OPEN') this.canopyPos = approach(this.canopyPos, 1, 1 / 7, dt);

    // ---- fire / bleed test ----
    const ft = this.fireTest;
    if ((sw.fireTest === 'TEST A' || sw.fireTest === 'TEST B') && this.elec.batt) {
      if (ft.active !== sw.fireTest) { ft.active = sw.fireTest; ft.t = 0; this.emit('fireTestStart', sw.fireTest); }
      ft.t += dt;
      if (ft.t > 9) {
        if (sw.fireTest === 'TEST A' && !ft.doneA) { ft.doneA = true; this.log('fireTestDone', { loop: 'A' }); }
        if (sw.fireTest === 'TEST B' && !ft.doneB) { ft.doneB = true; this.log('fireTestDone', { loop: 'B' }); }
        this.bleedValves = { L: false, R: false };
      }
    } else if (ft.active) {
      if (ft.t > 1.5) this.bleedValves = { L: false, R: false };
      ft.active = null; ft.t = 0; this.emit('fireTestStop');
    }

    // ---- INS ----
    const ins = this.ins;
    if (sw.ins !== ins.mode) {
      const prev = ins.mode; ins.mode = sw.ins;
      if (sw.ins === 'GND' && prev !== 'GND') { ins.alignT = 0; ins.aligned = false; ins.stdHdg = false; ins.stdHdgAvailable = true; ins.alignTotal = 480; }
    }
    const insPowered = this.elec.ac;
    if (insPowered && (ins.mode === 'GND' || ins.mode === 'CV')) {
      ins.alignT += dt;
      if (ins.alignT > 30) ins.stdHdgAvailable = false;
      const total = ins.alignTotal;
      const frac = Math.min(1, ins.alignT / total);
      ins.noAtt = ins.alignT < 12;
      ins.qual = Math.max(0.5, 10 - 9.5 * frac);
      if (frac >= 1 && !ins.aligned) { ins.aligned = true; this.log('insAligned', {}); }
    }
    this.ins.navMode = (ins.mode === 'NAV' || ins.mode === 'IFA') && ins.aligned ? (ins.mode === 'IFA' && ins.gps ? 'AINS' : 'INS') : null;

    // ---- FCS BIT ----
    if (this.fcs.bit === 'IN TEST') {
      this.fcs.bitT += dt;
      if (this.fcs.bitT > 40) { this.fcs.bit = 'GO'; this.fcs.bitDone = true; this.log('fcsBitGo', {}); }
    }

    // ---- IFF / D/L "hold ON" timers handled by UFC module ----
    // ---- HUD / radalt ----
    this.hudOn = this.elec.ac && sw.hudSymBrt > 0.05;
    this.radaltOn = this.elec.ac && sw.radaltIdx > 0;

    // ---- speed brake (HOTAS) ----
    const sbTarget = this.spdBrkCmd === 'EXT' && this.hyd.h1 > 1500 ? 1 : 0;
    this.speedBrake = approach(this.speedBrake, sbTarget, 0.5, dt);
    // ---- fuel ----
    if (this.scn) { this.fuelInt = Math.min(10950, this.scn.own.fuel); this.fuelTotal = this.scn.own.fuel; }
    else { const ff = (e.L.lit ? e.L.ff : 0) + (e.R.lit ? e.R.ff : 0); this.fuelInt = Math.max(0, this.fuelInt - ff / 3600 * dt); this.fuelTotal = this.fuelInt; }

    // ---- cautions & master caution ----
    const cur = this.cautions();
    for (const c of cur) if (!this.cautionsAck.has(c)) { this.masterCaution = true; }
    for (const c of [...this.cautionsAck]) if (!cur.includes(c)) this.cautionsAck.delete(c);

    this.emit('tick', dt);
  }

  // standby caution panel lights (battery powered) - right console
  cautionLights() {
    const b = this.elec.batt; if (!b) return {};
    const lt = this.sw.ltTest === 'TEST';
    const s = this.sw;
    const L = {
      'CK SEAT': s.seatArm === 'SAFE',
      'APU ACC': this.apu.everStarted && this.hyd.h2 < 2000,
      'BATT SW': !this.elec.genL && !this.elec.genR,
      'FCS HOT': false,
      'GEN TIE': s.genTie === 'RESET',
      'FUEL LO': false,
      'FCES': false,
      'L GEN': !this.elec.genL,
      'R GEN': !this.elec.genR,
    };
    if (lt) for (const k in L) L[k] = true;
    return L;
  }

  // warning lights (eyebrows)
  warningLights() {
    const lt = this.sw.ltTest === 'TEST' && this.elec.batt;
    const ft = this.fireTest.active && this.fireTest.t > 0.8 && this.elec.batt;
    return {
      'FIRE L': lt || ft, 'FIRE R': lt || ft, 'APU FIRE': lt || ft,
      'L BLEED': lt || ft, 'R BLEED': lt || ft,
      'MASTER CAUTION': lt || (this.masterCaution && this.elec.batt),
      'SPD BRK': lt || (this.speedBrake > 0.02 && this.elec.batt), 'STBY': lt, 'L BAR': lt, 'REC': lt, 'XMIT': lt, 'ASPJ OH': lt, 'GO': lt, 'NO GO': lt,
      'RCDR ON': lt, 'DISP': lt || (this.elec.ac && this.sw.dispenser !== 'OFF' && this.dispLow),
      'AI': lt || (this.elec.ac && this.rwrLt.AI), 'SAM': lt || (this.elec.ac && this.rwrLt.SAM), 'CW': lt || (this.elec.ac && this.rwrLt.CW), 'AAA': lt || (this.elec.ac && this.rwrLt.AAA),
      'READY': (this.apu.ready && this.elec.batt) || lt,
      'LOCK': lt || (this.elec.ac && this.lockLt), 'SHOOT': lt || (this.elec.ac && this.shootLt && (!this.shootFlash || (this.t * 4) % 2 < 1)),
      'GEAR N': this.elec.batt && (lt || this.gearDown()), 'GEAR L': this.elec.batt && (lt || this.gearDown()), 'GEAR R': this.elec.batt && (lt || this.gearDown()),
      'GEAR HDL': this.elec.batt && lt,
      'HALF FLAPS': this.elec.ac && (this.sw.flaps === 'HALF' || this.sw.flaps === 'FULL') || lt,
      'FULL FLAPS': this.elec.ac && this.sw.flaps === 'FULL' || lt,
      'FLAPS': lt,
      'SPN': lt,
    };
  }

  gearDown() { return !this.scn || this.scn.own.gear === 'DOWN'; }
  airborne() { return !!this.scn && !this.scn.own.wow; }

  // DDI caution list (lower-left of the left DDI / HUD)
  cautions() {
    if (!this.elec.ac && !this.elec.batt) return [];
    const c = [];
    const s = this.sw, e = this.eng;
    if (!this.elec.genL) c.push('L GEN');
    if (!this.elec.genR) c.push('R GEN');
    if (this.fcs.xs) c.push('FCS');
    if (this.hyd.h1 < 1500) { c.push('HYD 1A'); c.push('HYD 1B'); }
    if (this.hyd.h2 < 1500) { c.push('HYD 2A'); c.push('HYD 2B'); }
    if (!this.bleedValves.L) c.push('L BLD OFF');
    if (!this.bleedValves.R) c.push('R BLD OFF');
    if (this.canopyPos > 0.02 && (e.L.n2 > 50 || e.R.n2 > 50)) c.push('CANOPY');
    if (s.ins === 'OFF' && this.elec.ac) c.push('INS ATT');
    if (s.obogs === 'OFF' && this.elec.ac && (e.L.lit || e.R.lit)) c.push('OBOGS');
    if (s.antiSkid === 'OFF' && this.elec.ac) c.push('ANTI SKID');
    if (e.L.n2 > 1 && e.L.n2 < 55 && !e.L.lit && s.crank !== 'L') c.push('L AMAD PR');
    if (s.parkBrake === 'SET' && e.L.n2 > 80 && e.R.n2 > 80 && !this.airborne()) c.push('PARK BRK');
    if (this.bingo > 0 && this.fuelTotal < this.bingo) c.push('BINGO');
    if (this.fuelInt < 800 && this.elec.ac) c.push('FUEL LO');
    if (this.airborne() && this.sw.radar === 'OFF' && false) c.push('RDR');
    return c;
  }

  advisories() {
    if (!this.elec.ac) return [];
    const a = [];
    if (this.hyd.h1 < 1500 || this.hyd.h2 < 1500) { a.push('FLAPS OFF'); a.push('AIL OFF'); }
    if (this.sw.hookBypass === 'CARRIER') a.push('HOOK');
    if (this.sw.launchBar !== 'RETRACT') a.push('L BAR');
    if (this.apu.running) a.push('APU ON');
    if (this.speedBrake > 0.02) a.push('SPD BRK');
    if (this.laserOn) a.push('LASER');
    return a;
  }
}
