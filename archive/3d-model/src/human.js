import * as THREE from 'three';

/*
 * A real human mesh (CC0 MakeHuman base mesh, ~19k vertices with face, hands and feet)
 * morphed into a young East-Asian woman, then fitted to the user's tape measurements:
 *
 *   1. Morph targets: asian female young, slim weight, small cup.
 *   2. Uniform scale to the stated height, then a smooth vertical remap so crotch,
 *      waist, shoulder line and head top land at the measured heights.
 *   3. Girth fitting: at each measured level the body is sliced, the slice's
 *      convex-hull perimeter (what a tape reads) is compared to the measurement,
 *      and the region (torso / each leg / each arm) is scaled about its own axis.
 *      Scale factors are interpolated smoothly between levels, and regions blend
 *      through the rig's skinning weights so joins stay seamless. Repeated until
 *      every measurement matches.
 *   4. Hair, eyes, brows and lashes are re-fitted to the final surface through their
 *      .mhclo bindings (each proxy vertex rides on a base-mesh triangle).
 */

const DM = 3.937; // MakeHuman decimeters → inches
const R_TORSO = 0, R_LEGL = 1, R_LEGR = 2, R_ARML = 3, R_ARMR = 4, R_HEAD = 5;

export async function loadHuman() {
  const res = await fetch('/human/human.json');
  const H = await res.json();
  H.base = new Float32Array(H.base);
  H.regions = new Float32Array(H.regions);
  // triangles in base-vertex indices (for slicing, normals, volume)
  const vi = H.body.vi, tri = H.body.tri;
  H.bodyTris = new Uint32Array(tri.length);
  for (let i = 0; i < tri.length; i++) H.bodyTris[i] = vi[tri[i]];
  H.bodyVerts = new Uint32Array([...new Set(vi)]);
  return H;
}

