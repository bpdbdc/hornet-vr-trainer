// Cockpit audio, all synthesised (WebAudio) — no recorded assets.
// Engines / APU spool, ECS hiss, hydraulic pumps, canopy motor, airflow, switch clicks, master caution,
// AIM-9 growl / tone, ALR-67 RWR tones, gun, launches, explosions, radio clicks, voice alerts (speech synthesis).
export class Audio {
  constructor(sim) {
    this.sim = sim; this.ctx = null; this.ready = false; this.k = null;
    this.voiceQ = []; this.lastVoice = {};
    sim.on((t, d) => {
      if (t === 'fireTestStart') this.fireVoice();
      if (t === 'fireTestStop') this.stopVoice();
      if (t === 'event' && this.ready) {
        if (d.type === 'switch' && d.user !== false) this.click(d.key === 'canopy' || d.key === 'parkBrake' ? 0.8 : 0.45);
        if (d.type === 'button' || d.type === 'osb') this.click(0.3, 2600);
        if (d.type === 'apuAutoOff') this.click(0.3);
      }
    });
  }
  attach(k) {
    this.k = k;
    k.scn.on((t, d) => {
      if (!this.ready) return;
      if (t === 'launch') this.whoosh(d.type && d.type.startsWith('AIM-120') ? 1 : 0.8);
      if (t === 'release') this.thunk();
      if (t === 'kill' || t === 'impact') { const r = d.c ? k.scn.rel(d.c).rngNm : Math.hypot(d.e - k.scn.own.e, d.n - k.scn.own.n) / 1852; setTimeout(() => this.boom(Math.max(0.05, 1 - r / 15)), Math.min(8000, r * 1852 / 340 * 1000)); }
      if (t === 'ownHit') this.boom(1.4);
    });
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const noiseSrc = (type, freq, q) => {
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return { f, g };
    };
    const osc = (type, freq) => { const o = c.createOscillator(); o.type = type; o.frequency.value = freq; const g = c.createGain(); g.gain.value = 0; o.connect(g); g.connect(this.master); o.start(); return { o, g }; };
    const mk = (freq) => { const n = noiseSrc('bandpass', freq, 1.2); const t = osc('sawtooth', 200); return { f: n.f, g: n.g, osc: t.o, og: t.g }; };
    this.apu = mk(900); this.eng = { L: mk(300), R: mk(320) };
    this.rumble = noiseSrc('lowpass', 120, 0.7);
    this.ecs = noiseSrc('highpass', 2500, 0.5);
    this.wind = noiseSrc('bandpass', 600, 0.4);
    this.hydr = osc('triangle', 1600);
    this.canopy = osc('sawtooth', 110);
    this.tone = osc('sine', 1000);                         // master caution
    this.gun = noiseSrc('lowpass', 900, 2);
    // AIM-9: growl (low, AM-modulated) vs tone (high)
    this.aim9 = osc('sine', 380);
    this.aim9lfo = c.createOscillator(); this.aim9lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 60; this.aim9lfo.connect(lg); lg.connect(this.aim9.o.frequency); this.aim9lfo.start();
    this.rwr = osc('square', 1200);
    this.ready = true;
  }
  // --------------------------------------------------------------- one-shots
  burst(dur, f0, f1, vol, type = 'bandpass', q = 1.5) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 1 + Math.random() * 0.3;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur + 0.05);
  }
  click(v = 0.5, f = 1800) { this.burst(0.035, f, f * 0.6, 0.25 * v, 'bandpass', 3); this.burst(0.02, 4500, 3000, 0.1 * v, 'highpass', 1); }
  whoosh(v) { this.burst(2.2, 1800, 200, 0.5 * v, 'bandpass', 0.8); this.burst(0.25, 300, 80, 0.6 * v, 'lowpass', 1); }
  thunk() { this.burst(0.18, 220, 60, 0.6, 'lowpass', 2); this.click(0.8, 900); }
  boom(v) { this.burst(1.6, 260, 30, 0.9 * Math.min(1.5, v), 'lowpass', 1); }
  radioClick(on) { this.burst(on ? 0.05 : 0.12, on ? 2200 : 3000, on ? 1500 : 900, 0.15, 'bandpass', 1.5); }

  // --------------------------------------------------------------- speech
  speak(text, opt = {}) {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US';
    u.rate = opt.radio ? 1.12 : 1.05; u.pitch = opt.pilot ? 0.8 : opt.betty ? 1.25 : 1.0; u.volume = Math.min(1, (opt.vol ?? 0.6) * 1.4);
    if (opt.radio) { u.onstart = () => this.radioClick(true); u.onend = () => this.radioClick(false); }
    speechSynthesis.speak(u);
  }
  cancelSpeech() { if (window.speechSynthesis) speechSynthesis.cancel(); }
  betty(key, text, every = 12) {
    const t = this.sim.t;
    if (this.lastVoice[key] !== undefined && t - this.lastVoice[key] < every) return;
    this.lastVoice[key] = t; this.speak(text, { betty: true, vol: this.sim.sw.volIcs ?? 0.6 });
  }
  fireVoice() {
    if (!window.speechSynthesis) return;
    this.stopVoice();
    const msgs = ['Engine fire left', 'Engine fire left', 'Engine fire right', 'Engine fire right', 'A P U fire', 'A P U fire', 'Bleed air left', 'Bleed air left', 'Bleed air right', 'Bleed air right'];
    for (const m of msgs) { const u = new SpeechSynthesisUtterance(m); u.lang = 'en-US'; u.rate = 1.15; u.pitch = 1.25; speechSynthesis.speak(u); }
  }
  stopVoice() { if (window.speechSynthesis) speechSynthesis.cancel(); }

  // --------------------------------------------------------------- continuous
  update() {
    if (!this.ready) return;
    const s = this.sim, t = this.ctx.currentTime, k = this.k;
    const set = (p, v, tc = 0.2) => p.setTargetAtTime(v, t, tc);
    const a = s.apu.n / 100;
    set(this.apu.g.gain, 0.05 * a); set(this.apu.f.frequency, 500 + 1800 * a, 0.3);
    set(this.apu.osc.frequency, 200 + 900 * a, 0.3); set(this.apu.og.gain, 0.004 * a);
    let nMax = 0;
    for (const side of ['L', 'R']) {
      const g = s.eng[side], n = g.n2 / 100, e = this.eng[side]; nMax = Math.max(nMax, n);
      set(e.g.gain, 0.07 * n + (g.ab ? 0.05 : 0), 0.3); set(e.f.frequency, 150 + 1400 * n, 0.4);
      set(e.osc.frequency, 80 + 1200 * n, 0.4); set(e.og.gain, 0.006 * n, 0.3);
    }
    const ab = s.eng.L.ab || s.eng.R.ab;
    set(this.rumble.g.gain, 0.12 * Math.max(0, nMax - 0.6) + (ab ? 0.25 : 0), 0.4);
    // ECS airflow once generators are on line, hydraulic pump whine while pressure builds
    set(this.ecs.g.gain, s.elec.ac ? 0.012 + 0.01 * nMax : 0, 0.8);
    const hydBuild = (s.hyd.h1 > 200 && s.hyd.h1 < 2900) || (s.hyd.h2 > 200 && s.hyd.h2 < 2900);
    set(this.hydr.g.gain, hydBuild ? 0.006 : (s.hyd.h1 > 2900 ? 0.0012 : 0), 0.3); set(this.hydr.o.frequency, 900 + s.hyd.h2 / 3000 * 900, 0.5);
    // canopy motor
    this.lastCan = this.lastCan ?? s.canopyPos;
    const moving = Math.abs(s.canopyPos - this.lastCan) > 1e-5; this.lastCan = s.canopyPos;
    set(this.canopy.g.gain, moving ? 0.01 : 0, 0.05);
    // master caution: double-chime style 0.6 s cycle
    const mc = s.masterCaution && s.elec.batt;
    set(this.tone.g.gain, mc && (t % 0.6 < 0.3) ? 0.03 : 0, 0.02);
    if (!k) return;
    const o = k.scn.own, air = !o.wow;
    // airflow over the canopy
    const q = air ? Math.min(1, o.cas / 500) : 0;
    set(this.wind.g.gain, 0.06 * q * q + (s.speedBrake > 0.1 ? 0.03 * q : 0), 0.5); set(this.wind.f.frequency, 300 + 900 * q, 0.5);
    // gun (M61A2 ~ 6000 rds/min → buzz)
    set(this.gun.g.gain, k.wpn.gun.firing ? 0.35 : 0, 0.02);
    // AIM-9 tone, WPN volume knob
    const vw = (s.sw.volWpn ?? 0.5);
    const tone = k.wpn.seeker.tone || 0;
    set(this.aim9.g.gain, tone > 0 ? 0.03 * vw * (tone > 0.5 ? 1.4 : 0.8) : 0, 0.05);
    set(this.aim9.o.frequency, tone > 0.5 ? 1250 : 380, 0.03); this.aim9lfo.frequency.setTargetAtTime(tone > 0.5 ? 0.5 : 7, t, 0.05);
    // ALR-67: new threat = short beeps, lock = repeating, launch = fast warble
    const cues = k.ew.cues, vr = (s.sw.volRwr ?? 0.5) * 0.04;
    let rv = 0, rf = 1200;
    if (cues.launch) { rv = vr; rf = (t * 8) % 1 < 0.5 ? 1500 : 900; }
    else if (cues.lock) { rv = (t % 0.5) < 0.25 ? vr : 0; rf = 1100; }
    else if (cues.newT && s.t - cues.newT < 1.2) { rv = (t * 5) % 1 < 0.5 ? vr * 0.8 : 0; rf = 1300; }
    set(this.rwr.g.gain, rv, 0.01); set(this.rwr.o.frequency, rf, 0.01);
    // voice alerts (DCS-style "Betty")
    if (s.elec.ac && air) {
      if (s.bingo > 0 && s.fuelTotal < s.bingo) this.betty('bingo', 'Bingo, bingo', 30);
      const agl = o.alt * 0.3048 - (k.scn.terrainElev || 0);
      if (s.radaltOn && s.sw.radaltIdx > 0 && agl / 0.3048 < s.sw.radaltIdx) this.betty('alt', 'Altitude, altitude', 10);
      if (s.fcs.xs) this.betty('fcs', 'Flight controls, flight controls', 20);
      if (s.fuelInt < 800) this.betty('fuellow', 'Fuel low, fuel low', 30);
    }
  }
}
