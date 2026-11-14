import * as THREE from 'three';

// Cold-start exam (ground, field). Reference order: Chuck's guide (25/04/2025) PART 4, cross-checked with
// the ED Early Access guide "Cold Start". Optional items are reported but not counted.
export const STEPS = [
  { id: 'seat', txt: 'Siège éjectable ARMÉ (poignée vers le bas)', ref: 'Chuck 1' },
  { id: 'park', txt: 'Frein de parking serré pendant la mise en route', ref: 'Chuck 2' },
  { id: 'marm', txt: 'MASTER ARM sur SAFE', ref: 'Chuck 3' },
  { id: 'batt', txt: 'BATTERY sur ON', ref: 'Chuck 4 / ED 1' },
  { id: 'fireA', txt: 'FIRE & BLEED AIR TEST – boucle A', ref: 'Chuck 6 / ED 2', opt: true },
  { id: 'fireB', txt: 'FIRE & BLEED AIR TEST – boucle B', ref: 'Chuck 8 / ED 2', opt: true },
  { id: 'apu', txt: 'APU sur ON, attendre le voyant vert READY', ref: 'Chuck 10-12 / ED 3' },
  { id: 'crankR', txt: 'ENG CRANK sur R (moteur droit en premier) après APU READY', ref: 'Chuck 13 / ED 4' },
  { id: 'thrR', txt: 'Manette droite OFF → IDLE à 25 % RPM ou plus', ref: 'Chuck 15 / ED 5' },
  { id: 'egtR', txt: 'EGT droite sous 750 °C au démarrage', ref: 'Chuck 16' },
  { id: 'displays', txt: 'DDI gauche et droit sur DAY/NIGHT, AMPCD allumé, HUD allumé', ref: 'Chuck 20-22 / ED 8' },
  { id: 'hudSet', txt: 'HUD : BLK LVL tourné, ALT sur RDR, ATT sur AUTO', ref: 'Chuck 23-25' },
  { id: 'bleed', txt: 'BLEED AIR : rotation 360° NORM → NORM (après le test feu)', ref: 'Chuck 26 / ED 6' },
  { id: 'canopy', txt: 'Verrière fermée', ref: 'Chuck 27' },
  { id: 'insGnd', txt: 'INS sur GND (alignement au sol)', ref: 'Chuck 28a / ED 12' },
  { id: 'fcsReset', txt: 'FCS RESET effectué (les X disparaissent de la page FCS)', ref: 'Chuck 33 / ED 15' },
  { id: 'bitStop', txt: 'Page BIT : STOP pressé', ref: 'Chuck 34' },
  { id: 'ltTest', txt: 'LIGHTS TEST effectué', ref: 'Chuck 35 / ED 7' },
  { id: 'crankL', txt: 'ENG CRANK sur L une fois le moteur droit stabilisé', ref: 'Chuck 36 / ED 10' },
  { id: 'thrL', txt: 'Manette gauche OFF → IDLE à 25 % RPM ou plus', ref: 'Chuck 38 / ED 11' },
  { id: 'egtL', txt: 'EGT gauche sous 750 °C au démarrage', ref: 'Chuck 39' },
  { id: 'obogs', txt: 'OBOGS sur ON et OXY FLOW sur ON', ref: 'Chuck 43 / ED 14' },
  { id: 'hook', txt: 'HOOK BYPASS sur FIELD', ref: 'Chuck 44' },
  { id: 'flaps', txt: 'FLAPS sur HALF', ref: 'Chuck 45 / ED 19' },
  { id: 'antiskid', txt: 'ANTI SKID sur ON', ref: 'Chuck 46' },
  { id: 'radar', txt: 'RADAR sur OPR', ref: 'Chuck 47 / ED 13' },
  { id: 'fcsBit', txt: 'FCS BIT réussi (FCSA / FCSB = GO)', ref: 'Chuck 48-49 / ED 18' },
  { id: 'toTrim', txt: 'T/O TRIM pressé', ref: 'Chuck 53 / ED 17' },
  { id: 'pitot', txt: 'PITOT HEAT sur AUTO', ref: 'Chuck 54' },
  { id: 'radalt', txt: 'Radar altimètre réglé sur 200 ft', ref: 'Chuck 58 / ED 23' },
  { id: 'sbyAdi', txt: 'Horizon de secours décagé (drapeau OFF disparu)', ref: 'Chuck 59 / ED 24' },
  { id: 'bingo', txt: 'BINGO réglé sur l\'IFEI', ref: 'Chuck 60 / ED 21' },
  { id: 'rwr', txt: 'ALR-67 POWER allumé', ref: 'Chuck 61' },
  { id: 'ecm', txt: 'ECM sur STBY', ref: 'Chuck 62' },
  { id: 'disp', txt: 'DISPENSER sur ON', ref: 'Chuck 63' },
  { id: 'iff', txt: 'IFF allumé à l\'UFC (XP affiché)', ref: 'Chuck 64' },
  { id: 'dl', txt: 'Link-16 allumé à l\'UFC (D/L x2, ON maintenu)', ref: 'Chuck 65' },
  { id: 'insNav', txt: 'Alignement terminé (OK) puis INS sur IFA (ou NAV)', ref: 'Chuck 28d-f' },
  { id: 'lights', txt: 'Feux extérieurs : STROBE, POSITION, FORMATION, LDG/TAXI', ref: 'Chuck 78-82', opt: true },
  { id: 'release', txt: 'Frein de parking desserré en dernier', ref: 'Chuck 83 / ED 20' },
];

