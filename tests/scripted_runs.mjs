// Scripted full campaigns (GAME-FIX-1 C3).
// Usage: node tests/scripted_runs.mjs [--seeds 200] [--profiles perfect-right,average] [--approaches dragon,hybrid] [--out results.json] [--check]
// --check exits with an error if any run crashes, stalls, soft-locks, or an encounter never fires.
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { loadGame, BattleServer, openingVillage } from './harness.mjs';
import { makePlayer, PROFILES, APPROACHES } from './players.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((list, arg, i, all) =>
  arg.startsWith('--') ? [...list, [arg.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : list, []));
const seeds = Number(args.seeds ?? 50);
const profiles = (args.profiles ?? Object.keys(PROFILES).join(',')).split(',');
const approaches = (args.approaches ?? [...Object.keys(APPROACHES), 'solo'].join(',')).split(',');
const MAX_DAY = 1500;
const BUDGET = { 2: [90, 135], 3: [120, 165], 4: [90, 150] };   // brief 1.4, days spent at Levels 2-4

const { Campaign, CampaignEvents } = loadGame();
const servers = Array.from({ length: Math.max(1, Math.min(8, cpus().length)) }, () => new BattleServer());

async function playOne(profileName, approachName, seed, server) {
  const v = openingVillage(seed);
  const c = Campaign.start(v);
  const player = makePlayer(Campaign, CampaignEvents, profileName, approachName === 'solo' ? 'dragon' : approachName, seed);
  if (approachName === 'solo') Object.assign(player.profile, { noWalls: true, heroes: 0 }), player.approach.army = 0;
  const reached = { 2: c.day };
  const events = new Set(), options = new Set();
  let idle = 0, lastDay = c.day, error = null;
  try {
    while (c.status === 'active' && c.day < MAX_DAY) {
      if (c.threat && c.day >= c.threat.day) {
        const result = await server.resolve(Campaign.battleSnapshot(c));
        if (!Campaign.applyBattle(c, result)) throw new Error('battle not applied');
        continue;
      }
      if (c.event) events.add(c.event.id);
      const before = c.eventHistory.length;
      player.day(c);
      for (const h of c.eventHistory.slice(before)) options.add(`${h.id}:${h.result}`);
      const level = c.level;
      const out = Campaign.advance(c);
      if (c.level !== level) reached[c.level] = c.day;
      if (out === null && c.status === 'active') throw new Error('advance refused while active');
      idle = c.day === lastDay ? idle + 1 : 0;
      lastDay = c.day;
      if (idle > 5) throw new Error('soft-lock: the day stopped advancing');
    }
  } catch (e) { error = String(e.message ?? e); }
  if (!Campaign.validate(c)) error ??= 'campaign state failed validation';
  const lastReport = c.reports.at(-1);
  return {
    profile: profileName, approach: approachName, seed, status: error ? 'error' : c.status === 'active' ? 'horizon' : c.status,
    error, day: c.day, level: c.level, wave: c.wave, reached, raids: c.raidCount, flyRaids: c.flyRaids, troops: Campaign.troops(c),
    dragonLevel: Campaign.livingDragon(c) ? c.dragon.level : 0, invasionType: c.invasionType, invasionKnown: c.invasionKnown,
    cause: lastReport?.outcome === 'defeat' ? `wave ${lastReport.wave || 'raid'} · ${lastReport.cause ?? 'Town Center destroyed'}` : (c.status === 'defeat' ? 'no residents' : null),
    deadlocks: c.reports.filter(r => r.deadlock).length, events: [...events], options: [...options]
  };
}

const jobs = [];
for (const profile of profiles) for (const approach of approaches) {
  if (approach === 'solo' && profile !== 'perfect-right') continue;
  for (let i = 0; i < seeds; i++) jobs.push([profile, approach, 5000000 + i]);
}
const results = [];
let cursor = 0;
await Promise.all(servers.map(async server => {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    results.push(await playOne(...job, server));
  }
}));
servers.forEach(s => s.close());

// Summary tables
const groups = {};
for (const r of results) (groups[`${r.profile} / ${r.approach}`] ??= []).push(r);
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : '—';
const median = list => { const s = list.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
console.log('\nWin rates and pacing (days spent at each level, median)');
console.log('profile / approach'.padEnd(26), 'win', 'defeat', 'horizon', 'error', ' L2  L3  L4  end');
for (const [key, list] of Object.entries(groups)) {
  const n = list.length, count = s => list.filter(r => r.status === s).length;
  const spent = lvl => median(list.map(r => r.reached[lvl + 1] !== undefined && r.reached[lvl] !== undefined ? r.reached[lvl + 1] - r.reached[lvl]
    : lvl === 4 && r.reached[4] !== undefined && r.status === 'victory' ? r.day - r.reached[4] : NaN));
  console.log(key.padEnd(26), pct(count('victory'), n).padStart(6), pct(count('defeat'), n).padStart(6), pct(count('horizon'), n).padStart(6),
    String(count('error')).padStart(4), String(spent(2) ?? '—').padStart(4), String(spent(3) ?? '—').padStart(4), String(spent(4) ?? '—').padStart(4), String(median(list.map(r => r.day))).padStart(5));
}
console.log('\nCauses of defeat');
for (const [key, list] of Object.entries(groups)) {
  const causes = {};
  for (const r of list.filter(r => r.status === 'defeat')) {
    const k = `L${r.level} ${(r.cause ?? '?').replace(/;.*$/, '')}`;
    causes[k] = (causes[k] ?? 0) + 1;
  }
  if (Object.keys(causes).length) console.log(key.padEnd(26), Object.entries(causes).map(([k, n]) => `${k}: ${n}`).join(' · '));
}
const fired = new Set(results.flatMap(r => r.events));
const missing = Object.keys(CampaignEvents.roster).filter(id => !fired.has(id));
const optionsTaken = new Set(results.flatMap(r => r.options));
console.log(`\nEncounters fired: ${fired.size} of ${Object.keys(CampaignEvents.roster).length}${missing.length ? ` (never: ${missing.join(', ')})` : ''}`);
console.log(`Encounter results seen: ${optionsTaken.size}`);
const errors = results.filter(r => r.status === 'error');
const deadlocks = results.reduce((n, r) => n + r.deadlocks, 0);
console.log(`Errors: ${errors.length} · Deadlock rulings: ${deadlocks} · Horizon (no result by day ${MAX_DAY}): ${results.filter(r => r.status === 'horizon').length}`);
for (const e of errors.slice(0, 5)) console.log(`  ${e.profile}/${e.approach}/${e.seed}: ${e.error}`);
if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 1));
if (args.check) {
  const failures = [];
  if (errors.length) failures.push(`${errors.length} runs failed`);
  if (missing.length) failures.push(`encounters never fired: ${missing.join(', ')}`);
  if (failures.length) { console.error(`\nFAIL: ${failures.join('; ')}`); process.exit(1); }
  console.log('\nPASS');
}
