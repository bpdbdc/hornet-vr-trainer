import * as THREE from 'three';
import { NM, FT } from './scenario.js';

// Virtual HOTAS (F/A-18C stick + throttle functions) on the Quest controllers, plus a desktop keyboard map.
// Behaviour follows the DCS module: SCS assigns the TDC (diamond on the display), SCS toward the radar display
// RWS->TWS->STT, SCS fwd/aft/left = ACM BST/VACQ/WACQ, weapon select fwd/aft/depress/right = AIM-7/GUN/AIM-9/AIM-120,
// TGP: SCS toward its display toggles PTRK/ATRK, TDC depress designates, NWS undesignates, cage/uncage = LST.
//
// VR mapping (each hand enters / leaves HOTAS mode with a LONG press on its thumbstick):
//  RIGHT = stick  : trigger = gun/missile trigger (A/G: laser if TRIG boxed) · A = weapon release (pickle)
//                   B tap = undesignate / NWS · B held + stick fwd/aft/right/click = weapon select AIM-7/GUN/AIM-120/AIM-9
//                   stick flick = Sensor Control Switch · click = A/P disengage paddle · grip held = fly (wrist pitch/roll)
//  LEFT = throttle: stick = TDC slew · trigger = TDC depress · grip held = throttle (move hand fwd/aft)
//                   X = COMM 1 PTT · Y tap = COMM 2 PTT · Y held + stick up/down = radar antenna elevation
//                   click = cage/uncage · grip+X = countermeasures program · grip+Y = speed brake · grip+click = RAID/FLIR FOV
export const HOTAS_HELP = {
  R: ['MANCHE (droite)', 'Gâchette : tir canon/missile (A/G : laser)', 'A : largage (pickle)', 'B : undesignate / NWS', 'B maintenu + stick : sélection arme', '   avant AIM-7 · arrière GUN · droite AIM-120 · clic AIM-9', 'Stick : Sensor Control Switch', 'Grip maintenu : piloter (poignet)', 'Clic : palette A/P · Clic long : quitter'],
  L: ['MANETTE (gauche)', 'Stick : TDC · Gâchette : TDC enfoncé', 'Grip maintenu : manette des gaz (avant/arrière)', 'X : COMM 1 · Y : COMM 2', 'Y maintenu + stick : élévation antenne', 'Clic : cage/uncage', 'Grip+X : leurres · Grip+Y : aérofreins', 'Grip+clic : RAID/FLIR FOV · Clic long : quitter'],
};

const DIR = (x, y) => Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y < 0 ? 'fwd' : 'aft');

export class Hotas {
  constructor(k) {
    this.k = k;               // {sim, scn, radar, wpn, ew, tpod, cockpit, comms}
    this.tdcOwner = 'L';      // 'L' | 'R' | 'AMPCD' | 'HUD'
    this.hand = { L: { active: false }, R: { active: false } };
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.applyTdc();
    this.setupKeyboard();
  }
  get sim() { return this.k.sim; }
  ddis() { return this.k.cockpit.ddis || {}; }
  ownerDdi() { return this.tdcOwner === 'HUD' ? null : this.ddis()[this.tdcOwner]; }
  ownerPage() { const d = this.ownerDdi(); return d ? d.page : 'HUD'; }
  applyTdc() { for (const [id, d] of Object.entries(this.ddis())) d.hasTdc = id === this.tdcOwner; }
  findPage(page) { for (const [id, d] of Object.entries(this.ddis())) if (d.page === page && d.powered()) return id; return null; }