export class Exam {
  constructor(sim, cockpit) {
    this.sim = sim; this.cockpit = cockpit;
    this.active = false; this.done = false; this.t0 = null; this.result = null;
    sim.on((type, d) => this.onEvent(type, d));
  }

  start() {
    this.cockpit.resetAll();
    this.active = true; this.done = false; this.t0 = null; this.result = null;
    this.ev = {}; this.errors = []; this.flags = {};
  }

  first(k) { if (this.ev[k] === undefined) this.ev[k] = this.sim.t; }
  err(msg) { if (!this.errors.find(e => e.msg === msg)) this.errors.push({ t: this.sim.t, msg }); }

  onEvent(type, d) {
    if (!this.active || this.done || type !== 'event') return;
    const s = this.sim, e = s.eng;
    if (this.t0 === null && d.type === 'switch' && d.user) this.t0 = s.t;
    if (d.type === 'switch') {
      const k = d.key, v = d.value;
      if (k === 'seatArm' && v === 'ARMED') this.first('seat');
      if (k === 'battery' && v === 'ON') this.first('batt');
      if (k === 'battery' && v === 'OFF' && (e.L.lit && !e.L.started || e.R.lit && !e.R.started)) this.err('Batterie coupée pendant un démarrage moteur');
      if (k === 'apu' && v === 'ON') { this.first('apu'); if (!s.elec.batt) this.err('APU sélectionné sans batterie'); }
      if (k === 'apu' && v === 'OFF' && d.user && !(e.L.started && e.R.started)) this.err('APU coupé manuellement avant la fin de la mise en route des deux moteurs');
      if (k === 'crank' && v === 'R' && d.user) { this.first('crankR'); if (!s.apu.ready) this.err('ENG CRANK sur R avant le voyant APU READY'); }
      if (k === 'crank' && v === 'L' && d.user) {
        this.first('crankL');
        if (this.ev.crankR === undefined) this.err('Moteur gauche lancé en premier (la procédure démarre le moteur droit d\'abord)');
        else if (!e.R.started) this.err('ENG CRANK sur L avant la stabilisation du moteur droit (60-65 %)');
        if (!s.apu.ready) this.err('ENG CRANK sur L sans APU READY');
      }
      if ((k === 'throttleR' || k === 'throttleL') && v === 'IDLE') {
        const side = k === 'throttleR' ? 'R' : 'L', g = e[side];
        this.first('thr' + side);
        this.flags['thrN2' + side] = g.n2;
        if (g.n2 < 1) this.err(`Manette ${side === 'R' ? 'droite' : 'gauche'} sur IDLE sans rotation moteur (pas de démarrage)`);
        else if (g.n2 < 24.5) this.err(`Carburant introduit trop tôt sur le moteur ${side === 'R' ? 'droit' : 'gauche'} (${g.n2.toFixed(0)} % au lieu de 25 %)`);
      }
      if (k === 'fireTest' && v !== 'NORM' && !s.elec.batt) this.err('Test feu tenté sans batterie');
      if (k === 'masterArm' && v === 'ARM') this.err('MASTER ARM passé sur ARM au sol');
      if (k === 'parkBrake' && v === 'RELEASED') {
        this.first('releaseT');
        if (!(e.L.started && e.R.started)) this.err('Frein de parking desserré avant la mise en route des deux moteurs');
        setTimeout(() => { if (this.active && !this.done) this.finish(); }, 2500);
      }
      if (k === 'ins' && v === 'GND') { this.first('insGnd'); if (!s.elec.ac) this.flags.insNoPower = true; }
      if (k === 'ins' && (v === 'NAV' || v === 'IFA')) { if (s.ins.aligned) this.first('insNav'); else this.err('INS quitté de GND avant la fin de l\'alignement (OK)'); }
      if (k === 'ltTest' && v === 'TEST' && s.elec.batt) this.first('ltTest');
    }
    if (d.type === 'fireTestDone') this.first('fire' + d.loop);
    if (d.type === 'bleedReset') this.first('bleed');
    if (d.type === 'fcsResetOk') this.first('fcsReset');
    if (d.type === 'bitStop') this.first('bitStop');
    if (d.type === 'fcsBitGo') this.first('fcsBit');
    if (d.type === 'toTrim') this.first('toTrim');
    if (d.type === 'fcsBitRefused') this.err('FCS BIT lancé alors que les deux circuits hydrauliques ne sont pas sous pression');
  }

