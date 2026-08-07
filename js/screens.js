// The 24 screens, in flow order. IDs match the hi-fi anchors (a1, b3, …).
// Each returns { html, mount? }. Navigation is delegated: put data-go="#/path" on anything.

import * as R from './render.js';
import * as S from './state.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const buzz = (ms = 8) => S.session.haptics && navigator.vibrate?.(ms);

const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);
const dmon = (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const nameOf = (c) => esc(c?.name || 'it');

const topbar = (c) => `
  <div class="top">
    <button class="chip" data-go="#/c/${c.id}">${nameOf(c)}</button>
    <button class="chip" data-go="#/field"><i style="width:9px;height:12px;border-radius:50%;background:#cbb193;display:block"></i>${S.session.creatures.length}</button>
  </div>`;

// ✕ closes to the creature; ← steps back into whatever pushed this screen. The icon
// is derived from the destination rather than passed in, so the two can never
// disagree — a ✕ that quietly went somewhere else is the thing this fixes.
const actionTop = (label, back = '#/') => `
  <div class="top">
    <button class="chip icon" data-go="${back}" aria-label="${back === '#/' ? 'Close' : 'Back'}"
      >${back === '#/' ? '✕' : '←'}</button>
    <span class="mono" style="font-size:11.5px;letter-spacing:.2em">${label}</span>
    <button class="chip icon" data-go="#/menu" aria-label="Menu">≡</button>
  </div>`;

// Screens reachable from several places have no one fixed home, so they step back to
// wherever they were opened from. Falls back when there is no previous screen — a
// reload, or a link straight in.
const backTo = (fallback) => (S.nav.from ? `#${S.nav.from}` : fallback);

const meterRow = (m) => `
  <div class="meters">${S.METERS.map((x) => `
    <div class="meter"><b>${x.label}</b><div class="bar"><i data-m="${x.k}" style="width:${m[x.k]}%;background:${x.color}"></i></div></div>`).join('')}</div>`;

/* ============================================================ FLOW A ==== */

export function a1({ eggId }) {
  R.set({ mode: 'egg', field: 'meadow', groundTop: 500, props: false, decay: 0, hidden: false,
    pose: { x: 195, y: 700, scale: 1 }, crackStage: 2, hold: 0, wander: false });
  return { html: `
    <div class="screen">
      <div class="wordmark"><span class="mark">GLITCH</span></div>
      <div class="hd" style="top:150px">
        <div class="mono eyebrow">ODDISH · TABLE 4 · ${hhmm(Date.now())}</div>
        <div class="disp" style="font-size:40px">Something came<br>with your drink</div>
      </div>
      <div class="dock" style="background:linear-gradient(rgba(57,111,64,0),rgba(34,64,58,.5) 60%)">
        <button class="cta" style="margin-bottom:12px" data-go="#/hatch/${eggId}">
          <div><b>Wake it up</b><span>NO ACCOUNT NEEDED</span></div><i>→</i></button>
        <div class="mono" style="font-size:10.5px;letter-spacing:.1em;text-align:center;color:rgba(255,253,245,.75)">ONE EGG PER ODDISH</div>
      </div>
    </div>` };
}

/** A2 idle + A3 warming are one screen — the hold IS the transition. */
export function a2({ eggId }) {
  R.set({ mode: 'egg', field: 'meadow', groundTop: 500, props: false, hidden: false,
    pose: { x: 195, y: 686, scale: 1 }, crackStage: 2, hold: 0, wander: false });

  const html = `
    <div class="screen">
      <div class="wordmark"><span class="mark">GLITCH</span></div>
      <div class="hd" style="top:160px">
        <div class="disp" id="a-hd" style="font-size:40px">It's cold.<br>Warm it up.</div>
        <div class="mono" id="a-note" style="font-size:11.5px;margin-top:18px;opacity:.6">PRESS AND HOLD</div>
      </div>
      <button class="holdbtn" id="hold" aria-label="Press and hold to hatch">
        <span class="halo"></span>
        <svg class="ring" viewBox="0 0 82 82" width="82" height="82">
          <circle cx="41" cy="41" r="38.5" fill="none" stroke="rgba(255,253,245,.35)" stroke-width="3.5"/>
          <circle id="ringfill" cx="41" cy="41" r="38.5" fill="none" stroke="#FFFDF5" stroke-width="3.5"
                  stroke-linecap="round" stroke-dasharray="242" stroke-dashoffset="242"/>
        </svg>
        <span class="core"></span>
      </button>
    </div>`;

  function mount() {
    // rarity is decided on the FIRST tap, not at completion — the tell is duration.
    const mat = S.rollMaterial(String(eggId));
    const DUR = mat.id === 'gold' ? 3600 : mat.rare ? 3000 : 2400;
    const ring = $('#ringfill'), hd = $('#a-hd'), note = $('#a-note');
    // stage starts at 2 to match crackStage above, or the first tick buzzes untouched
    let holding = false, start = 0, stage = 2, raf = 0, done = false;

    const stop = () => { holding = false; };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (done) return;
      const p = holding
        ? Math.min(1, (performance.now() - start) / DUR)
        : Math.max(0, R.scene.hold - 0.04);                 // release rewinds, no penalty
      R.scene.hold = p;
      ring.setAttribute('stroke-dashoffset', String(242 * (1 - p)));
      const st = Math.min(4, Math.floor(p * 4) + 2);
      if (st !== stage) { stage = st; R.scene.crackStage = st; buzz(6); }
      if (holding && Math.random() < 0.14) R.emit('spark', 1, { x: 195, y: 640, spread: 90 });
      if (p >= 1) {
        done = true; cancelAnimationFrame(raf); buzz(30);
        R.emit('shard', 22, { x: 195, y: 620, spread: 120 });
        const c = S.hatch(eggId, { table: 4 });
        setTimeout(() => { location.hash = `#/reveal/${c.id}`; }, mat.rare ? 400 : 260);
      }
    };
    raf = requestAnimationFrame(tick);

    const begin = (e) => {
      e.preventDefault();
      if (done) return;
      holding = true;
      start = performance.now() - R.scene.hold * DUR;
      hd.innerHTML = 'Something’s<br>moving.';
      note.textContent = 'KEEP HOLDING';
      buzz(4);
      window.dispatchEvent(new Event('glitch:audio-unlock'));
    };
    const stage_ = $('#stage');
    const ac = new AbortController();                  // one teardown for all four
    stage_.addEventListener('pointerdown', begin, { signal: ac.signal });
    stage_.addEventListener('pointerup', stop, { signal: ac.signal });
    stage_.addEventListener('pointercancel', stop, { signal: ac.signal });
    stage_.addEventListener('pointerleave', stop, { signal: ac.signal });
    return () => { cancelAnimationFrame(raf); ac.abort(); };
  }
  return { html, mount };
}

// The headline states the real odds. gold 1:200 · crystal 1:80 · neon 1:40 · foil 1:20.
const ODDS_WORD = { gold: 'two hundred', crystal: 'eighty', neon: 'forty', foil: 'twenty' };

