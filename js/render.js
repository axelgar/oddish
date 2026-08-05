// The scene, in three layers.
//
//   world canvas (2D)  →  creature canvas (WebGL)  →  overlay canvas (2D)
//
// Meshes are still generated from the genome seed; js/gl.js draws them with smooth
// vertex normals, a depth buffer and MSAA. Everything that was never geometry —
// the world, the face, garnishes, mud, particles — is still 2D painting, above or
// below the creature depending on which side of it belongs.
//
// d3 does the maths that isn't geometry: interpolateLab shading ramps (now uploaded
// as a texture), easings, curves for the veins, and the frame clock.

import {
  interpolateLab, quantize, easeCubicOut, easeBackOut, easeSinInOut,
  timer, line as d3line, curveBasis, range,
} from 'd3';

import * as GL from './gl.js';
import { PALETTES, fieldById, BERRIES, session, hashStr } from './state.js';

export const W = 390, H = 844;
const FOCAL = 520;
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const MQ_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
/** OS preference OR the in-app toggle in E4 — the toggle has to actually do it. */
const reduced = () => MQ_REDUCED.matches || session.reduceMotion;

/* -------------------------------------------------------------- scene ----- */

export const scene = {
  mode: 'none',              // none | egg | creature | collection
  field: 'meadow',
  groundTop: 404,
  props: true,
  creature: null,            // creature record (with .traits)
  pose: { x: 195, y: 676, scale: 0.94 },        // where it IS (eased every frame)
  poseTarget: { x: 195, y: 676, scale: 0.94 },  // where it's heading
  others: [],                // [{creature, x, y, scale}]
  spin: 0, spinVel: 0,
  look: { x: 0, y: 0 },
  hold: 0,                   // 0..1 hatch progress
  crackStage: 0,
  decay: 0,                  // 0..1 world desaturation
  mud: [],
  mouth: 0,                  // TARGET openness, 0 closed .. 1 wide
  eyeLid: 1,                 // TARGET, 1 open .. 0 shut
  _mouth: 0, _eyeLid: 1,     // eased values the face actually draws
  _hop: 0, _lean: 0,         // walk-cycle bounce + lean, computed in loop
  wander: false,
  glitchUntil: 0,
  squashUntil: 0, squashAmp: 0.35, squashDur: 0.9,
  shakeUntil: 0,
  wiggleUntil: 0,            // happy wobble (scrubs, catches)
  chewUntil: 0,              // mouth pulses while > T
  bathing: false,            // bathe screen: show the full mud set to scrub
  hidden: false,
  fx: [],
};

// `ctx` is whichever 2D target the current pass is painting into: the world layer,
// the overlay layer, or a sprite/portrait bitmap.
let ctx, wctx, fctx, glcv, hasGL = false, clock = null, t0 = performance.now() / 1000, T = 0;
let worldCache = null, worldKey = '';
const spriteCache = new Map();

function layer(canvas) {
  canvas.width = W * DPR; canvas.height = H * DPR;
  const c = canvas.getContext('2d');
  c.scale(DPR, DPR);
  return c;
}

/** Returns false when the device has no WebGL. There is no second renderer to fall
 *  back to — the caller says so honestly and nothing else runs. */
export function mount(world, creature, overlay) {
  wctx = layer(world);
  fctx = layer(overlay);
  glcv = creature;
  hasGL = GL.init(glcv, W, H, DPR, {
    // Backgrounded on a phone, the GPU takes the context away. Stop, and leave the
    // world standing on its own — no face floating over an empty body, no shadow
    // pooled under nothing. Every pixel is derived, so there is nothing to save.
    onLost: () => {
      clock?.stop(); clock = null;
      fctx.clearRect(0, 0, W, H);
      ctx = wctx; wctx.clearRect(0, 0, W, H);
      if (!scene.hidden) drawWorld(); else drawFlat();
    },
    onRestored: () => { meshCache.clear(); spriteCache.clear(); bakeTries.clear(); clock ??= timer(loop); },
  });
  if (!hasGL) return false;
  clock = timer(loop);
  return true;
}

// drawWorld re-derives its cache key from the scene every frame, so a plain
// assign is enough — no invalidation bookkeeping needed here.
// A `pose` patch sets the TARGET: the creature glides there over ~a third of a
// second, which is what makes screen-to-screen feel continuous instead of snappy.
// It snaps only when the subject changes (mode switch, or coming back from hidden).
export function set(patch) {
  const wasHidden = scene.hidden, prevMode = scene.mode;
  const { pose, ...rest } = patch;
  Object.assign(scene, rest);
  if (rest.field) {
    // tint the page surround to match the field — on phones the letterbox strips
    // around the stage read as atmosphere instead of a black gap (see app.css)
    const f = fieldById(rest.field), st = document.documentElement.style;
    st.setProperty('--bleed-sky', f.sky[0]);
    st.setProperty('--bleed-grass', f.ground[0]);
    st.setProperty('--bleed-soil', f.ground[2]);
  }
  if (pose) {
    scene.poseTarget = { ...pose };
    const snap = (patch.mode !== undefined && patch.mode !== prevMode) || wasHidden || patch.hidden;
    if (snap) scene.pose = { ...pose };
  }
}

export function glitch(ms = 130) { scene.glitchUntil = T + ms / 1000; }
export function squash(amp = 0.35, dur = 0.9) { scene.squashAmp = amp; scene.squashDur = dur; scene.squashUntil = T + dur; }
export function shakeHead() { scene.shakeUntil = T + 0.6; }
export function wiggle(sec = 0.5) { scene.wiggleUntil = T + sec; }
export function chew(sec = 0.9) { scene.chewUntil = T + sec; }

const bodyCentreY = () => scene.pose.y - 128 * scene.pose.scale;

export function emit(type, n = 12, opts = {}) {
  const { x = scene.pose.x, y = bodyCentreY(), spread = 60, up = 1 } = opts;
  for (let i = 0; i < n; i++) {
    scene.fx.push({
      type, x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread * 0.6,
      vx: (Math.random() - 0.5) * 70, vy: -Math.random() * 120 * up - 20,
      life: 0.7 + Math.random() * 0.9, age: 0, r: 2 + Math.random() * 4,
    });
  }
}

/** Is (px,py) — stage coords — on the creature? Generous: a bounding sphere, per spec. */
export function hitCreature(px, py) {
  const { x, scale } = scene.pose;
  const r = 105 * scale;
  const cy = bodyCentreY();
  return (px - x) ** 2 / (r * r) + (py - cy) ** 2 / ((r * 1.25) ** 2) < 1;
}

export function look(px, py) {
  scene.look.x = Math.max(-1, Math.min(1, (px - scene.pose.x) / 150));
  scene.look.y = Math.max(-1, Math.min(1, (py - bodyCentreY()) / 150));
}

/* --------------------------------------------------------------- noise ---- */

function h3(x, y, z, s) {
  let h = (s ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const sm = (t) => t * t * (3 - 2 * t);
function noise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => h3(xi + i, yi + j, zi + k, s);
  return L(
    L(L(c(0,0,0), c(1,0,0), xf), L(c(0,1,0), c(1,1,0), xf), yf),
    L(L(c(0,0,1), c(1,0,1), xf), L(c(0,1,1), c(1,1,1), xf), yf), zf) * 2 - 1;
}

/* ---------------------------------------------------------------- mesh ---- */

const SEG = 26, RING = 18;

const BODY_SHAPE = {
  round:    [1.00, 0.94, 1.00],
  swollen:  [1.10, 0.84, 1.10],
  tall:     [0.90, 1.14, 0.90],
  lopsided: [1.04, 0.96, 0.98],
};

function bodyMesh(tr, seed, seg = SEG, ring = RING) {
  const [sx, sy, sz] = BODY_SHAPE[tr.bodyShape] || BODY_SHAPE.round;
  const verts = [], quads = [];
  for (let j = 0; j <= ring; j++) {
    const phi = (j / ring) * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      let nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
      // a whisper of organic variance — the silhouette must stay round and huggable
      let r = 1 + tr.lump * 0.028 * noise3(nx * 2.1 + 4, ny * 2.1, nz * 2.1, seed);
      r += tr.lump * 0.010 * noise3(nx * 4.6, ny * 4.6 + 9, nz * 4.6, seed ^ 77);
      if (ny < 0) r *= 1 + 0.05 * -ny;                 // gently bottom-heavy, like a plum
      if (tr.bodyShape === 'lopsided') r *= 1 + 0.045 * nx;
      verts.push({ x: nx * r * sx + tr.lean * 0.55 * ny, y: ny * r * sy, z: nz * r * sz });
    }
  }
  const idx = (i, j) => j * (seg + 1) + i;
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++)
    quads.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)]);
  return { verts, quads };
}

