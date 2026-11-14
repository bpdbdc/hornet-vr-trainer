import * as THREE from 'three';
import { VRButton } from './VRButton.js';
import { RoomEnvironment } from './RoomEnvironment.js';
import { Sim } from './sim.js';
import { Cockpit } from './cockpit.js';
import { buildWorld } from './world.js';
import { Interaction } from './interact.js';
import { Exam, ExamPanel } from './exam.js';
import { Audio } from './audio.js';
import { Scenario, NM } from './scenario.js';
import { Radar } from './radar.js';
import { Weapons } from './weapons.js';
import { EW } from './ew.js';
import { HUD } from './hud.js';
import './ddi_tac.js';
import { AirWorld } from './world_air.js';
import { TPod } from './tpod.js';
import { Hotas, HOTAS_HELP, helpCard } from './hotas.js';
import { Comms, AWACS_FREQ } from './comms.js';
import { buildShell } from './shell.js';

const status = document.getElementById('status');
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
renderer.xr.setFoveation(0.6);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// image-based lighting for the cockpit metal / paint (neutral studio environment, generated at load)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.01, 30000);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);

const world = buildWorld(scene);
const rampFog = scene.fog;
// the OpenHornet source eye point sits ~12 cm low for the HUD: lower the whole aircraft (seat height), adjustable
const SEAT0 = -0.12; let seat = SEAT0;
const sim = new Sim();
const cockpit = new Cockpit(scene, sim);
const exam = new Exam(sim, cockpit);
const audio = new Audio(sim);

// tactical layer
const scn = new Scenario(sim); sim.scn = scn;
const radar = new Radar(sim, scn);
const wpn = new Weapons(sim, scn, radar);
const ew = new EW(sim, scn);
const k = { sim, scn, radar, wpn, ew, cockpit, audio };
let hud, air, tpod, hotas, comms, interaction, panel;
window.HORNET = { sim, cockpit, exam, camera, scn, radar, wpn, ew, k, get interaction() { return interaction; }, loadScenario: (n) => loadScenario(n), tacticalLights: () => tacticalLights() };

cockpit.onProgress = (e) => { if (e.total) status.textContent = `Chargement du cockpit… ${Math.round(100 * e.loaded / e.total)} %`; };

const BRIEF = {
  cold: null,
  hot: ['HOT START AU SOL', '', 'Moteurs au ralenti, INS aligné (IFA), FCS RESET + BIT faits.', 'Radar OPR (n\'émet pas au sol, WOW), FLIR ON, armement SIM possible.', 'Idéal pour la navigation UFC / DDI, la préparation des armes,', 'les radios et la vérification des pages.', '', `DARKSTAR : ${AWACS_FREQ} (COMM 1 canal 2).`],
  aa: ['AIR-AIR · CAP', '', 'FL220 cap 010, 450 kt. 2 × MiG-29 inbound à ~45 NM au nord,', '2 × Su-27 en orbite NE, ENFIELD 2 (Link 16) à gauche.', 'A/A master, Master Arm ARM (ou SIM sur STORES), RWS → TWS → STT.', `DARKSTAR ${AWACS_FREQ} (COMM 1 canal 2) : PTT = bogey dope,`, 'double PTT = picture.  HOTAS : appui long sur clic du stick.', 'Leurres : programme sur grip gauche + X.'],
  ag: ['AIR-SOL · STRIKE', '', 'FL160 cap 030, 420 kt. Cible WP1 (TGT) : bunker + blindés,', 'ZSU-23 et SA-6 à proximité, SA-8 au NO.', 'GBU-38 (JDAM), GBU-12 (laser), AGM-65F, AGM-88C, Litening.', 'A/G master, TPOD sur DDI (TAC → FLIR), TDC + SCS, laser TRIG.', '', `DARKSTAR ${AWACS_FREQ} (COMM 1 canal 2).`],
  nav: ['NAVIGATION', '', 'FL120 cap 020, 420 kt, route WP0 → WP3.', 'HSI, waypoints UFC, TACAN 44X, ILS canal 3, Mk-82 en AUTO/CCIP.', '', `DARKSTAR ${AWACS_FREQ} (COMM 1 canal 2).`],
};

