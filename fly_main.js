import * as THREE from 'three';
import { VRButton } from './VRButton.js';
import { RoomEnvironment } from './RoomEnvironment.js';
import { GLTFLoader } from './GLTFLoader.js';
import { Terrain, buildTerrainMesh, SUN_DIR, SKY_HORIZON } from './fly_terrain.js';
import { Sim } from './fly_physics.js';
import { buildSky, buildClouds, buildAirfield, buildTankerModel, buildCockpitExtras } from './fly_world.js';
import { HUD } from './fly_hud.js';
import { Controls } from './fly_input.js';
import { FlyAudio } from './fly_audio.js';

const q = new URLSearchParams(location.search);
const status = document.getElementById('status'), bar = document.querySelector('#bar i');
const setStatus = (s, p) => { status.textContent = s; if (p !== undefined) bar.style.width = Math.round(p * 100) + '%'; };

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local');
renderer.xr.setFoveation(parseFloat(q.get('fov') ?? '0.8'));
renderer.xr.setFramebufferScaleFactor(parseFloat(q.get('scale') ?? '0.9'));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.7;
scene.add(new THREE.HemisphereLight(0xdfefff, 0x6d6355, 1.5));
const sun = new THREE.DirectionalLight(0xfff3dd, 2.4); sun.position.copy(SUN_DIR).multiplyScalar(100); scene.add(sun);

// rig = the aircraft (turns with it); holder = cockpit, shifted so that the design eye point sits on the player's head
const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.06, 150000);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
const holder = new THREE.Group(); rig.add(holder);

let sim, terrain, terrainMesh, clouds, airfield, tankerModel, extras, hud, controls, tanker;
const audio = new FlyAudio();
const clock = new THREE.Clock();
let ready = false;

function recenter() {
  if (!renderer.xr.isPresenting) return;
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  holder.position.copy(camera.position);
  holder.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-f.x, -f.z));
  holder.updateMatrixWorld(true);
}
function spawn(mode) { if (!sim) return; sim.reset(mode); controls.setLever(sim.input.lever); audio.init(); }

async function boot() {
  setStatus('Génération du terrain…', 0);
  terrain = new Terrain(); await terrain.generate((p) => setStatus('Génération du terrain…', p * 0.45));
  setStatus('Terrain…', 0.45);
  terrainMesh = buildTerrainMesh(terrain, scene, q.has('lite') ? 64 : 96);
  buildSky(scene); clouds = buildClouds(scene); airfield = buildAirfield(scene);
  sim = new Sim(terrain);
  tankerModel = buildTankerModel(sim.tk); scene.add(tankerModel.group);
  extras = buildCockpitExtras(holder); hud = new HUD(holder);
  controls = new Controls(renderer, rig, holder, sim, { spawn, recenter });
  sim.onEvent = (ev) => {
    if (ev === 'connect') { controls.pulse('right', 0.8, 150); audio.beep(1200, 0.15); }
    if (ev === 'touchdown') { controls.pulse('right', 0.7, 120); controls.pulse('left', 0.7, 120); }
    if (ev === 'crash') { controls.pulse('right', 1, 400); controls.pulse('left', 1, 400); audio.beep(200, 0.6, 0.4); }
  };
  if (q.get('spawn') && q.get('spawn') !== 'air') { sim.msgs.length = 0; sim.reset(q.get('spawn')); controls.setLever(sim.input.lever); }

  setStatus('Chargement du cockpit…', 0.5);
  const gltf = await new GLTFLoader().loadAsync('cockpit.glb', (e) => { if (e.total) setStatus('Chargement du cockpit…', 0.5 + 0.5 * e.loaded / e.total); });
  const model = gltf.scene; model.position.y = -0.12;
  model.traverse(o => {
    if (!o.isMesh) return; o.material.side = THREE.FrontSide; if (o.material.map) o.material.map.anisotropy = 4;
    o.matrixAutoUpdate = false; o.updateMatrix();
    const n = o.name || (o.parent && o.parent.name) || '';
    if (/^L_/.test(n)) o.material.side = THREE.DoubleSide;
    if (/static_metal/.test(n) && o.material.color) { o.material.color.setRGB(0.105, 0.115, 0.125); o.material.metalness = 0.18; o.material.roughness = 0.68; }
  });
  holder.add(model);

  const vb = VRButton.createButton(renderer, { optionalFeatures: ['local-floor'] }); vb.id = 'vrbtn';
  document.getElementById('vrslot').appendChild(vb);
  for (const b of document.querySelectorAll('[data-s]')) b.onclick = () => spawn(b.dataset.s);
  renderer.xr.addEventListener('sessionstart', () => { document.body.classList.add('vr'); audio.init(); setTimeout(recenter, 500); });
  renderer.xr.addEventListener('sessionend', () => { document.body.classList.remove('vr'); camera.position.set(0, 0, 0); camera.quaternion.identity(); holder.position.set(0, 0, 0); holder.quaternion.identity(); });
  window.addEventListener('pointerdown', () => audio.init(), { once: true });
  window.FLY = { sim, THREE, camera, rig, holder, terrainMesh, hud, controls, scene, renderer, spawn };
  setStatus('Prêt. Entre en VR (bouton ci-dessous) ou vole au clavier.', 1);
  ready = true; window.__ready = true;
}

// mouse look on desktop
let drag = null, yaw = 0, pitchL = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('pointermove', (e) => { if (!drag || renderer.xr.isPresenting) return; yaw -= (e.clientX - drag.x) * 0.004; pitchL = Math.max(-1.2, Math.min(1.2, pitchL - (e.clientY - drag.y) * 0.004)); drag = { x: e.clientX, y: e.clientY }; camera.rotation.set(pitchL, yaw, 0, 'YXZ'); });
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

renderer.setAnimationLoop(() => {
  if (!ready) { return; }
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update(dt); sim.step(dt);
  const f = sim.fl, p = f.pos, tk = sim.tk;
  rig.quaternion.copy(f.qb); rig.updateMatrixWorld(true);
  terrainMesh.update(p.x, p.y, p.z, sim.t);
  clouds.update(p.x, p.y, p.z); airfield.update(p.x, p.y, p.z);
  tankerModel.group.position.set(tk.pos.x - p.x, tk.pos.y - p.y, tk.pos.z - p.z); tankerModel.group.quaternion.copy(tk.q);
  tankerModel.update(sim.tankerDist);
  extras.setProbe(f.probe);
  hud.update(dt, sim); audio.update(sim);
  renderer.render(scene, camera);
});
boot().catch(err => { console.error(err); setStatus('Erreur : ' + err.message); });
