// The geometry layer, in WebGL.
//
// One program, one job: take a mesh in creature space, apply the same yaw / pitch /
// perspective divide the software renderer used, and shade it per-fragment against a
// ramp texture. Smooth vertex normals instead of flat quads, a depth buffer instead of
// a painter's sort, MSAA instead of stroking each quad in its own fill colour — the
// three artefacts that read as "cheap" are all properties of this file now.
//
// Nothing here knows what a creature is. render.js owns the scene.

const RAMP_N = 256;

const VS = `
attribute vec3 a_pos;
attribute vec3 a_nrm;
uniform vec2 u_yaw;      // cos, sin
uniform vec2 u_pitch;    // cos, sin
uniform vec2 u_scale;    // sx, sy
uniform vec2 u_roll;     // cos, sin — screen-space, about the origin
uniform vec2 u_origin;   // ox, oy, stage px
uniform vec2 u_shift;    // glitch offset, stage px
uniform vec2 u_view;     // W, H
uniform float u_R;
uniform float u_focal;
varying vec3 v_nrm;
void main() {
  float cy = u_yaw.x, sw = u_yaw.y, cp = u_pitch.x, sp = u_pitch.y;
  float sx = u_scale.x, sy = u_scale.y;
  vec3 p = vec3(a_pos.x * sx, a_pos.y * sy, a_pos.z * sx);
  float x1 = p.x * cy + p.z * sw;
  float z1 = -p.x * sw + p.z * cy;
  float y2 = p.y * cp - z1 * sp;
  float z2 = p.y * sp + z1 * cp;
  float k = u_focal / (u_focal - z2 * u_R);
  vec2 s = vec2(x1 * u_R * k, -y2 * u_R * k);
  s = vec2(s.x * u_roll.x - s.y * u_roll.y, s.x * u_roll.y + s.y * u_roll.x);
  vec2 px = u_origin + s + u_shift;
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0,
                     1.0 - px.y / u_view.y * 2.0,
                     -z2 * u_R / u_focal, 1.0);
  // the model scale is non-uniform, so the normal takes its inverse before the rotation
  vec3 n = vec3(a_nrm.x / sx, a_nrm.y / sy, a_nrm.z / sx);
  float nx1 = n.x * cy + n.z * sw;
  float nz1 = -n.x * sw + n.z * cy;
  v_nrm = vec3(nx1, n.y * cp - nz1 * sp, n.y * sp + nz1 * cp);
}`;

const FS = `
precision mediump float;
varying vec3 v_nrm;
uniform sampler2D u_ramp;
uniform vec3 u_key;
uniform vec3 u_fill;
uniform float u_gloss;
uniform float u_sick;
uniform float u_alpha;
void main() {
  vec3 n = normalize(v_nrm);
  // a leaf is a sheet with no inside; a body backface is covered by the depth buffer.
  // Flipping is right for both, so nothing needs culling.
  if (n.z < 0.0) n = -n;
  float kd = max(0.0, dot(n, u_key));
  float fd = max(0.0, dot(n, u_fill));
  float rim = pow(1.0 - abs(n.z), 5.0);
  float t = 0.12 + 0.62 * kd + 0.18 * fd + u_gloss * 0.38 * pow(kd, 5.0) + rim * 0.14;
  t = clamp(t * (1.0 - u_sick * 0.12), 0.0, 0.999);
  // t → texel centre, so a LINEAR fetch reads the ramp continuously. This is where
  // the 96-step quantized banding went.
  vec3 rgb = texture2D(u_ramp, vec2((t * ${RAMP_N - 1}.0 + 0.5) / ${RAMP_N}.0, 0.5)).rgb;
  gl_FragColor = vec4(rgb * u_alpha, u_alpha);   // premultiplied, to match the blend func
}`;

let gl = null, prog = null, U = {}, A = {}, view = { w: 0, h: 0 };
const meshes = new Map();
const ramps = new Map();
let onLost = null, onRestored = null;

export let lost = false;

/** Returns false if the device has no WebGL at all — the caller shows a message
 *  and stops. There is deliberately no second renderer to fall back to. */
export function init(canvas, w, h, dpr, hooks = {}) {
  const opts = {
    alpha: true, antialias: true, depth: true, premultipliedAlpha: true,
    // sprite() and portrait() read the buffer back with drawImage outside the
    // compositing task, so it has to survive.
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  };
  try {
    gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  } catch { gl = null; }
  if (!gl) return false;

  onLost = hooks.onLost; onRestored = hooks.onRestored;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();                 // without this the context never comes back
    lost = true;
    meshes.clear(); ramps.clear();      // every GL object died with the context
    onLost?.();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    build();
    resize(view.w, view.h, view.dpr);
    lost = false;
    onRestored?.();
  });

  build();
  resize(w, h, dpr);
  return true;
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function build() {
  prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  U = {};
  for (const n of ['u_yaw', 'u_pitch', 'u_scale', 'u_roll', 'u_origin', 'u_shift',
    'u_view', 'u_R', 'u_focal', 'u_ramp', 'u_key', 'u_fill', 'u_gloss', 'u_sick', 'u_alpha'])
    U[n] = gl.getUniformLocation(prog, n);

  A = { pos: gl.getAttribLocation(prog, 'a_pos'), nrm: gl.getAttribLocation(prog, 'a_nrm') };
  gl.enableVertexAttribArray(A.pos);
  gl.enableVertexAttribArray(A.nrm);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.uniform1i(U.u_ramp, 0);
}