/** A4 common / A5 rare — same screen, the rare one earns the dark cut. */
export function reveal({ id }) {
  const c = S.creatureById(id);
  if (!c) return f2();
  const rare = c.rarity !== 'Common';
  R.set({ mode: 'creature', creature: c, field: rare ? 'reveal' : 'meadow', groundTop: rare ? 660 : 500,
    props: false, hidden: false, decay: 0, wander: false,
    pose: { x: 195, y: rare ? 790 : 770, scale: rare ? 1.16 : 1.10 } });
  R.squash(); R.glitch(220);
  if (rare) R.emit('spark', 26, { x: 195, y: 620, spread: 220 });

  const traits = [`${c.traits.fronds} fronds`, S.PALETTES[c.traits.palette].label, c.traits.bodyShape];
  const html = `
    <div class="screen${rare ? ' dark' : ''}">
      <div class="hd" style="top:${rare ? 118 : 132}px">
        ${rare ? `<div class="plate">${c.rarity.toUpperCase()}</div>` : ''}
        ${rare ? '' : `<div class="mono eyebrow">HATCHED · ${hhmm(c.hatchedAt)} · TABLE ${c.origin.table}</div>`}
        <div class="disp" style="font-size:${rare ? 42 : 44}px;margin-top:${rare ? 20 : 0}px;color:${rare ? '#FFF6E0' : 'inherit'}">
          ${rare ? `One in<br>${ODDS_WORD[c.material] || 'a few'}.` : 'Hello.'}</div>
        ${rare ? `<div class="mono" style="font-size:11px;margin-top:14px;color:rgba(255,246,224,.55)">FIRST ${c.rarity.toUpperCase()} AT GLITCH SINCE ${dmon(Date.now() - 6e8)}</div>` : ''}
      </div>
      ${rare ? '' : `<div style="position:absolute;left:0;right:0;top:290px;display:flex;gap:7px;justify-content:center;z-index:6" id="traits">
        ${traits.map((t, i) => `<span class="chip" style="font-size:12px;padding:7px 13px;opacity:0;animation:fade 300ms ease-out ${i * 120 + 200}ms forwards">${esc(t)}</span>`).join('')}
      </div>`}
      <div class="dock" style="background:linear-gradient(${rare ? 'rgba(12,31,40,0),rgba(12,31,40,.94) 44%' : 'rgba(255,253,245,0),rgba(255,253,245,.94) 44%'})">
        <button class="cta${rare ? ' gold' : ''}" data-go="#/name/${c.id}">
          <div><b>Give it a name</b><span>${c.rarity.toUpperCase()} · 1 OF ${S.session.creatures.length} YOURS</span></div><i>→</i></button>
      </div>
    </div>`;
  return { html };
}

export function a6({ id }) {
  const c = S.creatureById(id);
  if (!c) return f2();
  R.set({ mode: 'creature', creature: c, field: S.session.activeFieldId, groundTop: 540, props: false,
    hidden: false, wander: false, pose: { x: 195, y: 560, scale: 0.72 } });
  const sugg = S.suggestNames(c);
  const html = `
    <div class="screen">
      <div style="position:absolute;top:96px;left:28px;right:28px;z-index:6">
        <div class="disp" style="font-size:34px">What do you<br>want to call it?</div>
      </div>
      <form class="sheet" id="namesheet" style="padding-bottom:20px">
        <div class="namefield">
          <input id="nm" maxlength="14" autocomplete="off" autocapitalize="words" spellcheck="false"
                 placeholder="${esc(sugg[0])}" aria-label="Name">
        </div>
        <div class="wrap" style="margin-top:14px">
          ${sugg.map((s) => `<button type="button" class="chip flat sug" style="font-size:12.5px">${esc(s)}</button>`).join('')}
        </div>
        <div class="note" style="margin:14px 0 16px" id="nmnote">TAP A SUGGESTION OR TYPE YOUR OWN · 14 MAX</div>
        <button class="cta" type="submit"><div><b>That's the one</b></div><i>→</i></button>
      </form>
    </div>`;

  function mount() {
    const input = $('#nm'), note = $('#nmnote');
    $$('.sug').forEach((b) => b.onclick = () => { input.value = b.textContent; input.focus(); });
    $('#namesheet').onsubmit = (e) => {
      e.preventDefault();
      const v = (input.value || input.placeholder).trim();
      if (!v) return;
      if (!S.clean(v)) { input.value = ''; note.textContent = 'TRY ANOTHER ONE'; return; }  // silent, just re-prompts
      c.name = v; S.save(); buzz(12);
      const newFields = S.unlockCheck();
      location.hash = newFields.length ? `#/unlocked/${newFields[0].id}`
        : S.session.hasSeenCoach ? '#/' : '#/coach';
    };
    input.focus({ preventScroll: true });
  }
  return { html, mount };
}

export function a7() {
  const c = S.view(S.active());
  R.set({ mode: 'creature', creature: c, field: S.session.activeFieldId, groundTop: 404, props: true,
    hidden: false, wander: false, pose: { x: 195, y: 676, scale: 0.94 } });
  const html = `
    <div class="screen">
      <div class="scrim"></div>
      <div style="position:absolute;left:45px;right:45px;top:250px;text-align:center;z-index:9;color:#FFFDF5">
        <div class="disp" style="font-size:32px">${nameOf(c)} lives here now</div>
        <div class="sub" style="margin-top:12px;color:rgba(255,253,245,.8)">Tap things in the field to take care of it. Everything else is in the tray at the bottom.</div>
      </div>
      <svg style="position:absolute;left:210px;top:390px;width:110px;height:90px;z-index:9" viewBox="0 0 110 90">
        <path d="M6 84 C 30 84, 40 50, 96 18" fill="none" stroke="#FFFDF5" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="1 7"/>
        <path d="M96 18 l-14 3 M96 18 l1 14" fill="none" stroke="#FFFDF5" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <div style="position:absolute;left:0;right:0;bottom:0;padding:16px 20px 26px;z-index:9">
        <div class="grab" style="background:rgba(255,253,245,.4)"></div>
        <div class="row">${['Feed:#D9556E', 'Bathe:#8FC9DC', 'Play:#F0C65A', 'Cuddle:#B9A6D9'].map((t) => {
          const [n, col] = t.split(':');
          return `<div class="tile" style="background:rgba(255,253,245,.16);box-shadow:inset 0 0 0 1px rgba(255,253,245,.3)">
            <div class="dot" style="background:${col}"></div><div class="tl" style="color:#FFFDF5">${n}</div></div>`;
        }).join('')}</div>
      </div>
    </div>`;
  function mount(root) {
    root.onclick = () => { S.session.hasSeenCoach = true; S.save(); location.hash = '#/'; };
  }
  return { html, mount };
}

/* ============================================================ FLOW B ==== */

/** B1 home / E1 return-after-decay — same screen, decay is just state. */
export function b1() {
  const raw = S.active();
  if (!raw) return f2();
  const c = S.view(raw);
  const away = c.away;
  const dec = Math.min(1, away / 4);
  const f = S.fieldById(S.session.activeFieldId);
  // only meadow swaps its world to the night skin, so only meadow may go dark —
  // otherwise a bright field at 3am gets light chrome on a light sky
  const night = f.dark || (nightNow() && f.id === 'meadow');
  R.set({ mode: 'creature', creature: c, field: night && f.id === 'meadow' ? 'night' : f.id,
    groundTop: 404, props: true, hidden: false, decay: dec, wander: true,
    pose: { x: 195, y: 676, scale: 0.94 } });

  const low = S.lowestMeter(c.meters);
  const thought = away >= 1 ? 'missed you' : S.meterSays(low, c.meters[low.k]);
  const order = [...S.METERS].sort((a, b) => c.meters[a.k] - c.meters[b.k]);

  const html = `
    <div class="screen${night ? ' dark' : ''}">
      ${topbar(c)}
      ${away >= 1 ? `<div class="hd mono" style="top:118px;font-size:11px;opacity:.7">AWAY ${away} DAY${away > 1 ? 'S' : ''}</div>` : ''}
      <button class="chip" id="thought" data-go="#/act/${low.act}"
        style="position:absolute;left:50%;transform:translateX(-50%);top:383px;z-index:6;background:#FFFDF5;color:#8A5A2C;box-shadow:0 6px 14px -6px rgba(0,0,0,.3)">${thought}</button>
      <span class="oc" id="oc1" style="left:34px;top:${404 + 60}px">PUDDLE</span>
      <span class="oc" id="oc2" style="right:26px;top:${404 + 22}px;color:#8A3A48">BERRIES</span>
      <span class="oc" id="oc3" style="left:36px;bottom:184px;color:#6B4A2E">LOG</span>
      ${away >= 1 ? `<div style="position:absolute;left:24px;right:24px;bottom:172px;z-index:7">
        <button class="cta" id="sortit"><div><b>Sort it out</b><span>RUNS THE THREE LOWEST · UNDER A MINUTE</span></div><i>→</i></button></div>` : ''}
      <div class="dock" id="dock">
        <div class="grab"></div>
        <div class="row">${order.map((m) => `
          <button class="tile" data-go="#/act/${m.act}">
            <div class="dot" style="background:${m.color}"></div><div class="tl">${m.act[0].toUpperCase() + m.act.slice(1)}</div>
          </button>`).join('')}</div>
      </div>
    </div>`;

  function mount(root) {
    // tapping a prop walks the creature over and opens its action
    const props = [
      { sel: '#oc1', act: 'bathe' }, { sel: '#oc2', act: 'feed' }, { sel: '#oc3', act: 'sleep' },
    ];
    props.forEach((p) => $(p.sel, root)?.addEventListener('click', () => { location.hash = `#/act/${p.act}`; }));
    $('#sortit', root)?.addEventListener('click', () => {
      S.sortItOut(raw); buzz(20); R.emit('heart', 10);
      location.hash = '#/care';
    });
    // drag the dock up → the care sheet (148 ↔ 492 detents)
    const undrag = dragToCare(root);
    // tap the creature itself → the cuddle reaction, minus the hold and the gains.
    // ponytail: no petting meter, this is affection with nothing attached.
    const stage = $('#stage');
    let squint = 0;
    const pet = (e) => {
      // the props and the dock sit inside the hit ellipse once it wanders left —
      // a tap on one of those is a navigation, not a pet
      if (e.target.closest('button, .oc, .dock')) return;
      const r = stage.getBoundingClientRect();
      const sx = (e.clientX - r.left) / (r.width / R.W), sy = (e.clientY - r.top) / (r.height / R.H);
      if (!R.hitCreature(sx, sy)) return;
      R.scene.eyeLid = 0.14; R.wiggle(0.5); R.squash(0.14, 0.5);
      buzz(6);
      clearTimeout(squint);
      squint = setTimeout(() => { R.scene.eyeLid = 1; }, 600);
    };
    stage.addEventListener('pointerdown', pet);
    // labels fade in only while it's idle, so they never fight the animation.
    // "idle" = it stopped moving, not "it happens to stand at screen centre".
    let px = R.scene.pose.x, py = R.scene.pose.y;
    let t = setInterval(() => {
      const moving = Math.hypot(R.scene.pose.x - px, R.scene.pose.y - py) > 1.5;
      px = R.scene.pose.x; py = R.scene.pose.y;
      $$('.oc', root).forEach((e) => e.style.opacity = moving ? 0 : 1);
    }, 400);
    return () => {
      clearInterval(t); undrag(); clearTimeout(squint);
      stage.removeEventListener('pointerdown', pet);
      R.scene.eyeLid = 1;   // or leaving mid-squint carries shut eyes to the next screen
    };
  }
  return { html, mount };
}

