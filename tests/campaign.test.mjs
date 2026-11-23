// Campaign rule fixtures (GAME-FIX-1 C2). Run: node --test tests/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, BattleServer, openingVillage } from './harness.mjs';

const { Campaign, CampaignEvents } = loadGame();
const server = new BattleServer();
after(() => server.close());

const fresh = (seed = 11, overrides) => Campaign.start(openingVillage(seed, overrides));
function advanceUntil(c, done, limit = 400) {
  for (let i = 0; i < limit && !done(c); i++) { if (c.threat && c.day >= c.threat.day) return; Campaign.advance(c); }
}
// A rich Level 4 village for rules that need late-game buildings.
function lateVillage(seed = 21) {
  const c = fresh(seed);
  c.level = 4; c.residents = 50;
  for (const [key, b] of Object.entries(c.buildings)) { b.level = Math.max(b.level, ['hall', 'homes', 'farm', 'oven', 'wood', 'quarry', 'wall', 'granary', 'warehouse', 'barracks', 'archery', 'stables', 'mine', 'workshop', 'pasture', 'herbGarden', 'healer', 'tower', 'ballista'].includes(key) ? 6 : 0); b.health = 100; }
  for (const key of Object.keys(c.stock)) c.stock[key] = 300;
  c.army = { spearmen: [2, 2, 2, 2], archers: [2, 2, 2], swordsmen: [2, 2, 2], cavalry: [] };
  c.dragon.level = 3; c.dragon.health = 70;
  c.jobs = Object.fromEntries(Object.keys(c.jobs).map(k => [k, 0]));
  return c;
}

test('a new campaign validates and survives a JSON round trip', () => {
  const c = fresh();
  assert.ok(Campaign.validate(c));
  const copy = JSON.parse(JSON.stringify(c));
  assert.ok(Campaign.validate(copy));
});

test('saves made before GAME-FIX-1 are upgraded on load', () => {
  const c = fresh();
  for (const key of ['bolts', 'reinforced', 'kitShare', 'invasionType', 'invasionKnown', 'flyRaids', 'l2Grace', 'battles']) delete c[key];
  delete c.dragon.buffUntil;
  c.status = 'stall';
  assert.equal(Campaign.validate(c), false);
  Campaign.normalize(c);
  assert.ok(Campaign.validate(c));
  assert.equal(c.status, 'active');
});

test('Level 4 keeps raids every 10 days, stops them 5 days before the first wave, and fixes one invasion type', () => {
  const c = fresh(5);
  c.level = 3;
  c.queue.push({ kind: 'advance', key: 'hall', day: c.day + 1, workers: 0 });
  c.raidAt = c.day + 30; c.threat = null;
  Campaign.advance(c);
  assert.equal(c.level, 4);
  assert.equal(c.invasionAt, c.day + 48);
  assert.equal(c.raidAt, c.day + 10);
  assert.ok(['horde', 'siege', 'wyrm'].includes(c.invasionType));
  const type = c.invasionType;
  const raids = [];
  // resolve every encounter as a clean win so the schedule can be read
  for (let guard = 0; guard < 200 && c.status === 'active' && c.wave < 3; guard++) {
    if (c.threat && c.day >= c.threat.day) {
      const t = c.threat;
      if (t.wave) assert.equal(t.type, type, 'every invasion wave has the same type');
      else raids.push({ day: t.day, flier: t.flier });
      Campaign.applyBattle(c, { engine: 'test', status: 'won', enemy: 1, boss: 0, rounds: [], casualties: { spearmen: 0, archers: 0, swordsmen: 0, cavalry: 0 },
        wallAfter: c.buildings.wall.health, wallDestroyed: false, hallAfter: 100, dragonAfter: c.dragon.health, boltsAfter: c.bolts,
        stocks: { grain: c.stock.grain, food: c.stock.food, timber: c.stock.timber, stone: c.stock.stone }, civDamage: 0, levelsLost: 0,
        l2Grace: false, breached: false, safetyNet: false, heroDamage: c.heroes.map(() => 0) });
      continue;
    }
    c.stock.food = 200; c.dragon.favor = 70;
    Campaign.advance(c);
  }
  const firstWave = c.reports.find(r => r.wave === 1).day;
  assert.ok(raids.length >= 3, 'raids continue through the countdown');
  for (let i = 1; i < raids.length; i++) assert.equal(raids[i].day - raids[i - 1].day, 10);
  for (const r of raids) assert.ok(r.day <= firstWave - 5, 'no raid within 5 days of the first wave');
  for (const r of raids) if (r.flier) assert.ok(r.day <= firstWave - 10, 'no flying raid within 10 days of the first wave');
  assert.ok(raids.some(r => r.flier), 'Level 4 raids bring fliers');
  assert.equal(c.status, 'victory');
});

