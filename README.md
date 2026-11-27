# dress-up

A fitting room that builds a 3D version of you from your tape measurements, so clothes you find online can eventually be tried on your own body.

```bash
npm install
npm run dev
```

## How the body is built (`src/body.js`)

- The body is made of lofted cross-sections: torso, head, legs, feet, arms and hands.
- Each girth you measured (bust, rib cage, waist, stomach, hip, thigh, calf, upper arm) is a **key section**. Its shape comes from typical female proportions. It is then scaled so its **convex-hull perimeter** equals your number. Convex hull is what a tape measure reads, because the tape bridges hollows like the gap between the breasts.
- The shape between key sections is filled in with monotone cubic (PCHIP) interpolation. That method can't overshoot, so measured points stay true maxima and minima.
- Lengths (height, inner and outer leg, torso, shoulder, arm) place the landmarks vertically.
- The panel shows ✓ when the generated mesh measures exactly your number. Weight is checked against the model's volume at body density.

Edit any number in the panel and the model rebuilds live. Values are saved in localStorage.
