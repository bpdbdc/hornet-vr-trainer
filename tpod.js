import * as THREE from 'three';
import { NM, FT } from './scenario.js';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// Litening targeting pod + AGM-65F seeker: render-to-texture cameras looking at the airborne world (layer 1),
// shown on the DDI behind the page symbology through an IR (luminance, WHOT/BHOT) shader.
const IR_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
const IR_FS = `uniform sampler2D map; uniform float inv; uniform float t; varying vec2 vUv;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + t) * 43758.5453); }
void main(){ vec3 c = texture2D(map, vUv).rgb; float l = dot(c, vec3(0.3,0.59,0.11)); l = pow(l, 0.8);
 l = mix(l, 1.0 - l, inv); l += (rnd(vUv*512.0) - 0.5) * 0.06; gl_FragColor = vec4(vec3(l), 1.0); }`;

export class TPod {
  constructor(renderer, cockpitRoot, sim, scn, wpn) {
    Object.assign(this, { renderer, sim, scn, wpn });
    this.rt = new THREE.WebGLRenderTarget(320, 320);
    this.rtMav = new THREE.WebGLRenderTarget(256, 256);
    // the airborne world is scaled around the design eye (see world_air.js), so the cameras sit at the eye
    this.cam = new THREE.PerspectiveCamera(6, 1, 0.02, 40000); this.cam.layers.set(1);
    this.camMav = new THREE.PerspectiveCamera(4, 1, 0.02, 40000); this.camMav.layers.set(1);
    cockpitRoot.add(this.cam, this.camMav);
    this.los = { az: 0, el: -10 }; this.track = 'SNO'; this.fov = 'WIDE'; this.polarity = 'WHOT'; this.laserArm = true; this.code = 1688;
    this.point = null; this.ptContact = null; this.acc = 0;
    this.irMat = (rt) => new THREE.ShaderMaterial({ uniforms: { map: { value: rt.texture }, inv: { value: 0 }, t: { value: 0 } }, vertexShader: IR_VS, fragmentShader: IR_FS, toneMapped: false });
    this.matPod = this.irMat(this.rt); this.matMav = this.irMat(this.rtMav);
  }
  available() { return Object.values(this.wpn.stations).some(s => s && s.type === 'LITENING'); }
  cycleFov() { this.fov = { WIDE: 'NARO', NARO: 'ZOOM', ZOOM: 'WIDE' }[this.fov]; }
  fovDeg() { return { WIDE: 6, NARO: 1.5, ZOOM: 0.75 }[this.fov]; }

