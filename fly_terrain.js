// Procedural, infinitely repeating terrain (period 32.768 km) shared by the physics (CPU) and the renderer (GPU).
// The heightmap is generated once; the GPU samples the very same data, so what you see is what you hit.
import * as THREE from 'three';

export const P = 32768;               // world period (m)
export const N = 1024;                // heightmap resolution
export const TEXEL = P / N;           // 32 m
export const HMIN = -100, HRANGE = 4300;
export const AIRFIELD = { elev: 28, x: 0, z: 0, halfLen: 1500, halfWid: 30, flatHalfX: 380, flatHalfZ: 2700 };

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const sm = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// periodic value noise, u,v in [0,1)
function vnoise(u, v, cells, seed) {
  const fx = u * cells, fy = v * cells;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = sm(fx - ix), ty = sm(fy - iy);
  const x0 = ((ix % cells) + cells) % cells, y0 = ((iy % cells) + cells) % cells;
  const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
function fbm(u, v, cells, oct, seed) {
  let s = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(u, v, cells << i, seed + i * 17); norm += amp; amp *= 0.5; }
  return s / norm;
}

const PEAKS = [ // x, z, height, sigma
  [9500, -10500, 2300, 2300], [-11000, -6000, 1900, 2000], [3500, -15200, 1500, 1800], [13500, 2000, 1700, 2400],
];

const wrapD = (d) => ((((d + P / 2) % P) + P) % P) - P / 2;      // signed distance on the periodic world
export function rawHeight(wx, wz) {
  const u = (((wx % P) + P) % P) / P, v = (((wz % P) + P) % P) / P;
  const cont = fbm(u, v, 4, 5, 11);
  let h = (cont - 0.47) * 900;
  const land = smoothstep(0.50, 0.60, cont);
  const ridged = 1 - Math.abs(2 * fbm(u, v, 8, 5, 23) - 1);
  const mw = smoothstep(0.45, 0.72, fbm(u, v, 3, 3, 31));
  h += land * (140 * fbm(u, v, 16, 4, 41) + 1500 * Math.pow(ridged, 2.4) * mw);
  for (const [px, pz, ph, ps] of PEAKS) {
    const dx = wrapD(wx - px), dz = wrapD(wz - pz);
    h += ph * Math.exp(-(dx * dx + dz * dz) / (2 * ps * ps)) * (0.75 + 0.25 * vnoise(u, v, 64, 5));
  }
  // flat airfield area, blending into the surroundings
  const ex = Math.max(Math.abs(wrapD(wx - AIRFIELD.x)) - AIRFIELD.flatHalfX, 0), ez = Math.max(Math.abs(wrapD(wz - AIRFIELD.z)) - AIRFIELD.flatHalfZ, 0);
  const w = 1 - smoothstep(0, 2600, Math.hypot(ex, ez));
  return h + (AIRFIELD.elev - h) * w;
}

export class Terrain {
  constructor() { this.h = new Float32Array(N * N); this.ready = false; }

  // generate in slices so the page stays responsive on the headset
  async generate(onProgress) {
    const rows = 32;
    for (let j0 = 0; j0 < N; j0 += rows) {
      for (let j = j0; j < Math.min(N, j0 + rows); j++) for (let i = 0; i < N; i++) this.h[j * N + i] = rawHeight(i * TEXEL, j * TEXEL);
      if (onProgress) onProgress(Math.min(1, (j0 + rows) / N));
      await new Promise(r => setTimeout(r, 0));
    }
    this.ready = true;
  }

