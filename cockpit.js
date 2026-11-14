import * as THREE from 'three';
import { GLTFLoader } from './GLTFLoader.js';
import { CONTROLS, UFC_KEYS, UFC_APERTURES, UFC_KNOBS, IFEI_WINDOWS, IFEI_BUTTONS } from './controls_def.js';
import { DDI } from './ddi.js';
import { buildThrottleQuadrant, throttleGrab, throttleDrag, throttleRelease } from './throttle.js';
import { UFC, CHANNELS } from './ufc.js';
import { IFEI } from './ifei.js';

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const FONT = (px) => `bold ${px}px "DejaVu Sans Mono","Roboto Mono",Consolas,monospace`;
const WORLD = { fwd: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) };

// shared materials
const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.2, roughness: 0.55 }),
  knob: new THREE.MeshStandardMaterial({ color: 0x0e0e0f, metalness: 0.1, roughness: 0.6 }),
  white: new THREE.MeshBasicMaterial({ color: 0xe9e9df }),
  red: new THREE.MeshStandardMaterial({ color: 0xa8170f, metalness: 0, roughness: 0.45 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xd9a514, metalness: 0, roughness: 0.45 }),
  key: new THREE.MeshStandardMaterial({ color: 0x232527, metalness: 0.1, roughness: 0.6 }),
  hit: new THREE.MeshBasicMaterial({ visible: false }),
  grip: new THREE.MeshStandardMaterial({ color: 0x151617, metalness: 0.15, roughness: 0.7 }),
};

