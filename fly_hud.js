// Collimated head-up display drawn on a canvas, placed 10 m in front of the pilot (24 deg field of view).
import * as THREE from 'three';
import { AIRFIELD, P } from './fly_terrain.js';
import { KT, FT, AC } from './fly_physics.js';

const SZ = 1024, FOV = 24 * Math.PI / 180, DIST = 10;
const PX_DEG = SZ / 24, PX_TAN = (SZ / 2) / Math.tan(FOV / 2);
const GREEN = '#5bff82', DIM = '#2fbf58', AMBER = '#ffc040', RED = '#ff5a40';
const wrapD = (d) => ((((d + P / 2) % P) + P) % P) - P / 2;

export class HUD {
  constructor(parent) {
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = SZ;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    const w = 2 * DIST * Math.tan(FOV / 2);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    this.mesh.position.set(0, 0.02, -DIST); this.mesh.renderOrder = 20;
    parent.add(this.mesh); this.acc = 0; this.t = 0;
  }

  update(dt, sim) {
    this.t += dt; this.acc += dt;
    if (this.acc < 1 / 24) return; this.acc = 0;
    this.draw(sim);
    this.tex.needsUpdate = true;
  }

  draw(sim) {
    const c = this.ctx, f = sim.fl, tk = sim.tk, cx = SZ / 2, cy = SZ / 2;
    c.clearRect(0, 0, SZ, SZ);
    c.lineCap = 'round'; c.lineJoin = 'round';
    let sCol = GREEN, sW = 3;
    const stroke = (col = GREEN, w = 3) => { sCol = col; sW = w; };
    const S = () => { c.strokeStyle = sCol; c.lineWidth = sW; c.shadowColor = 'rgba(0,20,0,0.9)'; c.shadowBlur = 4; c.stroke(); c.shadowBlur = 0; };
    const SR = (x, y, w, h) => { c.beginPath(); c.rect(x, y, w, h); S(); };
    const text = (s, x, y, size = 30, align = 'center', col = GREEN) => {
      c.font = `bold ${size}px "DejaVu Sans Mono", Consolas, monospace`; c.textAlign = align; c.textBaseline = 'middle';
      c.save(); c.lineWidth = 5; c.strokeStyle = 'rgba(0,25,0,0.85)'; c.shadowBlur = 0; c.strokeText(s, x, y); c.fillStyle = col; c.fillText(s, x, y); c.restore();
    };
    const line = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); S(); };

    const pitch = f.pitch * 57.2958, bank = f.bank, alphaDeg = f.mode === 'air' ? f.alpha * 57.2958 : 0;
    const ias = f.ias * KT, alt = f.pos.y * FT - 0, vs = f.vel.y * FT * 60;
    const heading = f.heading * 57.2958;

    // ---------------- pitch ladder
    c.save(); c.beginPath(); c.rect(80, 120, SZ - 160, SZ - 330); c.clip();
    c.translate(cx, cy); c.rotate(-bank);
    stroke(GREEN, 3);
    for (let n = -90; n <= 90; n += 5) {
      const y = (pitch - n) * PX_DEG; if (Math.abs(y) > 560) continue;
      if (n === 0) { line(-300, y, -60, y); line(60, y, 300, y); continue; }
      const half = n % 10 === 0 ? 85 : 55, gap = 36, dir = n > 0 ? 1 : -1;
      if (n > 0) { line(-half - gap, y, -gap, y); line(gap, y, half + gap, y); line(-half - gap, y, -half - gap, y + 12); line(half + gap, y, half + gap, y + 12); }
      else { c.setLineDash([12, 10]); line(-half - gap, y, -gap, y); line(gap, y, half + gap, y); c.setLineDash([]); line(-half - gap, y, -half - gap, y - 12); line(half + gap, y, half + gap, y - 12); }
      if (n % 10 === 0) { const lbl = String(Math.abs(n)); text(lbl, -half - gap - 30, y + dir * 6, 24, 'center'); text(lbl, half + gap + 30, y + dir * 6, 24, 'center'); }
    }
    c.restore();

    // ---------------- boresight + flight path marker
    stroke(GREEN, 3); line(cx - 12, cy, cx + 12, cy); line(cx, cy - 12, cx, cy + 12);
    if (f.mode !== 'crashed') {
      const fx = cx, fy = Math.min(cy + 440, cy + alphaDeg * PX_DEG);
      c.beginPath(); c.arc(fx, fy, 15, 0, 7); S(); line(fx - 15, fy, fx - 38, fy); line(fx + 15, fy, fx + 38, fy); line(fx, fy - 15, fx, fy - 30);
    }

    // ---------------- heading tape
    const tapeY = 78, hs = 11;
    c.save(); c.beginPath(); c.rect(cx - 330, tapeY - 40, 660, 110); c.clip(); stroke(GREEN, 2);
    const h0 = Math.round(heading / 5) * 5;
    for (let h = h0 - 35; h <= h0 + 35; h += 5) {
      const x = cx + (h - heading) * hs, hh = ((h % 360) + 360) % 360;
      line(x, tapeY + 22, x, tapeY + (hh % 10 === 0 ? 40 : 32));
      if (hh % 10 === 0) text(String(Math.round(hh / 10) % 36 === 0 ? 36 : Math.round(hh / 10) % 36).padStart(2, '0'), x, tapeY + 8, 24);
    }
    c.restore(); stroke(GREEN, 3); line(cx, tapeY + 46, cx - 8, tapeY + 60); line(cx, tapeY + 46, cx + 8, tapeY + 60);
    text(String(Math.round(heading) % 360).padStart(3, '0'), cx, tapeY + 82, 26);

    // ---------------- speed (left) and altitude (right)
    stroke(GREEN, 3); SR(70, cy - 30, 130, 52); text(String(Math.round(ias)), 135, cy - 3, 38);
    text('KT', 135, cy - 52, 22, 'center', DIM);
    text('M ' + f.mach.toFixed(2), 135, cy + 48, 28);
    text('G ' + f.nz.toFixed(1), 100, cy + 100, 28, 'left', f.nz > 6.5 ? AMBER : GREEN);
    text('AOA ' + (f.alpha * 57.2958).toFixed(1), 100, cy + 136, 26, 'left', alphaDeg > 25 ? RED : GREEN);
    SR(SZ - 215, cy - 30, 150, 52); text(String(Math.round(alt / 10) * 10), SZ - 140, cy - 3, 38);
    text('FT', SZ - 140, cy - 52, 22, 'center', DIM);
    const vsr = Math.round(vs / 100) * 100; text((vsr >= 0 ? '+' : '') + vsr + ' FPM', SZ - 140, cy + 48, 26);
    if (f.agl < 1500) text('R ' + Math.max(0, Math.round(f.agl * FT)), SZ - 140, cy + 84, 30, 'center', f.agl < 150 ? AMBER : GREEN);

    // ---------------- bottom: throttle, fuel, systems
    const by = SZ - 150, bw = 300, bx = cx - bw / 2, lever = sim.input.lever;
    stroke(GREEN, 2); SR(bx, by, bw, 22);
    c.fillStyle = lever > 0.75 ? AMBER : GREEN; c.shadowBlur = 0; c.globalAlpha = 0.9; c.fillRect(bx + 2, by + 2, (bw - 4) * lever, 18); c.globalAlpha = 1;
    stroke(GREEN, 2); line(bx + bw * 0.75, by - 6, bx + bw * 0.75, by + 28);
    text(lever > 0.75 ? 'POST-COMBUSTION' : lever < 0.04 ? 'RALENTI' : 'GAZ ' + Math.round(Math.min(1, lever / 0.75) * 100) + '%', cx, by + 44, 24, 'center', lever > 0.75 ? AMBER : GREEN);
    const lowFuel = f.fuel < 700 && (Math.floor(this.t * 2) % 2 === 0);
    text('CARB ' + Math.round(f.fuel) + ' KG', cx, by + 78, 28, 'center', f.fuel < 700 ? (lowFuel ? RED : AMBER) : GREEN);
    const sys = [];
    if (f.gear > 0.5) sys.push(f.gear > 0.95 ? 'TRAIN' : 'TRAIN ▼'); if (f.probe > 0.5) sys.push('PERCHE');
    if (sys.length) text(sys.join('  '), cx, by + 112, 24, 'center', DIM);

    // ---------------- navigation markers
    const inv = f.qb.clone().invert();
    const mark = (wx, wy, wz, label, col, kind = 'diamond') => {
      const v = new THREE.Vector3(wx - f.pos.x, wy - f.pos.y, wz - f.pos.z); const dist = v.length(); v.applyQuaternion(inv);
      let sx, sy, out = false;
      if (v.z < -1) { sx = cx + PX_TAN * v.x / -v.z; sy = cy - PX_TAN * v.y / -v.z; } else { sx = cx + v.x * 1e4; sy = cy - v.y * 1e4; }
      const m = 70; if (sx < m || sx > SZ - m || sy < 190 || sy > SZ - 220 || v.z >= -1) {
        out = true; const ang = Math.atan2(sy - cy, sx - cx); const r = 400;
        sx = cx + Math.cos(ang) * r * (Math.abs(Math.cos(ang)) > 0.7 ? 1.1 : 0.9); sy = cy + Math.sin(ang) * r * 0.75;
        sx = Math.min(SZ - m, Math.max(m, sx)); sy = Math.min(SZ - 230, Math.max(200, sy));
      }
      stroke(col, 3);
      if (out) { c.save(); c.translate(sx, sy); c.rotate(Math.atan2(sy - cy, sx - cx)); c.beginPath(); c.moveTo(20, 0); c.lineTo(-10, -12); c.lineTo(-10, 12); c.closePath(); S(); c.restore(); }
      else if (kind === 'circle') { c.beginPath(); c.arc(sx, sy, Math.max(14, 2409 * 0.7 / Math.max(10, dist)), 0, 7); S(); }
      else { c.beginPath(); c.moveTo(sx, sy - 16); c.lineTo(sx + 16, sy); c.lineTo(sx, sy + 16); c.lineTo(sx - 16, sy); c.closePath(); S(); }
      text(label, sx, sy + (out ? 34 : 34), 22, 'center', col);
      return dist;
    };
    const rwz = AIRFIELD.z + AIRFIELD.halfLen - 280;
    const dxR = wrapD(AIRFIELD.x - f.pos.x), dzR = wrapD(rwz - f.pos.z);
    const dR = Math.hypot(dxR, dzR);
    if (f.mode === 'air') mark(f.pos.x + dxR, AIRFIELD.elev, f.pos.z + dzR, 'PISTE ' + (dR / 1000).toFixed(1), DIM);
    const dT = sim.tankerDist;
    if (f.mode === 'air' && dT < 60000) {
      let col = DIM; let lbl = 'RAVITO ' + (dT / 1000).toFixed(1);
      if (dT < 3000) lbl = 'RAVITO ' + Math.round(dT) + ' m';
      mark(tk.pos.x, tk.pos.y, tk.pos.z, lbl, col);
      if (dT < 700) {
        const bw2 = tk.toWorld(tk.basket);
        const tip = AC.probeTip.clone().applyQuaternion(f.qb).add(f.pos);
        const bd = bw2.clone().sub(tip);
        const rv = f.vel.clone().sub(tk.vel);
        mark(bw2.x, bw2.y, bw2.z, bd.length().toFixed(0) + ' m  ' + (rv.dot(bd.clone().normalize())).toFixed(1) + ' m/s', tk.state === 'connected' ? GREEN : tk.state === 'ready' ? AMBER : DIM, 'circle');
      }
    }

    // ---------------- messages and warnings
    let y = 205;
    for (const m of sim.msgs) {
      const words = m.text.split(' '), lines = []; let cur = '';
      for (const w of words) { if ((cur + ' ' + w).trim().length > 36) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
      if (cur) lines.push(cur);
      for (let i = 0; i < lines.length; i++) { text(lines[i], cx, y, 25, 'center', AMBER); y += 30; }
      y += 6;
    }
    if (sim.connected) text('CONNECTÉ  +' + Math.round(tk.fuelFlow) + ' kg/s', cx, 330, 34, 'center', GREEN);
    if (f.mode === 'crashed') { text('CRASH', cx, cy - 30, 80, 'center', RED); text(f.crashReason, cx, cy + 40, 32, 'center', RED); }
    else {
      const flash = Math.floor(this.t * 3) % 2 === 0;
      let warn = '';
      if (f.mode === 'air' && f.vel.y < -5) {
        const landing = f.gear > 0.5 && f.agl < 400 && f.speed < 100;
        if (!landing) for (let s = 1; s <= 7; s++) { const px = f.pos.x + f.vel.x * s, pz = f.pos.z + f.vel.z * s, py = f.pos.y + f.vel.y * s; if (py - 40 < sim.terrain.heightAt(px, pz)) { warn = 'REMONTE'; break; } }
      }
      if (alphaDeg > 27) warn = warn || 'INCIDENCE';
      if (f.flameout && f.mode === 'air') warn = 'PLUS DE CARBURANT';
      if (warn && flash) text(warn, cx, cy + 230, 54, 'center', RED);
    }

    // ---------------- first seconds: controls reminder
    if (sim.helpT > sim.t && f.mode !== 'crashed') {
      const a = Math.min(1, (sim.helpT - sim.t) / 3);
      c.globalAlpha = a;
      text('MAIN DROITE (gâchette/grip) : MANCHE — incline la manette', cx, SZ - 335, 22, 'center', DIM);
      text('MAIN GAUCHE (gâchette/grip) : GAZ — pousse / tire', cx, SZ - 308, 22, 'center', DIM);
      text('A vol · B ravitailleur · X piste · Y recentrer', cx, SZ - 281, 22, 'center', DIM);
      c.globalAlpha = 1;
    }
  }
}