  // ---------------------------------------------------------------- stick functions
  scs(dir) {
    const { wpn, radar, tpod } = this.k, s = this.sim;
    if (!s.elec.ac) return;
    s.log('hotas', { f: 'SCS', dir });
    const target = { fwd: 'HUD', aft: 'AMPCD', left: 'L', right: 'R' }[dir];
    if (wpn.master === 'AA') {
      if (dir === 'fwd' || (radar.mode === 'ACM' && (dir === 'aft' || dir === 'left'))) { radar.scs(dir, false); return; }
    }
    const d = this.ddis()[target];
    if (target === this.tdcOwner && d) {
      // SCS toward the display that already has the TDC
      if (d.page === 'RDR ATTK') radar.scs('toward', true);
      else if (d.page === 'FLIR' && tpod) { if (tpod.track === 'POINT') tpod.areaTrack(); else tpod.pointTrack(); }
      else if (d.page === 'MAV' && tpod) tpod.mavLock();
      return;
    }
    if (target === 'AMPCD' && d && d.page === 'FLIR') return;      // TGP not available on the AMPCD
    this.tdcOwner = target; this.applyTdc();
  }
  undesignate() {
    const { wpn, radar, tpod } = this.k, s = this.sim;
    s.log('hotas', { f: 'UNDESIG' });
    if (wpn.master === 'AG' || (wpn.master === 'NAV' && s.agTarget)) {
      if (this.ownerPage() === 'MAV') { wpn.ag.mavTrack = null; return; }
      if (s.agTarget || (tpod && tpod.track !== 'SNO')) { tpod && tpod.undesignate(); s.agTarget = null; s.log('undesignate', {}); return; }
      return;
    }
    radar.undesignate();
  }
  weaponSelect(dir) {
    const { wpn } = this.k, s = this.sim;
    if (!s.elec.ac) return;
    const kind = { fwd: 'AIM-7', aft: 'GUN', down: 'AIM-9', right: 'AIM-120' }[dir];
    if (kind) { wpn.selectAA(kind); s.log('hotas', { f: 'WPNSEL', kind }); }
  }
  trigger(down) {
    const { wpn, tpod } = this.k, s = this.sim;
    if (wpn.master === 'AG') { s.laserFire = down; return; }
    wpn.trigger(down);
  }
  pickle(down) { this.k.wpn.pickle(down); }
  paddle() { const scn = this.k.scn; if (scn.ap) { scn.ap = null; this.sim.log('apOff', {}); } }

