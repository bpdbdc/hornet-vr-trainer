// ALR-67 RWR, ALE-47 countermeasures, ALQ-165 ECM and hostile missile shots.
import { NM, FT, KT, wrap180 } from './scenario.js';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export class EW {
  constructor(sim, scn) {
    this.sim = sim; this.scn = scn;
    this.reset();
  }
  reset() {
    this.threats = []; this.known = new Set(); this.threatMissiles = [];
    this.chaff = 60; this.flare = 60; this.program = 1; this.cmMode = 'MAN';
    this.limit = false; this.offset = false; this.hitT = -1; this.lastLaunchT = {};
    this.cues = { newT: 0, lock: false, launch: false };
  }
  powered() { return this.sim.elec.ac && this.sim.sw.rwrPwr; }

  step(dt) {
    const scn = this.scn, o = scn.own, s = this.sim;
    const out = [];
    const xmit = s.sw.ecm === 'XMIT' && s.elec.ac;
    for (const c of scn.contacts) {
      if (!c.alive || !c.radarOn || !c.def.rwr) continue;
      const r = scn.rel(c);
      let detect = 0, lethal = 0;
      if (c.kind === 'air') { detect = 60 * NM; lethal = (xmit ? 14 : 22) * NM; }
      else { detect = (c.def.range || 10 * NM) * 2.2; lethal = c.def.range * (xmit ? 0.7 : 1); }
      if (r.slant > detect || o.wow) continue;
      // emitter pointing at us?
      let state = 'search';
      if (c.kind === 'air' && c.hostile && r.slant < lethal && Math.abs(r.aspect) < 60) state = 'lock';
      if (c.kind !== 'air' && r.slant < lethal * 1.2 && o.alt < 40000) state = 'lock';
      if (this.threatMissiles.find(m => m.src === c && !m.done && m.guide)) state = 'launch';
      const sym = c.def.rwr;
      const prio = state === 'launch' ? 3 : state === 'lock' ? 2 : 1;
      out.push({ c, sym, az: r.az, rng: r.rngNm, state, prio, friendly: !c.hostile, lethal: r.slant < lethal });
      // hostile shots: SAMs and fighters fire when locked inside their envelope
      if (c.hostile && state === 'lock' && (c.def.sam || c.kind === 'air') && !this.threatMissiles.find(m => m.src === c && !m.done)) {
        const last = this.lastLaunchT[c.id] || -99;
        const shootR = c.kind === 'air' ? 14 * NM : c.def.range * 0.85;
        if (r.slant < shootR && scn.t - last > (c.kind === 'air' ? 40 : 30) && scn.t > 20) {
          this.lastLaunchT[c.id] = scn.t;
          this.threatMissiles.push({ src: c, e: c.e, n: c.n, alt: c.alt + 50, spd: c.kind === 'air' ? 700 : 900, t: 0, guide: true, ir: false, pk: c.kind === 'air' ? 0.55 : 0.6 });
          s.log('threatLaunch', { from: c.type });
        }
      }
      if (c.def.aaa && r.slant < c.def.range && o.alt < 8000 && Math.random() < dt * 0.02) { this.hit(c.type); }
    }
    out.sort((a, b) => b.prio - a.prio || a.rng - b.rng);
    const newOnes = out.filter(t => !this.known.has(t.c.id));
    if (newOnes.length && this.powered()) this.cues.newT = s.t;
    this.known = new Set(out.map(t => t.c.id));
    this.threats = out;
    this.cues.lock = this.powered() && out.some(t => t.state === 'lock' && !t.friendly);
    this.cues.launch = this.powered() && out.some(t => t.state === 'launch');
    // hostile missiles
    for (const m of this.threatMissiles) {
      if (m.done) continue;
      m.t += dt;
      const de = o.e - m.e, dn = o.n - m.n, du = (o.alt - m.alt) * FT;
      const d = Math.hypot(de, dn, du);
      if (m.guide && !m.decoyed) {
        m.e += de / d * m.spd * dt; m.n += dn / d * m.spd * dt; m.alt += du / d * m.spd * dt / FT;
      } else { m.alt -= 300 * dt; }
      if (d < 80 && !m.decoyed) {
        m.done = true;
        let pk = m.pk;
        if (m.chaffUsed) pk *= 0.45;
        if (Math.abs(o.roll) > 50) pk *= 0.6;
        if (Math.random() < pk) this.hit(m.src.type); else s.log('threatMiss', { from: m.src.type });
      }
      if (m.t > 40) m.done = true;
    }
    this.threatMissiles = this.threatMissiles.filter(m => !m.done || m.t < 1);
  }

  hit(by) {
    if (this.sim.t - this.hitT < 5) return;
    this.hitT = this.sim.t; this.sim.log('ownshipHit', { by });
    this.scn.emit('ownHit', by);
  }

  dispense(kind) {       // 'prog' (chaff+flare) | 'flare'
    const s = this.sim;
    if (!s.elec.ac || s.sw.dispenser === 'OFF') return;
    const nC = kind === 'flare' ? 0 : (s.sw.dispenser === 'BYPASS' ? 1 : 2);
    const nF = s.sw.dispenser === 'BYPASS' ? 1 : (kind === 'flare' ? 2 : 1);
    if (nC) { const k = Math.min(this.chaff, nC); this.chaff -= k; if (k) for (const m of this.threatMissiles) if (!m.done && !m.ir && Math.random() < 0.5) m.chaffUsed = true; }
    if (nF) { const k = Math.min(this.flare, nF); this.flare -= k; if (k) for (const m of this.threatMissiles) if (!m.done && m.ir && Math.random() < 0.6) m.decoyed = true; }
    s.log('dispense', { kind, chaff: this.chaff, flare: this.flare });
    this.scn.emit('dispense', kind);
  }

  visibleThreats() {
    const typ = this.sim.sw.rwrDis || 'N';
    let t = this.threats;
    if (typ === 'F') t = t.filter(x => x.friendly);
    else if (typ === 'A') t = t.filter(x => x.c.def.aaa);
    else if (typ === 'I') t = t.filter(x => x.c.kind === 'air');
    else t = t.filter(x => !x.friendly || typ === 'U');
    return this.limit ? t.slice(0, 6) : t.slice(0, 16);
  }
}
