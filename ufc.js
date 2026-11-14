// Up-Front Controller logic + display, modelled on the DCS F/A-18C UFC.
// Display canvas covers the whole UFC legend plate (OpenHornet artwork) so the LCD windows
// sit exactly in the plate apertures.

const SEG = '#4dff6a';
const FONT = (px) => `bold ${px}px "DejaVu Sans Mono","Roboto Mono",Consolas,monospace`;
const CHANNELS = [...Array.from({ length: 20 }, (_, i) => String(i + 1)), 'G', 'M', 'C', 'S'];

function defaultPresets(base) {
  const p = {};
  for (let i = 1; i <= 20; i++) p[i] = (base + i * 2.25).toFixed(3);
  p.G = '243.000'; p.M = base.toFixed(3); p.C = '000.000'; p.S = '156.800';
  return p;
}

export class UFC {
  constructor(sim) {
    this.sim = sim;
    this.resetState();
    sim.on((type, d) => {
      if (type === 'ufcRequest') {
        if (d.kind === 'TIME') this.setMode('TIME');
        if (d.kind === 'WYPT') { this.wypt.idx = d.ddi.hsi.wypt; this.setMode('WYPT'); }
      }
      if (type === 'reset') this.resetState();
    });
  }

  resetState() {
    this.mode = 'NONE';            // NONE | COMM1 | COMM2 | TCN | ILS | IFF | DL4 | DL16 | AP | TIME | WYPT | POSN | EMCON
    this.scratch = '';             // typed digits
    this.scratchLeft = '';         // two small chars on the left
    this.opts = ['', '', '', '', ''];
    this.optSel = [false, false, false, false, false];
    this.comm = {
      1: { ch: 1, presets: defaultPresets(250.0), manual: '305.000', opt: { G: true, SQCH: true, CPHR: false, AM: true, FM: false } },
      2: { ch: 1, presets: defaultPresets(270.0), manual: '135.000', opt: { G: false, SQCH: true, CPHR: false, AM: true, FM: false } },
    };
    this.tcn = { on: false, ch: 1, band: 'X', mode: 'T/R' };
    this.ils = { on: false, ch: 1 };
    this.bcn = false; this.emcon = false;
    this.ap = { modes: { ATTH: false, BALT: false, RALT: false, HSEL: false, CPL: false } };
    this.time = { sel: 'ZTOD' };
    this.wypt = { idx: 0, field: null };
    this.hold = { key: null, t: 0 };
    this.flash = 0;
    this.dirty = true;
  }

  powered() { return this.sim.elec.ac && this.sim.sw.ufcBrt > 0.05; }

  setMode(m) {
    this.mode = m; this.scratch = ''; this.optSel = [false, false, false, false, false];
    const t = this.tcn, s = this.sim;
    switch (m) {
      case 'COMM1': case 'COMM2': {
        const c = this.comm[m === 'COMM1' ? 1 : 2];
        this.opts = ['G' + 'RCV', 'SQCH', 'CPHR', 'AM', 'FM'];
        this.optSel = [c.opt.G, c.opt.SQCH, c.opt.CPHR, c.opt.AM, c.opt.FM];
        break;
      }
      case 'TCN': this.opts = ['T/R', 'RCV', 'A/A', 'X', 'Y']; this.optSel = [t.mode === 'T/R', t.mode === 'RCV', t.mode === 'A/A', t.band === 'X', t.band === 'Y']; break;
      case 'ILS': this.opts = ['', '', '', '', '']; break;
      case 'IFF': this.opts = ['1', '2', '3', '4A', '4B']; this.optSel = [true, true, true, s.iff.mode4A, !s.iff.mode4A]; break;
      case 'DL4': this.opts = ['VOCE', 'ACL', '', '', '']; break;
      case 'DL16': this.opts = ['AIC', 'F/F', 'VOCA', 'VOCB', 'NET']; break;
      case 'AP': this.opts = ['ATTH', 'BALT', 'RALT', 'HSEL', 'CPL']; this.optSel = Object.values(this.ap.modes); break;
      case 'TIME': this.opts = ['ZTOD', 'LTOD', 'ET', 'CD', 'SW']; this.optSel = [this.time.sel === 'ZTOD', this.time.sel === 'LTOD', false, false, false]; break;
      case 'WYPT': this.opts = ['POSN', 'ELEV', '', '', '']; break;
      case 'POSN': this.opts = ['LAT', 'LON', '', '', '']; break;
      default: this.opts = ['', '', '', '', ''];
    }
    this.dirty = true;
  }