function dragToCare(root) {
  const dock = $('#dock', root); if (!dock) return () => {};
  let y0 = null, pid = null;
  // a mouse drag starting on the grab handle exits the dock ~18px before the threshold,
  // so the move has to be tracked on the window. Capturing the pointer on #dock would
  // also work, but it retargets the tap's click to #dock and the tiles stop navigating.
  // pid, because the capture used to bind the gesture to one pointer and no longer does —
  // without it a second finger anywhere on screen drags the dock open.
  const move = (e) => {
    if (y0 == null || e.pointerId !== pid) return;
    if (y0 - e.clientY > 34) { y0 = null; buzz(6); location.hash = '#/care'; }
  };
  const end = (e) => { if (e.pointerId === pid) y0 = null; };
  dock.addEventListener('pointerdown', (e) => { y0 = e.clientY; pid = e.pointerId; });
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  return () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  };
}

/** Drag a .sheet down to put it away: it follows the finger and snaps back if you
 *  don't pull far enough.
 *
 *  Dismissing a sheet reveals what the sheet was covering, so `to` is the creature —
 *  NOT whatever screen pushed this one. That is the ✕'s job, and keeping the two
 *  apart is what stops them being two controls for the same thing.
 *
 *  Track the move on the window and bind it to the pointer that started it, or a
 *  second finger anywhere on screen can throw the drawer closed. */
function sheetDrag(root, { sheet = '#sheet', handle = '.grab', to = '#/' } = {}) {
  const el = $(sheet, root); if (!el) return () => {};
  let y0 = null, dy = 0, pid = null;
  const down = (e) => {
    // from the handle, or from a list already at the top — otherwise scrolling the
    // drawer's own content downward would throw it closed
    if (el.scrollTop > 0 && !e.target.closest(handle)) return;
    y0 = e.clientY; pid = e.pointerId; dy = 0;
    el.classList.remove('snap');
  };
  const move = (e) => {
    if (y0 == null || e.pointerId !== pid) return;
    dy = Math.max(0, e.clientY - y0);
    el.style.transform = `translateY(${dy}px)`;
  };
  const up = (e) => {
    if (y0 == null || e.pointerId !== pid) return;
    el.classList.add('snap');
    if (dy > 90) { buzz(6); location.hash = to; } else el.style.transform = '';
    y0 = null; dy = 0;
  };
  el.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
}

export function b2() {
  const raw = S.active(); if (!raw) return f2();
  const c = S.view(raw);
  R.set({ mode: 'creature', creature: c, field: S.session.activeFieldId, groundTop: 404, props: true,
    hidden: false, wander: false, pose: { x: 195, y: 300, scale: 0.52 } });
  const acts = [
    ['Feed', '#D9556E', '#/act/feed'], ['Bathe', '#8FC9DC', '#/act/bathe'], ['Cuddle', '#B9A6D9', '#/act/cuddle'],
    ['Play', '#F0C65A', '#/act/play'], ['Sleep', '#7F9AC4', '#/act/sleep'], ['Groom', '#69A86B', '#/act/groom'],
    ['Dress', '#C98A5E', `#/c/${c.id}/dress`], ['Photo', '#8E8FA8', `#/c/${c.id}/photo`], ['Details', '#22403A', `#/c/${c.id}`],
  ];
  const html = `
    <div class="screen">
      ${topbar(c)}
      <div class="sheet snap" id="sheet" style="top:352px;bottom:0;display:flex;flex-direction:column">
        <div class="grab" id="grab" style="margin-bottom:16px"></div>
        ${meterRow(c.meters)}
        <div class="grid3">${acts.map(([n, col, href]) => `
          <button class="act" data-go="${href}"><div class="dot" style="background:${col}"></div><div class="tl">${n}</div></button>`).join('')}</div>
        <div class="row" style="margin-top:auto;padding-top:18px">
          <button class="card" data-go="#/fields"><div class="k">Field</div><div class="v">${S.fieldById(S.session.activeFieldId).name}</div></button>
          <button class="card" data-go="#/field"><div class="k">Yours</div><div class="v">${S.session.creatures.length} creature${S.session.creatures.length === 1 ? '' : 's'}</div></button>
        </div>
      </div>
    </div>`;
  function mount(root) {
    return sheetDrag(root);          // down puts the drawer away, back to the creature
  }
  return { html, mount };
}

/* -- B3 Feed ------------------------------------------------------------- */

