// DDI / AMPCD page renderer. Layout and labels follow the DCS F/A-18C pages
// (Chuck's guide screenshots, ED Early Access guide).
// OSB numbering (DCS): 1-5 left (top->bottom), 6-10 top (left->right), 11-15 right (top->bottom), 16-20 bottom (right->left).

const S = 512;                         // canvas size (screen area)
const F = [0.18, 0.34, 0.5, 0.66, 0.82];   // OSB positions along an edge (fraction of the screen)
const G = '#43ff43', GD = '#1d8f1d', Y = '#ffe24a', R = '#ff4a3a', CY = '#5fe6ff';
const FONT = (px) => `bold ${px}px "DejaVu Sans Mono","Roboto Mono",Consolas,monospace`;

export function osbPos(n) {          // label anchor inside the screen, normalized 0..1
  if (n <= 5) return { x: 0.045, y: F[n - 1], side: 'L' };
  if (n <= 10) return { x: F[n - 6], y: 0.065, side: 'T' };
  if (n <= 15) return { x: 0.955, y: F[n - 11], side: 'R' };
  return { x: F[20 - n], y: 0.935, side: 'B' };
}

function fmtTime(t) { const s = Math.floor(t) % 86400; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`; }

export class DDI {
  constructor(id, sim, opts = {}) {
    this.id = id; this.sim = sim;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = S;
    this.ctx = this.canvas.getContext('2d');
    this.isAmpcd = id === 'AMPCD';
    this.page = opts.page || (id === 'L' ? 'TAC' : id === 'R' ? 'BIT' : 'HSI');
    this.defaultPage = this.page;
    this.menuMode = 'TAC';
    this.powerT = 0; this.wasOn = false;
    this.bitSub = 'MAIN';
    this.hsi = { data: false, dataTab: 'WYPT', wypt: 0, scl: 40 };
    this.adiSrc = 'STBY';
    this.dirty = true;
    this.onPress = opts.onPress || null;
    this.blink = 0;
    this.k = null;            // tactical context {scn, radar, wpn, ew, hud, tpod, hotas} (main.js)
    this.hasTdc = false;      // TDC assigned to this display (SCS)
    this.videoSource = null;  // 'tpod' | 'mav' when the page shows sensor video behind the symbology
  }

  powered() {
    const s = this.sim;
    if (!s.elec.ac) return false;
    if (this.isAmpcd) return s.sw.ampcdBrt > 0.05;
    return (this.id === 'L' ? s.sw.ddiL : s.sw.ddiR) !== 'OFF';
  }

  brightness() {
    const s = this.sim;
    if (this.isAmpcd) return 0.35 + 0.65 * s.sw.ampcdBrt;
    const m = this.id === 'L' ? s.sw.ddiL : s.sw.ddiR;
    return m === 'DAY' ? 1 : 0.55;
  }

  // ------------------------------------------------------------ input
  press(n) {
    if (!this.powered()) return;
    const p = this.page, s = this.sim;
    const go = (pg) => { this.page = pg; };
    if (n === 18 && !(p === 'HSI' && this.hsi.data)) {           // MENU
      if (p === 'TAC') { go('SUPT'); this.menuMode = 'SUPT'; }
      else if (p === 'SUPT') { go('TAC'); this.menuMode = 'TAC'; }
      else go(this.menuMode === 'SUPT' ? 'SUPT' : 'TAC');
      this.bitSub = 'MAIN';
      return;
    }
    if (p === 'TAC') {
      const m = { 1: 'STORES', 2: 'RDR ATTK', 3: 'HUD', 5: 'AZ/EL', 6: 'FLIR', 13: 'SA', 17: 'EW', 20: 'TGT DATA' };
      if (m[n]) go(m[n]);
    } else if (p === 'SUPT') {
      const m = { 4: 'HSI', 5: 'ADI', 8: 'BIT', 10: 'MUMI', 11: 'CHKLST', 12: 'ENG', 15: 'FCS', 20: 'FUEL', 19: 'FPAS', 16: 'UFC BU' };
      if (m[n]) { go(m[n]); if (m[n] === 'BIT') this.bitSub = 'MAIN'; }
    } else if (p === 'BIT') {
      if (this.bitSub === 'MAIN') {
        if (n === 10) { s.bitPage.blinking = false; s.bitPage.stopped = true; s.log('bitStop', {}); }
        if (n === 1) this.bitSub = 'FCS-MC';
      } else if (this.bitSub === 'FCS-MC') {
        if (n === 1) s.startFcsBit();
        if (n === 8) this.bitSub = 'MAIN';
        if (n === 10) { s.bitPage.blinking = false; }
      }
    } else if (p === 'HSI') {
      if (this.hsi.data) {
        if (n === 10 || n === 18) this.hsi.data = false;
        if (n === 6) this.hsi.dataTab = 'A/C';
        if (n === 7) this.hsi.dataTab = 'WYPT';
        if (n === 12) this.hsi.wypt = (this.hsi.wypt + 1) % 60;
        if (n === 13) this.hsi.wypt = (this.hsi.wypt + 59) % 60;
        if (n === 5 && this.hsi.dataTab === 'WYPT') this.emitUfc('WYPT');
      } else {
        if (n === 10) this.hsi.data = true;
        if (n === 8) this.hsi.scl = { 5: 10, 10: 20, 20: 40, 40: 80, 80: 160, 160: 5 }[this.hsi.scl];
        if (n === 19 && s.ins.mode === 'GND' && s.ins.stdHdgAvailable && !s.ins.stdHdg) {
          s.ins.stdHdg = true; s.ins.alignTotal = Math.max(s.ins.alignT + 5, 90); s.log('stdHdg', {});
        }
        if (n === 17) this.emitUfc('TIME');
        if (n === 12) this.hsi.wypt = (this.hsi.wypt + 1) % 60;
        if (n === 13) this.hsi.wypt = (this.hsi.wypt + 59) % 60;
      }
    } else if (p === 'ADI') {
      if (n === 16) this.adiSrc = 'STBY';
      if (n === 20) this.adiSrc = 'INS';
    } else if (p === 'FUEL') {
      if (n === 20) { s.log('flbit', {}); }
    }
    if (this.onPress) this.onPress(this, n);
  }
  emitUfc(kind) { this.sim.emit('ufcRequest', { kind, ddi: this }); }

  // ------------------------------------------------------------ draw helpers
  txt(str, x, y, opt = {}) {
    const c = this.ctx;
    c.font = FONT(opt.size || 19);
    c.fillStyle = opt.color || G;
    c.textAlign = opt.align || 'left';
    c.textBaseline = opt.base || 'middle';
    c.fillText(str, x, y);
    if (opt.box) {
      const w = c.measureText(str).width, h = (opt.size || 19) + 6;
      const x0 = opt.align === 'center' ? x - w / 2 : opt.align === 'right' ? x - w : x;
      c.strokeStyle = opt.color || G; c.lineWidth = 2; c.strokeRect(x0 - 4, y - h / 2, w + 8, h);
    }
  }
  vtxt(str, x, y, opt = {}) {           // vertical stacked letters (side OSB labels)
    const size = opt.size || 18, lines = str.split('');
    const y0 = y - (lines.length - 1) * size * 0.5;
    lines.forEach((ch, i) => this.txt(ch, x, y0 + i * size, { ...opt, align: 'center' }));
    if (opt.box) {
      const c = this.ctx; c.strokeStyle = opt.color || G; c.lineWidth = 2;
      c.strokeRect(x - size * 0.55, y0 - size * 0.65, size * 1.1, lines.length * size + size * 0.3);
    }
  }
  osb(n, label, opt = {}) {
    if (!label) return;
    const p = osbPos(n);
    const x = p.x * S, y = p.y * S;
    const parts = label.split('\n');
    if (p.side === 'L' || p.side === 'R') {
      if (opt.horizontal) { parts.forEach((l, i) => this.txt(l, x + (p.side === 'L' ? 6 : -6), y + (i - (parts.length - 1) / 2) * 20, { ...opt, align: p.side === 'L' ? 'left' : 'right' })); }
      else this.vtxt(label.replace('\n', ''), x + (p.side === 'L' ? 8 : -8), y, opt);
    } else {
      parts.forEach((l, i) => this.txt(l, x, y + (p.side === 'T' ? i * 20 : -(parts.length - 1 - i) * 20), { ...opt, align: 'center' }));
    }
  }
  line(x1, y1, x2, y2, color = G, w = 2) { const c = this.ctx; c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  rect(x, y, w, h, color = G, lw = 2) { const c = this.ctx; c.strokeStyle = color; c.lineWidth = lw; c.strokeRect(x, y, w, h); }
  cross(x, y, w, h, color = G) { this.line(x + 2, y + 2, x + w - 2, y + h - 2, color, 2); this.line(x + w - 2, y + 2, x + 2, y + h - 2, color, 2); }

  // ------------------------------------------------------------ render
  render() {
    const c = this.ctx, s = this.sim;
    const on = this.powered();
    if (on && !this.wasOn) { this.powerT = 0; this.page = this.defaultPage; }
    this.wasOn = on;
    c.clearRect(0, 0, S, S);
    this.videoSource = null;
    if (!on) { c.fillStyle = '#020403'; c.fillRect(0, 0, S, S); return false; }
    this.powerT += 1 / 30;
    if (this.powerT < 1.5) { // warm-up
      c.fillStyle = '#020403'; c.fillRect(0, 0, S, S);
      c.fillStyle = `rgba(30,80,30,${0.4 * (1.5 - this.powerT)})`; c.fillRect(0, 0, S, S);
      return true;
    }
    this.blink = (s.t * 2) % 2 < 1.2;
    const fn = this['p_' + this.page.replace(/[^A-Z]/g, '')];
    if (fn) fn.call(this); else this.p_PLACEHOLDER();
    // TDC assignment diamond (upper right corner, as in DCS)
    if (this.hasTdc) { c.save(); c.translate(S - 34, 34); c.rotate(Math.PI / 4); c.fillStyle = G; c.fillRect(-6, -6, 12, 12); c.restore(); }
    // opaque background unless the page shows sensor video (FLIR / MAV), which is drawn on a plane behind
    if (!this.videoSource) { c.globalCompositeOperation = 'destination-over'; c.fillStyle = '#020403'; c.fillRect(0, 0, S, S); c.globalCompositeOperation = 'source-over'; }
    // cautions overlay on the left DDI (all pages) - DCS shows them on the LDDI
    if (this.id === 'L') this.drawCautions();
    // brightness
    const b = this.brightness();
    if (b < 1) { c.fillStyle = `rgba(0,0,0,${1 - b})`; c.fillRect(0, 0, S, S); }
    return true;
  }

  drawCautions() {
    const s = this.sim;
    const cau = s.cautions(), adv = s.advisories();
    if (!cau.length && !adv.length) return;
    let list = cau;
    const col = s.stacked ? 1 : 2;
    const x0 = 40, y0 = 360;
    list.slice(0, 8).forEach((cname, i) => {
      const cx = col === 2 ? x0 + Math.floor(i / 4) * 150 : x0;
      const cy = y0 + (i % (col === 2 ? 4 : 8)) * 20;
      this.txt(cname, cx, cy, { size: 18, color: Y });
    });
    if (adv.length) this.txt('ADV- ' + adv.slice(0, 3).join(' '), x0, 470, { size: 16 });
  }

  menuOsb() {
    const label = this.page === 'TAC' ? 'TAC' : this.page === 'SUPT' ? 'SUPT' : 'MENU';
    const p = osbPos(18);
    if (this.page === 'TAC' || this.page === 'SUPT') {
      this.txt(label, p.x * S, p.y * S - 20, { align: 'center', box: true, size: 18 });
      this.txt(fmtTime(this.sim.t + 12 * 3600), p.x * S, p.y * S, { align: 'center', size: 17 });
    } else this.osb(18, 'MENU');
  }

  p_PLACEHOLDER() { this.txt(this.page, S / 2, S / 2 - 20, { align: 'center', size: 26 }); this.txt('NOT AVAILABLE', S / 2, S / 2 + 14, { align: 'center', size: 17, color: GD }); this.menuOsb(); }

  p_TAC() {
    this.osb(1, 'STORES'); this.osb(2, 'RDRATTK'); this.osb(3, 'HUD'); this.osb(5, 'AZ/EL');
    this.osb(6, 'FLIR'); this.osb(13, 'SA'); this.osb(17, 'EW'); this.osb(20, 'TGT\nDATA');
    this.menuOsb();
  }
  p_SUPT() {
    this.osb(4, 'HSI'); this.osb(5, 'ADI'); this.osb(8, 'BIT'); this.osb(10, 'MUMI');
    this.osb(11, 'CHKLST'); this.osb(12, 'ENG'); this.osb(15, 'FCS');
    this.osb(20, 'FUEL'); this.osb(19, 'FPAS'); this.osb(16, 'UFC BU');
    this.menuOsb();
  }

  // ---------------- FCS page
  p_FCS() {
    const s = this.sim, c = this.ctx;
    const hyd = s.hyd.h1 > 1500 || s.hyd.h2 > 1500;
    const xs = s.fcs.xs;
    // channel boxes (left: ch 1&4 / 1234, right: ch 2&3 / 1234)
    const drawBlock = (x0, rowsX) => {
      const w = 17, h = 17;
      const rows = [['SV1', 4, true], ['SV2', 4, true], ['', 2, false], ['', 2, false], ['SV1', 4, true], ['SV2', 4, true]];
      let y = 92;
      rows.forEach((r, i) => {
        const n = r[1];
        const off = n === 2 ? w : 0;
        for (let k = 0; k < n; k++) {
          const bx = x0 + off + k * w;
          this.rect(bx, y, w, h);
          if (rowsX && rowsX(i, k)) this.cross(bx, y, w, h);
        }
        y += h + (i === 3 ? 22 : 0);
      });
      this.txt('1234', x0 + 34, y + 14, { align: 'center', size: 15 });
    };
    const xfun = (i, k) => xs && (i < 2 || i === 2);
    drawBlock(82, xfun); drawBlock(372, xfun);
    ['SV1', 'SV2', '', '', 'SV1', 'SV2'].forEach((l, i) => {
      const y = 100 + i * 17 + (i > 3 ? 22 : 0);
      if (l) { this.txt(l, 50, y, { size: 14 }); this.txt(l, 444, y, { size: 14 }); }
    });
    // surface positions
    const flaps = s.sw.flaps;
    let lef = 12, tef = 45, ail = 42, rud = 30, stab = 0;
    if (hyd && !xs) { tef = flaps === 'FULL' ? 45 : 30; ail = flaps === 'FULL' ? 42 : 30; }
    if (hyd && !xs && s.toTrimDone) stab = 4;
    const row = (y, l, r, name) => { this.txt(l, 186, y, { size: 18 }); this.txt(name, 256, y, { align: 'center', size: 18 }); this.txt(r, 326, y, { align: 'right', size: 18 }); };
    row(100, `↓${lef}`, `↓${lef}`, 'LEF'); this.line(186, 110, 326, 110, G, 1);
    row(128, `↓${tef}`, `↓${tef}`, 'TEF'); this.line(186, 138, 326, 138, G, 1);
    row(156, `↓${ail}`, `↓${ail}`, 'AIL'); this.line(186, 166, 326, 166, G, 1);
    row(184, `→${rud}`, `←${rud - 2}`, 'RUD');
    row(214, `${stab ? '↑' + stab : '0'}`, `${stab ? '↑' + stab : '0'}`, 'STAB');
    this.txt('G-LIM 7.5G', 70, 272, { size: 24 });
    // right lower grid
    const labels = ['CAS P', 'R', 'Y', 'N ACC', 'L ACC', 'STICK', 'PEDAL', 'AOA', 'BADSA', 'PROC', 'DEGD'];
    const gx = 330, gy = 262, cw = 17, ch = 17;
    labels.forEach((l, i) => {
      this.txt(l, gx - 6, gy + i * ch + ch / 2, { align: 'right', size: 14 });
      for (let k = 0; k < 4; k++) this.rect(gx + k * cw, gy + i * ch, cw, ch, G, 1.5);
    });
    this.txt('1234', gx + 34, gy - 10, { align: 'center', size: 14 });
    this.vtxt('BLIN', 22, 330, { size: 16 });
    this.osb(16, 'AOA');
    this.menuOsb();
  }

  // ---------------- BIT
  p_BIT() {
    const s = this.sim;
    if (this.bitSub === 'FCS-MC') return this.p_FCSMC();
    this.osb(6, 'AUTO'); this.osb(7, 'CONFIG'); this.osb(8, 'SELBIT'); this.osb(9, 'MI'); this.osb(10, 'STOP');
    const blink = s.bitPage.blinking && !this.blink;
    const side = (n, title, status) => {
      const p = osbPos(n), x = p.side === 'L' ? 38 : S - 38, al = p.side === 'L' ? 'left' : 'right';
      this.txt(title, x, p.y * S - 12, { align: al, size: 17 });
      this.line(p.side === 'L' ? x : x - 110, p.y * S, p.side === 'L' ? x + 110 : x, p.y * S, G, 1.5);
      if (!blink || status === 'GO') this.txt(status, x, p.y * S + 13, { align: al, size: 17 });
    };
    const fcsStat = s.fcs.bit === 'GO' ? 'GO' : s.fcs.bit === 'IN TEST' ? 'IN TEST' : 'GO';
    side(1, 'FCS-MC', fcsStat); side(2, 'SENSORS', 'GO'); side(3, 'STORES', 'DEGD');
    side(4, 'COMM', 'NOT RDY'); side(5, 'NAV', s.ins.aligned ? 'GO' : 'NOT RDY');
    side(11, 'DISPLAYS', 'NOT RDY'); side(12, 'STATUS\nMONITOR'.split('\n')[0], 'GO'); side(13, 'EW', s.sw.rwrPwr ? 'GO' : 'NOT RDY');
    this.txt('BIT FAILURES', S / 2, 150, { align: 'center', size: 26 });
    const items = [['WPNS', 'DEGD'], ['IFF', s.iff.on ? 'GO' : 'NOT RDY'], ['D/L', s.dl.link16 ? 'GO' : 'NOT RDY'], ['MIDS', s.dl.link16 ? 'GO' : 'NOT RDY'],
      ['BCN', 'OFF'], ['AUG', 'DEGD'], ['DMS', 'NOT RDY'], ['HMD', 'NOT RDY'], ['RWR', s.sw.rwrPwr ? 'GO' : 'NOT RDY'], ['ALE-47', s.sw.dispenser === 'ON' ? 'GO' : 'NOT RDY']];
    items.forEach(([a, b], i) => { this.txt(a, 178, 190 + i * 19, { size: 16 }); if (!blink) this.txt(b, 262, 190 + i * 19, { size: 16 }); });
    this.menuOsb();
  }
  p_FCSMC() {
    const s = this.sim;
    this.osb(6, 'ALL'); this.osb(8, 'BIT'); this.osb(9, 'MI'); this.osb(10, 'STOP');
    this.osb(1, 'FCS', { horizontal: true });
    this.txt('FCS-MC', S / 2, 190, { align: 'center', size: 28 });
    const st = s.fcs.bit;
    [['MC1', 'GO'], ['MC2', 'GO'], ['FCSA', st], ['FCSB', st]].forEach(([a, b], i) => {
      this.txt(a, 175, 230 + i * 22, { size: 18 }); this.txt(b, 280, 230 + i * 22, { size: 18 });
    });
    this.osb(17, 'FCS\nMAINT'); this.osb(16, 'FCS\nOPTION');
    this.menuOsb();
  }

  // ---------------- ENG
  p_ENG() {
    const s = this.sim, L = s.eng.L, R = s.eng.R;
    this.txt('LEFT EPE', 70, 70, { size: 17 }); this.txt('RIGHT EPE', 442, 70, { align: 'right', size: 17 });
    const rows = [['INLET TEMP', 13, 13], ['N1 RPM', L.n1, R.n1], ['N2 RPM', L.n2, R.n2], ['EGT', L.egt, R.egt], ['FF', L.ff, R.ff],
      ['NOZ POS', L.noz, R.noz], ['OIL PRESS', L.oil, R.oil], ['THRUST', null, null], ['VIB', 0, 0], ['FUEL TEMP', 14, 14], ['EPR', L.n2 > 50 ? 1.02 : 0, R.n2 > 50 ? 1.02 : 0], ['CDP', L.n2 > 50 ? 22 : 15, R.n2 > 50 ? 22 : 15], ['TDP', null, null]];
    rows.forEach(([n, a, b], i) => {
      const y = 100 + i * 25;
      this.txt(n, S / 2, y, { align: 'center', size: 17 });
      if (a !== null) {
        const f = (v) => (n === 'EPR' || n === 'VIB') ? v.toFixed(n === 'EPR' ? 2 : 1) : Math.round(v).toString();
        this.txt(f(a), 110, y, { align: 'right', size: 17 }); this.txt(f(b), 402, y, { align: 'left', size: 17 });
      }
    });
    this.menuOsb();
  }

  // ---------------- FUEL
  p_FUEL() {
    const s = this.sim;
    const t1 = 2840, lfd = 1830, rfd = 1440, t4 = 3660, lw = 620, rw = 620;
    const internal = t1 + lfd + rfd + t4 + lw + rw;
    this.txt('TOTAL', 40, 70, { size: 17 }); this.txt(String(internal), 40, 92, { size: 19 });
    this.txt('INTERNAL', 40, 120, { size: 17 }); this.txt(String(internal), 40, 142, { size: 19 });
    this.txt('BINGO', 470, 120, { align: 'right', size: 17 }); this.txt(String(s.bingo), 470, 142, { align: 'right', size: 19 });
    const box = (x, y, w, h, v, label) => { this.rect(x, y, w, h); this.txt(String(v), x + w / 2, y + h / 2, { align: 'center', size: 20 }); if (label) this.txt(label, x + w / 2, y - 10, { align: 'center', size: 13 }); };
    box(196, 90, 120, 46, t1, 'TK 1'); box(206, 170, 100, 34, lfd, 'L FD'); box(206, 222, 100, 34, rfd, 'R FD'); box(196, 290, 120, 52, t4, 'TK 4');
    box(60, 220, 64, 32, lw, 'L WG'); box(388, 220, 64, 32, rw, 'R WG');
    this.osb(20, 'FLBIT'); this.osb(11, 'RESET\nSDC', { horizontal: true });
    this.menuOsb();
  }

  // ---------------- CHKLST
  p_CHKLST() {
    const s = this.sim;
    const land = ['LAND', ' WHEELS', ' FLAPS', ' HOOK', ' ANTI SKID', ' HARNESS', ' DISPENSER'];
    const to = ['T.O.', ' CONTROLS', ' WINGS', ' TRIM', ' FLAPS', ' HOOK', ' HARNESS', ' WARN LTS', ' NWS LO', ' SEAT ARM'];
    land.forEach((l, i) => this.txt(l, 70, 120 + i * 21, { size: 17 }));
    to.forEach((l, i) => this.txt(l, 280, 120 + i * 21, { size: 17 }));
    this.txt('A/C WT  32150', 70, 340, { size: 17 });
    this.txt('MAX NZ', 70, 375, { size: 17 });
    const stab = s.toTrimDone ? 12 : 3;
    this.txt(`2° NU STAB POS ${stab}° NU`, 110, 410, { size: 17 });
    this.menuOsb();
  }

  // ---------------- HSI (also AMPCD default)
  p_HSI() {
    const s = this.sim, c = this.ctx;
    if (this.hsi.data) return this.p_HSIDATA();
    const hdg = 335;
    const ins = s.ins;
    const posLabel = ins.navMode === 'AINS' ? 'POS/AINS' : 'POS/INS';
    this.osb(6, posLabel); this.osb(7, 'UPDT'); this.osb(8, `SCL/${this.hsi.scl}`); this.osb(9, 'MK1'); this.osb(10, 'DATA');
    this.osb(1, 'TCN'); this.osb(2, 'ILS'); this.osb(3, 'MODE'); this.osb(4, 'VEC');
    this.osb(11, 'WYPT'); this.osb(12, '▲'); this.osb(13, '▼'); this.osb(15, 'SEQ');
    this.osb(20, 'SENSORS');
    if (ins.mode === 'GND' || ins.mode === 'CV') this.osb(19, 'STD HDG', { box: ins.stdHdg });
    this.osb(17, 'TIMEUFC'); this.osb(16, 'AUTO');
    this.menuOsb();
    // compass rose
    const cx = S / 2, cy = S / 2 + 10, r = 165;
    c.save(); c.translate(cx, cy);
    c.strokeStyle = G; c.lineWidth = 2;
    for (let a = 0; a < 360; a += 5) {
      const ang = (a - hdg) * Math.PI / 180;
      const l = a % 30 === 0 ? 14 : a % 10 === 0 ? 9 : 5;
      c.beginPath(); c.moveTo(Math.sin(ang) * r, -Math.cos(ang) * r); c.lineTo(Math.sin(ang) * (r - l), -Math.cos(ang) * (r - l)); c.stroke();
      if (a % 30 === 0) {
        const lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] || String(a / 10);
        c.font = FONT(17); c.fillStyle = G; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(lab, Math.sin(ang) * (r - 28), -Math.cos(ang) * (r - 28));
      }
    }
    // aircraft symbol
    c.lineWidth = 3; c.beginPath(); c.moveTo(0, -16); c.lineTo(0, 16); c.moveTo(-14, -2); c.lineTo(14, -2); c.moveTo(-6, 13); c.lineTo(6, 13); c.stroke();
    c.restore();
    this.txt(`${hdg}°`, 410, 70, { size: 17 }); this.txt('00:00:00', 410, 90, { size: 17 });
    // INS alignment status (DCS: GRND QUAL / TIME, then OK)
    if (s.elec.ac && (ins.mode === 'GND' || ins.mode === 'CV')) {
      const lbl = ins.mode === 'GND' ? 'GRND' : 'CV';
      const t = Math.floor(ins.alignT);
      this.txt(lbl, cx + 20, cy + 70, { size: 17 });
      this.txt(ins.noAtt ? 'NO ATT' : `QUAL: ${ins.qual.toFixed(1)}`, cx + 20, cy + 90, { size: 17 });
      this.txt(`TIME: ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, cx + 20, cy + 110, { size: 17 });
      if (ins.aligned) this.txt('OK', cx + 160, cy + 90, { size: 17, box: !this.blink });
    } else if (s.elec.ac && ins.mode === 'OFF') {
      this.txt('INS OFF', cx + 30, cy + 90, { size: 17, color: Y });
    }
    this.txt('HSEL', 40, 430, { size: 15 }); this.txt('000°', 40, 448, { size: 15 });
    this.txt('CSEL', 470, 430, { size: 15, align: 'right' });
  }
  p_HSIDATA() {
    const s = this.sim;
    this.osb(6, 'A/C', { box: this.hsi.dataTab === 'A/C' }); this.osb(7, 'WYPT', { box: this.hsi.dataTab === 'WYPT' }); this.osb(8, 'TGT'); this.osb(10, 'DATA', { box: true });
    this.osb(18, 'MENU');
    if (this.hsi.dataTab === 'WYPT') {
      const w = (s.waypoints || [])[this.hsi.wypt] || { lat: 'N 42°10.91', lon: 'E 42°27.85', elev: 0 };
      this.osb(12, '▲'); this.osb(13, '▼'); this.osb(5, 'UFC', { box: false });
      this.txt(`WYPT ${this.hsi.wypt}`, 120, 140, { size: 22 });
      this.txt(w.lat, 120, 180, { size: 20 }); this.txt(w.lon, 120, 205, { size: 20 });
      this.txt(`ELEV ${w.elev}FT`, 120, 235, { size: 20 });
    } else {
      this.txt('A/C DATA', 120, 140, { size: 22 });
      this.txt('MAG HDG', 120, 180, { size: 18 }); this.txt('MAG VAR E006°', 120, 205, { size: 18 });
      this.txt(`INS ${s.ins.mode}`, 120, 235, { size: 18 });
    }
  }

  // ---------------- ADI
  p_ADI() {
    const s = this.sim, c = this.ctx;
    const cx = S / 2, cy = S / 2 + 10, r = 150;
    c.strokeStyle = G; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    c.save(); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
    for (let p = -30; p <= 30; p += 10) { const y = cy - p * 4; this.line(cx - (p ? 40 : r), y, cx + (p ? 40 : r), y); if (p) { this.txt(String(Math.abs(p)), cx - 60, y, { size: 14, align: 'right' }); } }
    c.restore();
    this.line(cx - 60, cy, cx - 20, cy, G, 3); this.line(cx + 20, cy, cx + 60, cy, G, 3);
    this.txt('0', 110, 80, { size: 18, box: true }); this.txt('0', 400, 80, { size: 18, box: true });
    this.osb(20, 'INS', { box: this.adiSrc === 'INS' }); this.osb(16, 'STBY', { box: this.adiSrc === 'STBY' });
    [[-24, 0], [0, 0], [24, 0]].forEach(([dx]) => this.rect(cx + dx - 8, cy + r + 12, 16, 12));
    this.menuOsb();
  }

  // ---------------- other TAC pages (simplified but laid out like DCS)
  p_HUD() {
    const s = this.sim;
    this.txt('0', 120, 200, { size: 20, box: true }); this.txt(String(Math.round(s.sw.radaltIdx ? 0 : 0)), 390, 200, { size: 20, box: true });
    for (let k = -2; k <= 2; k++) this.txt(String((33 + k) % 36).padStart(2, '0'), S / 2 + k * 50, 90, { align: 'center', size: 17 });
    this.txt('^', S / 2, 108, { align: 'center' });
    this.txt('ADV-BIT,', 60, 440, { size: 16 });
    this.menuOsb();
  }
  p_EW() {
    const s = this.sim, c = this.ctx;
    this.txt('ASPJ', 70, 70, { size: 16 }); this.txt(s.sw.ecm === 'OFF' ? 'OFF' : s.sw.ecm, 70, 88, { size: 16 });
    this.txt('EW', S / 2, 70, { align: 'center', size: 16 });
    this.txt('ALE-47', 400, 70, { size: 16, align: 'center' }); this.txt(s.sw.dispenser === 'ON' ? 'STBY' : 'OFF', 400, 88, { size: 16, align: 'center' });
    c.strokeStyle = G; c.lineWidth = 2;
    [70, 150].forEach(r => { c.beginPath(); c.arc(S / 2, S / 2 + 20, r, 0, Math.PI * 2); c.stroke(); });
    this.osb(17, 'MODE'); this.menuOsb();
  }
  p_SA() { this.p_EW(); }
  p_STORES() {
    const c = this.ctx;
    this.txt('CLEAN', S / 2, 160, { align: 'center', size: 20 });
    c.strokeStyle = G; c.lineWidth = 2; c.beginPath();
    c.moveTo(80, 260); c.lineTo(S / 2, 200); c.lineTo(432, 260); c.stroke();
    this.txt('GUN', 470, 140, { size: 17, align: 'right' }); this.txt('578', S / 2, 230, { align: 'center', size: 16 });
    this.osb(17, 'TONE'); this.osb(16, 'DATA'); this.menuOsb();
  }
  p_RDRATTK() {
    const s = this.sim;
    this.rect(70, 80, 372, 330);
    const mode = s.sw.radar === 'OPR' ? (s.elec.ac ? 'OPR' : 'OFF') : s.sw.radar;
    this.txt(mode, 40, 60, { size: 16 }); this.txt('SIL', S / 2, 40, { align: 'center', size: 16 });
    this.txt('RWS', 30, 120, { size: 16 });
    this.osb(17, 'CHAN'); this.osb(16, 'DATA'); this.menuOsb();
  }
  p_MUMI() {
    this.txt('MUMI', S / 2, 80, { align: 'center', size: 24 });
    ['ALR67', 'COMM'].forEach((l, i) => this.osb(1 + i, l, { horizontal: true }));
    this.txt('DTC: DCS_HORNET', S / 2, 140, { align: 'center', size: 16 });
    this.menuOsb();
  }
  p_FPAS() {
    this.txt('FPAS', S / 2, 70, { align: 'center', size: 24 });
    const lines = ['CURRENT  RANGE NM  ENDUR', '         310       1:05', 'OPTIMUM  ALT  SPD', '         31000 M.78', 'HOME FUEL --'];
    lines.forEach((l, i) => this.txt(l, 60, 130 + i * 30, { size: 17 }));
    this.menuOsb();
  }
}