// The bulb stands on a leg + foot per side. Three rules hold the assembly together:
// the lowest vertex stays at y = -1.34, because the contact shadow is pinned to it;
// the leg's open ends are buried, top inside the bulb and bottom inside the foot, so
// neither reads as a hole; and the ankle sits low with a flat pad, which is what buys
// the leg its visible length — a `tall` bulb hangs to about y = -1.0 at the hip, and
// anything higher swallows the leg whole and we are back to nubs.
const ANKLE = -1.26, LEG_X = 0.48, LEG_Z = 0.10;
// bodyMesh shears the bulb by `lean * 0.55 * ny`; this is that shear at the hip, so
// the legs stay under the belly instead of drifting out from beneath it.
const legLean = (tr) => -tr.lean * 0.48;

/** A very short tapered post from under the bulb down to the ankle. Short — the bulb
 *  still nearly rests on the ground, per the reference — but long enough that the
 *  feet are visibly attached rather than nubs lying beside it. How much shows depends
 *  on how low the bulb hangs, so a `tall` body genuinely stands on stubbier legs. */
function legMesh(side, tr) {
  const verts = [], quads = [], seg = 10, ring = 5;
  const top = -0.62;                                   // well inside the bulb
  for (let j = 0; j <= ring; j++) {
    const t = j / ring;
    const y = top + (ANKLE - top) * t;
    const r = 0.150 - 0.028 * t;                       // tapers a little toward the ankle
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      verts.push({
        x: Math.cos(th) * r + side * LEG_X + legLean(tr),
        y,
        z: Math.sin(th) * r * 0.92 + LEG_Z,
      });
    }
  }
  const idx = (i, j) => j * (seg + 1) + i;
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++)
    quads.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)]);
  return { verts, quads };
}

/** A flat splayed pad, toes turned out and forward — a foot, not a boot. It swallows
 *  the bottom of the leg, and its underside is the creature's ground contact. */
function footMesh(side, tr) {
  const verts = [], quads = [], seg = 10, ring = 6;
  const toe = side * 0.36;                             // splay about Y, toes outward
  const ct = Math.cos(toe), st = Math.sin(toe);
  for (let j = 0; j <= ring; j++) {
    const phi = (j / ring) * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
      const px = nx * 0.25, pz = nz * 0.34 + 0.16;     // longer than it is wide
      verts.push({
        x: px * ct + pz * st + side * LEG_X + legLean(tr),
        y: ny * 0.08 - 1.26,                           // lowest vertex = -1.34, as always
        z: -px * st + pz * ct + LEG_Z,
      });
    }
  }
  const idx = (i, j) => j * (seg + 1) + i;
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++)
    quads.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)]);
  return { verts, quads };
}

/** A frond: bezier spine, sine width profile, folded along the midrib.
 *  The bouquet fans IN THE SCREEN PLANE (a roll about Z) with only a little yaw for
 *  depth — fanning by yaw alone reads as two clumped leaves from the front. */
function leafMesh(k, n, tr, seed, droop) {
  const along = 9, across = 6;
  const spread = (k - (n - 1) / 2) / Math.max(1, n - 1);
  const roll = -spread * 1.30 + tr.lean * 0.25;            // tips fan outward on screen (±~37°)
  const yaw = spread * 0.70;                               // slight depth so it's a crown, not a card
  // mostly upright — negative pitch leans tips away from camera, so keep it shallow
  // or the whole bouquet hides behind the head
  const pitch = -0.28 + Math.abs(spread) * 0.06 + droop * 0.38;
  // The crown carries the silhouette, so it is big — clearly taller than the bulb.
  // Long and comparatively narrow: widening a leaf as much as you lengthen it makes
  // the bouquet read squat however tall it actually is. The fan is tighter than it
  // was for the same reason the leaves aren't fatter — on a 390px stage the outer
  // tips leave the screen long before the height stops being useful. The C3 portrait
  // pose was pulled back to match; a bigger crown does not fit the old framing.
  const L = 3.00 + noise3(k * 3, 1, 1, seed) * 0.42;
  const halfW = 0.55 + noise3(k * 3, 5, 2, seed) * 0.08;
  // Fronds sprout from a ring, not a line: neighbours alternate fore and aft. The fan
  // itself is a roll in the screen plane, so without this the whole bouquet lies in
  // one plane and a quarter-turn flattens it to a card.
  const anchor = { x: spread * 0.16, y: 0.76, z: -0.10 + (k % 2 ? 0.21 : -0.21) };

  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const verts = [], quads = [];
  for (let a = 0; a <= along; a++) {
    const t = a / along;
    // spine arc: rises, then eases outward toward the tip
    const sy = t * L, sz = -0.26 * t * t - droop * 0.50 * t * t * t;
    const w = Math.sin(Math.PI * Math.pow(t, 0.85)) * halfW;
    for (let b = 0; b <= across; b++) {
      const v = (b / across) * 2 - 1;
      // smooth edges with only a breath of waviness — no bites
      const bite = 1 - 0.08 * Math.max(0, noise3(t * 7, v * 3, k * 11, seed ^ 31));
      const wx = v * w * bite;
      const fold = -Math.abs(v) * Math.abs(v) * w * 0.45;   // catches the key light
      const X = wx, Y = sy, Z = sz + fold;
      const y2 = Y * cp - Z * sp, z2 = Y * sp + Z * cp;         // pitch about X
      const x3 = X * cr - y2 * sr, y3 = X * sr + y2 * cr;       // roll about Z — the fan
      const x4 = x3 * cyw + z2 * syw, z4 = -x3 * syw + z2 * cyw; // yaw about Y — the depth
      verts.push({ x: x4 + anchor.x, y: y3 + anchor.y, z: z4 + anchor.z });
    }
  }
  const idx = (a, b) => a * (across + 1) + b;
  for (let a = 0; a < along; a++) for (let b = 0; b < across; b++)
    quads.push([idx(a, b), idx(a + 1, b), idx(a + 1, b + 1), idx(a, b + 1)]);
  // the midrib, kept as vertices — the veins are drawn on the overlay layer and
  // project these directly
  const spine = range(along + 1).map((a) => verts[idx(a, Math.floor(across / 2))]);
  return { verts, quads, spine };
}

function eggMesh(seed) {
  const verts = [], quads = [], seg = 16, ring = 12;
  for (let j = 0; j <= ring; j++) {
    const phi = (j / ring) * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
      const taper = 1 - 0.19 * Math.max(0, ny);
      const r = 1 + 0.018 * noise3(nx * 5, ny * 5, nz * 5, seed);
      verts.push({ x: nx * r * taper, y: ny * r * 1.26, z: nz * r * taper });
    }
  }
  const idx = (i, j) => j * (seg + 1) + i;
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++)
    quads.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)]);
  return { verts, quads };
}

/* ------------------------------------------------------------ materials --- */

function norm(x, y, z) { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; }
const dir = (x, y, z) => { const n = norm(x, y, z); return new Float32Array([n.x, n.y, n.z]); };
const KEY = dir(-0.55, 0.70, 0.62);    // warm, upper-left
const FILL = dir(0.62, -0.36, 0.50);   // cool, lower-right

const MAT_SKIN = {
  gold:    { deep: '#2E1D04', body: '#C79B3C', hi: '#FFF3C6', rim: '#FFF0BD', gloss: 0.85 },
  crystal: { deep: '#0B2530', body: '#7FB6C4', hi: '#EBFCFF', rim: '#DFFAFF', gloss: 0.95 },
  neon:    { deep: '#04180F', body: '#3C9A70', hi: '#8CFFCB', rim: '#5BFFC0', gloss: 0.70 },
  foil:    { deep: '#1B1E22', body: '#8A8F96', hi: '#F2F6F9', rim: '#E9EEF2', gloss: 0.80 },
};

/** deep → body → hi, as GL.RAMP_N RGB triples. Same interpolateLab walk the software
 *  renderer used, so the colours are unchanged; the fragment shader reads it with a
 *  LINEAR fetch, which is what turns the old 96-step banding into a gradient. */
function rampBytes(deep, body, hi) {
  const n = GL.RAMP_N;
  const lo = quantize(interpolateLab(deep, body), Math.round(n * 0.62));
  const up = quantize(interpolateLab(body, hi), n - lo.length + 1).slice(1);
  const list = lo.concat(up);
  const b = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const m = list[i].match(/\d+/g);
    b[i * 3] = +m[0]; b[i * 3 + 1] = +m[1]; b[i * 3 + 2] = +m[2];
  }
  return b;
}

/** GL caches by key and empties on context loss, so ask every frame — never hold it. */
const ramp = (deep, body, hi) =>
  GL.ramp(deep + body + hi, () => rampBytes(deep, body, hi));

function skinOf(c) {
  const pal = PALETTES[c.traits.palette] || PALETTES.bile;
  const m = MAT_SKIN[c.material];
  return {
    body: m ? ramp(m.deep, m.body, m.hi) : ramp(pal.deep, pal.body, pal.hi),
    leaf: ramp(pal.leafdeep, pal.leaf, pal.leafhi),
    rim: m ? m.rim : '#9FD8B4',
    gloss: m ? m.gloss : 0.34,
    pal, mat: m,
  };
}

/* ------------------------------------------------------------- transform -- */

