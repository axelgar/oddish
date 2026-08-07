// Genome, traits, meters, persistence. No d3, no DOM — so `node test.mjs` can import it.

/* ---------------------------------------------------------------- rng ---- */

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mulberry32 — same seed, same creature, forever. */
export function rng(seed) {
  let a = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `8F2A·C401·9DD7` — printable on a coaster, and it IS the generation seed. */
export function genomeFrom(seed) {
  const r = rng(seed);
  const block = () => Math.floor(r() * 65536).toString(16).toUpperCase().padStart(4, '0');
  return `${block()}·${block()}·${block()}`;
}

/* ------------------------------------------------------------- traits ---- */

export const MATERIALS = [
  { id: 'gold',    label: 'Gold',    odds: 200, rare: true },
  { id: 'crystal', label: 'Crystal', odds: 80,  rare: true },
  { id: 'neon',    label: 'Neon',    odds: 40,  rare: true },
  { id: 'foil',    label: 'Foil',    odds: 20,  rare: true },
  { id: 'common',  label: 'Common',  odds: 1,   rare: false },
];

// Oddish's blue bulb and green fronds, plus friendly variants. Keys are stored on
// creatures forever — rename labels freely, never the keys.
// deep → hi is the shading ramp; `body` is the midpoint the eye reads as "its colour".
export const PALETTES = {
  drowned: { label: 'lagoon', body: '#5D80A4', deep: '#2A3D52', hi: '#CFE2F2', leaf: '#4E9E4C', leafdeep: '#215026', leafhi: '#C2EA9A' },
  ash:     { label: 'pebble', body: '#8E96A0', deep: '#40464F', hi: '#E9EDF2', leaf: '#6B9159', leafdeep: '#2C4526', leafhi: '#CCE2A6' },
  bruise:  { label: 'plum',   body: '#8A6FA6', deep: '#3F2F56', hi: '#E6D8F4', leaf: '#5E9450', leafdeep: '#274A26', leafhi: '#C1E496' },
  bile:    { label: 'moss',   body: '#98A455', deep: '#454E22', hi: '#EDF2BA', leaf: '#74A83E', leafdeep: '#30501A', leafhi: '#D5EC92' },
  rot:     { label: 'clay',   body: '#BC8562', deep: '#5B3C2B', hi: '#F8E0C8', leaf: '#6EA047', leafdeep: '#2D4B20', leafhi: '#CEE494' },
  milk:    { label: 'cream',  body: '#D9D6C2', deep: '#726E5C', hi: '#FCF9EC', leaf: '#88AC64', leafdeep: '#3A532D', leafhi: '#DAE8B2' },
};

export const BODIES = ['round', 'swollen', 'tall', 'lopsided'];
// same roll index as the old ['slit','pinhole','wide','too many'] — render.js keeps
// legacy fallbacks so creatures hatched before the rename still draw
export const EYES = ['button', 'round', 'wide', 'sparkly'];
export const BERRIES = ['#D9556E', '#F0C65A', '#8FBF6A'];
export const BERRY_NAMES = ['sourberry', 'wax plum', 'greenpit'];

const NAME_POOL = {
  drowned: ['Puddle', 'Marlow', 'Dew', 'Blue', 'Pips'],
  ash:     ['Pebble', 'Misty', 'Momo', 'Ollie', 'Fog'],
  bruise:  ['Plum', 'Fig', 'Wren', 'Vio', 'Berry'],
  bile:    ['Dill', 'Sprout', 'Fern', 'Clover', 'Minty'],
  rot:     ['Bruno', 'Pip', 'Maple', 'Biscuit', 'Conker'],
  milk:    ['Mochi', 'Wisp', 'Butter', 'Coco', 'Nimbus'],
};

/** Deterministic: genome in, whole creature out. Pure. */
export function traitsFrom(genome) {
  const r = rng(genome);
  const palKeys = Object.keys(PALETTES);
  const t = {
    fronds: 2 + Math.floor(r() * 4),            // 2–5
    palette: palKeys[Math.floor(r() * palKeys.length)],
    bodyShape: BODIES[Math.floor(r() * BODIES.length)],
    eyeType: EYES[Math.floor(r() * EYES.length)],
    favouriteBerry: Math.floor(r() * BERRIES.length),
    lump: 0.5 + r() * 0.9,                      // silhouette noise amplitude (render keeps it gentle)
    lean: (r() - 0.5) * 0.34,                   // a slight head-tilt of asymmetry
    grin: 0.75 + r() * 0.65,                    // mouth width multiplier
    extraEyes: 0,                               // legacy field — old saves may carry >0, render ignores it
  };
  return t;
}

export function suggestNames(c) {
  const pool = NAME_POOL[c.traits.palette] || NAME_POOL.bile;
  return pool.slice(0, 5);
}

/** Rarity roll. ponytail: client-side stand-in. Move to POST /api/hatch/:eggId
 *  the moment a backend exists — a double-scan must 409, not mint a second creature. */
export function rollMaterial(seed) {
  const r = rng(seed + ':mat')();
  let p = 0;
  for (const m of MATERIALS) {
    if (!m.rare) continue;
    p += 1 / m.odds;
    if (r < p) return m;
  }
  return MATERIALS.find((m) => m.id === 'common');
}

/* ------------------------------------------------------------- meters ---- */

// `say` is the thought chip, by severity: [mild, middling, bad]
export const METERS = [
  { k: 'hunger', label: 'HUNGER', color: '#D9556E', act: 'feed',  say: ['peckish', 'hungry', 'starving'] },
  { k: 'clean',  label: 'CLEAN',  color: '#8FC9DC', act: 'bathe', say: ['grubby', 'dirty', 'filthy'] },
  { k: 'joy',    label: 'JOY',    color: '#F0C65A', act: 'play',  say: ['restless', 'bored', 'wants something'] },
  { k: 'rest',   label: 'REST',   color: '#B9A6D9', act: 'sleep', say: ['drowsy', 'tired', 'hasn’t slept'] },
];

export const meterSays = (m, v) => m.say[v < 25 ? 2 : v < 55 ? 1 : 0];

const DAY = 86400000;

/** Decay is COMPUTED, never ticked. ~14%/day, floored at 8. */
export function decayed(meters, lastSeenAt, now = Date.now()) {
  const days = Math.max(0, now - lastSeenAt) / DAY;
  const drop = Math.floor(days * 14);
  const out = {};
  for (const { k } of METERS) out[k] = Math.max(8, Math.min(100, (meters[k] ?? 70) - drop));
  return out;
}

export function daysAway(lastSeenAt, now = Date.now()) {
  return Math.floor(Math.max(0, now - lastSeenAt) / DAY);
}

export function lowestMeter(meters) {
  return METERS.reduce((a, b) => (meters[b.k] < meters[a.k] ? b : a));
}

/* -------------------------------------------------------------- fields ---- */

export const FIELDS = [
  {
    id: 'meadow', name: 'Sour Meadow', unlock: null, accent: '#7CB469', dark: false,
    sky: ['#9FC9CF', '#BCD3C4', '#D9DFBB'], skyStops: [0, .40, .56],
    bloom: '255,242,200', bloomA: .95, bloomAt: [-60, -110], bloomSize: 340,
    hills: ['#A8C58C', '#93B47C'], ground: ['#6C9C5C', '#3F6F3F', '#26482C'],
    treeline: 'rgba(24,44,32,.55)',
  },
  {
    id: 'night', name: 'Night Meadow', unlock: { hatches: 3 }, accent: '#7F9AC4', dark: true,
    sky: ['#182A44', '#2D3F5E', '#4A4A63'], skyStops: [0, .38, .58],
    bloom: '232,236,247', bloomA: .85, bloomAt: [250, 90], bloomSize: 150,
    hills: ['#3C4A56', '#33414D'], ground: ['#3E5A4C', '#25392F', '#1A2A22'],
    treeline: 'rgba(6,12,18,.9)', watchers: 4,
  },
  {
    id: 'flower', name: 'Flower Field', unlock: { hatches: 5 }, accent: '#C98A5E', dark: false,
    sky: ['#C9B8CF', '#D9C9C2', '#E5DCC0'], skyStops: [0, .40, .58],
    bloom: '255,225,215', bloomA: .80, bloomAt: [-40, -120], bloomSize: 320,
    hills: ['#B0A184', '#9A8C72'], ground: ['#8A8A52', '#5E6238', '#3B4127'],
    treeline: 'rgba(40,34,28,.5)',
  },
  {
    id: 'forest', name: 'Forest Edge', unlock: { rare: true }, accent: '#69A86B', dark: true,
    sky: ['#20301F', '#2C3E2A', '#3C4E33'], skyStops: [0, .42, .6],
    bloom: '190,220,150', bloomA: .35, bloomAt: [140, -60], bloomSize: 300,
    hills: ['#1E2C1C', '#182317'], ground: ['#2E4029', '#1D2A1A', '#121B10'],
    treeline: 'rgba(4,10,4,.95)', watchers: 7,
  },
  {
    id: 'backroom', name: 'The Back Room', unlock: { hatches: 10 }, accent: '#B0592C', dark: true,
    sky: ['#2A1A1C', '#3A2220', '#4A2C22'], skyStops: [0, .4, .62],
    bloom: '255,150,90', bloomA: .50, bloomAt: [195, -40], bloomSize: 260,
    hills: ['#33201F', '#2A1A1A'], ground: ['#4A2E24', '#2E1C17', '#1C110E'],
    treeline: 'rgba(10,4,4,.9)',
  },
  {
    id: 'snow', name: 'Snowfield', unlock: { seasonal: true }, accent: '#8FC9DC', dark: false,
    sky: ['#B8C6CE', '#CBD5D6', '#DDE2DC'], skyStops: [0, .4, .58],
    bloom: '255,255,255', bloomA: .90, bloomAt: [-50, -110], bloomSize: 300,
    hills: ['#C3CCC8', '#B0BAB6'], ground: ['#DCE2DE', '#B4BEBA', '#8E9A97'],
    treeline: 'rgba(30,40,44,.6)',
  },
];

// Not a field you can live in — the A5 rare-reveal backdrop, kept here so the
// renderer only ever knows about one kind of world.
FIELDS.push({
  id: 'reveal', name: 'Reveal', hidden: true, unlock: null, accent: '#E8C264', dark: true,
  sky: ['#0C1F28', '#123642', '#1C4A4A'], skyStops: [0, .44, 1],
  bloom: '240,198,90', bloomA: .45, bloomAt: [-85, 40], bloomSize: 560,
  hills: ['#123B3B', '#0F3234'], ground: ['#164244', '#0E2C2E', '#08191B'],
  treeline: 'rgba(3,10,12,.92)',
});

/** The fields a guest can actually choose. */
export const PICKABLE = FIELDS.filter((f) => !f.hidden);
export const fieldById = (id) => FIELDS.find((f) => f.id === id) || FIELDS[0];

export const GARNISHES = [
  { id: 'sprig',   cat: 'hats',  label: 'Rosemary sprig', from: 'Oddish' },
  { id: 'wheel',   cat: 'hats',  label: 'Citrus wheel',   from: 'Paloma' },
  { id: 'shade',   cat: 'eyes',  label: 'Smoked shade',   from: 'Mezcal Negroni' },
  { id: 'lash',    cat: 'eyes',  label: 'Cherry lash',    from: 'Manhattan' },
  { id: 'pick',    cat: 'held',  label: 'Olive pick',     from: 'Martini' },
  { id: 'straw',   cat: 'held',  label: 'Paper straw',    from: 'Collins' },
  { id: 'fern',    cat: 'backs', label: 'Dried fern',     from: 'Last Word' },
  { id: 'moth',    cat: 'backs', label: 'Paper moth',     from: 'Corpse Reviver' },
];

/* ------------------------------------------------------------- session ---- */

const KEY = 'glitch.creatures';

const blank = () => ({
  creatures: [], activeCreatureId: null, activeFieldId: 'meadow',
  unlockedFields: ['meadow'], unlockedGarnishes: ['sprig', 'wheel', 'pick'],
  claimedEggs: [], isGuest: true, accountId: null, email: null,
  hasSeenCoach: false, hasFed: false, lastNagAt: 0,
  sound: true, haptics: true, reduceMotion: false,
});

export const session = load();

// The path the router last left. Screens reachable from more than one place read
// it so their ✕ goes back where the user came from. Deliberately not persisted —
// a reload has no previous screen, and the fallback is the honest answer then.
export const nav = { from: null };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch { return blank(); }
}