export function b3() {
  const raw = S.active(); if (!raw) return f2();
  const c = S.view(raw);
  R.set({ mode: 'creature', creature: c, field: S.session.activeFieldId, groundTop: 404, props: true,
    hidden: false, wander: false, pose: { x: 195, y: 700, scale: 1.06 } });
  const html = `
    <div class="screen">
      ${actionTop('FEEDING')}
      <div class="hd" style="top:132px">
        <div class="disp" style="font-size:30px">Drag a berry to ${nameOf(c)}</div>
        <div class="mono" style="font-size:11px;opacity:.55;margin-top:10px">IT WON'T EAT WHAT IT DOESN'T LIKE</div>
      </div>
      ${S.session.hasFed ? '' : `<svg style="position:absolute;left:150px;top:430px;width:110px;height:170px;z-index:6" viewBox="0 0 110 170" aria-hidden="true">
        <path d="M96 162 C 96 100, 70 54, 12 12" fill="none" stroke="rgba(255,253,245,.75)" stroke-width="2.5" stroke-dasharray="1 7" stroke-linecap="round"/>
      </svg>`}
      <div class="actionbar">
        <div class="progress"><i id="fed" style="width:${c.meters.hunger}%"></i></div>
        <div class="row" style="justify-content:center">
          ${S.BERRY_KINDS.map((kind, i) => `<button class="orb prop berry" data-i="${i}" data-kind="${kind}" aria-label="${S.BERRY_NAMES[i]}"></button>`).join('')}
        </div>
      </div>
    </div>`;

  function mount(root) {
    const bar = $('#fed', root);
    const buttons = $$('.berry', root);

    // The berries are real geometry, baked once through the same GL context the
    // creature uses — which means the bake scribbles over the live creature frame.
    // Do it in a plain task, never in rAF: the render loop's own rAF then clears and
    // redraws before the browser paints, so the scribble is never composited. A
    // retry (context mid-restore) stays on setTimeout for exactly the same reason.
    let paint = 0;
    const fill = () => {
      const left = buttons.filter((b) => {
        const cv = R.berrySprite(b.dataset.kind);
        if (!cv) return true;
        cv.style.cssText = 'width:60px;height:60px;display:block';
        if (b.firstChild) b.replaceChild(cv, b.firstChild); else b.append(cv);
        return false;
      });
      if (left.length) paint = setTimeout(fill, 120);
    };
    fill();

    buttons.forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const i = +b.dataset.i;
        const ghost = document.createElement('div');
        ghost.className = 'orb drag';
        const baked = R.berrySprite(b.dataset.kind);
        if (baked) { const g = baked.cloneNode(); g.getContext('2d').drawImage(baked, 0, 0);
          g.style.cssText = 'width:60px;height:60px;display:block'; ghost.append(g); }
        document.body.append(ghost);
        const at = (ev) => { ghost.style.transform = `translate(${ev.clientX}px,${ev.clientY}px)`; };
        at(e);
        const move = (ev) => at(ev);
        // a cancelled pointer (call, gesture takeover) must not strand the ghost
        const cancel = () => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', cancel);
          ghost.remove();
        };
        const up = (ev) => {
          cancel();
          const r = $('#stage').getBoundingClientRect();
          const sx = (ev.clientX - r.left) / (r.width / R.W), sy = (ev.clientY - r.top) / (r.height / R.H);
          if (!R.hitCreature(sx, sy)) return;
          if (!S.session.hasFed) { S.session.hasFed = true; S.save(); $('svg', root)?.remove(); }
          if (i === c.traits.favouriteBerry) {            // 2× hunger + a joy bonus, one care
            S.care(raw, 'feed', 2);
            R.chew(0.9); R.squash(0.16, 0.55);              // gulp, then a happy chew
            R.emit('heart', 6); buzz(14);
          } else {
            R.shakeHead(); buzz(4);                         // politely declined, no meter change
            R.scene.mouth = 0.3;
            setTimeout(() => { R.scene.mouth = 0; }, 500);
          }
          bar.style.width = `${S.decayed(raw.meters, raw.lastSeenAt).hunger}%`;
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
      });
    });
    return () => clearTimeout(paint);
  }
  return { html, mount };
}

/* -- B4 Bathe ------------------------------------------------------------ */

export function b4() {
  const raw = S.active(); if (!raw) return f2();
  const c = S.view(raw);
  R.set({ mode: 'creature', creature: c, field: S.session.activeFieldId, groundTop: 330, props: false,
    hidden: false, wander: false, bathing: true, pose: { x: 195, y: 720, scale: 1.24 } });
  const spots = R.mudSpots(raw);
  spots.forEach((s) => s.erased = false);
  const html = `
    <div class="screen">
      ${actionTop('BATHING')}
      <div class="hd" style="top:132px">
        <div class="disp" style="font-size:30px">Scrub the mud off</div>
        <div class="mono" style="font-size:11px;opacity:.55;margin-top:10px">SWIPE ANYWHERE ON ${nameOf(c).toUpperCase()}</div>
      </div>
      <div class="actionbar">
        <div class="progress"><i id="wash" style="width:0%"></i></div>
        <div class="row">
          ${['Soap', 'Splash', 'Rinse'].map((s) => `<button class="chip sub3" style="flex:1;justify-content:center;background:rgba(255,253,245,.92);padding:15px 0;font-size:14px">${s}</button>`).join('')}
        </div>
      </div>
    </div>`;

  function mount(root) {
    const bar = $('#wash', root);
    let down = false, done = false, doneT = 0;
    const stage = $('#stage');
    const erase = (ev) => {
      if (!down || done) return;
      const r = stage.getBoundingClientRect();
      const sx = (ev.clientX - r.left) / (r.width / R.W), sy = (ev.clientY - r.top) / (r.height / R.H);
      if (!R.hitCreature(sx, sy)) return;
      const live = spots.filter((s) => !s.erased);
      if (live.length) {
        // scrub where the finger is: erase the nearest spot, not spots[0].
        // yaw ≈ 0 on this screen, so body-space x/y maps straight to the stage.
        const cx = R.scene.pose.x, cy = R.scene.pose.y - 128 * R.scene.pose.scale, k = 92 * R.scene.pose.scale;
        live.sort((a, b) => Math.hypot(cx + a.x * k - sx, cy - a.y * k - sy)
                          - Math.hypot(cx + b.x * k - sx, cy - b.y * k - sy));
        live[0].erased = true;
        R.emit('bubble', 4, { x: sx, y: sy, spread: 24, up: 0.4 });
        R.wiggle(0.35); R.scene.eyeLid = 0.6; buzz(3);        // it likes this
      }
      const pct = Math.round((1 - live.length / spots.length + 1 / spots.length) * 100);
      bar.style.width = `${Math.min(100, pct)}%`;
      // the bar tracks scrub progress; clean itself must only ever rise during a
      // bath, or one swipe on a mostly-clean creature drops it to ~17
      raw.meters.clean = Math.max(raw.meters.clean, Math.min(100, 8 + pct * 0.92));
      if (live.length <= 1) {
        done = true; S.care(raw, 'bathe'); buzz(20);
        R.scene.eyeLid = 1;
        R.wiggle(0.9); R.squash(0.18, 0.7);                   // the shake-off
        R.emit('droplet', 40, { spread: 200, up: 0.6 });
        R.emit('heart', 5);
        doneT = setTimeout(() => { location.hash = '#/'; }, 1200);
      }
    };
    const ac = new AbortController();
    const rest = () => { down = false; if (!done) R.scene.eyeLid = 1; };
    stage.addEventListener('pointerdown', (e) => { down = true; erase(e); }, { signal: ac.signal });
    stage.addEventListener('pointermove', erase, { signal: ac.signal });
    window.addEventListener('pointerup', rest, { signal: ac.signal });
    window.addEventListener('pointercancel', rest, { signal: ac.signal });
    $$('.sub3', root).forEach((b) => b.onclick = () => { R.emit('bubble', 10); R.wiggle(0.4); buzz(6); });
    return () => { ac.abort(); clearTimeout(doneT); R.set({ bathing: false, eyeLid: 1 }); };
  }
  return { html, mount };
}

/* -- B5 Play ------------------------------------------------------------- */

export function b5() {
  const raw = S.active(); if (!raw) return f2();
  const c = S.view(raw);
  R.set({ mode: 'creature', creature: c, field: S.session.activeFieldId, groundTop: 404, props: true,
    hidden: false, wander: false, pose: { x: 195, y: 660, scale: 0.9 } });
  const html = `
    <div class="screen">
      ${actionTop('PLAYING')}
      <div class="hd" style="top:132px">
        <div class="disp" style="font-size:30px">Flick the ball</div>
        <div class="mono" style="font-size:11px;opacity:.55;margin-top:10px">HARDER THROWS GO FURTHER</div>
      </div>
      <div style="position:absolute;right:24px;top:118px;z-index:6"><span class="chip mono" id="streak" style="font-size:12px">0 ×</span></div>
      <div id="praise" style="position:absolute;left:50%;transform:translateX(-50%);top:300px;z-index:7;opacity:0;transition:opacity 200ms">
        <span class="chip" style="background:#FFFDF5">good one</span></div>
      <div class="actionbar"><div class="row" style="justify-content:center">
        <button class="orb prop" id="seed"></button></div>
        <div class="note" style="text-align:center;margin-top:12px">FLICK UPWARD</div>
      </div>
    </div>`;

  function mount(root) {
    const seed = $('#seed', root), streakEl = $('#streak', root), praise = $('#praise', root);
    let streak = 0;

    // same deal as the berries: bake in a plain task so the render loop's rAF clears
    // the scribble off the shared GL canvas before the browser ever paints it
    let paint = 0;
    const fill = () => {
      const cv = R.ballSprite();
      if (!cv) { paint = setTimeout(fill, 120); return; }
      cv.style.cssText = 'width:60px;height:60px;display:block';
      if (seed.firstChild) seed.replaceChild(cv, seed.firstChild); else seed.append(cv);
    };
    fill();

    seed.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const y0 = e.clientY;
      let last = { x: e.clientX, y: e.clientY, t: performance.now() }, vel = 0;
      const move = (ev) => {
        const now = performance.now();
        // dt floored: coalesced moves can arrive 0-1ms apart and read as 14000px/s
        const dt = Math.max(now - last.t, 6);
        // the PEAK of the flick, not the last sample. A hand always settles before it
        // lets go, so the final segment is near-zero however hard the throw was —
        // reading only that made a good flick score 3 and fail.
        vel = Math.max(vel, Math.hypot(ev.clientX - last.x, ev.clientY - last.y) / dt * 1000);
        last = { x: ev.clientX, y: ev.clientY, t: now };
      };
      const cancel = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      };
      const up = () => {
        cancel();
        const good = vel > 420 && y0 - last.y > 14;   // fast AND upward — the note means it
        // the seed really flies; score, praise and the catch all land when it does
        const ms = R.throwBall(vel, good);
        buzz(4);
        setTimeout(() => {
          if (good) {
            streak++; S.care(raw, 'play'); buzz(12);
            praise.style.opacity = 1; setTimeout(() => praise.style.opacity = 0, 900);
          } else {
            streak = 0; S.care(raw, 'play', 0.35); R.shakeHead();   // sulks 2s, joy still moves
            R.scene.eyeLid = 0.5; setTimeout(() => { R.scene.eyeLid = 1; }, 1800);
          }
          streakEl.textContent = `${streak} ×`;
        }, ms);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    });
    return () => clearTimeout(paint);
  }
  return { html, mount };
}