  // ---------------------------------------------------------------- throttle functions
  tdc(dx, dy, dt) {
    if (!dx && !dy) return;
    const { radar, tpod, wpn } = this.k, page = this.ownerPage();
    if (page === 'RDR ATTK' || (page === 'HUD' && wpn.master === 'AA')) {
      if (wpn.master === 'AG') { const c = radar.agCursor; c.az = Math.max(-60, Math.min(60, c.az + dx * 30 * dt)); c.rng = Math.max(0.5, Math.min(radar.agRng, c.rng + dy * radar.agRng * 0.4 * dt)); }
      else radar.tdcSlew(dx, dy, dt);
    } else if (page === 'FLIR' && tpod) tpod.slew(dx, -dy, dt);
    else if (page === 'MAV' && tpod) tpod.mavSlew(dx, -dy, dt);
    else if (page === 'HUD' && wpn.master === 'AG') { this.hudTd = this.hudTd || { az: 0, el: -4 }; this.hudTd.az = Math.max(-9, Math.min(9, this.hudTd.az + dx * 4 * dt)); this.hudTd.el = Math.max(-12, Math.min(6, this.hudTd.el + dy * 4 * dt)); }
  }
  tdcPress(down) {
    if (!down) return;
    const { radar, tpod, wpn, scn } = this.k, s = this.sim, page = this.ownerPage();
    s.log('hotas', { f: 'TDC', page });
    if (page === 'RDR ATTK') {
      if (wpn.master === 'AG') {
        const c = radar.agCursor, o = scn.own, a = (o.hdg + c.az) * Math.PI / 180;
        s.agTarget = { e: o.e + Math.sin(a) * c.rng * NM, n: o.n + Math.cos(a) * c.rng * NM, alt: 0, src: 'RDR' }; s.log('designate', { src: 'RDR' });
      } else radar.tdcDepress();
    } else if (page === 'FLIR' && tpod) tpod.designate();
    else if (page === 'MAV' && tpod) tpod.mavLock();
    else if (page === 'HUD' && wpn.master === 'AG' && tpod) {
      const td = this.hudTd || { az: 0, el: -4 };
      const p = tpod.groundPoint(td.az, td.el);
      if (p) { s.agTarget = { ...p, src: 'HUD' }; s.log('designate', { src: 'HUD' }); }
    }
  }
  cage() {
    const { wpn, tpod } = this.k, s = this.sim;
    if (wpn.master === 'AA' && wpn.aaSel && wpn.aaSel.startsWith('AIM-9')) { wpn.seeker.caged = !wpn.seeker.caged; s.log('hotas', { f: 'CAGE', caged: wpn.seeker.caged }); return; }
    if (wpn.master === 'AG' && this.ownerPage() === 'FLIR' && tpod) { tpod.lst = !tpod.lst; return; }
    if (wpn.master === 'AG' && wpn.agDef() && wpn.agDef().def.type === 'mav') { wpn.ag.mavCaged = !wpn.ag.mavCaged; }
  }
  raidFov() {
    const { radar, tpod } = this.k, page = this.ownerPage();
    if (page === 'FLIR' && tpod) tpod.cycleFov();
    else if (radar.mode === 'TWS') radar.cycle('raid');
  }
  elevation(dy, dt) { if (dy) { if (this.ownerPage() === 'FLIR' && this.k.tpod) { /* zoom */ } else this.k.radar.elevSlew(dy, dt); } }
  dispense(kind) { this.k.ew.dispense(kind); }
  speedBrake(cmd) { const s = this.sim; s.spdBrkCmd = cmd ?? (s.spdBrkCmd === 'EXT' ? 'RET' : 'EXT'); s.log('hotas', { f: 'SPDBRK', cmd: s.spdBrkCmd }); }
  comm(n, down) { this.k.comms && this.k.comms.ptt(n, down); }
  atc() {
    const scn = this.k.scn, s = this.sim;
    if (scn.atc) { scn.atc = null; s.log('atc', { on: false }); return; }
    if (scn.own.wow || !s.elec.ac) return;
    scn.atc = { cas: scn.own.cas, thr: s.thrAxis.L }; s.log('atc', { on: true, cas: Math.round(scn.own.cas) });
  }
  throttle(ax) { const v = Math.max(0, Math.min(1.3, ax)); this.sim.thrAxis.L = this.sim.thrAxis.R = v; }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    const s = this.sim, scn = this.k.scn;
    // keyboard: continuous inputs
    const K = this.keys;
    const tx = (K.has('ArrowRight') ? 1 : 0) - (K.has('ArrowLeft') ? 1 : 0), ty = (K.has('ArrowUp') ? 1 : 0) - (K.has('ArrowDown') ? 1 : 0);
    if (!this.ctrlHeld && !this.altHeld) this.tdc(tx, ty, dt);
    if (K.has('PageUp')) this.throttle(s.thrAxis.L + 0.35 * dt);
    if (K.has('PageDown')) this.throttle(s.thrAxis.L - 0.35 * dt);
    if (K.has('BracketRight')) this.elevation(1, dt);
    if (K.has('BracketLeft')) this.elevation(-1, dt);
    const kx = (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0), ky = (K.has('KeyS') ? 1 : 0) - (K.has('KeyW') ? 1 : 0);
    if (kx || ky || this.kbStick) { this.kbStick = !!(kx || ky); this.stick.x = kx; this.stick.y = ky; }
    // ATC (approach power compensator / cruise): holds the airspeed at engagement, off if the throttles are moved
    if (scn && scn.atc) {
      const a = scn.atc;
      if (Math.abs(s.thrAxis.L - a.thr) > 0.04 || scn.own.wow) { scn.atc = null; s.log('atc', { on: false }); }
      else { const t = Math.max(0, Math.min(1, a.thr + (a.cas - scn.own.cas) * 0.004 * dt * 10)); a.thr = t; s.thrAxis.L = s.thrAxis.R = t; }
    }
    if (scn) { scn.stick.x = this.stick.x; scn.stick.y = this.stick.y; scn.thr = (s.thrAxis.L + s.thrAxis.R) / 2; }
    // TDC can only sit on a display that exists: keep the diamond in sync
    this.applyTdc();
  }

  // XR controller state (called by Interaction for each controller in HOTAS mode)
  xr(st, gp, dt, side, cockpitRoot) {
    const h = this.hand[side];
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const ax = gp.axes[2] || 0, ay = gp.axes[3] || 0;
    const edge = (name, v) => { const was = h[name]; h[name] = v; return v && !was ? 1 : (!v && was ? -1 : 0); };
    const trig = edge('trig', b(0)), grip = edge('grip', b(1)), ba = edge('ba', b(4)), bb = edge('bb', b(5));
    const flick = Math.hypot(ax, ay) > 0.75 ? DIR(ax, ay) : null;
    const flickEdge = flick && flick !== h.flick; if (!flick && Math.hypot(ax, ay) < 0.35) h.flick = null; else if (flick) h.flick = flick;
    const clickE = h.clickShort; h.clickShort = false;
    if (side === 'R') {
      if (trig) this.trigger(trig > 0);
      if (ba) this.pickle(ba > 0);
      if (bb > 0) { h.bUsed = false; }
      if (b(5) && flickEdge) { this.weaponSelect(flick); h.bUsed = true; }
      else if (b(5) && clickE) { this.weaponSelect('down'); h.bUsed = true; }
      else if (flickEdge) this.scs(flick);
      else if (clickE) this.paddle();
      if (bb < 0 && !h.bUsed) this.undesignate();
      // fly: wrist attitude relative to the grab attitude
      const q = st.ctrl.getWorldQuaternion(new THREE.Quaternion());
      if (grip > 0) { h.q0 = q.clone(); }
      if (b(1) && h.q0) {
        const f0 = new THREE.Vector3(0, 0, -1).applyQuaternion(h.q0), u0 = new THREE.Vector3(0, 1, 0).applyQuaternion(h.q0);
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q), u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        const pitch = Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)) - Math.asin(THREE.MathUtils.clamp(f0.y, -1, 1));
        const rollA = Math.atan2(new THREE.Vector3().crossVectors(u0, u).dot(f), u0.dot(u));
        this.stick.x = THREE.MathUtils.clamp(-rollA / 0.5, -1, 1); this.stick.y = THREE.MathUtils.clamp(pitch / 0.4, -1, 1);
      } else if (grip < 0 || !b(1)) { if (!this.kbStick) { this.stick.x *= 0.85; this.stick.y *= 0.85; } }
    } else {
      // throttle hand
      if (!b(5) || h.yElev === undefined) this.tdc(Math.abs(ax) > 0.15 ? ax : 0, Math.abs(ay) > 0.15 ? -ay : 0, dt);
      if (trig) this.tdcPress(trig > 0);
      const p = new THREE.Vector3().setFromMatrixPosition(st.ctrl.matrixWorld); cockpitRoot.worldToLocal(p);
      if (grip > 0) { h.z0 = p.z; h.ax0 = this.sim.thrAxis.L; }
      if (b(1) && h.z0 !== undefined) this.throttle(h.ax0 + (h.z0 - p.z) / 0.11);
      if (ba) { if (b(1)) { if (ba > 0) this.dispense('prog'); } else this.comm(1, ba > 0); }
      if (bb > 0) { h.yUsed = false; h.yElev = 0; if (b(1)) { this.speedBrake(); h.yUsed = true; } }
      if (b(5) && !b(1) && Math.abs(ay) > 0.3) { this.elevation(-ay, dt); h.yUsed = true; }
      if (bb < 0) { if (!h.yUsed) { this.comm(2, true); setTimeout(() => this.comm(2, false), 300); } h.yElev = undefined; }
      if (clickE) { if (b(1)) this.raidFov(); else this.cage(); }
    }
  }
  // thumbstick click: short press = function, long press (0.6 s) = enter / leave HOTAS mode on that hand
  click(side, down, t) {
    const h = this.hand[side];
    if (down) { h.clickT = t; h.longDone = false; return; }
    if (h.clickT === undefined) return;
    const held = t - h.clickT; h.clickT = undefined;
    if (h.longDone) return;
    if (held < 0.6) { if (h.active) h.clickShort = true; }
  }
  clickHold(side, t) {
    const h = this.hand[side];
    if (h.clickT !== undefined && !h.longDone && t - h.clickT >= 0.6) { h.longDone = true; h.active = !h.active; this.sim.log('hotasMode', { side, on: h.active }); if (!h.active && side === 'R') { this.stick.x = this.stick.y = 0; } return true; }
    return false;
  }

  // ---------------------------------------------------------------- keyboard (desktop)
  setupKeyboard() {
    const down = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const c = e.code; if (this.keys.has(c)) return; this.keys.add(c);
      this.ctrlHeld = e.ctrlKey; this.altHeld = e.altKey;
      const arrow = { ArrowUp: 'fwd', ArrowDown: 'aft', ArrowLeft: 'left', ArrowRight: 'right' }[c];
      if (arrow && e.ctrlKey) { this.scs(arrow); e.preventDefault(); return; }
      if (arrow && e.altKey) { this.weaponSelect({ fwd: 'fwd', aft: 'aft', left: 'down', right: 'right' }[arrow]); e.preventDefault(); return; }
      if (arrow) { e.preventDefault(); return; }
      if (c === 'Space') { e.preventDefault(); if (e.shiftKey) this.pickle(true); else this.trigger(true); }
      if (c === 'Enter' || c === 'NumpadEnter') { this.tdcPress(true); e.preventDefault(); }
      if (c === 'Backspace') { this.undesignate(); e.preventDefault(); }
      if (c === 'KeyC') this.cage();
      if (c === 'KeyF') this.raidFov();
      if (c === 'KeyX') this.dispense('prog');
      if (c === 'KeyZ') this.dispense('flare');
      if (c === 'KeyB') this.speedBrake();
      if (c === 'Digit1') this.comm(1, true);
      if (c === 'Digit2') this.comm(2, true);
      if (c === 'KeyP') this.paddle();
      if (c === 'Home') this.throttle(1.0);
      if (c === 'End') this.throttle(0);
    };
    const up = (e) => {
      const c = e.code; this.keys.delete(c); this.ctrlHeld = e.ctrlKey; this.altHeld = e.altKey;
      if (c === 'Space') { this.trigger(false); this.pickle(false); }
      if (c === 'Digit1') this.comm(1, false);
      if (c === 'Digit2') this.comm(2, false);
      if (c === 'KeyW' || c === 'KeyS' || c === 'KeyA' || c === 'KeyD') { if (!['KeyW', 'KeyS', 'KeyA', 'KeyD'].some(k => this.keys.has(k))) { this.stick.x = this.stick.y = 0; this.kbStick = false; } }
    };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    window.addEventListener('blur', () => { this.keys.clear(); this.trigger(false); });
  }
}

// small cheat-sheet card shown above a controller in HOTAS mode
export function helpCard(lines) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 40 + lines.length * 34;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(8,12,16,0.86)'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#43ff43'; x.lineWidth = 3; x.strokeRect(2, 2, c.width - 4, c.height - 4);
  lines.forEach((l, i) => { x.fillStyle = i ? '#d8ffd8' : '#43ff43'; x.font = i ? '24px sans-serif' : 'bold 28px sans-serif'; x.fillText(l, 16, 34 + i * 34); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16 * c.height / c.width), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false }));
  m.renderOrder = 998;
  return m;
}
