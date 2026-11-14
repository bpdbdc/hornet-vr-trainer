// Tactical DDI pages (radar, AZ/EL, STORES, EW, SA, FLIR, MAV, HUD repeater) added to the DDI class.
import { DDI, osbPos } from './ddi.js';
import { NM, FT, wrap180, wrap360 } from './scenario.js';
import { WPN } from './weapons.js';

const S = 512, G = '#43ff43', GD = '#1d8f1d', Y = '#ffe24a';
const P = DDI.prototype;

// ---------------------------------------------------------------- shared symbols
P.hafu = function (x, y, kind, opts = {}) {
  const c = this.ctx; c.strokeStyle = opts.color || G; c.lineWidth = 2;
  c.beginPath();
  if (kind === 'hostile') { c.moveTo(x - 9, y + 4); c.lineTo(x, y - 8); c.lineTo(x + 9, y + 4); }
  else if (kind === 'friendly') { c.arc(x, y + 3, 9, Math.PI, 0); }
  else { c.moveTo(x - 8, y + 4); c.lineTo(x - 8, y - 6); c.lineTo(x + 8, y - 6); c.lineTo(x + 8, y + 4); }
  c.stroke();
  if (opts.ls) { this.star(x, y - 1, 5); }
  if (opts.dt2) { c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 5, y - 1); c.lineTo(x, y + 4); c.lineTo(x - 5, y - 1); c.closePath(); c.stroke(); }
  if (opts.vec !== undefined) { const a = opts.vec * Math.PI / 180; this.line(x, y - 8, x + Math.sin(a) * 18, y - 8 - Math.cos(a) * 18, opts.color || G, 2); }
};
P.star = function (x, y, r) {
  const c = this.ctx; c.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath(); c.fillStyle = G; c.fill();
};

