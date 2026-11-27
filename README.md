# dress-up

A fitting room that builds a realistic 3D version of you from your tape measurements, so clothes you find online can eventually be tried on your own body.

```bash
npm install
npm run dev
```

## How it works

The main page (`index.html`, `src/look.js`) shows a studio photo of you as the model, wearing a black sports bra and shorts. It was generated with an image model from two inputs:
- a proportion guide rendered from the measurement-fitted 3D body
- a reference frame from your video

Generated photos live in `public/looks/` and are git-ignored, because this repo is public.

The 3D body is archived in [`archive/3d-model`](archive/3d-model/README.md) and under the git tag `3d-model-archive`.

## Closet: reusable garment layers

Your base photo never changes. Each garment is a transparent layer, positioned in base-photo coordinates, so mixing tops, bottoms and shoes happens in the browser with no AI credits.

A garment costs AI credits only once:

1. **Try it on once.** Run an image-model try-on on the base photo ("keep her exactly the same, replace X with this garment"). That's about 10 Weave credits.
2. **Cut out the layer, free and local:**
   ```bash
   python3 -m venv .venv && .venv/bin/pip install opencv-python-headless numpy pillow onnxruntime rembg
   .venv/bin/python scripts/extract_garments.py --base captures/look-v1.png --tryon <tryon.png> \
     --piece "top:<id>:<name>:<product url>"     # slots: top | bottom | shoes
   ```
   The script:
   - aligns the try-on to the base photo by the head
   - segments the clothing with `u2net_cloth_seg` and the person with `u2net_human_seg`
   - adds a "cover patch" that hides base-body pixels the garment moved, like feet or arms
   - writes `public/closet/<id>.png` and adds it to `public/closet/closet.json`

One try-on can produce several pieces; give it one `--piece` per slot.

Layers stack bottom → shoes → top. Generated images are git-ignored, because this repo is public.
