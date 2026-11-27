import * as THREE from 'three';

/*
 * Parametric body built from lofted cross-sections.
 * Units: inches. Origin at floor between the feet; +y up, +z front, +x her left.
 *
 * Every measured girth is a "key section". The section's shape (width/depth
 * ratios, bust, glutes...) comes from typical proportions; its size is then
 * scaled so the CONVEX-HULL perimeter (what a tape measure reads, since tape
 * bridges hollows) equals the measurement exactly.
 */

const RING = 72; // points per cross-section
const PARAMS = ['w', 'f', 'b', 'p', 'pinch', 'bust', 'bx', 'bs', 'glute', 'gx', 'gs', 'nose', 'cx', 'cy', 'cz'];

// ---------- 2D profile ----------
function profile(s, n = RING) {
  const pts = [];
  const e = 2 / s.p;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const c = Math.cos(th), sn = Math.sin(th);
    const X = s.w * Math.sign(c) * Math.abs(c) ** e;
    let Z = (sn >= 0 ? s.f : s.b) * Math.sign(sn) * Math.abs(sn) ** e;
    if (sn > 0 && s.bust) {
      const g = Math.exp(-(((X - s.bx) / s.bs) ** 2)) + Math.exp(-(((X + s.bx) / s.bs) ** 2));
      Z += s.bust * sn * g;
    }
    if (sn < 0 && s.glute) {
      const g = Math.exp(-(((X - s.gx) / s.gs) ** 2)) + Math.exp(-(((X + s.gx) / s.gs) ** 2));
      Z -= s.glute * -sn * g;
    }
    if (sn > 0 && s.nose) Z += s.nose * Math.exp(-((X / 0.32) ** 2)) * sn ** 4;
    if (s.pinch) Z *= 1 - s.pinch * Math.exp(-((c / 0.32) ** 2));
    pts.push([X, Z]);
  }
  return pts;
}