// ---------------------------------------------------------------- RADAR ATTACK
const BX0 = 74, BX1 = 438, BY0 = 70, BY1 = 434;
P.p_RDRATTK = function () {
  const k = this.k; if (!k) return this.p_PLACEHOLDER();
  if (k.wpn.master === 'AG') return this.rdrAG();
  const r = k.radar, s = this.sim;
  const X = (az) => BX0 + (az + 70) / 140 * (BX1 - BX0);
  const Yr = (rng) => BY1 - Math.min(1, rng / r.rng) * (BY1 - BY0);
  this.rect(BX0, BY0, BX1 - BX0, BY1 - BY0, G, 1.5);
  for (const a of [-60, -30, 30, 60]) this.line(X(a), BY1, X(a), BY1 - 12, G, 2);
  for (let q = 1; q < 4; q++) { const y = BY0 + q * (BY1 - BY0) / 4; this.line(BX0, y, BX0 + 10, y, G, 2); this.line(BX1 - 10, y, BX1, y, G, 2); }
  const status = !r.powered ? 'OFF' : s.sw.radar === 'STBY' ? 'STBY' : r.sil ? 'SIL' : r.scn.own.wow ? 'OPR' : 'OPR';
  this.txt(status, 40, 40, { size: 16 });
  this.txt(String(r.rng), 470, 70, { size: 18, align: 'right' });
  this.osb(11, '↑'); this.osb(12, '↓');
  const modeLbl = r.mode === 'STT' ? (r.prevSearch) : r.mode === 'ACM' ? 'ACM' : r.mode;
  this.osb(1, modeLbl, { horizontal: true, box: r.mode === 'ACM' });
  if (r.mode === 'ACM') this.osb(2, 'RTS', { horizontal: true });
  this.osb(5, r.prf, { horizontal: true });
  this.osb(7, `${r.bars}B`); this.osb(8, 'SIL', { box: r.sil }); this.osb(9, 'ERASE');
  this.osb(19, `${r.az}°`); this.osb(20, 'MODE'); this.osb(16, 'DATA', { box: r.dataPage });
  if (r.mode === 'TWS') { this.osb(13, 'AUTO', { box: r.twsCenter === 'AUTO', horizontal: true }); this.osb(14, 'MAN', { box: r.twsCenter === 'MAN', horizontal: true }); this.osb(15, 'RAID', { box: r.raid, horizontal: true }); }
  if (r.dataPage) { this.osb(13, 'LTWS', { box: r.ltws, horizontal: true }); this.osb(14, 'MSI', { box: r.msi, horizontal: true }); }
  this.menuOsb();
  if (!r.powered) return;
  // elevation caret (left) and B-sweep
  const ey = (BY0 + BY1) / 2 - r.elev / 60 * (BY1 - BY0) / 2;
  this.line(BX0 - 18, ey, BX0 - 6, ey, G, 3);
  if (r.transmitting) this.line(X(r.scanAz), BY1, X(r.scanAz), BY1 - 22, G, 3);
  // scan limits
  const vol = r.scanVolume(); this.line(X(vol.az[0]), BY1, X(vol.az[0]), BY1 + 8, G, 2); this.line(X(vol.az[1]), BY1, X(vol.az[1]), BY1 + 8, G, 2);
  // hits / trackfiles
  for (const h of r.hits) { if (r.tracks.get(h.c.id) && (r.mode === 'TWS' || r.ltws)) continue; const x = X(h.az), y = Yr(h.rng); this.ctx.fillStyle = G; this.ctx.fillRect(x - 6, y - 3, 12, 6); }
  for (const t of r.tracks.values()) {
    if (r.mode === 'RWS' && !r.ltws) continue;
    const x = X(t.az), y = Yr(t.rng);
    const kind = t.c.hostile ? 'hostile' : (t.c.link16 ? 'friendly' : 'unknown');
    const vec = wrap180(t.hdg - r.scn.own.hdg);
    this.hafu(x, y, kind, { ls: r.ls === t.c.id, dt2: r.dt2 === t.c.id, vec });
    if (r.ls === t.c.id || r.dt2 === t.c.id || r.mode === 'TWS') { this.txt((t.mach).toFixed(1).replace(/^0/, ''), x - 14, y + 12, { size: 13, align: 'right' }); this.txt(String(Math.round(t.alt / 1000)), x + 14, y + 12, { size: 13 }); }
  }
  // acquisition cursor + altitude coverage
  if (r.mode !== 'STT' && r.mode !== 'ACM' && this.hasTdc) {
    const x = X(r.cursor.az), y = Yr(r.cursor.rng);
    this.line(x - 6, y - 10, x - 6, y + 10, G, 2); this.line(x + 6, y - 10, x + 6, y + 10, G, 2);
    const [e0, e1] = r.elevCoverage(); const o = r.scn.own, rngFt = r.cursor.rng * 6076;
    const top = Math.round((o.alt + Math.tan(e1 * Math.PI / 180) * rngFt) / 1000), bot = Math.round((o.alt + Math.tan(e0 * Math.PI / 180) * rngFt) / 1000);
    this.txt(String(top), x + 12, y - 12, { size: 13 }); this.txt(String(bot), x + 12, y + 14, { size: 13 });
  }
  // STT data + DLZ
  const trk = r.lsTrack();
  if (r.mode === 'STT' && trk) {
    const asp = Math.round(Math.abs(trk.aspect) / 10);
    this.txt(`${asp}${trk.aspect > 0 ? 'R' : 'L'}`, 110, 92, { size: 16 }); this.txt(`${Math.round(trk.vc)}`, 400, 92, { size: 16, align: 'right' });
    this.txt(`${trk.mach.toFixed(2)}M ${Math.round(trk.alt / 1000)}K  ${trk.rng.toFixed(1)}NM`, S / 2, 455, { size: 15, align: 'center' });
  }
  if (r.mode === 'ACM') this.txt(r.acm, S / 2, 455, { size: 18, align: 'center', box: true });
  const sel = k.wpn.aaSel;
  if (trk && sel && sel !== 'GUN') {
    const z = k.wpn.dlz(sel, trk);
    if (z) {
      const sc = r.rng, Yz = (v) => BY1 - Math.min(1, v / sc) * (BY1 - BY0), x = 455;
      this.line(x, Yz(z.rmax), x, Yz(z.rmin), G, 2);
      this.line(x, Yz(z.rmax), x + 10, Yz(z.rmax), G, 2); this.line(x, Yz(z.rne), x + 10, Yz(z.rne), G, 2); this.line(x, Yz(z.rmin), x + 10, Yz(z.rmin), G, 2);
      this.line(x - 4, Yz(trk.rng), x - 16, Yz(trk.rng) - 6, G, 2); this.line(x - 4, Yz(trk.rng), x - 16, Yz(trk.rng) + 6, G, 2);
    }
  }
  // own speed / alt in 5 NM scale
  if (r.rng === 5) this.txt(`${Math.round(r.scn.own.cas)}  ${Math.round(r.scn.own.alt)}`, S / 2, 110, { size: 14, align: 'center' });
};