function loadScenario(name) {
  if (exam.active && name !== 'cold') exam.active = false;
  if (name === 'cold') { cockpit.resetAll(); }
  scn.load(name === 'cold' ? 'cold' : name);
  wpn.reset(name === 'ag' ? 'ag' : name === 'nav' ? 'nav' : 'aa');
  // external tanks (330 gal ≈ 2240 lb each) are fed first, internal stays full until they are dry
  scn.own.fuel = 10950 + 2240 * Object.values(wpn.stations).filter(st => st && st.type === 'FUEL').length;
  radar.reset(); ew.reset();
  if (tpod) tpod.undesignate();
  sim.agTarget = null; sim.masterArmSim = false; sim.thrAxis.L = sim.thrAxis.R = name === 'cold' || name === 'hot' ? 0 : 0.78;
  if (name !== 'cold') {
    cockpit.resetAll();
    scn.hotStart(cockpit);
    sim.thrAxis.L = sim.thrAxis.R = name === 'hot' ? 0 : 0.78;
    if (name === 'aa') { wpn.setMaster('AA'); }
    if (name === 'ag') { wpn.setMaster('AG'); cockpit.ddis.R && (cockpit.ddis.R.page = 'FLIR'); cockpit.ddis.L && (cockpit.ddis.L.page = 'RDR ATTK'); }
    if (name === 'aa') { cockpit.ddis.L && (cockpit.ddis.L.page = 'RDR ATTK'); cockpit.ddis.R && (cockpit.ddis.R.page = 'SA'); }
    if (name === 'nav' || name === 'hot') { cockpit.ddis.L && (cockpit.ddis.L.page = 'HSI'); cockpit.ddis.R && (cockpit.ddis.R.page = 'SA'); }
    if (cockpit.ddis.AMPCD) cockpit.ddis.AMPCD.page = 'HSI';
    // displays already running: no power-up reset to the default page, no warm-up
    for (const d of Object.values(cockpit.ddis)) { d.wasOn = true; d.powerT = 2; }
    if (hotas) { hotas.tdcOwner = 'L'; hotas.applyTdc(); }
    // COMM 1 on the AWACS preset
    cockpit.ufc.comm[1].ch = 2;
  }
  world.group.visible = scn.own.wow;
  if (panel) { panel.brief = BRIEF[name]; panel.layout(); panel.draw(); }
  sim.log('scenario', { name });
}