export function hullPerimeter(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  const h = lower.slice(0, -1).concat(upper.slice(0, -1));
  let per = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return per;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

// Fill defaults and, if a circumference is given, scale to match it.
function resolveKey(k) {
  const s = { p: 2, pinch: 0, bust: 0, glute: 0, nose: 0, cx: 0, cy: 0, cz: 0, ...k };
  s.bx ??= 0.42 * s.w; s.bs ??= 0.24 * s.w;
  s.gx ??= 0.45 * s.w; s.gs ??= 0.32 * s.w;
  if (k.circ) {
    const m = k.circ / hullPerimeter(profile(s, 256));
    for (const q of ['w', 'f', 'b', 'bust', 'bx', 'bs', 'glute', 'gx', 'gs', 'nose']) s[q] *= m;
  }
  return s;
}

// Monotone cubic (PCHIP): no overshoot, so measured keys stay true extrema.
function pchip(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return (x) => {
    let i = 0;
    if (x <= xs[0]) i = 0; else if (x >= xs[n - 1]) i = n - 2;
    else while (x > xs[i + 1]) i++;
    const t = Math.min(1, Math.max(0, (x - xs[i]) / h[i])), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

/**
 * A lofted limb/trunk. keys: [{t, ...shape, cx, cy, cz}] sorted by t.
 * front: reference vector the local "Z" (front) axis should point toward.
 */
class Loft {
  constructor(keys, front = new THREE.Vector3(0, 0, 1)) {
    this.keys = keys.map(resolveKey);
    this.front = front.clone().normalize();
    const ts = this.keys.map((k) => k.t);
    this.t0 = ts[0]; this.t1 = ts.at(-1);
    this.fn = {};
    for (const q of PARAMS) this.fn[q] = pchip(ts, this.keys.map((k) => k[q]));
  }
  sec(t) { const s = {}; for (const q of PARAMS) s[q] = this.fn[q](t); return s; }
  center(t) { const s = this.sec(t); return new THREE.Vector3(s.cx, s.cy, s.cz); }
  frame(t) {
    const e = 0.05;
    const T = this.center(Math.min(t + e, this.t1)).sub(this.center(Math.max(t - e, this.t0))).normalize();
    const V = this.front.clone().addScaledVector(T, -this.front.dot(T)).normalize();
    const U = new THREE.Vector3().crossVectors(V, T).normalize();
    return { T, U, V };
  }
  ring(t, inflate = 0) {
    const s = this.sec(t);
    if (inflate) { s.w += inflate; s.f += inflate; s.b += inflate; }
    const c = new THREE.Vector3(s.cx, s.cy, s.cz);
    const { U, V } = this.frame(t);
    return { pts2: profile(s), c, U, V, s };
  }
  ringWorld(t, inflate = 0) {
    const r = this.ring(t, inflate);
    return r.pts2.map(([X, Z]) => r.c.clone().addScaledVector(r.U, X).addScaledVector(r.V, Z));
  }
  geometry({ step = 0.22, from = this.t0, to = this.t1, inflate = 0, caps = true } = {}) {
    const ts = [];
    const n = Math.max(2, Math.ceil((to - from) / step));
    for (let i = 0; i <= n; i++) ts.push(from + ((to - from) * i) / n);
    const pos = [], idx = [];
    const rings = ts.map((t) => this.ringWorld(t, inflate));
    for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
    const N = RING;
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * N + i, b = j * N + ((i + 1) % N), c = (j + 1) * N + i, d = (j + 1) * N + ((i + 1) % N);
        idx.push(a, b, c, b, d, c);
      }
    }
    if (caps) {
      for (const [j, flip] of [[0, true], [rings.length - 1, false]]) {
        const cen = rings[j].reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / N);
        const ci = pos.length / 3; pos.push(cen.x, cen.y, cen.z);
        for (let i = 0; i < N; i++) {
          const a = j * N + i, b = j * N + ((i + 1) % N);
          flip ? idx.push(ci, b, a) : idx.push(ci, a, b);
        }
      }
    }
    // orient outward
    const r = rings[Math.floor(rings.length / 2)];
    const cen = r.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / N);
    const j = Math.floor(rings.length / 2) * N;
    const A = new THREE.Vector3(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
    const B = new THREE.Vector3(pos[(j + 1) * 3], pos[(j + 1) * 3 + 1], pos[(j + 1) * 3 + 2]);
    const C = new THREE.Vector3(pos[(j + N) * 3], pos[(j + N) * 3 + 1], pos[(j + N) * 3 + 2]);
    const nrm = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A));
    if (nrm.dot(A.clone().sub(cen)) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // volume in cubic inches between t-range (cross-section area × arc length)
  volume(from = this.t0, to = this.t1, step = 0.2) {
    let v = 0;
    for (let t = from; t < to; t += step) {
      const t2 = Math.min(to, t + step), tm = (t + t2) / 2;
      const len = this.center(t2).distanceTo(this.center(t));
      v += polyArea(this.ring(tm).pts2) * len;
    }
    return v;
  }
}

// ---------- landmarks ----------
export function landmarks(m) {
  const L = {};
  L.height = m.height;
  L.crotch = m.inseam;
  // Outer leg was taped from just below the natural waist down to the ankle bone.
  L.waist = Math.min(m.outseam + 4.5, m.inseam + 11);
  L.waist = Math.max(L.waist, m.inseam + 6.5);
  L.hip = L.crotch + (L.waist - L.crotch) * 0.38;
  L.stomach = L.crotch + (L.waist - L.crotch) * 0.72;
  L.shoulder = L.waist + m.torso; // acromion / collarbone line
  L.rib = L.waist + m.torso * 0.36;
  L.bust = L.waist + m.torso * 0.53;
  L.armpit = L.waist + m.torso * 0.72;
  L.top = m.height;
  L.headLen = Math.min(9.4, Math.max(7.4, (m.height - L.shoulder) * 0.71));
  L.chin = L.top - L.headLen;
  L.neckBase = L.shoulder + 1.3;
  L.knee = m.inseam * 0.62;
  L.calf = L.knee - 5.0;
  L.ankle = 3.0;
  L.neckHalf = 1.95;
  L.acromionX = L.neckHalf + m.shoulder * 0.93;
  return L;
}