export function resize(w, h, dpr) {
  view = { w, h, dpr };
  gl.canvas.width = w * dpr; gl.canvas.height = h * dpr;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.uniform2f(U.u_view, w, h);
}

export function frame() { gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }

const PX = new Uint8Array(4);
/** Forces the multisample resolve + completion of all draws before a same-task
 *  canvas2d.drawImage readback — iOS WebKit can otherwise hand over a stale or
 *  unresolved buffer under memory pressure, which bakes an empty sprite. */
export function sync() {
  if (!gl || lost) return;
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PX);
}

/** Between the offset copies of a glitch frame: colour blends, depth starts over. */
export function clearDepth() { gl.clear(gl.DEPTH_BUFFER_BIT); }

/* ------------------------------------------------------------------ ramps -- */

/** `bytes` is RAMP_N × RGB. Cached by key; the cache empties on context loss, so
 *  callers should just ask again every frame rather than hold the texture. */
export function ramp(key, bytes) {
  let t = ramps.get(key);
  if (t) return t;
  t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, RAMP_N, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, bytes());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  ramps.set(key, t);
  return t;
}

/* ----------------------------------------------------------------- meshes -- */

/** Seam vertices are duplicates — th = 0 and th = 2π are the same point — so each
 *  copy only accumulates half its neighbouring quads. Un-welded that draws a hard
 *  line down the creature, which is the exact artefact this port exists to remove. */
function weld(verts, nrm) {
  const at = new Map();
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const k = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    const g = at.get(k);
    if (g) g.push(i); else at.set(k, [i]);
  }
  for (const g of at.values()) {
    if (g.length < 2) continue;
    let x = 0, y = 0, z = 0;
    for (const i of g) { x += nrm[i * 3]; y += nrm[i * 3 + 1]; z += nrm[i * 3 + 2]; }
    for (const i of g) { nrm[i * 3] = x; nrm[i * 3 + 1] = y; nrm[i * 3 + 2] = z; }
  }
}

/** `make()` only runs on a miss, so callers can pass a cached CPU mesh and get a
 *  free re-upload after a context loss. */
export function mesh(key, make) {
  let m = meshes.get(key);
  if (m) return m;

  const { verts, quads } = make();
  const n = verts.length;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = verts[i].x; pos[i * 3 + 1] = verts[i].y; pos[i * 3 + 2] = verts[i].z;
  }

  const idx = new Uint16Array(quads.length * 6);
  for (let q = 0; q < quads.length; q++) {
    const [a, b, c, d] = quads[q];
    idx[q * 6] = a; idx[q * 6 + 1] = b; idx[q * 6 + 2] = c;
    idx[q * 6 + 3] = a; idx[q * 6 + 4] = c; idx[q * 6 + 5] = d;
    // the software renderer's quad normal, (c-a) × (d-b), accumulated per vertex.
    // Left un-normalised on purpose: that area-weights the average.
    const A0 = verts[a], B0 = verts[b], C0 = verts[c], D0 = verts[d];
    const ux = C0.x - A0.x, uy = C0.y - A0.y, uz = C0.z - A0.z;
    const vx = D0.x - B0.x, vy = D0.y - B0.y, vz = D0.z - B0.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c, d]) { nrm[i * 3] += nx; nrm[i * 3 + 1] += ny; nrm[i * 3 + 2] += nz; }
  }

  weld(verts, nrm);
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l;
  }

  m = { pos: buf(gl.ARRAY_BUFFER, pos), nrm: buf(gl.ARRAY_BUFFER, nrm),
        idx: buf(gl.ELEMENT_ARRAY_BUFFER, idx), count: idx.length };
  // ponytail: whole-cache flush, same as the software renderer did. Sized to sit
  // above render.js's own 40-creature cache × 3 buffers each, so the two don't
  // thrash against each other. Per-entry LRU if that ever stops being true.
  if (meshes.size > 128) { for (const o of meshes.values()) free(o); meshes.clear(); }
  meshes.set(key, m);
  return m;
}

function buf(target, data) {
  const b = gl.createBuffer();
  gl.bindBuffer(target, b);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return b;
}

function free(m) { gl.deleteBuffer(m.pos); gl.deleteBuffer(m.nrm); gl.deleteBuffer(m.idx); }

/* ------------------------------------------------------------------- draw -- */

export function draw(m, cam, mat) {
  gl.uniform2f(U.u_yaw, Math.cos(cam.yaw), Math.sin(cam.yaw));
  gl.uniform2f(U.u_pitch, Math.cos(cam.pitch), Math.sin(cam.pitch));
  gl.uniform2f(U.u_scale, cam.sx, cam.sy);
  gl.uniform2f(U.u_roll, Math.cos(cam.roll || 0), Math.sin(cam.roll || 0));
  gl.uniform2f(U.u_origin, cam.ox, cam.oy);
  gl.uniform2f(U.u_shift, cam.dx || 0, cam.dy || 0);
  gl.uniform1f(U.u_R, cam.R);
  gl.uniform1f(U.u_focal, cam.focal);
  gl.uniform1f(U.u_alpha, cam.alpha ?? 1);
  gl.uniform3fv(U.u_key, mat.key);
  gl.uniform3fv(U.u_fill, mat.fill);
  gl.uniform1f(U.u_gloss, mat.gloss);
  gl.uniform1f(U.u_sick, mat.sick);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, mat.ramp);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm); gl.vertexAttribPointer(A.nrm, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
  gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
}

export { RAMP_N };