/* -- B6 Cuddle ----------------------------------------------------------- */

export function b6() {
  const raw = S.active(); if (!raw) return f2();
  const c = S.view(raw);
  R.set({ mode: 'creature', creature: c, field: S.session.activeFieldId, groundTop: 404, props: false,
    hidden: false, wander: false, pose: { x: 195, y: 660, scale: 1.1 } });
  const html = `
    <div class="screen">
      ${actionTop('')}
      <div class="hd" style="top:140px"><div class="disp" style="font-size:30px">Hold it</div></div>
      <div id="ring" style="position:absolute;left:50%;top:470px;transform:translate(-50%,-50%);width:150px;height:150px;
        border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(34,64,58,.25);z-index:7"></div>
    </div>`;
  function mount(root) {
    // no counters, no scoring. Deliberately the quietest screen.
    // Gains accrue during the hold and land as ONE care() on release —
    // 27 localStorage writes a second is not a purr.
    let holding = false, iv = 0, ticks = 0;
    const settle = () => {
      if (!ticks) return;
      S.care(raw, 'cuddle', Math.min(2, ticks * 0.012));   // ~3s ≈ one cuddle, capped at 2×
      ticks = 0;
    };
    const on = () => {
      clearInterval(iv);                       // second finger must not stack purr loops
      holding = true; R.scene.eyeLid = 0.14;
      iv = setInterval(() => {
        if (!holding) return;
        ticks++;
        R.emit('heart', 1, { spread: 40 });
        buzz(3);                                    // ~28Hz purr, approximated by the vibrate floor
      }, 36);
    };
    const off = () => { holding = false; R.scene.eyeLid = 1; clearInterval(iv); settle(); };
    const stage = $('#stage');
    stage.addEventListener('pointerdown', on);
    window.addEventListener('pointerup', off);
    window.addEventListener('pointercancel', off);   // or a cancelled hold purrs forever
    return () => {
      off();
      stage.removeEventListener('pointerdown', on);
      window.removeEventListener('pointerup', off);
      window.removeEventListener('pointercancel', off);
    };
  }
  return { html, mount };
}

/* -- B7 Sleep / night field --------------------------------------------- */

export function b7() {
  const raw = S.active(); if (!raw) return f2();
  const c = S.view(raw);
  R.set({ mode: 'creature', creature: c, field: 'night', groundTop: 404, props: true,
    hidden: false, wander: false, eyeLid: 0.08, pose: { x: 108, y: 620, scale: 0.78 } });
  S.care(raw, 'sleep', 0.25);
  const html = `
    <div class="screen dark">
      ${actionTop('SLEEPING')}
      <div class="hd" style="top:140px">
        <div class="disp" style="font-size:30px;color:#E8ECF7">Shh.<br>It's dozing off.</div>
        <div class="mono" style="font-size:11px;margin-top:14px;color:rgba(232,236,247,.6)">REST REFILLS OVER 6 HOURS · WAKING EARLY COSTS NOTHING</div>
      </div>
      <div style="position:absolute;left:190px;top:520px;z-index:7;color:#E8ECF7" class="mono">
        <span style="font-size:12px;opacity:.5">z</span>
        <span style="font-size:16px;opacity:.7">Z</span>
        <span style="font-size:22px;opacity:.9">Z</span>
      </div>
      <div class="dock" style="background:linear-gradient(rgba(24,42,68,0),rgba(24,42,68,.9) 46%)">
        <button class="cta" data-go="#/" style="background:#E8ECF7"><div><b style="color:#182A44">Wake it</b><span style="color:rgba(24,42,68,.7)">NO PENALTY</span></div><i style="background:#182A44;color:#E8ECF7">→</i></button>
      </div>
    </div>`;
  function mount() { return () => { R.set({ eyeLid: 1 }); }; }
  return { html, mount };
}

export function groom() {
  const raw = S.active(); if (!raw) return f2();
  S.care(raw, 'groom'); buzz(10); R.emit('spark', 8);
  // replace, don't push — Back must not land on /act/groom and groom again
  location.replace('#/care');
  return { html: '' };
}

/* ============================================================ FLOW C ==== */

export function c1({ id }) {
  const raw = S.creatureById(id); if (!raw) return f2();
  const c = S.view(raw);
  // 0.56, not 0.62: this is the one screen that spins a full 360°, and the crown is
  // tall enough now that at 0.62 most genomes lose their leaf tips off the top of the
  // stage at some yaw. Scale is the knob rather than y — pose.y IS the ground contact,
  // so dropping it puts the feet under the sheet at top:352 instead.
  R.set({ mode: 'creature', creature: c, field: S.session.activeFieldId, groundTop: 404, props: false,
    hidden: false, wander: false, pose: { x: 195, y: 330, scale: 0.56 } });
  const t = c.traits;
  const chips = [`${t.fronds} fronds`, S.PALETTES[t.palette].label, t.bodyShape, `${t.eyeType} eyes`,
    c.material === 'common' ? 'matte' : c.material, `likes ${S.BERRY_NAMES[t.favouriteBerry]}`];
  const rows = [
    ['GENOME', c.genomeSeed],
    ['HATCHED', `${new Date(c.hatchedAt).toLocaleDateString('en-GB')} · ${hhmm(c.hatchedAt)}`],
    ['FROM', `${c.origin.drink} · ${c.origin.venue}, table ${c.origin.table}`],
    ['RARITY', c.rarity],
    ['CARED FOR', `${c.careCount} time${c.careCount === 1 ? '' : 's'}`],
  ];
  const html = `
    <div class="screen">
      ${actionTop('', '#/')}
      <div class="mono" style="position:absolute;left:0;right:0;top:300px;text-align:center;font-size:10.5px;opacity:.5;z-index:6">DRAG TO SPIN</div>
      <div class="sheet snap" id="sheet" style="top:352px;bottom:0;overflow:auto">
        <div class="grab" style="margin-bottom:16px"></div>
        <div style="display:flex;align-items:baseline;gap:10px">
          <span class="disp" style="font-size:30px">${nameOf(c)}</span>
          <span class="mono" style="font-size:11px;color:var(--ink-78)">#${c.id.toUpperCase()}</span>
        </div>
        <div class="wrap" style="margin-top:14px">${chips.map((x) => `<span class="chip flat" style="font-size:12.5px">${esc(x)}</span>`).join('')}</div>
        <div style="margin-top:20px">${rows.map(([k, v]) => `
          <div style="display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-bottom:1px solid var(--ink-07)">
            <span class="note">${k}</span><span style="font:600 13px 'Instrument Sans';text-align:right">${esc(v)}</span></div>`).join('')}</div>
        <div class="mono" style="font-size:10px;color:var(--ink-78);margin:14px 0 18px;letter-spacing:.1em">THE GENOME IS THE SEED · THE SAME STRING ALWAYS MAKES THE SAME CREATURE</div>
        <div class="row" style="padding-bottom:10px">
          <button class="cta ghost" data-go="#/name/${c.id}"><div><b>Rename</b></div></button>
          <button class="cta" id="mkactive"><div><b>Make active</b></div><i>✓</i></button>
        </div>
      </div>
    </div>`;
  function mount(root) {
    $('#mkactive', root).onclick = () => { S.session.activeCreatureId = c.id; S.save(); buzz(10); location.hash = '#/'; };
    // drag to orbit, spring back on release
    const stage = $('#stage');
    let last = null;
    // stage coords, not client px — the desktop clamp scales the stage
    const down = (e) => {
      const r = stage.getBoundingClientRect();
      if ((e.clientY - r.top) / (r.height / R.H) < 352) last = e.clientX;
    };
    const move = (e) => { if (last == null) return; R.scene.spin += (e.clientX - last) * 0.012; last = e.clientX; };
    const up = () => { last = null; R.scene.spinVel = 0; };
    stage.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    // its card is a drawer too, and had a grab handle that did nothing
    const undrag = sheetDrag(root, { to: S.active()?.id === raw.id ? '#/' : '#/field' });
    return () => {
      R.scene.spin = 0;
      stage.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      undrag();
    };
  }
  return { html, mount };
}