// ---------- body ----------
export function buildBody(m) {
  const L = landmarks(m);
  const parts = {}; // name -> Loft
  const s = L.acromionX;

  // Torso (vertical, t = height)
  parts.torso = new Loft([
    { t: L.crotch - 0.9, w: 3.2, f: 1.0, b: 1.0, pinch: 0.6 },
    { t: L.crotch + 0.2, circ: m.hip * 0.9, w: 1, f: 0.64, b: 0.8, pinch: 0.72, glute: 0.06 },
    { t: L.crotch + 1.4, circ: m.hip * 0.97, w: 1, f: 0.66, b: 0.84, pinch: 0.25, glute: 0.13, cz: -0.05 },
    { t: L.hip, circ: m.hip, w: 1, f: 0.66, b: 0.84, glute: 0.14, cz: -0.1, label: 'hip' },
    { t: L.stomach, circ: m.stomach, w: 1, f: 0.74, b: 0.74, glute: 0.04, cz: -0.15, label: 'stomach' },
    { t: L.waist, circ: m.waist, w: 1, f: 0.76, b: 0.72, cz: -0.1, label: 'waist' },
    { t: L.rib, circ: m.ribcage, w: 1, f: 0.76, b: 0.78, cz: 0.0, label: 'ribcage' },
    { t: (L.rib + L.bust) / 2, circ: (m.ribcage + m.bust) / 2, w: 1, f: 0.7, b: 0.76, bust: 0.16, cz: 0.05 },
    { t: L.bust, circ: m.bust, w: 1, f: 0.6, b: 0.72, bust: 0.3, bx: 0.42, bs: 0.26, cz: 0.05, label: 'bust' },
    { t: L.armpit, circ: m.bust * 0.95, w: 1, f: 0.64, b: 0.7, bust: 0.06, cz: 0.0 },
    { t: L.shoulder - 1.6, w: s - 0.2, f: 2.7, b: 2.9, p: 2.3, cz: -0.15 },
    { t: L.shoulder - 0.3, w: s - 0.15, f: 2.05, b: 2.4, p: 2.5, cz: -0.25 },
    { t: L.shoulder + 0.5, w: s - 1.3, f: 1.9, b: 2.15, p: 2.2, cz: -0.35 },
    { t: L.neckBase, w: L.neckHalf + 0.3, f: 1.85, b: 1.95, cz: -0.45 },
    { t: L.neckBase + 1.1, w: L.neckHalf, f: 1.75, b: 1.85, cz: -0.35 },
    { t: L.chin + 0.6, w: L.neckHalf - 0.1, f: 1.7, b: 1.8, cz: -0.25 },
  ].map((k) => ({ ...k, cy: k.t })));

  // Head (vertical)
  const hb = L.chin, H = L.headLen;
  const hy = (r) => hb + r * H;
  parts.head = new Loft([
    { t: hy(-0.02), w: 1.7, f: 1.6, b: 1.8, cz: -0.25 },
    { t: hy(0.04), w: 1.6, f: 1.75, b: 1.75, cz: 0.1 },
    { t: hy(0.1), w: 2.05, f: 2.4, b: 1.9, p: 1.9, cz: 0.15 },
    { t: hy(0.22), w: 2.5, f: 2.75, b: 2.5, p: 2.0, cz: 0.15 },
    { t: hy(0.36), w: 2.75, f: 2.95, b: 3.05, nose: 0.12, cz: 0.1 },
    { t: hy(0.42), w: 2.8, f: 2.95, b: 3.2, nose: 0.55, cz: 0.1 },
    { t: hy(0.5), w: 2.85, f: 2.95, b: 3.35, nose: 0.25, cz: 0.05 },
    { t: hy(0.6), w: 2.85, f: 2.85, b: 3.45, cz: 0.0 },
    { t: hy(0.76), w: 2.7, f: 2.55, b: 3.3, cz: -0.1 },
    { t: hy(0.9), w: 2.05, f: 1.9, b: 2.55, cz: -0.15 },
    { t: hy(0.975), w: 1.05, f: 0.95, b: 1.3, cz: -0.2 },
    { t: hy(1.0), w: 0.15, f: 0.15, b: 0.15, cz: -0.2 },
  ].map((k) => ({ ...k, cy: k.t })));

  // Legs (path roughly vertical, t = height of the section)
  for (const side of [1, -1]) {
    const lx = (y) => side * (3.05 - (L.crotch - y) * 0.032); // gentle inward taper toward the ankles
    const leg = [
      { t: L.crotch + 3.2, circ: m.thigh * 0.95, w: 1, f: 0.85, b: 0.95, ox: -0.45 },
      { t: L.crotch - 1.2, circ: m.thigh, w: 1, f: 0.9, b: 1.0, label: 'thigh' },
      { t: L.crotch - 4.5, circ: m.thigh * 0.9, w: 1, f: 0.92, b: 0.95 },
      { t: L.knee + 2.8, circ: m.calf * 1.06, w: 1, f: 0.95, b: 0.9 },
      { t: L.knee, circ: m.calf * 1.03, w: 1, f: 0.92, b: 0.85, cz: 0.15 },
      { t: L.knee - 2.4, circ: m.calf * 0.96, w: 1, f: 0.85, b: 1.0, cz: 0.05 },
      { t: L.calf, circ: m.calf, w: 1, f: 0.78, b: 1.12, cz: -0.15, label: 'calf' },
      { t: L.calf - 3.5, circ: m.calf * 0.78, w: 1, f: 0.82, b: 0.95, cz: -0.1 },
      { t: L.ankle + 0.8, circ: m.calf * 0.63, w: 1, f: 0.85, b: 0.85 },
      { t: L.ankle - 0.4, circ: m.calf * 0.7, w: 1.05, f: 0.9, b: 1.0 },
      { t: 1.4, circ: m.calf * 0.6, w: 1, f: 1, b: 1 },
    ].map((k) => ({ ...k, cy: k.t, cx: lx(k.t) + side * (k.ox || 0), cz: (k.cz || 0) + 0.1 }));
    parts[side > 0 ? 'legL' : 'legR'] = new Loft(leg.reverse());

    // Foot (path runs forward along +z; local "front" is up)
    const ax = lx(L.ankle);
    const foot = [
      { t: -1.75, w: 0.4, f: 0.4, b: 0.45, cy: 1.15 },
      { t: -1.45, w: 1.0, f: 1.0, b: 1.0, cy: 1.2 },
      { t: -0.6, w: 1.15, f: 1.35, b: 1.25, cy: 1.35 },
      { t: 0.8, w: 1.2, f: 1.35, b: 1.3, cy: 1.45 },
      { t: 2.6, w: 1.35, f: 0.95, b: 1.25, cy: 1.15 },
      { t: 4.6, w: 1.65, f: 0.62, b: 0.66, cy: 0.68 },
      { t: 5.9, w: 1.7, f: 0.48, b: 0.46, cy: 0.5 },
      { t: 6.9, w: 1.5, f: 0.4, b: 0.36, cy: 0.42 },
      { t: 7.45, w: 0.95, f: 0.32, b: 0.3, cy: 0.38 },
      { t: 7.7, w: 0.2, f: 0.12, b: 0.12, cy: 0.38 },
    ].map((k) => ({ ...k, cz: k.t, cx: ax + side * (0.12 + Math.max(0, k.t) * 0.06) }));
    parts[side > 0 ? 'footL' : 'footR'] = new Loft(foot, new THREE.Vector3(0, 1, 0));
  }

  // Arms (relaxed A-pose so clothes can hang freely later)
  const upper = m.armLength * 0.54, fore = m.armLength - upper;
  for (const side of [1, -1]) {
    const S = new THREE.Vector3(side * (s - 0.25), L.shoulder - 0.85, -0.25);
    const d1 = new THREE.Vector3(side * Math.sin(0.2), -Math.cos(0.2), 0).normalize();
    const E = S.clone().addScaledVector(d1, upper);
    const d2 = new THREE.Vector3(side * Math.sin(0.13), -Math.cos(0.13), 0.13).normalize();
    const W = E.clone().addScaledVector(d2, fore);
    const at = (t) => (t <= upper ? S.clone().addScaledVector(d1, t) : E.clone().addScaledVector(d2, t - upper));
    const keys = [
      { t: -1.35, circ: m.arm * 0.6, w: 1, f: 1, b: 1 },
      { t: -0.7, circ: m.arm * 1.08, w: 1, f: 1.05, b: 1.1 },
      { t: 1.2, circ: m.arm * 1.13, w: 1.05, f: 1.0, b: 1.0 },
      { t: upper * 0.45, circ: m.arm, w: 1, f: 1.0, b: 1.0, label: 'arm' },
      { t: upper * 0.8, circ: m.arm * 0.88, w: 1, f: 0.95, b: 0.95 },
      { t: upper, circ: m.arm * 0.86, w: 1.05, f: 0.9, b: 0.95 },
      { t: upper + fore * 0.28, circ: m.arm * 0.9, w: 1, f: 1, b: 0.95 },
      { t: upper + fore * 0.7, circ: m.arm * 0.72, w: 0.9, f: 1, b: 1 },
      { t: m.armLength, circ: m.arm * 0.6, w: 0.75, f: 1, b: 1 },
      // hand: palm faces the thigh, so it is wide front-to-back
      { t: m.armLength + 1.1, w: 0.62, f: 1.3, b: 1.3 },
      { t: m.armLength + 3.0, w: 0.55, f: 1.55, b: 1.5, p: 2.6 },
      { t: m.armLength + 4.1, w: 0.5, f: 1.45, b: 1.35, p: 2.6 },
      { t: m.armLength + 6.0, w: 0.38, f: 1.1, b: 1.0, p: 2.3 },
      { t: m.armLength + 6.7, w: 0.25, f: 0.6, b: 0.55 },
      { t: m.armLength + 6.95, w: 0.08, f: 0.15, b: 0.15 },
    ].map((k) => { const c = at(k.t); return { ...k, cx: c.x, cy: c.y, cz: c.z }; });
    parts[side > 0 ? 'armL' : 'armR'] = new Loft(keys);
    parts[side > 0 ? 'armL' : 'armR'].joints = { S, E, W };
  }

  // Hair: ponytail
  const tail = [
    [0, hy(0.64), -3.2, 0.95], [1, hy(0.6), -3.75, 0.8], [3, hy(0.42), -3.95, 0.9],
    [6, hy(0.12), -3.7, 0.82], [9, hy(-0.18), -3.15, 0.62], [11.5, hy(-0.45), -2.9, 0.38], [12.5, hy(-0.55), -2.85, 0.08],
  ].map(([t, y, z, r]) => ({ t, w: r, f: r * 0.9, b: r * 0.9, cx: 0, cy: y, cz: z }));
  parts.ponytail = new Loft(tail, new THREE.Vector3(1, 0, 0));

  return { L, parts };
}

