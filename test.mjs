// One runnable check. `node test.mjs`. No framework — the logic that would silently
// rot is the genome (must be stable forever) and the decay curve.
import assert from 'node:assert/strict';
import { genomeFrom, traitsFrom, decayed, rollMaterial, shouldNag, session, clean, lowestMeter, hatch } from './js/state.js';

const DAY = 86400000;

// The genome is printed on receipts. Same seed must always give the same creature.
const g = genomeFrom('egg-4a91');
assert.equal(g, genomeFrom('egg-4a91'), 'genome drifted for a fixed seed');
assert.match(g, /^[0-9A-F]{4}·[0-9A-F]{4}·[0-9A-F]{4}$/, 'genome is not printable');
assert.deepEqual(traitsFrom(g), traitsFrom(g), 'traits drifted for a fixed genome');
assert.notEqual(genomeFrom('egg-4a91'), genomeFrom('egg-4a92'), 'different eggs collided');

const t = traitsFrom(g);
assert.ok(t.fronds >= 2 && t.fronds <= 5, `fronds out of range: ${t.fronds}`);

// Decay: ~14%/day, floored at 8, never above 100.
const now = 1e12;
const m = { hunger: 90, clean: 50, joy: 30, rest: 12 };
assert.deepEqual(decayed(m, now, now), m, 'decay applied with zero elapsed time');
assert.equal(decayed(m, now - DAY, now).hunger, 76, 'one day should cost 14');
assert.equal(decayed(m, now - 3 * DAY, now).joy, 8, 'joy should floor at 8, not go negative');
assert.equal(decayed(m, now - 400 * DAY, now).rest, 8, 'floor must hold at any distance');
assert.ok(Object.values(decayed(m, now + DAY, now)).every((v) => v <= 100), 'a clock skew must not inflate meters');

assert.equal(lowestMeter(decayed(m, now, now)).k, 'rest');

// Rarity: deterministic per egg, and commons must dominate.
assert.equal(rollMaterial('x1').id, rollMaterial('x1').id, 'rarity is not reproducible for an egg');
const n = 20000;
let rare = 0;
for (let i = 0; i < n; i++) if (rollMaterial(`e${i}`).rare) rare++;
assert.ok(rare / n > 0.04 && rare / n < 0.13, `rare rate off: ${(rare / n * 100).toFixed(1)}%`);

// A colliding 4-char id must extend, not shadow the existing creature.
{
  const hex = genomeFrom('egg-clash').replace(/·/g, '').toLowerCase();
  session.creatures = [{ id: hex.slice(0, 4), name: 'First', meters: {}, lastSeenAt: now }];
  const c = hatch('egg-clash');
  assert.notEqual(c.id, session.creatures[0].id, 'id collision shadowed an existing creature');
  assert.equal(c.id, hex.slice(0, 6), 'colliding id should extend to 6 chars');
}

// E2 must never fire before the first creature is named.
session.creatures = [{ name: null, rarity: 'Common', lastSeenAt: now }, { name: null, rarity: 'Gold', lastSeenAt: now }];
assert.equal(shouldNag(now), false, 'nagged before anything was named');
session.creatures[0].name = 'Silt';
assert.equal(shouldNag(now), true, 'should nag at two creatures once one is named');
session.isGuest = false;
assert.equal(shouldNag(now), false, 'nagged a signed-in account');

assert.equal(clean('Sprig'), true);
assert.equal(clean('sh1t'), true, 'filter is deliberately letters-only');
assert.equal(clean('S h i t'), false, 'filter must survive spacing');

console.log('ok — genome, decay, rarity, nag gate');
