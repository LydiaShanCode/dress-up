import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildBody, makeMeshes, readBack, measureGuides } from './body.js';
import { FIELDS, DEFAULTS, load, save } from './measurements.js';
import './style.css';

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const labels = new CSS2DRenderer();
labels.domElement.className = 'labels';
stage.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(28, 1, 1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 45;
controls.maxDistance = 260;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = Math.PI * 0.62;
controls.autoRotateSpeed = 1.6;

// Lights
scene.add(new THREE.HemisphereLight(0xfff4ea, 0x8a7f78, 0.9));
const key = new THREE.DirectionalLight(0xfff1e2, 2.1);
key.position.set(40, 90, 70);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -30, right: 30, top: 75, bottom: -5, near: 10, far: 250 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.04;
scene.add(key);
const rim = new THREE.DirectionalLight(0xdfe8ff, 1.1);
rim.position.set(-60, 70, -80);
scene.add(rim);

// Floor
const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.ShadowMaterial({ opacity: 0.12 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const disc = new THREE.Mesh(
  new THREE.RingGeometry(13.5, 13.7, 128),
  new THREE.MeshBasicMaterial({ color: 0x1a1613, transparent: true, opacity: 0.12 }),
);
disc.rotation.x = -Math.PI / 2;
disc.position.y = 0.02;
scene.add(disc);

const materials = {
  skin: new THREE.MeshPhysicalMaterial({ color: 0xd9a988, roughness: 0.62, sheen: 0.4, sheenColor: 0xffd9c4, sheenRoughness: 0.6, clearcoat: 0.04 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.55 }),
  bra: new THREE.MeshStandardMaterial({ color: 0x8e9a98, roughness: 0.8, side: THREE.DoubleSide }),
  base: new THREE.MeshStandardMaterial({ color: 0x18171a, roughness: 0.75, side: THREE.DoubleSide }),
};

const guideMat = new THREE.LineBasicMaterial({ color: 0xd2492a, depthTest: false, transparent: true });

let m = load();
let bodyGroup = null, guideGroup = null;
let showGuides = false;
let L;

function rebuild() {
  const body = buildBody(m);
  L = body.L;
  if (bodyGroup) { scene.remove(bodyGroup); bodyGroup.traverse((o) => o.geometry?.dispose()); }
  bodyGroup = makeMeshes(body, materials);
  scene.add(bodyGroup);
  buildGuides(body);
  updateReadout(readBack(body, m));
  controls.target.set(0, L.top / 2, 0);
}

function buildGuides(body) {
  if (guideGroup) {
    guideGroup.traverse((o) => { o.geometry?.dispose(); if (o.isCSS2DObject) o.element.remove(); });
    scene.remove(guideGroup);
  }
  guideGroup = new THREE.Group();
  const { rings, lines } = measureGuides(body, m);
  const label = (key, pos) => {
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = `<b>${m[key]}″</b> ${nameOf(key)}`;
    const o = new CSS2DObject(el);
    o.position.copy(pos);
    guideGroup.add(o);
  };
  for (const r of rings) {
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(r.pts), guideMat);
    line.renderOrder = 10;
    guideGroup.add(line);
    // label at the outermost point on her left
    const p = r.pts.reduce((a, b) => (b.x > a.x ? b : a));
    label(r.key, p.clone().add(new THREE.Vector3(0.6, 0, 0)));
  }
  for (const l of lines) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(l.pts), guideMat);
    line.renderOrder = 10;
    guideGroup.add(line);
    const mid = l.pts[0].clone().lerp(l.pts.at(-1), 0.5);
    label(l.key, mid);
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
      <span class="input"><input type="number" step="0.25" min="1" name="${k}" value="${m[k]}"><i>${unit}</i></span>
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
  t = setTimeout(rebuild, 80);
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
    const diff = Math.abs(rb[k] - m[k]);
    if (k === 'weight') {
      el.textContent = `≈${Math.round(rb.weight)}`;
      el.title = `Weight implied by the model's volume (${Math.round(rb.volume)} in³ at body density)`;
      el.className = 'check ' + (Math.abs(rb.weight - m.weight) / m.weight < 0.08 ? 'ok' : 'warn');
    } else {
      el.textContent = diff < 0.05 ? '✓' : rb[k].toFixed(1);
      el.title = `Model measures ${rb[k].toFixed(2)}″`;
      el.className = 'check ' + (diff < 0.05 ? 'ok' : 'warn');
    }
  }
  const ft = Math.floor(m.height / 12), inch = +(m.height - ft * 12).toFixed(1);
  document.getElementById('summary').textContent = `${ft}′${inch}″ · ${m.weight} lb`;
}

// ---------- view controls ----------
let tween = null;
function viewAt(az) {
  controls.autoRotate = false;
  document.getElementById('spin').classList.remove('on');
  const off = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(off);
  let d = az - sph.theta;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  tween = { from: sph.theta, to: sph.theta + d, phi0: sph.phi, phi1: Math.PI / 2 - 0.06, r: sph.radius, t0: performance.now() };
}
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => viewAt(+b.dataset.view * Math.PI / 180));
document.getElementById('spin').addEventListener('click', (e) => {
  controls.autoRotate = !controls.autoRotate;
  e.currentTarget.classList.toggle('on', controls.autoRotate);
});
document.getElementById('guides').addEventListener('click', (e) => {
  showGuides = !showGuides;
  guideGroup.visible = showGuides;
  e.currentTarget.classList.toggle('on', showGuides);
});
controls.addEventListener('start', () => { tween = null; });

// ---------- layout ----------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

rebuild();
resize();
{
  const fit = (L.top * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, L.top * 0.55, fit);
}

renderer.setAnimationLoop((now) => {
  if (tween) {
    const k = Math.min(1, (now - tween.t0) / 700), e = 1 - (1 - k) ** 3;
    const sph = new THREE.Spherical(tween.r, tween.phi0 + (tween.phi1 - tween.phi0) * e, tween.from + (tween.to - tween.from) * e);
    camera.position.setFromSpherical(sph).add(controls.target);
    if (k >= 1) tween = null;
  }
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
});
