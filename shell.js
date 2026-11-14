import * as THREE from 'three';

// Airframe around the OpenHornet tub (procedural, approximate F/A-18C lines): canopy sills, windscreen and arch,
// opening canopy (driven by sim.canopyPos), HUD combiner glass + frame, HUD stencil mask, spine and tails.
// Coordinates: cockpit frame (design eye of the source model at the origin, x right, y up, -z forward).
const GULL = 0x8e9497, INT = 0x41464b, FRAME = 0x2b2e31;

function loft(curveA, curveB, nu = 24, nv = 8) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const a = curveA.getPoint(i / nu), b = curveB.getPoint(i / nu), p = a.clone().lerp(b, j / nv);
    pos.push(p.x, p.y, p.z); uv.push(i / nu, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const arch = (x0, yBase, yTop, z0, zTop, n = 9) => {
  // symmetric arch from (-x0, yBase, z0) over (0, yTop, zTop) to (x0, yBase, z0)
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n * Math.PI, s = Math.cos(t), c = Math.sin(t);
    pts.push(new THREE.Vector3(-x0 * s, yBase + (yTop - yBase) * Math.pow(c, 0.8), z0 + (zTop - z0) * Math.pow(c, 0.9)));
  }
  return new THREE.CatmullRomCurve3(pts);
};