// ---------- small math helpers ----------
function pchip(xs, ys) {
  const n = xs.length;
  const h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

function hull(pts) {
  if (pts.length < 3) return pts;
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const perimeter = (h) => h.reduce((s, a, i) => { const b = h[(i + 1) % h.length]; return s + Math.hypot(a[0] - b[0], a[1] - b[1]); }, 0);

// ---------- the fitter ----------
export class Body {
  constructor(H) { this.H = H; this.N = H.base.length / 3; }

  joint(name) {
    const P = this.P, ids = this.H.joints[name];
    const v = new THREE.Vector3();
    for (const i of ids) v.x += P[i * 3], v.y += P[i * 3 + 1], v.z += P[i * 3 + 2];
    return v.multiplyScalar(1 / ids.length);
  }
  w(i, r) { return this.H.regions[i * 6 + r]; }

  /**
   * Slice the skin with a plane (origin o, normal n) keeping only triangles whose three
   * vertices belong mostly to the given regions. Returns hull points (2D + 3D), its
   * perimeter and centroid.
   */
  slice(o, n, regions, near = null) {
    const P = this.P, T = this.H.bodyTris;
    const u = new THREE.Vector3(), v = new THREE.Vector3();
    const a = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    u.crossVectors(n, a).normalize(); v.crossVectors(n, u).normalize();
    const owns = (i) => { let s = 0; for (const r of regions) s += this.w(i, r); return s > 0.5; };
    const pts = [];
    const d = (i) => (P[i * 3] - o.x) * n.x + (P[i * 3 + 1] - o.y) * n.y + (P[i * 3 + 2] - o.z) * n.z;
    for (let t = 0; t < T.length; t += 3) {
      const ia = T[t], ib = T[t + 1], ic = T[t + 2];
      const da = d(ia), db = d(ib), dc = d(ic);
      if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
      if (!(owns(ia) && owns(ib) && owns(ic))) continue;
      for (const [i, j, di, dj] of [[ia, ib, da, db], [ib, ic, db, dc], [ic, ia, dc, da]]) {
        if ((di > 0) === (dj > 0) || di === dj) continue;
        const k = di / (di - dj);
        const x = P[i * 3] + (P[j * 3] - P[i * 3]) * k - o.x;
        const y = P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * k - o.y;
        const z = P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * k - o.z;
        const q = [x * u.x + y * u.y + z * u.z, x * v.x + y * v.y + z * v.z];
        if (near && Math.hypot(q[0] - near[0], q[1] - near[1]) > near[2]) continue;
        pts.push(q);
      }
    }
    if (pts.length < 3) return null;
    const h = hull(pts);
    let cx = 0, cy = 0; for (const q of h) { cx += q[0]; cy += q[1]; } cx /= h.length; cy /= h.length;
    const toWorld = (q) => o.clone().addScaledVector(u, q[0]).addScaledVector(v, q[1]);
    return { circ: perimeter(h), center: toWorld([cx, cy]), pts: h.map(toWorld) };
  }
  hslice(y, regions) { return this.slice(new THREE.Vector3(0, y, 0), new THREE.Vector3(0, 1, 0), regions); }

  // scan a range of heights for the extreme girth (max for bust/hip/thigh/calf, min for waist)
  scan(y0, y1, regions, mode = 'max', steps = 24) {
    let best = null;
    for (let i = 0; i <= steps; i++) {
      const y = y0 + ((y1 - y0) * i) / steps;
      const s = this.hslice(y, regions);
      if (!s) continue;
      if (!best || (mode === 'max' ? s.circ > best.circ : s.circ < best.circ)) best = { ...s, y };
    }
    return best;
  }

  fit(m) {
    const H = this.H, N = this.N;
    const P = (this.P = new Float32Array(H.base));
    // 1. morph targets
    const bmi = (703 * m.weight) / (m.height * m.height);
    const thin = THREE.MathUtils.clamp((22 - bmi) / 6, 0, 1); // 0 = average weight, 1 = min weight
    for (const [name, wt] of [['asianFemaleYoung', 1], ['minWeight', thin], ['minCup', 1]]) {
      const t = H.targets[name];
      for (let k = 0; k < t.idx.length; k++) {
        const i = t.idx[k] * 3;
        P[i] += t.d[k * 3] * wt; P[i + 1] += t.d[k * 3 + 1] * wt; P[i + 2] += t.d[k * 3 + 2] * wt;
      }
    }
    // to inches, feet on the floor, centred
    let ymin = Infinity, ymax = -Infinity;
    for (const i of H.bodyVerts) { ymin = Math.min(ymin, P[i * 3 + 1]); ymax = Math.max(ymax, P[i * 3 + 1]); }
    const k0 = m.height / ((ymax - ymin) * DM);
    const g = this.joint('ground');
    for (let i = 0; i < N; i++) {
      P[i * 3] = (P[i * 3] - g.x) * DM * k0;
      P[i * 3 + 1] = (P[i * 3 + 1] - ymin) * DM * k0;
      P[i * 3 + 2] = (P[i * 3 + 2] - g.z) * DM * k0;
    }

    // which joint prefix is the rig's ".L" side?
    const lk = this.joint('l-knee');
    this.sides = lk.x > 0 ? { legL: 'l', legR: 'r', armL: 'l', armR: 'r' } : { legL: 'r', legR: 'l', armL: 'r', armR: 'l' };

    // relaxed arms, closer to how she stands in the video
    this.lowerArms(THREE.MathUtils.degToRad(11));

    // 2–3. heights, then girths; repeat because each step nudges the others
    for (let pass = 0; pass < 6; pass++) {
      this.remapHeights(m);
      this.fitTorso(m);
      this.fitLegs(m);
      this.fitArms(m);
      this.fitShoulders(m);
    }
    // final girth passes so every measured level is read where it now sits
    for (let pass = 0; pass < 2; pass++) { this.fitTorso(m); this.fitLegs(m); this.fitArms(m); }
    this.L = this.landmarks();
    return this;
  }

  remapHeights(m) {
    const P = this.P, target = this.targets(m);
    const L = this.landmarks();
    const f = pchip([0, L.crotch, L.waist, L.shoulder, L.top], [0, target.crotch, target.waist, target.shoulder, target.top]);
    for (let i = 0; i < this.N; i++) P[i * 3 + 1] = f(P[i * 3 + 1]);
  }

  // Rotate each arm down about its shoulder joint (linear-blend skinning with the arm weights).
  lowerArms(toVertical) {
    const P = this.P;
    for (const side of ['armL', 'armR']) {
      const R = side === 'armL' ? R_ARML : R_ARMR, j = this.sides[side];
      const S = this.joint(j + '-shoulder'), E = this.joint(j + '-elbow');
      const now = Math.atan2(Math.abs(E.x - S.x), S.y - E.y);
      const phi = (now - toVertical) * (S.x > 0 ? -1 : 1); // positive = counter-clockwise
      const c = Math.cos(phi), s = Math.sin(phi);
      for (let i = 0; i < this.N; i++) {
        const w = this.w(i, R);
        if (w < 1e-3) continue;
        const x = P[i * 3] - S.x, y = P[i * 3 + 1] - S.y;
        P[i * 3] += w * (S.x + x * c - y * s - P[i * 3]);
        P[i * 3 + 1] += w * (S.y + x * s + y * c - P[i * 3 + 1]);
      }
    }
  }

  shoulderWidth() {
    const S = this.joint(this.sides.armL + '-shoulder'), L = this.landmarks();
    const neck = this.hslice(L.shoulder + 1.6, [R_TORSO, R_HEAD]);
    const neckHalf = neck ? Math.max(...neck.pts.map((p) => p.x)) : 2;
    return Math.abs(S.x) + 0.9 - neckHalf;
  }

  // Widen/narrow the shoulders: upper torso fans out, arms shift with it.
  fitShoulders(m) {
    const P = this.P, L = this.landmarks();
    const delta = m.shoulder - this.shoulderWidth();
    const y0 = L.waist + (L.shoulder - L.waist) * 0.6, y1 = L.shoulder - 0.8;
    for (let i = 0; i < this.N; i++) {
      const y = P[i * 3 + 1], x = P[i * 3];
      const r = THREE.MathUtils.smoothstep(y, y0, y1) * THREE.MathUtils.smoothstep(Math.abs(x), 0.5, 3.5);
      const w = this.w(i, R_ARML) + this.w(i, R_ARMR) + this.w(i, R_TORSO) * r;
      P[i * 3] += Math.sign(x) * delta * w;
    }
  }

  targets(m) {
    const waist = Math.max(m.inseam + 6.5, Math.min(m.outseam + 4.5, m.inseam + 11));
    return { crotch: m.inseam, waist, shoulder: waist + m.torso, top: m.height };
  }

  landmarks() {
    const P = this.P, H = this.H;
    const L = {};
    let top = -Infinity, crotch = Infinity;
    for (const i of H.bodyVerts) {
      const x = P[i * 3], y = P[i * 3 + 1];
      top = Math.max(top, y);
      if (Math.abs(x) < 0.25 && y > top * 0.3 && this.w(i, R_HEAD) < 0.5 && y < top * 0.6) crotch = Math.min(crotch, y);
    }
    L.top = top; L.crotch = crotch;
    const span = top - crotch;
    // The natural waist is found once (narrowest torso level), then tracked by a vertex on the
    // front midline so later girth changes can't make it wander.
    if (this.waistVert == null) {
      const wy = this.scan(crotch + span * 0.2, crotch + span * 0.42, [R_TORSO], 'min').y;
      let best = -Infinity;
      for (const i of H.bodyVerts) {
        if (Math.abs(P[i * 3]) < 0.3 && Math.abs(P[i * 3 + 1] - wy) < 0.4 && P[i * 3 + 2] > best && this.w(i, R_TORSO) > 0.9) { best = P[i * 3 + 2]; this.waistVert = i; }
      }
    }
    L.waist = P[this.waistVert * 3 + 1];
    // shoulder line: top surface of the shoulder above the shoulder joint
    const sj = this.joint(this.sides.armL + '-shoulder');
    let sh = -Infinity;
    for (const i of H.bodyVerts) if (Math.abs(P[i * 3] - sj.x) < 0.6 && Math.abs(P[i * 3 + 2] - sj.z) < 1.2) sh = Math.max(sh, P[i * 3 + 1]);
    L.shoulder = sh;
    return L;
  }

  // scale a region's vertices about an axis c(y) by s(y), blended by skin weight
  scaleAbout(region, f, cx, cz, yRange) {
    const P = this.P, N = this.N;
    for (let i = 0; i < N; i++) {
      const w = this.w(i, region);
      if (w < 1e-3) continue;
      const y = P[i * 3 + 1];
      if (yRange && (y < yRange[0] || y > yRange[1])) continue;
      const s = f(y), x0 = cx(y), z0 = cz(y);
      P[i * 3] += w * (x0 + (P[i * 3] - x0) * s - P[i * 3]);
      P[i * 3 + 2] += w * (z0 + (P[i * 3 + 2] - z0) * s - P[i * 3 + 2]);
    }
  }

  fitTorso(m) {
    const L = this.landmarks();
    const T = [R_TORSO];
    const tY = this.targets(m);
    const hip = this.scan(L.crotch + 0.8, L.waist - 2.5, T, 'max');
    const ribY = L.waist + (L.shoulder - L.waist) * 0.36;
    const bust = this.scan(ribY + 1, L.waist + (L.shoulder - L.waist) * 0.66, T, 'max');
    const at = (y, R = T) => { const q = this.hslice(y, R); return q && { ...q, y }; };
    let anchors = [
      { ...hip, want: m.hip, key: 'hip' },
      { ...at(L.waist - 1.8), want: m.stomach, key: 'stomach' },
      { ...at(L.waist), want: m.waist, key: 'waist' },
      { ...at(ribY), want: m.ribcage, key: 'ribcage' },
      { ...bust, want: m.bust, key: 'bust' },
      { ...at(bust.y + 2.2), want: null, key: null },
      { ...at(L.shoulder + 1.6, [R_TORSO, R_HEAD]), want: null, key: null },
    ].filter((a) => a.center);
    anchors.sort((a, b) => a.y - b.y);
    for (const a of anchors) a.s = a.want ? a.want / a.circ : null;
    const bi = anchors.findIndex((a) => a.key === 'bust');
    if (anchors[bi + 1]) anchors[bi + 1].s = (anchors[bi].s + 1) / 2;
    anchors.at(-1).s = 1;
    const ys = anchors.map((a) => a.y);
    const f = pchip(ys, anchors.map((a) => a.s));
    const cx = pchip(ys, anchors.map((a) => a.center.x)), cz = pchip(ys, anchors.map((a) => a.center.z));
    this.scaleAbout(R_TORSO, f, cx, cz);
    this.torsoKeys = Object.fromEntries(anchors.filter((a) => a.key).map((a) => [a.key, a.y]));
  }

  fitLegs(m) {
    const L = this.landmarks();
    this.legKeys = {};
    for (const side of ['legL', 'legR']) {
      const R = side === 'legL' ? R_LEGL : R_LEGR;
      const j = this.sides[side];
      const knee = this.joint(j + '-knee'), ankle = this.joint(j + '-ankle');
      const at = (y) => ({ ...this.hslice(y, [R]), y });
      const thigh = this.scan(L.crotch - 3.5, L.crotch - 0.6, [R], 'max', 12);
      const calf = this.scan(ankle.y + 4, knee.y - 1.5, [R], 'max', 16);
      const a = [
        { ...at(ankle.y + 1.2) }, { ...calf, want: m.calf, key: 'calf' }, { ...at(knee.y) },
        { ...at((knee.y + thigh.y) / 2) }, { ...thigh, want: m.thigh, key: 'thigh' },
      ];
      const sT = m.thigh / thigh.circ, sC = m.calf / calf.circ;
      const s = [Math.sqrt(sC), sC, (sT + sC) / 2, (sT * 2 + sC) / 3, sT];
      const ys = [1.0, ...a.map((q) => q.y)];
      const sv = [1, ...s];
      const c0 = a[0].center;
      const cx = pchip(ys, [c0.x, ...a.map((q) => q.center.x)]), cz = pchip(ys, [c0.z, ...a.map((q) => q.center.z)]);
      this.scaleAbout(R, pchip(ys, sv), cx, cz);
      this.legKeys[side] = { thigh: thigh.y, calf: calf.y };
    }
  }

  fitArms(m) {
    const P = this.P, N = this.N;
    this.armKeys = {};
    for (const side of ['armL', 'armR']) {
      const R = side === 'armL' ? R_ARML : R_ARMR;
      const j = this.sides[side];
      const S = this.joint(j + '-shoulder'), E = this.joint(j + '-elbow'), W = this.joint(j + '-hand');
      const du = E.clone().sub(S), lu = du.length(); du.normalize();
      const df = W.clone().sub(E), lf = df.length(); df.normalize();
      // fullest upper arm between 25% and 65% down the upper arm
      let best = null;
      for (let i = 0; i <= 12; i++) {
        const t = lu * (0.25 + (0.4 * i) / 12);
        const s = this.slice(S.clone().addScaledVector(du, t), du, [R]);
        if (s && (!best || s.circ > best.circ)) best = { ...s, t };
      }
      const sA = m.arm / best.circ;
      const k = (m.armLength - 0.5) / (lu + lf); // tape starts ~½″ above the joint, on the shoulder bone
      const E2 = S.clone().addScaledVector(du, lu * k), W2 = E2.clone().addScaledVector(df, lf * k);
      // radial scale along the arm: shoulder 1 → bicep sA → forearm sA → wrist halfway → hand 1
      const ts = [-1.5, best.t, lu, lu + lf * 0.5, lu + lf, lu + lf + 1.5];
      const ss = [1, sA, sA, sA, (sA + 1) / 2, 1];
      const f = pchip(ts, ss);
      const tmp = new THREE.Vector3(), out = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        const w = this.w(i, R);
        if (w < 1e-3) continue;
        tmp.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        const tu = tmp.clone().sub(S).dot(du);
        if (tu <= lu) {
          const axial = S.clone().addScaledVector(du, tu);
          const rad = tmp.clone().sub(axial).multiplyScalar(f(tu));
          out.copy(S).addScaledVector(du, tu > 0 ? tu * k : tu).add(rad);
        } else {
          const tf = tmp.clone().sub(E).dot(df);
          if (tf <= lf) {
            const axial = E.clone().addScaledVector(df, tf);
            const rad = tmp.clone().sub(axial).multiplyScalar(f(lu + tf));
            out.copy(E2).addScaledVector(df, tf * k).add(rad);
          } else {
            const axial = E.clone().addScaledVector(df, tf);
            const rad = tmp.clone().sub(axial).multiplyScalar(f(lu + tf));
            out.copy(W2).addScaledVector(df, tf - lf).add(rad);
          }
        }
        P[i * 3] += w * (out.x - P[i * 3]); P[i * 3 + 1] += w * (out.y - P[i * 3 + 1]); P[i * 3 + 2] += w * (out.z - P[i * 3 + 2]);
      }
      this.armKeys[side] = { t: best.t };
    }
  }

  // ---------- read back what the mesh actually measures ----------
  readBack(m) {
    const L = this.L, out = {};
    for (const [k, y] of Object.entries(this.torsoKeys)) out[k] = this.hslice(y, [R_TORSO]).circ;
    out.thigh = this.hslice(this.legKeys.legL.thigh, [R_LEGL]).circ;
    out.calf = this.hslice(this.legKeys.legL.calf, [R_LEGL]).circ;
    const j = this.sides.armL;
    const S = this.joint(j + '-shoulder'), E = this.joint(j + '-elbow'), W = this.joint(j + '-hand');
    const du = E.clone().sub(S).normalize();
    out.arm = this.slice(S.clone().addScaledVector(du, this.armKeys.armL.t), du, [R_ARML]).circ;
    out.armLength = S.distanceTo(E) + E.distanceTo(W) + 0.5;
    out.inseam = L.crotch;
    out.outseam = L.waist - 4.5;
    out.torso = L.shoulder - L.waist;
    out.height = L.top;
    // shoulder: side of the neck to the shoulder point
    out.shoulder = this.shoulderWidth();
    out.volume = this.volume();
    out.weight = out.volume * 0.0365; // body density ≈ 1.01 g/cm³
    return out;
  }

  volume() {
    const P = this.P, T = this.H.bodyTris;
    let v = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
    }
    return Math.abs(v);
  }

  guides() {
    const rings = [];
    for (const [k, y] of Object.entries(this.torsoKeys)) rings.push({ key: k, pts: this.hslice(y, [R_TORSO]).pts });
    rings.push({ key: 'thigh', pts: this.hslice(this.legKeys.legL.thigh, [R_LEGL]).pts });
    rings.push({ key: 'calf', pts: this.hslice(this.legKeys.legL.calf, [R_LEGL]).pts });
    const j = this.sides.armR;
    const S = this.joint(j + '-shoulder'), E = this.joint(j + '-elbow'), W = this.joint(j + '-hand');
    const du = E.clone().sub(S).normalize();
    rings.push({ key: 'arm', pts: this.slice(S.clone().addScaledVector(du, this.armKeys.armR.t), du, [R_ARMR]).pts });
    const L = this.L;
    const lines = [
      { key: 'inseam', pts: [new THREE.Vector3(0, L.crotch, 0), new THREE.Vector3(0, 0, 0)] },
      { key: 'torso', pts: [new THREE.Vector3(0, L.shoulder, 5), new THREE.Vector3(0, L.waist, 5)] },
      { key: 'armLength', pts: [S, E, W] },
    ];
    return { rings, lines };
  }

  // ---------- geometry ----------
  normals() {
    const P = this.P, T = this.H.bodyTris, Nn = new Float32Array(P.length);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < T.length; t += 3) {
      a.fromArray(P, T[t] * 3); b.fromArray(P, T[t + 1] * 3); c.fromArray(P, T[t + 2] * 3);
      const n = b.clone().sub(a).cross(c.clone().sub(a)); // area-weighted
      for (const i of [T[t], T[t + 1], T[t + 2]]) { Nn[i * 3] += n.x; Nn[i * 3 + 1] += n.y; Nn[i * 3 + 2] += n.z; }
    }
    for (let i = 0; i < Nn.length; i += 3) { const l = Math.hypot(Nn[i], Nn[i + 1], Nn[i + 2]) || 1; Nn[i] /= l; Nn[i + 1] /= l; Nn[i + 2] /= l; }
    return Nn;
  }

  // Taubin smoothing (no shrinkage) — fabric bridges small bumps instead of hugging them
  smoothed(Q, iters) {
    if (!this.adj) {
      this.adj = Array.from({ length: this.N }, () => new Set());
      const T = this.H.bodyTris;
      for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3]; this.adj[a].add(b); this.adj[b].add(a); }
      this.adj = this.adj.map((s) => [...s]);
    }
    let A = Q.slice();
    for (let it = 0; it < iters * 2; it++) {
      const lam = it % 2 ? -0.53 : 0.5, B = A.slice();
      for (const i of this.H.bodyVerts) {
        const nb = this.adj[i]; if (!nb.length) continue;
        let x = 0, y = 0, z = 0; for (const j of nb) { x += A[j * 3]; y += A[j * 3 + 1]; z += A[j * 3 + 2]; }
        B[i * 3] += lam * (x / nb.length - A[i * 3]); B[i * 3 + 1] += lam * (y / nb.length - A[i * 3 + 1]); B[i * 3 + 2] += lam * (z / nb.length - A[i * 3 + 2]);
      }
      A = B;
    }
    return A;
  }

  skinGeometry(faceFilter = null, offset = 0, smooth = 0) {
    const { vi, uv, tri } = this.H.body;
    const Nn = this.normals();
    let P = this.P;
    if (offset) { P = P.slice(); for (let i = 0; i < P.length; i++) P[i] += Nn[i] * offset; }
    if (smooth) P = this.smoothed(P, smooth);
    const pos = new Float32Array(vi.length * 3), nrm = new Float32Array(vi.length * 3);
    for (let r = 0; r < vi.length; r++) {
      const i = vi[r];
      for (let k = 0; k < 3; k++) { nrm[r * 3 + k] = Nn[i * 3 + k]; pos[r * 3 + k] = P[i * 3 + k]; }
    }
    let idx = tri;
    if (faceFilter) {
      idx = [];
      for (let t = 0; t < tri.length; t += 3) if (faceFilter(vi[tri[t]], vi[tri[t + 1]], vi[tri[t + 2]])) idx.push(tri[t], tri[t + 1], tri[t + 2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  proxyGeometry(px) {
    const P = this.P;
    const sc = {};
    for (const ax of ['x', 'y', 'z']) {
      const [a, b, den] = px.scale[ax], o = { x: 0, y: 1, z: 2 }[ax];
      sc[ax] = Math.abs(P[a * 3 + o] - P[b * 3 + o]) / den; // inches per MakeHuman unit, along that axis
    }
    const fitted = px.refs.map(([a, b, c, wa, wb, wc, dx, dy, dz]) => [
      wa * P[a * 3] + wb * P[b * 3] + wc * P[c * 3] + dx * sc.x,
      wa * P[a * 3 + 1] + wb * P[b * 3 + 1] + wc * P[c * 3 + 1] + dy * sc.y,
      wa * P[a * 3 + 2] + wb * P[b * 3 + 2] + wc * P[c * 3 + 2] + dz * sc.z,
    ]);
    const pos = new Float32Array(px.vi.length * 3);
    px.vi.forEach((i, r) => pos.set(fitted[i], r * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(px.uv, 2));
    g.setIndex(px.tri);
    g.computeVertexNormals();
    return g;
  }

  // Base layer like in the video: sports bra + shorts, made by offsetting parts of the skin.
  baseLayer() {
    const P = this.P, L = this.L, ty = this.torsoKeys;
    const y = (i) => P[i * 3 + 1];
    const arm = (i) => this.w(i, R_ARML) + this.w(i, R_ARMR) > 0.35 || this.w(i, R_HEAD) > 0.5;
    const braTop = ty.bust + (L.shoulder - ty.bust) * 0.42;
    const band = (lo, hi) => (a, b, c) => [a, b, c].every((i) => !arm(i)) && [a, b, c].some((i) => y(i) > lo && y(i) < hi);
    const braBand = [ty.ribcage - 1.1, braTop], shortsBand = [L.crotch - 2.4, ty.stomach + 0.6];
    // straps: vertical strips over the shoulders, crossing to the back of the bra
    const strapBand = [braTop - 0.6, L.shoulder + 3];
    const strap = (a, b, c) => [a, b, c].every((i) => this.w(i, R_ARML) + this.w(i, R_ARMR) < 0.35) && [a, b, c].some((i) => y(i) > strapBand[0] && Math.abs(Math.abs(this.P[i * 3]) - 2.8) < 1);
    return {
      bra: this.skinGeometry(band(...braBand), 0.2, 14), braBand,
      straps: this.skinGeometry(strap, 0.16, 2), strapBand,
      shorts: this.skinGeometry(band(...shortsBand), 0.07), shortsBand, braTop,
    };
  }

  // A point on the skin near (x, y), on the front (dir=+1) or back (dir=-1), or top of shoulder (dir=0)
  surface(x, y, dir) {
    const P = this.P;
    let best = null, bv = -Infinity;
    for (const i of this.H.bodyVerts) {
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
      if (this.w(i, R_ARML) + this.w(i, R_ARMR) > 0.3) continue;
      if (dir === 0) { if (Math.abs(px - x) < 0.35 && Math.abs(pz - y) < 0.6 && py > bv) { bv = py; best = [px, py, pz]; } }
      else if (Math.abs(px - x) < 0.35 && Math.abs(py - y) < 0.35 && pz * dir > bv) { bv = pz * dir; best = [px, py, pz]; }
    }
    return best && new THREE.Vector3(...best);
  }
}
