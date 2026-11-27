"""
Cut reusable garment layers out of a try-on photo so outfits can be composed for free.

  .venv/bin/python scripts/extract_garments.py \
      --base public/looks/base.jpg --tryon captures/look-badblood.png \
      --piece top:badblood-lace-henley:"H.B.B. Lace Henley-Neck Long Sleeve, Black":https://global.musinsa.com/us/products/7173529 \
      --piece bottom:badblood-curved-joggers:"90s Vintage Club Curved Joggers, White":https://global.musinsa.com/us/products/6341128 \
      --piece shoes:white-sneakers:"White sneakers"

How it works
  1. Align: the try-on is registered to the base photo (ECC on the head, which the
     try-on keeps unchanged), so every layer sits exactly on the static base model.
  2. Segment: a local clothing-segmentation model (u2net_cloth_seg: upper / lower body)
     gives each garment's region; shoes come from what changed below the ankles.
  3. Refine: pixels that did not change from the base (same colour) are dropped at the
     garment's edge, and small holes are filled, so edges hug the real outline.
  4. Save: an RGBA layer cropped to its bounding box + its box in base-photo pixels,
     appended to public/closet/closet.json.
"""
import argparse, json, os
import numpy as np, cv2
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'public', 'closet')
Z = {'shoes': 5, 'bottom': 10, 'top': 20, 'outer': 30}  # pant cuffs drape over shoes


def load(path, size=None):
    im = Image.open(path).convert('RGB')
    if size and im.size != size:
        im = im.resize(size, Image.LANCZOS)
    return np.array(im)


