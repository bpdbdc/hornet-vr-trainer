import * as THREE from 'three';
import { NM, FT } from './scenario.js';

// Outside world for the frozen-airborne scenarios. Floating origin: the cockpit stays at the origin,
// the world is moved/rotated by the inverse of own-ship position and attitude.
// Layer 1 = things the targeting pod / Maverick cameras can see.
const D2R = Math.PI / 180;

function terrainTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#6f7552'; x.fillRect(0, 0, 1024, 1024);
  const cols = ['#7d8158', '#66704a', '#8a8660', '#5d6844', '#9a9068', '#717a50'];
  for (let i = 0; i < 260; i++) { x.fillStyle = cols[i % cols.length]; const w = 30 + Math.random() * 120, h = 30 + Math.random() * 120; x.save(); x.translate(Math.random() * 1024, Math.random() * 1024); x.rotate(Math.random() * 0.6 - 0.3); x.fillRect(-w / 2, -h / 2, w, h); x.restore(); }
  x.strokeStyle = 'rgba(70,65,55,0.8)'; x.lineWidth = 3;
  for (let i = 0; i < 14; i++) { x.beginPath(); x.moveTo(Math.random() * 1024, 0); x.bezierCurveTo(Math.random() * 1024, 300, Math.random() * 1024, 700, Math.random() * 1024, 1024); x.stroke(); }
  x.strokeStyle = 'rgba(60,90,120,0.9)'; x.lineWidth = 7; x.beginPath(); x.moveTo(0, 600); x.bezierCurveTo(300, 500, 600, 800, 1024, 650); x.stroke();
  for (let i = 0; i < 20000; i++) { const v = Math.random() * 40 - 20; x.fillStyle = `rgba(${100 + v},${100 + v},${80 + v},0.08)`; x.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function vehicle(kind) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x5b5f3e, roughness: 0.8, emissive: 0x332211, emissiveIntensity: 0.35 });
  const hot = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffffff, emissiveIntensity: 0.9 });
  if (kind === 'Bunker') { g.add(new THREE.Mesh(new THREE.BoxGeometry(18, 5, 12), new THREE.MeshStandardMaterial({ color: 0x8b877a, roughness: 1 }))); g.children[0].position.y = 2.5; return g; }
  if (kind === 'Frigate') { const h = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 120), new THREE.MeshStandardMaterial({ color: 0x7a7f86 })); h.position.y = 4; g.add(h); const s = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 30), h.material); s.position.set(0, 14, 10); g.add(s); return g; }
  const len = kind === 'Truck' ? 7 : 7.5, w = 3.4;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, len), body); hull.position.y = 1.4; g.add(hull);
  if (kind === 'T-72' || kind === 'BMP-2' || kind === 'ZSU-23') { const tur = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 2.6), body); tur.position.set(0, 3, -0.4); g.add(tur); const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 6), body); gun.rotation.x = Math.PI / 2; gun.position.set(0, 3, -3.2); g.add(gun); }
  if (kind.startsWith('SA-')) { const l = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 5.5), body); l.position.set(0, 3.2, 0); l.rotation.x = -0.5; g.add(l); }
  const exh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.3), hot); exh.position.set(0, 1.6, len / 2 + 0.1); g.add(exh);
  return g;
}

function jet(color = 0x8a9096) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  const fus = new THREE.Mesh(new THREE.ConeGeometry(0.9, 17, 10), m); fus.rotation.x = -Math.PI / 2; g.add(fus);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.25, 4), m); wing.position.z = 2; g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.2, 2.2), m); tail.position.z = 7; g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 2.4), m); fin.position.set(0, 1.6, 6.5); g.add(fin);
  const glint = new THREE.Mesh(new THREE.SphereGeometry(6, 6, 4), new THREE.MeshBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.25, depthWrite: false })); g.add(glint); g.userData.glint = glint;
  return g;
}