// ---------- scene objects ----------
export function makeMeshes(body, materials) {
  const { parts, L } = body;
  const g = new THREE.Group();
  const add = (geo, mat, name) => { const mesh = new THREE.Mesh(geo, mat); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
  for (const name of ['torso', 'head', 'legL', 'legR', 'footL', 'footR', 'armL', 'armR']) add(parts[name].geometry(), materials.skin, name);

  // Hair cap: inflated head, cut back to a hairline at the face.
  const head = parts.head;
  const capGeo = head.geometry({ from: L.chin + L.headLen * 0.28, inflate: 0.2, caps: true });
  add(capGeo, hairCapMaterial(materials.hair, L), 'hair');
  add(parts.ponytail.geometry({ step: 0.15 }), materials.hair, 'ponytail');
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.22, 12, 32), materials.base);
  const tp = parts.ponytail.center(0.6);
  tie.position.copy(tp); tie.lookAt(parts.ponytail.center(1.4));
  g.add(tie);

  // Base layer like in the video: sports bra + shorts.
  const t = parts.torso;
  add(t.geometry({ from: L.rib - 0.9, to: L.armpit + 0.6, inflate: 0.07, caps: false }), materials.bra, 'bra');
  add(t.geometry({ from: L.crotch - 0.9, to: L.stomach + 0.4, inflate: 0.07, caps: false }), materials.base, 'shorts');
  for (const leg of ['legL', 'legR']) add(parts[leg].geometry({ from: L.crotch - 2.2, inflate: 0.07, caps: false }), materials.base, leg + 'Short');
  // bra straps
  for (const side of [1, -1]) {
    const pts = [
      new THREE.Vector3(side * 2.6, L.armpit + 0.2, t.ring(L.armpit).s.f + 0.15),
      new THREE.Vector3(side * 3.1, L.shoulder + 0.15, 1.2),
      new THREE.Vector3(side * 3.15, L.shoulder + 0.55, -0.6),
      new THREE.Vector3(side * 2.6, L.shoulder - 1.4, -2.85),
      new THREE.Vector3(side * 1.6, L.armpit - 0.5, -2.75),
    ];
    const strap = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.32, 8, false), materials.bra);
    strap.scale.set(1, 1, 1);
    strap.castShadow = true;
    g.add(strap);
  }
  return g;
}