  // live monitoring (called every frame)
  update() {
    if (!this.active || this.done) return;
    const s = this.sim, sw = s.sw, e = s.eng;
    if ((e.R.peakEgt || 0) > 750) this.err('Surchauffe au démarrage du moteur droit (EGT > 750 °C)');
    if ((e.L.peakEgt || 0) > 750) this.err('Surchauffe au démarrage du moteur gauche (EGT > 750 °C)');
    const dispOn = sw.ddiL !== 'OFF' && sw.ddiR !== 'OFF' && sw.ampcdBrt > 0.05 && sw.hudSymBrt > 0.05 && s.elec.ac;
    if (dispOn) this.first('displays');
    if (sw.hudBlkLvl > 0.05 && sw.hudAlt === 'RDR' && sw.hudAtt === 'AUTO') this.first('hudSet');
    if (s.canopyPos < 0.01) this.first('canopy');
    if (sw.obogs === 'ON' && sw.oxyFlow === 'ON') this.first('obogs');
    if (sw.parkBrake !== 'SET' && !this.ev.releaseT) this.flags.parkLost = true;
  }

  finish() {
    if (!this.active) return;
    this.done = true; this.active = false;
    const s = this.sim, sw = s.sw, ev = this.ev, e = s.eng;
    const ok = {};
    ok.seat = ev.seat !== undefined && sw.seatArm === 'ARMED';
    ok.park = !this.flags.parkLost;
    ok.marm = sw.masterArm === 'SAFE' && !this.errors.find(x => x.msg.startsWith('MASTER ARM'));
    ok.batt = ev.batt !== undefined;
    ok.fireA = ev.fireA !== undefined; ok.fireB = ev.fireB !== undefined;
    ok.apu = ev.apu !== undefined && !this.errors.find(x => x.msg.includes('APU READY'));
    ok.crankR = ev.crankR !== undefined && (ev.crankL === undefined || ev.crankR < ev.crankL) && !this.errors.find(x => x.msg.includes('sur R avant'));
    ok.thrR = ev.thrR !== undefined && (this.flags.thrN2R ?? 0) >= 24.5 && e.R.started;
    ok.egtR = ev.thrR !== undefined && e.R.peakEgt <= 750;
    ok.displays = ev.displays !== undefined;
    ok.hudSet = ev.hudSet !== undefined || (sw.hudBlkLvl > 0.05 && sw.hudAlt === 'RDR' && sw.hudAtt === 'AUTO');
    ok.bleed = ev.bleed !== undefined || ((ev.fireA === undefined && ev.fireB === undefined) && s.bleedValves.L && s.bleedValves.R);
    ok.canopy = s.canopyPos < 0.01;
    ok.insGnd = ev.insGnd !== undefined;
    ok.fcsReset = ev.fcsReset !== undefined && !s.fcs.xs;
    ok.bitStop = ev.bitStop !== undefined;
    ok.ltTest = ev.ltTest !== undefined;
    ok.crankL = ev.crankL !== undefined && ev.crankR !== undefined && ev.crankL > ev.crankR && !this.errors.find(x => x.msg.includes('sur L avant'));
    ok.thrL = ev.thrL !== undefined && (this.flags.thrN2L ?? 0) >= 24.5 && e.L.started;
    ok.egtL = ev.thrL !== undefined && e.L.peakEgt <= 750;
    ok.obogs = sw.obogs === 'ON' && sw.oxyFlow === 'ON';
    ok.hook = sw.hookBypass === 'FIELD';
    ok.flaps = sw.flaps === 'HALF';
    ok.antiskid = sw.antiSkid === 'ON';
    ok.radar = sw.radar === 'OPR';
    ok.fcsBit = s.fcs.bitDone;
    ok.toTrim = s.toTrimDone;
    ok.pitot = sw.pitot === 'AUTO';
    ok.radalt = Math.abs((sw.radaltIdx || 0) - 200) <= 50;
    ok.sbyAdi = !sw.sbyAdiCaged;
    ok.bingo = s.bingo > 0;
    ok.rwr = !!sw.rwrPwr;
    ok.ecm = sw.ecm === 'STBY';
    ok.disp = sw.dispenser === 'ON';
    ok.iff = s.iff.on;
    ok.dl = s.dl.link16;
    ok.insNav = ev.insNav !== undefined && (sw.ins === 'IFA' || sw.ins === 'NAV');
    ok.lights = sw.strobe !== 'OFF' && sw.posLt > 0.1 && sw.formLt > 0.1 && sw.ldgTaxi === 'ON';
    ok.release = sw.parkBrake === 'RELEASED';
    const rows = STEPS.map(st => ({ ...st, ok: !!ok[st.id] }));
    const req = rows.filter(r => !r.opt);
    const nOk = req.filter(r => r.ok).length;
    const score = Math.max(0, Math.round(100 * nOk / req.length - this.errors.length * 3));
    const dur = this.t0 === null ? 0 : (this.ev.releaseT ?? s.t) - this.t0;
    this.result = { rows, errors: this.errors.slice(), score, nOk, nReq: req.length, dur };
    if (this.onFinish) this.onFinish(this.result);
    return this.result;
  }
}