  // sea-clamped ground height (what you collide with)
  heightAt(x, z) {
    const fx = x / TEXEL, fz = z / TEXEL;
    const i0 = Math.floor(fx), j0 = Math.floor(fz), tx = fx - i0, tz = fz - j0;
    const a = ((i0 % N) + N) % N, b = (a + 1) % N, c = ((j0 % N) + N) % N, d = (c + 1) % N;
    const h = this.h, h00 = h[c * N + a], h10 = h[c * N + b], h01 = h[d * N + a], h11 = h[d * N + b];
    const r = h00 + (h10 - h00) * tx + (h01 - h00) * tz + (h00 - h10 - h01 + h11) * tx * tz;
    return r > 0 ? r : 0;
  }
  slopeAt(x, z) {
    const e = 30;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e), dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.atan(Math.hypot(dx, dz));
  }

  // RGBA8 texture: 16-bit height in R (high) and G (low), nearest filtering, bilinear done in the shader
  makeTexture() {
    const data = new Uint8Array(N * N * 4);
    for (let k = 0; k < N * N; k++) {
      const v = Math.round(Math.min(1, Math.max(0, (this.h[k] - HMIN) / HRANGE)) * 65535);
      data[k * 4] = v >> 8; data[k * 4 + 1] = v & 255; data[k * 4 + 2] = 0; data[k * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
}

// ---------------------------------------------------------------------------------------------- renderer side
export const SKY_HORIZON = 0xbcd4ea, SKY_TOP = 0x3f78c0;
export const SUN_DIR = new THREE.Vector3(-0.45, 0.78, -0.35).normalize();

const VERT = /* glsl */`
precision highp float; precision highp int;
uniform sampler2D uHeight;
uniform vec2 uCenterW;      // wrapped world coords of this level's grid centre
uniform vec2 uOff;          // grid centre - player (x,z), metres
uniform float uPlayerY;
uniform float uCell;        // metres between vertices of this level
uniform float uHalfQ;       // half number of quads
uniform float uIsOuter;
varying vec3 vLocal; varying vec2 vWorld; varying float vRaw; varying vec3 vN;
const float TEXEL = ${TEXEL.toFixed(1)}, NN = ${N.toFixed(1)}, HMIN = ${HMIN.toFixed(1)}, HRANGE = ${HRANGE.toFixed(1)};
float hAt(vec2 c){ c = mod(c, NN); vec4 t = texelFetch(uHeight, ivec2(c), 0); return ((t.r*255.0*256.0 + t.g*255.0)/65535.0)*HRANGE + HMIN; }
float height(vec2 w){ vec2 f = w/TEXEL; vec2 fl = floor(f); vec2 t = f - fl;
  float a=hAt(fl), b=hAt(fl+vec2(1.,0.)), c=hAt(fl+vec2(0.,1.)), d=hAt(fl+vec2(1.,1.));
  return a + (b-a)*t.x + (c-a)*t.y + (a-b-c+d)*t.x*t.y; }
void main(){
  vec2 g = position.xz / uCell;                       // integer grid index
  vec2 w = uCenterW + position.xz;
  float hh = height(w);
  if (uIsOuter < 0.5) {                               // stitch odd border vertices to the coarser neighbour level
    bool bx = abs(abs(g.x) - uHalfQ) < 0.5, bz = abs(abs(g.y) - uHalfQ) < 0.5;
    if (bx && mod(abs(g.y), 2.0) > 0.5) hh = 0.5*(height(w + vec2(0., uCell)) + height(w - vec2(0., uCell)));
    else if (bz && mod(abs(g.x), 2.0) > 0.5) hh = 0.5*(height(w + vec2(uCell, 0.)) + height(w - vec2(uCell, 0.)));
  }
  vRaw = hh; float h = max(hh, 0.0);
  float e = max(uCell, TEXEL);
  float hl = max(height(w - vec2(e,0.)),0.0), hr = max(height(w + vec2(e,0.)),0.0), hd = max(height(w - vec2(0.,e)),0.0), hu = max(height(w + vec2(0.,e)),0.0);
  vN = normalize(vec3(hl - hr, 2.0*e, hd - hu));
  vWorld = w;
  vLocal = vec3(position.x + uOff.x, h - uPlayerY, position.z + uOff.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vLocal, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float; precision highp int;
uniform vec3 uSun; uniform vec3 uFog; uniform float uFogDen; uniform float uTime;
uniform vec2 uHoleC; uniform float uHoleH; uniform vec2 uPlayerW;
varying vec3 vLocal; varying vec2 vWorld; varying float vRaw; varying vec3 vN;
float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hs(i), hs(i+vec2(1.,0.)), f.x), mix(hs(i+vec2(0.,1.)), hs(i+vec2(1.,1.)), f.x), f.y); }
void main(){
  if (uHoleH > 0.0 && abs(vWorld.x - uHoleC.x) < uHoleH && abs(vWorld.y - uHoleC.y) < uHoleH) discard;
  float dist = length(vLocal);
  vec3 n = normalize(vN);
  float slope = 1.0 - n.y;
  float h = max(vRaw, 0.0);
  float near = 1.0 - smoothstep(3000.0, 9000.0, dist);
  float d1 = vn(vWorld * 0.045) * 0.6 + vn(vWorld * 0.31) * 0.4;
  float d2 = vn(vWorld * 0.0035);
  vec3 col;
  vec3 sand = vec3(0.76, 0.70, 0.52), grass = mix(vec3(0.24, 0.40, 0.15), vec3(0.36, 0.45, 0.20), d2), forest = vec3(0.13, 0.27, 0.12);
  vec3 rock = vec3(0.42, 0.39, 0.35), snow = vec3(0.93, 0.95, 0.98);
  col = mix(sand, grass, smoothstep(2.0, 14.0, h));
  col = mix(col, forest, smoothstep(0.40, 0.75, d2) * smoothstep(20.0, 60.0, h) * (1.0 - smoothstep(500.0, 900.0, h)));
  col = mix(col, rock * (0.8 + 0.4 * d1), smoothstep(0.10, 0.28, slope) + smoothstep(900.0, 1400.0, h));
  col = mix(col, snow, smoothstep(1750.0, 2000.0, h + 220.0 * (d1 - 0.5)) * smoothstep(0.55, 0.30, slope + 0.1));
  col *= mix(1.0, 0.82 + 0.36 * d1, near);
  float diff = max(dot(n, uSun), 0.0);
  vec3 lit = col * (0.30 + 0.85 * diff);
  if (vRaw <= 0.05) {                                         // sea
    float depth = clamp(-vRaw / 60.0, 0.0, 1.0);
    vec3 sea = mix(vec3(0.16, 0.45, 0.52), vec3(0.03, 0.17, 0.33), depth);
    vec2 wp = vWorld * 0.06 + vec2(uTime * 0.4, uTime * 0.27);
    vec3 wn = normalize(vec3(vn(wp) - 0.5, 3.0, vn(wp.yx * 1.7 + 4.0) - 0.5));
    vec3 V = normalize(-vLocal); vec3 R = reflect(-uSun, wn);
    float spec = pow(max(dot(R, V), 0.0), 60.0) * (1.0 - smoothstep(4000.0, 14000.0, dist));
    float foam = (1.0 - smoothstep(0.0, 6.0, -vRaw)) * (0.5 + 0.5 * vn(vWorld * 0.2 + uTime));
    lit = sea * (0.55 + 0.55 * max(dot(wn, uSun), 0.0)) + vec3(spec) * 0.9 + vec3(foam) * 0.5;
  }
  float f = 1.0 - exp(-dist * uFogDen); f = clamp(f * (1.0 + 0.6 * f), 0.0, 1.0);
  gl_FragColor = vec4(mix(lit, uFog, f), 1.0);
}`;

export function buildTerrainMesh(terrain, scene, quads = 96) {
  const tex = terrain.makeTexture();
  const QUADS = quads, HALFQ = QUADS / 2, LEVELS = 6;
  const group = new THREE.Group(); group.frustumCulled = false; group.name = 'terrain'; scene.add(group);
  const levels = [];
  for (let k = 0; k < LEVELS; k++) {
    const cell = TEXEL * Math.pow(2, k);
    const geo = new THREE.PlaneGeometry(QUADS * cell, QUADS * cell, QUADS, QUADS); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.FrontSide,
      uniforms: {
        uHeight: { value: tex }, uCenterW: { value: new THREE.Vector2() }, uOff: { value: new THREE.Vector2() }, uPlayerY: { value: 0 },
        uCell: { value: cell }, uHalfQ: { value: HALFQ }, uIsOuter: { value: k === LEVELS - 1 ? 1 : 0 },
        uSun: { value: SUN_DIR }, uFog: { value: new THREE.Color(SKY_HORIZON) }, uFogDen: { value: 1 / 26000 }, uTime: { value: 0 },
        uHoleC: { value: new THREE.Vector2() }, uHoleH: { value: 0 }, uPlayerW: { value: new THREE.Vector2() },
      },
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 0;
    group.add(mesh); levels.push({ mesh, cell, mat, cx: 0, cz: 0 });
  }
  const wrapP = (v) => ((v % P) + P) % P;
  function update(px, py, pz, time) {
    for (let k = 0; k < LEVELS; k++) {
      const L = levels[k], snap = L.cell * 2;
      L.cx = Math.round(px / snap) * snap; L.cz = Math.round(pz / snap) * snap;
      const u = L.mat.uniforms;
      u.uCenterW.value.set(wrapP(L.cx), wrapP(L.cz));
      u.uOff.value.set(L.cx - px, L.cz - pz);
      u.uPlayerY.value = py; u.uTime.value = time;
      if (k > 0) { const I = levels[k - 1]; u.uHoleC.value.set(wrapP(L.cx) + (I.cx - L.cx), wrapP(L.cz) + (I.cz - L.cz)); u.uHoleH.value = HALFQ * I.cell - 0.01; }
    }
  }
  return { group, update, levels, setFog(color, den) { for (const L of levels) { L.mat.uniforms.uFog.value.set(color); L.mat.uniforms.uFogDen.value = den; } } };
}