cockpit.load('./').then(() => {
  status.textContent = 'Prêt.';
  for (const o of [cockpit.root, world.group, world.own]) o.position.y += SEAT0;
  document.getElementById('overlay').classList.add('ready');
  cockpit.k = k;
  for (const d of Object.values(cockpit.ddis)) d.k = k;
  const shell = buildShell(cockpit.root, sim); k.shell = shell; cockpit.updaters.push(shell.update);
  // collimated HUD in its own render group (after the outside world, before the cockpit)
  const hudGroup = new THREE.Group(); hudGroup.renderOrder = 1; cockpit.root.add(hudGroup);
  hud = new HUD(hudGroup, { sim, scn, radar, wpn, ew, ufc: cockpit.ufc }); k.hud = hud;
  hudGroup.add(shell.mask);
  Object.assign(hud.mat, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.KeepStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp });
  hud.plane.position.y -= SEAT0;      // boresight stays referenced to the eye
  air = new AirWorld(cockpit.root, scn); air.root.renderOrder = 0; air.root.position.y = -SEAT0; k.air = air;
  backlight();
  tpod = new TPod(renderer, cockpit.root, sim, scn, wpn); k.tpod = tpod;
  comms = new Comms(k); k.comms = comms;
  hotas = new Hotas(k); k.hotas = hotas;
  audio.attach(k);
  // render order: world (0) → HUD (1) → cockpit / own aircraft / hands (2)
  const setOrder = (o) => { if (o === air.root || o === hudGroup) return; if (o.isGroup || o.isMesh) o.renderOrder = o.renderOrder || 2; for (const c of o.children) setOrder(c); };
  cockpit.root.renderOrder = 2; for (const c of cockpit.root.children) setOrder(c);
  world.own.renderOrder = 2;
  // master mode button lights
  for (const [id, m] of [['aaMode', 'AA'], ['agMode', 'AG']]) {
    const c = cockpit.controls.get(id);
    if (c && c.face) cockpit.updaters.push(() => c.face.material.color.setHex(wpn.master === m && sim.elec.ac ? 0x9dff9d : 0x7a7a7a));
  }
  Object.assign(window.HORNET, { hud, air, tpod, hotas, comms });
  panel = new ExamPanel(scene, exam);
  panel.onScenario = loadScenario;
  panel.onNight = setNight; panel.onSeat = setSeat;
  interaction = new Interaction(renderer, scene, camera, cockpit, panel);
  interaction.onRecenter = recenter;
  interaction.hotas = hotas;
  interaction.cardFactory = (side) => helpCard(HOTAS_HELP[side]);
  for (const st of interaction.xr) { st.ctrl.renderOrder = 2; st.grip.renderOrder = 2; st.hand.renderOrder = 2; }
  exam.onFinish = () => { if (!panel.visible) panel.toggle(); updateHtmlDebrief(); };
  const vb = VRButton.createButton(renderer, { optionalFeatures: ['hand-tracking', 'local-floor'] });
  vb.id = 'vrbtn'; document.getElementById('vrslot').appendChild(vb);
  window.addEventListener('pointerdown', () => audio.init(), { once: true });
  window.addEventListener('keydown', () => audio.init(), { once: true });
  for (const b of document.querySelectorAll('[data-scn]')) b.onclick = () => { audio.init(); loadScenario(b.dataset.scn); if (b.dataset.scn === 'cold') { exam.start(); panel.layout(); } };
  scn.load('cold');
}).catch(err => { console.error(err); status.textContent = 'Erreur de chargement : ' + err.message; });

function setSeat(d) {
  seat = Math.max(SEAT0 - 0.12, Math.min(SEAT0 + 0.12, seat + d));
  for (const o of [cockpit.root, world.group, world.own]) { o.position.y += d; if (o.userData.base) o.userData.base.p.y += d; o.updateMatrixWorld(true); }
}
window.HORNET.setSeat = setSeat;

// panel / instrument backlighting: legends glow (NVG green-white), driven by the CONSOLES and INST PNL knobs
function backlight() {
  const front = [], cons = [];
  cockpit.model.traverse(o => {
    if (!o.isMesh || !/^L_/.test(o.name || o.parent?.name || '') || !o.material.map || !o.material.isMeshStandardMaterial) return;
    const m = o.material = o.material.clone();
    m.emissive = new THREE.Color(0xd8ffd0); m.emissiveMap = m.map; m.emissiveIntensity = 0;
    const p = new THREE.Vector3(); o.getWorldPosition(p); cockpit.root.worldToLocal(p);
    (p.z < -0.55 && p.y > -0.75 ? front : cons).push(m);
  });
  let last = '';
  cockpit.updaters.push(() => {
    const on = sim.elec.ac || sim.elec.batt, sw = sim.sw;
    const kf = on ? sw.instPnl : 0, kc = on ? sw.consoles : 0, test = on && sw.ltTest === 'TEST';
    const st = `${kf.toFixed(2)}${kc.toFixed(2)}${test}${night}`;
    if (st === last) return; last = st;
    for (const m of front) m.emissiveIntensity = test ? 1.2 : kf * (night ? 1.4 : 0.6);
    for (const m of cons) m.emissiveIntensity = test ? 1.2 : kc * (night ? 1.4 : 0.6);
  });
}

// day / night
let night = false;
function setNight(v) {
  night = v;
  world.hemi.intensity = v ? 0.06 : 1.6; world.sun.intensity = v ? 0.0 : 2.2;
  scene.background = new THREE.Color(v ? 0x05070c : 0x9ec3e6);
  scene.environmentIntensity = v ? 0.04 : 0.55;
  world.group.traverse(o => { if (o.material && o.material.uniforms && o.material.uniforms.top) { o.material.uniforms.top.value.set(v ? 0x02040a : 0x4f86c6); o.material.uniforms.bottom.value.set(v ? 0x0a0f18 : 0xdbe8f2); } });
  if (air) air.setNight(v);
  if (rampFog) rampFog.color.set(v ? 0x05070c : 0xb9d3ea);
  // floodlights: soft cockpit flood driven by the FLOOD knob at night
  sim.log('night', { on: v });
}
window.HORNET.setNight = setNight;
const flood = new THREE.PointLight(0xb8ffb0, 0, 1.6, 2); flood.position.set(0, -0.15, -0.35);
scene.add(flood);

