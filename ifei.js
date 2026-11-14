// IFEI (Integrated Fuel/Engine Indicator) — battery powered (DC), as in DCS.
const FONT = (px) => `bold ${px}px "DejaVu Sans Mono","Roboto Mono",Consolas,monospace`;

export class IFEI {
  constructor(sim) {
    this.sim = sim; this.mode = 'NORM'; this.zulu = false; this.et = null; this.holdDir = 0; this.holdT = 0;
    sim.on((t) => { if (t === 'reset') { this.mode = 'NORM'; this.zulu = false; this.et = null; } });
  }
  powered() { return this.sim.elec.batt || this.sim.elec.ac; }
  button(name, down = true) {
    const s = this.sim;
    if (!this.powered()) return;
    if (!down) { this.holdDir = 0; return; }
    s.log('ifei', { button: name });
    if (name === 'UP' || name === 'DOWN') { this.holdDir = name === 'UP' ? 1 : -1; this.holdT = 0; this.bump(); }
    if (name === 'ZONE') this.zulu = !this.zulu;
    if (name === 'ET') this.et = this.et === null ? s.t : null;
    if (name === 'MODE') this.mode = this.mode === 'NORM' ? 'BIT' : 'NORM';
    if (name === 'QTY') this.mode = this.mode === 'QTY' ? 'NORM' : 'QTY';
  }
  bump() { const s = this.sim; s.bingo = Math.max(0, Math.min(15000, s.bingo + this.holdDir * 100)); s.log('bingo', { v: s.bingo }); }
  update(dt) {
    if (this.holdDir) { this.holdT += dt; if (this.holdT > 0.5) { this.holdT -= 0.08; this.bump(); } }
  }
  // windows: {eng, labels, fuel, time} rectangles normalized to the plate
  draw(ctx, W, H, win) {
    if (!this.powered() || !win) return;
    const s = this.sim, L = s.eng.L, R = s.eng.R;
    const b = Math.max(0.35, 0.4 + 0.6 * (s.sw.ifeiBrt ?? 0.8));
    const col = `rgba(255,255,255,${b})`;
    const fill = (r) => { ctx.fillStyle = 'rgba(8,10,8,0.96)'; ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H); };
    const put = (r, fx, fy, str, size, align) => {
      ctx.font = FONT(size); ctx.fillStyle = col; ctx.textAlign = align || 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(str, (r.x + r.w * fx) * W, (r.y + r.h * fy) * H);
    };
    const lt = s.sw.ltTest === 'TEST';
    if (win.eng) {
      const r = win.eng; fill(r);
      const sz = r.h * H * 0.13;
      const rows = [
        [L.n2, R.n2, (v) => Math.round(v).toString()],
        [L.egt, R.egt, (v) => Math.round(v).toString()],
        [L.ff, R.ff, (v) => Math.round(v / 100).toString()],     // x100 pph like DCS
        [L.noz, R.noz, (v) => Math.round(v).toString()],
        [L.oil, R.oil, (v) => Math.round(v).toString()],
      ];
      const lab = ['RPM', 'TEMP', 'FF', 'NOZ', 'OIL'];
      rows.forEach(([a, c, f], i) => {
        const y = 0.13 + i * 0.185;
        put(r, 0.33, y, lt ? '888' : f(a), sz);
        put(r, 0.53, y, lab[i], sz * 0.5, 'center');
        put(r, 0.84, y, lt ? '888' : f(c), sz);
      });
    }
    if (win.labels) {           // nozzle position scales (L / R)
      const r = win.labels; fill(r);
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      [0.3, 0.7].forEach((fx, k) => {
        const x = (r.x + r.w * fx) * W, y0 = (r.y + r.h * 0.08) * H, y1 = (r.y + r.h * 0.92) * H;
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        for (let t = 0; t <= 10; t++) { const y = y1 - (y1 - y0) * t / 10; ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.stroke(); }
        const v = (k ? R.noz : L.noz) / 100, y = y1 - (y1 - y0) * v;
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + (k ? -12 : 12), y); ctx.lineTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.fill();
      });
    }
    if (win.fuel) {
      const r = win.fuel; fill(r);
      const total = Math.round(s.fuelTotal ?? 10950), int = Math.round(s.fuelInt ?? total);
      const sz = r.h * H * 0.26;
      put(r, 0.88, 0.28, `${total}T`, sz);
      put(r, 0.88, 0.62, `${int}I`, sz);
      put(r, 0.88, 0.90, s.bingo ? `${s.bingo}` : '0', sz * 0.75);
    }
    if (win.time) {
      const r = win.time; fill(r);
      const t = s.t + (this.zulu ? 9 : 12) * 3600;
      const h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60, se = Math.floor(t) % 60;
      put(r, 0.9, 0.38, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(se).padStart(2, '0')}${this.zulu ? 'Z' : 'L'}`, r.h * H * 0.3);
      if (this.et !== null) { const e = Math.floor(s.t - this.et); put(r, 0.9, 0.78, `${Math.floor(e / 60)}:${String(e % 60).padStart(2, '0')}`, r.h * H * 0.26); }
    }
  }
}
