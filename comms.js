import { NM, FT, wrap360 } from './scenario.js';

// Radio: COMM 1 / COMM 2 push-to-talk. The AWACS (DARKSTAR) answers when the radio is tuned to its frequency.
// COMM PTT tap = BOGEY DOPE, second tap within 1.5 s = PICTURE. Replies use DCS-style brevity (BRAA / bullseye).
const CH = [...Array.from({ length: 20 }, (_, i) => String(i + 1)), 'G', 'M', 'C', 'S'];
export const AWACS_FREQ = '254.500';      // COMM 1 preset 2 by default

const aspectOf = (a) => { a = Math.abs(a); return a < 30 ? 'hot' : a < 70 ? 'flank' : a < 110 ? 'beam' : 'drag'; };
const say3 = (n) => String(Math.round(n)).padStart(3, '0').split('').join(' ');
const angels = (ft) => `${Math.round(ft / 1000)} thousand`;

export class Comms {
  constructor(k) { this.k = k; this.lastTap = { 1: -9, 2: -9 }; this.log = []; this.ownCs = 'Enfield 1 1'; }
  freq(r) {
    const u = this.k.cockpit.ufc, c = u.comm[r]; if (!c) return null;
    const ch = CH[c.ch - 1];
    return ch === 'M' ? c.manual : c.presets[ch];
  }
  radioOn(r) { const s = this.k.sim; return (s.elec.batt || s.elec.ac) && (s.sw[`comm${r}Vol`] ?? 0.5) > 0.02; }
  ptt(r, down) {
    const s = this.k.sim, a = this.k.audio;
    if (down) { s.xmit = r; a && a.radioClick(true); return; }
    s.xmit = 0; a && a.radioClick(false);
    if (!this.radioOn(r)) return;
    const f = this.freq(r); s.log('ptt', { r, f });
    const awacs = this.k.scn.contacts.find(c => c.alive && c.type === 'E-3A');
    if (!awacs || f !== AWACS_FREQ) return;
    const second = s.t - this.lastTap[r] < 1.5; this.lastTap[r] = s.t;
    if (second) { a && a.cancelSpeech(); this.say('pilot', `Darkstar, ${this.ownCs}, picture.`, r); setTimeout(() => this.say('awacs', this.picture(), r), 1800); }
    else { this.say('pilot', `Darkstar, ${this.ownCs}, bogey dope.`, r); this.pending = setTimeout(() => this.say('awacs', this.bogeyDope(), r), 1800); }
  }
  hostiles() { return this.k.scn.contacts.filter(c => c.alive && c.kind === 'air' && c.hostile); }
  bogeyDope() {
    const scn = this.k.scn, h = this.hostiles().map(c => ({ c, r: scn.rel(c) })).sort((a, b) => a.r.rng - b.r.rng);
    if (!h.length) return `${this.ownCs}, Darkstar, clean.`;
    const { c, r } = h[0];
    return `${this.ownCs}, Darkstar, B R A A ${say3(r.brg)}, ${Math.round(r.rngNm)}, ${angels(c.alt)}, ${aspectOf(r.aspect)}, hostile.`;
  }
  picture() {
    const scn = this.k.scn, hs = this.hostiles();
    if (!hs.length) return `${this.ownCs}, Darkstar, picture clean.`;
    // group contacts within 5 NM of each other
    const groups = [];
    for (const c of hs) { const g = groups.find(g => Math.hypot(g[0].e - c.e, g[0].n - c.n) < 5 * NM); if (g) g.push(c); else groups.push([c]); }
    const parts = groups.slice(0, 3).map(g => { const b = scn.bullsRel(g[0].e, g[0].n); return `group bullseye ${say3(b.brg)}, ${Math.round(b.rng)}, ${angels(g[0].alt)}, hostile${g.length > 1 ? `, ${g.length} contacts` : ''}`; });
    return `${this.ownCs}, Darkstar, picture, ${groups.length} group${groups.length > 1 ? 's' : ''}. ` + parts.join('. ') + '.';
  }
  say(who, text, r) {
    this.log.push({ t: this.k.sim.t, who, text }); if (this.log.length > 8) this.log.shift();
    this.k.sim.lastRadio = { who, text, t: this.k.sim.t };
    const a = this.k.audio; if (a) a.speak(text, { radio: true, pilot: who === 'pilot', vol: this.k.sim.sw[`comm${r}Vol`] ?? 0.5 });
  }
}