P.rdrAG = function () {
  const k = this.k, r = k.radar, s = this.sim, c = this.ctx, o = k.scn.own;
  this.osb(1, r.agMode, { horizontal: true }); this.osb(11, '↑'); this.osb(12, '↓'); this.osb(20, 'MODE');
  this.txt(String(r.agRng), 470, 70, { size: 18, align: 'right' }); this.menuOsb();
  if (!r.powered) return;
  // PPI sector
  const cx = S / 2, cy = 440, R = 370;
  c.save(); c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, -Math.PI / 2 - 1.05, -Math.PI / 2 + 1.05); c.closePath(); c.clip();
  if (r.transmitting) {
    // ground texture (deterministic noise) + returns
    const seed = Math.floor(o.e / 2000) * 31 + Math.floor(o.n / 2000) * 17;
    for (let i = 0; i < 900; i++) {
      const a = ((i * 97 + seed) % 1000) / 1000, b = ((i * 61 + seed * 3) % 1000) / 1000;
      const rr = Math.sqrt(b) * R, an = -Math.PI / 2 + (a - 0.5) * 2.1;
      c.fillStyle = `rgba(67,255,67,${0.05 + 0.15 * ((i * 13) % 7) / 7})`; c.fillRect(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr, 4, 4);
    }
    for (const t of k.scn.contacts) {
      if (!t.alive || t.kind === 'air') continue;
      const rel = k.scn.rel(t); if (rel.rngNm > r.agRng) continue;
      if (r.agMode === 'GMT' && !(t.tas > 5)) continue;
      if (r.agMode === 'SEA' && t.kind !== 'sea') continue;
      const rr = rel.rngNm / r.agRng * R, an = (rel.az - 90) * Math.PI / 180;
      c.fillStyle = G; c.fillRect(cx + Math.cos(an) * rr - 3, cy + Math.sin(an) * rr - 3, t.rcs > 20 ? 8 : 5, t.rcs > 20 ? 8 : 5);
    }
  }
  c.restore();
  c.strokeStyle = G; c.lineWidth = 2; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, -Math.PI / 2 - 1.05, -Math.PI / 2 + 1.05); c.closePath(); c.stroke();
  // cursor
  const cr = r.agCursor.rng / r.agRng * R, ca = (r.agCursor.az - 90) * Math.PI / 180;
  const x = cx + Math.cos(ca) * cr, y = cy + Math.sin(ca) * cr;
  if (this.hasTdc) { this.line(x - 12, y, x + 12, y, G, 2); this.line(x, y - 12, x, y + 12, G, 2); }
  if (s.agTarget) {
    const rel = k.scn.rel({ e: s.agTarget.e, n: s.agTarget.n, alt: 0, hdg: 0, tas: 0 });
    const tr = rel.rngNm / r.agRng * R, ta = (rel.az - 90) * Math.PI / 180, tx = cx + Math.cos(ta) * tr, ty = cy + Math.sin(ta) * tr;
    c.beginPath(); c.moveTo(tx, ty - 9); c.lineTo(tx + 9, ty); c.lineTo(tx, ty + 9); c.lineTo(tx - 9, ty); c.closePath(); c.stroke();
    this.txt(`${rel.rngNm.toFixed(1)}NM ${Math.round(rel.brg)}°`, S / 2, 470, { size: 15, align: 'center' });
  }
};

// ---------------------------------------------------------------- AZ/EL
P.p_AZEL = function () {
  const k = this.k; if (!k) return this.p_PLACEHOLDER();
  const r = k.radar;
  this.rect(76, 96, 360, 300, G, 1.5);
  for (const a of [-60, -30, 0, 30, 60]) this.line(256 + a * 2.5, 396, 256 + a * 2.5, 386, G, 2);
  this.txt('AZ/EL', S / 2, 80, { size: 18, align: 'center' }); this.osb(6, 'RDR', { box: true }); this.osb(7, 'FLIR');
  for (const t of r.tracks.values()) { const x = 256 + t.az * 2.5, y = 246 - t.el * 5; this.hafu(x, y, t.c.hostile ? 'hostile' : 'unknown', { ls: r.ls === t.c.id }); }
  const [e0, e1] = r.elevCoverage(); const v = r.scanVolume();
  this.rect(256 + v.az[0] * 2.5, 246 - e1 * 5, (v.az[1] - v.az[0]) * 2.5, (e1 - e0) * 5, GD, 1.5);
  this.menuOsb();
};