  // ---------------- inputs from cockpit controls
  key(k, down = true) {
    if (!this.powered()) return;
    const s = this.sim;
    if (!down) {             // release (for hold keys)
      if (this.hold.key === k) this.hold = { key: null, t: 0 };
      return;
    }
    s.log('ufcKey', { key: k, mode: this.mode });
    if (/^[0-9]$/.test(k)) {
      if (this.scratch.length < 8) this.scratch += k;
    } else if (k === 'CLR') {
      this.scratch = '';
    } else if (k === 'ENT') this.enter();
    else if (k === 'A/P') this.setMode('AP');
    else if (k === 'IFF') this.setMode('IFF');
    else if (k === 'TCN') this.setMode('TCN');
    else if (k === 'ILS') this.setMode('ILS');
    else if (k === 'D/L') this.setMode(this.mode === 'DL4' ? 'DL16' : 'DL4');
    else if (k === 'BCN') { this.bcn = !this.bcn; }
    else if (k === 'EMCON') { this.emcon = !this.emcon; this.setMode('EMCON'); }
    else if (k === 'ON/OFF') { this.hold = { key: 'ON/OFF', t: 0 }; this.onOff(false); }
    else if (k === 'I/P') { this.flash = 1.5; }
    else if (k.startsWith('OSB')) this.option(+k.slice(3));
    this.dirty = true;
  }

  onOff(longPress) {
    const s = this.sim;
    if (this.mode === 'TCN') { this.tcn.on = !this.tcn.on; s.log('tcn', { on: this.tcn.on }); }
    if (this.mode === 'ILS') { this.ils.on = !this.ils.on; s.log('ils', { on: this.ils.on }); }
    // IFF and Link-16 need the ON/OFF key held for a couple of seconds (handled in update)
  }

  option(n) {
    const s = this.sim, i = n - 1;
    if (this.mode === 'COMM1' || this.mode === 'COMM2') {
      const c = this.comm[this.mode === 'COMM1' ? 1 : 2];
      const k = ['G', 'SQCH', 'CPHR', 'AM', 'FM'][i];
      if (k === 'AM' || k === 'FM') { c.opt.AM = k === 'AM'; c.opt.FM = k === 'FM'; } else c.opt[k] = !c.opt[k];
      this.setMode(this.mode);
    } else if (this.mode === 'TCN') {
      if (i <= 2) this.tcn.mode = ['T/R', 'RCV', 'A/A'][i]; else this.tcn.band = i === 3 ? 'X' : 'Y';
      this.setMode('TCN');
    } else if (this.mode === 'IFF') {
      if (i === 3) s.iff.mode4A = true; if (i === 4) s.iff.mode4A = false;
      this.setMode('IFF');
    } else if (this.mode === 'AP') {
      const k = Object.keys(this.ap.modes)[i];
      this.flash = 1.0;     // A/P cannot engage with weight on wheels
    } else if (this.mode === 'TIME') {
      if (i <= 1) { this.time.sel = i === 0 ? 'ZTOD' : 'LTOD'; s.log('timeSel', { sel: this.time.sel }); }
      this.setMode('TIME');
    } else if (this.mode === 'WYPT') {
      if (i === 0) this.setMode('POSN');
      if (i === 1) { this.wypt.field = 'ELEV'; this.optSel = [false, true, false, false, false]; }
    } else if (this.mode === 'POSN') {
      this.wypt.field = i === 0 ? 'LAT' : 'LON'; this.optSel = [i === 0, i === 1, false, false, false];
    }
  }