  // body-frame LOS (az right +, el up +) -> local camera orientation in cockpit frame
  aim(cam, az, el) {
    const dir = new THREE.Vector3(Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), -Math.cos(az * D2R) * Math.cos(el * D2R));
    cam.lookAt(cam.position.clone().add(dir).applyMatrix4(cam.parent.matrixWorld));
  }
  // LOS that points to a world point
  losTo(e, n, alt) {
    const d = this.scn.toCockpitDir({ e, n, alt, hdg: 0, tas: 0 });
    return { az: Math.atan2(d[0], -d[2]) * R2D, el: Math.atan2(d[1], Math.hypot(d[0], d[2])) * R2D };
  }
  // ground point under a LOS
  groundPoint(az, el) {
    const o = this.scn.own; if (o.wow) return null;
    const d = [Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), -Math.cos(az * D2R) * Math.cos(el * D2R)];
    const w = this.scn.bodyToWorld(d);
    if (w.el >= -0.3) return null;
    const h = o.alt * FT, dist = h / Math.tan(-w.el * D2R);
    return { e: o.e + Math.sin(w.az * D2R) * dist, n: o.n + Math.cos(w.az * D2R) * dist, alt: 0 };
  }
  slantNm() { const p = this.point || this.groundPoint(this.los.az, this.los.el); if (!p) return null; const o = this.scn.own; return Math.hypot(p.e - o.e, p.n - o.n, o.alt * FT) / NM; }

  slew(dx, dy, dt) {
    const k = this.fovDeg() * 0.8 * dt;
    if (this.track === 'POINT') { this.track = 'AREA'; this.ptContact = null; }
    if (this.point && this.track === 'AREA') { const p = this.groundPoint(this.los.az + dx * k, this.los.el + dy * k); if (p) this.point = p; }
    this.los.az = Math.max(-150, Math.min(150, this.los.az + dx * k)); this.los.el = Math.max(-150, Math.min(30, this.los.el + dy * k));
    if (this.track === 'SNO') this.track = 'INR';
  }
  designate() {
    const p = this.groundPoint(this.los.az, this.los.el); if (!p) return;
    this.point = p; this.track = 'AREA';
    this.sim.agTarget = { ...p, src: 'FLIR' }; this.sim.log('designate', { src: 'FLIR' });
  }
  pointTrack() {
    const p = this.point || this.groundPoint(this.los.az, this.los.el); if (!p) return;
    let best = null, bd = 60;
    for (const c of this.scn.contacts) { if (!c.alive || c.kind === 'air') continue; const d = Math.hypot(c.e - p.e, c.n - p.n); if (d < bd) { bd = d; best = c; } }
    if (best) { this.ptContact = best; this.track = 'POINT'; this.point = { e: best.e, n: best.n, alt: 0 }; }
  }
  areaTrack() { this.ptContact = null; const p = this.groundPoint(this.los.az, this.los.el); if (p) { this.point = p; this.track = 'AREA'; } }
  undesignate() { this.point = null; this.ptContact = null; this.track = 'SNO'; this.los = { az: 0, el: -10 }; this.sim.agTarget = null; }

  mavSlew(dx, dy, dt) { const L = this.wpn.ag.mavLos; L.az = Math.max(-25, Math.min(25, L.az + dx * 3 * dt)); L.el = Math.max(-35, Math.min(5, L.el + dy * 3 * dt)); this.wpn.ag.mavTrack = null; }
  mavLock() {
    const L = this.wpn.ag.mavLos; let best = null, bd = 2.5;
    for (const c of this.scn.contacts) { if (!c.alive || c.kind === 'air') continue; const r = this.scn.rel(c); if (r.rngNm > 12) continue; const l = this.losTo(c.e, c.n, 0); const d = Math.hypot(l.az - L.az, l.el - L.el); if (d < bd) { bd = d; best = c; } }
    this.wpn.ag.mavTrack = best; if (best) this.sim.log('mavLock', { tgt: best.type });
  }

  update(dt, ddis) {
    const s = this.sim;
    // keep stabilised LOS on the designated point / tracked contact
    if (this.ptContact) { if (!this.ptContact.alive) { this.ptContact = null; this.track = 'AREA'; } else this.point = { e: this.ptContact.e, n: this.ptContact.n, alt: 0 }; }
    if (this.point && this.track !== 'SNO') { this.los = this.losTo(this.point.e, this.point.n, 0); if (this.sim.agTarget && this.sim.agTarget.src === 'FLIR') Object.assign(this.sim.agTarget, this.point); }
    const mav = this.wpn.ag; if (mav.mavTrack && mav.mavTrack.alive) { const l = this.losTo(mav.mavTrack.e, mav.mavTrack.n, 0); mav.mavLos.az = l.az; mav.mavLos.el = l.el; }
    s.laserOn = s.laserFire && this.laserArm && s.sw.ltdr === 'ARM' && s.sw.flir === 'ON' && this.available() && !this.scn.own.wow;
    this.acc += dt;
    const needPod = Object.values(ddis).some(d => d.powered() && d.page === 'FLIR');
    const needMav = Object.values(ddis).some(d => d.powered() && d.page === 'MAV');
    if (this.acc < 1 / 12 || this.scn.own.wow || (!needPod && !needMav)) return;
    this.acc = 0;
    const r = this.renderer, xr = r.xr.enabled;
    r.xr.enabled = false;
    const prevRT = r.getRenderTarget();
    this.cam.parent.updateMatrixWorld(true);
    if (needPod && s.sw.flir === 'ON') {
      this.cam.fov = this.fovDeg(); this.cam.updateProjectionMatrix(); this.aim(this.cam, this.los.az, this.los.el);
      r.setRenderTarget(this.rt); r.render(this.cam.parent.parent, this.cam);
      this.matPod.uniforms.inv.value = this.polarity === 'BHOT' ? 1 : 0; this.matPod.uniforms.t.value = s.t;
    }
    if (needMav) {
      this.camMav.fov = 3.5; this.camMav.updateProjectionMatrix(); this.aim(this.camMav, mav.mavLos.az, mav.mavLos.el);
      r.setRenderTarget(this.rtMav); r.render(this.camMav.parent.parent, this.camMav);
      this.matMav.uniforms.t.value = s.t;
    }
    r.setRenderTarget(prevRT);
    r.xr.enabled = xr;
  }
}
