// AN/APG-73 radar model (A/A RWS / TWS / VS / STT / ACM, A/G MAP / GMT / SEA), DCS-style HOTAS logic.
import { NM, FT, wrap180 } from './scenario.js';

export const AZ_OPTS = [20, 40, 60, 80, 140];
export const BAR_OPTS = [1, 2, 4, 6];
export const RNG_OPTS = [5, 10, 20, 40, 80, 160];
export const PRF_OPTS = ['MED', 'HI', 'INTL'];

export class Radar {
  constructor(sim, scn) {
    this.sim = sim; this.scn = scn;
    this.reset();
  }
  reset() {
    Object.assign(this, {
      mode: 'RWS', prevSearch: 'RWS', acm: null, az: 140, bars: 4, rng: 40, prf: 'INTL', elev: 0, ltws: true, msi: true,
      raid: false, twsCenter: 'AUTO', sil: false, scanAz: 0, scanDir: 1, bar: 0,
      cursor: { az: 0, rng: 20 }, tracks: new Map(), hits: [], ls: null, dt2: null, stt: null, sttLostT: 0,
      agMode: 'MAP', agRng: 20, agCursor: { az: 0, rng: 10 }, agDesig: null, dataPage: false, frameT: 0,
    });
  }
  get transmitting() { const s = this.sim; return s.elec.ac && s.sw.radar === 'OPR' && !this.scn.own.wow && !this.sil && !this.sim.ufcEmcon; }
  get powered() { return this.sim.elec.ac && (this.sim.sw.radar === 'OPR' || this.sim.sw.radar === 'STBY'); }

  // ---------------------------------------------------------------- detection model
  rDet(c, rel) {
    // detection range (m) vs RCS (fourth-root law), PRF and aspect; look-down penalty
    const base = 48 * NM * Math.pow(c.rcs / 5, 0.25);
    const hot = Math.abs(rel.aspect) < 60, tail = Math.abs(rel.aspect) > 120;
    let k = this.prf === 'HI' ? (hot ? 1.0 : tail ? 0.35 : 0.55) : this.prf === 'MED' ? 0.7 : (hot ? 0.95 : 0.75);
    if (rel.du < -1500 && this.prf === 'HI') k *= 0.8;
    return base * k;
  }
  notched(rel) { return Math.abs(rel.vc) < 70 && rel.du < 1000 && Math.abs(Math.abs(rel.aspect) - 90) < 25; }

  elevCoverage() {      // degrees covered above/below antenna centre
    const spacing = this.bars <= 2 ? 2.0 : 1.3;
    const half = ((this.bars - 1) * spacing + 3.3) / 2;
    return [this.elev - half, this.elev + half];
  }

  scanVolume() {
    if (this.mode === 'ACM') {
      const m = this.acm;
      if (m === 'BST') return { az: [-1.7, 1.7], el: [-1.7 - 0, 1.7], rng: 10 };
      if (m === 'VACQ') return { az: [-3.5, 3.5], el: [-13, 46], rng: 5 };
      if (m === 'WACQ') return { az: [-30, 30], el: [-10, 10], rng: 10 };
      if (m === 'GACQ') return { az: [-10, 10], el: [-14, 6], rng: 5 };
    }
    let az = this.az, c = 0;
    if (this.mode === 'TWS') {
      if (this.raid) az = 22;
      else if (this.bars === 4) az = Math.min(az, 40); else if (this.bars === 6) az = 20;
      if (this.twsCenter === 'AUTO' && this.ls && this.tracks.get(this.ls)) c = this.tracks.get(this.ls).az;
      else c = this.cursor.az;
      c = Math.max(-70 + az / 2, Math.min(70 - az / 2, c));
    }
    const [e0, e1] = this.elevCoverage();
    return { az: [c - az / 2, c + az / 2], el: [e0, e1], rng: 999 };
  }