test('a battle that destroys the walls removes every fortification', () => {
  const c = lateVillage();
  c.reinforced = true;
  c.threat = { day: c.day, wave: 0, type: 'raiders', field: 30, boss: 0, flier: 0, intel: null };
  Campaign.applyBattle(c, { engine: 'test', status: 'won', enemy: 30, boss: 0, rounds: [], casualties: { spearmen: 1, archers: 0, swordsmen: 0, cavalry: 0 },
    wallAfter: 0, wallDestroyed: true, hallAfter: 100, dragonAfter: 60, boltsAfter: 0, stocks: { grain: 290, food: 290, timber: 290, stone: 290 },
    civDamage: 20, levelsLost: 1, l2Grace: false, breached: true, safetyNet: false, heroDamage: [] });
  for (const key of ['wall', 'tower', 'ballista', 'bastion']) assert.equal(c.buildings[key].level, 0, key);
  assert.equal(c.reinforced, false);
  assert.equal(c.army.spearmen.length, 3);
  assert.equal(c.reports.at(-1).outcome, 'breach');
  assert.equal(c.reports.at(-1).plunder.food, 10);
  assert.ok(Campaign.validate(c));
});

test('departure: 5-10% of the army is lost (at least one from 10 soldiers), damage is capped, the Town Center is spared', () => {
  for (let seed = 1; seed < 40; seed++) {
    const c = lateVillage(seed);
    c.army.cavalry = [1, 1, 1];
    const before = Campaign.troops(c), residents = c.residents;
    c.departure = true;
    assert.ok(Campaign.action(c, 'departure', 'leave'));
    const lost = before - Campaign.troops(c);
    assert.ok(lost >= 1 && lost <= Math.ceil(before * .1), `lost ${lost} of ${before}`);
    assert.equal(residents - c.residents, lost);
    assert.equal(c.buildings.hall.health, 100);
    const [, most] = Campaign.departureDamage(c);
    assert.ok(most <= 40);
    for (const [name, b] of Object.entries(c.buildings)) if (name !== 'hall' && b.level) assert.ok(b.health >= 100 - most - 1e-9 || b.health === 100, name);
    assert.ok(c.dragon.departed);
  }
});

test('the departure warning names buildings that could be destroyed', () => {
  const c = lateVillage();
  c.buildings.tower.health = 10;
  assert.ok(Campaign.departureRisk(c).includes('tower'));
});

test('advancement lists the storage it needs, and every cost fits the storage reachable at the previous level', () => {
  const c = fresh();
  c.level = 3;
  const lines = Campaign.requirements(c).map(r => r[0]);
  assert.ok(lines.some(l => l.startsWith('Warehouse holds 144 timber')), lines.join(' | '));
  for (const [level, cost] of Object.entries(Campaign.advancement)) {
    const probe = fresh();
    probe.level = Number(level) - 1;
    probe.buildings.warehouse.level = [3, 6, 9, 10][probe.level - 1];
    probe.buildings.granary.level = [3, 6, 9, 10][probe.level - 1];
    probe.buildings.pasture.level = 1;
    for (const [key, n] of Object.entries(cost)) assert.ok(n <= Campaign.storage(probe, key), `${key} ${n} at level ${level}`);
  }
});

test('anti-dragon kit share accepts only the listed shares', () => {
  const c = fresh();
  assert.ok(Campaign.action(c, 'kit', '0.33'));
  assert.equal(c.kitShare, .33);
  assert.equal(Campaign.action(c, 'kit', '0.4'), false);
  assert.equal(c.kitShare, .33);
});

test('bolts and wall reinforcement are built at Level 3 and finish on schedule', () => {
  const c = lateVillage();
  c.level = 3;
  assert.ok(Campaign.canMakeBolts(c));
  assert.ok(Campaign.action(c, 'bolts'));
  assert.ok(Campaign.action(c, 'reinforce'));
  for (let i = 0; i < 4; i++) Campaign.advance(c);
  assert.equal(c.bolts, 5);
  assert.equal(c.reinforced, true);
});

test('the Favor hero slows favor loss and adds favor to met demands', () => {
  const loss = withHero => {
    const c = fresh();
    if (withHero) c.heroes.push({ specialty: 'Favor', trait: 1, level: 1, health: 14, mode: 'inside' });
    c.demand = { cost: { food: 1 }, due: c.day + 4 };
    const start = c.dragon.favor;
    Campaign.action(c, 'demand', 'refuse');
    return start - c.dragon.favor;
  };
  assert.ok(Math.abs(loss(true) - loss(false) * .75) < 1e-9);
  const c = fresh();
  c.heroes.push({ specialty: 'Favor', trait: 1, level: 1, health: 14, mode: 'inside' });
  c.demand = { cost: { food: 1 }, due: c.day + 4 };
  const start = c.dragon.favor;
  Campaign.action(c, 'demand', 'deliver');
  assert.equal(c.dragon.favor, Math.min(100, start + 11));
  assert.equal(c.dragon.buffUntil, c.day + 3);
});