function textTexture(lines, w = 128, h = 128, opt = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = opt.bg || '#202224'; x.fillRect(0, 0, w, h);
  x.fillStyle = opt.color || '#e9e9df'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const L = Array.isArray(lines) ? lines : [lines];
  const fs = opt.size || Math.min(h / (L.length + 0.6), w / (Math.max(...L.map(l => l.length)) * 0.62));
  x.font = FONT(fs);
  L.forEach((l, i) => x.fillText(l, w / 2, h / 2 + (i - (L.length - 1) / 2) * fs * 1.05));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class Cockpit {
  constructor(scene, sim) {
    this.scene = scene; this.sim = sim;
    this.root = new THREE.Group(); this.root.name = 'cockpit';
    scene.add(this.root);
    this.controls = new Map();     // id -> control
    this.hitList = [];             // meshes for raycast
    this.updaters = [];
    this.ufc = new UFC(sim);
    this.ifei = new IFEI(sim);
  }

  async load(base = './') {
    const [gltf, meta] = await Promise.all([
      new GLTFLoader().loadAsync(base + 'cockpit.glb', (e) => this.onProgress && this.onProgress(e)),
      fetch(base + 'cockpit_meta.json').then(r => r.json()),
    ]);
    this.meta = meta;
    this.model = gltf.scene;
    this.root.add(this.model);
    this.model.traverse(o => {
      if (o.isMesh) {
        o.material.side = THREE.FrontSide;
        if (o.material.map) { o.material.map.anisotropy = 8; }
        o.matrixAutoUpdate = false; o.updateMatrix();
        // hide the reference levers / knobs we rebuild procedurally
        const n = o.name || o.parent?.name || '';
        if (/^I_(Toggle_Lever|Toggle_Switch_[23]|MS24524_Lever|Toggle_switch_cover|Toggle_Switch_Guard|Select_Jett|Rudder_Trim|T_O_TRIM|RESET_Button|Bleed_Air|OXY_FLOW|A_A_Master|A_G_Master|FIRE_EXTGH|ECM_JETT)/.test(n)) o.visible = false;
        if (/^L_/.test(n)) { o.material.side = THREE.DoubleSide; }
        // tub / structure: dark gull grey (FS 36231) like the real cockpit, not bare light metal
        if (/static_metal/.test(n) && o.material.color) { o.material.color.setRGB(0.105, 0.115, 0.125); o.material.metalness = 0.18; o.material.roughness = 0.68; }
      }
    });
    // panel frames
    this.panels = {};
    for (const [k, p] of Object.entries(meta.panels)) {
      const f = { key: k, o: V3(p.origin), ex: V3(p.ex), ey: V3(p.ey), n: V3(p.n).normalize(), W: p.W, H: p.H };
      f.exu = f.ex.clone().normalize(); f.eyu = f.ey.clone().normalize();
      this.panels[k] = f;
    }
    this.buildControls();
    this.buildUFC();
    this.buildIFEI();
    this.buildDisplays();
    this.buildLights();
    this.buildInstruments();
    this.buildThrottles();
    this.buildSeat();
    this.buildMisc();
    this.root.updateMatrixWorld(true);
  }

  panel(sub) { const k = Object.keys(this.panels).find(k => k.includes(sub)); return k ? this.panels[k] : null; }
  svg(f, mm, h = 0) { return f.o.clone().addScaledVector(f.ex, mm[0] / 1000).addScaledVector(f.ey, mm[1] / 1000).addScaledVector(f.n, h); }

  // orientation basis for a control on a panel: y = panel normal
  basis(f) {
    const m = new THREE.Matrix4();
    const y = f.n.clone(), x = f.exu.clone(), z = new THREE.Vector3().crossVectors(x, y).normalize();
    m.makeBasis(x, y, z);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  // throw direction (unit, world) from an svg dir or a world keyword
  throwDir(f, dir) {
    let d;
    if (typeof dir === 'string') { d = (dir === 'fwd' ? WORLD.fwd : dir === 'up' ? WORLD.up : WORLD.fwd).clone(); }
    else d = f.exu.clone().multiplyScalar(dir[0]).addScaledVector(f.eyu, dir[1]);
    d.addScaledVector(f.n, -d.dot(f.n)).normalize();
    return d;
  }

  addHit(mesh, ctl) { mesh.userData.control = ctl; this.hitList.push(mesh); }

  register(ctl) {
    this.controls.set(ctl.def.id, ctl);
    if (ctl.def.key && ctl.state !== undefined) {
      // initial sim value
      if (ctl.def.type === 'knob') this.sim.sw[ctl.def.key] = ctl.value;
      else if (ctl.def.type === 'rotary' && ctl.def.key === 'ilsChan') this.sim.sw.ilsChan = +ctl.def.states[ctl.state];
      else this.sim.sw[ctl.def.key] = ctl.def.states[ctl.state];
    }
  }

  // ------------------------------------------------------------------ controls
  buildControls() {
    for (const def of CONTROLS) this.makeControl(def);
    for (const def of UFC_KNOBS) this.makeControl(def);
  }

  makeControl(def) {
    const f = this.panel(def.panel);
    if (!f) { console.warn('panel not found', def.panel); return; }
    const pos = this.svg(f, def.at);
    const q = this.basis(f);
    const g = new THREE.Group(); g.position.copy(pos); g.quaternion.copy(q); this.root.add(g);
    const ctl = { def, group: g, frame: f, state: 0, value: def.init ?? 0, guardOpen: false, cock: this };
    if (def.type === 'toggle') this.makeToggle(ctl);
    else if (def.type === 'knob') this.makeKnob(ctl);
    else if (def.type === 'rotary') this.makeRotary(ctl);
    else if (def.type === 'button') this.makeButton(ctl);
    else if (def.type === 'light') this.makeLight(ctl);
    else if (def.type === 'channel') this.makeChannel(ctl);
    this.register(ctl);
    return ctl;
  }

  makeToggle(ctl) {
    const d = ctl.def, f = ctl.frame, g = ctl.group;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.0032, 6), M.metal); nut.position.y = 0.0016; g.add(nut);
    const bush = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.006, 12), M.metal); bush.position.y = 0.004; g.add(bush);
    const pivot = new THREE.Group(); pivot.position.y = 0.007; g.add(pivot);
    const len = 0.017;
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0019, len, 10), M.metal); lever.position.y = len / 2; pivot.add(lever);
    const tip = d.lock
      ? new THREE.Mesh(new THREE.CylinderGeometry(0.0033, 0.0033, 0.006, 12), M.metal)
      : new THREE.Mesh(new THREE.SphereGeometry(0.0026, 12, 8), M.metal);
    tip.position.y = len + 0.001; pivot.add(tip);
    // throw axis in local frame
    const tdw = this.throwDir(f, d.dir || 'fwd');
    const inv = g.quaternion.clone().invert();
    const tdl = tdw.clone().applyQuaternion(inv);                 // local throw dir (in xz plane)
    ctl.axis = new THREE.Vector3(0, 1, 0).cross(tdl).normalize();  // rotating +angle tilts the lever toward tdl
    const n = d.states.length;
    ctl.angles = n === 3 ? [0.42, 0, -0.42] : n === 2 ? [0.42, -0.42] : d.states.map((_, i) => 0.42 - i * 0.84 / (n - 1));
    ctl.state = Math.max(0, d.states.indexOf(d.init ?? d.states[n - 1]));
    ctl.pivot = pivot;
    ctl.towardFwd = tdw.dot(WORLD.fwd) + tdw.dot(WORLD.up) * 0.9 >= 0;   // states[0] is forward/up?
    if (d.guard) {
      const gm = d.guard === 'red' ? M.red : M.yellow;
      const guard = new THREE.Group(); guard.position.set(0, 0.002, 0); g.add(guard);
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.026, 0.03), gm);
      // cover sits over the lever, hinged on the side opposite to states[0]
      const hingeDir = tdl.clone().multiplyScalar(-1);
      guard.position.addScaledVector(hingeDir, 0.012);
      cover.position.copy(tdl.clone().multiplyScalar(0.012)).add(new THREE.Vector3(0, 0.013, 0));
      cover.lookAt(cover.position.clone().add(tdl)); guard.add(cover);
      ctl.guard = guard; ctl.guardAxis = new THREE.Vector3(0, 1, 0).cross(hingeDir).normalize();
    }
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.022), M.hit); hit.position.y = 0.014; g.add(hit); this.addHit(hit, ctl);
    ctl.highlight = [tip];
    ctl.apply = () => {
      pivot.quaternion.setFromAxisAngle(ctl.axis, ctl.angles[ctl.state]);
      if (ctl.guard) ctl.guard.quaternion.setFromAxisAngle(ctl.guardAxis, ctl.guardOpen ? -1.7 : 0);
    };
    ctl.apply();
  }

  makeKnobMesh(size, pointer = true) {
    const r = size / 2000;
    const grp = new THREE.Group();
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.15, 0.003, 24), M.knob); skirt.position.y = 0.0015; grp.add(skirt);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.86, 0.011, 20), M.knob); body.position.y = 0.0085; grp.add(body);
    if (pointer) {
      const ptr = new THREE.Mesh(new THREE.BoxGeometry(r * 0.16, 0.0006, r * 0.9), M.white); ptr.position.set(0, 0.0143, -r * 0.42); grp.add(ptr);
      const ptr2 = new THREE.Mesh(new THREE.BoxGeometry(r * 0.2, 0.0006, r * 0.4), M.white); ptr2.position.set(0, 0.0032, -r * 1.0); grp.add(ptr2);
    }
    return grp;
  }

  // angles are measured clockwise (seen from the pilot / from above) from the panel "up" (svg -y) unless dirAxis given
  knobRef(ctl) {
    const f = ctl.frame;
    const ref = ctl.def.dirAxis ? this.throwDir(f, ctl.def.dirAxis) : this.throwDir(f, [0, -1]);
    const inv = ctl.group.quaternion.clone().invert();
    const l = ref.applyQuaternion(inv); l.y = 0; l.normalize();
    return Math.atan2(-l.x, -l.z);   // yaw that points local -z toward ref
  }

  makeKnob(ctl) {
    const d = ctl.def, g = ctl.group;
    const k = this.makeKnobMesh(d.knobSize || 14); g.add(k);
    ctl.value = d.init ?? 0;
    const y0 = this.knobRef(ctl);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry((d.knobSize || 14) / 1800 + 0.003, (d.knobSize || 14) / 1800 + 0.003, 0.018, 12), M.hit); hit.position.y = 0.009; g.add(hit); this.addHit(hit, ctl);
    ctl.highlight = [k.children[1]];
    ctl.apply = () => { k.rotation.y = y0 - (-2.36 + ctl.value * 4.72); };
    ctl.apply();
  }

  makeRotary(ctl) {
    const d = ctl.def, g = ctl.group;
    const k = this.makeKnobMesh(d.knobSize || 16); g.add(k);
    ctl.state = Math.max(0, d.states.indexOf(d.init ?? d.states[0]));
    const y0 = this.knobRef(ctl);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry((d.knobSize || 16) / 1800 + 0.003, (d.knobSize || 16) / 1800 + 0.003, 0.02, 12), M.hit); hit.position.y = 0.01; g.add(hit); this.addHit(hit, ctl);
    ctl.highlight = [k.children[1]];
    ctl.apply = () => { k.rotation.y = y0 - THREE.MathUtils.degToRad(d.angles[ctl.state]); };
    ctl.apply();
  }

  makeButton(ctl) {
    const d = ctl.def, g = ctl.group;
    const w = (d.w || d.size || 10) / 1000, h = (d.h || d.size || 10) / 1000;
    const cap = d.round ? new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.006, 20), M.key) : new THREE.Mesh(new THREE.BoxGeometry(w, 0.006, h), M.key);
    const capG = new THREE.Group(); capG.add(cap); cap.position.y = (d.height || 0.006) / 2; g.add(capG);
    if (d.label || d.lightLabel || d.capText) {
      const t = textTexture(d.capText || d.lightLabel || d.label, 128, 128, { color: '#e9e9df', bg: '#232527' });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.9), new THREE.MeshBasicMaterial({ map: t }));
      face.rotation.x = -Math.PI / 2; face.position.y = (d.height || 0.006) + 0.0002;
      if (d.faceRot) face.rotation.z = d.faceRot;
      capG.add(face); ctl.face = face;
    }
    const hit = new THREE.Mesh(new THREE.BoxGeometry(w + 0.003, 0.016, h + 0.003), M.hit); hit.position.y = 0.006; g.add(hit); this.addHit(hit, ctl);
    ctl.highlight = [cap];
    ctl.pressed = false;
    ctl.apply = () => { capG.position.y = ctl.pressed ? -0.0025 : 0; };
  }

  makeLight(ctl) {
    const d = ctl.def, g = ctl.group;
    const s = (d.size || 10) / 1000;
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a120a });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(s / 2, s / 2, 0.004, 20), mat); lens.position.y = 0.002; g.add(lens);
    const on = new THREE.Color(d.color || '#3dff6a'), off = new THREE.Color(0x0a120a);
    this.updaters.push(() => { const L = this.sim.warningLights(); mat.color.copy(L[d.light] ? on : off); });
  }

  makeChannel(ctl) {
    const d = ctl.def, g = ctl.group;
    const k = this.makeKnobMesh(d.knobSize || 15, true); g.add(k);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.02, 12), M.hit); hit.position.y = 0.01; g.add(hit); this.addHit(hit, ctl);
    ctl.highlight = [k.children[1]];
    ctl.apply = () => { k.rotation.y = -(this.ufc.comm[d.radio].ch - 1) * (Math.PI * 2 / 24); };
  }

  // ------------------------------------------------------------------ actions
  // act: 'A' (forward/up/clockwise/press) | 'B' (aft/down/ccw) | 'release' | {delta}
  act(ctl, act) {
    const d = ctl.def, s = this.sim;
    if (!ctl || !d) return;
    if (d.type === 'toggle') {
      if (act === 'release') {
        if (d.momentary && d.momentary.includes(d.states[ctl.state])) { ctl.state = d.states.indexOf(d.rest); this.commit(ctl); }
        return;
      }
      if (d.guard && !ctl.guardOpen) {
        ctl.guardOpen = true; ctl.apply(); s.log('guard', { id: d.id, open: true }); return;
      }
      const towardFirst = (act === 'A') === ctl.towardFwd;
      const ns = THREE.MathUtils.clamp(ctl.state + (towardFirst ? -1 : 1), 0, d.states.length - 1);
      if (ns === ctl.state) {
        // pushing further in the rest direction closes an open guard
        if (d.guard && ctl.guardOpen && d.states[ctl.state] === d.init) { ctl.guardOpen = false; ctl.apply(); }
        return;
      }
      ctl.state = ns; this.commit(ctl);
    } else if (d.type === 'rotary') {
      if (act === 'release') return;
      const n = d.states.length;
      let ns = ctl.state + (act === 'A' ? 1 : -1);
      if (d.wrap) ns = (ns + n) % n; else ns = THREE.MathUtils.clamp(ns, 0, n - 1);
      if (ns !== ctl.state) { ctl.state = ns; this.commit(ctl); }
    } else if (d.type === 'knob') {
      if (act === 'release') return;
      const step = typeof act === 'object' ? act.delta : (act === 'A' ? 0.1 : -0.1);
      ctl.value = THREE.MathUtils.clamp(ctl.value + step, 0, 1);
      this.commit(ctl);
    } else if (d.type === 'button') {
      if (act === 'release') { ctl.pressed = false; ctl.apply(); this.buttonUp(ctl); return; }
      ctl.pressed = true; ctl.apply(); this.buttonDown(ctl);
    } else if (d.type === 'channel') {
      if (act === 'release') return;
      if (act === 'press') { this.ufc.commPull(d.radio); return; }
      this.ufc.commKnob(d.radio, act === 'A' ? 1 : -1); ctl.apply();
      this.ufc.commPull(d.radio);
    } else if (d.type === 'radalt') {
      if (act === 'release') return;
      this.buttonDown({ def: { id: 'radalt', action: act === 'A' ? 'radaltUp' : 'radaltDn' } });
    } else if (d.type === 'handle') {
      if (act === 'release') return;
      ctl.state = (ctl.state + 1) % d.states.length; this.commit(ctl);
    } else if (d.type === 'throttle') {
      if (act === 'release' || typeof act === 'object') return;
      const side = ctl.side, ax = s.thrAxis[side] || 0, lit = s.eng[side].lit || s.eng[side].n2 > 10;
      if (act === 'A') {
        if (ctl.state === 1) { ctl.state = 0; this.commit(ctl); }
        else { s.thrAxis[side] = Math.min(1.3, ax + 0.1); ctl.apply(); }
      } else {
        if (ctl.state === 1) return;
        if (ax > 0.01) { s.thrAxis[side] = Math.max(0, ax - 0.1); if (s.thrAxis[side] < 0.05) s.thrAxis[side] = 0; ctl.apply(); return; }
        if (lit && !ctl.liftUp) { s.log('throttleStop', { side }); return; }        // finger lift required (DCS)
        ctl.state = 1; s.thrAxis[side] = 0; ctl.liftUp = false; this.commit(ctl);
      }
    } else if (d.type === 'hotas' || d.type === 'tdc' || d.type === 'wheel') {
      const h = this.k && this.k.hotas; if (!h) return;
      if (act === 'release') { if (ctl.down && d.up) d.up(h, ctl.down); ctl.down = null; return; }
      if (typeof act === 'object') { if (d.type === 'wheel') h.elevation(Math.sign(act.delta), 0.2); return; }
      ctl.down = act; if (d.down) d.down(h, act); s.log('hotasClick', { id: d.id, act });
    } else if (d.type === 'osb') {
      if (act === 'release') { ctl.pressed = false; ctl.apply && ctl.apply(); return; }
      ctl.pressed = true; ctl.apply && ctl.apply();
      d.ddi.press(d.n);
      s.log('osb', { ddi: d.ddi.id, n: d.n, page: d.ddi.page });
    }
  }

  commit(ctl) {
    const d = ctl.def; ctl.apply && ctl.apply();
    if (!d.key) return;
    let v;
    if (d.type === 'knob') v = ctl.value;
    else if (d.key === 'ilsChan') v = +d.states[ctl.state];
    else v = d.states[ctl.state];
    this.sim.set(d.key, v);
    this.onChange && this.onChange(ctl);
  }

  buttonDown(ctl) {
    const d = ctl.def, s = this.sim;
    s.log('button', { id: d.id });
    if (d.action === 'fcsReset') s.fcsReset();
    if (d.action === 'toTrim') { if (s.elec.ac) { s.toTrimDone = true; s.log('toTrim', {}); } }
    if (d.action === 'rwrPwr') { if (s.elec.ac) { s.sw.rwrPwr = !s.sw.rwrPwr; s.log('rwrPwr', { on: s.sw.rwrPwr }); } }
    if (d.action === 'masterCaution') s.pressMasterCaution();
    if (this.k && s.elec.ac) {
      if (d.id === 'aaMode') this.k.wpn.setMaster('AA');
      if (d.id === 'agMode') this.k.wpn.setMaster('AG');
    }
    if (d.ufcKey) this.ufc.key(d.ufcKey, true);
    if (d.ifei) this.ifei.button(d.ifei, true);
    if (d.action === 'sbyAdiCage') { s.sw.sbyAdiCaged = !s.sw.sbyAdiCaged; s.log('sbyAdi', { caged: s.sw.sbyAdiCaged }); }
    if (d.action === 'radaltUp') { s.sw.radaltIdx = Math.min(5000, (s.sw.radaltIdx || 0) + 50); s.log('radalt', { v: s.sw.radaltIdx }); }
    if (d.action === 'radaltDn') { s.sw.radaltIdx = Math.max(0, (s.sw.radaltIdx || 0) - 50); s.log('radalt', { v: s.sw.radaltIdx }); }
    this.onChange && this.onChange(ctl);
  }
  buttonUp(ctl) {
    const d = ctl.def;
    if (d.ufcKey) this.ufc.key(d.ufcKey, false);
    if (d.ifei) this.ifei.button(d.ifei, false);
  }

  // ------------------------------------------------------------------ UFC
  buildUFC() {
    const f = this.panel('UFC LEGEND'); if (!f) return;
    const mesh = this.findLegendMesh(f.key);
    // canvas face = legend + LCD
    const W = 1024, H = Math.round(1024 * f.H / f.W);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.flipY = false;
    const baseImg = mesh?.material.map?.image;
    if (mesh) { mesh.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }); }
    const ap = {};
    for (const [k, [cx, cy, w, h]] of Object.entries(UFC_APERTURES)) ap[k] = { x: (cx - w / 2) / (f.W * 1000), y: (cy - h / 2) / (f.H * 1000), w: w / (f.W * 1000), h: h / (f.H * 1000) };
    let last = '';
    this.updaters.push(() => {
      const sig = JSON.stringify(this.ufc.texts()) + this.ufc.powered() + this.sim.sw.ufcBrt.toFixed(2) + (this.sim.t | 0);
      if (sig === last) return; last = sig;
      ctx.clearRect(0, 0, W, H);
      if (baseImg) ctx.drawImage(baseImg, 0, 0, W, H);
      this.ufc.draw(ctx, W, H, ap);
      tex.needsUpdate = true;
    });
    // keys
    const keyTex = {};
    for (const [k, x, y] of UFC_KEYS) {
      const isOsb = k.startsWith('OSB'), isFn = y > 110;
      const def = {
        id: 'ufc_' + k, name: 'UFC ' + k, panel: 'UFC LEGEND', at: [x, y], type: 'button', ufcKey: k,
        size: isOsb ? 8.5 : 12, round: isOsb || k === 'I/P', w: isFn ? 14 : (isOsb ? 8.5 : 12), h: isFn ? 11 : (isOsb ? 8.5 : 12),
        capText: isOsb ? null : (k === 'ON/OFF' ? ['ON', 'OFF'] : k === 'EMCON' ? ['EM', 'CON'] : k === '2' ? ['N', '2'] : k === '8' ? ['S', '8'] : k === '4' ? ['W', '4'] : k === '6' ? ['E', '6'] : k === '0' ? ['-', '0'] : k),
        faceRot: 0,
      };
      if (def.capText === null) delete def.capText;
      const ctl = this.makeControl(def);
      // orient cap text upright for the pilot: rotate so text "up" = panel up (-svg y)
      if (ctl && ctl.face) this.uprightFace(ctl, f);
    }
  }

  uprightFace(ctl, f) {
    // text "up" = world up on vertical panels, forward on consoles
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(ctl.group.getWorldQuaternion(new THREE.Quaternion()));
    const ref = Math.abs(n.y) < 0.7 ? WORLD.up.clone() : WORLD.fwd.clone();
    const up = ref.applyQuaternion(ctl.group.quaternion.clone().invert());
    ctl.face.rotation.z = Math.atan2(-up.x, -up.z);
  }

  findLegendMesh(key) {
    let found = null;
    const want = 'L_' + key.replace(/[^A-Za-z0-9]+/g, '_');
    this.model.traverse(o => { if (o.isMesh && (o.name === want || o.parent?.name === want || (o.name || '').startsWith(want))) found = o; });
    return found;
  }

  // ------------------------------------------------------------------ IFEI
  buildIFEI() {
    const f = this.panel('IFEI LEGEND'); if (!f) return;
    const mesh = this.findLegendMesh(f.key);
    const W = 1024, H = Math.round(1024 * f.H / f.W);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 8;
    const baseImg = mesh?.material.map?.image;
    if (mesh) mesh.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true });
    const win = {};
    for (const [k, [cx, cy, w, h]] of Object.entries(IFEI_WINDOWS)) win[k] = { x: (cx - w / 2) / (f.W * 1000), y: (cy - h / 2) / (f.H * 1000), w: w / (f.W * 1000), h: h / (f.H * 1000) };
    let tAcc = 0;
    this.updaters.push((dt) => {
      tAcc += dt; if (tAcc < 0.1) return; tAcc = 0;
      ctx.clearRect(0, 0, W, H);
      if (baseImg) ctx.drawImage(baseImg, 0, 0, W, H);
      this.ifei.draw(ctx, W, H, win);
      tex.needsUpdate = true;
    });
    for (const [b, x, y] of IFEI_BUTTONS) {
      const ctl = this.makeControl({ id: 'ifei_' + b, name: 'IFEI ' + b, panel: 'IFEI LEGEND', at: [x, y], type: 'button', ifei: b, size: 9, w: 13, h: 8, capText: b === 'UP' ? '▲' : b === 'DOWN' ? '▼' : b });
      if (ctl && ctl.face) this.uprightFace(ctl, f);
    }
  }

  // ------------------------------------------------------------------ DDIs / AMPCD
  buildDisplays() {
    const sc = this.meta.screens;
    const pair = [sc.ddiL, sc.ddiR].sort((a, b) => a.center[0] - b.center[0]);   // left DDI has negative x
    const defs = [['L', pair[0]], ['R', pair[1]], ['AMPCD', sc.ampcd]];
    this.ddis = {};
    // AMPCD: the OpenHornet MFCD face is tilted ~13° and its screen sits in an 11 mm recess (measured on the
    // reference geometry): put the display on the recess floor, 104 mm square, with its own OSB ring and black bezel
    const nA = new THREE.Vector3(0, 0.225, 0.9744).normalize(), eyA = new THREE.Vector3(0, 0.9744, -0.225).normalize();
    const cA = new THREE.Vector3(0, -0.3914, -0.7568).addScaledVector(eyA, -0.01625).addScaledVector(nA, -0.0101);
    defs[2][1] = { center: cA.toArray(), ex: [1, 0, 0], ey: eyA.toArray(), n: nA.toArray(), w: 0.104, h: 0.104, osbSide: 0.0605, osbTB: 0.0590, osbStep: 0.0192, front: 0.007, ampcd: true };
    for (const [id, s] of defs) {
      const ddi = new DDI(id, this.sim);
      this.ddis[id] = ddi;
      const tex = new THREE.CanvasTexture(ddi.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
      const c = V3(s.center), ex = V3(s.ex), ey = V3(s.ey), n = V3(s.n);
      plane.position.copy(c);
      plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, n));
      this.root.add(plane);
      // sensor video (TPOD / Maverick) is a render-target texture on a plane just behind the symbology
      const blackMat = new THREE.MeshBasicMaterial({ color: 0x020403 });
      const video = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), blackMat);
      video.position.copy(c).addScaledVector(n, -0.0006); video.quaternion.copy(plane.quaternion);
      this.root.add(video);
      // screen glass: faint reflection layer in front of the symbology
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 1.02, s.h * 1.02), new THREE.MeshPhysicalMaterial({ color: 0x0a0d0c, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false }));
      glass.position.copy(c).addScaledVector(n, 0.0012); glass.quaternion.copy(plane.quaternion); glass.renderOrder = 3;
      this.root.add(glass);
      ddi.plane = plane; ddi.videoPlane = video;
      if (s.ampcd) {
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(0.131, 0.128), new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.7 }));
        floor.position.copy(c).addScaledVector(n, -0.0003); floor.quaternion.copy(plane.quaternion); this.root.add(floor);
      }
      let acc = 0;
      this.updaters.push((dt) => {
        acc += dt; if (acc < 1 / 15) return; acc = 0; ddi.render(); tex.needsUpdate = true;
        const tp = this.k && this.k.tpod;
        video.material = ddi.videoSource === 'tpod' && tp ? tp.matPod : ddi.videoSource === 'mav' && tp ? tp.matMav : blackMat;
      });
      // OSB hit boxes + caps
      const step = s.osbStep;
      const offs = [2, 1, 0, -1, -2].map(k => k * step);
      const pos = (k) => {
        if (k <= 5) return [-s.osbSide, offs[k - 1]];
        if (k <= 10) return [[-2, -1, 0, 1, 2][k - 6] * step, s.osbTB];
        if (k <= 15) return [s.osbSide, offs[k - 11]];
        return [[2, 1, 0, -1, -2][k - 16] * step, -s.osbTB];
      };
      for (let k = 1; k <= 20; k++) {
        const [u, v] = pos(k);
        const g = new THREE.Group();
        g.position.copy(c).addScaledVector(ex, u).addScaledVector(ey, v).addScaledVector(n, s.front - 0.004);
        g.quaternion.copy(plane.quaternion);
        this.root.add(g);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(s.ampcd ? 0.014 : 0.017, s.ampcd ? 0.011 : 0.013, 0.02), M.hit); g.add(hit);
        if (s.ampcd) { const cap = new THREE.Mesh(new THREE.BoxGeometry(k <= 5 || (k >= 11 && k <= 15) ? 0.007 : 0.010, k <= 5 || (k >= 11 && k <= 15) ? 0.010 : 0.007, 0.004), M.key); cap.position.z = -0.002; g.add(cap); }
        const ctl = { def: { id: `osb_${id}_${k}`, name: `${id === 'AMPCD' ? 'AMPCD' : id + ' DDI'} OSB ${k}`, type: 'osb', ddi, n: k }, group: g, cock: this, highlight: [] };
        this.addHit(hit, ctl); this.controls.set(ctl.def.id, ctl);
      }
      // power / brightness knobs
      const knobAt = (du, dv, def) => {
        const fr = { o: c.clone().addScaledVector(ex, du).addScaledVector(ey, dv).addScaledVector(n, s.front - 0.008), ex, ey: ey.clone().negate(), exu: ex, eyu: ey.clone().negate(), n, W: 0.01, H: 0.01, key: 'ddi' };
        const g = new THREE.Group(); g.position.copy(fr.o); g.quaternion.copy(this.basis(fr)); this.root.add(g);
        const ctl = { def, group: g, frame: fr, state: 0, value: def.init ?? 0, cock: this };
        if (def.type === 'rotary') this.makeRotary(ctl); else this.makeKnob(ctl);
        this.register(ctl);
      };
      if (id !== 'AMPCD') {
        knobAt(0, s.osbTB + 0.026, { id: `ddiPwr${id}`, name: `${id} DDI NIGHT/OFF/DAY`, type: 'rotary', states: ['NIGHT', 'OFF', 'DAY'], angles: [-40, 0, 40], key: id === 'L' ? 'ddiL' : 'ddiR', init: 'OFF', knobSize: 15 });
        knobAt(-s.osbSide + 0.004, -s.osbTB - 0.004, { id: `ddiBrt${id}`, name: `${id} DDI BRT`, type: 'knob', key: `ddiBrt${id}`, init: 0.7, knobSize: 13 });
        knobAt(s.osbSide - 0.004, -s.osbTB - 0.004, { id: `ddiCont${id}`, name: `${id} DDI CONT`, type: 'knob', key: `ddiCont${id}`, init: 0.6, knobSize: 13 });
      } else {
        s.osbSide = 0.0745; s.osbTB = 0.068; s.front = 0.019;      // corner knobs sit on the bezel ring
        knobAt(-s.osbSide + 0.004, -s.osbTB - 0.004, { id: 'ampcdBrt', name: 'AMPCD BRT (OFF/BRT)', type: 'knob', key: 'ampcdBrt', init: 0, knobSize: 13 });
        knobAt(s.osbSide - 0.004, -s.osbTB - 0.004, { id: 'ampcdCont', name: 'AMPCD CONT', type: 'knob', key: 'ampcdCont', init: 0.6, knobSize: 13 });
        knobAt(-s.osbSide + 0.004, s.osbTB + 0.004, { id: 'ampcdMode', name: 'AMPCD DAY/NGT', type: 'rotary', states: ['NGT', 'DAY'], angles: [-35, 35], key: 'ampcdMode', init: 'DAY', knobSize: 12 });
        knobAt(s.osbSide - 0.004, s.osbTB + 0.004, { id: 'ampcdGain', name: 'AMPCD GAIN', type: 'knob', key: 'ampcdGain', init: 0.5, knobSize: 12 });
      }
    }
  }

  // ------------------------------------------------------------------ warning / caution lights
  lightPanel(cfg) {
    // cfg: {center:Vector3, ex, ey, n, cols, rows, cell:[w,h], items:[{key,label,color}]}
    const W = 256 * cfg.cols, H = Math.round(W * (cfg.rows * cfg.cell[1]) / (cfg.cols * cfg.cell[0]));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(cfg.cols * cfg.cell[0], cfg.rows * cfg.cell[1]), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    plane.position.copy(cfg.center);
    plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(cfg.ex, cfg.ey, cfg.n));
    this.root.add(plane);
    let last = '';
    this.updaters.push(() => {
      const st = cfg.items.map(it => (it && cfg.src()[it.key]) ? 1 : 0).join('') + this.sim.sw.warnCaut.toFixed(1);
      if (st === last) return; last = st;
      const cw = W / cfg.cols, ch = H / cfg.rows;
      ctx.fillStyle = '#0b0c0d'; ctx.fillRect(0, 0, W, H);
      cfg.items.forEach((it, i) => {
        if (!it) return;
        const x = (i % cfg.cols) * cw, y = Math.floor(i / cfg.cols) * ch;
        const on = cfg.src()[it.key];
        ctx.fillStyle = on ? it.color : '#151617'; ctx.fillRect(x + 4, y + 4, cw - 8, ch - 8);
        ctx.fillStyle = on ? (it.text || '#111') : '#3b3d40';
        ctx.font = FONT(Math.min(ch * 0.36, cw / (Math.max(...it.label.split('\n').map(s => s.length)) * 0.65)));
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const L = it.label.split('\n');
        L.forEach((l, j) => ctx.fillText(l, x + cw / 2, y + ch / 2 + (j - (L.length - 1) / 2) * ch * 0.38));
      });
      tex.needsUpdate = true;
    });
    return plane;
  }

  buildLights() {
    const sc = this.meta.screens, inst = sc.inst;
    const pair = [sc.ddiL, sc.ddiR].sort((a, b) => a.center[0] - b.center[0]);
    const n = V3(pair[0].n), ex = V3(pair[0].ex), ey = V3(pair[0].ey);
    const Y = '#f2c230', RD = '#ff3b2f', GR = '#43e36a';
    // left eyebrow (above left DDI): FIRE L + MASTER CAUTION large, small cautions
    const topL = V3(pair[0].center).addScaledVector(ey, pair[0].osbTB + 0.038).addScaledVector(n, 0.03);
    this.lightPanel({
      center: topL.clone().addScaledVector(ex, -0.015), ex, ey, n, cols: 4, rows: 2, cell: [0.021, 0.0135],
      src: () => this.sim.warningLights(),
      items: [{ key: 'FIRE L', label: 'FIRE', color: RD, text: '#fff' }, { key: 'GO', label: 'GO', color: GR }, { key: 'L BLEED', label: 'L BLEED', color: RD, text: '#fff' }, { key: 'SPD BRK', label: 'SPD BRK', color: GR },
        { key: 'MASTER CAUTION', label: 'MASTER\nCAUTION', color: Y }, { key: 'NO GO', label: 'NO GO', color: Y }, { key: 'R BLEED', label: 'R BLEED', color: RD, text: '#fff' }, { key: 'STBY', label: 'STBY', color: Y }],
    });
    // master caution push button (hit area over the MASTER CAUTION cell)
    const mcPos = topL.clone().addScaledVector(ex, -0.015 - 0.0315).addScaledVector(ey, -0.00675);
    this.hitBox('masterCaution', 'MASTER CAUTION', mcPos, ex, ey, n, [0.021, 0.0135], { type: 'button', action: 'masterCaution' });
    const topR = V3(pair[1].center).addScaledVector(ey, pair[1].osbTB + 0.038).addScaledVector(n, 0.03);
    this.lightPanel({
      center: topR.clone().addScaledVector(ex, 0.015), ex, ey, n, cols: 4, rows: 2, cell: [0.021, 0.0135],
      src: () => this.sim.warningLights(),
      items: [{ key: 'RCDR ON', label: 'RCDR ON', color: GR }, { key: 'DISP', label: 'DISP', color: GR }, { key: 'AI', label: 'AI', color: Y }, { key: 'FIRE R', label: 'FIRE', color: RD, text: '#fff' },
        { key: 'SAM', label: 'SAM', color: Y }, { key: 'CW', label: 'CW', color: Y }, { key: 'AAA', label: 'AAA', color: Y }, { key: 'APU FIRE', label: 'APU\nFIRE', color: RD, text: '#fff' }],
    });
    // LOCK / SHOOT lights (left side of the HUD) and AOA indexer (right side), above the UFC
    const uf = this.panel('UFC LEGEND');
    if (uf) {
      const eyU = uf.eyu.clone().negate();
      this.lightPanel({ center: this.svg(uf, [10, -14], 0.006), ex: uf.exu, ey: eyU, n: uf.n, cols: 1, rows: 2, cell: [0.017, 0.010],
        src: () => this.sim.warningLights(), items: [{ key: 'LOCK', label: 'LOCK', color: GR }, { key: 'SHOOT', label: 'SHOOT', color: GR }] });
      this.lightPanel({ center: this.svg(uf, [uf.W * 1000 - 10, -14], 0.006), ex: uf.exu, ey: eyU, n: uf.n, cols: 1, rows: 3, cell: [0.014, 0.0075],
        src: () => this.aoaIndexer(), items: [{ key: 'SLOW', label: '▼', color: GR }, { key: 'ON', label: '●', color: '#f2a030' }, { key: 'FAST', label: '▲', color: RD }] });
    }
    // standby caution panel (right console, battery powered)
    if (inst.caution) {
      const lo = V3(inst.caution.lo), hi = V3(inst.caution.hi);
      const c = lo.clone().add(hi).multiplyScalar(0.5);
      const nn = new THREE.Vector3(-0.35, 0.55, 0.75).normalize();   // faces the pilot, inboard/up
      const exx = new THREE.Vector3(0, 0, -1).cross(nn).negate().normalize();   // horizontal
      const eyy = new THREE.Vector3().crossVectors(nn, exx).normalize();
      this.lightPanel({
        center: c.clone().addScaledVector(nn, 0.04), ex: exx, ey: eyy, n: nn, cols: 3, rows: 3, cell: [0.023, 0.011],
        src: () => this.sim.cautionLights(),
        items: [{ key: 'CK SEAT', label: 'CK SEAT', color: Y }, { key: 'APU ACC', label: 'APU ACC', color: Y }, { key: 'BATT SW', label: 'BATT SW', color: Y },
          { key: 'FCS HOT', label: 'FCS HOT', color: Y }, { key: 'GEN TIE', label: 'GEN TIE', color: Y }, { key: 'FUEL LO', label: 'FUEL LO', color: Y },
          { key: 'FCES', label: 'FCES', color: Y }, { key: 'L GEN', label: 'L GEN', color: Y }, { key: 'R GEN', label: 'R GEN', color: Y }],
      });
    }
    // landing gear / flaps lights (left of IFEI, under the select-jett placard)
    const sj = this.panel('JETT STATION');
    if (sj) {
      const c = this.svg(sj, [20, 60], 0.002);
      this.lightPanel({
        center: c, ex: sj.exu, ey: sj.eyu.clone().negate(), n: sj.n, cols: 2, rows: 3, cell: [0.019, 0.012],
        src: () => this.sim.warningLights(),
        items: [{ key: 'GEAR N', label: 'NOSE', color: GR }, { key: 'HALF FLAPS', label: 'HALF', color: GR }, { key: 'GEAR L', label: 'LEFT', color: GR }, { key: 'FULL FLAPS', label: 'FULL', color: GR }, { key: 'GEAR R', label: 'RIGHT', color: GR }, { key: 'FLAPS', label: 'FLAPS', color: Y }],
      });
    }
  }

  // AOA indexer: only with the gear down and weight off wheels (lights test too)
  aoaIndexer() {
    const s = this.sim, lt = s.sw.ltTest === 'TEST' && s.elec.batt;
    if (lt) return { SLOW: true, ON: true, FAST: true };
    const o = this.k && this.k.scn && this.k.scn.own;
    if (!o || o.wow || o.gear !== 'DOWN' || !s.elec.ac) return {};
    const a = o.aoa;
    return { SLOW: a > 7.4, ON: a >= 6.9 && a <= 9.3, FAST: a < 8.8 };
  }

  // set a whole switch configuration at once (hot start / scenario load): sim state + 3D control positions
  applySwitches(sw) {
    for (const [k, v] of Object.entries(sw)) { this.sim.sw[k] = v; }
    for (const ctl of this.controls.values()) {
      const d = ctl.def; if (!d.key || !(d.key in sw)) continue;
      if (d.type === 'knob') { ctl.value = sw[d.key]; }
      else if (d.states) { const i = d.states.indexOf(sw[d.key]); if (i >= 0) ctl.state = i; }
      if (ctl.guard) ctl.guardOpen = false;
      ctl.apply && ctl.apply();
    }
  }

  hitBox(id, name, pos, ex, ey, n, size, def) {
    const g = new THREE.Group(); g.position.copy(pos);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, n)); this.root.add(g);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], 0.02), M.hit); g.add(hit);
    const ctl = { def: { id, name, ...def }, group: g, cock: this, pressed: false, highlight: [], apply: () => {} };
    this.addHit(hit, ctl); this.controls.set(id, ctl);
    return ctl;
  }

  // ------------------------------------------------------------------ instruments (canvas faces)
  instFace(name, draw, opt = {}) {
    const it = this.meta.screens.inst[name]; if (!it) return;
    const lo = V3(it.lo), hi = V3(it.hi), c = lo.clone().add(hi).multiplyScalar(0.5);
    const n = (opt.n || new THREE.Vector3(0, 0.196, 0.981)).clone().normalize();
    const ex = new THREE.Vector3(1, 0, 0), ey = new THREE.Vector3().crossVectors(n, ex).normalize();
    const size = opt.size || Math.min(hi.x - lo.x, hi.y - lo.y) * 0.82;
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(opt.square ? new THREE.PlaneGeometry(size, size) : new THREE.CircleGeometry(size / 2, 40), new THREE.MeshBasicMaterial({ map: tex }));
    const front = Math.max(...[lo, hi].map(p => p.clone().sub(c).dot(n)));
    plane.position.copy(c).addScaledVector(n, (opt.depth ?? front) + 0.001);
    if (opt.offset) plane.position.add(opt.offset);
    plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, n));
    this.root.add(plane);
    let acc = 0;
    this.updaters.push((dt) => { acc += dt; if (acc < 0.1) return; acc = 0; ctx.clearRect(0, 0, S, S); draw(ctx, S); tex.needsUpdate = true; });
    return { plane, c, n, ex, ey, size };
  }

  buildInstruments() {
    const s = this.sim;
    const dial = (ctx, S, title, ticks, val, max, unit) => {
      ctx.fillStyle = '#0c0c0d'; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, 7); ctx.fill();
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 3; ctx.fillStyle = '#ddd'; ctx.font = FONT(22); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i <= ticks; i++) {
        const a = -Math.PI * 0.75 + i / ticks * Math.PI * 1.5;
        ctx.beginPath(); ctx.moveTo(S / 2 + Math.sin(a) * S * 0.44, S / 2 - Math.cos(a) * S * 0.44); ctx.lineTo(S / 2 + Math.sin(a) * S * 0.36, S / 2 - Math.cos(a) * S * 0.36); ctx.stroke();
        ctx.fillText(String(Math.round(i * max / ticks)), S / 2 + Math.sin(a) * S * 0.28, S / 2 - Math.cos(a) * S * 0.28);
      }
      ctx.font = FONT(18); ctx.fillText(title, S / 2, S * 0.68); if (unit) ctx.fillText(unit, S / 2, S * 0.78);
      const a = -Math.PI * 0.75 + Math.min(1, val / max) * Math.PI * 1.5;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(S / 2, S / 2); ctx.lineTo(S / 2 + Math.sin(a) * S * 0.4, S / 2 - Math.cos(a) * S * 0.4); ctx.stroke();
    };
    const brakeN = new THREE.Vector3(0.45, 0.3, 0.85);
    this.instFace('brake', (ctx, S) => dial(ctx, S, 'BRAKE', 4, s.hyd.brake / 1000, 4, 'PSI x1000'), { n: brakeN, size: 0.032 });
    const hydN = new THREE.Vector3(-0.45, 0.3, 0.85);
    this.instFace('hyd', (ctx, S) => {
      dial(ctx, S, 'HYD', 5, s.hyd.h1 / 1000, 5, '1      2');
      const a = -Math.PI * 0.75 + Math.min(1, s.hyd.h2 / 5000) * Math.PI * 1.5;
      ctx.strokeStyle = '#ffcc33'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(S / 2, S / 2); ctx.lineTo(S / 2 + Math.sin(a) * S * 0.38, S / 2 - Math.cos(a) * S * 0.38); ctx.stroke();
    }, { n: hydN, size: 0.032 });
    this.instFace('radalt', (ctx, S) => {
      dial(ctx, S, s.radaltOn ? 'RADAR ALT' : 'OFF', 5, 0, 5, 'FT x100');
      const a = -Math.PI * 0.75 + Math.min(1, (s.sw.radaltIdx || 0) / 500) * Math.PI * 1.5;
      ctx.fillStyle = '#ffffff'; ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(a); ctx.fillRect(-5, -S * 0.49, 10, 22); ctx.restore();
      if (!s.radaltOn) { ctx.fillStyle = '#d33'; ctx.fillRect(S * 0.6, S * 0.55, S * 0.22, S * 0.12); }
    }, { n: new THREE.Vector3(-0.3, 0.3, 0.9), size: 0.05 });
    this.instFace('sbyAdi', (ctx, S) => {
      ctx.save(); ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, 7); ctx.clip();
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, S, S / 2); ctx.fillStyle = '#222'; ctx.fillRect(0, S / 2, S, S / 2);
      ctx.strokeStyle = '#333'; ctx.lineWidth = 3; for (let p = -20; p <= 20; p += 10) if (p) { ctx.beginPath(); ctx.moveTo(S / 2 - 30, S / 2 - p * 3); ctx.lineTo(S / 2 + 30, S / 2 - p * 3); ctx.stroke(); }
      ctx.strokeStyle = '#f80'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(S * 0.2, S / 2); ctx.lineTo(S * 0.42, S / 2); ctx.moveTo(S * 0.58, S / 2); ctx.lineTo(S * 0.8, S / 2); ctx.stroke();
      if (s.sw.sbyAdiCaged || !s.elec.ac) { ctx.fillStyle = '#e02020'; ctx.fillRect(S * 0.06, S * 0.38, S * 0.16, S * 0.24); ctx.fillStyle = '#fff'; ctx.font = FONT(20); ctx.fillText('OFF', S * 0.07, S * 0.52); }
      ctx.restore();
    }, { size: 0.062 });
    const simpleDial = (name, title, max, unit) => this.instFace(name, (ctx, S) => dial(ctx, S, title, 10, 0, max, unit), { size: 0.052 });
    simpleDial('sbyAlt', 'ALT', 10, 'FT x100'); simpleDial('sbyAsi', 'KNOTS', 8, 'x100'); simpleDial('sbyVsi', 'VERT SPD', 6, 'x1000');
    this.instFace('rwr', (ctx, S) => {
      ctx.fillStyle = '#060806'; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, 7); ctx.fill();
      if (s.sw.rwrPwr && s.elec.ac) { ctx.strokeStyle = '#3f3'; ctx.lineWidth = 3; [0.18, 0.34, 0.47].forEach(r => { ctx.beginPath(); ctx.arc(S / 2, S / 2, S * r, 0, 7); ctx.stroke(); }); ctx.beginPath(); ctx.moveTo(S / 2 - 10, S / 2); ctx.lineTo(S / 2 + 10, S / 2); ctx.moveTo(S / 2, S / 2 - 10); ctx.lineTo(S / 2, S / 2 + 10); ctx.stroke(); }
    }, { size: 0.066 });
    this.instFace('cabin', (ctx, S) => dial(ctx, S, 'CABIN ALT', 5, 0.3, 50, 'FT x1000'), { size: 0.045 });
    // standby ADI cage knob and radalt knob (push = up, grip = down)
    const adi = this.meta.screens.inst.sbyAdi;
    if (adi) {
      const n = new THREE.Vector3(0, 0.196, 0.981), ex = new THREE.Vector3(1, 0, 0), ey = new THREE.Vector3().crossVectors(n, ex);
      const p = V3(adi.c).addScaledVector(ex, 0.036).addScaledVector(ey, -0.036).addScaledVector(n, 0.03);
      this.hitBox('sbyAdiCage', 'STBY ATTITUDE CAGE/UNCAGE', p, ex, ey, n, [0.016, 0.016], { type: 'button', action: 'sbyAdiCage' });
      const k = this.makeKnobMesh(12); k.position.copy(p); k.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); this.root.add(k);
    }
    const ra = this.meta.screens.inst.radalt;
    if (ra) {
      const n = new THREE.Vector3(-0.3, 0.3, 0.9).normalize(), ex = new THREE.Vector3(1, 0, 0), ey = new THREE.Vector3().crossVectors(n, ex).normalize();
      const p = V3(ra.c).addScaledVector(ex, -0.026).addScaledVector(ey, -0.026).addScaledVector(n, 0.036);
      const ctl = this.hitBox('radaltKnob', 'RADAR ALT SET (A: +50 ft / B: -50 ft)', p, ex, ey, n, [0.016, 0.016], { type: 'radalt' });
      const k = this.makeKnobMesh(12); k.position.copy(p); k.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); this.root.add(k);
    }
  }

  // ------------------------------------------------------------------ throttles (procedural, left console outboard)
  buildThrottles() {
    this.levers = buildThrottleQuadrant(this, M);
  }
  throttleGrab(ctl) { throttleGrab(this, ctl); }
  throttleDrag(ctl, fwd) { throttleDrag(this, ctl, fwd); }
  throttleRelease(ctl) { throttleRelease(this, ctl); }

  buildSeat() {
    const g = new THREE.Group(); this.root.add(g);
    const pan = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.42), M.grip); pan.position.set(0, -0.68, 0.0); g.add(pan);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.75, 0.1), M.grip); back.position.set(0, -0.28, 0.24); back.rotation.x = -0.18; g.add(back);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.16), M.dark); head.position.set(0, 0.16, 0.30); head.rotation.x = -0.18; g.add(head);
    [-0.24, 0.24].forEach(x => { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.95, 0.06), M.dark); rail.position.set(x, -0.25, 0.26); rail.rotation.x = -0.18; g.add(rail); });
    // ejection seat arming handle (right side): SAFE (up) / ARMED (down)
    const pivot = new THREE.Group(); pivot.position.set(0.245, -0.58, -0.06); g.add(pivot);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.09), M.yellow); handle.position.set(0, 0, -0.045); pivot.add(handle);
    const stripes = new THREE.Mesh(new THREE.BoxGeometry(0.021, 0.013, 0.02), M.knob); stripes.position.set(0, 0, -0.07); pivot.add(stripes);
    const def = { id: 'seatArm', name: 'EJECTION SEAT ARMING HANDLE (SAFE up / ARMED down)', type: 'toggle', states: ['SAFE', 'ARMED'], key: 'seatArm', init: 'SAFE' };
    const ctl = { def, group: pivot, state: 0, cock: this, towardFwd: true, pivot };
    ctl.apply = () => { pivot.rotation.x = ctl.state === 0 ? 0.55 : -0.25; };
    ctl.apply();
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.11), M.hit); hit.position.set(0, 0, -0.045); pivot.add(hit); this.addHit(hit, ctl);
    ctl.highlight = [handle];
    this.register(ctl);
  }

  buildMisc() {
    const s = this.sim, inst = this.meta.screens.inst;
    // canopy switch (right canopy sill): OPEN / HOLD / CLOSE (CLOSE must be held)
    const cs = inst.canopySw;
    if (cs) {
      const fr = { o: V3(cs.c).add(new THREE.Vector3(-0.004, 0.02, 0)), n: new THREE.Vector3(-1, 0.6, 0).normalize(), exu: new THREE.Vector3(0, 0, -1), ex: new THREE.Vector3(0, 0, -1), key: 'canopy' };
      fr.eyu = new THREE.Vector3().crossVectors(fr.n, fr.exu).normalize(); fr.ey = fr.eyu;
      const g = new THREE.Group(); g.position.copy(fr.o); g.quaternion.copy(this.basis(fr)); this.root.add(g);
      const ctl = { def: { id: 'canopy', name: 'CANOPY (OPEN / HOLD / CLOSE)', type: 'toggle', states: ['CLOSE', 'HOLD', 'OPEN'], dir: 'fwd', key: 'canopy', init: 'HOLD', momentary: ['CLOSE'], rest: 'HOLD', lock: true }, group: g, frame: fr, cock: this };
      this.makeToggle(ctl); this.register(ctl);
    }
    // FCS BIT switch (right wall, spring loaded ON)
    {
      const p = new THREE.Vector3(0.40, -0.428, -0.212);
      const fr = { o: p, n: new THREE.Vector3(-1, 0, 0), exu: new THREE.Vector3(0, 0, -1), ex: new THREE.Vector3(0, 0, -1), key: 'fcsbit' };
      fr.eyu = new THREE.Vector3().crossVectors(fr.n, fr.exu).normalize(); fr.ey = fr.eyu;
      const g = new THREE.Group(); g.position.copy(p); g.quaternion.copy(this.basis(fr)); this.root.add(g);
      const ctl = { def: { id: 'fcsBit', name: 'FCS BIT (hold ON)', type: 'toggle', states: ['ON', 'OFF'], dir: 'up', key: 'fcsBit', init: 'OFF', momentary: ['ON'], rest: 'OFF' }, group: g, frame: fr, cock: this };
      this.makeToggle(ctl); this.register(ctl);
    }
    // parking brake handle (reference model): SET <-> RELEASED (rotate + push)
    let pb = null; this.model.traverse(o => { if (!pb && /^I_Parking_and_Emergency/.test(o.name)) pb = o; });
    const pbc = inst.parkBrake;
    if (pbc) {
      const p = V3(pbc.c);
      const ctl = this.hitBox('parkBrake', 'PARKING BRAKE (SET / RELEASED)', p, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), [0.06, 0.08], { type: 'handle', states: ['SET', 'RELEASED'], key: 'parkBrake' });
      ctl.state = 0;
      const nodes = []; this.model.traverse(o => { if (/^I_Parking_and_Emergency/.test(o.name || '')) nodes.push(o); });
      const pivot = p.clone();
      ctl.apply = () => {
        for (const o of nodes) {
          if (!o.userData.base) o.userData.base = { p: o.position.clone(), q: o.quaternion.clone() };
          const b = o.userData.base;
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ctl.state === 1 ? Math.PI / 2 : 0);
          const off = b.p.clone().sub(pivot).applyQuaternion(q).add(pivot).add(new THREE.Vector3(0, 0, ctl.state === 1 ? -0.025 : 0));
          o.position.copy(off); o.quaternion.copy(q).multiply(b.q); o.updateMatrix();
        }
      };
      this.register(ctl);
    }
    // EMERG JETT button (reference geometry kept), A/A A/G labels on mode buttons
    const ma = this.controls.get('aaMode'); if (ma) this.labelButton(ma, 'A/A');
    const mg = this.controls.get('agMode'); if (mg) this.labelButton(mg, 'A/G');
    const fe = this.controls.get('fireExtL'); if (fe) this.labelButton(fe, ['FIRE', 'EXTGH']);
    const rp = this.controls.get('rwrPwr'); if (rp) this.labelButton(rp, 'POWER');
    ['rwrDisp:DISPLAY', 'rwrSpec:SPECIAL', 'rwrOffset:OFFSET', 'rwrBit:BIT', 'ecmJett:ECM JETT'].forEach(s2 => { const [id, l] = s2.split(':'); const c = this.controls.get(id); if (c) this.labelButton(c, l.split(' ')); });
  }

  labelButton(ctl, text) {
    const d = ctl.def;
    const w = (d.w || d.size || 10) / 1000, h = (d.h || d.size || 10) / 1000;
    const t = textTexture(text, 128, 128, { bg: '#232527' });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, h * 0.92), new THREE.MeshBasicMaterial({ map: t }));
    face.rotation.x = -Math.PI / 2; face.position.y = 0.0062;
    ctl.group.children[0].add(face); ctl.face = face;
    if (ctl.frame) this.uprightFace(ctl, ctl.frame);
  }

  resetAll() {
    this.sim.reset();
    for (const ctl of this.controls.values()) {
      const d = ctl.def;
      if (d.type === 'toggle' || d.type === 'rotary' || d.type === 'handle') {
        const i = d.states.indexOf(d.init ?? d.states[d.states.length - 1]);
        ctl.state = i >= 0 ? i : 0; if (ctl.guard) ctl.guardOpen = false;
      } else if (d.type === 'knob') ctl.value = d.init ?? 0;
      if (ctl.pressed) ctl.pressed = false;
      ctl.apply && ctl.apply();
      if (d.key && d.type !== 'radalt') {
        if (d.type === 'knob') this.sim.sw[d.key] = ctl.value;
        else if (d.key === 'ilsChan') this.sim.sw.ilsChan = 1;
        else if (d.states) this.sim.sw[d.key] = d.states[ctl.state];
      }
    }
    this.sim.sw.parkBrake = 'SET';
    for (const dd of Object.values(this.ddis)) { dd.page = dd.defaultPage; dd.bitSub = 'MAIN'; dd.hsi.data = false; }
  }

  update(dt) {
    this.ufc.update(dt); this.ifei.update(dt);
    for (const u of this.updaters) u(dt);
    // keep controls in sync if the sim changed a switch by itself (APU auto-off, crank drop-out)
    for (const ctl of this.controls.values()) {
      const d = ctl.def; if (!d.key || !d.states || d.type === 'knob') continue;
      const v = this.sim.sw[d.key];
      if (d.key === 'ilsChan') continue;
      const i = d.states.indexOf(v);
      if (i >= 0 && i !== ctl.state) { ctl.state = i; ctl.apply && ctl.apply(); }
    }
    const ch1 = this.controls.get('comm1Ch'); if (ch1) ch1.apply();
    const ch2 = this.controls.get('comm2Ch'); if (ch2) ch2.apply();
  }
}