/** Meshes join into one buffer per material so the whole creature is three draws. */
function merge(list) {
  const verts = [], quads = [];
  for (const m of list) {
    const o = verts.length;
    for (const v of m.verts) verts.push(v);
    for (const q of m.quads) quads.push([q[0] + o, q[1] + o, q[2] + o, q[3] + o]);
  }
  return { verts, quads };
}

/* ------------------------------------------------------------- creature --- */

const meshCache = new Map();
function meshesFor(c, droop, lod = 1) {
  const key = `${c.genomeSeed}|${Math.round(droop * 6)}|${lod}`;
  if (meshCache.has(key)) return meshCache.get(key);
  // the genome drives the noise too — two creatures with equal trait rolls
  // must still lump, lean and get bitten differently
  const seed = hashStr(c.genomeSeed) | 0;
  const tr = c.traits;
  const leaves = range(tr.fronds).map((k) => leafMesh(k, tr.fronds, tr, seed, droop));
  const m = {
    key,
    body: bodyMesh(tr, seed, lod === 1 ? SEG : 10, lod === 1 ? RING : 7),
    feet: merge([legMesh(-1, tr), footMesh(-1, tr), legMesh(1, tr), footMesh(1, tr)]),
    leaves,                      // kept apart for the veins, which project the midribs
    crown: merge(leaves),
  };
  if (meshCache.size > 40) meshCache.clear();
  meshCache.set(key, m);
  return m;
}

/** Surface anchor from a direction — used to sit eyes, mouth and mud ON the body. */
function anchor(dx, dy, dz, tr) {
  const n = norm(dx, dy, dz);
  const [sx, sy] = BODY_SHAPE[tr.bodyShape] || BODY_SHAPE.round;
  return { x: n.x * sx, y: n.y * sy, z: n.z * sx, n };
}

function project1(p, yaw, pitch, sx, sy, R, ox, oy) {
  const cy = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x0 = p.x * sx, y0 = p.y * sy, z0 = p.z * sx;
  const x1 = x0 * cy + z0 * s, z1 = -x0 * s + z0 * cy;
  const y2 = y0 * cp - z1 * sp, z2 = y0 * sp + z1 * cp;
  const k = FOCAL / (FOCAL - z2 * R);
  return { X: ox + x1 * R * k, Y: oy - y2 * R * k, z: z2, k };
}

function faceDir(p, yaw, pitch) {
  const cy = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = p.n.x * cy + p.n.z * s, z1 = -p.n.x * s + p.n.z * cy;
  const y2 = p.n.y * cp - z1 * sp, z2 = p.n.y * sp + z1 * cp;
  return { x: x1, y: y2, z: z2 };
}

/** The body's tangent frame at a surface direction, projected: a 2×2 Jacobian plus
 *  the anchor's screen point and facing.
 *
 *  Painting a flat shape through this matrix puts the shape ON the body. It
 *  foreshortens, shears and rolls with the mesh at every yaw instead of sliding
 *  across it as an upright screen-space ellipse — which is what made the eyes and
 *  mouth detach from the bulb on a drag-spin. Both columns are normalised by the
 *  body's own scale at that point, so a decal dead-centre on the front of the bulb is
 *  drawn at its nominal px size. Anywhere else it is already foreshortened — at rest
 *  the eye anchors sit at ~0.90 and the blush at ~0.73 — which is correct, not a bug,
 *  but it does mean the px sizes below read as "at most this wide", not "this wide".
 *
 *  Column 1 is surface-right, column 2 is surface-DOWN — so callers keep drawing in
 *  ordinary y-down canvas coordinates. */
function decal(dx, dy, dz, tr, cam) {
  const { yaw, pitch, sx, sy, R, ox, oy } = cam;
  const n = norm(dx, dy, dz);
  // tangent directions on the unit sphere. Degenerate only at the poles, and nothing
  // that uses this — face, blush, mud — goes anywhere near them.
  const u = norm(n.z, 0, -n.x);
  const v = { x: n.y * u.z - n.z * u.y, y: n.z * u.x - n.x * u.z, z: n.x * u.y - n.y * u.x };
  const e = 0.04;
  // stepping through anchor() keeps all three samples exactly on the body surface
  const at = (a, b, c) => project1(anchor(a, b, c, tr), yaw, pitch, sx, sy, R, ox, oy);
  const P = at(n.x, n.y, n.z);
  const Pu = at(n.x + e * u.x, n.y + e * u.y, n.z + e * u.z);
  const Pd = at(n.x - e * v.x, n.y - e * v.y, n.z - e * v.z);
  const [bx, by] = BODY_SHAPE[tr.bodyShape] || BODY_SHAPE.round;
  const g = e * R * P.k;
  const m = [(Pu.X - P.X) / (g * bx), (Pu.Y - P.Y) / (g * bx),
             (Pd.X - P.X) / (g * by), (Pd.Y - P.Y) / (g * by)];
  // Past the PERSPECTIVE limb the two tangent samples straddle the silhouette and the
  // frame folds back on itself: det < 0 means the decal is mirrored. For the mouth
  // that is literally a frown — the lower lip bows above the corners. Callers cull on
  // it, so the smile is pinned to the geometry rather than to whatever pose scale the
  // screens happen to use. The `z` culls alone can't do this: they are constants, but
  // the limb moves with R / FOCAL.
  return {
    X: P.X, Y: P.Y, z: faceDir({ n }, yaw, pitch).z, m,
    det: m[0] * m[3] - m[1] * m[2],
  };
}

/** Enter a decal's surface frame. Everything drawn until restore() is painted on the
 *  body, in px, with the origin at the anchor. */
function onSurface(d) {
  ctx.save();
  ctx.transform(d.m[0], d.m[1], d.m[2], d.m[3], d.X, d.Y);
}

const veinLine = d3line().curve(curveBasis).x((d) => d.X).y((d) => d.Y);

/** Everything the three passes share: where the creature is, how it is lit, and which
 *  meshes it is made of. Computed once a frame, then handed to under / geom / over. */
function creatureState(c, pose, opts = {}) {
  const skin = skinOf(c);
  const met = opts.meters || c.meters || { hunger: 70, clean: 70, joy: 70, rest: 70 };
  const sick = opts.sick ?? (1 - Math.min(met.hunger, met.joy) / 100) * 0.5;
  // wilt is readable but never a pancake — leaves stay a bouquet even at rock bottom
  const droop = Math.min(0.6, 0.10 + (1 - met.joy / 100) * 0.34 + (1 - met.rest / 100) * 0.16);

  const t = T;
  const idle = reduced() ? 0 : 1;
  const breathe = 1 + 0.022 * Math.sin(t * Math.PI * 2 * 0.4) * idle;
  // squash-pop: an offset that decays amp → 0 and ends continuous at 0
  const squashT = scene.squashUntil > t ? 1 - (scene.squashUntil - t) / scene.squashDur : -1;
  const pop = squashT >= 0 ? scene.squashAmp * (1 - easeBackOut(squashT)) : 0;

  let yaw = scene.spin + (idle ? 0.08 * Math.sin(t * 0.31) : 0) + scene.look.x * 0.30 + scene._lean;
  if (scene.shakeUntil > t) yaw += Math.sin(t * 26) * 0.22;          // a clear, soft "no"
  if (scene.wiggleUntil > t) yaw += Math.sin(t * 15) * 0.08;         // a pleased wobble

  const pitch = -0.10 + scene.look.y * 0.16;
  const R = 92 * pose.scale;
  const ox = pose.x;
  // 1.39 = lowest vertex in the mesh (foot underside). Put it exactly on pose.y,
  // or the contact shadow floats above the feet and the whole thing looks pasted on.
  const hop = scene._hop * idle;
  const oy = pose.y - 1.39 * R - hop + (idle ? Math.sin(t * 0.4 * Math.PI * 2) * 2.0 : 0);
  const sx = (1 + pop) / breathe;           // wider while squashed, volume roughly kept
  const sy = breathe * (1 - pop * 0.8);

  const cam = { yaw, pitch, sx, sy, R, ox, oy, focal: FOCAL, roll: 0 };
  return { c, pose, skin, met, sick, cam, hop, m: meshesFor(c, droop, opts.lod || 1) };
}

