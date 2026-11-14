import * as THREE from 'three';

// F/A-18C throttle quadrant (procedural, after the DCS cockpit / Chuck's guide p.26):
// two levers (OFF – IDLE – MIL – MAX A/B) with finger lifts, left (outboard) grip with DISPENSE, COMM, SPEED BRAKE,
// CAGE/UNCAGE; right (inboard) grip with TDC, ANTENNA ELEVATION, EXT LIGHTS, RAID/FLIR FOV, ATC.
// The levers are grabbed and dragged (controller trigger / hand pinch / mouse); switches work like the HOTAS.
// slot centre: the free strip of the OpenHornet left console between EXT LT / GEN TIE (outboard), FUEL (aft) and FIRE TEST (fwd)
const BASE = new THREE.Vector3(-0.307, -0.566, -0.452);
const ANG = { OFF: 0.40, IDLE: 0.27, MIL: -0.11, MAX: -0.27 };
export const LEVER_TRAVEL = 0.13;            // m of grip travel from IDLE to MIL

// rounded side profile: X = forward, Y = up; front at xf, aft at -xa, height h, corner radii
function profileShape(xf, xa, h, rTF, rTA, rB) {
  const sh = new THREE.Shape();
  sh.moveTo(-xa + rB, 0); sh.lineTo(xf - rB, 0); sh.absarc(xf - rB, rB, rB, -Math.PI / 2, 0, false);
  sh.lineTo(xf, h - rTF); sh.absarc(xf - rTF, h - rTF, rTF, 0, Math.PI / 2, false);
  sh.lineTo(-xa + rTA, h); sh.absarc(-xa + rTA, h - rTA, rTA, Math.PI / 2, Math.PI, false);
  sh.lineTo(-xa, rB); sh.absarc(-xa + rB, rB, rB, Math.PI, Math.PI * 1.5, false);
  return sh;
}
function gripGeometry(sh, width, bevel = 0.006) {
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.rotateY(Math.PI / 2);           // shape X → forward (−z), extrusion → +x
  g.translate(-(width - 2 * bevel) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}
function smooth(pts, n = 6) {        // rounded closed profile via Catmull-Rom
  const c = new THREE.CatmullRomCurve3(pts.map(([a, b]) => new THREE.Vector3(a, b, 0)), true, 'centripetal');
  return c.getPoints(pts.length * n).map(p => [p.x, p.y]);
}

export function buildThrottleQuadrant(cock, M) {
  const root = cock.root, sim = cock.sim;
  const grip = new THREE.MeshStandardMaterial({ color: 0x45494d, roughness: 0.6, metalness: 0.3 });
  const sw = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.45, metalness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.35, metalness: 0.85 });
  // slot plate with the travel markings
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#151618'; x.fillRect(0, 0, 256, 512); x.fillStyle = '#050505'; x.fillRect(70, 30, 40, 450); x.fillRect(146, 30, 40, 450);
  x.fillStyle = '#e8e8de'; x.font = 'bold 26px sans-serif'; x.textAlign = 'center';
  [['MAX', 60], ['MIL', 150], ['IDLE', 380], ['OFF', 470]].forEach(([t, y]) => { x.fillText(t, 128, y); x.fillRect(20, y - 34, 32, 3); x.fillRect(204, y - 34, 32, 3); });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  plate.rotation.x = -Math.PI / 2; plate.position.copy(BASE).add(new THREE.Vector3(0, 0.002, 0)); root.add(plate);

  const levers = {};
  const mkLever = (side, dx) => {
    const pivot = new THREE.Group(); pivot.position.copy(BASE).add(new THREE.Vector3(dx, -0.03, 0)); root.add(pivot);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.15, 0.018), metal); arm.position.y = 0.075; pivot.add(arm);
    const g = new THREE.Group(); g.position.set(0, 0.15, 0); pivot.add(g);
    let body;
    if (side === 'L') {
      // big outboard "barrel" grip
      body = new THREE.Mesh(gripGeometry(profileShape(0.030, 0.042, 0.095, 0.032, 0.016, 0.006), 0.054, 0.009), grip);
      body.position.x = -0.012;
    } else {
      body = new THREE.Mesh(gripGeometry(profileShape(0.026, 0.036, 0.077, 0.026, 0.014, 0.006), 0.036, 0.007), grip);
      body.position.x = 0.008;
    }
    g.add(body);
    // finger lift (in front of the arm, under the grip)
    const lift = new THREE.Group(); lift.position.set(0, 0.11, -0.03); pivot.add(lift);
    const lm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.006, 0.026), metal); lm.position.z = -0.008; lift.add(lm);
    const ctl = {
      def: { id: 'throttle' + side, name: `${side === 'L' ? 'LEFT' : 'RIGHT'} THROTTLE (OFF / IDLE / MIL / MAX)`, type: 'throttle', states: ['IDLE', 'OFF'], key: 'throttle' + side, init: 'OFF' },
      group: pivot, state: 1, cock, towardFwd: true, side, pivot, lift, liftUp: false, liftT: 0, pos: -0.35,
    };
    ctl.apply = () => {
      const ax = Math.min(1.3, Math.max(0, sim.thrAxis[side] || 0));
      let a;
      if (ctl.dragPos !== undefined) {
        const p = ctl.dragPos;
        a = p < 0 ? ANG.IDLE + (ANG.OFF - ANG.IDLE) * Math.min(1, -p / 0.35) : (p <= 1 ? ANG.IDLE + (ANG.MIL - ANG.IDLE) * p : ANG.MIL + (ANG.MAX - ANG.MIL) * (p - 1) / 0.3);
      } else a = ctl.state === 1 ? ANG.OFF : (ax <= 1 ? ANG.IDLE + (ANG.MIL - ANG.IDLE) * ax : ANG.MIL + (ANG.MAX - ANG.MIL) * (ax - 1) / 0.3);
      pivot.rotation.x = a;
      lift.rotation.x = ctl.liftUp ? -0.6 : 0;
    };
    const hit = new THREE.Mesh(new THREE.BoxGeometry(side === 'L' ? 0.058 : 0.04, 0.10, 0.09), M.hit); hit.position.set(side === 'L' ? -0.012 : 0.008, 0.19, 0); pivot.add(hit); cock.addHit(hit, ctl);
    ctl.highlight = [body];
    cock.register(ctl);
    // finger lift as its own control
    const lc = { def: { id: 'fingerLift' + side, name: `${side === 'L' ? 'LEFT' : 'RIGHT'} THROTTLE FINGER LIFT`, type: 'hotas' }, group: lift, cock, highlight: [lm], apply: () => ctl.apply() };
    lc.def.down = () => { ctl.liftUp = !ctl.liftUp; ctl.liftT = sim.t; sim.log('fingerLift', { side, up: ctl.liftUp }); ctl.apply(); };
    const lh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.035), M.hit); lh.position.z = -0.01; lift.add(lh); cock.addHit(lh, lc); cock.controls.set(lc.def.id, lc);
    levers[side] = { ctl, g, body };
    cock.updaters.push(() => {
      if (ctl.liftUp && sim.t - ctl.liftT > 6) { ctl.liftUp = false; }
      if (ctl.dragPos === undefined) ctl.apply();
    });
    return ctl;
  };
  mkLever('L', -0.019); mkLever('R', 0.017);

  // ---- grip switches (HOTAS functions, clickable with the ray / finger)
  const H = () => cock.k && cock.k.hotas;
  const addSw = (parent, id, name, pos, geo, rot, down, up, type = 'hotas') => {
    const m = new THREE.Mesh(geo, sw); m.position.copy(pos); if (rot) m.rotation.set(...rot); parent.add(m);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.016), M.hit); hit.position.copy(pos); parent.add(hit);
    const ctl = { def: { id, name, type, down, up }, group: m, cock, highlight: [m], apply: () => {} };
    cock.addHit(hit, ctl); cock.controls.set(id, ctl);
    return ctl;
  };
  const L = levers.L.g, R = levers.R.g;
  // left grip, aft face (thumb side): DISPENSE (top), COMM, SPEED BRAKE, CAGE/UNCAGE (bottom)
  addSw(L, 'hotasDispense', 'DISPENSE (FWD : leurre IR · AFT : programme)', new THREE.Vector3(0.000, 0.080, 0.040), new THREE.CylinderGeometry(0.0045, 0.0045, 0.012, 10), [Math.PI / 2, 0, 0], (h, a) => h.dispense(a === 'A' ? 'flare' : 'prog'));
  addSw(L, 'hotasComm', 'COMM (FWD : COMM 1 · AFT : COMM 2)', new THREE.Vector3(0.002, 0.060, 0.045), new THREE.BoxGeometry(0.010, 0.010, 0.008), null, (h, a) => h.comm(a === 'A' ? 1 : 2, true), (h, a) => h.comm(a === 'A' ? 1 : 2, false));
  addSw(L, 'hotasSpdBrk', 'SPEED BRAKE (FWD : RETRACT · AFT : EXTEND)', new THREE.Vector3(0.004, 0.040, 0.046), new THREE.BoxGeometry(0.006, 0.012, 0.010), null, (h, a) => h.speedBrake(a === 'A' ? 'RET' : 'EXT'));
  addSw(L, 'hotasCage', 'CAGE / UNCAGE', new THREE.Vector3(0.004, 0.020, 0.044), new THREE.CylinderGeometry(0.0042, 0.0042, 0.008, 12), [Math.PI / 2, 0, 0], (h) => h.cage());
  // right grip: TDC on top, ANTENNA ELEVATION wheel + EXT LIGHTS + RAID/FLIR FOV + ATC on the inboard side
  const tdc = addSw(R, 'hotasTdc', 'TDC (stick : déplacer · gâchette : enfoncer)', new THREE.Vector3(0.008, 0.079, 0.008), new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 16), null, (h) => h.tdcPress(true), null, 'tdc');
  addSw(R, 'hotasElev', 'ANTENNA ELEVATION (stick / molette)', new THREE.Vector3(0.027, 0.058, 0.000), new THREE.CylinderGeometry(0.009, 0.009, 0.006, 16), [0, 0, Math.PI / 2], (h, a) => h.elevation(a === 'A' ? 1 : -1, 0.25), null, 'wheel');
  addSw(R, 'hotasExtLt', 'EXTERIOR LIGHTS', new THREE.Vector3(0.027, 0.036, -0.012), new THREE.BoxGeometry(0.006, 0.008, 0.006), null, () => { sim.sw.extLtMaster = !sim.sw.extLtMaster; sim.log('extLt', { on: sim.sw.extLtMaster }); });
  addSw(R, 'hotasRaid', 'RAID / FLIR FOV', new THREE.Vector3(0.027, 0.036, 0.012), new THREE.CylinderGeometry(0.004, 0.004, 0.006, 12), [0, 0, Math.PI / 2], (h) => h.raidFov());
  addSw(R, 'hotasAtc', 'ATC ENGAGE / DISENGAGE', new THREE.Vector3(0.027, 0.016, 0.000), new THREE.BoxGeometry(0.006, 0.006, 0.010), null, (h) => h.atc());
  for (const c of cock.controls.values()) if (c.def.type === 'hotas' || c.def.type === 'tdc' || c.def.type === 'wheel') c.hotas = H;
  return levers;
}

