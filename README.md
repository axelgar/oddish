# Glitch · Oddish

Mobile web game. An NFC tag on a cocktail glass opens a URL, an egg hatches into a
procedurally generated creature, you name it and keep it. Implementation of
`Glitch Oddish — Hi-Fi.dc.html` (24 screens, six flows).

## Run

```
python3 -m http.server 8000     # any static server; ES modules need http, not file://
open http://localhost:8000
node test.mjs                   # genome / decay / rarity / nag-gate self-check
```

No build step, no package.json, no dependencies to install. d3 loads from a CDN via
the import map in `index.html`.

## Two deliberate departures from the handoff

**Raw WebGL, not three.js.** The handoff argues for three.js. It was overruled. The
geometry is one shader pair in `js/gl.js`: meshes generated from the genome seed, the
same hand-rolled rotation and perspective divide the software renderer used, now with
smooth vertex normals, a depth buffer and MSAA. d3 still does the parts that aren't
geometry — `quantize(interpolateLab(deep, body, hi))` shading ramps (uploaded as a
texture and read with a LINEAR fetch, so they no longer band), `d3.timer` for the frame
clock, `d3.line().curve(curveBasis)` for the leaf veins, easings.

The scene is three stacked canvases: world (2D) → creature (WebGL) → overlay (2D).
Only the geometry moved. The world, the face, garnishes, mud and particles are flat
painting and stayed flat painting — see `PLANS/ODDISH_WEBGL_RENDERER_V1.md`.

There is no 2D fallback, deliberately: a device without WebGL gets an honest message
rather than a second renderer nobody would test.

**Cute, per client direction.** The build originally shipped a deliberately creepy
creature pass; that was reversed for the client presentation. The creature now
follows the reference art (round bulb, leaf crown, glossy eyes, open smile):

- Big round ruby eyes with a soft window-light highlight that tracks the gaze;
  both eyes blink together, occasionally double-blinking
- A closed smile that opens into a happy "D" mouth (tongue at full beam), blush
  above 50 joy, no teeth, no roots
- Smooth round bodies — `lean`, `lump`, `grin` are still genome traits, turned
  down to gentle variance; stubby nub feet; one soft contact shadow
- The leaf crown fans in the screen plane like the reference; wilt from low joy /
  rest is capped so it droops but never flattens
- Motion is fully eased: pose changes glide (~0.35s), the wander is a hop-along
  walk with lean, lids and mouth tween, egg cracks are 3D polylines pinned to the
  shell surface so they rock and breathe with it
- The world keeps the GLITCH flavour — treeline, fog, watchers on dark fields, and
  the RGB split escaping the wordmark every 10–22 seconds, softened
- Palettes brightened, labels renamed (lagoon, pebble, plum, moss, clay, cream);
  palette KEYS are unchanged so stored creatures still resolve

## Files

| | |
|---|---|
| `index.html` | Stage, layers, import map |
| `css/app.css` | Handoff tokens verbatim for chrome; grain, vignette, fog |
| `js/state.js` | Genome, traits, meters, decay, fields, persistence. No d3, no DOM |
| `js/render.js` | The scene: meshes, world, face, garnishes, effects, the frame loop |
| `js/gl.js` | The geometry layer: one program, ramp textures, mesh upload, context loss |
| `js/screens.js` | All 24 screens |
| `js/app.js` | Router, glitch scheduler, synthesised audio, desktop clamp |
| `test.mjs` | The self-check |

## What the handoff asked for and got

- Decay computed on read, never ticked: `max(8, stored - floor(hours/24 * 14))`
- Genome is the generation seed — same string always makes the same creature
- Rarity decided on the *first* tap, not at completion; the tell is hold duration
- Release-early rewinds the hatch with no penalty
- Sheet detents at 148 / 492, cross-fade only between screens, never slide
- E2 never fires before the first creature is named, then at most weekly
- Every secondary text colour is exactly `rgba(34,64,58,.78)`
- `prefers-reduced-motion` holds a static pose, drops particles, shortens transitions
- Desktop clamps to 390px and scales; it never reflows

## Not built (needs a backend)

Marked in the source with `ponytail:` comments.

- **Hatch is client-authoritative.** `rollMaterial()` rolls rarity in the browser.
  Move to `POST /api/hatch/:eggId` — a double-scan must 409, not mint a second
  creature. The already-claimed path (F1) is wired and works off `claimedEggs`.
- **No guest cookie.** localStorage only, so a cookie wipe loses everything — which is
  exactly the risk E2 warns about, and E2 says so honestly.
- **Magic link is a stub.** `POST /api/auth/magic-link` + `/api/auth/claim`.
- **The photo QR is a block pattern.** Swap for a real encoder pointing at the venue
  menu before this ships — it is the acquisition loop.
- **Audio is synthesised**, not sampled: a detuned WebAudio drone, zero assets. Replace
  with per-field loops when they exist.
- **Fonts load from Google.** Self-host for a venue with bad wifi.
- **Collection creatures are cached sprites** that bob, not live meshes. Twelve live
  creatures is the one thing that will not hold on a phone.

## Open questions from the handoff, still open

Garnish drop rules, house creature, table-code social, Back Room members card,
Snowfield's time-box. Nothing in the data model blocks any of them.