/** Under the body, on the world layer: the contact pool and anything worn behind. */
function creatureUnder(st) {
  const { pose, cam, hop } = st;
  // One soft contact pool, centred under it. It shrinks and fades while airborne
  // mid-hop, which is what sells the hop as leaving the ground.
  const pool = (cx, cyy, rx, ry, alpha) => {
    ctx.save();
    ctx.translate(cx, cyy); ctx.scale(1, ry / rx); ctx.translate(-cx, -cyy);
    const g = ctx.createRadialGradient(cx, cyy, 1, cx, cyy, rx);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(0.6, `rgba(0,0,0,${alpha * 0.35})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cyy, rx, 0, 7); ctx.fill();
    ctx.restore();
  };
  const S0 = pose.scale;
  const air = Math.min(0.4, hop / (26 * S0));
  pool(cam.ox, pose.y - 2 * S0, 84 * S0 * (1 - air * 0.5), 15 * S0, 0.42 * (1 - air));
  drawGarnishBack(st.c, cam);                 // behind the body — the body covers it
}

/** The creature itself: body, feet, crown. Three draws, depth-buffered. */
function creatureGeom(st) {
  const { skin, sick, cam, m } = st;
  GL.draw(GL.mesh(`${m.key}|body`, () => m.body), cam,
    { ramp: skin.body, gloss: skin.gloss, sick, key: KEY, fill: FILL });
  GL.draw(GL.mesh(`${m.key}|feet`, () => m.feet), cam,
    { ramp: skin.body, gloss: skin.gloss * 0.6, sick, key: KEY, fill: FILL });
  GL.draw(GL.mesh(`${m.key}|crown`, () => m.crown), cam,
    { ramp: skin.leaf, gloss: 0.22, sick, key: KEY, fill: FILL });
}

/** Over the body, on the overlay layer: veins, face, mud, garnishes, rarity bloom. */
function creatureOver(st) {
  const { c, pose, skin, met, sick, cam, m } = st;
  const { yaw, pitch, sx, sy, R, ox, oy } = cam;

  // veins — d3 curve through the projected midrib
  ctx.save();
  ctx.strokeStyle = `rgba(12,26,14,${0.34 + sick * 0.2})`;
  ctx.lineWidth = 1.1 * pose.scale;
  ctx.lineCap = 'round';
  for (const lf of m.leaves) {
    // skip the first third — that part of the spine is inside the head
    const pts = lf.spine.slice(3).map((v) => project1(v, yaw, pitch, sx, sy, R, ox, oy));
    if (pts.length < 3) continue;
    ctx.beginPath(); veinLine.context(ctx)(pts); ctx.stroke();
  }
  ctx.restore();

  drawFace(c, cam, met, sick);
  drawMud(c, cam, met);
  drawGarnish(c, cam);

  // rare materials get a bloom the commons never do — the absence is the signal
  if (skin.mat) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createRadialGradient(ox, oy, 10, ox, oy, 140 * pose.scale);
    rg.addColorStop(0, 'rgba(255,255,255,.13)');
    rg.addColorStop(0.5, 'rgba(255,255,255,.05)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(ox, oy, 140 * pose.scale, 0, 7); ctx.fill();
    ctx.restore();
  }
}

// trait → eye size. Legacy keys (slit, pinhole, too many) still map so creatures
// hatched before the rename keep drawing.
const EYE_SCALE = {
  button: 0.85, round: 1.0, wide: 1.14, sparkly: 1.06,
  slit: 0.95, pinhole: 0.82, 'too many': 1.0,
};

function drawFace(c, cam, met, sick) {
  const tr = c.traits;
  const t = T;
  const S = cam.R / 92;

  // eyes — big round ruby buttons with a soft window-light in them ----------
  const spread = 0.34, up = 0.10;
  const eyes = [
    [-spread, up, 0.90],
    [spread, up + tr.lean * 0.1, 0.90],
  ];

  // one shared blink so they close together — staggered blinking reads wrong on
  // a friendly face. Occasionally it double-blinks, which reads curious.
  const per = 4.4;
  const ph = (t % per) / per;
  const dip = (p0, w) => (ph > p0 && ph < p0 + w) ? Math.abs(Math.cos(((ph - p0) / w) * Math.PI)) : 1;
  let bl = dip(0, 0.045);
  if (noise3(Math.floor(t / per), 5, 5, 9) > 0.45) bl = Math.min(bl, dip(0.085, 0.045));

  const restLid = 0.66 + (met.rest / 100) * 0.34;      // sleepy = heavy lids, still cute
  const es = EYE_SCALE[tr.eyeType] || 1;

  eyes.forEach((e) => {
    const d = decal(...e, tr, cam);
    if (d.z < 0.16 || d.det <= 0) return;      // det <= 0 → mirrored; a shut eye would arc the wrong way
    // the frame does the foreshortening now; this is only a clean dissolve at the rim
    const fade = Math.min(1, (d.z - 0.16) / 0.25);
    const lid = Math.max(0.05, Math.min(1, restLid * bl * scene._eyeLid));
    const rx = 11.6 * S * es, ry0 = 14.6 * S * es;
    const ry = ry0 * lid;

    onSurface(d);
    ctx.globalAlpha = fade;
    if (lid < 0.22) {
      // shut: a happy little arc, not a slot
      ctx.strokeStyle = 'rgba(40,30,36,.85)';
      ctx.lineWidth = 2.6 * S; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-rx * 0.9, 0); ctx.quadraticCurveTo(0, ry0 * 0.5, rx * 0.9, 0);
      ctx.stroke();
    } else {
      const ig = ctx.createRadialGradient(-rx * .30, -ry * .30, 1, 0, 0, rx * 1.2);
      ig.addColorStop(0, '#EF6068'); ig.addColorStop(.55, '#CE3644'); ig.addColorStop(1, '#9E1F2E');
      ctx.fillStyle = ig;
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, 7); ctx.fill();
      // the highlight follows the gaze a touch, so it feels like it's looking with you
      const hx = -rx * 0.30 + scene.look.x * rx * 0.14;
      const hy = -ry * 0.32 + scene.look.y * ry * 0.12;
      ctx.fillStyle = 'rgba(255,252,248,.95)';
      ctx.beginPath(); ctx.ellipse(hx, hy, rx * 0.32, ry * 0.28, -0.3, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,252,248,.6)';
      ctx.beginPath(); ctx.arc(rx * 0.26, ry * 0.22, rx * 0.11, 0, 7); ctx.fill();
    }
    ctx.restore();
  });

  // blush — only when it's genuinely happy
  if (met.joy > 50) {
    for (const s of [-1, 1]) {
      const d = decal(s * 0.56, -0.12, 0.78, tr, cam);
      if (d.z < 0.10 || d.det <= 0) continue;
      onSurface(d);
      ctx.fillStyle = `rgba(242,134,126,${0.22 * Math.min(1, (d.z - 0.10) / 0.2) * ((met.joy - 50) / 50)})`;
      ctx.beginPath(); ctx.ellipse(0, 0, 7.5 * S, 4.8 * S, 0, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  // mouth — a closed smile that opens into a happy "D" like the reference art -
  const md = decal(0, -0.24, 0.94, tr, cam);
  if (md.z > 0.14 && md.det > 0) {           // det <= 0 mirrors the frame, which inverts the smile
    const open = Math.max(scene._mouth,
      reduced() ? 0.16 : 0.16 + 0.05 * Math.sin(t * 0.9) + (met.joy > 60 ? 0.10 : 0));
    const wide = 24 * S * tr.grin;
    // INVARIANT: it is always smiling. Both paths below hang their corners above a
    // bulge that curves down, which only reads as a smile while the mouth stays wider
    // than it is deep — so a narrow grin caps how far it can open, and a wide-open
    // mouth on a small grin becomes a broad "D" instead of a vertical slot.
    const tall = Math.min((6 + open * 30) * S, wide * 1.15);

    onSurface(md);
    ctx.globalAlpha = Math.min(1, (md.z - 0.14) / 0.3);   // dissolve at the rim, like the eyes
    if (open < 0.2) {
      ctx.strokeStyle = 'rgba(40,30,36,.85)';
      ctx.lineWidth = 2.4 * S; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-wide * 0.8, -tall * 0.1);
      ctx.quadraticCurveTo(0, tall * 0.9, wide * 0.8, -tall * 0.1);
      ctx.stroke();
    } else {
      // corners sit above the bottom bulge → it always reads as a smile
      ctx.beginPath();
      ctx.moveTo(-wide, -tall * 0.25);
      ctx.quadraticCurveTo(0, tall * 0.02, wide, -tall * 0.25);
      ctx.quadraticCurveTo(0, tall * 1.25, -wide, -tall * 0.25);
      ctx.closePath();
      const mg = ctx.createLinearGradient(0, -tall * 0.3, 0, tall);
      mg.addColorStop(0, '#8E3A46'); mg.addColorStop(1, '#54202C');
      ctx.fillStyle = mg; ctx.fill();
      ctx.strokeStyle = 'rgba(46,24,30,.55)'; ctx.lineWidth = 1.3 * S; ctx.stroke();
      if (open > 0.45) {                         // a tongue when it's really beaming
        ctx.save(); ctx.clip();
        ctx.fillStyle = '#C96A70';
        ctx.beginPath(); ctx.ellipse(0, tall * 0.78, wide * 0.5, tall * 0.42, 0, 0, 7); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

function drawMud(c, cam, met) {
  // On the bathe screen the full set shows so there's something to scrub; everywhere
  // else a reasonably clean creature just looks clean — spots on a newborn read as
  // disease, not dirt.
  if (!scene.bathing && met.clean >= 65) return;
  const tr = c.traits;
  const amount = scene.bathing ? 1 : 1 - met.clean / 100;
  const S = cam.R / 92;
  for (const m of mudSpots(c)) {
    if (m.erased) continue;
    if (m.i / mudSpots(c).length > amount + 0.15) continue;
    const d = decal(m.x, m.y, m.z, tr, cam);
    if (d.z < 0.05 || d.det <= 0) continue;
    onSurface(d);
    ctx.fillStyle = `rgba(74,52,32,${0.38 * Math.min(1, d.z * 2)})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, m.r * S, m.r * 0.72 * S, m.rot, 0, 7);
    ctx.fill();
    ctx.restore();
  }
}

