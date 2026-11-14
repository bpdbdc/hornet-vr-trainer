import * as THREE from 'three';
import { XRControllerModelFactory } from './XRControllerModelFactory.js';
import { XRHandModelFactory } from './XRHandModelFactory.js';

// Input: XR controllers (ray + trigger/grip/thumbstick), hand tracking (finger poke + pinch-twist), desktop mouse.
// Actions on a control: 'A' = forward/up/clockwise/press, 'B' = aft/down/counter-clockwise, 'release'.
export class Interaction {
  constructor(renderer, scene, camera, cockpit, ui) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.cockpit = cockpit; this.ui = ui;
    this.ray = new THREE.Raycaster(); this.ray.far = 2.5;
    this.hover = new Map();       // source -> control
    this.held = new Map();        // source -> control being held
    this.drags = new Map();       // source -> throttle lever being dragged
    this.tip = this.makeTooltip();
    this.enabled = true;
    this.setupXR();
    this.setupDesktop();
  }

  makeTooltip() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(0.16, 0.03, 1); spr.renderOrder = 999; spr.visible = false;
    this.scene.add(spr);
    return { c, ctx: c.getContext('2d'), tex, spr, text: '' };
  }
  showTip(ctl, point) {
    const t = this.tip;
    if (!ctl) { t.spr.visible = false; return; }
    const d = ctl.def;
    let st = '';
    if (d.type === 'toggle' || d.type === 'rotary' || d.type === 'handle') st = d.states[ctl.state];
    else if (d.type === 'knob') st = Math.round(ctl.value * 100) + '%';
    else if (d.type === 'channel') st = 'CH ' + (this.cockpit.ufc.comm[d.radio].ch);
    const text = `${d.name}${st ? '  ·  ' + st : ''}`;
    if (text !== t.text) {
      t.text = text; const x = t.ctx;
      x.clearRect(0, 0, 512, 96); x.fillStyle = 'rgba(10,14,18,0.85)'; x.fillRect(0, 10, 512, 76);
      x.strokeStyle = '#7fd1ff'; x.lineWidth = 3; x.strokeRect(2, 12, 508, 72);
      x.fillStyle = '#fff'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      let fs = 30; while (x.measureText(text).width > 490 && fs > 14) { fs -= 2; x.font = `bold ${fs}px sans-serif`; }
      x.fillText(text, 256, 48); t.tex.needsUpdate = true;
    }
    t.spr.visible = true;
    t.spr.position.copy(point).add(new THREE.Vector3(0, 0.035, 0.01));
  }

  pick(origin, dir) {
    this.ray.set(origin, dir);
    const targets = this.cockpit.hitList.concat(this.ui ? this.ui.hitList : []);
    const hits = this.ray.intersectObjects(targets, false);
    if (!hits.length) return null;
    return { ctl: hits[0].object.userData.control, point: hits[0].point, dist: hits[0].distance };
  }

  fire(ctl, act, src) {
    if (!ctl) return;
    if (ctl.def && ctl.def.type === 'throttle' && (act === 'A' || act === 'B')) {
      this.drags.set(src, { ctl, act, p0: null, moved: 0 }); this.cockpit.throttleGrab(ctl); return;
    }
    if (ctl.ui) { if (act !== 'release') ctl.onClick(act); return; }
    if (ctl.def.type === 'radalt') { if (act === 'release') return; this.cockpit.act({ def: { type: 'button', action: act === 'A' ? 'radaltUp' : 'radaltDn' }, apply() {} }, 'A'); return; }
    this.cockpit.act(ctl, act);
    if (act !== 'release') { this.held.set(src, ctl); if (this.onAction) this.onAction(ctl, act); }
  }
  // drag a throttle lever: point = world position of the controller / pinch, or {mouseY}
  dragUpdate(src, point) {
    const dg = this.drags.get(src); if (!dg) return false;
    let fwd;
    if (point.mouseY !== undefined) { if (dg.p0 === null) dg.p0 = point.mouseY; fwd = (dg.p0 - point.mouseY) * 0.0006; }
    else { const p = this.cockpit.root.worldToLocal(point.clone()); if (dg.p0 === null) dg.p0 = p.z; fwd = dg.p0 - p.z; }
    dg.moved = Math.max(dg.moved, Math.abs(fwd));
    if (dg.moved > 0.006) this.cockpit.throttleDrag(dg.ctl, fwd);
    return true;
  }
  release(src) {
    const dg = this.drags.get(src);
    if (dg) { this.drags.delete(src); this.cockpit.throttleRelease(dg.ctl); if (dg.moved <= 0.006 && dg.act) this.cockpit.act(dg.ctl, dg.act); return; }
    const c = this.held.get(src); if (c) { this.cockpit.act(c, 'release'); this.held.delete(src); } }

  // ---------------------------------------------------------------- XR
  setupXR() {
    const r = this.renderer;
    const cmf = new XRControllerModelFactory(), hmf = new XRHandModelFactory();
    this.xr = [];
    for (let i = 0; i < 2; i++) {
      const ctrl = r.xr.getController(i);
      const grip = r.xr.getControllerGrip(i); grip.add(cmf.createControllerModel(grip));
      const hand = r.xr.getHand(i); hand.add(hmf.createHandModel(hand, 'mesh'));
      this.scene.add(ctrl, grip, hand);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x7fd1ff, transparent: true, opacity: 0.7 }));
      line.scale.z = 0.6; ctrl.add(line);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0025, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7fd1ff }));
      this.scene.add(dot); dot.visible = false;
      const st = { ctrl, grip, hand, line, dot, src: 'xr' + i, inputSource: null, stickCool: 0, poke: new Map(), pinch: null, lastTip: null };
      ctrl.addEventListener('connected', (e) => { st.inputSource = e.data; st.isHand = !!e.data.hand; st.side = e.data.handedness === 'left' ? 'L' : 'R'; line.visible = !st.isHand; });
      ctrl.addEventListener('disconnected', () => { st.inputSource = null; });
      ctrl.addEventListener('selectstart', () => { if (st.isHand || this.hotasOn(st)) return; this.fire(this.hover.get(st.src), 'A', st.src); });
      ctrl.addEventListener('selectend', () => { if (st.isHand || this.hotasOn(st)) return; this.release(st.src); });
      ctrl.addEventListener('squeezestart', () => { if (st.isHand || this.hotasOn(st)) return; this.fire(this.hover.get(st.src), 'B', st.src); });
      ctrl.addEventListener('squeezeend', () => { if (st.isHand || this.hotasOn(st)) return; this.release(st.src); });
      this.xr.push(st);
    }
  }

  hotasOn(st) { return !!(this.hotas && st.side && this.hotas.hand[st.side].active); }

  updateXR(dt) {
    const tmpM = new THREE.Matrix4(), o = new THREE.Vector3(), d = new THREE.Vector3();
    for (const st of this.xr) {
      if (!st.inputSource) { st.dot.visible = false; continue; }
      if (st.isHand) { this.updateHand(st, dt); continue; }
      const gp0 = st.inputSource.gamepad;
      if (this.hotas && gp0 && st.side) {
        const t = performance.now() / 1000, cl = !!(gp0.buttons[3] && gp0.buttons[3].pressed);
        if (cl !== !!st.clk) { st.clk = cl; this.hotas.click(st.side, cl, t); }
        this.hotas.clickHold(st.side, t);
        const on = this.hotasOn(st);
        if (on && !st.card) { st.card = this.makeCard(st.side); st.grip.add(st.card); }
        if (st.card) st.card.visible = on && this.showCards !== false;
        if (on) {
          if (this.held.get(st.src)) this.release(st.src);
          st.line.visible = false; st.dot.visible = false; this.hover.delete(st.src); if (this.lastTipSrc === st.src) this.showTip(null);
          this.hotas.xr(st, gp0, dt, st.side, this.cockpit.root);
          continue;
        }
        st.line.visible = true;
      }
      tmpM.identity().extractRotation(st.ctrl.matrixWorld);
      o.setFromMatrixPosition(st.ctrl.matrixWorld); d.set(0, 0, -1).applyMatrix4(tmpM);
      if (this.dragUpdate(st.src, o)) continue;      // lever held: keep the grab, no re-picking
      const h = this.pick(o, d);
      const prev = this.hover.get(st.src);
      if (h) { this.hover.set(st.src, h.ctl); st.dot.visible = true; st.dot.position.copy(h.point); st.line.scale.z = h.dist; this.showTip(h.ctl, h.point); }
      else { this.hover.delete(st.src); st.dot.visible = false; st.line.scale.z = 0.6; if (prev && this.lastTipSrc === st.src) this.showTip(null); }
      if (h) this.lastTipSrc = st.src;
      // thumbstick: up/down = A/B for toggles, left/right = rotate knobs
      const gp = st.inputSource.gamepad;
      if (gp && gp.axes.length >= 4) {
        const ax = gp.axes[2], ay = gp.axes[3];
        st.stickCool -= dt;
        const ctl = this.hover.get(st.src);
        if (ctl && st.stickCool <= 0) {
          const t = ctl.def && ctl.def.type;
          const hz = this.cockpit.k && this.cockpit.k.hotas;
          if (t === 'tdc' && hz) { hz.tdc(Math.abs(ax) > 0.15 ? ax : 0, Math.abs(ay) > 0.15 ? -ay : 0, dt); }
          else if (t === 'wheel' && hz) { if (Math.abs(ay) > 0.2) hz.elevation(-ay, dt); }
          else if (t === 'knob' && Math.abs(ax) > 0.25) { this.cockpit.act(ctl, { delta: ax * dt * 0.8 }); }
          else if (Math.abs(ay) > 0.7 || Math.abs(ax) > 0.7) {
            const act = Math.abs(ay) > Math.abs(ax) ? (ay < 0 ? 'A' : 'B') : (ax > 0 ? 'A' : 'B');
            if (t !== 'button' && t !== 'osb') { this.fire(ctl, act, st.src + 's'); this.release(st.src + 's'); }
            st.stickCool = 0.35;
          }
        }
        // menu (left 'X'/'Y' or 'A'/'B' buttons) toggles the exam panel
        if (gp.buttons[4] && gp.buttons[4].pressed && !st.b4) { st.b4 = true; this.ui && this.ui.toggle(); }
        if (gp.buttons[4] && !gp.buttons[4].pressed) st.b4 = false;
        if (gp.buttons[5] && gp.buttons[5].pressed && !st.b5) { st.b5 = true; this.onRecenter && this.onRecenter(); }
        if (gp.buttons[5] && !gp.buttons[5].pressed) st.b5 = false;
      }
    }
  }

  makeCard(side) {
    const m = this.cardFactory ? this.cardFactory(side) : new THREE.Group();
    m.position.set(0, 0.11, 0.02); m.rotation.x = -0.6;
    return m;
  }

  updateHand(st, dt) {
    const tipJ = st.hand.joints && st.hand.joints['index-finger-tip'];
    const thumbJ = st.hand.joints && st.hand.joints['thumb-tip'];
    const wrist = st.hand.joints && st.hand.joints['wrist'];
    if (!tipJ || !thumbJ) return;
    const tip = new THREE.Vector3().setFromMatrixPosition(tipJ.matrixWorld);
    const thumb = new THREE.Vector3().setFromMatrixPosition(thumbJ.matrixWorld);
    const vel = st.lastTip ? tip.clone().sub(st.lastTip).divideScalar(Math.max(dt, 1e-3)) : new THREE.Vector3();
    st.lastTip = tip.clone();
    // poke: fingertip inside a hit volume
    let near = null, best = 0.014;
    for (const m of this.cockpit.hitList.concat(this.ui ? this.ui.hitList : [])) {
      const p = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
      const dd = p.distanceTo(tip);
      if (dd < best) { best = dd; near = m.userData.control; }
    }
    st.dot.visible = !!near; if (near) { st.dot.position.copy(tip); this.showTip(near, tip); this.lastTipSrc = st.src; }
    const now = performance.now() / 1000;
    if (near) {
      const last = st.poke.get(near) || 0;
      if (now - last > 0.45) {
        const t = near.def ? near.def.type : 'ui';
        if (near.ui || t === 'button' || t === 'osb' || t === 'handle' || t === 'channel' || t === 'hotas' || t === 'tdc' || t === 'wheel') {
          this.fire(near, 'A', st.src + 'p'); st.poke.set(near, now);
          setTimeout(() => this.release(st.src + 'p'), 250);
        } else if (t === 'toggle' && vel.length() > 0.12) {
          // direction of the finger relative to the forward/up throw
          const g = near.group; const q = g.getWorldQuaternion(new THREE.Quaternion());
          const axisW = (near.axis || new THREE.Vector3(1, 0, 0)).clone().applyQuaternion(q);
          const nW = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
          const throwW = new THREE.Vector3().crossVectors(axisW, nW).negate().normalize();   // toward states[0]
          const along = vel.dot(throwW);
          if (Math.abs(along) > 0.08) {
            const towardFirst = along > 0;
            const act = (towardFirst === near.towardFwd) ? 'A' : 'B';
            this.fire(near, act, st.src + 'p'); st.poke.set(near, now);
            if (near.def.momentary) { st.holdCtl = near; } else this.release(st.src + 'p');
          }
        }
      }
    } else if (st.holdCtl) { this.cockpit.act(st.holdCtl, 'release'); st.holdCtl = null; this.held.delete(st.src + 'p'); }
    // pinch + twist for knobs / rotaries
    const pinching = tip.distanceTo(thumb) < 0.018;
    if (pinching) {
      const mid = tip.clone().add(thumb).multiplyScalar(0.5);
      if (!st.pinch) {
        let ctl = null, b2 = 0.03;
        for (const m of this.cockpit.hitList) {
          const p = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld); const dd = p.distanceTo(mid);
          const t = m.userData.control.def.type;
          if (dd < b2 && (t === 'knob' || t === 'rotary' || t === 'channel' || t === 'toggle')) { b2 = dd; ctl = m.userData.control; }
          if (t === 'throttle' && dd < 0.06 && dd < b2 + 0.03) { b2 = dd; ctl = m.userData.control; }
        }
        if (ctl && ctl.def.type === 'throttle') { this.fire(ctl, 'A', st.src + 'q'); const dg = this.drags.get(st.src + 'q'); if (dg) dg.act = null; st.pinch = { ctl, throttle: true }; }
        else if (ctl && wrist) {
          const q = new THREE.Quaternion().setFromRotationMatrix(wrist.matrixWorld);
          st.pinch = { ctl, roll0: this.roll(q), acc: 0, y0: mid.clone() };
        }
      } else if (st.pinch.throttle) {
        this.dragUpdate(st.src + 'q', mid);
      } else if (wrist) {
        const q = new THREE.Quaternion().setFromRotationMatrix(wrist.matrixWorld);
        const r = this.roll(q); let dr = r - st.pinch.roll0; if (dr > Math.PI) dr -= 2 * Math.PI; if (dr < -Math.PI) dr += 2 * Math.PI;
        st.pinch.roll0 = r;
        const ctl = st.pinch.ctl, t = ctl.def.type;
        if (t === 'knob') this.cockpit.act(ctl, { delta: -dr / 4.7 });
        else if (t === 'toggle') {
          // pinch-drag a toggle: move along throw direction by 1.5 cm
          const moved = mid.clone().sub(st.pinch.y0);
          const q2 = ctl.group.getWorldQuaternion(new THREE.Quaternion());
          const axisW = (ctl.axis || new THREE.Vector3(1, 0, 0)).clone().applyQuaternion(q2);
          const nW = new THREE.Vector3(0, 1, 0).applyQuaternion(q2);
          const throwW = new THREE.Vector3().crossVectors(axisW, nW).negate().normalize();
          const a = moved.dot(throwW);
          if (Math.abs(a) > 0.015) { this.fire(ctl, ((a > 0) === ctl.towardFwd) ? 'A' : 'B', st.src + 'q'); st.pinch.y0 = mid.clone(); }
        } else {
          st.pinch.acc += dr;
          if (Math.abs(st.pinch.acc) > 0.45) { this.fire(ctl, st.pinch.acc < 0 ? 'A' : 'B', st.src + 'q'); this.release(st.src + 'q'); st.pinch.acc = 0; }
        }
      }
    } else if (st.pinch) { this.release(st.src + 'q'); st.pinch = null; }
  }
  roll(q) { const e = new THREE.Euler().setFromQuaternion(q, 'ZXY'); return e.z; }

  // ---------------------------------------------------------------- desktop
  setupDesktop() {
    const el = this.renderer.domElement;
    this.mouse = new THREE.Vector2(); this.yaw = 0; this.pitch = -0.25; this.drag = null;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (this.dragUpdate('mouse', { mouseY: e.clientY })) return;
      if (this.drag) {
        this.yaw -= (e.clientX - this.drag.x) * 0.004; this.pitch -= (e.clientY - this.drag.y) * 0.004;
        this.pitch = Math.max(-1.4, Math.min(1.2, this.pitch)); this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.moved = true;
      }
    });
    el.addEventListener('pointerdown', (e) => {
      if (this.renderer.xr.isPresenting) return;
      const c = this.hover.get('mouse');
      if (c) { this.fire(c, e.button === 2 ? 'B' : 'A', 'mouse'); }
      else this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => { this.release('mouse'); this.drag = null; });
    el.addEventListener('wheel', (e) => {
      const c = this.hover.get('mouse'); if (!c) { this.camera.fov = Math.max(30, Math.min(95, this.camera.fov + e.deltaY * 0.03)); this.camera.updateProjectionMatrix(); return; }
      e.preventDefault();
      if (c.def && c.def.type === 'knob') this.cockpit.act(c, { delta: -Math.sign(e.deltaY) * 0.05 });
      else { this.fire(c, e.deltaY < 0 ? 'A' : 'B', 'wheel'); this.release('wheel'); }
    }, { passive: false });
  }

  updateDesktop() {
    if (this.renderer.xr.isPresenting) return;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.ray.setFromCamera(this.mouse, this.camera);
    const h = this.pick(this.ray.ray.origin.clone(), this.ray.ray.direction.clone());
    if (h) { this.hover.set('mouse', h.ctl); this.showTip(h.ctl, h.point); this.renderer.domElement.style.cursor = 'pointer'; }
    else { this.hover.delete('mouse'); this.showTip(null); this.renderer.domElement.style.cursor = 'grab'; }
  }

  update(dt) { if (this.renderer.xr.isPresenting) this.updateXR(dt); else this.updateDesktop(); }
}