// ---------------------------------------------------------------- lever dragging
// p: lever position, -0.35 = OFF, 0 = IDLE, 1 = MIL, 1.3 = MAX A/B
export function throttleGrab(cock, ctl) {
  const s = cock.sim;
  ctl.pos0 = ctl.state === 1 ? -0.35 : Math.max(0, s.thrAxis[ctl.side] || 0);
  ctl.dragPos = ctl.pos0;
}
export function throttleDrag(cock, ctl, fwd) {
  const s = cock.sim, side = ctl.side;
  let p = ctl.pos0 + fwd / LEVER_TRAVEL;
  p = Math.max(-0.35, Math.min(1.3, p));
  const lit = s.eng[side].lit || s.eng[side].n2 > 10;
  if (ctl.state === 1) {                                   // OFF: forward past the stop → IDLE
    if (p > -0.12) { ctl.state = 0; cock.commit(ctl); ctl.pos0 = 0 - fwd / LEVER_TRAVEL; p = Math.max(0, p); }
    else { ctl.dragPos = p; ctl.apply(); return; }
  }
  if (p < 0) {
    // IDLE → OFF only with the finger lift raised once the engine runs (DCS)
    if (p < -0.22 && (ctl.liftUp || !lit)) { ctl.state = 1; cock.commit(ctl); s.thrAxis[side] = 0; ctl.liftUp = false; ctl.pos0 = -0.35 - fwd / LEVER_TRAVEL; ctl.dragPos = -0.35; ctl.apply(); return; }
    p = Math.max(p, (ctl.liftUp || !lit) ? p : 0);
  }
  // A/B detent: a short extra push is needed to leave MIL
  if (p > 1.0 && p < 1.06 && (s.thrAxis[side] || 0) <= 1.0) p = 1.0;
  s.thrAxis[side] = Math.max(0, p);
  ctl.dragPos = p; ctl.apply();
}
export function throttleRelease(cock, ctl) { ctl.dragPos = undefined; ctl.pos0 = undefined; ctl.apply(); }