/* ---------------------------------------------------------- garnishes ---- */
// C2 equips these. Each is a small hand-drawn prop pinned to a surface anchor,
// so it tracks yaw, pitch and breathing exactly like the face does.

const BACK_ANCHOR = [-0.42, 0.72, -0.62];   // upper-left shoulder, behind

function drawGarnishBack(c, cam) {
  if (!c.garnishes?.back) return;
  const a = anchor(...BACK_ANCHOR, c.traits);
  if (faceDir(a, cam.yaw, cam.pitch).z > 0.05) return;   // spun to face us → front pass owns it
  paintBack(c, cam, a);
}

function paintBack(c, cam, a) {
  const { yaw, pitch, sx, sy, R, ox, oy } = cam;
  const S = R / 92;
  const p = project1(a, yaw, pitch, sx, sy, R, ox, oy);
  ctx.save();
  if (c.garnishes.back === 'fern') {
    // dried fern arcing up from behind the shoulder
    const tip = { X: p.X - 16 * S, Y: p.Y - 74 * S }, ctl = { X: p.X - 30 * S, Y: p.Y - 42 * S };
    ctx.strokeStyle = '#8A6B3E'; ctx.lineWidth = 2 * S; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p.X, p.Y); ctx.quadraticCurveTo(ctl.X, ctl.Y, tip.X, tip.Y); ctx.stroke();
    ctx.fillStyle = 'rgba(158,124,74,.92)';
    for (let i = 0; i < 7; i++) {
      const t = 0.3 + i * 0.1, u = 1 - t;
      const qx = u * u * p.X + 2 * u * t * ctl.X + t * t * tip.X;
      const qy = u * u * p.Y + 2 * u * t * ctl.Y + t * t * tip.Y;
      const side = i % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(qx + side * 6 * S, qy - 2 * S, 8 * S, 3 * S, side * 0.55, 0, 7);
      ctx.fill();
    }
  } else if (c.garnishes.back === 'moth') {
    // paper moth perched on the rim of the silhouette, slow flap
    const flap = reduced() ? 0.2 : 0.2 + 0.14 * Math.sin(T * 4.6);
    ctx.translate(p.X, p.Y - 6 * S); ctx.rotate(-0.22);
    ctx.fillStyle = 'rgba(233,225,201,.95)';
    for (const s of [-1, 1]) {
      ctx.save(); ctx.scale(s, 1); ctx.rotate(-flap);
      ctx.beginPath(); ctx.ellipse(12 * S, -4 * S, 12.5 * S, 7 * S, 0.35, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(9 * S, 5 * S, 7.5 * S, 4.6 * S, -0.2, 0, 7); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#4A4036';
    ctx.beginPath(); ctx.ellipse(0, 0, 2.5 * S, 5.6 * S, 0, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawGarnish(c, cam) {
  const g = c.garnishes;
  if (!g) return;
  const tr = c.traits;
  const { yaw, pitch, sx, sy, R, ox, oy } = cam;
  const S = R / 92;

  if (g.back) {
    const a = anchor(...BACK_ANCHOR, tr);
    if (faceDir(a, yaw, pitch).z > 0.05) paintBack(c, cam, a);
  }

  if (g.hat) {
    const a = anchor(0.04, 1.02, 0.10, tr);
    const p = project1(a, yaw, pitch, sx, sy, R, ox, oy);
    const d = faceDir(a, yaw, pitch);
    ctx.save();
    ctx.translate(p.X, p.Y); ctx.rotate(d.x * 0.35 + tr.lean * 0.5);
    if (g.hat === 'sprig') {
      ctx.strokeStyle = '#3E5A34'; ctx.lineCap = 'round';
      for (const tilt of [-0.5, -0.05, 0.42]) {
        ctx.save(); ctx.rotate(tilt);
        ctx.lineWidth = 2 * S;
        ctx.beginPath(); ctx.moveTo(0, 3 * S); ctx.lineTo(0, -19 * S); ctx.stroke();
        ctx.lineWidth = 1.1 * S;
        for (let i = 1; i <= 5; i++) {
          const y = -i * 3.3 * S;
          ctx.beginPath();
          ctx.moveTo(0, y); ctx.lineTo(-3.5 * S, y - 2.5 * S);
          ctx.moveTo(0, y); ctx.lineTo(3.5 * S, y - 2.5 * S);
          ctx.stroke();
        }
        ctx.restore();
      }
    } else if (g.hat === 'wheel') {
      // citrus wheel wedged into the crown like on a glass rim
      ctx.rotate(-0.3);
      ctx.fillStyle = '#E8A24A';
      ctx.beginPath(); ctx.arc(0, -9 * S, 13 * S, 0, 7); ctx.fill();
      ctx.strokeStyle = '#C9762E'; ctx.lineWidth = 3 * S; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,244,214,.85)'; ctx.lineWidth = 1.2 * S;
      for (let i = 0; i < 6; i++) {
        const w = (i / 6) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(0, -9 * S);
        ctx.lineTo(Math.cos(w) * 10.5 * S, -9 * S + Math.sin(w) * 10.5 * S); ctx.stroke();
      }
    }
    ctx.restore();
  }

  if (g.eyes) {
    // the same two front-eye anchors drawFace uses
    const eyeA = [anchor(-0.34, 0.10, 0.90, tr), anchor(0.34, 0.10 + tr.lean * 0.2, 0.90, tr)];
    const dm = faceDir(anchor(0, 0.10, 0.95, tr), yaw, pitch);
    if (dm.z > 0.16) {
      const [p0, p1] = eyeA.map((e) => project1(e, yaw, pitch, sx, sy, R, ox, oy));
      ctx.save();
      ctx.globalAlpha = Math.min(1, (dm.z - 0.16) / 0.25);
      if (g.eyes === 'shade') {
        ctx.strokeStyle = 'rgba(22,18,26,.88)'; ctx.lineCap = 'round';
        ctx.lineWidth = 26 * S;
        ctx.beginPath(); ctx.moveTo(p0.X - 6 * S, p0.Y); ctx.lineTo(p1.X + 6 * S, p1.Y); ctx.stroke();
        ctx.lineWidth = 3 * S;                       // arms toward the ears
        ctx.beginPath(); ctx.moveTo(p0.X - 6 * S, p0.Y); ctx.lineTo(p0.X - 24 * S, p0.Y - 7 * S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p1.X + 6 * S, p1.Y); ctx.lineTo(p1.X + 24 * S, p1.Y - 7 * S); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,253,245,.16)'; ctx.lineWidth = 5 * S;
        ctx.beginPath(); ctx.moveTo(p0.X - 2 * S, p0.Y - 7 * S); ctx.lineTo(p1.X + 2 * S, p1.Y - 7 * S); ctx.stroke();
      } else if (g.eyes === 'lash') {
        ctx.strokeStyle = 'rgba(20,12,16,.9)'; ctx.lineWidth = 1.6 * S; ctx.lineCap = 'round';
        [p0, p1].forEach((p, i) => {
          const s = i ? 1 : -1;
          for (let k = 0; k < 3; k++) {
            const x = p.X + (k - 1) * 5 * S;
            ctx.beginPath();
            ctx.moveTo(x, p.Y - 13 * S);
            ctx.quadraticCurveTo(x + s * 3 * S, p.Y - 21 * S, x + s * 7 * S, p.Y - 23 * S);
            ctx.stroke();
          }
          ctx.fillStyle = '#B23A4A';                 // the cherry
          ctx.beginPath(); ctx.arc(p.X + s * 12 * S, p.Y - 16 * S, 3.2 * S, 0, 7); ctx.fill();
        });
      }
      ctx.restore();
    }
  }

  if (g.held) {
    const a = anchor(0.92, -0.60, 0.30, tr);
    const d = faceDir(a, yaw, pitch);
    if (d.z > -0.15) {
      const p = project1(a, yaw, pitch, sx, sy, R, ox, oy);
      ctx.save();
      ctx.translate(p.X, p.Y);
      if (g.held === 'pick') {
        ctx.strokeStyle = '#D8CBB2'; ctx.lineWidth = 2 * S; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 10 * S); ctx.lineTo(7 * S, -24 * S); ctx.stroke();
        ctx.fillStyle = '#6B7C3A';
        ctx.beginPath(); ctx.ellipse(8 * S, -28 * S, 6 * S, 5 * S, 0.3, 0, 7); ctx.fill();
        ctx.fillStyle = '#B04430';
        ctx.beginPath(); ctx.arc(10 * S, -29 * S, 1.8 * S, 0, 7); ctx.fill();
      } else if (g.held === 'straw') {
        ctx.rotate(0.42);
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = i % 2 ? '#C05A4A' : '#F2EDE2';
          ctx.fillRect(-2.8 * S, (-30 + i * 7) * S, 5.6 * S, 7 * S);
        }
        ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
        ctx.strokeRect(-2.8 * S, -30 * S, 5.6 * S, 42 * S);
      }
      ctx.restore();
    }
  }
}