export function c2({ id }) {
  const raw = S.creatureById(id); if (!raw) return f2();
  const c = S.view(raw);
  R.set({ mode: 'creature', creature: c, field: S.session.activeFieldId, groundTop: 404, props: false,
    hidden: false, wander: false, pose: { x: 195, y: 340, scale: 0.6 } });
  const cats = ['hats', 'eyes', 'held', 'backs'];
  const cat = c2.cat && cats.includes(c2.cat) ? c2.cat : 'hats';
  const slotKey = { hats: 'hat', eyes: 'eyes', held: 'held', backs: 'back' }[cat];
  const items = S.GARNISHES.filter((g) => g.cat === cat);
  // reachable from the creature card, the care sheet and #/dress, so the ✕ and the
  // swipe both go back where they came from
  const back = backTo(`#/c/${c.id}`);
  const html = `
    <div class="screen">
      ${actionTop('DRESSING', back)}
      <div class="sheet snap" id="sheet" style="top:352px;bottom:0;overflow:auto">
        <div class="grab" style="margin-bottom:16px"></div>
        <div class="wrap" style="margin-bottom:18px">
          ${cats.map((k) => `<button class="chip flat tab${k === cat ? ' on' : ''}" data-cat="${k}" style="font-size:12.5px;text-transform:capitalize">${k}</button>`).join('')}
        </div>
        <div class="slots">
          ${items.map((g) => {
            const locked = !S.session.unlockedGarnishes.includes(g.id);
            const on = raw.garnishes[slotKey] === g.id;
            const art = locked ? '' : ` data-art="${cat}:${g.id}"`;
            return `<button class="slot${locked ? ' lock' : ''}${on ? ' on' : ''}" data-g="${locked ? '' : g.id}"${art} title="${esc(g.label)}">${locked ? '?' : '◆'}</button>`;
          }).join('')}
          ${[...Array(Math.max(0, 8 - items.length))].map(() => '<div class="slot lock">?</div>').join('')}
        </div>
        <div class="note" style="margin-top:16px">EVERY COCKTAIL DROPS ONE · ${S.session.unlockedGarnishes.length} OF ${S.GARNISHES.length}</div>
        <div style="margin-top:14px" class="sub">Cosmetic only. Nothing you put on it changes what it needs from you.</div>
      </div>
    </div>`;
  function mount(root) {
    // show the thing itself in its slot rather than a diamond — you cannot pick what
    // you cannot see. Plain task, not rAF: the GL bakes borrow the live canvas.
    const ART = { hats: R.hatSprite, eyes: R.eyewearSprite, held: R.heldSprite, backs: R.backSprite };
    let paint = 0;
    const tiles = $$('.slot[data-art]', root);
    const fill = () => {
      const left = tiles.filter((b) => {
        const [k, id] = b.dataset.art.split(':');
        const cv = ART[k](id, 72);
        if (!cv) return true;
        cv.style.cssText = 'width:52px;height:52px;display:block;margin:auto';
        b.textContent = ''; b.append(cv);
        return false;
      });
      if (left.length) paint = setTimeout(fill, 120);
    };
    fill();

    $$('.tab', root).forEach((b) => b.onclick = () => { c2.cat = b.dataset.cat; window.dispatchEvent(new Event('hashchange')); });
    $$('.slot[data-g]', root).forEach((b) => b.onclick = () => {
      if (!b.dataset.g) return;
      raw.garnishes[slotKey] = raw.garnishes[slotKey] === b.dataset.g ? null : b.dataset.g;
      S.save(); buzz(8); window.dispatchEvent(new Event('hashchange'));
    });
    // Dismissing lands on the creature it is dressing, which is what the sheet was
    // covering — home if that is the active one, its own card otherwise, since home
    // would otherwise show a different creature entirely.
    const undrag = sheetDrag(root, { to: S.active()?.id === raw.id ? '#/' : `#/c/${c.id}` });
    return () => { clearTimeout(paint); undrag(); };
  }
  return { html, mount };
}

