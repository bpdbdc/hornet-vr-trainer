// Everything around the terrain: sky, clouds, airfield, tanker with its hose and drogue, probe, canopy frame.
import * as THREE from 'three';
import { SKY_HORIZON, SKY_TOP, SUN_DIR, AIRFIELD, P } from './fly_terrain.js';
import { AC } from './fly_physics.js';

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.1, ...o });
const basic = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });
const wrapD = (d, per) => ((((d + per / 2) % per) + per) % per) - per / 2;

export function buildSky(scene) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(SKY_TOP) }, hor: { value: new THREE.Color(SKY_HORIZON) }, sun: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sun; varying vec3 vP;
      void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.55));
        float s = max(dot(normalize(vP), sun), 0.0); c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.18);
        if (vP.y < 0.0) c = hor; gl_FragColor = vec4(c, 1.0); }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100000, 32, 16), m);
  dome.renderOrder = -10; dome.frustumCulled = false; scene.add(dome);
  return dome;
}

export function buildClouds(scene) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) {
    const px = 40 + rnd() * 176, py = 70 + (rnd() - 0.4) * 36, r = 18 + rnd() * 30;
    const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.6, 'rgba(240,244,250,0.45)'); g.addColorStop(1, 'rgba(235,240,248,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const list = [], BOX = 26000, group = new THREE.Group(); scene.add(group);
  let s2 = 99; const r2 = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 110; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 1 });
    const sp = new THREE.Sprite(m); const w = 700 + r2() * 1500; sp.scale.set(w, w * 0.5, 1); sp.renderOrder = -5;
    group.add(sp); list.push({ sp, x: r2() * BOX, y: 2200 + r2() * 3300, z: r2() * BOX });
  }
  return {
    group, update(px, py, pz) {
      for (const k of list) {
        const rx = wrapD(k.x - px, BOX), rz = wrapD(k.z - pz, BOX);
        k.sp.position.set(rx, k.y - py, rz);
        const d = Math.hypot(rx, rz); k.sp.material.opacity = 1 - THREE.MathUtils.smoothstep(d, 14000, 25000);
      }
    },
  };
}

