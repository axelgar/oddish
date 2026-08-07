// Router, boot, ambient audio, and the thing that makes the world twitch.

import * as R from './render.js';
import * as S from './state.js';
import * as Screens from './screens.js';

const ui = document.getElementById('ui');
const stage = document.getElementById('stage');

const hasGL = R.mount(
  document.getElementById('scene'),
  document.getElementById('scene-gl'),
  document.getElementById('scene-fx'),
);
// No second renderer, by decision. If the device can't draw the creature, say so
// and stop — a degraded creature would be worse than an honest message.
if (!hasGL) stage.classList.add('nogl');

/* ---------------------------------------------------------------- routes -- */

const ROUTES = [
  [/^\/o\/([\w-]+)$/,          (m) => (S.session.claimedEggs.includes(m[1]) ? Screens.f1({ eggId: m[1] }) : Screens.a1({ eggId: m[1] }))],
  [/^\/hatch\/([\w-]+)$/,      (m) => (S.session.claimedEggs.includes(m[1]) ? Screens.f1({ eggId: m[1] }) : Screens.a2({ eggId: m[1] }))],
  [/^\/claimed\/([\w-]+)$/,    (m) => Screens.f1({ eggId: m[1] })],
  [/^\/reveal\/([\w-]+)$/,     (m) => Screens.reveal({ id: m[1] })],
  [/^\/name\/([\w-]+)$/,       (m) => Screens.a6({ id: m[1] })],
  [/^\/coach$/,                () => Screens.a7()],
  [/^\/$/,                     () => Screens.b1()],
  [/^\/care$/,                 () => Screens.b2()],
  [/^\/act\/feed$/,            () => Screens.b3()],
  [/^\/act\/bathe$/,           () => Screens.b4()],
  [/^\/act\/play$/,            () => Screens.b5()],
  [/^\/act\/cuddle$/,          () => Screens.b6()],
  [/^\/act\/sleep$/,           () => Screens.b7()],
  [/^\/act\/groom$/,           () => Screens.groom()],
  [/^\/c\/([\w-]+)\/dress$/,   (m) => Screens.c2({ id: m[1] })],
  [/^\/c\/([\w-]+)\/photo$/,   (m) => Screens.c3({ id: m[1] })],
  [/^\/c\/([\w-]+)$/,          (m) => Screens.c1({ id: m[1] })],
  [/^\/dress$/,                () => Screens.c2({ id: S.active()?.id })],
  [/^\/field$/,                () => Screens.d1()],
  [/^\/fields$/,               () => Screens.d2()],
  [/^\/unlocked\/([\w-]+)$/,   (m) => Screens.d3({ fieldId: m[1] })],
  [/^\/save$/,                 () => Screens.e3()],
  [/^\/menu$/,                 () => Screens.e4()],
  [/^\/nag$/,                  () => Screens.e2()],
  [/^\/empty$/,                () => Screens.f2()],
];

let teardown = null;
let here = null;                              // the path currently on screen

function render() {
  const path = (location.hash.replace(/^#/, '') || '/').replace(/\/+$/, '') || '/';

  // Where we came from, recorded before the screen is built so it can read it while
  // assembling its markup. Only on a REAL move: screens re-render themselves in place
  // through hashchange (the dress tabs, the collection sort), and counting those would
  // set a screen's referrer to itself — its ✕ would then go nowhere.
  if (path !== here) { S.nav.from = here; here = path; }

  // The old screen packs up BEFORE the new one is built. Screen factories set the
  // scene as they go (b7 shuts the eyes to sleep), and a teardown that restores
  // eyeLid or bathing would otherwise land on top of it and undo the arrival.
  // The old markup is still in #ui here, so DOM-touching teardowns are unaffected.
  if (teardown) { try { teardown(); } catch { /* noop */ } teardown = null; }

  let out = null;
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) { out = fn(m); break; }
  }
  if (!out) out = S.active() ? Screens.b1() : Screens.f2();

  ui.innerHTML = out.html;
  const root = ui.firstElementChild || ui;
  stage.classList.toggle('dark', root.classList?.contains('dark'));
  stage.classList.toggle('flat', R.scene.hidden);
  if (out.mount) teardown = out.mount(root) || null;

  // E2 fires on top of home, never before the first creature is named
  if (path === '/' && S.shouldNag()) setTimeout(() => { if (location.hash.replace('#', '') === '/') location.hash = '#/nag'; }, 1400);
}

