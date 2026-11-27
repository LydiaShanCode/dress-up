#!/usr/bin/env bash
# Downloads the CC0 MakeHuman assets into assets-src/ (not committed), then run:
#   python3 scripts/build_human.py
set -euo pipefail
cd "$(dirname "$0")/../assets-src" 2>/dev/null || { mkdir -p "$(dirname "$0")/../assets-src"; cd "$(dirname "$0")/../assets-src"; }
R=https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data
B=https://download.tuxfamily.org/makehuman/assets/1.1/base
get() { mkdir -p "$(dirname "$2")"; curl -sfL "$1" -o "$2"; echo "  $2"; }
get $R/3dobjs/base.obj 3dobjs/base.obj
get $R/rigs/default_weights.mhw rigs/default_weights.mhw
get $R/targets/macrodetails/asian-female-young.target targets/macrodetails/asian-female-young.target
get $R/targets/macrodetails/universal-female-young-averagemuscle-minweight.target targets/macrodetails/universal-female-young-averagemuscle-minweight.target
get $R/targets/breast/female-young-averagemuscle-minweight-mincup-averagefirmness.target targets/breast/mincup.target
get $R/eyes/high-poly/high-poly.obj eyes/high-poly.obj
get $R/eyes/high-poly/high-poly.mhclo eyes/high-poly.mhclo
get $B/eyes/materials/brownlight_eye.png eyes/brownlight_eye.png
for f in ponytail01.mhclo ponytail01.obj ponytail01_diffuse.png; do get $B/hair/ponytail01/$f hair/$f; done
for f in eyebrow001.mhclo eyebrow001.obj eyebrow001.png; do get $B/eyebrows/eyebrow001/$f eyebrows/$f; done
for f in eyelashes01.mhclo eyelashes01.obj eyelashes01.png; do get $B/eyelashes/eyelashes01/$f eyelashes/$f; done
get $B/skins/textures/young_lightskinned_female_diffuse3.png skins/skin_diffuse.png
