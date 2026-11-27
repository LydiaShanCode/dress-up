# Archived: 3D body

The interactive 3D version of the fitting room was archived on 2026-11-27, when the app moved to a 2D model photo.

It holds a CC0 MakeHuman mesh fitted to the measurements, with tape-accurate convex-hull slices, and a rotatable viewer.

- To run it as it was: `git checkout 3d-model-archive && npm install && npm run dev`, then open `/studio.html`.
- `?capture=1` on that page rendered the white-background proportion guide that was used to generate the 2D model photo.
- To rebuild the assets: `scripts/fetch_assets.sh`, then `python3 scripts/build_human.py`. Run these from that checkout.