// Hair cap = inflated head; the face is cut away in the fragment shader so the
// hairline is a smooth curve instead of jagged triangle edges.
function hairCapMaterial(base, L) {
  const mat = base.clone();
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uChin = { value: L.chin };
    sh.uniforms.uHead = { value: L.headLen };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nuniform float uChin; uniform float uHead;')
      .replace('void main() {', `void main() {
        float lat = abs(vObj.x) / 2.9;
        float frontLine = uChin + uHead * (0.80 - 0.16 * lat * lat);   // forehead → temples
        float sideLine  = uChin + uHead * 0.42;                          // in front of the ears
        float backLine  = uChin + uHead * 0.30;                          // nape
        float k = smoothstep(-2.2, -0.6, vObj.z);
        float line = mix(backLine, mix(sideLine, frontLine, smoothstep(-0.6, 1.4, vObj.z)), k);
        if (vObj.y < line) discard;`);
  };
  return mat;
}

// Model's own read-back of each measurement (taken from the generated mesh).
export function readBack(body, m) {
  const { parts, L } = body;
  const out = {};
  const circ = (loft, t) => { const r = loft.ring(t); return hullPerimeter(r.pts2); };
  const keyT = (loft, label) => loft.keys.find((k) => k.label === label).t;
  for (const k of ['bust', 'ribcage', 'waist', 'stomach', 'hip']) out[k] = circ(parts.torso, keyT(parts.torso, k));
  out.thigh = circ(parts.legL, keyT(parts.legL, 'thigh'));
  out.calf = circ(parts.legL, keyT(parts.legL, 'calf'));
  out.arm = circ(parts.armL, keyT(parts.armL, 'arm'));
  out.inseam = L.crotch;
  out.outseam = L.waist - 4.5;
  out.torso = L.shoulder - L.waist;
  out.shoulder = (L.acromionX - L.neckHalf) / 0.93;
  const { S, W } = parts.armL.joints;
  out.armLength = m.armLength; // path length shoulder→wrist (upper + forearm)
  out.height = L.top;
  // Volume → weight (body density ≈ 1.01 g/cm³ = 0.0365 lb/in³)
  let vol = parts.torso.volume() + parts.head.volume();
  for (const p of ['legL', 'legR', 'armL', 'armR', 'footL', 'footR']) vol += parts[p].volume(parts[p].t0, parts[p].t1);
  // subtract overlaps where limbs sit inside the torso
  vol -= 2 * parts.legL.volume(L.crotch, parts.legL.t1);
  vol -= 2 * parts.armL.volume(parts.armL.t0, 0.3);
  vol -= parts.head.volume(parts.head.t0, L.chin + 0.6);
  out.volume = vol;
  out.weight = vol * 0.0365;
  return out;
}