// Recenter: put the design eye where the head currently is, facing forward
function recenter() {
  const xrCam = renderer.xr.getCamera();
  const p = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCam.getWorldQuaternion(new THREE.Quaternion()));
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  const objs = [cockpit.root, world.group, world.own, panel.group];
  for (const obj of objs.concat([interaction.tip.spr])) {
    if (!obj.userData.base) obj.userData.base = { p: obj.position.clone(), q: obj.quaternion.clone() };
  }
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  for (const obj of objs) {
    const b = obj.userData.base;
    obj.position.copy(b.p).applyQuaternion(q).add(p);
    obj.quaternion.copy(q).multiply(b.q);
    obj.updateMatrixWorld(true);
  }
}
renderer.xr.addEventListener('sessionstart', () => { audio.init(); setTimeout(recenter, 400); });
document.getElementById('recenter').onclick = () => { if (renderer.xr.isPresenting) recenter(); };

function updateHtmlDebrief() {
  const r = exam.result, el = document.getElementById('debrief');
  if (!r) { el.innerHTML = ''; return; }
  el.innerHTML = `<h3>Score ${r.score}/100 — ${r.nOk}/${r.nReq} étapes — ${r.errors.length} erreur(s)</h3>` +
    r.errors.map(e => `<div class="err">✗ ${e.msg}</div>`).join('') +
    r.rows.map(x => `<div class="${x.ok ? 'ok' : x.opt ? 'opt' : 'ko'}">${x.ok ? '✓' : x.opt ? '–' : '✗'} ${x.txt} <small>(${x.ref})</small></div>`).join('');
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// cockpit lights tied to the tactical state
function tacticalLights() {
  const trk = radar.lsTrack ? radar.lsTrack() : null;
  sim.lockLt = radar.mode === 'STT' && !!radar.stt && radar.powered;
  let shoot = false, flash = false;
  if (wpn.master === 'AA' && wpn.aaSel && wpn.aaSel !== 'GUN' && wpn.armed() && trk) {
    const z = wpn.dlz(wpn.aaSel, trk);
    if (z && trk.rng < z.rmax && trk.rng > z.rmin) { shoot = true; flash = trk.rng < z.rne; }
  }
  sim.shootLt = shoot; sim.shootFlash = flash;
  const th = ew.powered() ? ew.threats : [];
  sim.rwrLt = {
    AI: th.some(t => t.c.kind === 'air' && !t.friendly && t.state !== 'search'),
    SAM: th.some(t => t.c.def.sam && t.state !== 'search'),
    AAA: th.some(t => t.c.def.aaa && t.lethal),
    CW: th.some(t => t.state === 'launch'),
  };
  sim.dispLow = (ew.chaff ?? 60) < 10 || (ew.flare ?? 60) < 10;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (hotas) hotas.update(dt);
  sim.step(dt);
  scn.step(dt);
  radar.step(dt); wpn.step(dt); ew.step(dt);
  if (cockpit.meta) cockpit.update(dt);
  if (interaction) interaction.update(dt);
  if (air) air.update(dt, wpn, ew);
  scene.fog = air && air.root.visible ? air.fog : rampFog;
  if (tpod) tpod.update(dt, cockpit.ddis);
  if (hud) hud.update(dt);
  tacticalLights();
  flood.intensity = night && (sim.elec.ac || sim.elec.batt) ? 0.05 + (sim.sw.flood || 0) * 0.5 : 0;
  if (cockpit.root) flood.position.copy(cockpit.root.localToWorld(new THREE.Vector3(0, -0.15, -0.35)));
  exam.update();
  if (panel) panel.update(dt);
  audio.update();
  renderer.render(scene, camera);
});