// ---------------------------------------------------------------- STORES (SMS)
P.p_STORES = function () {
  const k = this.k; if (!k) return this.p_PLACEHOLDER();
  const w = k.wpn, c = this.ctx;
  // planform
  c.strokeStyle = G; c.lineWidth = 2; c.beginPath();
  c.moveTo(256, 150); c.lineTo(276, 250); c.lineTo(420, 300); c.lineTo(420, 318); c.lineTo(280, 312); c.lineTo(276, 380); c.lineTo(236, 380); c.lineTo(232, 312); c.lineTo(92, 318); c.lineTo(92, 300); c.lineTo(236, 250); c.closePath(); c.stroke();
  const pos = { 1: [92, 285], 2: [140, 300], 3: [190, 300], 4: [226, 345], 5: [256, 360], 6: [286, 345], 7: [322, 300], 8: [372, 300], 9: [420, 285] };
  for (let i = 1; i <= 9; i++) {
    const s = w.stations[i]; if (!s) continue;
    const [x, y] = pos[i];
    const sel = (w.master === 'AA' && w.aaStation === i && w.aaSel) || (w.master === 'AG' && w.agSel === i);
    const lbl = s.qty ? s.def.short : '';
    this.txt(lbl, x, y + (i === 5 ? 34 : 30), { size: 13, align: 'center', box: sel });
  }
  const arm = w.armed() ? (this.sim.masterArmSim ? 'SIM' : 'ARM') : 'SAFE';
  this.txt(arm, S / 2, 120, { size: 20, align: 'center', box: true });
  this.osb(4, 'SIM', { box: this.sim.masterArmSim, horizontal: true });
  if (w.master === 'AA') {
    this.txt(`GUN ${w.gun.rounds}`, S / 2, 210, { size: 16, align: 'center', box: w.aaSel === 'GUN' });
    this.osb(17, w.gun.rate === 'HIGH' ? 'HIGH' : 'LOW');
    if (w.aaSel && WPN[w.aaSel]?.seeker === 'IR') this.osb(12, 'COOL', { horizontal: true, box: this.sim.sw.irCool !== 'OFF' });
    this.txt('A/A', 60, 450, { size: 16 });
  } else if (w.master === 'AG') {
    const types = []; for (let i = 1; i <= 9; i++) { const s = w.stations[i]; if (s && s.qty && s.def.cat === 'AG' && !types.find(t => t.type === s.type)) types.push({ type: s.type, st: i }); }
    types.slice(0, 5).forEach((t, j) => this.osb(6 + j, WPN[t.type].short, { box: w.agDef() && w.agDef().type === t.type }));
    const d = w.agDef();
    if (d) {
      const tp = d.def.type;
      if (tp === 'bomb' || tp === 'lgb') { this.osb(11, w.ag.mode, { horizontal: true }); this.osb(12, w.ag.fuze, { horizontal: true }); this.osb(13, `QTY ${w.ag.qty}`, { horizontal: true }); }
      if (tp === 'lgb') this.osb(14, `CODE ${w.ag.lgbCode}`, { horizontal: true });
      if (tp === 'jdam') { this.osb(11, w.ag.jdamMode, { horizontal: true }); const al = Math.max(0, 30 - (this.sim.t - w.ag.jdamAlignT)); this.txt(al > 0 ? `ALN ${Math.ceil(al)}` : 'RDY', S / 2, 420, { size: 16, align: 'center' }); }
      if (tp === 'mav') { this.osb(11, w.ag.mavCaged ? 'CAGE' : 'UNCG', { horizontal: true }); }
      if (tp === 'harm') { this.osb(11, w.ag.harmMode, { horizontal: true }); }
    }
    this.txt('A/G', 60, 450, { size: 16 });
  } else this.txt('NAV', 60, 450, { size: 16 });
  this.menuOsb();
};