  // ---------------------------------------------------------------- update
  step(dt) {
    const scn = this.scn;
    this.frameT += dt;
    if (!this.powered) { this.stt = null; return; }
    const tx = this.transmitting;
    // antenna sweep (deg/s)
    const vol = this.scanVolume();
    const rate = this.mode === 'ACM' ? 120 : 70;
    if (this.mode !== 'STT') {
      this.scanAz += this.scanDir * rate * dt;
      if (this.scanAz > vol.az[1]) { this.scanAz = vol.az[1]; this.scanDir = -1; this.bar = (this.bar + 1) % this.bars; }
      if (this.scanAz < vol.az[0]) { this.scanAz = vol.az[0]; this.scanDir = 1; this.bar = (this.bar + 1) % this.bars; }
    }
    const now = this.frameT;
    // age raw hits / tracks
    this.hits = this.hits.filter(h => now - h.t < (this.mode === 'RWS' ? 6 : 3));
    for (const [id, t] of this.tracks) {
      if (now - t.lastHit > 8 || !t.c.alive) { this.tracks.delete(id); if (this.ls === id) this.ls = null; if (this.dt2 === id) this.dt2 = null; }
      else if (now - t.lastHit > 3) t.memory = true;
    }
    if (!tx) return;
    // ---- STT
    if (this.mode === 'STT' && this.stt) {
      const c = this.stt, rel = scn.rel(c);
      const ok = c.alive && Math.abs(rel.az) < 60 && Math.abs(rel.el) < 60 && rel.slant < this.rDet(c, rel) * 1.3 && !(this.notched(rel) && Math.random() < dt * 0.6);
      if (ok) { this.sttLostT = 0; this.updTrack(c, rel, now, true); this.scanAz = rel.az; }
      else { this.sttLostT += dt; if (this.sttLostT > 2) this.breakLock(); }
      return;
    }
    for (const c of scn.contacts) {
      if (!c.alive || c.kind !== 'air') continue;
      const rel = scn.rel(c);
      if (rel.az < vol.az[0] - 2 || rel.az > vol.az[1] + 2) continue;
      if (rel.el < vol.el[0] - 1.6 || rel.el > vol.el[1] + 1.6) continue;
      // beam passing the target this frame?
      if (Math.abs(rel.az - this.scanAz) > rate * dt + 1.8) continue;
      const rmax = Math.min(this.rDet(c, rel), (this.mode === 'ACM' ? vol.rng : 999) * NM);
      if (rel.slant > rmax) continue;
      if (this.mode !== 'VS' && this.notched(rel)) continue;
      if (this.mode === 'VS' && rel.vc < 0) continue;
      const pd = 0.9 - 0.5 * (rel.slant / rmax);
      if (Math.random() > pd) continue;
      if (this.mode === 'ACM') { this.lock(c); return; }
      this.hits = this.hits.filter(h => h.c !== c);
      this.hits.push({ c, az: rel.az, rng: rel.rngNm, vc: rel.vc, alt: c.alt, t: now });
      if (this.mode === 'TWS' || (this.mode === 'RWS' && this.ltws)) this.updTrack(c, rel, now, false);
    }
    // TWS: limit to 10 ranked trackfiles, auto L&S
    if (this.mode === 'TWS') {
      const ranked = [...this.tracks.values()].sort((a, b) => a.rng - b.rng);
      ranked.forEach((t, i) => { t.rank = i + 1; if (i >= 10) this.tracks.delete(t.c.id); });
      if (!this.ls && ranked.length) this.ls = ranked[0].c.id;
    }
  }

  updTrack(c, rel, now, stt) {
    let t = this.tracks.get(c.id);
    if (!t) { t = { c, first: now }; this.tracks.set(c.id, t); }
    Object.assign(t, { az: rel.az, el: rel.el, rng: rel.rngNm, alt: c.alt, hdg: c.hdg, aspect: rel.aspect, vc: rel.vc, mach: (c.tas || 0) / 600, lastHit: now, memory: false, hostile: c.hostile, stt });
  }

  lock(c) {
    if (this.mode !== 'STT' && this.mode !== 'ACM') this.prevSearch = this.mode;
    this.wasAcm = this.mode === 'ACM' ? this.acm : this.wasAcm;
    this.mode = 'STT'; this.stt = c; this.sttLostT = 0;
    const rel = this.scn.rel(c); this.updTrack(c, rel, this.frameT, true);
    this.ls = c.id; this.sim.log('radarLock', { id: c.id, type: c.type });
    this.scn.emit('lock', c);
  }
  breakLock() {
    const c = this.stt; this.stt = null;
    this.mode = this.wasAcm ? 'ACM' : this.prevSearch; if (this.mode === 'ACM') this.acm = this.wasAcm;
    this.sim.log('radarLockLost', { id: c && c.id });
  }