export function c3({ id }) {
  const raw = S.creatureById(id); if (!raw) return f2();
  const c = S.view(raw);
  R.set({ hidden: true, mode: 'none' });
  const fields = S.PICKABLE;
  const html = `
    <div class="screen" style="background:#22403A">
      ${actionTop('PHOTO BOOTH', `#/c/${c.id}`)}
      <div class="frame" style="position:absolute;left:24px;right:24px;top:128px;height:428px">
        <canvas id="shot" width="342" height="428" style="width:100%;height:100%;display:block"></canvas>
        <div style="position:absolute;left:16px;bottom:16px;color:#FFFDF5">
          <div class="mark">GLITCH</div>
          <div class="disp" style="font-size:22px;margin-top:6px">${nameOf(c)}</div>
          <div class="mono" style="font-size:10px;opacity:.7;margin-top:4px">HATCHED FROM AN ODDISH</div>
        </div>
        <canvas class="qr" id="qr" width="21" height="21"></canvas>
      </div>
      <div style="position:absolute;left:24px;right:24px;top:576px">
        <div class="wrap">${fields.map((f) => {
          const lock = !S.session.unlockedFields.includes(f.id);
          return `<button class="chip${lock ? ' lock' : ''}" data-f="${lock ? '' : f.id}" style="font-size:12px">${lock ? '✕ ' : ''}${f.name}</button>`;
        }).join('')}</div>
        <div class="note" style="margin-top:12px;color:rgba(255,253,245,.78)">LOCKED FIELDS SHOW GREYED · THAT'S THE POINT</div>
      </div>
      <div class="dock" style="background:linear-gradient(rgba(34,64,58,0),rgba(34,64,58,.95) 46%)">
        <button class="cta" id="share" style="background:#FFFDF5"><div><b style="color:#22403A">Save the photo</b><span style="color:rgba(34,64,58,.7)">THE CODE GOES TO THE MENU</span></div><i style="background:#22403A;color:#FFFDF5">↓</i></button>
      </div>
    </div>`;
  function mount(root) {
    // the pose is frozen the moment the screen opens, in whichever field is selected.
    // Render at device resolution — CSS keeps the display size, the PNG gets the pixels.
    const cv = $('#shot', root), dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = 342 * dpr; cv.height = 428 * dpr;
    const x = cv.getContext('2d');
    R.portrait(c, x, cv.width, cv.height, S.session.activeFieldId);   // the decayed view — the photo must match home
    // ponytail: block pattern stands in for the real code. Swap for a QR encoder
    // pointing at the venue menu URL before this ships — it is the acquisition loop.
    const q = $('#qr', root).getContext('2d');
    q.fillStyle = '#FFFDF5'; q.fillRect(0, 0, 21, 21);
    q.fillStyle = '#12211D';
    const rr = S.rng(c.genomeSeed);
    for (let i = 0; i < 21; i++) for (let j = 0; j < 21; j++) if (rr() > 0.52) q.fillRect(i, j, 1, 1);
    $$('.chip[data-f]', root).forEach((b) => b.onclick = () => {
      if (!b.dataset.f) return;
      S.session.activeFieldId = b.dataset.f; S.save(); window.dispatchEvent(new Event('hashchange'));
    });
    $('#share', root).onclick = () => {
      cv.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `${c.name || 'creature'}-glitch.png`; a.click();
        URL.revokeObjectURL(a.href);
      });
      buzz(12);
    };
  }
  return { html, mount };
}

/* ============================================================ FLOW D ==== */

export function d1() {
  const list = S.session.creatures;
  if (!list.length) return f2();
  const newest = d1.sort !== 'oldest';
  const pool = newest ? list.slice(-12) : list.slice(0, 12).reverse();
  // depth-sorted on the plane, 0.44 back → 0.7 front. Not a grid.
  const others = pool.map((c, i, arr) => {
    const t = arr.length === 1 ? 0.6 : i / (arr.length - 1);
    return {
      creature: c,
      x: 96 + ((i * 113) % 200) + (i % 2 ? 22 : -22),
      y: 448 + t * 208,                       // last row clears the CTA
      scale: 0.44 + t * 0.26,
    };
  });
  R.set({ mode: 'collection', others, field: S.session.activeFieldId, groundTop: 380, props: false, hidden: false, decay: 0 });
  const html = `
    <div class="screen">
      ${actionTop('YOUR CREATURES', '#/')}
      ${others.map((o) => {
        const rare = o.creature.rarity !== 'Common';
        return `<button class="chip pick" data-id="${o.creature.id}" style="position:absolute;left:${o.x}px;top:${o.y - 4}px;transform:translateX(-50%);z-index:6;padding:6px 11px;font-size:${11 + o.scale * 4}px;${rare ? 'background:rgba(232,194,100,.92)' : ''}">${nameOf(o.creature)}</button>`;
      }).join('')}
      <div style="position:absolute;left:24px;right:24px;top:118px;z-index:7" class="row">
        <button class="card" data-go="#/fields"><div class="k">Field</div><div class="v">${S.fieldById(S.session.activeFieldId).name} ▾</div></button>
        <button class="card" id="sort"><div class="k">Sort</div><div class="v">${newest ? 'Newest' : 'Oldest'} ▾</div></button>
      </div>
      <div class="dock">
        <button class="cta" data-go="#/o/${Math.random().toString(36).slice(2, 8)}">
          <div><b>Hatch a ${ord(list.length + 1)}</b><span>ORDER ANOTHER ODDISH</span></div><i>→</i></button>
      </div>
    </div>`;
  function mount(root) {
    // pick one and it becomes the creature home shows — same move as c1's "Make active",
    // one tap instead of a detour through the card.
    $$('.pick', root).forEach((b) => b.onclick = () => {
      S.session.activeCreatureId = b.dataset.id; S.save(); buzz(10); location.hash = '#/';
    });
    $('#sort', root).onclick = () => {
      d1.sort = newest ? 'oldest' : 'newest';   // same function-object trick c2 uses for tabs
      buzz(6); window.dispatchEvent(new Event('hashchange'));
    };
  }
  return { html, mount };
}

const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

export function d2() {
  R.set({ hidden: false, mode: 'creature', creature: S.view(S.active()), props: true, groundTop: 404, wander: false,
    field: S.session.activeFieldId, pose: { x: 195, y: 676, scale: 0.94 } });
  const html = `
    <div class="screen">
      <div style="position:absolute;inset:0;background:rgba(255,253,245,.94);z-index:6"></div>
      ${actionTop('FIELDS', backTo('#/care'))}
      <div style="position:absolute;left:24px;right:24px;top:118px;bottom:24px;z-index:7;overflow:auto">
        <div class="disp" style="font-size:29px;margin-bottom:6px">Where they live</div>
        <div class="sub" style="margin-bottom:18px">Changing the field re-skins home, the collection and the photo booth. Same ground, different world.</div>
        ${S.PICKABLE.map((f) => {
          const unlocked = S.session.unlockedFields.includes(f.id);
          const activeF = S.session.activeFieldId === f.id;
          return `<button class="fieldcard${activeF ? ' active' : ''}" data-f="${unlocked ? f.id : ''}" style="margin-bottom:10px;
            background:linear-gradient(${f.sky[0]},${f.sky[1]} 42%,${f.ground[0]} 58%,${f.ground[2]})">
            ${unlocked ? '' : '<span style="position:absolute;inset:0;background:rgba(26,34,30,.55);backdrop-filter:saturate(.35)"></span>'}
            <div class="lab">
              <div style="font:700 17px 'Bricolage Grotesque',sans-serif;letter-spacing:-.02em;color:${f.dark ? '#E8ECF7' : '#22403A'}">${f.name}</div>
              <div class="mono" style="font-size:10px;margin-top:4px;color:${f.accent}">${unlocked ? (activeF ? 'THEY LIVE HERE' : 'UNLOCKED') : S.unlockLabel(f)}</div>
            </div>
            ${unlocked ? (activeF ? '<span class="chip" style="position:absolute;right:12px;top:12px;font-size:11px">Active</span>' : '') : '<span class="lockbadge">🔒</span>'}
          </button>`;
        }).join('')}
      </div>
    </div>`;
  function mount(root) {
    $$('.fieldcard[data-f]', root).forEach((b) => b.onclick = () => {
      if (!b.dataset.f) return;
      S.session.activeFieldId = b.dataset.f; S.save(); buzz(10); location.hash = '#/';
    });
  }
  return { html, mount };
}

export function d3({ fieldId }) {
  const f = S.fieldById(fieldId);
  const c = S.view(S.active());
  R.set({ mode: 'creature', creature: c, field: f.id, groundTop: 404, props: true, hidden: false,
    wander: false, decay: 0, pose: { x: 195, y: 700, scale: 1.05 } });
  R.emit('spark', 18);
  const html = `
    <div class="screen${f.dark ? ' dark' : ''}">
      <div class="hd" style="top:130px">
        <div class="mono eyebrow" style="color:${f.accent}">FIELD UNLOCKED</div>
        <div class="disp" style="font-size:36px">${f.name}</div>
        <div class="sub" style="margin-top:14px">${nameOf(c)} opened this one. ${f.unlock?.rare ? 'Rare hatches do that.' : `That's ${S.session.creatures.length} hatches.`}</div>
      </div>
      <div class="dock" style="background:linear-gradient(${f.dark ? 'rgba(12,20,26,0),rgba(12,20,26,.9)' : 'rgba(255,253,245,0),rgba(255,253,245,.94)'} 46%)">
        <button class="cta" id="movein" style="background:${f.accent}">
          <div><b style="color:#12211D">Move everyone here</b><span style="color:rgba(18,33,29,.75)">YOU CAN SWITCH BACK ANYTIME</span></div>
          <i style="background:#12211D;color:${f.accent}">→</i></button>
      </div>
    </div>`;
  function mount(root) {
    $('#movein', root).onclick = () => {
      S.session.activeFieldId = f.id; S.save(); buzz(14);
      location.hash = S.session.hasSeenCoach ? '#/' : '#/coach';
    };
  }
  return { html, mount };
}

/* ============================================================ FLOW E ==== */

/** E2 — the account push. Overlays the live field, names every creature. */
export function e2() {
  const c = S.view(S.active());
  R.set({ mode: 'creature', creature: c, field: S.session.activeFieldId, groundTop: 404, props: true,
    hidden: false, wander: false, pose: { x: 195, y: 300, scale: 0.5 } });
  const names = S.session.creatures.map((x) => x.name).filter(Boolean);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || 'it';
  const html = `
    <div class="screen">
      <div class="scrim"></div>
      <div class="sheet" style="z-index:9">
        <div class="grab" style="margin-bottom:18px"></div>
        <div class="mono" style="font-size:11px;color:#B0592C;letter-spacing:.14em">KEPT ON THIS PHONE ONLY</div>
        <div class="disp" style="font-size:30px;margin-top:12px">Clear your browser<br>and they're gone</div>
        <div class="sub" style="margin-top:14px">${esc(list)} live in this browser's storage and nowhere else. One tap keeps them.</div>
        <div class="row" style="margin:20px 0 22px;justify-content:center">
          ${S.session.creatures.slice(0, 4).map(() => `<div style="width:56px;height:64px;border-radius:14px;background:var(--ink-07)"></div>`).join('')}
        </div>
        <button class="cta" data-go="#/save"><div><b>Save my creatures</b><span>EMAIL ONLY · NO PASSWORD</span></div><i>→</i></button>
        <button class="note" id="notnow" style="display:block;width:100%;text-align:center;margin-top:16px;background:none;border:0;padding:8px">NOT NOW</button>
      </div>
    </div>`;
  function mount(root) {
    // shown = counted. Backing out of the save screen must not re-arm it for
    // the next visit home — the weekly gate starts the moment the sheet appears.
    S.session.lastNagAt = Date.now(); S.save();
    $('#notnow', root).onclick = () => { location.hash = '#/'; };
  }
  return { html, mount };
}

export function e3() {
  R.set({ hidden: true, mode: 'none' });
  const html = `
    <div class="screen" style="background:#FFFDF5">
      ${actionTop('', '#/')}
      <div style="position:absolute;left:24px;right:24px;top:150px">
        <div class="disp" style="font-size:34px">Keep them</div>
        <div class="sub" style="margin-top:12px">A bar is the worst place to type a password, so there isn't one. We send a link.</div>
        <form id="signin" style="margin-top:34px">
          <div class="namefield" style="border-bottom-width:2px">
            <input id="em" type="email" required placeholder="you@example.com" autocomplete="email"
                   style="font:600 20px 'Instrument Sans';letter-spacing:0" aria-label="Email">
          </div>
          <div class="note" style="margin:14px 0 24px">WE USE IT TO SEND THE LINK AND NOTHING ELSE</div>
          <button class="cta" type="submit"><div><b>Send the link</b><span>NO PASSWORD</span></div><i>→</i></button>
        </form>
        <div class="row" style="margin-top:12px">
          <button class="cta ghost"><div><b>Apple</b></div></button>
          <button class="cta ghost"><div><b>Google</b></div></button>
        </div>
        <div class="note" style="margin-top:22px" id="sent"></div>
      </div>
    </div>`;
  function mount(root) {
    $('#signin', root).onsubmit = (e) => {
      e.preventDefault();
      // ponytail: no backend. Real flow is POST /api/auth/magic-link then /api/auth/claim,
      // which binds the guest id server-side so nothing merges twice.
      S.session.email = $('#em', root).value;
      S.session.isGuest = false;
      S.save(); buzz(12);
      $('#sent', root).textContent = 'CHECK YOUR EMAIL · THEY’RE SAFE NOW';
    };
    // ponytail: OAuth is as stubbed as the magic link — both wait on the same backend.
    $$('.cta.ghost', root).forEach((b) => b.onclick = () => {
      S.session.email = `via ${b.textContent.trim().toLowerCase()}`;
      S.session.isGuest = false;
      S.save(); buzz(12);
      $('#sent', root).textContent = 'SIGNED IN · THEY’RE SAFE NOW';
    });
  }
  return { html, mount };
}

export function e4() {
  R.set({ hidden: true, mode: 'none' });
  const s = S.session;
  const toggles = [['sound', 'Sound'], ['haptics', 'Haptics'], ['reduceMotion', 'Reduce motion']];
  const html = `
    <div class="screen">
      <div class="list">
        <div class="top"><button class="chip icon" data-go="#/">✕</button><span class="mark" style="opacity:.75">GLITCH</span><span style="width:40px"></span></div>
        <button data-go="#/field">Your creatures <span class="r">${s.creatures.length}</span></button>
        <button data-go="#/fields">Fields <span class="r">${s.unlockedFields.length} of ${S.PICKABLE.length}</span></button>
        <button data-go="#/dress">Garnishes <span class="r">${s.unlockedGarnishes.length} of ${S.GARNISHES.length}</span></button>
        ${toggles.map(([k, label]) => `<button data-t="${k}">${label} <span class="r">${s[k] ? 'ON' : 'OFF'}</span></button>`).join('')}
        <a href="#/" id="tonight">Tonight at Glitch <span class="r">MENU ↗</span></a>
        <button ${s.isGuest ? 'data-go="#/save"' : 'id="signout"'}>${s.isGuest ? 'Save my creatures' : 'Sign out'} <span class="r">${s.isGuest ? 'GUEST' : esc(s.email || '')}</span></button>
        <div style="text-align:center;margin-top:44px">
          <div class="mark" style="opacity:.35">GLITCH</div>
          <div class="note" style="margin-top:10px;opacity:.5">V0.1 · ODDISH · ${s.creatures.length} HATCHED</div>
        </div>
      </div>
    </div>`;
  function mount(root) {
    $$('[data-t]', root).forEach((b) => b.onclick = () => {
      s[b.dataset.t] = !s[b.dataset.t]; S.save(); buzz(6);
      window.dispatchEvent(new Event('glitch:prefs'));   // app.js: drone on/off, --dur live
      window.dispatchEvent(new Event('hashchange'));
    });
    // creatures stay — signing out only drops the (stubbed) account binding
    $('#signout', root)?.addEventListener('click', () => {
      s.isGuest = true; s.email = null; S.save(); buzz(8);
      window.dispatchEvent(new Event('hashchange'));
    });
  }
  return { html, mount };
}

/* ============================================================ FLOW F ==== */

export function f1({ eggId }) {
  R.set({ mode: 'egg', field: 'meadow', groundTop: 500, props: false, hidden: false, decay: 0.5,
    pose: { x: 195, y: 700, scale: 0.9 }, crackStage: 4, hold: 0 });
  const has = S.session.creatures.length > 0;
  const when = S.session.creatures.find((c) => c.eggId === eggId)?.hatchedAt;
  return { html: `
    <div class="screen">
      <div class="wordmark"><span class="mark">GLITCH</span></div>
      <div class="hd" style="top:160px">
        <div class="disp" style="font-size:36px">This egg<br>already hatched</div>
        <div class="mono" style="font-size:11px;margin-top:16px;opacity:.6">${when ? `SOMEONE GOT HERE AT ${hhmm(when)}` : 'SOMEONE GOT HERE FIRST'}</div>
      </div>
      <div class="dock" style="background:linear-gradient(rgba(57,111,64,0),rgba(34,64,58,.5) 60%)">
        <button class="cta" data-go="${has ? '#/field' : '#/menu'}">
          <div><b>${has ? 'See your creatures' : 'Have a look around'}</b><span>${has ? `${S.session.creatures.length} OF THEM` : 'ORDER AN ODDISH FOR ONE OF YOUR OWN'}</span></div><i>→</i></button>
      </div>
    </div>` };
}

export function f2() {
  R.set({ hidden: true, mode: 'none' });
  return { html: `
    <div class="screen" style="background:#FFFDF5">
      <div class="wordmark"><span class="mark">GLITCH</span></div>
      <div style="position:absolute;left:50%;top:340px;transform:translate(-50%,-50%);width:200px;height:200px;
        border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--ink-13);display:grid;place-items:center">
        <svg width="120" height="130" viewBox="0 0 120 130" style="opacity:.22">
          <path d="M60 46 C 30 46 18 68 18 88 C 18 110 36 124 60 124 C 84 124 102 110 102 88 C 102 68 90 46 60 46Z" fill="#22403A"/>
          <path d="M58 48 C 40 30 30 14 34 4 C 48 8 58 26 60 46Z" fill="#22403A"/>
          <path d="M62 48 C 78 28 92 16 100 12 C 100 28 82 42 64 47Z" fill="#22403A"/>
        </svg>
      </div>
      <div class="hd" style="top:470px">
        <div class="disp" style="font-size:30px">Nothing here yet</div>
        <div class="sub" style="margin-top:12px">Every Oddish comes with an egg. Tap the tag on the glass.</div>
      </div>
      <div class="dock" style="background:none">
        <button class="cta" data-go="#/menu"><div><b>Have a look around</b><span>GLITCH · OPEN TILL 02:00</span></div><i>→</i></button>
      </div>
    </div>` };
}

const nightNow = () => { const h = new Date().getHours(); return h >= 2 && h < 7; };