  enter() {
    const s = this.sim, v = this.scratch;
    if (!v) return;
    if (this.mode === 'COMM1' || this.mode === 'COMM2') {
      const c = this.comm[this.mode === 'COMM1' ? 1 : 2];
      if (v.length >= 5) {
        const f = (parseInt(v, 10) / 1000).toFixed(3);
        if (CHANNELS[c.ch - 1] === 'M') c.manual = f; else c.presets[CHANNELS[c.ch - 1]] = f;
        s.log('commFreq', { radio: this.mode, f });
      }
    } else if (this.mode === 'TCN') { const n = parseInt(v, 10); if (n >= 1 && n <= 126) this.tcn.ch = n; }
    else if (this.mode === 'ILS') { const n = parseInt(v, 10); if (n >= 1 && n <= 20) this.ils.ch = n; }
    else if (this.mode === 'DL16') { s.dl.freq = parseInt(v, 10); s.log('dlFreq', { f: s.dl.freq }); }
    else if (this.mode === 'WYPT' || this.mode === 'POSN') {
      const w = (s.waypoints = s.waypoints || []);
      const cur = w[this.wypt.idx] || (w[this.wypt.idx] = { lat: 'N 42°10.91', lon: 'E 42°27.85', elev: 0 });
      if (this.wypt.field === 'ELEV') cur.elev = parseInt(v, 10);
      if (this.wypt.field === 'LAT' || this.wypt.field === 'LON') {
        const hemi = v[0] === '2' ? 'N' : v[0] === '8' ? 'S' : v[0] === '4' ? 'W' : v[0] === '6' ? 'E' : null;
        const d = hemi ? v.slice(1) : v;
        const txt = `${hemi || (this.wypt.field === 'LAT' ? 'N' : 'E')} ${d.slice(0, 2)}°${d.slice(2, 4)}.${d.slice(4, 6) || '00'}`;
        cur[this.wypt.field === 'LAT' ? 'lat' : 'lon'] = txt;
      }
      s.log('wyptEdit', { idx: this.wypt.idx });
    }
    this.scratch = '';
    this.dirty = true;
  }

  commKnob(radio, delta) {           // rotate channel selector
    const c = this.comm[radio];
    c.ch = ((c.ch - 1 + delta + CHANNELS.length) % CHANNELS.length) + 1;
    this.sim.log('commChan', { radio, ch: CHANNELS[c.ch - 1] });
    if (this.mode === 'COMM' + radio) this.scratch = '';
    this.dirty = true;
  }
  commPull(radio) { if (this.powered()) this.setMode('COMM' + radio); }

  update(dt) {
    const s = this.sim;
    if (this.flash > 0) this.flash -= dt;
    if (this.hold.key === 'ON/OFF') {
      this.hold.t += dt;
      if (this.hold.t > 1.6 && !this.hold.done) {
        this.hold.done = true;
        if (this.mode === 'IFF') { s.iff.on = !s.iff.on; s.log('iff', { on: s.iff.on }); }
        if (this.mode === 'DL16') { s.dl.link16 = !s.dl.link16; s.log('link16', { on: s.dl.link16 }); }
        this.dirty = true;
      }
    } else if (this.hold.done) this.hold.done = false;
  }