export function save() {
  // ponytail: localStorage only. The handoff wants an httpOnly guest cookie + server truth;
  // that is exactly the risk E2 warns the guest about, so E2 is wired and honest about it.
  try { localStorage.setItem(KEY, JSON.stringify(session)); } catch { /* private mode */ }
}

export const active = () => session.creatures.find((c) => c.id === session.activeCreatureId) || session.creatures[0] || null;
export const creatureById = (id) => session.creatures.find((c) => c.id === id) || active();

/** Read a creature with decay applied. Never mutates. */
export function view(c, now = Date.now()) {
  if (!c) return null;
  return { ...c, meters: decayed(c.meters, c.lastSeenAt, now), away: daysAway(c.lastSeenAt, now) };
}

export function touch(c, now = Date.now()) {
  c.meters = decayed(c.meters, c.lastSeenAt, now);
  c.lastSeenAt = now;
}

export function hatch(eggId, origin = {}) {
  const seed = `${eggId}`;
  const genome = genomeFrom(seed);
  const material = rollMaterial(seed);
  const traits = traitsFrom(genome);
  const now = Date.now();
  // 4 hex chars collide once in 65k — extend until unique, routes match on it
  const hex = genome.replace(/·/g, '').toLowerCase();
  let id = hex.slice(0, 4), n = 4;
  while (session.creatures.some((c) => c.id === id)) id = n < 12 ? hex.slice(0, (n += 2)) : id + session.creatures.length;
  const c = {
    id,
    eggId, genomeSeed: genome, name: null,
    rarity: material.rare ? material.label : 'Common', material: material.id,
    traits, garnishes: { hat: null, eyes: null, held: null, back: null },
    meters: { hunger: 62, clean: 74, joy: 80, rest: 66 },
    hatchedAt: now, lastSeenAt: now, careCount: 0,
    origin: { drink: 'Oddish', venue: 'Glitch', table: origin.table ?? 4, ...origin },
  };
  session.creatures.push(c);
  session.activeCreatureId = c.id;
  if (!session.claimedEggs.includes(eggId)) session.claimedEggs.push(eggId);
  save();
  return c;
}