export class AirWorld {
  constructor(scene, scn) {
    this.scn = scn; this.scene = scene;
    this.root = new THREE.Group(); this.root.visible = false; scene.add(this.root);
    this.world = new THREE.Group(); this.root.add(this.world);
    this.sky = new THREE.Group(); this.root.add(this.sky);
    const tt = terrainTexture(); tt.repeat.set(180, 180);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200000, 1200000), new THREE.MeshStandardMaterial({ map: tt, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.layers.enable(1); this.world.add(ground);
    // a few hills / mountains for horizon cues
    const hm = new THREE.MeshStandardMaterial({ color: 0x77755a, flatShading: true, roughness: 1 });
    for (let i = 0; i < 40; i++) { const h = new THREE.Mesh(new THREE.ConeGeometry(3000 + Math.random() * 6000, 800 + Math.random() * 2500, 7), hm); h.position.set((Math.random() - 0.5) * 300000, 400, (Math.random() - 0.5) * 300000); h.layers.enable(1); this.world.add(h); }
    // cloud layer
    const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 70; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), cm); c.scale.set(2000 + Math.random() * 3000, 300 + Math.random() * 300, 2000 + Math.random() * 3000); c.position.set((Math.random() - 0.5) * 250000, 2400 + Math.random() * 600, (Math.random() - 0.5) * 250000); this.world.add(c); }
    // sky dome (not scaled, follows the attitude only) + sun light for the outside world
    const skyMat = this.skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { night: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float night; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 top = vec3(0.22,0.42,0.78), hor = vec3(0.72,0.80,0.88), gnd = vec3(0.42,0.43,0.38); vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.55)) : mix(hor, gnd, min(1.0, -h * 12.0)); vec3 n = h > 0.0 ? mix(vec3(0.03,0.04,0.07), vec3(0.005,0.008,0.02), pow(h,0.5)) : vec3(0.01,0.012,0.015); gl_FragColor = vec4(mix(c, n, night), 1.0); }' });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), skyMat); dome.renderOrder = -10; dome.layers.enable(1);
    this.sky.add(dome);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.2); this.sun.position.set(0.4, 1, 0.3); this.sun.layers.set(1); this.sky.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x5a5a48, 0.9); this.hemi.layers.set(1); this.sky.add(this.hemi);
    this.fog = new THREE.FogExp2(0xb8c6d2, 0.0001);
    this.k = 1;
    this.objs = new Map(); this.fx = [];
    this.missileMat = new THREE.MeshBasicMaterial({ color: 0xffeecc });
    scn.on((t, d) => {
      if (t === 'load') this.rebuild();
      if (t === 'kill') this.boom(d.c.e, d.c.n, d.c.alt, d.c.kind === 'air' ? 25 : 40);
      if (t === 'impact') this.boom(d.e, d.n, 0, 35);
    });
  }
  setNight(v) {
    this.skyMat.uniforms.night.value = v ? 1 : 0;
    this.fog.color.set(v ? 0x04060a : 0xb8c6d2);
    this.sun.intensity = v ? 0.02 : 2.2; this.hemi.intensity = v ? 0.25 : 0.9;   // pod sees in IR anyway
  }
  rebuild() {
    for (const o of this.objs.values()) this.world.remove(o);
    this.objs.clear();
    for (const c of this.scn.contacts) {
      const m = c.kind === 'air' ? jet(c.hostile ? 0x6f7680 : 0x9aa2aa) : vehicle(c.type);
      m.traverse(o => o.layers && o.layers.enable(1));
      this.world.add(m); this.objs.set(c.id, m);
    }
    this.root.visible = !this.scn.own.wow;
  }
  boom(e, n, alt, size) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 1 }));
    s.position.set(e, alt * FT + size / 2, -n); s.layers.enable(1); this.world.add(s);
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(size * 1.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.6, depthWrite: false }));
    smoke.position.copy(s.position); smoke.layers.enable(1); this.world.add(smoke);
    this.fx.push({ s, smoke, t: 0 });
  }
  update(dt, weapons, ewm) {
    const scn = this.scn, o = scn.own;
    this.root.visible = !o.wow;
    if (o.wow) return;
    // inverse own-ship transform
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.pitch * D2R, -o.hdg * D2R, -o.roll * D2R, 'YXZ'));
    const qi = q.clone().invert();
    const pos = new THREE.Vector3(o.e, o.alt * FT, -o.n);
    // the world is scaled about the eye so that the ground stays well beyond the cockpit / HUD planes
    // while keeping every direction exact: angular sizes and lines of sight are unchanged.
    const k = this.k = Math.max(1, o.alt * FT / 12);
    this.world.quaternion.copy(qi);
    this.world.scale.setScalar(1 / k);
    this.world.position.copy(pos).negate().applyQuaternion(qi).multiplyScalar(1 / k);
    this.sky.quaternion.copy(qi);
    this.fog.density = 1.8 * k / 90000;
    for (const c of scn.contacts) {
      const m = this.objs.get(c.id); if (!m) continue;
      m.visible = c.alive;
      m.position.set(c.e, (c.kind === 'air' ? c.alt * FT : 0), -c.n);
      m.rotation.set(0, -(c.hdg || 0) * D2R, 0);
      if (m.userData.glint) { const d = m.position.distanceTo(pos); m.userData.glint.scale.setScalar(Math.max(1, d / 2500)); m.userData.glint.material.opacity = d > 3000 ? 0.5 : 0.0; }
    }
    // missiles / bombs in flight
    this.mis = this.mis || [];
    const all = [...weapons.inFlight.map(m => ({ e: m.e, n: m.n, alt: m.alt })), ...(ewm ? ewm.threatMissiles.filter(m => !m.done).map(m => ({ e: m.e, n: m.n, alt: m.alt })) : [])];
    while (this.mis.length < all.length) { const s = new THREE.Mesh(new THREE.SphereGeometry(3, 6, 4), this.missileMat); s.layers.enable(1); this.world.add(s); this.mis.push(s); }
    this.mis.forEach((s, i) => { s.visible = i < all.length; if (s.visible) { s.position.set(all[i].e, all[i].alt * FT, -all[i].n); const d = s.position.distanceTo(pos); s.scale.setScalar(Math.max(1, d / 1500)); } });
    for (const f of this.fx) { f.t += dt; f.s.scale.setScalar(1 + f.t * 2); f.s.material.opacity = Math.max(0, 1 - f.t / 1.5); f.smoke.scale.setScalar(1 + f.t * 0.6); f.smoke.material.opacity = Math.max(0, 0.6 - f.t / 25); }
    this.fx = this.fx.filter(f => { if (f.t > 25) { this.world.remove(f.s); this.world.remove(f.smoke); return false; } return true; });
  }
}