// ---------------------------------------------------------------- EW
P.p_EW = function () {
  const k = this.k; if (!k) return this.p_PLACEHOLDER();
  const ew = k.ew, s = this.sim, c = this.ctx;
  this.txt('ASPJ', 70, 64, { size: 15 }); this.txt(s.sw.ecm, 70, 82, { size: 15 });
  this.txt('EW', S / 2, 64, { size: 16, align: 'center' });
  this.txt('ALE-47', 430, 64, { size: 15, align: 'center' }); this.txt(s.sw.dispenser === 'OFF' ? 'OFF' : ew.cmMode, 430, 82, { size: 15, align: 'center' });
  const cx = S / 2, cy = 270;
  c.strokeStyle = G; c.lineWidth = 2;
  [60, 120, 175].forEach(rr => { c.beginPath(); c.arc(cx, cy, rr, 0, 7); c.stroke(); });
  this.line(cx - 8, cy, cx + 8, cy); this.line(cx, cy - 8, cx, cy + 8);
  if (ew.powered()) for (const t of ew.visibleThreats()) {
    const ring = t.state === 'launch' || t.lethal ? 60 : t.prio > 1 ? 110 : 160;
    const a = (t.az - 90) * Math.PI / 180, x = cx + Math.cos(a) * ring, y = cy + Math.sin(a) * ring;
    if (t.state === 'launch' && (s.t * 4) % 2 < 1) continue;
    this.txt(t.sym, x, y, { size: 18, align: 'center', color: t.friendly ? GD : G });
    if (t.state !== 'search') { c.beginPath(); c.arc(x, y, 15, 0, 7); c.stroke(); }
  }
  this.txt(`CHAFF ${ew.chaff}`, 60, 430, { size: 15 }); this.txt(`FLARE ${ew.flare}`, 60, 450, { size: 15 });
  this.txt(`MAN ${ew.program}`, 452, 440, { size: 15, align: 'right' });
  this.osb(11, 'ALE-47', { horizontal: true }); this.osb(17, 'MODE');
  this.menuOsb();
};