const ACT_GAIN = {
  // feed carries a sliver of joy so the favourite-berry bonus is ONE care(), not two
  feed:   { hunger: 34, joy: 4.5 }, bathe: { clean: 46 }, play: { joy: 30, rest: -6 },
  cuddle: { joy: 22, rest: 8 }, sleep: { rest: 52 }, groom: { clean: 22, joy: 8 },
};

export function care(c, action, mult = 1) {
  touch(c);
  const gain = ACT_GAIN[action] || {};
  for (const [k, v] of Object.entries(gain)) c.meters[k] = Math.max(8, Math.min(100, c.meters[k] + v * mult));
  c.careCount++;
  save();
  return c.meters;
}

export function sortItOut(c) {
  touch(c);
  const order = [...METERS].sort((a, b) => c.meters[a.k] - c.meters[b.k]).slice(0, 3);
  order.forEach((m) => care(c, m.act));
  return order;
}

/* -------------------------------------------------------------- unlocks --- */

export function unlockCheck() {
  const hatches = session.creatures.length;
  const anyRare = session.creatures.some((c) => c.rarity !== 'Common');
  const newly = [];
  for (const f of PICKABLE) {
    if (!f.unlock || session.unlockedFields.includes(f.id)) continue;
    const hit = (f.unlock.hatches && hatches >= f.unlock.hatches) || (f.unlock.rare && anyRare);
    if (hit) { session.unlockedFields.push(f.id); newly.push(f); }
  }
  if (newly.length) save();
  return newly;
}

export function unlockLabel(f) {
  if (!f.unlock) return 'DEFAULT';
  if (f.unlock.rare) return 'ANY RARE HATCH';
  if (f.unlock.seasonal) return 'SEASONAL · TIME-BOXED';
  return `${f.unlock.hatches} HATCHES`;
}

/** E2 triggers: end of hatch #2, any rare, or a return after 24h. Never before the
 *  first creature is named. Then at most weekly. */
export function shouldNag(now = Date.now()) {
  if (!session.isGuest) return false;
  const named = session.creatures.filter((c) => c.name);
  if (!named.length) return false;
  if (now - session.lastNagAt < 7 * DAY) return false;
  const rare = session.creatures.some((c) => c.rarity !== 'Common');
  const back = session.creatures.some((c) => daysAway(c.lastSeenAt, now) >= 1);
  return session.creatures.length >= 2 || rare || back;
}

const BAD = ['fuck', 'shit', 'cunt', 'bitch', 'nazi'];
export const clean = (s) => !BAD.some((w) => s.toLowerCase().replace(/[^a-z]/g, '').includes(w));