// ------------------------------------------------------------------ floating exam panel (VR + desktop)
export class ExamPanel {
  constructor(scene, exam) {
    this.exam = exam; this.hitList = []; this.scroll = 0; this.visible = true;
    const W = 1024, H = 720;
    this.c = document.createElement('canvas'); this.c.width = W; this.c.height = H; this.ctx = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.group = new THREE.Group();
    this.group.position.set(0.0, 0.32, -1.05);
    this.group.lookAt(0, 0, 0);
    this.size = [0.62, 0.62 * H / W];
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...this.size), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: true, toneMapped: false }));
    this.group.add(mesh); scene.add(this.group);
    this.buttons = [];
    this.layout();
    this.draw();
  }
  btn(id, label, x, y, w, h, onClick) {
    const [PW, PH] = this.size;
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(w / 1024 * PW, h / 720 * PH), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set((x + w / 2) / 1024 * PW - PW / 2, PH / 2 - (y + h / 2) / 720 * PH, 0.002);
    const ctl = { ui: true, def: { name: label, type: 'ui' }, onClick, id };
    hit.userData.control = ctl; this.group.add(hit); this.hitList.push(hit);
    this.buttons.push({ id, label, x, y, w, h, hit });
  }
  layout() {
    for (const b of this.buttons) this.group.remove(b.hit);
    this.buttons = []; this.hitList = [];
    const ex = this.exam;
    this.btn('night', this.night ? 'JOUR' : 'NUIT', 700, 14, 120, 54, () => { this.night = !this.night; this.onNight && this.onNight(this.night); this.layout(); });
    this.btn('seatUp', 'SIÈGE ▲', 830, 14, 85, 54, () => this.onSeat && this.onSeat(0.01));
    this.btn('seatDn', '▼', 925, 14, 75, 54, () => this.onSeat && this.onSeat(-0.01));
    if (ex.active) {
      this.btn('finish', 'TERMINER', 40, 620, 300, 70, () => { ex.finish(); });
      this.btn('hide', 'MASQUER', 684, 620, 300, 70, () => this.toggle());
    } else {
      this.btn('start', ex.result ? 'RECOMMENCER' : "EXAMEN COLD START", 40, 620, 420, 70, () => { this.onScenario && this.onScenario('cold'); ex.start(); this.scroll = 0; this.layout(); });
      if (!ex.result) {
        const sc = [['hot', 'HOT SOL'], ['aa', 'AIR-AIR'], ['ag', 'AIR-SOL'], ['nav', 'NAV']];
        sc.forEach(([id, l], i) => this.btn('sc_' + id, l, 40 + i * 236, 530, 220, 66, () => { this.onScenario && this.onScenario(id); }));
      }
      this.btn('hide', 'MASQUER', 684, 620, 300, 70, () => this.toggle());
      if (ex.result) { this.btn('up', '▲', 940, 120, 60, 60, () => { this.scroll = Math.max(0, this.scroll - 6); }); this.btn('dn', '▼', 940, 540, 60, 60, () => { this.scroll += 6; }); }
    }
  }
  toggle() { this.visible = !this.visible; this.group.visible = this.visible; }
  draw() {
    const x = this.ctx, ex = this.exam, s = ex.sim;
    x.clearRect(0, 0, 1024, 720);
    x.fillStyle = 'rgba(12,16,22,0.92)'; x.fillRect(0, 0, 1024, 720);
    x.strokeStyle = '#7fd1ff'; x.lineWidth = 4; x.strokeRect(2, 2, 1020, 716);
    x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'top';
    x.font = 'bold 34px sans-serif'; x.fillText(this.title || 'F/A-18C · HORNET VR TRAINER', 40, 26);
    x.font = '26px sans-serif';
    if (ex.active) {
      const t = ex.t0 === null ? 0 : s.t - ex.t0;
      x.fillStyle = '#9fe0ff'; x.fillText(`Chrono : ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, 40, 90);
      x.fillStyle = '#ddd';
      const lines = ['Démarrage au sol (terrain), sans aide.', 'Effectue la procédure complète de mémoire,', 'jusqu\'au desserrage du frein de parking.', '', 'Le débrief détaillé s\'affiche à la fin', '(frein desserré ou bouton TERMINER).', '', `Erreurs détectées : ${ex.errors.length}`];
      lines.forEach((l, i) => x.fillText(l, 40, 150 + i * 38));
    } else if (ex.result) {
      const r = ex.result;
      x.fillStyle = r.score >= 80 ? '#5f5' : r.score >= 50 ? '#fc3' : '#f66';
      x.font = 'bold 32px sans-serif';
      x.fillText(`Score ${r.score}/100 · ${r.nOk}/${r.nReq} étapes · ${Math.floor(r.dur / 60)} min ${Math.floor(r.dur % 60)} s · ${r.errors.length} erreur(s)`, 40, 84);
      x.font = '22px sans-serif';
      const items = [];
      r.errors.forEach(e => items.push({ c: '#ff7b7b', t: '✗ ' + e.msg }));
      r.rows.forEach(rw => items.push({ c: rw.ok ? '#8f8' : (rw.opt ? '#bbb' : '#ff9a6b'), t: `${rw.ok ? '✓' : (rw.opt ? '–' : '✗')} ${rw.txt}  (${rw.ref}${rw.opt ? ', optionnel' : ''})` }));
      const view = items.slice(this.scroll, this.scroll + 16);
      view.forEach((it, i) => { x.fillStyle = it.c; x.fillText(it.t.length > 78 ? it.t.slice(0, 77) + '…' : it.t, 40, 130 + i * 30); });
    } else {
      x.fillStyle = '#ddd';
      const lines = this.brief || ['Cockpit OpenHornet 1:1 (F/A-18C Lot 20), comportement calé sur le module DCS.', '', 'Manettes : gâchette = avant / haut / horaire, grip = arrière / bas / anti-horaire.', 'Mains : appui du doigt, pincer + tourner pour les molettes.', 'B / Y : recentrer · X / A : ce panneau.', 'HOTAS virtuel : appui LONG sur le clic du stick (par main).', '', 'Examen : cockpit froid et sombre, sans aide.', 'Scénarios : jet en route, systèmes prêts (bouton ci-dessous).'];
      lines.forEach((l, i) => x.fillText(l, 40, 96 + i * 46));
    }
    for (const b of this.buttons) {
      x.fillStyle = '#1f3a52'; x.fillRect(b.x, b.y, b.w, b.h); x.strokeStyle = '#7fd1ff'; x.lineWidth = 3; x.strokeRect(b.x, b.y, b.w, b.h);
      x.fillStyle = '#fff'; x.font = `bold ${b.h < 60 ? 24 : 30}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
      x.textAlign = 'left'; x.textBaseline = 'top';
    }
    this.tex.needsUpdate = true;
  }
  update(dt) {
    this.acc = (this.acc || 0) + dt;
    const st = `${this.exam.active}${this.exam.done}`;
    if (st !== this.lastSt) { this.lastSt = st; this.layout(); }
    if (this.acc > 0.25) { this.acc = 0; this.draw(); }
  }
}