def align(base, img):
    """Affine ECC registration of img onto base, driven by the head/shoulders region."""
    h, w = base.shape[:2]
    s = 0.25
    g1 = cv2.cvtColor(cv2.resize(base, None, fx=s, fy=s), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    g2 = cv2.cvtColor(cv2.resize(img, None, fx=s, fy=s), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    mask = np.zeros_like(g1, np.uint8)
    mask[int(g1.shape[0] * 0.03):int(g1.shape[0] * 0.22), int(g1.shape[1] * 0.25):int(g1.shape[1] * 0.75)] = 255
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(g1, g2, warp, cv2.MOTION_AFFINE,
                                       (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), mask, 5)
    except cv2.error as e:
        print('  alignment failed, using identity:', e)
    warp[:, 2] /= s
    print('  alignment: shift %.1f,%.1f px  scale %.4f' % (warp[0, 2], warp[1, 2], np.sqrt(abs(np.linalg.det(warp[:, :2])))))
    return cv2.warpAffine(img, warp, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)


def cloth_masks(img):
    from rembg import new_session
    sess = new_session('u2net_cloth_seg')
    masks = sess.predict(Image.fromarray(img))  # [upper, lower, full]
    return [np.array(m.convert('L').resize((img.shape[1], img.shape[0]))) for m in masks]


def changed(base, img):
    a = cv2.cvtColor(base, cv2.COLOR_RGB2LAB).astype(np.float32)
    b = cv2.cvtColor(img, cv2.COLOR_RGB2LAB).astype(np.float32)
    d = np.linalg.norm(cv2.GaussianBlur(a, (5, 5), 0) - cv2.GaussianBlur(b, (5, 5), 0), axis=2)
    return (d > 14).astype(np.uint8) * 255


def clean(mask, close=25, min_area=4000):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close))
    m = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            keep[lab == i] = 255
    # fill interior holes
    cnts, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(keep)
    cv2.drawContours(filled, cnts, -1, 255, -1)
    return filled


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--tryon', required=True)
    ap.add_argument('--base-cutout', help='RGBA cutout of the base; its alpha is the base body mask')
    ap.add_argument('--piece', action='append', required=True, help='slot:id:name[:url]')
    a = ap.parse_args()

    base = load(a.base)
    h, w = base.shape[:2]
    img = align(base, load(a.tryon, (w, h)))
    upper, lower, full = cloth_masks(img)
    from rembg import new_session
    hs = new_session('u2net_human_seg')
    seg = lambda im: (np.array(hs.predict(Image.fromarray(im))[0].convert('L').resize((w, h))) > 127).astype(np.uint8) * 255
    person = seg(img)
    if a.base_cutout:
        base_person = (np.array(Image.open(a.base_cutout).convert('RGBA').resize((w, h)))[:, :, 3] > 127).astype(np.uint8) * 255
    else:
        base_person = seg(base)
    # body visible in the base photo that the try-on replaced with backdrop (e.g. feet that moved)
    uncovered = cv2.bitwise_and(base_person, cv2.bitwise_not(cv2.dilate(person, np.ones((5, 5), np.uint8))))
    diff = changed(base, img)
    diff_c = clean(diff, 15, 1500)

    # vertical extent of the figure, for the shoes band
    feet_top = int(h * 0.86)

    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, 'closet.json')
    closet = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {'base': None, 'size': [w, h], 'items': []}
    closet['size'] = [w, h]

    for spec in a.piece:
        slot, pid, name, *url = spec.split(':', 3)
        if slot == 'top':
            m = (upper > 110).astype(np.uint8) * 255
        elif slot == 'bottom':
            m = (lower > 110).astype(np.uint8) * 255  # full length: cuffs sit over the shoes
            # cloth segmentation can stop just inside an edge (side piping, a hem); within the
            # pants' area, also take everything the person mask covers, minus the top's sleeves
            rows, cols = np.where(m > 0)
            if len(rows):
                area = np.zeros_like(m)
                pad = int(w * 0.04)
                area[rows.min():rows.max() + 1, max(0, cols.min() - pad):cols.max() + pad] = 255
                sleeves = cv2.dilate((upper > 90).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
                extra = cv2.bitwise_and(person, area)
                extra[sleeves] = 0
                m = cv2.max(m, extra)
        elif slot == 'shoes':
            # the person (not floor or shadow) below the ankles, minus the trouser legs/cuffs
            m = person.copy()
            m[:feet_top] = 0
            m[cv2.dilate((lower > 110).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0] = 0
            m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
            n, labs, stats, _ = cv2.connectedComponentsWithStats(m)
            keep = sorted(range(1, n), key=lambda i: -stats[i, cv2.CC_STAT_AREA])[:2]  # two shoes
            m = np.isin(labs, keep).astype(np.uint8) * 255
        else:
            raise SystemExit('unknown slot ' + slot)
        m = clean(m)
        # cover patch: hide base-body pixels near this garment that the try-on shows as backdrop
        rows = np.where(m.any(1))[0]
        if len(rows):
            zone = np.zeros_like(m)
            y1 = h if slot in ('bottom', 'shoes') else rows[-1] + 1
            zone[rows[0]:y1] = 255
            zone = cv2.bitwise_and(zone, cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (141, 141) if slot == 'shoes' else (81, 81))))
            if slot == 'bottom':
                zone[feet_top:] = 0  # the shoes layer owns the feet
            # anything that changed here (moved feet, wider/narrower limbs) takes the try-on's pixels
            changed_here = cv2.dilate(cv2.max(diff, uncovered), np.ones((7, 7), np.uint8))
            # never take pixels that belong to a different garment in the same try-on
            others = {'top': lower, 'bottom': upper, 'shoes': cv2.max(upper, lower)}[slot]
            changed_here[cv2.dilate((others > 90).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0] = 0
            # patches only ever cover the base body (never backdrop-to-backdrop lighting noise)
            changed_here = cv2.bitwise_and(changed_here, cv2.dilate(base_person, np.ones((9, 9), np.uint8)))
            m = cv2.max(m, cv2.bitwise_and(changed_here, zone))
        # edges: drop border pixels that are identical to the base (background, skin)
        edge = cv2.subtract(m, cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))))
        m[(edge > 0) & (diff == 0)] = 0
        # Split into what the garment PAINTS (try-on body/garment pixels) and what it ERASES from
        # the base cutout (base body where the try-on shows backdrop, e.g. feet that moved).
        on_body = cv2.dilate(person, np.ones((3, 3), np.uint8)) > 0
        erase = ((m > 0) & ~on_body & (base_person > 0)).astype(np.uint8) * 255
        if slot in ('bottom', 'shoes'):
            # anywhere in the garment's area where the render shows backdrop but the base has
            # body (legs set wider apart, a gap between pant legs), remove the base body too
            rr, cc = np.where(m > 0)
            if len(rr):
                area = np.zeros_like(m)
                pad = int(w * 0.03)
                area[rr.min():rr.max() + 1, max(0, cc.min() - pad):cc.max() + pad] = 255
                gap = (area > 0) & (person == 0) & (base_person > 0)
                erase[gap] = 255
            # reach a few px under the garment's edge so no hairline of skin shows (the garment covers it)
            under = cv2.dilate(erase, np.ones((7, 7), np.uint8)) & (m > 0)
            erase[(under > 0) & (base_person > 0)] = 255
        paint = ((m > 0) & on_body).astype(np.uint8) * 255

        def save(mask, fname, rgb=True):
            alpha = cv2.GaussianBlur(mask, (5, 5), 0)
            if not (alpha > 8).any():
                return None
            x, y, bw, bh = cv2.boundingRect((alpha > 8).astype(np.uint8))
            col = img if rgb else np.zeros_like(img)
            Image.fromarray(np.dstack([col, alpha])[y:y + bh, x:x + bw]).save(os.path.join(OUT, fname), optimize=True)
            return {'src': f'/closet/{fname}', 'box': [round(x / w, 5), round(y / h, 5), round(bw / w, 5), round(bh / h, 5)]}

        layer = save(paint, f'{pid}.png')
        x, y = int(layer['box'][0] * w), int(layer['box'][1] * h)
        bw, bh = int(layer['box'][2] * w), int(layer['box'][3] * h)
        item = {'id': pid, 'slot': slot, 'name': name, 'url': url[0] if url else None,
                **layer, 'erase': save(erase, f'{pid}-erase.png', rgb=False), 'z': Z[slot]}
        closet['items'] = [i for i in closet['items'] if i['id'] != pid] + [item]
        print(f'  {slot:6} {pid}: box {x},{y} {bw}x{bh}')

    json.dump(closet, open(manifest_path, 'w'), indent=2)
    print('wrote', manifest_path)


if __name__ == '__main__':
    main()