window.addEventListener('hashchange', render);

// Delegated navigation — data-go="#/path" on anything clickable.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]');
  if (!t) return;
  e.preventDefault();
  Screens.buzz(6);
  location.hash = t.dataset.go;
});

/* ----------------------------------------------------------------- audio -- */
// ponytail: synthesised, not sampled. Zero assets, and a detuned drone is
// creepier than anything I'd have licensed. Swap for per-field loops later.

let ac = null;
function startAudio() {
  if (ac || !S.session.sound) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const g = ac.createGain(); g.gain.value = 0.05; g.connect(ac.destination);
  [55, 55.6, 82.9].forEach((f, i) => {
    const o = ac.createOscillator();
    o.type = i === 2 ? 'triangle' : 'sine';
    o.frequency.value = f;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.07 + i * 0.03;
    const lg = ac.createGain(); lg.gain.value = 1.4;
    lfo.connect(lg).connect(o.frequency); lfo.start();
    o.connect(g); o.start();
  });
}
window.addEventListener('glitch:audio-unlock', startAudio);
window.addEventListener('pointerdown', startAudio, { once: true });

/** Menu toggles land here — keep the drone and the CSS durations honest, live. */
window.addEventListener('glitch:prefs', () => {
  document.documentElement.style.setProperty('--dur', S.session.reduceMotion ? '120ms' : '');
  if (ac) { if (S.session.sound) ac.resume(); else ac.suspend(); }
  else startAudio();   // fired from a tap, so the context is allowed to start
});

/* --------------------------------------------------------------- desktop -- */
// F3: clamp to 390px and scale the whole stage. Never reflow.

function fit() {
  // Same mobile test as the CSS media query. Phones scale UP to fill the screen
  // (still one fixed 390×844 coordinate space — scaled, never reflowed); desktop
  // keeps the phone-in-a-frame at natural size.
  const mobile = window.innerWidth <= 820 || matchMedia('(pointer: coarse)').matches;
  const cap = window.innerHeight * (mobile ? 1 : 0.82);
  let s = Math.min(cap / 844, window.innerWidth / 390);
  if (!mobile) s = Math.min(1, s);
  stage.style.transform = `scale(${s})`;
  document.querySelector('.stagewrap').style.height = `${844 * s}px`;
  document.querySelector('.stagewrap').style.width = `${390 * s}px`;
  // top-LEFT, so the scaled box lands exactly on the wrapper that is sized to hold it.
  // About 50% it shrank toward its own centre while the wrapper stayed put, leaving the
  // stage ~42px right of centre — visible as a fatter letterbox strip on the left.
  stage.style.transformOrigin = '0 0';
  // Whatever the scale leaves over at the sides, the world paints into — so the
  // backdrop runs edge to edge instead of sitting in a letterbox. Desktop keeps the
  // phone frame, so it gets none.
  R.setBleed(mobile ? (window.innerWidth / s - 390) / 2 : 0);
}
addEventListener('resize', fit);
fit();

/* ------------------------------------------------------------------ boot -- */

if (!location.hash) {
  // No tag scanned. With creatures → home. Fresh device → mint a demo egg so the
  // flow is walkable without an NFC tag (d1's CTA does the same); a real deploy
  // would send tagless fresh visitors to F2 instead.
  location.hash = S.session.creatures.length ? '#/' : `#/o/${Math.random().toString(36).slice(2, 8)}`;
} else render();

if (S.session.reduceMotion) document.documentElement.style.setProperty('--dur', '120ms');