  // ---------------- display text for each window
  texts() {
    const s = this.sim, ch = (r) => CHANNELS[this.comm[r].ch - 1];
    let left = '', main = '';
    const m = this.mode;
    if (m === 'COMM1' || m === 'COMM2') {
      const r = m === 'COMM1' ? 1 : 2, c = this.comm[r], k = ch(r);
      left = k.length === 1 ? k : k; main = this.scratch || (k === 'M' ? c.manual : c.presets[k]).replace('.', '');
      left = r === 1 ? '1' : '2';
      if (!this.scratch) main = (k === 'M' ? c.manual : c.presets[k]);
    } else if (m === 'TCN') { left = this.tcn.on ? '' : ''; main = this.scratch || (this.tcn.on ? `${this.tcn.ch}${this.tcn.band}` : 'OFF'); }
    else if (m === 'ILS') { main = this.scratch || (this.ils.on ? `ON ${this.ils.ch}` : `OFF ${this.ils.ch}`); }
    else if (m === 'IFF') { main = this.scratch || (s.iff.on ? 'XP' : 'OFF'); }
    else if (m === 'DL4') { main = 'OFF'; }
    else if (m === 'DL16') { main = this.scratch || (s.dl.link16 ? `ON ${s.dl.freq}` : `${s.dl.freq}`); }
    else if (m === 'AP') { main = this.flash > 0 ? 'NO AP' : ''; }
    else if (m === 'TIME') { const t = s.t + 12 * 3600; const h = Math.floor(t / 3600) % 24, mi = Math.floor(t / 60) % 60, se = Math.floor(t) % 60; main = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}`; left = this.time.sel === 'ZTOD' ? 'Z' : 'L'; }
    else if (m === 'WYPT' || m === 'POSN') { left = String(this.wypt.idx); main = this.scratch || (this.wypt.field || ''); }
    else if (m === 'EMCON') { main = this.emcon ? 'EMCON' : ''; }
    else main = this.scratch;
    if (this.bcn && m === 'NONE') main = main || '';
    return { left, main, opts: this.opts, sel: this.optSel, c1: ch(1), c2: ch(2) };
  }

  // draw on the UFC face canvas (legend image already painted by caller)
  draw(ctx, W, H, ap) {
    if (!this.powered() || !ap) return;
    const t = this.texts();
    const b = 0.45 + 0.55 * this.sim.sw.ufcBrt;
    const col = `rgba(77,255,106,${b})`;
    const put = (rect, str, size, align = 'right') => {
      if (!rect || !str) return;
      const x = rect.x * W, y = rect.y * H, w = rect.w * W, h = rect.h * H;
      ctx.fillStyle = 'rgba(0,18,4,0.9)'; ctx.fillRect(x, y, w, h);
      ctx.font = FONT(size || h * 0.62); ctx.fillStyle = col; ctx.textBaseline = 'middle';
      ctx.textAlign = align; ctx.fillText(str, align === 'right' ? x + w - h * 0.15 : align === 'center' ? x + w / 2 : x + h * 0.15, y + h / 2 + 1);
    };
    const sp = ap.scratch;
    if (sp) {
      const x = sp.x * W, y = sp.y * H, w = sp.w * W, h = sp.h * H;
      ctx.fillStyle = 'rgba(0,18,4,0.9)'; ctx.fillRect(x, y, w, h);
      ctx.font = FONT(h * 0.7); ctx.fillStyle = col; ctx.textBaseline = 'middle';
      ctx.textAlign = 'left'; ctx.fillText(t.left, x + h * 0.15, y + h / 2 + 1);
      ctx.textAlign = 'right'; ctx.fillText(t.main, x + w - h * 0.15, y + h / 2 + 1);
    }
    if (ap.options) {
      const o = ap.options, n = 5;
      for (let i = 0; i < n; i++) {
        const r = { x: o.x + o.w * 0.04, y: o.y + o.h * (0.02 + i * 0.196), w: o.w * 0.92, h: o.h * 0.17 };
        const txt = t.opts[i] ? (t.sel[i] ? ':' : ' ') + t.opts[i] : '';
        put(r, txt, null, 'left');
      }
    }
    put(ap.comm1, t.c1, null, 'center');
    put(ap.comm2, t.c2, null, 'center');
  }
}

export { CHANNELS };
