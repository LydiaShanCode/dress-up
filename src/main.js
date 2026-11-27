import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { loadHuman, Body } from './human.js';
import { FIELDS, DEFAULTS, load, save } from './measurements.js';
import './style.css';

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

const labels = new CSS2DRenderer();
labels.domElement.className = 'labels';
stage.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;

const camera = new THREE.PerspectiveCamera(26, 1, 1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 30;
controls.maxDistance = 260;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = Math.PI * 0.62;
controls.autoRotateSpeed = 1.4;
controls.zoomToCursor = true; // zoom toward the face, hands, feet… wherever you point

// Soft studio light
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b2ac, 0.7));
const key = new THREE.DirectionalLight(0xfff6ee, 2.2);
key.position.set(35, 85, 70);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -30, right: 30, top: 75, bottom: -5, near: 10, far: 250 });
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.05;
key.shadow.radius = 6;
scene.add(key);
const fill = new THREE.DirectionalLight(0xeef2ff, 0.6);
fill.position.set(-50, 40, 40);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 1.2);
rim.position.set(-30, 70, -80);
scene.add(rim);

const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.ShadowMaterial({ opacity: 0.1 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ---------- materials ----------
const tex = new THREE.TextureLoader();
const loadTex = (url, srgb = true) => {
  const t = tex.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
// Fabric cut to an exact height band in the shader, so hems are straight lines
// rather than the stair-step of whole mesh faces.
// uStrip (centre |x|, half-width) optionally limits it to a vertical strip, for straps.
function bandMaterial(opts, strip = null) {
  const mat = new THREE.MeshStandardMaterial({ ...opts, side: THREE.DoubleSide });
  mat.userData.band = { value: new THREE.Vector2(0, 100) };
  mat.userData.strip = { value: new THREE.Vector2(0, strip ? strip : 1000) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBand = mat.userData.band;
    sh.uniforms.uStrip = mat.userData.strip;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vP;\nuniform vec2 uBand; uniform vec2 uStrip;')
      .replace('void main() {', `void main() {
        if (vP.y < uBand.x || vP.y > uBand.y) discard;
        // straps run straight up the front and angle in toward the spine on the back
        float cx = uStrip.x - (vP.z < 0.0 ? clamp((uBand.y - 3.0 - vP.y) * 0.25, 0.0, 1.2) : 0.0);
        if (abs(abs(vP.x) - cx) > uStrip.y) discard;`);
  };
  return mat;
}

const materials = {
  // tint the CC0 light-skin texture toward the warm, light-medium tone in the video
  skin: new THREE.MeshPhysicalMaterial({
    map: loadTex('/human/skin.jpg'), color: 0xf2d4bd, roughness: 0.52, specularIntensity: 0.35,
    sheen: 0.35, sheenRoughness: 0.5, sheenColor: 0xffc8b0,
  }),
  eyes: new THREE.MeshPhysicalMaterial({ map: loadTex('/human/eyes.png'), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }),
  eyebrows: new THREE.MeshStandardMaterial({ map: loadTex('/human/eyebrows.png'), color: 0x2a221d, transparent: true, depthWrite: false, roughness: 0.9 }),
  eyelashes: new THREE.MeshStandardMaterial({ map: loadTex('/human/eyelashes.png'), color: 0x111111, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  // her hair is near-black
  hair: new THREE.MeshStandardMaterial({ map: loadTex('/human/hair.png'), color: 0x2a2420, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55 }),
  bra: bandMaterial({ color: 0x95a3a1, roughness: 0.85 }),
  shorts: bandMaterial({ color: 0x1b1a1d, roughness: 0.8 }),
  straps: bandMaterial({ color: 0x95a3a1, roughness: 0.85 }, 0.32),
};
const guideMat = new THREE.LineBasicMaterial({ color: 0x2f5bea, depthTest: false, transparent: true });

// ---------- state ----------
let m = load();
let H, bodyGroup, guideGroup, showGuides = false, L;
const loading = document.getElementById('loading');

function rebuild() {
  const body = new Body(H).fit(m);
  L = body.L;
  if (bodyGroup) { scene.remove(bodyGroup); bodyGroup.traverse((o) => o.geometry?.dispose()); }
  bodyGroup = new THREE.Group();
  const add = (geo, mat, order = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.renderOrder = order;
    bodyGroup.add(mesh);
  };
  add(body.skinGeometry(), materials.skin);
  for (const px of H.proxies) add(body.proxyGeometry(px), materials[px.name], px.name === 'hair' ? 2 : 1);
  const layer = body.baseLayer();
  materials.bra.userData.band.value.set(...layer.braBand);
  materials.shorts.userData.band.value.set(...layer.shortsBand);
  add(layer.bra, materials.bra);
  add(layer.shorts, materials.shorts);
  materials.straps.userData.band.value.set(...layer.strapBand);
  materials.straps.userData.strip.value.x = 2.8;
  add(layer.straps, materials.straps);
  scene.add(bodyGroup);
  buildGuides(body);
  updateReadout(body.readBack(m));
  controls.target.set(0, L.top / 2, 0);
}

function buildGuides(body) {
  if (guideGroup) {
    guideGroup.traverse((o) => { o.geometry?.dispose(); if (o.isCSS2DObject) o.element.remove(); });
    scene.remove(guideGroup);
  }
  guideGroup = new THREE.Group();
  const { rings, lines } = body.guides();
  const label = (key, pos) => {
    const el = document.createElement('div');
    el.className = 'tag';
    el.textContent = `${nameOf(key)} ${m[key]}″`;
    const o = new CSS2DObject(el);
    o.position.copy(pos);
    guideGroup.add(o);
  };
  for (const r of rings) {
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(r.pts), guideMat);
    line.renderOrder = 10;
    guideGroup.add(line);
    const p = r.pts.reduce((a, b) => (b.x > a.x ? b : a));
    label(r.key, p.clone().add(new THREE.Vector3(0.5, 0, 0)));
  }
  for (const l of lines) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(l.pts), guideMat);
    line.renderOrder = 10;
    guideGroup.add(line);
    label(l.key, l.pts[0].clone().lerp(l.pts.at(-1), 0.5));
  }
  guideGroup.visible = showGuides;
  scene.add(guideGroup);
}

const nameOf = (k) => FIELDS.flatMap((g) => g.items).find((i) => i[0] === k)?.[1] ?? k;

// ---------- panel ----------
const form = document.getElementById('fields');
for (const g of FIELDS) {
  const fs = document.createElement('fieldset');
  fs.innerHTML = `<legend>${g.group}</legend>`;
  for (const [k, label, unit = 'in'] of g.items) {
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `<span class="name">${label}</span>
      <span class="input"><input type="number" inputmode="decimal" step="0.25" min="1" name="${k}" value="${m[k]}"><i>${unit}</i></span>
      <span class="check" data-k="${k}"></span>`;
    fs.appendChild(row);
  }
  form.appendChild(fs);
}
let t;
form.addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  if (!Number.isFinite(v) || v <= 0) return;
  m[e.target.name] = v;
  save(m);
  clearTimeout(t);
  t = setTimeout(rebuild, 150);
});
document.getElementById('reset').addEventListener('click', () => {
  m = { ...DEFAULTS };
  save(m);
  for (const inp of form.querySelectorAll('input')) inp.value = m[inp.name];
  rebuild();
});

