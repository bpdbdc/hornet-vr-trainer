// Small synthesised soundscape: two jet engines, afterburner roar, wind, warning beeps.
export class FlyAudio {
  constructor() { this.ctx = null; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    const noise = (() => { const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); let l = 0; for (let i = 0; i < d.length; i++) { l = 0.97 * l + 0.03 * (Math.random() * 2 - 1); d[i] = l * 6 + (Math.random() * 2 - 1) * 0.15; } const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; return s; });
    const master = this.master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    const mk = (type, freq, q) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q; return f; };
    // engine rumble
    this.n1 = noise(); this.f1 = mk('bandpass', 400, 0.7); this.g1 = ctx.createGain(); this.n1.connect(this.f1).connect(this.g1).connect(master);
    // afterburner
    this.n2 = noise(); this.f2 = mk('lowpass', 500); this.g2 = ctx.createGain(); this.n2.connect(this.f2).connect(this.g2).connect(master);
    // wind
    this.n3 = noise(); this.f3 = mk('highpass', 700); this.g3 = ctx.createGain(); this.n3.connect(this.f3).connect(this.g3).connect(master);
    // turbine whine
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth'; this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth';
    this.fw = mk('lowpass', 1800); this.gw = ctx.createGain(); this.o1.connect(this.fw); this.o2.connect(this.fw); this.fw.connect(this.gw).connect(master);
    for (const n of [this.n1, this.n2, this.n3, this.o1, this.o2]) n.start();
  }
  beep(freq = 880, dur = 0.12, vol = 0.25) {
    if (!this.ctx) return; const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  update(sim) {
    if (!this.ctx || this.ctx.state !== 'running') return; const t = this.ctx.currentTime, f = sim.fl, e = f.eng;
    const alive = f.mode !== 'crashed' && !f.flameout, spool = alive ? e.mil : 0, ab = alive ? e.ab : 0;
    const v = Math.min(1, f.speed / 300);
    this.f1.frequency.setTargetAtTime(220 + 900 * spool, t, 0.1); this.g1.gain.setTargetAtTime(0.18 + 0.5 * spool, t, 0.1);
    this.f2.frequency.setTargetAtTime(350 + 400 * ab, t, 0.1); this.g2.gain.setTargetAtTime(ab * 0.9, t, 0.15);
    this.f3.frequency.setTargetAtTime(600 + 1500 * v, t, 0.2); this.g3.gain.setTargetAtTime(v * v * 0.5, t, 0.2);
    this.o1.frequency.setTargetAtTime(110 + 520 * spool, t, 0.12); this.o2.frequency.setTargetAtTime(118 + 540 * spool, t, 0.12); this.gw.gain.setTargetAtTime(alive ? 0.012 + 0.03 * spool : 0, t, 0.15);
  }
}