  // ---------------------------------------------------------------- HOTAS / OSB
  tdcSlew(dx, dy, dt) {   // dx: right +, dy: up +  (per second, -1..1)
    const k = 60 * dt;
    if (this.mode === 'ACM' && this.acm === 'WACQ') return;
    this.cursor.az = Math.max(-70, Math.min(70, this.cursor.az + dx * k));
    this.cursor.rng += dy * this.rng * 0.6 * dt;
    if (this.cursor.rng > this.rng * 0.98) { const i = RNG_OPTS.indexOf(this.rng); if (i < RNG_OPTS.length - 1) { this.rng = RNG_OPTS[i + 1]; this.cursor.rng = this.rng * 0.55; } else this.cursor.rng = this.rng * 0.98; }
    if (this.cursor.rng < this.rng * 0.02) { const i = RNG_OPTS.indexOf(this.rng); if (i > 0) { this.rng = RNG_OPTS[i - 1]; this.cursor.rng = this.rng * 0.45; } else this.cursor.rng = this.rng * 0.02; }
  }
  underCursor() {
    let best = null, bd = 1e9;
    const items = this.mode === 'TWS' || this.ltws ? [...this.tracks.values()] : [];
    for (const h of this.hits) if (!items.find(t => t.c === h.c)) items.push(h);
    for (const t of items) {
      const d = Math.hypot((t.az - this.cursor.az) / 140 * 1.0, (t.rng - this.cursor.rng) / this.rng);
      if (d < 0.06 && d < bd) { bd = d; best = t; }
    }
    return best;
  }
  tdcDepress() {
    if (!this.transmitting) return;
    const t = this.underCursor();
    if (!t) return;
    const id = t.c.id;
    if (!this.tracks.get(id)) this.updTrack(t.c, this.scn.rel(t.c), this.frameT, false);
    if (this.ls === id) { this.lock(t.c); return; }                          // second designation -> STT
    if (this.mode === 'RWS' && !this.ltws) { this.lock(t.c); return; }
    if (this.dt2 === id) { this.dt2 = this.ls; this.ls = id; return; }      // swap
    if (this.ls) this.dt2 = id; else this.ls = id;
    this.sim.log('radarDesig', { id });
  }
  undesignate() {
    if (this.mode === 'STT') { this.breakLock(); return; }
    if (this.mode === 'ACM') { this.mode = this.prevSearch; this.acm = null; this.wasAcm = null; return; }
    if (this.dt2) { const a = this.ls; this.ls = this.dt2; this.dt2 = a; return; }
    const ranked = [...this.tracks.values()].sort((a, b) => a.rng - b.rng).map(t => t.c.id);
    if (ranked.length) { const i = ranked.indexOf(this.ls); this.ls = ranked[(i + 1) % ranked.length]; }
  }
  scs(dir, tdcOnRadar) {
    // Sensor Control Switch while in A/A master mode
    if (dir === 'fwd') { if (this.mode !== 'ACM') { if (this.mode !== 'STT') this.prevSearch = this.mode; } this.stt = null; this.mode = 'ACM'; this.acm = 'BST'; this.wasAcm = null; return 'ACM'; }
    if (this.mode === 'ACM' && dir === 'aft') { this.acm = 'VACQ'; return 'ACM'; }
    if (this.mode === 'ACM' && dir === 'left') { this.acm = 'WACQ'; return 'ACM'; }
    if (dir === 'toward' && tdcOnRadar) {
      if (this.mode === 'RWS') this.mode = 'TWS';
      else if (this.mode === 'TWS' && this.ls && this.tracks.get(this.ls)) this.lock(this.tracks.get(this.ls).c);
    }
    return null;
  }
  gunSelected(on) {
    if (on) { if (this.mode !== 'ACM' && this.mode !== 'STT') this.prevSearch = this.mode; if (this.mode !== 'STT') { this.mode = 'ACM'; this.acm = 'GACQ'; } }
    else if (this.mode === 'ACM' && this.acm === 'GACQ') { this.mode = this.prevSearch; this.acm = null; }
  }
  cycle(what) {
    const nxt = (arr, v) => arr[(arr.indexOf(v) + 1) % arr.length];
    if (what === 'mode') { if (this.mode === 'STT' || this.mode === 'ACM') return; this.mode = nxt(['RWS', 'TWS', 'VS'], this.mode); if (this.mode === 'TWS' && this.bars === 1) this.bars = 2; }
    if (what === 'az') this.az = nxt(AZ_OPTS, this.az);
    if (what === 'bars') this.bars = nxt(BAR_OPTS, this.bars);
    if (what === 'prf') this.prf = nxt(PRF_OPTS, this.prf);
    if (what === 'rngUp') { const i = RNG_OPTS.indexOf(this.rng); if (i < RNG_OPTS.length - 1) this.rng = RNG_OPTS[i + 1]; }
    if (what === 'rngDn') { const i = RNG_OPTS.indexOf(this.rng); if (i > 0) this.rng = RNG_OPTS[i - 1]; }
    if (what === 'sil') this.sil = !this.sil;
    if (what === 'erase') { this.hits = []; if (this.mode === 'RWS') this.tracks.clear(); }
    if (what === 'raid') this.raid = !this.raid;
    if (what === 'auto') this.twsCenter = 'AUTO';
    if (what === 'man') this.twsCenter = 'MAN';
    if (what === 'ltws') this.ltws = !this.ltws;
    if (what === 'msi') this.msi = !this.msi;
    if (what === 'data') this.dataPage = !this.dataPage;
    if (what === 'rts') { if (this.mode === 'ACM') { this.mode = this.prevSearch; this.acm = null; } }
  }
  elevSlew(d, dt) { this.elev = Math.max(-60, Math.min(60, this.elev + d * 20 * dt)); }

  // L&S target data for HUD / weapons
  lsTrack() { const t = this.stt ? this.tracks.get(this.stt.id) : (this.ls ? this.tracks.get(this.ls) : null); return t || null; }
}
