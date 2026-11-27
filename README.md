# dress-up

A fitting room that builds a realistic 3D version of you from your tape measurements, so clothes you find online can eventually be tried on your own body.

```bash
npm install
npm run dev
```

## How the body is built (`src/human.js`)

1. **Real human mesh.** The base is the CC0 [MakeHuman](https://github.com/makehumancommunity/makehuman) mesh: 19k vertices with face, hands, feet and a rig. It is morphed with the young East-Asian female target, plus slim-weight and small-cup targets chosen from height and weight. It gets a skin texture, eyes, brows, lashes and a ponytail.
2. **Heights.** The mesh is scaled to your height. A smooth vertical remap then puts the crotch, natural waist, shoulder line and top of the head at your measured heights.
3. **Girths.** At each measured level the body is sliced. The slice's **convex-hull perimeter** is compared with your number, since convex hull is what a tape reads. Then that region (torso, each leg, each arm) is scaled about its own axis. The rig's skinning weights blend the regions so the joins stay seamless. Arms are also lengthened to your arm length, and the shoulders are widened or narrowed to your shoulder length. The whole loop repeats until every number converges.
4. **Hair, eyes, brows and lashes** are re-attached to the final surface through their `.mhclo` bindings.
5. **Base layer.** The sports bra and shorts are offset, smoothed copies of the skin. Their hems are cut in the shader so the edges stay clean.

The panel shows ✓ when the generated mesh measures exactly your number. Edit any value and the body refits live. Values are saved in localStorage.

## Assets

`public/human/` is generated from CC0 MakeHuman assets:

```bash
./scripts/fetch_assets.sh && python3 scripts/build_human.py
```

The skin texture is re-encoded as JPEG, and the hair and eye textures are downscaled.
