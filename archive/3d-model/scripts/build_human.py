"""
Packs CC0 MakeHuman assets (assets-src/) into public/human/human.json for the web app.

  python3 scripts/build_human.py

Output (all coordinates in MakeHuman units = decimeters, y up, +z front):
  base:      flat xyz for every base-mesh vertex (body + helpers + joint markers)
  body:      render mesh for the skin: {vi, uv, tri} (vertices un-welded at UV seams;
             vi maps each render vertex back to its base vertex)
  targets:   sparse morph targets {idx, d}
  regions:   per base vertex weights for [torso, legL, legR, armL, armR, head] (from the CC0 rig)
  joints:    joint name -> base vertex indices (joint = their centroid)
  proxies:   hair / eyes / eyebrows / eyelashes fitted to the body with .mhclo bindings
"""
import json, os, re
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'assets-src')
OUT = os.path.join(ROOT, 'public', 'human')
os.makedirs(OUT, exist_ok=True)


def read_obj(path, group_filter=None):
    v, vt, faces, groups = [], [], [], {}
    g = None
    for line in open(path):
        if line.startswith('v '):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            vt.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '):
            g = line.split(None, 1)[1].strip()
        elif line.startswith('f '):
            corners = []
            for c in line.split()[1:]:
                p = c.split('/')
                corners.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
            groups.setdefault(g, []).append(corners)
            if group_filter is None or g in group_filter:
                faces.append(corners)
    return np.array(v), np.array(vt) if vt else None, faces, groups


def render_mesh(faces, vt):
    """Un-weld vertices on UV seams; triangulate quads."""
    key = {}
    vi, uv, tri = [], [], []
    def rv(c):
        k = c
        if k not in key:
            key[k] = len(vi)
            vi.append(c[0])
            uv.extend(vt[c[1]] if c[1] >= 0 else [0, 0])
        return key[k]
    for f in faces:
        ids = [rv(c) for c in f]
        for i in range(1, len(ids) - 1):
            tri.extend([ids[0], ids[i], ids[i + 1]])
    return {'vi': vi, 'uv': [round(x, 5) for x in uv], 'tri': tri}


def read_target(path):
    idx, d = [], []
    for line in open(path):
        if line.startswith('#') or not line.strip():
            continue
        p = line.split()
        idx.append(int(p[0]))
        d.extend(round(float(x), 5) for x in p[1:4])
    return {'idx': idx, 'd': d}


def read_mhclo(path):
    refs, scale = [], {}
    in_verts = False
    for line in open(path):
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        p = s.split()
        if p[0] in ('x_scale', 'y_scale', 'z_scale'):
            scale[p[0][0]] = [int(p[1]), int(p[2]), float(p[3])]
            continue
        if p[0] == 'verts':
            in_verts = True
            continue
        if in_verts:
            if re.match(r'^-?\d', p[0]):
                if len(p) == 1:
                    refs.append([int(p[0]), int(p[0]), int(p[0]), 1, 0, 0, 0, 0, 0])
                else:
                    refs.append([int(p[0]), int(p[1]), int(p[2])] + [float(x) for x in p[3:9]])
            elif refs:
                in_verts = False
    return {'refs': refs, 'scale': scale}


# ---- base mesh ----
base_v, base_vt, body_faces, groups = read_obj(os.path.join(SRC, '3dobjs/base.obj'), {'body'})
N = len(base_v)
print('base verts', N, 'body faces', len(body_faces))

joints = {}
for g, fs in groups.items():
    if g and g.startswith('joint-'):
        joints[g[6:]] = sorted({c[0] for f in fs for c in f})

# ---- region weights from the rig ----
REG = ['torso', 'legL', 'legR', 'armL', 'armR', 'head']
def region_of(bone):
    side = 'L' if bone.endswith('.L') else 'R' if bone.endswith('.R') else ''
    b = bone.split('.')[0]
    if re.match(r'(upperleg|lowerleg|foot|toe)', b):
        return 'leg' + side
    if re.match(r'(upperarm|lowerarm|wrist|finger|metacarpal)', b):
        return 'arm' + side
    if re.match(r'(spine|pelvis|breast|clavicle|shoulder|root)', b):
        return 'torso'
    return 'head'  # neck, head, jaw, face muscles, eyes, tongue

W = np.zeros((N, len(REG)))
wdata = json.load(open(os.path.join(SRC, 'rigs/default_weights.mhw')))['weights']
for bone, lst in wdata.items():
    r = REG.index(region_of(bone))
    for vi, w in lst:
        W[vi, r] += w
has = W.sum(1) > 1e-6
# Unweighted vertices (helpers, joint markers) copy their nearest weighted neighbour.
wi = np.nonzero(has)[0]
for i in np.nonzero(~has)[0]:
    d = ((base_v[wi] - base_v[i]) ** 2).sum(1)
    W[i] = W[wi[np.argmin(d)]]
W = W / W.sum(1, keepdims=True)

# ---- targets ----
T = os.path.join(SRC, 'targets')
targets = {
    'asianFemaleYoung': read_target(os.path.join(T, 'macrodetails/asian-female-young.target')),
    'minWeight': read_target(os.path.join(T, 'macrodetails/universal-female-young-averagemuscle-minweight.target')),
    'minCup': read_target(os.path.join(T, 'breast/mincup.target')),
}

# ---- proxies ----
def proxy(name, folder, obj, clo, tex):
    v, vt, faces, _ = read_obj(os.path.join(SRC, folder, obj))
    c = read_mhclo(os.path.join(SRC, folder, clo))
    assert len(c['refs']) == len(v), (name, len(c['refs']), len(v))
    return {'name': name, 'texture': tex, 'refs': [[round(x, 5) for x in r] for r in c['refs']],
            'scale': c['scale'], **render_mesh(faces, vt)}

proxies = [
    proxy('eyes', 'eyes', 'high-poly.obj', 'high-poly.mhclo', 'eyes.png'),
    proxy('eyebrows', 'eyebrows', 'eyebrow001.obj', 'eyebrow001.mhclo', 'eyebrows.png'),
    proxy('eyelashes', 'eyelashes', 'eyelashes01.obj', 'eyelashes01.mhclo', 'eyelashes.png'),
    proxy('hair', 'hair', 'ponytail01.obj', 'ponytail01.mhclo', 'hair.png'),
]

out = {
    'license': 'Mesh, targets, rig weights, proxies and textures: MakeHuman assets, CC0 1.0',
    'base': [round(x, 5) for x in base_v.ravel().tolist()],
    'body': render_mesh(body_faces, base_vt),
    'targets': targets,
    'regionNames': REG,
    'regions': [round(x, 3) for x in W.ravel().tolist()],
    'joints': joints,
    'proxies': proxies,
}
json.dump(out, open(os.path.join(OUT, 'human.json'), 'w'), separators=(',', ':'))
print('wrote', os.path.getsize(os.path.join(OUT, 'human.json')) // 1024, 'KB')