const mudCache = new Map();
export function mudSpots(c) {
  if (!mudCache.has(c.id)) {
    const s = [];
    for (let i = 0; i < 10; i++) {
      const a = i * 2.399, r = Math.sqrt(i / 10);
      s.push({
        i, x: Math.cos(a) * r, y: (noise3(i, 1, 1, 5)) * 0.8, z: Math.max(0.25, Math.sin(a) * r + 0.5),
        r: 9 + 7 * Math.abs(noise3(i, 4, 4, 8)), rot: a, erased: false,
      });
    }
    mudCache.set(c.id, s);
  }
  return mudCache.get(c.id);
}

/* ------------------------------------------------------------------ egg --- */

/** A point ON the shell for (th, phi) — same radius/taper/noise as eggMesh(3),
 *  nudged 1.2% outward so cracks always paint over the shell, never under it. */
function eggSurf(th, phi) {
  const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
  const taper = 1 - 0.19 * Math.max(0, ny);
  const r = (1 + 0.018 * noise3(nx * 5, ny * 5, nz * 5, 3)) * 1.012;
  return { x: nx * r * taper, y: ny * r * 1.26, z: nz * r * taper };
}

// Cracks live on the SURFACE, as polylines in (th, phi), built once and projected
// through the same transform as the shell each frame — so they rock, spin and
// breathe with the egg instead of hanging in front of it.
let crackP = null;
function cracks() {
  if (crackP) return crackP;
  crackP = [];
  for (let i = 0; i < 4; i++) {
    const pts = [];
    // all four start on the front hemisphere (th ∈ (0,π)) — every stage tick
    // must produce a crack the player can actually see appear
    let th = 0.55 + i * 0.62;
    let phi = 0.26 + 0.12 * Math.abs(noise3(i, 0, 1, 7));
    for (let s = 0; s <= 8; s++) {
      pts.push(eggSurf(th, phi));
      th += noise3(i, s, 2, 9) * 0.42;
      phi += 0.13 + 0.06 * Math.abs(noise3(i, s, 5, 4));
    }
    crackP.push(pts);
  }
  return crackP;
}

function eggState() {
  const t = T;
  const p = scene.pose;
  const R = 78 * p.scale;
  const breathe = reduced() ? 1 : 1 + 0.015 * Math.sin(t * Math.PI * 2 * 0.4);
  const rock = reduced() ? 0 : (2 * Math.PI / 180) * Math.sin(t * Math.PI * 2 * 0.4) * (1 + scene.hold * 3);
  // sway, don't spin — a monotonic yaw would slowly carry the cracks to the far side
  const yaw = reduced() ? 0 : 0.10 * Math.sin(t * 0.35);
  const ox = p.x, oy = p.y - 100 * p.scale;
  return { p, cam: { yaw, pitch: -0.08, sx: 1 / breathe, sy: breathe, R, ox, oy, focal: FOCAL, roll: rock } };
}

function eggUnder(st) {
  const { p, cam: { ox, oy } } = st;
  ctx.save();
  const g = ctx.createRadialGradient(ox + 10, p.y, 1, ox + 10, p.y, 92 * p.scale);
  g.addColorStop(0, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.translate(ox + 10, p.y); ctx.scale(1.6, 0.2); ctx.translate(-(ox + 10), -p.y);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ox + 10, p.y, 92 * p.scale, 0, 7); ctx.fill();
  ctx.restore();

  if (scene.hold > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bg = ctx.createRadialGradient(ox, oy, 5, ox, oy, 170 * p.scale);
    bg.addColorStop(0, `rgba(255,240,190,${0.5 * scene.hold})`);
    bg.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(ox, oy, 170 * p.scale, 0, 7); ctx.fill();
    ctx.restore();
  }
}

function eggGeom(st) {
  GL.draw(GL.mesh('egg', () => eggMesh(3)), st.cam,
    { ramp: ramp('#4A3A22', '#CBB193', '#FFFAF0'), gloss: 0.5, sick: 0.05, key: KEY, fill: FILL });
}

/** Cracks — 4 discrete stages, each one a haptic tick in app.js. Projected with the
 *  exact shell transform and culled on the far hemisphere, so they rock with it. */
