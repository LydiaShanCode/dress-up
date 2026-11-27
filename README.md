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