function textTex(text, w = 256, h = 256, size = 200, bg = '#3a3b3e') {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = '#eee'; x.font = `bold ${size}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildAirfield(scene) {
  const g = new THREE.Group(); scene.add(g);
  const flat = (w, l, color, x, z, y = 0.06, units = -4, map = null) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ color, map, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: units }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); g.add(m); return m;
  };
  const hl = AIRFIELD.halfLen, hw = AIRFIELD.halfWid;
  // asphalt (runway + taxiway + apron)
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#4a4b4f'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) { const v = 60 + Math.random() * 30 | 0; x.fillStyle = `rgb(${v},${v},${v + 2})`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  const at = new THREE.CanvasTexture(c); at.wrapS = at.wrapT = THREE.RepeatWrapping; at.repeat.set(10, 300); at.colorSpace = THREE.SRGBColorSpace;
  flat(2 * hw + 16, 2 * hl + 400, 0xffffff, 0, 0, 0.06, -3, at);
  flat(24, 2 * hl, 0x55565a, 110, 0, 0.055, -2);                    // parallel taxiway
  for (const z of [-1000, -500, 0, 500, 1000]) flat(100, 24, 0x55565a, 55, z, 0.055, -2);
  flat(120, 700, 0x5a5b5f, 190, 0, 0.05, -2);                      // apron
  const white = basic(0xf0f0ea, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8 });
  const mark = (w, l, px, pz) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), white); m.rotation.x = -Math.PI / 2; m.position.set(px, 0.07, pz); g.add(m); };
  for (let z = -hl + 40; z < hl - 40; z += 50) mark(0.9, 30, 0, z);
  mark(0.5, 2 * hl, -hw + 1.2, 0); mark(0.5, 2 * hl, hw - 1.2, 0);
  for (const s of [1, -1]) {
    for (let i = -4; i <= 4; i++) if (i !== 0) mark(1.6, 28, i * 3.4 - Math.sign(i) * 0.6 + 0, s * (hl - 20));
    for (const d of [150, 300, 450, 600]) { const w = d === 300 ? 2.2 : 1.6; for (const sx of [-1, 1]) mark(w, d === 300 ? 22 : 30, sx * 9, s * (hl - 160 - (d - 150) * 0.9 * 1)); }
    for (const sx of [-1, 1]) mark(3.5, 45, sx * 8.5, s * (hl - 390));
  }
  const num = (text, z, rot) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: textTex(text, 128, 128, 90, '#4a4b4f'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8 })); m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(0, 0.075, z); g.add(m); };
  num('36', hl - 75, 0); num('18', -hl + 75, Math.PI);
  // buildings
  const wall = mat(0x9a9384, { roughness: 0.9 }), roof = mat(0x6d7a82);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(7, 24, 7), wall); tower.position.set(150, 12, 200); g.add(tower);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 10), mat(0x3a5068, { metalness: 0.5, roughness: 0.2 })); cab.position.set(150, 26, 200); g.add(cab);
  for (let i = 0; i < 4; i++) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 40, 20, 1, false, 0, Math.PI), roof);
    h.rotation.z = Math.PI / 2; h.rotation.y = Math.PI / 2; h.position.set(220, 0.05, -140 + i * 110); g.add(h);
  }
  for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 14, 20), mat(0xdddddd)); t.position.set(-150, 7, 300 + i * 25); g.add(t); }
  // PAPI: 4 lights left of the runway abeam the touchdown zone, 3 deg glide path
  const papi = [], PZ = hl - 280, PX = -(hw + 14);
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 2.6), new THREE.MeshBasicMaterial({ color: 0xff2200 })); m.position.set(PX - i * 7, 0.9, PZ); g.add(m); papi.push(m); }
  const PAPI_ANG = [2.5, 2.83, 3.17, 3.5].map(a => a * Math.PI / 180);
  return {
    group: g,
    update(px, py, pz) {
      const rx = wrapD(AIRFIELD.x - px, P), rz = wrapD(AIRFIELD.z - pz, P);
      g.visible = Math.hypot(rx, rz) < 30000;
      g.position.set(rx, AIRFIELD.elev - py, rz);
      // PAPI
      const dx = px - (AIRFIELD.x + PX), dz = pz - (AIRFIELD.z + PZ), horiz = Math.hypot(dx, dz), el = Math.atan2(py - AC.eyeH - AIRFIELD.elev, horiz);
      for (let i = 0; i < 4; i++) papi[i].material.color.setHex(el > PAPI_ANG[i] ? 0xffffff : 0xff2200);
    },
  };
}

export function buildTankerModel(tk) {
  const g = new THREE.Group();
  const body = mat(0xb9bec4, { roughness: 0.55, metalness: 0.25 }), dark = mat(0x4a5058), nose = mat(0x2d3236);
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 34, 20), body); fus.rotation.x = Math.PI / 2; fus.position.z = 0; g.add(fus);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.9, 6, 20), nose); cone.rotation.x = -Math.PI / 2; cone.position.z = -20; g.add(cone);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(1.9, 8, 20), body); tail.rotation.x = Math.PI / 2; tail.position.z = 21; g.add(tail);
  const wingGeo = new THREE.BoxGeometry(20, 0.4, 5.5); wingGeo.translate(10, 0, 0);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, body); w.scale.x = s; w.rotation.y = -s * 0.55; w.position.set(s * 1.4, -0.9, -5.5); g.add(w);
    const st = new THREE.Mesh(new THREE.BoxGeometry(8, 0.25, 3), body); st.position.set(s * 5.2, 0.3, 19.8); st.rotation.y = -s * 0.45; g.add(st);
    for (const ex of [6.5, 13.5]) { const e = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 4.2, 14), dark); e.rotation.x = Math.PI / 2; e.position.set(s * ex, -2.3, ex > 10 ? -1.2 : -3); g.add(e); }
  }
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7, 6), body); fin.position.set(0, 5, 19); fin.rotation.x = -0.25; g.add(fin);
  // refuelling pod under the right wing
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 4.8, 12), mat(0x8d949a)); pod.rotation.x = Math.PI / 2; pod.position.set(tk.pod.x, tk.pod.y + 0.2, tk.pod.z - 1.8); g.add(pod);
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.9, 2.4), body); pylon.position.set(tk.pod.x, tk.pod.y + 1.5, tk.pod.z - 2.2); g.add(pylon);
  const lights = [];
  for (const c of [0xff2200, 0xffb000, 0x22ff44]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), basic(c)); l.position.set(tk.pod.x - 0.45 + lights.length * 0.45, tk.pod.y + 0.25, tk.pod.z + 0.7); l.visible = false; g.add(l); lights.push(l); }
  // hose + drogue
  const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), mat(0x222222)); g.add(hose);
  const drogue = new THREE.Group(); g.add(drogue);
  const cn = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.2, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xd8d8d0, side: THREE.DoubleSide, roughness: 0.6 }));
  cn.rotation.x = -Math.PI / 2; cn.position.z = 0.6; drogue.add(cn);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 24), basic(0xff7a1a)); ring.position.z = 1.2; drogue.add(ring);
  const lamps = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), basic(0xffd040)); l.position.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 1.2); drogue.add(l); lamps.push(l); }
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); drogue.add(glow);
  const up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
  const anchor = new THREE.Vector3(tk.pod.x, tk.pod.y, tk.pod.z + 0.6);
  return {
    group: g,
    update(playerDist) {
      drogue.position.copy(tk.basket);
      // hose from the pod to the drogue
      tmp.copy(tk.basket).sub(anchor); const len = tmp.length();
      hose.position.copy(anchor).addScaledVector(tmp, 0.5); hose.scale.set(1, len, 1); hose.quaternion.setFromUnitVectors(up, tmp.normalize());
      const gl = THREE.MathUtils.clamp(playerDist * 0.012, 1.5, 40); glow.scale.set(gl, gl, 1);
      const col = tk.state === 'connected' ? 0x30ff60 : tk.state === 'ready' ? 0xffb000 : 0xff3010;
      glow.material.color.setHex(tk.state === 'idle' ? 0xff8040 : col);
      lights.forEach((l, i) => l.visible = (tk.state === 'connected' ? 2 : tk.state === 'ready' ? 1 : 0) === i);
      for (const l of lamps) l.material.color.setHex(col);
    },
  };
}

// refuelling probe (right side of the windshield) and the canopy / windshield frame, in eye coordinates
export function buildCockpitExtras(holder) {
  const g = new THREE.Group(); holder.add(g);
  const frame = mat(0x14161a, { roughness: 0.5, metalness: 0.5 });
  const tube = (pts, r = 0.018) => { const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))); const m = new THREE.Mesh(new THREE.TubeGeometry(c, 28, r, 8), frame); g.add(m); return m; };
  // front windshield bow and the two canopy rails
  tube([[-0.5, -0.1, -0.7], [-0.44, 0.12, -1.05], [-0.24, 0.28, -1.28], [0, 0.34, -1.34], [0.24, 0.28, -1.28], [0.44, 0.12, -1.05], [0.5, -0.1, -0.7]], 0.008);   // windshield bow
  tube([[-0.62, -0.1, 0.7], [-0.63, -0.08, 0.0], [-0.5, -0.1, -0.7]], 0.016); tube([[0.62, -0.1, 0.7], [0.63, -0.08, 0.0], [0.5, -0.1, -0.7]], 0.016);
  tube([[-0.62, -0.08, 0.35], [-0.52, 0.38, 0.32], [0, 0.6, 0.3], [0.52, 0.38, 0.32], [0.62, -0.08, 0.35]], 0.022);   // rear bow
  // refuelling probe: slides out of the right side of the nose
  const probe = new THREE.Group(); g.add(probe);
  const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 1, 10), mat(0x7d838a, { metalness: 0.6 })); p1.rotation.x = Math.PI / 2; probe.add(p1);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mat(0xc0c4c8, { metalness: 0.7 })); probe.add(tip);
  const fair = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.7), mat(0x6c747b, { roughness: 0.6 })); fair.position.set(0.62, -0.27, -1.35); g.add(fair);
  const start = new THREE.Vector3(0.62, -0.2, -1.55), end = AC.probeTip;
  function setProbe(k) {
    probe.visible = k > 0.02;
    const len = Math.max(0.05, start.distanceTo(end) * k);
    p1.scale.set(1, len, 1); p1.position.set(start.x, start.y + (end.y - start.y) * k * 0.5, start.z - len / 2);
    tip.position.set(start.x, start.y + (end.y - start.y) * k, start.z - len);
  }
  setProbe(0);
  return { group: g, setProbe };
}