function eggOver(st) {
  const { p, cam } = st;
  const { yaw, pitch, sx, sy, R, ox, oy, roll } = cam;
  ctx.save();
  ctx.translate(ox, oy); ctx.rotate(roll); ctx.translate(-ox, -oy);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < Math.min(4, scene.crackStage); i++) {
    ctx.beginPath();
    let drawing = false;
    for (const v of cracks()[i]) {
      const q = project1(v, yaw, pitch, sx, sy, R, ox, oy);
      if (q.z < 0.05) { drawing = false; continue; }   // behind the shell's rim
      if (!drawing) { ctx.moveTo(q.X, q.Y); drawing = true; }
      else ctx.lineTo(q.X, q.Y);
    }
    ctx.strokeStyle = 'rgba(58,42,26,.85)';
    ctx.lineWidth = (1.4 + i * 0.45) * p.scale * (1 + scene.hold * 0.5);
    ctx.stroke();
    if (scene.hold > 0.3) {                            // light leaking through
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,232,160,${0.7 * scene.hold})`;
      ctx.lineWidth = (2.6 + i * 0.4) * p.scale;
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- world --- */

function drawWorld() {
  const key = `${scene.field}|${scene.groundTop}|${Math.round(scene.decay * 4)}|${scene.props}`;
  if (worldKey !== key) {
    worldKey = key;
    worldCache = document.createElement('canvas');
    worldCache.width = W * DPR; worldCache.height = H * DPR;
    const c = worldCache.getContext('2d');
    c.scale(DPR, DPR);
    paintWorld(c, fieldById(scene.field), scene.groundTop, scene.decay, scene.props);
  }
  ctx.drawImage(worldCache, 0, 0, W, H);
}

function desat(hex, amt) {
  if (!amt) return hex;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  const grey = 200;
  r = r + (l - r) * amt; g = g + (l - g) * amt; b = b + (l - b) * amt;
  r += (grey - r) * amt * 0.28; g += (grey - g) * amt * 0.28; b += (grey - b) * amt * 0.28;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function paintWorld(c, f, groundTop, decay, props) {
  const d = decay * 0.85;
  const sky = c.createLinearGradient(0, 0, 0, H);
  f.sky.forEach((s, i) => sky.addColorStop(f.skyStops[i], desat(s, d)));
  c.fillStyle = sky; c.fillRect(0, 0, W, H);

  // sun / moon bloom. Both stops MUST share the RGB — canvas interpolates rgba
  // un-premultiplied, so fading to rgba(0,0,0,0) drags the halo through grey.
  const [bx, by] = f.bloomAt;
  const cx = bx + f.bloomSize / 2, cyy = by + f.bloomSize / 2;
  const bg = c.createRadialGradient(cx, cyy, 1, cx, cyy, f.bloomSize / 2);
  bg.addColorStop(0, `rgba(${f.bloom},${f.bloomA})`);
  bg.addColorStop(0.55, `rgba(${f.bloom},${f.bloomA * 0.22})`);
  bg.addColorStop(1, `rgba(${f.bloom},0)`);
  c.fillStyle = bg; c.fillRect(bx, by, f.bloomSize, f.bloomSize);
  if (f.id === 'night') {
    c.fillStyle = '#E8ECF7';
    c.beginPath(); c.arc(cx, cyy, 26, 0, 7); c.fill();
  }

  // hills
  c.fillStyle = desat(f.hills[0], d);
  c.beginPath(); c.ellipse(-90 + 195, groundTop - 12 + 103, 195, 103, 0, 0, 7); c.fill();
  c.fillStyle = desat(f.hills[1], d);
  c.beginPath(); c.ellipse(W + 110 - 205, groundTop + 6 + 107, 205, 107, 0, 0, 7); c.fill();

  // treeline — a black jag at the horizon. Not in the mocks.
  c.fillStyle = f.treeline;
  c.beginPath();
  c.moveTo(0, groundTop + 8);
  for (let x = 0; x <= W; x += 17) {
    const h = 30 + 56 * Math.abs(noise3(x * 0.04, 3, 1, 21)) + 96 * Math.pow(Math.abs(noise3(x * 0.011, 9, 1, 4)), 4);
    c.lineTo(x, groundTop + 8 - h);
    c.lineTo(x + 8.5, groundTop + 8 - h * 0.34);
  }
  c.lineTo(W, groundTop + 10); c.closePath(); c.fill();

  // eyes in the treeline
  if (f.watchers) {
    for (let i = 0; i < f.watchers; i++) {
      const x = 30 + ((i * 97) % (W - 60));
      const y = groundTop - 6 - 12 * Math.abs(noise3(i, 2, 2, 15));
      c.fillStyle = f.id === 'forest' ? 'rgba(200,255,180,.55)' : 'rgba(255,236,200,.5)';
      c.beginPath(); c.arc(x, y, 1.9, 0, 7); c.arc(x + 6, y + 1, 1.9, 0, 7); c.fill();
    }
  }

  // ground
  const gr = c.createLinearGradient(0, groundTop, 0, H);
  gr.addColorStop(0, desat(f.ground[0], d));
  gr.addColorStop(0.4, desat(f.ground[1], d));
  gr.addColorStop(1, desat(f.ground[2], d));
  c.fillStyle = gr; c.fillRect(0, groundTop, W, H - groundTop);

  // grass streaks, and dust patches when decayed
  for (let i = 0; i < 150; i++) {
    const t = i / 150;
    const y = groundTop + 10 + t * (H - groundTop);
    const x = ((i * 137.5) % W);
    c.strokeStyle = `rgba(0,0,0,${0.05 + t * 0.07})`;
    c.lineWidth = 1 + t * 1.6;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + 3 - t * 6, y - 6 - t * 9); c.stroke();
  }
  if (decay > 0.25) {
    for (let i = 0; i < 26; i++) {
      const x = (i * 211) % W, y = groundTop + 30 + ((i * 97) % (H - groundTop - 60));
      c.fillStyle = `rgba(150,138,110,${0.10 + decay * 0.16})`;
      c.beginPath(); c.ellipse(x, y, 20 + (i % 5) * 8, 6 + (i % 3) * 3, 0, 0, 7); c.fill();
    }
  }

  if (!props) return;
  const contact = (x, y, rx) => {                    // every prop sits in a dent
    const g2 = c.createRadialGradient(x, y, 1, x, y, rx);
    g2.addColorStop(0, 'rgba(0,0,0,.34)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    c.save(); c.translate(x, y); c.scale(1, 0.24); c.translate(-x, -y);
    c.fillStyle = g2; c.beginPath(); c.arc(x, y, rx, 0, 7); c.fill(); c.restore();
  };

  // puddle — still, and a shade too dark to see the bottom of
  contact(101, groundTop + 90, 92);
  const pg = c.createLinearGradient(0, groundTop + 60, 0, groundTop + 110);
  pg.addColorStop(0, desat(f.dark ? '#223A46' : '#7FB6CB', d * 0.6));
  pg.addColorStop(1, desat(f.dark ? '#12222B' : '#4E88A2', d * 0.6));
  c.fillStyle = pg;
  c.beginPath(); c.ellipse(101, groundTop + 84, 75, 26, 0, 0, 7); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 1.6;
  c.beginPath(); c.ellipse(101, groundTop + 79, 66, 19, 0, 3.5, 5.8); c.stroke();

  // berry bush
  contact(W - 44, groundTop + 82, 74);
  c.fillStyle = desat(f.dark ? '#1B2C1E' : '#3A6438', d);
  c.beginPath(); c.ellipse(W - 44, groundTop + 42, 62, 48, 0, 0, 7); c.fill();
  c.fillStyle = 'rgba(0,0,0,.30)';
  c.beginPath(); c.ellipse(W - 26, groundTop + 60, 50, 32, 0, 0, 7); c.fill();
  [[56, 22], [86, 44], [38, 52]].forEach(([dx, dy], i) => {
    c.fillStyle = desat(BERRIES[i], d * 0.5);
    c.beginPath(); c.arc(W - dx, groundTop + dy, 5.5 - i * 0.6, 0, 7); c.fill();
  });

  // log — a barked cylinder with a visible end, not a plank
  const ly = H - 214;
  contact(94, ly + 22, 88);
  const lg = c.createLinearGradient(0, ly - 22, 0, ly + 22);
  lg.addColorStop(0, desat('#7A5A3E', d)); lg.addColorStop(.55, desat('#543D28', d));
  lg.addColorStop(1, desat('#33251A', d));
  c.fillStyle = lg;
  c.beginPath(); c.roundRect(24, ly - 22, 140, 44, 22); c.fill();
  c.fillStyle = desat('#8A6A48', d);
  c.beginPath(); c.ellipse(160, ly, 11, 22, 0, 0, 7); c.fill();
  c.fillStyle = 'rgba(0,0,0,.45)';
  c.beginPath(); c.ellipse(160, ly, 5, 11, 0, 0, 7); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.30)'; c.lineWidth = 1.4;
  for (let i = 0; i < 4; i++) {
    c.beginPath(); c.moveTo(40 + i * 30, ly - 16); c.lineTo(46 + i * 30, ly + 16); c.stroke();
  }
}

/* -------------------------------------------------------------- effects --- */

const FX_COLOR = {
  spark: '#FFE9A8', shard: '#E3D3B4', heart: '#D9556E', droplet: '#BFE6EF',
  dust: '#9A8E6E', petal: '#C98A5E', bubble: 'rgba(255,255,255,.75)',
};

const SEED_G = 760;

function drawFx(dt) {
  const keep = [];
  for (const p of scene.fx) {
    p.age += dt;
    if (p.age > p.life) { p.onEnd?.(); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += (p.type === 'seed' ? SEED_G : p.type === 'spark' || p.type === 'heart' ? -40 : 240) * dt;
    if (p.type === 'seed') {
      // it watches the seed all the way in
      scene.look.x = Math.max(-1, Math.min(1, (p.x - scene.pose.x) / 150));
      scene.look.y = Math.max(-1, Math.min(1, (p.y - bodyCentreY()) / 150));
      ctx.fillStyle = '#7FB35C';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.arc(p.x - p.r * .3, p.y - p.r * .35, p.r * .34, 0, 7); ctx.fill();
      keep.push(p);
      continue;
    }
    const a = 1 - p.age / p.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = FX_COLOR[p.type] || '#fff';
    ctx.beginPath();
    if (p.type === 'heart') {
      ctx.arc(p.x - p.r * .5, p.y, p.r * .6, 0, 7);
      ctx.arc(p.x + p.r * .5, p.y, p.r * .6, 0, 7);
      ctx.moveTo(p.x - p.r, p.y + p.r * .2); ctx.lineTo(p.x, p.y + p.r * 1.5); ctx.lineTo(p.x + p.r, p.y + p.r * .2);
    } else if (p.type === 'shard') {
      ctx.moveTo(p.x, p.y - p.r); ctx.lineTo(p.x + p.r, p.y + p.r); ctx.lineTo(p.x - p.r, p.y + p.r * .6);
    } else ctx.arc(p.x, p.y, p.r, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    keep.push(p);
  }
  scene.fx = keep;
}

/** B5 — lob a seed from the tray toward the creature (or short, on a weak flick).
 *  Solved for a fixed flight time, so the catch lands exactly when the arc does.
 *  Returns the flight time in ms; the caller scores/reacts on that clock. */
export function throwSeed(vel, good) {
  if (reduced()) {
    if (good) { chew(0.6); emit('heart', 4); }
    return 0;
  }
  const x0 = W / 2, y0 = H - 118;
  const tx = good ? scene.pose.x + (Math.random() - 0.5) * 24 : 90 + Math.random() * 120;
  const ty = good ? bodyCentreY() - 6 : scene.pose.y - 6;
  const tf = good ? Math.max(0.5, 0.78 - Math.min(vel, 1600) / 6000) : 0.5;
  scene.fx.push({
    type: 'seed', x: x0, y: y0,
    vx: (tx - x0) / tf,
    vy: (ty - y0) / tf - 0.5 * SEED_G * tf,
    life: tf, age: 0, r: 5.5,
    onEnd() {
      if (good) {
        squash(0.20, 0.6); chew(0.7); wiggle(0.5);
        emit('heart', 4, { spread: 50 });
        emit('spark', 5, { spread: 40 });
      } else {
        emit('dust', 8, { x: tx, y: ty, spread: 26, up: 0.5 });
      }
    },
  });
  return tf * 1000;
}

/* ------------------------------------------------------------- sprites ---- */

/** Flatten one creature into whatever 2D target `ctx` points at: the two 2D passes
 *  with the WebGL pass blitted between them. Bitmaps only — the live scene keeps its
 *  layers separate. The geometry canvas is scratch here, and the loop clears it. */
function bake(c, pose, opts) {
  // hasGL: app.js is already showing the message; don't throw behind it.
  // GL.lost: a bake on a dying context paints zero geometry — refuse, retry later.
  if (!hasGL || GL.lost) return false;
  const st = creatureState(c, pose, opts);
  creatureUnder(st);
  GL.frame();
  creatureGeom(st);
  GL.sync();                      // resolve MSAA before the readback (iOS)
  ctx.drawImage(glcv, 0, 0, W, H);
  creatureOver(st);
  return true;
}

/** C3 — draw a 4:5 framed render of one creature in one field, into someone else's
 *  canvas. Its own pass, so it doesn't depend on whatever the live scene is doing. */
export function portrait(c, dest, dw, dh, fieldId) {
  const tmp = document.createElement('canvas');
  tmp.width = W * DPR; tmp.height = H * DPR;
  const tctx = tmp.getContext('2d');
  tctx.scale(DPR, DPR);
  const prev = ctx, prevT = T, prevSpin = scene.spin, prevLook = scene.look;
  const prevHop = scene._hop, prevLean = scene._lean;
  ctx = tctx; T = 2; scene.spin = 0.12; scene.look = { x: 0, y: 0 }; scene._hop = 0; scene._lean = 0;
  paintWorld(tctx, fieldById(fieldId), 470, 0, true);
  bake(c, { x: 195, y: 779, scale: 1.0 }, { meters: c.meters });
  ctx = prev; T = prevT; scene.spin = prevSpin; scene.look = prevLook;
  scene._hop = prevHop; scene._lean = prevLean;
  const sy = 300, sh = 487;                          // 390:487 ≈ 4:5
  dest.drawImage(tmp, 0, sy * DPR, W * DPR, sh * DPR, 0, 0, dw, dh);
}

// The bitmap is bottom-anchored when it's drawn, so the height is pure headroom for
// the crown — it has to clear the tallest bouquet a genome can roll or the collection
// grid bakes flat-topped leaves.
const SPRITE_W = 230, SPRITE_H = 320;

/** ponytail: collection creatures render once to a bitmap and then just bob.
 *  Full per-creature meshes at 12+ on screen is the one thing that will not hold. */
const bakeTries = new Map();

/** One pixel at the belly — the body covers it in every trait combination. If it's
 *  transparent, the GL pass never landed (context loss race, iOS buffer purge) and
 *  the bitmap must not be cached, or the creature is a floating face until reload. */
function spriteHasBody(s) {
  const x = Math.round((SPRITE_W / 2) * DPR), y = Math.round((SPRITE_H - 70) * DPR);
  return s.getContext('2d').getImageData(x, y, 1, 1).data[3] > 40;
}

function sprite(c) {
  // garnishes are baked into the bitmap, so they must be part of the key
  const k = c.genomeSeed + c.material + JSON.stringify(c.garnishes || {});
  if (spriteCache.has(k)) return spriteCache.get(k);
  const s = document.createElement('canvas');
  s.width = SPRITE_W * DPR; s.height = SPRITE_H * DPR;
  const prev = ctx, prevT = T;
  ctx = s.getContext('2d');
  ctx.scale(DPR, DPR);
  T = 2;                     // a blink-free moment — shut eyes must not bake into the bitmap
  const savePose = scene.pose, saveSpin = scene.spin, saveLook = scene.look;
  const saveHop = scene._hop, saveLean = scene._lean;
  scene.spin = 0; scene.look = { x: 0, y: 0 }; scene._hop = 0; scene._lean = 0;
  const ok = bake(c, { x: SPRITE_W / 2, y: SPRITE_H - 8, scale: 0.62 }, { lod: 2, meters: c.meters });
  scene.pose = savePose; scene.spin = saveSpin; scene.look = saveLook;
  scene._hop = saveHop; scene._lean = saveLean;
  ctx = prev; T = prevT;
  // cache only a verified bake; otherwise show this frame's attempt and try again
  // next frame. The cap stops a permanently-broken device from re-baking forever.
  const tries = (bakeTries.get(k) || 0) + 1;
  if ((ok && spriteHasBody(s)) || tries > 60) { spriteCache.set(k, s); bakeTries.delete(k); }
  else bakeTries.set(k, tries);
  return s;
}

/* ---------------------------------------------------------------- loop ---- */

let last = performance.now() / 1000;
let px0 = null, py0 = null, hopPhase = 0;

/** All the easing lives here: pose glides to poseTarget, lids/mouth soften,
 *  and walking speed drives a hop. Nothing user-visible ever snaps. */
function tween(dt) {
  const p = scene.pose, q = scene.poseTarget;
  const kp = reduced() ? 1 : 1 - Math.exp(-dt * 9);   // ~0.35s settle; reduced motion snaps
  p.x += (q.x - p.x) * kp;
  p.y += (q.y - p.y) * kp;
  p.scale += (q.scale - p.scale) * kp;

  if (px0 == null) { px0 = p.x; py0 = p.y; }
  const dx = p.x - px0, dyy = p.y - py0;
  const speed = dt > 0 ? Math.hypot(dx, dyy) / dt : 0;
  px0 = p.x; py0 = p.y;
  const walking = Math.min(1, speed / 26);
  if (walking > 0.05) hopPhase += dt * (5 + speed * 0.16);
  scene._hop = reduced() ? 0 : Math.abs(Math.sin(hopPhase)) * 7 * walking * p.scale;
  const leanT = reduced() ? 0 : Math.max(-0.12, Math.min(0.12, (dt > 0 ? dx / dt : 0) / 320));
  scene._lean += (leanT - scene._lean) * kp;

  const mouthT = scene.chewUntil > T ? 0.28 + 0.42 * Math.abs(Math.sin(T * 9.5)) : scene.mouth;
  scene._mouth += (mouthT - scene._mouth) * (1 - Math.exp(-dt * 12));
  scene._eyeLid += (scene.eyeLid - scene._eyeLid) * (1 - Math.exp(-dt * 10));
}

function drawSprites() {
  const sorted = [...scene.others].sort((a, b) => a.scale - b.scale);
  for (const o of sorted) {
    const sp = sprite(o.creature);
    const k = o.scale / 0.62;
    const w = SPRITE_W * k, h = SPRITE_H * k;
    const bob = reduced() ? 0 : Math.sin(T * 1.2 + o.x) * 3;
    ctx.drawImage(sp, o.x - w / 2, o.y - h + bob, w, h);
  }
}

function loop() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last); last = now;
  T = now - t0;
  if (!wctx) return;

  wctx.clearRect(0, 0, W, H);
  fctx.clearRect(0, 0, W, H);
  ctx = wctx;
  if (scene.hidden) { GL.frame(); drawFlat(); return; }
  drawWorld();

  if (scene.wander && scene.mode === 'creature' && !reduced()) wander(dt);
  tween(dt);

  const egg = scene.mode === 'egg';
  const st = egg ? eggState()
    : scene.mode === 'creature' && scene.creature ? creatureState(scene.creature, scene.pose, {})
    : null;

  // the RGB split escapes the wordmark for a few frames. It is not supposed to.
  // Kept subtle — a brand wink, never a stutter.
  const copies = scene.glitchUntil > T && !reduced()
    ? [[-1.8, Math.sin(T * 90) * 1.4, 0.38], [1.8, 0, 0.38], [0, 0, 0.88]]
    : [[0, 0, 1]];
  const pass = (fn) => {
    for (const [dx, dy, a] of copies) {
      ctx.save(); ctx.globalAlpha = a; ctx.translate(dx, dy); fn(); ctx.restore();
    }
  };

  if (st) pass(() => (egg ? eggUnder(st) : creatureUnder(st)));

  // The three canvases are stacked DOM layers, so within a frame their order is
  // free — the geometry pass goes last because sprite() uses its canvas as scratch.
  ctx = fctx;
  if (st) pass(() => (egg ? eggOver(st) : creatureOver(st)));
  else if (scene.mode === 'collection') pass(drawSprites);
  drawFx(dt);

  GL.frame();                               // also wipes whatever sprite() baked through it
  if (st) for (const [dx, dy, a] of copies) {
    GL.clearDepth();                        // colour blends between copies, depth doesn't
    Object.assign(st.cam, { dx, dy, alpha: a });
    if (egg) eggGeom(st); else creatureGeom(st);
  }

  if (scene.spinVel) {
    scene.spin += scene.spinVel * dt;
    scene.spinVel *= Math.pow(0.92, dt * 60);          // frame-rate independent
    if (Math.abs(scene.spinVel) < 0.01) scene.spinVel = 0;
  }
}

function drawFlat() {
  const f = fieldById(scene.field);
  ctx.fillStyle = f.dark ? '#16211E' : '#FFFDF5';
  ctx.fillRect(0, 0, W, H);
}

/* creature ambles the plane, retargeting every 4–9s. It steers the pose TARGET
   at amble speed; the tween in loop() does the actual moving — one mover, and the
   hop reads off real velocity, so it bounces along instead of sliding. */
let target = null, nextRetarget = 0;
function wander(dt) {
  if (!target || T > nextRetarget) {
    target = { x: 110 + Math.random() * 170, depth: 0.55 + Math.random() * 0.45 };
    nextRetarget = T + 4 + Math.random() * 5;
  }
  const ty = scene.groundTop + 150 + target.depth * 190;
  const ts = 0.72 + target.depth * 0.30;
  const k = 1 - Math.pow(0.5, dt);                     // ~1s half-life amble
  const q = scene.poseTarget;
  q.x += (target.x - q.x) * k;
  q.y += (ty - q.y) * k;
  q.scale += (ts - q.scale) * k;
}

export { easeCubicOut, easeSinInOut };
