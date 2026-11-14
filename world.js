import * as THREE from 'three';

// Simple air-base ramp: sky, concrete apron with markings, shelters, a few distant hills.
export function buildWorld(scene) {
  const g = new THREE.Group(); scene.add(g);
  scene.background = new THREE.Color(0x9ec3e6);
  scene.fog = new THREE.Fog(0xb9d3ea, 200, 2500);

  const hemi = new THREE.HemisphereLight(0xdfefff, 0x6d6355, 1.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.2); sun.position.set(-40, 80, 30); scene.add(sun);

  // sky dome gradient
  const skyGeo = new THREE.SphereGeometry(3000, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4f86c6) }, bottom: { value: new THREE.Color(0xdbe8f2) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.05,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
  });
  g.add(new THREE.Mesh(skyGeo, skyMat));

  // concrete texture
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#8d8b86'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) { const v = 120 + Math.random() * 40 | 0; x.fillStyle = `rgba(${v},${v},${v - 4},0.12)`; x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  x.strokeStyle = 'rgba(60,60,60,0.55)'; x.lineWidth = 2; x.strokeRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(160, 160); tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace;
  const groundY = -3.05;     // design eye is ~3 m above the apron
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = groundY; g.add(ground);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x8a8460, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2; grass.position.y = groundY - 0.05; g.add(grass);

  // taxi line + parking marks
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8c43a });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 300), lineMat); line.rotation.x = -Math.PI / 2; line.position.set(0, groundY + 0.01, -120); g.add(line);
  for (let i = -3; i <= 3; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 18), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
    m.rotation.x = -Math.PI / 2; m.position.set(i * 16 + 8, groundY + 0.01, 2); g.add(m);
  }

  // shelters (hardened aircraft shelters)
  const shelterMat = new THREE.MeshStandardMaterial({ color: 0x9a9384, roughness: 0.9 });
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 32, 24, 1, false, 0, Math.PI), shelterMat);
    s.rotation.z = Math.PI / 2; s.rotation.y = Math.PI / 2;
    s.position.set(-90 + i * 45, groundY, 70); g.add(s);
  }
  // control tower
  const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 22, 8), shelterMat); tower.position.set(120, groundY + 11, -60); g.add(tower);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(11, 4, 11), new THREE.MeshStandardMaterial({ color: 0x3a5068, metalness: 0.4, roughness: 0.2 })); cab.position.set(120, groundY + 24, -60); g.add(cab);
  // hills
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x7b7a5c, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2, r = 1600 + Math.random() * 500;
    const h = new THREE.Mesh(new THREE.ConeGeometry(250 + Math.random() * 250, 120 + Math.random() * 200, 7), hillMat);
    h.position.set(Math.cos(a) * r, groundY + 40, Math.sin(a) * r); g.add(h);
  }

  // own aircraft hint: nose + LEX + intakes around the cockpit (gull grey)
  // kept in a separate group: still visible in the airborne scenarios when the ramp is hidden
  const own = new THREE.Group(); own.name = 'ownship'; scene.add(own);
  const gray = new THREE.MeshStandardMaterial({ color: 0x8e9497, roughness: 0.7, metalness: 0.15 });
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.6, 24), gray);
  nose.rotation.x = -Math.PI / 2; nose.position.set(0, -0.95, -3.4); own.add(nose);
  for (const sx of [-1, 1]) {
    const lex = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 4.5), gray);
    lex.position.set(sx * 1.05, -1.05, 2.4); lex.rotation.y = sx * -0.12; own.add(lex);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 3.2), gray);
    wing.position.set(sx * 3.2, -1.25, 5.8); own.add(wing);
  }

  return { group: g, groundY, own, hemi, sun };
}