export function buildShell(root, sim) {
  const g = new THREE.Group(); g.name = 'shell'; root.add(g);
  const ext = new THREE.MeshStandardMaterial({ color: GULL, roughness: 0.62, metalness: 0.12 });
  const inn = new THREE.MeshStandardMaterial({ color: INT, roughness: 0.8, metalness: 0.05 });
  const frm = new THREE.MeshStandardMaterial({ color: FRAME, roughness: 0.5, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2024, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.8 });

  // ---- canopy sills / fuselage sides (extruded cross-section), both sides
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape();
    const P = [[0.525, -1.05], [0.525, -0.56], [0.545, -0.43], [0.63, -0.40], [0.73, -0.47], [0.80, -0.70], [0.80, -1.12], [0.525, -1.12]];
    P.forEach(([x, y], i) => (i ? sh.lineTo(x * sx, y) : sh.moveTo(x * sx, y)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 2.9, bevelEnabled: false });
    geo.translate(0, 0, -1.6);
    const m = new THREE.Mesh(geo, [ext, inn]); g.add(m);
    // inner wall face (darker) — thin box on the tub side above the consoles
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.16, 2.1), inn); wall.position.set(sx * 0.528, -0.49, -0.45); g.add(wall);
  }
  // ---- glareshield cowl (top of the instrument panel, forward to the windscreen)
  const cowlA = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.53, -0.40, -0.98), new THREE.Vector3(-0.30, -0.10, -0.93), new THREE.Vector3(0, -0.05, -0.92), new THREE.Vector3(0.30, -0.10, -0.93), new THREE.Vector3(0.53, -0.40, -0.98)]);
  const cowlB = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.60, -0.44, -1.62), new THREE.Vector3(-0.32, -0.24, -1.62), new THREE.Vector3(0, -0.20, -1.62), new THREE.Vector3(0.32, -0.24, -1.62), new THREE.Vector3(0.60, -0.44, -1.62)]);
  const cowl = new THREE.Mesh(loft(cowlA, cowlB, 24, 4), new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.9, side: THREE.DoubleSide }));
  g.add(cowl);

  // ---- windscreen: arch + glass down to the nose
  const wsArch = arch(0.57, -0.40, 0.34, -1.18, -0.64);
  const wsBase = arch(0.62, -0.44, -0.20, -1.62, -1.62);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(wsArch, 40, 0.022, 8, false), frm));
  const ws = new THREE.Mesh(loft(wsArch, wsBase, 30, 6), glass); ws.renderOrder = 3; g.add(ws);
  // windscreen side posts
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(sx * 0.57, -0.40, -1.18), new THREE.Vector3(sx * 0.62, -0.44, -1.62)), 4, 0.02, 6), frm);
    g.add(post);
  }

  // ---- canopy (hinged aft, opens upward)
  const can = new THREE.Group(); const hinge = new THREE.Vector3(0, -0.38, 1.25);
  can.position.copy(hinge); g.add(can);
  // shift curves into the hinge frame
  const toH = (c) => new THREE.CatmullRomCurve3(c.points.map(p => p.clone().sub(hinge)));
  const cF = toH(arch(0.58, -0.40, 0.355, -1.16, -0.63)), cM = toH(arch(0.60, -0.40, 0.40, -0.2, -0.2)), cA = toH(arch(0.56, -0.40, 0.26, 1.15, 1.15));
  const canGlass1 = new THREE.Mesh(loft(cF, cM, 30, 6), glass); canGlass1.renderOrder = 3; can.add(canGlass1);
  const canGlass2 = new THREE.Mesh(loft(cM, cA, 30, 6), glass); canGlass2.renderOrder = 3; can.add(canGlass2);
  can.add(new THREE.Mesh(new THREE.TubeGeometry(cF, 40, 0.018, 8, false), frm));
  can.add(new THREE.Mesh(new THREE.TubeGeometry(cA, 40, 0.03, 8, false), frm));
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(sx * 0.58, -0.40, -1.16).sub(hinge), new THREE.Vector3(sx * 0.56, -0.40, 1.15).sub(hinge)), 4, 0.016, 6), frm);
    can.add(rail);
  }
  // rear-view mirrors on the canopy bow
  const mir = new THREE.MeshStandardMaterial({ color: 0x9aa6ad, roughness: 0.05, metalness: 1.0 });
  for (const sx of [-0.18, 0, 0.18]) { const mm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.008), mir); mm.position.set(sx, 0.31, -0.70).sub(hinge); mm.rotation.x = 0.5; can.add(mm); }

  // ---- aft bulkhead / headbox fairing behind the seat
  const aft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.2, 24, 1, false, -Math.PI / 2, Math.PI), inn);
  aft.rotation.x = Math.PI / 2; aft.position.set(0, -0.45, 0.75); g.add(aft);

  // ---- spine and twin tails (seen when looking back)
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 6.5, 20, 1, false), ext);
  spine.rotation.x = Math.PI / 2; spine.scale.set(1.25, 1, 0.55); spine.position.set(0, -0.82, 4.55); g.add(spine);
  for (const sx of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.6, 2.3), ext);
    tail.geometry.translate(0, 1.3, 0); tail.position.set(sx * 1.25, -0.95, 8.6); tail.rotation.z = -sx * 0.35; tail.rotation.x = -0.35; g.add(tail);
  }

  // ---- HUD combiner (AN/AVQ-28 style): glass plate on the HUD body, side rails, top bar
  const hud = new THREE.Group(); hud.position.set(0, 0.012, -0.69); hud.rotation.x = 0.26; g.add(hud);
  const W = 0.19, H = 0.155;
  const comb = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: 0x1c2a22, roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2.2 }));
  comb.position.y = H / 2; comb.renderOrder = 3; hud.add(comb);
  for (const sx of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.012, H + 0.01, 0.018), frm); r.position.set(sx * (W / 2 + 0.006), H / 2, 0); hud.add(r); }
  const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.024, 0.01, 0.016), frm); top.position.y = H + 0.005; hud.add(top);
  // stencil mask = the combiner aperture: the collimated symbology is only visible through the glass
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp, stencilZFail: THREE.KeepStencilOp, stencilFail: THREE.KeepStencilOp,
  }));
  mask.position.y = H / 2;
  const maskG = new THREE.Group(); maskG.position.copy(hud.position); maskG.rotation.copy(hud.rotation); maskG.add(mask);

  const update = () => {
    const a = Math.max(0, Math.min(1, sim.canopyPos));
    can.rotation.x = -a * 0.72;      // canopy opens ~41 deg
  };
  update();
  return { group: g, canopy: can, hud, mask: maskG, update, glassMat: glass };
}