function updateReadout(rb) {
  for (const el of form.querySelectorAll('.check')) {
    const k = el.dataset.k;
    if (rb[k] == null) { el.textContent = ''; continue; }
    if (k === 'weight') {
      el.textContent = `model ≈${Math.round(rb.weight)}`;
      el.title = `Weight implied by the model's volume (${Math.round(rb.volume)} in³ at body density)`;
    } else {
      const ok = Math.abs(rb[k] - m[k]) < 0.15;
      el.textContent = ok ? '✓' : rb[k].toFixed(1);
      el.title = `The 3D model measures ${rb[k].toFixed(2)}″`;
      el.setAttribute('aria-label', ok ? 'Model matches' : `Model measures ${rb[k].toFixed(1)} inches`);
    }
  }
  const ft = Math.floor(m.height / 12), inch = +(m.height - ft * 12).toFixed(1);
  document.getElementById('summary').textContent = `${ft}′${inch}″ · ${m.weight} lb`;
}

// ---------- view controls (spring-damped, interruptible) ----------
let goal = null, vel = 0;
function viewAt(az) {
  controls.autoRotate = false;
  document.getElementById('spin').setAttribute('aria-pressed', 'false');
  goal = az;
}
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => viewAt(+b.dataset.view * Math.PI / 180));
document.getElementById('spin').addEventListener('click', (e) => {
  controls.autoRotate = !controls.autoRotate;
  goal = null;
  e.currentTarget.setAttribute('aria-pressed', String(controls.autoRotate));
});
document.getElementById('guides').addEventListener('click', (e) => {
  showGuides = !showGuides;
  guideGroup.visible = showGuides;
  e.currentTarget.setAttribute('aria-pressed', String(showGuides));
});
controls.addEventListener('start', () => { goal = null; vel = 0; });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (goal !== null) {
    const off = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    const d = Math.atan2(Math.sin(goal - sph.theta), Math.cos(goal - sph.theta));
    if (reduceMotion) { sph.theta = goal; vel = 0; goal = null; }
    else {
      // critically-damped spring (stiffness 90): no overshoot, picks up from any current velocity
      vel += (90 * d - 2 * Math.sqrt(90) * vel) * dt;
      sph.theta += vel * dt;
      if (Math.abs(d) < 0.002 && Math.abs(vel) < 0.01) { goal = null; vel = 0; }
    }
    sph.phi += (Math.PI / 2 - 0.08 - sph.phi) * Math.min(1, dt * 8);
    camera.position.setFromSpherical(sph).add(controls.target);
  }
  // keep her on the turntable axis: the target may slide up/down (zoom to cursor), never sideways
  if (L) {
    controls.target.x = controls.target.z = 0;
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, 8, L.top - 4);
  }
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

// ---------- boot ----------
resize();
loadHuman().then((h) => {
  H = h;
  rebuild();
  const fit = (L.top * 0.6) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, L.top * 0.52, fit);
  loading.hidden = true;
});