test('every hero specialty has a stated effect', () => {
  for (const list of Object.values(Campaign.categories)) for (const name of list) assert.ok(Campaign.specialtyEffects[name], name);
});

test('the invasion is scouted when Level 4 is reached, and scouts can try again', () => {
  let tried = 0, known = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const c = fresh(seed);
    c.level = 3;
    c.queue.push({ kind: 'advance', key: 'hall', day: c.day + 1, workers: 0 });
    Campaign.advance(c);
    assert.ok(c.invasionIntel, 'a roll was made');
    if (c.invasionKnown) { known++; continue; }
    tried++;
    c.day += 5;
    c.stock.food = 50;
    Campaign.action(c, 'unassign', 'farmers');
    assert.ok(Campaign.action(c, 'scout-invasion', 'watch'));
  }
  assert.ok(known > 10 && tried > 5, `${known} known, ${tried} retried`);
});

test('every encounter option runs and is recorded', () => {
  for (const [id, def] of Object.entries(CampaignEvents.roster)) {
    def.options.forEach((option, index) => {
      const c = lateVillage(3);
      c.dragon.health = 40; c.residents = 30; c.buildings.homes.level = 9;
      c.event = { id, offered: c.day, due: c.day + 2, target: def.target?.(c) ?? null };
      if (!option.enabled(c)) return;
      assert.ok(CampaignEvents.choose(c, String(index)), `${id} option ${index}`);
      for (let i = 0; i < 3; i++) Campaign.advance(c);   // finish any queued reward or journal clue
      for (const page of c.journal) assert.ok(Campaign.stories[page] || CampaignEvents.journalEntries[page], `${id} adds journal page '${page}' with no text`);
      c.event = null;
      assert.equal(c.event, null);
      assert.ok(c.eventHistory.some(h => h.id === id));
      assert.ok(Campaign.validate(c), `${id} option ${index} leaves a valid save`);
    });
    const c = lateVillage(3);
    c.event = { id, offered: c.day, due: c.day + 2, target: def.target?.(c) ?? null };
    assert.ok(CampaignEvents.choose(c, 'pass'), `${id} pass`);
  }
});

test('the run is declared lost when no residents remain and none can arrive', () => {
  const c = fresh();
  c.residents = 0;
  for (const key of Object.keys(c.army)) c.army[key] = [];
  for (const key of Object.keys(c.jobs)) c.jobs[key] = 0;
  c.queue = [];
  c.stock.food = 0; c.stock.timber = 0;
  Campaign.advance(c);
  assert.equal(c.status, 'defeat');
});

test('restoring a checkpoint restores the random state', () => {
  const c = fresh(77);
  const point = structuredClone(c.checkpoints[2]);
  for (let i = 0; i < 30; i++) { if (c.threat && c.day >= c.threat.day) break; Campaign.advance(c); Campaign.action(c, 'summon'); }
  assert.ok(Campaign.action(c, 'restore', '2'));
  assert.equal(c.day, point.day);
  assert.equal(c.draws, point.draws);
  assert.equal(c.eventDraws, point.eventDraws);
});

test('battles resolve through the run 10 adapter and leave a valid save', async () => {
  const c = fresh(31);
  advanceUntil(c, x => x.threat && x.day >= x.threat.day);
  assert.ok(c.threat && c.day >= c.threat.day, 'a raid arrived');
  assert.equal(Campaign.action(c, 'fight'), false, 'battles are not resolved synchronously');
  const result = await server.resolve(Campaign.battleSnapshot(c));
  assert.equal(result.engine, '3.2h-trial');
  assert.ok(Campaign.applyBattle(c, result));
  assert.equal(c.threat, null);
  assert.ok(Campaign.validate(c));
  assert.ok(['withdrawal', 'breach', 'defeat'].includes(c.reports.at(-1).outcome));
});

test('the same campaign seed gives the same battle', async () => {
  const a = fresh(41), b = fresh(41);
  advanceUntil(a, x => x.threat && x.day >= x.threat.day);
  advanceUntil(b, x => x.threat && x.day >= x.threat.day);
  assert.deepEqual(await server.resolve(Campaign.battleSnapshot(a)), await server.resolve(Campaign.battleSnapshot(b)));
});