// Rings & lines for the measurement overlay.
export function measureGuides(body, m) {
  const { parts, L } = body;
  const rings = [];
  const keyT = (loft, label) => loft.keys.find((k) => k.label === label).t;
  for (const k of ['bust', 'ribcage', 'waist', 'stomach', 'hip']) rings.push({ key: k, pts: parts.torso.ringWorld(keyT(parts.torso, k), 0.12) });
  rings.push({ key: 'thigh', pts: parts.legL.ringWorld(keyT(parts.legL, 'thigh'), 0.12) });
  rings.push({ key: 'calf', pts: parts.legL.ringWorld(keyT(parts.legL, 'calf'), 0.12) });
  rings.push({ key: 'arm', pts: parts.armR.ringWorld(keyT(parts.armR, 'arm'), 0.12) });
  const { S, E, W } = parts.armR.joints;
  const zf = 4.5;
  const lines = [
    { key: 'inseam', pts: [new THREE.Vector3(0.2, L.crotch, 1), new THREE.Vector3(1.6, 0, 1)] },
    { key: 'outseam', pts: [new THREE.Vector3(-6.8, L.waist - 2, 0), new THREE.Vector3(-4.3, L.ankle - 0.5, 0)] },
    { key: 'torso', pts: [new THREE.Vector3(0, L.shoulder, zf), new THREE.Vector3(0, L.waist, zf)] },
    { key: 'shoulder', pts: [new THREE.Vector3(L.neckHalf, L.shoulder + 0.8, 0), new THREE.Vector3(L.acromionX, L.shoulder - 0.2, 0)] },
    { key: 'armLength', pts: [S.clone().add(new THREE.Vector3(-1.3, 0, 0)), E.clone().add(new THREE.Vector3(-1.4, 0, 0)), W.clone().add(new THREE.Vector3(-1.1, 0, 0))] },
  ];
  return { rings, lines };
}
