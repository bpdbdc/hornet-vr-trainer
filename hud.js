import * as THREE from 'three';
import { NM, FT, wrap360, wrap180 } from './scenario.js';
import { WPN } from './weapons.js';

const S = 1024, FOV = 22, PPD = S / FOV, C = S / 2;
const FONT = (px) => `bold ${px}px "DejaVu Sans Mono","Roboto Mono",Consolas,monospace`;

// Collimated HUD: symbology drawn on a canvas, shown on a plane 25 m ahead (parallax-free in VR),
// confined to the 20 deg combiner field of view and occluded by the cockpit structure.
export class HUD {
  constructor(root, ctx) {
    Object.assign(this, ctx);    // sim, scn, radar, wpn, ew, ufc
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = S;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    const D = 25, size = 2 * D * Math.tan(FOV / 2 * Math.PI / 180);
    // drawn after the outside world and before the cockpit (render order), additive, no depth test:
    // the cockpit structure masks it, the world never does (collimated image at infinity)
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: false, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, fog: false });
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.mat);
    this.plane.position.set(0, -0.06 * D / 1, -D); this.plane.renderOrder = 5;
    root.add(this.plane);
    this.peakG = 1; this.acc = 0;
  }

  // world -> HUD pixel (relative to boresight)
  proj(dir) {
    const [x, y, z] = dir;
    const az = Math.atan2(x, -z) * 180 / Math.PI, el = Math.atan2(y, Math.hypot(x, z)) * 180 / Math.PI;
    return { x: C + az * PPD, y: C - el * PPD, az, el, inFov: Math.hypot(az, el) < 10, behind: z > 0 };
  }
  pointDir(e, n, alt) { return this.scn.toCockpitDir({ e, n, alt, hdg: 0, tas: 0 }); }

  line(x1, y1, x2, y2, w = 3) { const g = this.g; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineWidth = w; g.stroke(); }
  txt(s, x, y, size = 30, align = 'center') { const g = this.g; g.font = FONT(size); g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); }
  box(x, y, w, h) { this.g.lineWidth = 3; this.g.strokeRect(x - w / 2, y - h / 2, w, h); }
  circle(x, y, r, dash) { const g = this.g; g.setLineDash(dash ? [10, 10] : []); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.lineWidth = 3; g.stroke(); g.setLineDash([]); }

  update(dt) {
    this.acc += dt;
    const on = this.sim.hudOn;
    this.plane.visible = on;
    if (!on || this.acc < 1 / 20) return;
    this.acc = 0;
    const s = this.sim, sw = s.sw, g = this.g;
    const b = Math.min(1, 0.25 + sw.hudSymBrt) * (sw.hudSymMode === 'NIGHT' ? 0.55 : 1);
    g.clearRect(0, 0, S, S);
    const col = `rgba(90,255,110,${b})`;
    g.strokeStyle = col; g.fillStyle = col;
    g.save(); g.beginPath(); g.arc(C, C, C * 0.93, 0, Math.PI * 2); g.clip();
    this.drawNav();
    if (this.wpn.master === 'AA') this.drawAA();
    if (this.wpn.master === 'AG') this.drawAG();
    if (sw.ltTest === 'TEST') { g.lineWidth = 4; this.circle(C, C, 300); this.txt('HUD TEST', C, C, 40); }
    g.restore();
    this.tex.needsUpdate = true;
  }

  drawNav() {
    const s = this.sim, sw = s.sw, o = this.scn.own, rej = sw.hudRej, g = this.g;
    const rej1 = rej !== 'NORM', rej2 = rej === 'REJ 2';
    // velocity vector (offset by AOA) and pitch ladder
    const vvx = C, vvy = C + (o.wow ? 0 : o.aoa) * PPD;
    g.save(); g.translate(vvx, vvy); g.rotate(-o.roll * Math.PI / 180);
    if (!o.wow) {
      for (let p = -30; p <= 30; p += 5) {
        if (p === 0) { this.line(-420, (o.pitch) * PPD, -60, o.pitch * PPD); this.line(60, o.pitch * PPD, 420, o.pitch * PPD); continue; }
        const y = (o.pitch - p) * PPD + (o.wow ? 0 : -o.aoa * PPD) * 0;
        if (Math.abs(y) > 480) continue;
        g.setLineDash(p < 0 ? [14, 10] : []);
        this.line(-190, y, -70, y); this.line(70, y, 190, y);
        this.line(-190, y, -190, y + (p > 0 ? 18 : -18)); this.line(190, y, 190, y + (p > 0 ? 18 : -18));
        g.setLineDash([]);
        this.txt(String(Math.abs(p)), -230, y, 24); this.txt(String(Math.abs(p)), 230, y, 24);
      }
    }
    g.restore();
    // VV symbol
    this.circle(vvx, vvy, 13); this.line(vvx - 13, vvy, vvx - 38, vvy); this.line(vvx + 13, vvy, vvx + 38, vvy); this.line(vvx, vvy - 13, vvx, vvy - 30);
    // heading tape
    if (!rej2) {
      const hdg = o.hdg;
      for (let a = Math.ceil((hdg - 15) / 5) * 5; a <= hdg + 15; a += 5) {
        const x = C + wrap180(a - hdg) * 22;
        this.line(x, 70, x, a % 10 === 0 ? 92 : 82, 3);
        if (a % 10 === 0) this.txt(String(wrap360(a) / 10).padStart(2, '0'), x, 50, 26);
      }
      this.line(C, 98, C - 10, 112); this.line(C, 98, C + 10, 112);
      // command heading (steering to waypoint / TACAN)
      const wp = this.scn.waypoints[this.sim.wyptIdx ?? 1];
      if (wp && !o.wow) {
        const brg = wrap360(Math.atan2(wp.e - o.e, wp.n - o.n) * 180 / Math.PI);
        const x = C + Math.max(-15, Math.min(15, wrap180(brg - hdg))) * 22;
        this.line(x, 100, x, 120, 4);
        const rng = Math.hypot(wp.e - o.e, wp.n - o.n) / NM;
        this.txt(`${rng.toFixed(1)}`, 790, 760, 28, 'left'); this.txt(`W${this.sim.wyptIdx ?? 1}`, 790, 792, 28, 'left');
      }
      if (this.ufc && this.ufc.tcn.on && !o.wow) { const r = Math.hypot(o.e, o.n) / NM; this.txt(`${r.toFixed(1)} T`, 790, 728, 28, 'left'); }
    }
    // airspeed / altitude / VS
    const cas = Math.round(o.cas), alt = Math.round(o.alt);
    const rdr = sw.hudAlt === 'RDR';
    this.txt(String(cas), 250, 420, 34); if (!rej1) this.box(250, 420, 110, 46);
    const altStr = rdr ? (o.alt - 0 < 5000 ? String(Math.round((o.alt - (o.wow ? 50 : 0)))) : String(alt)) : String(alt);
    this.txt(altStr.length > 3 ? altStr.slice(0, -3) + ',' + altStr.slice(-3) : altStr, 774, 420, 34); if (!rej1) this.box(774, 420, 140, 46);
    if (rdr) this.txt(o.alt < 5000 ? 'R' : ((this.sim.t * 2) % 2 < 1 ? 'B' : ''), 860, 420, 28);
    this.txt(String(Math.round(o.vs / 10) * 10), 774, 372, 26);
    if (!rej1) {
      this.txt(`α ${o.aoa.toFixed(1)}`, 200, 610, 28, 'left');
      this.txt(`M ${o.mach.toFixed(2)}`, 200, 645, 28, 'left');
      this.txt(`G ${o.g.toFixed(1)}`, 200, 680, 28, 'left');
      this.peakG = Math.max(this.peakG, o.g); if (this.peakG > 4) this.txt(this.peakG.toFixed(1), 200, 715, 28, 'left');
      // bank scale
      const by = 900;
      for (const a of [-45, -30, -15, -5, 5, 15, 30, 45, 0]) {
        const r = 120, an = (a) * Math.PI / 180;
        const x = C + Math.sin(an) * r, y = by - 120 + Math.cos(an) * r;
        this.line(x, y, C + Math.sin(an) * (r + (a % 15 === 0 ? 22 : 12)), by - 120 + Math.cos(an) * (r + (a % 15 === 0 ? 22 : 12)), 3);
      }
      const pr = o.roll * Math.PI / 180;
      this.line(C + Math.sin(-pr) * 105, by - 120 + Math.cos(-pr) * 105, C + Math.sin(-pr) * 85, by - 120 + Math.cos(-pr) * 85, 5);
    }
    if (o.wow && this.sim.elec.ac) this.txt('', C, 600);
    // master arm / mode cue
    const wpn = this.wpn;
    if (wpn.master !== 'NAV') this.txt(wpn.armed() ? (this.sim.masterArmSim ? 'SIM' : 'ARM') : 'SAFE', 200, 790, 28, 'left');
  }

  drawAA() {
    const s = this.sim, r = this.radar, w = this.wpn, scn = this.scn, g = this.g;
    const sel = w.aaSel;
    const label = sel === 'GUN' ? `GUN ${w.gun.rounds}` : sel ? `${WPN[sel].short} ${w.aaCount(sel.slice(0, 5))}` : '';
    this.txt(label, 200, 755, 30, 'left');
    // ACM symbology
    if (r.mode === 'ACM' && r.transmitting) {
      if (r.acm === 'BST') this.circle(C, C, 1.65 * PPD, true);
      if (r.acm === 'VACQ') { g.setLineDash([12, 12]); this.line(C - 3.5 * PPD, C + 13 * PPD, C - 3.5 * PPD, 0); this.line(C + 3.5 * PPD, C + 13 * PPD, C + 3.5 * PPD, 0); g.setLineDash([]); }
      if (r.acm === 'WACQ') { this.box(800, 820, 90, 50); this.box(800, 820, 30, 18); }
      if (r.acm === 'GACQ') this.circle(C, C, 9.5 * PPD, true);
    }
    // targets
    const trk = r.lsTrack();
    if (trk && trk.c.alive) {
      const p = this.proj(scn.toCockpitDir(trk.c));
      if (p.inFov && !p.behind) { this.box(p.x, p.y, 42, 42); if (r.mode === 'STT') this.box(p.x, p.y, 50, 50); }
      else { // target locator line
        const a = Math.atan2(p.y - C, p.x - C); this.line(C + Math.cos(a) * 40, C + Math.sin(a) * 40, C + Math.cos(a) * 140, C + Math.sin(a) * 140, 4);
        const off = Math.round(Math.hypot(p.az, p.el)); this.txt(String(off), C + Math.cos(a) * 170, C + Math.sin(a) * 170, 26);
      }
      // range / closure + DLZ scale
      const z = sel && sel !== 'GUN' ? w.dlz(sel, trk) : null;
      this.txt(`${trk.rng.toFixed(1)}`, 774, 470, 30); this.txt(`${Math.round(trk.vc)}`, 860, 560, 26, 'left');
      if (z) {
        const top = 300, bot = 700, scale = Math.max(z.rmax * 1.3, trk.rng * 1.1);
        const Y = (v) => bot - (v / scale) * (bot - top);
        this.line(840, top, 840, bot, 3);
        this.line(840, Y(z.rmax), 870, Y(z.rmax)); this.line(840, Y(z.rne), 870, Y(z.rne)); this.line(840, Y(z.rmin), 870, Y(z.rmin));
        this.line(830, Y(trk.rng), 815, Y(trk.rng) - 10); this.line(830, Y(trk.rng), 815, Y(trk.rng) + 10);
        if (trk.rng < z.rmax && trk.rng > z.rmin && w.armed()) this.txt('SHOOT', C, 300, 34);
        if (trk.rng < z.rmin) this.txt('IN RNG MIN', C, 300, 28);
      }
      // ASE circle + steering dot for radar missiles
      if (sel && WPN[sel] && WPN[sel].seeker !== 'IR' && (r.mode === 'STT' || r.mode === 'TWS')) {
        this.circle(C, C, 90);
        const dx = Math.max(-80, Math.min(80, p.az * 8)), dy = Math.max(-80, Math.min(80, -p.el * 8));
        g.beginPath(); g.arc(C + dx, C + dy, 7, 0, 7); g.fill();
      }
    }
    if (r.dt2) { const t = r.tracks.get(r.dt2); if (t) { const p = this.proj(scn.toCockpitDir(t.c)); if (p.inFov) { this.line(p.x - 14, p.y - 14, p.x + 14, p.y + 14); this.line(p.x + 14, p.y - 14, p.x - 14, p.y + 14); } } }
    // AIM-9 seeker
    if (sel && WPN[sel] && WPN[sel].seeker === 'IR') {
      const sk = w.seeker;
      const x = C + sk.az * PPD, y = C - sk.el * PPD;
      this.circle(x, y, 1.6 * PPD, sk.caged && !sk.track);
    }
    // gun
    if (sel === 'GUN') {
      const gy = C - 2 * PPD; this.line(C - 20, gy, C + 20, gy); this.line(C, gy - 20, C, gy + 20);
      if (r.mode === 'STT' && trk) {
        const p = this.proj(scn.toCockpitDir(trk.c));
        const px = p.x, py = p.y + 1.2 * PPD; this.circle(px, py, 40); g.beginPath(); g.arc(px, py, 4, 0, 7); g.fill();
        const frac = Math.max(0, Math.min(1, 1 - trk.rng * 6076 / 12000));
        g.beginPath(); g.arc(px, py, 34, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.lineWidth = 6; g.stroke();
      } else {   // funnel
        g.beginPath(); g.moveTo(C - 12, gy + 20); g.quadraticCurveTo(C - 40, C + 120, C - 110, C + 300); g.lineWidth = 3; g.stroke();
        g.beginPath(); g.moveTo(C + 12, gy + 20); g.quadraticCurveTo(C + 40, C + 120, C + 110, C + 300); g.stroke();
      }
    }
    // missiles in flight
    const m = w.inFlight.find(x => x.kind === 'AA' && x.target);
    if (m) this.txt(m.pitbull ? 'ACT' : `TTG ${Math.round(m.ttg || 0)}`, 780, 650, 28, 'left');
  }

  drawAG() {
    const s = this.sim, w = this.wpn, scn = this.scn, g = this.g, o = scn.own;
    const st = w.agDef();
    if (st) this.txt(`${st.def.short} ${Object.values(w.stations).filter(x => x && x.type === st.type && x.qty).length}`, 200, 755, 30, 'left');
    const vvx = C, vvy = C + o.aoa * PPD;
    const tgt = s.agTarget;
    // TD diamond on designated target
    let tp = null;
    if (tgt) {
      tp = this.proj(this.pointDir(tgt.e, tgt.n, tgt.alt || 0));
      if (tp.inFov && !tp.behind) { g.beginPath(); g.moveTo(tp.x, tp.y - 22); g.lineTo(tp.x + 22, tp.y); g.lineTo(tp.x, tp.y + 22); g.lineTo(tp.x - 22, tp.y); g.closePath(); g.lineWidth = 3; g.stroke(); }
    }
    if (!st) return;
    const t = st.def.type;
    if (t === 'bomb' || t === 'lgb') {
      if (w.ag.mode === 'CCIP' || !tgt) {
        const cc = w.ccip(); if (!cc) return;
        const py = C - cc.el * PPD + o.aoa * 0;
        const px = C - Math.sin(o.roll * Math.PI / 180) * (py - vvy) * 0.0;
        this.line(vvx, vvy + 20, px, py - 22, 2);     // bomb fall line
        this.circle(px, Math.min(py, S - 20), 22); g.beginPath(); g.arc(px, Math.min(py, S - 20), 4, 0, 7); g.fill();
        this.txt('CCIP', 200, 790, 26, 'left');
      } else {
        // AUTO: azimuth steering line + release cue
        if (tp) { this.line(tp.x, 120, tp.x, 900, 2); const rel = Math.max(0, (Math.hypot(tgt.e - o.e, tgt.n - o.n) - (w.ccip()?.ground || 0)) / Math.max(1, o.tas * 0.514)); this.txt(`REL ${Math.round(rel)}`, 780, 680, 28, 'left'); const ry = vvy - Math.min(300, rel * 15); this.line(tp.x - 25, ry, tp.x + 25, ry, 5); }
        this.txt('AUTO', 200, 790, 26, 'left');
      }
    }
    if (t === 'jdam') {
      const lar = w.jdamLar();
      this.txt(w.ag.jdamMode + '1', 200, 820, 26, 'left');
      if (lar) { this.txt(lar.inRng ? 'IN RNG' : `${lar.r.toFixed(1)}`, 780, 680, 28, 'left'); }
      const aligned = this.sim.t - w.ag.jdamAlignT > 30;
      if (!aligned) this.txt('ALN', 780, 715, 26, 'left');
    }
    if (t === 'mav') {
      const los = w.ag.mavLos; const x = C + los.az * PPD, y = C - los.el * PPD;
      g.beginPath(); g.moveTo(x, y - 16); g.lineTo(x + 16, y); g.lineTo(x, y + 16); g.lineTo(x - 16, y); g.closePath(); g.stroke();
      if (w.ag.mavTrack) this.txt('TRK', x, y - 34, 24);
    }
    if (t === 'harm' && w.ag.harmTgt) { this.txt(`HARM ${w.ag.harmTgt.def.rwr}`, 780, 680, 28, 'left'); }
    if (s.laserOn && (s.t * 3) % 2 < 1) this.txt('L', C + 120, C + 160, 34);
    const bm = w.inFlight.find(x => x.kind !== 'AA');
    if (bm) { const tof = Math.max(0, bm.alt * FT / Math.max(30, -bm.vz || 30)); this.txt(`TOF ${Math.round(tof)}`, 780, 640, 26, 'left'); }
  }
}