// ---------------------------------------------------------------- SA (Link-16)
P.p_SA = function () {
  const k = this.k; if (!k) return this.p_PLACEHOLDER();
  const scn = k.scn, o = scn.own, c = this.ctx, s = this.sim;
  this.saRng = this.saRng || 80;
  const cx = S / 2, cy = 300, R = 200, sc = R / this.saRng;
  c.strokeStyle = GD; c.lineWidth = 1.5;
  [0.5, 1].forEach(f => { c.beginPath(); c.arc(cx, cy, R * f, 0, 7); c.stroke(); });
  this.txt(String(this.saRng), cx + R * 0.71, cy - R * 0.71, { size: 14 });
  const P2 = (e, n) => { const de = (e - o.e) / NM, dn = (n - o.n) / NM; const a = -o.hdg * Math.PI / 180; return [cx + (de * Math.cos(a) + dn * Math.sin(a)) * sc, cy - (-de * Math.sin(a) + dn * Math.cos(a)) * sc]; };
  // route
  c.strokeStyle = G; c.beginPath(); scn.waypoints.forEach((w, i) => { const [x, y] = P2(w.e, w.n); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
  scn.waypoints.forEach((w, i) => { const [x, y] = P2(w.e, w.n); c.beginPath(); c.arc(x, y, 5, 0, 7); c.stroke(); this.txt(String(i), x + 8, y - 8, { size: 12 }); });
  // bullseye
  { const [x, y] = P2(scn.bullseye.e, scn.bullseye.n); c.beginPath(); c.arc(x, y, 10, 0, 7); c.stroke(); c.beginPath(); c.arc(x, y, 4, 0, 7); c.stroke(); }
  // SAM threat rings (known emitters)
  for (const t of scn.contacts) if (t.alive && t.def.sam && t.radarOn) { const [x, y] = P2(t.e, t.n); c.strokeStyle = Y; c.beginPath(); c.arc(x, y, t.def.range / NM * sc, 0, 7); c.stroke(); this.txt(t.def.rwr, x, y, { size: 14, align: 'center', color: Y }); }
  // tracks: surveillance (AWACS on Link-16) + own radar
  if (s.dl.link16) for (const t of scn.contacts) {
    if (!t.alive || t.kind !== 'air' || t.type === 'E-3A') continue;
    const [x, y] = P2(t.e, t.n);
    if (Math.hypot(x - cx, y - cy) > R + 30) continue;
    this.hafu(x, y, t.hostile ? 'hostile' : 'friendly', { vec: wrap180(t.hdg - o.hdg), color: t.hostile ? G : '#7fd1ff' });
    if (t.link16) this.txt(t.callsign || '', x + 12, y + 12, { size: 11 });
  }
  // ownship
  c.strokeStyle = G; c.lineWidth = 2; c.beginPath(); c.moveTo(cx, cy - 12); c.lineTo(cx, cy + 10); c.moveTo(cx - 10, cy); c.lineTo(cx + 10, cy); c.stroke();
  const br = scn.bullsRel(o.e, o.n); this.txt(`${Math.round(br.brg)}/${Math.round(br.rng)}`, 60, 450, { size: 15 });
  this.txt(s.dl.link16 ? 'L16' : 'NO L16', 452, 450, { size: 15, align: 'right' });
  this.osb(11, '↑'); this.osb(12, '↓');
  this.menuOsb();
};

// ---------------------------------------------------------------- FLIR (targeting pod) and MAV video overlays
P.p_FLIR = function () {
  const k = this.k; if (!k || !k.tpod) return this.p_PLACEHOLDER();
  const t = k.tpod, s = this.sim;
  this.videoSource = 'tpod';
  if (!t.available()) { this.txt('NO POD', S / 2, S / 2, { size: 26, align: 'center' }); this.menuOsb(); this.videoSource = null; return; }
  if (s.sw.flir !== 'ON') { this.txt(s.sw.flir === 'STBY' ? 'STBY' : 'OFF', S / 2, S / 2, { size: 26, align: 'center' }); this.menuOsb(); this.videoSource = null; return; }
  const c = this.ctx;
  // crosshair with gap
  this.line(S / 2 - 120, S / 2, S / 2 - 18, S / 2, G, 2); this.line(S / 2 + 18, S / 2, S / 2 + 120, S / 2, G, 2);
  this.line(S / 2, S / 2 - 120, S / 2, S / 2 - 18, G, 2); this.line(S / 2, S / 2 + 18, S / 2, S / 2 + 120, G, 2);
  if (t.track === 'POINT') this.rect(S / 2 - 22, S / 2 - 22, 44, 44, G, 2);
  this.txt(t.track, 60, 60, { size: 16 });
  this.txt(t.fov, 452, 60, { size: 16, align: 'right' });
  this.txt(t.polarity, 60, 82, { size: 14 });
  this.osb(6, t.polarity); this.osb(11, t.fov, { horizontal: true });
  this.osb(15, 'L ARM', { horizontal: true, box: t.laserArm });
  this.txt(`${t.code}`, 452, 82, { size: 14, align: 'right' });
  const r = t.slantNm(); if (r) this.txt(`${r.toFixed(1)}`, 452, 450, { size: 16, align: 'right' });
  if (s.laserOn && (s.t * 4) % 2 < 1) this.txt('L', S / 2 + 40, S / 2 + 40, { size: 22 });
  if (s.agTarget) this.txt('TGT', 60, 450, { size: 16, box: true });
  this.txt(`${Math.round(t.los.az)}° ${Math.round(t.los.el)}°`, S / 2, 470, { size: 14, align: 'center' });
  this.menuOsb();
};
P.p_MAV = function () {
  const k = this.k; if (!k || !k.tpod) return this.p_PLACEHOLDER();
  const w = k.wpn, s = this.sim; const d = w.agDef();
  if (!d || d.def.type !== 'mav') { this.txt('NO MAV', S / 2, S / 2, { size: 24, align: 'center' }); this.menuOsb(); this.videoSource = null; return; }
  this.videoSource = 'mav';
  const c = this.ctx; c.strokeStyle = G; c.lineWidth = 2;
  this.line(S / 2 - 60, S / 2, S / 2 + 60, S / 2, G, 2); this.line(S / 2, S / 2 - 60, S / 2, S / 2 + 60, G, 2);
  if (w.ag.mavTrack) { c.beginPath(); c.moveTo(S / 2, S / 2 - 30); c.lineTo(S / 2 + 30, S / 2); c.lineTo(S / 2, S / 2 + 30); c.lineTo(S / 2 - 30, S / 2); c.closePath(); c.stroke(); this.txt('TRK', S / 2, 140, { size: 18, align: 'center' }); }
  this.txt(w.ag.mavCaged ? 'CAGED' : 'UNCAGED', 60, 60, { size: 15 });
  this.txt('65F', 452, 60, { size: 15, align: 'right' });
  this.menuOsb();
};

// HUD repeater
P.p_HUD = function () {
  const k = this.k; if (!k || !k.hud) return this.p_PLACEHOLDER();
  if (this.sim.hudOn) this.ctx.drawImage(k.hud.canvas, 0, 0, S, S);
  this.menuOsb();
};

// ---------------------------------------------------------------- OSB handling for tactical pages
const basePress = P.press;
P.press = function (n) {
  const k = this.k;
  if (k && this.powered()) {
    const p = this.page, r = k.radar, w = k.wpn;
    if (p === 'TAC' && n === 2 && w.agDef() && w.agDef().def.type === 'mav') { this.page = 'MAV'; return; }
    if (p === 'RDR ATTK' && n !== 18) {
      if (w.master === 'AG') { if (n === 1 || n === 20) r.agMode = { MAP: 'GMT', GMT: 'SEA', SEA: 'MAP' }[r.agMode]; if (n === 11) r.agRng = Math.min(160, r.agRng * 2); if (n === 12) r.agRng = Math.max(5, r.agRng / 2); return; }
      const m = { 1: 'mode', 20: 'mode', 5: 'prf', 7: 'bars', 8: 'sil', 9: 'erase', 19: 'az', 11: 'rngUp', 12: 'rngDn', 16: 'data', 2: 'rts' };
      if (r.dataPage && (n === 13 || n === 14)) { r.cycle(n === 13 ? 'ltws' : 'msi'); return; }
      if (r.mode === 'TWS' && n === 13) { r.cycle('auto'); return; }
      if (r.mode === 'TWS' && n === 14) { r.cycle('man'); return; }
      if (r.mode === 'TWS' && n === 15) { r.cycle('raid'); return; }
      if (m[n]) r.cycle(m[n]);
      return;
    }
    if (p === 'STORES' && n !== 18) {
      if (n === 4) { this.sim.masterArmSim = !this.sim.masterArmSim; return; }
      if (w.master === 'AA') { if (n === 17) w.gun.rate = w.gun.rate === 'HIGH' ? 'LOW' : 'HIGH'; return; }
      if (w.master === 'AG') {
        const types = []; for (let i = 1; i <= 9; i++) { const s = w.stations[i]; if (s && s.qty && s.def.cat === 'AG' && !types.find(t => t.type === s.type)) types.push({ type: s.type, st: i }); }
        if (n >= 6 && n <= 10 && types[n - 6]) { w.cycleAG(types[n - 6].st); return; }
        const d = w.agDef(); if (!d) return; const tp = d.def.type;
        if (n === 11) { if (tp === 'bomb' || tp === 'lgb') w.ag.mode = w.ag.mode === 'CCIP' ? 'AUTO' : 'CCIP'; if (tp === 'jdam') w.ag.jdamMode = w.ag.jdamMode === 'TOO' ? 'PP' : 'TOO'; if (tp === 'mav') w.ag.mavCaged = !w.ag.mavCaged; if (tp === 'harm') w.ag.harmMode = { TOO: 'PB', PB: 'SP', SP: 'TOO' }[w.ag.harmMode]; }
        if (n === 12) w.ag.fuze = { INST: 'DLY1', DLY1: 'DLY2', DLY2: 'VT', VT: 'INST' }[w.ag.fuze];
        if (n === 13) w.ag.qty = w.ag.qty % 4 + 1;
        return;
      }
      return;
    }
    if (p === 'FLIR' && k.tpod && n !== 18) { if (n === 6) k.tpod.polarity = k.tpod.polarity === 'WHOT' ? 'BHOT' : 'WHOT'; if (n === 11) k.tpod.cycleFov(); if (n === 15) k.tpod.laserArm = !k.tpod.laserArm; return; }
    if (p === 'SA' && (n === 11 || n === 12)) { this.saRng = n === 11 ? Math.min(160, (this.saRng || 80) * 2) : Math.max(10, (this.saRng || 80) / 2); return; }
    if (p === 'EW' && n === 11) { k.ew.cmMode = { MAN: 'SEMI', SEMI: 'AUTO', AUTO: 'STBY', STBY: 'MAN' }[k.ew.cmMode]; return; }
    if (p === 'AZ/EL' && n === 18) { /* menu */ }
  }
  return basePress.call(this, n);
};
