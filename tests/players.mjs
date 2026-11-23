// Scripted players for the full campaign (GAME-FIX-1 C3).
// They play the real campaign code day by day and resolve every battle through the run 10 adapter.
// Profiles follow the run 10 player types: perfect (right or wrong choices), prepared, average, careless; plus solo dragon.

export const PROFILES = {
  'perfect-right': { skill: 1.0, housing: 1.0, scout: true, choices: 'right', heroes: 3, gearTier: 4, demands: 1.0, act: 1 },
  'perfect-wrong': { skill: 1.0, housing: 1.0, scout: true, choices: 'wrong', heroes: 3, gearTier: 4, demands: 1.0, act: 1 },
  prepared: { skill: .85, housing: .9, scout: true, choices: 'balanced', heroes: 2, gearTier: 3, demands: .9, act: 1 },
  average: { skill: .6, housing: .75, scout: false, choices: 'none', heroes: 1, gearTier: 2, demands: .6, act: 2, learns: true },
  careless: { skill: .3, housing: .5, scout: false, choices: 'none', heroes: 0, gearTier: 0, demands: 0, act: 4, noWalls: true }
};
export const APPROACHES = {
  dragon: { army: 0, dragonLevel: 4 },
  military: { army: 22, dragonLevel: 1 },
  hybrid: { army: 12, dragonLevel: 2 }
};

const RIGHT = { horde: 'towers', siege: 'walls', wyrm: 'ballistae' };
const WRONG = { horde: 'ballistae', siege: 'towers', wyrm: 'walls' };
const KIT_RIGHT = { dragon: { horde: .33, siege: .33, wyrm: .5 }, none: { horde: .5, siege: .5, wyrm: .67 } };

export function makePlayer(Campaign, CampaignEvents, profileName, approachName, seed) {
  const profile = PROFILES[profileName], approach = APPROACHES[approachName];
  const solo = approachName === 'solo';
  const A = solo ? { army: 0, dragonLevel: 4 } : approach;
  let rngState = (seed ^ 0x9e3779b9) >>> 0;
  const rand = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0; return rngState / 4294967296; };

  function plan(c) {
    if (c.level < 4 || !c.invasionType) return 'balanced';
    if (profile.choices === 'right' && c.invasionKnown) return RIGHT[c.invasionType];
    if (profile.choices === 'wrong') return WRONG[c.invasionType];
    if (profile.choices === 'balanced') return 'balanced';
    return 'none';
  }

  function kitShare(c) {
    const dragon = Campaign.livingDragon(c) ? 'dragon' : 'none';
    if (profile.choices === 'right' && c.invasionKnown) return KIT_RIGHT[dragon][c.invasionType];
    if (profile.choices === 'wrong') return dragon === 'dragon' ? .15 : .25;
    if (profile.choices === 'balanced') return .33;
    if (profile.learns && c.flyRaids > 0) return .15;
    return 0;
  }

  function act(c, verb, key = '') { return Campaign.action(c, verb, key); }

  function staff(c) {
    for (const job of Object.keys(c.jobs)) while (c.jobs[job]) act(c, 'unassign', job);
    const builders = c.level >= 3 ? 2 : 1;
    const { bakers, farmers, herders } = foodPlan(c);
    const want = [];
    for (let i = 0; i < Math.max(farmers, bakers); i++) { if (i < farmers) want.push('farmers'); if (i < bakers) want.push('bakers'); }
    const essential = want.length;
    if (herders) want.push('herders');
    if (c.level >= 3 && A.dragonLevel >= 3) want.push('growers');
    if (c.level >= 3) want.push('miners', 'smiths');
    if (c.level >= 3 && Campaign.troops(c) > 10) want.push('smiths');
    const timberNeed = Math.max(0, goal(c).timber - c.stock.timber), stoneNeed = Math.max(0, goal(c).stone - c.stock.stone);
    for (let i = 0; i < 12; i++) {
      want.push(timberNeed / 2 >= stoneNeed ? 'woodcutters' : 'quarrymen');
      want.push(timberNeed / 2 >= stoneNeed ? 'quarrymen' : 'woodcutters');
      if (c.level >= 3 && i % 3 === 0) want.push('miners');
    }
    want.forEach((job, i) => { if (Campaign.free(c) > (i < essential ? 0 : builders)) act(c, 'assign', job); });
  }

  // What the village is saving for next.
  function goal(c) {
    const req = Campaign.requirements(c);
    const next = Campaign.advancement[c.level + 1];
    if (next && req.slice(0, 3).every(r => r[1])) return { timber: next.timber, stone: next.stone };
    const order = buildOrder(c);
    const key = order.find(k => c.buildings[k].level < [3, 6, 9, 10][c.level - 1] && c.level >= Campaign.buildings[k][1]);
    const cost = key ? Campaign.buildCost(c, key) : {};
    return { timber: cost.timber ?? 0, stone: cost.stone ?? 0 };
  }

  const jobCap = (c, job) => (job === 'farmers' ? 3 : 2) + Math.max(0, Campaign.levelOf(c, Campaign.jobs[job][2]) - 1) * 2;
  function foodPlan(c) {
    const rations = Campaign.rations(c);
    const foodNeed = rations * 1.08 + (c.stock.food < 6 * rations ? 1.5 : 0);
    const herders = Campaign.livingDragon(c) && (A.dragonLevel > 1) && c.level >= 2 ? (c.dragon.level >= 3 ? 2 : 1) : 0;
    const bakers = Math.ceil(foodNeed / 2);
    const farmers = Math.ceil((foodNeed * 1.5 + herders * .6) / 2 / (c.altar.blessing === 'harvest' ? 1.05 : 1));
    return { bakers, farmers, herders };
  }
  function buildOrder(c) {
    const order = [];
    const cap = [3, 6, 9, 10][c.level - 1];
    const food = foodPlan(c);
    if (food.farmers > jobCap(c, 'farmers') - 1) order.push('farm');
    if (food.bakers > jobCap(c, 'bakers') - 1) order.push('oven');
    if (Campaign.beds(c) <= c.residents + 1 && c.buildings.homes.level < cap) order.push('homes');
    const next = Campaign.advancement[c.level + 1];
    if (next) {
      if (Campaign.levelOf(c, 'hall') < c.level) order.push('hall');
      if (Campaign.levelOf(c, 'oven') < c.level) order.push('oven');
      for (const [k, n] of Object.entries(next)) if (n > Campaign.storage(c, k)) order.push(k === 'food' || k === 'grain' ? 'granary' : 'warehouse');
    }
    if (c.level >= 3 && !Campaign.levelOf(c, 'mine')) order.push('mine');
    if (c.level === 4) {
      // The countdown: counters and equipment first.
      const p = plan(c);
      if (!profile.noWalls) order.push(p === 'towers' ? 'tower' : p === 'ballistae' ? 'ballista' : 'wall');
      if (A.army) order.push('barracks', 'archery', 'stables', 'workshop');
      if (!profile.noWalls) order.push('wall', 'tower', 'ballista');
    }
    order.push('farm', 'oven', 'wood', 'quarry');
    if (c.level >= 3) order.push('mine', 'workshop');
    if (!profile.noWalls) order.push('wall');
    if (c.level >= 2 && A.dragonLevel >= 2) order.push('pasture');
    if (c.level >= 3 && A.dragonLevel >= 3) order.push('herbGarden', 'healer');
    const p = plan(c);
    if (c.level >= 2 && !profile.noWalls && (p === 'towers' || p === 'balanced' || A.army === 0)) order.push('tower');
    if (c.level >= 3 && !profile.noWalls && (p === 'ballistae' || p === 'balanced' || A.army === 0)) order.push('ballista');
    if (A.army) order.push('barracks');
    if (A.army && c.level >= 2) order.push('archery');
    if (A.army && c.level >= 3) order.push('stables');
    order.push('homes', 'granary', 'warehouse');
    if (c.level >= 4 && !profile.noWalls) order.push('bastion');
    return order;
  }

  function wantsTarget(c, key) {
    const p = plan(c);
    if (key === 'tower') return A.army === 0 ? true : Campaign.levelOf(c, 'tower') < (p === 'towers' ? 6 : p === 'balanced' ? 2 : 1);
    if (key === 'ballista') return Campaign.levelOf(c, 'ballista') < (p === 'ballistae' ? 5 : p === 'balanced' ? 2 : A.army === 0 ? 2 : 1);
    if (['barracks', 'archery', 'stables'].includes(key)) return Campaign.levelOf(c, key) < ([3, 6, 9, 10][profile.gearTier - 1] ?? 0);
    if (key === 'wall' && c.level === 4) return true;
    return true;
  }

  // A careful chief only commits to Level 4 (and the invasion countdown) once the defense is in place.
  function readyForInvasion(c) {
    const s = profile.skill;
    if (s < .5) return true;
    const wallOk = profile.noWalls || Campaign.levelOf(c, 'wall') >= Math.round(7 * s);
    const armyOk = !A.army || Campaign.troops(c) >= Math.floor(Math.min(A.army, Campaign.garrison(c) - 2 * A.dragonLevel) * .6 * s);
    const dragonOk = A.dragonLevel < 2 || !Campaign.livingDragon(c) || c.dragon.level >= Math.min(3, A.dragonLevel) - (s < .9 ? 1 : 0);
    const gearOk = !A.army || Object.entries(c.army).every(([k, u]) => !u.length || c.gear[k].tier >= Math.min(2, profile.gearTier));
    return wallOk && armyOk && dragonOk && gearOk;
  }

  function day(c) {
    const turn = c.day % profile.act === 0;
    if (c.demand) {
      const pay = rand() < profile.demands && Campaign.canPay(c, c.demand.cost) && c.stock.food - c.demand.cost.food > 3 * Campaign.rations(c);
      if (pay || c.demand.due <= c.day + 1) act(c, 'demand', pay ? 'deliver' : 'refuse');
    }
    if (c.departure) act(c, 'departure', 'keep');
    if (c.event) {
      const def = CampaignEvents.roster[c.event.id];
      const index = profile.skill < .5 ? -1 : def.options.findIndex(o => o.enabled(c));
      if (index < 0) act(c, 'event', 'pass'); else act(c, 'event', String(index));
    }
    if (c.threat && !c.threat.intel && profile.scout) act(c, 'scout', 'watch');
    if (c.level === 4 && !c.invasionKnown && profile.scout) act(c, 'scout-invasion', 'watch');
    if (!turn) return;
    staff(c);
    act(c, 'recruit', 'homes');
    if (c.level < 3 || readyForInvasion(c)) act(c, 'advance', '');
    const req = Campaign.requirements(c);
    const food = foodPlan(c);
    const urgent = food.farmers > jobCap(c, 'farmers') || food.bakers > jobCap(c, 'bakers')
      || (Campaign.beds(c) <= c.residents && c.buildings.homes.level < [3, 6, 9, 10][c.level - 1]);
    const nextCost = Campaign.advancement[c.level + 1] ?? {};
    const needsMine = nextCost.iron && !Campaign.levelOf(c, 'mine');
    const saving = req.length && req.slice(0, 3).every(r => r[1]) && !req.at(-1)[1] && c.level < 3 && !urgent && !needsMine;
    for (const key of ['wall', 'tower', 'ballista', 'bastion', 'farm', 'oven', 'wood', 'quarry', 'homes', 'hall']) act(c, 'repair', key);
    if (!saving) {
      // Build strictly in priority order: save for the first wanted project instead of buying cheaper ones.
      const cap = [3, 6, 9, 10][c.level - 1];
      const next = buildOrder(c).find(k => wantsTarget(c, k) && c.level >= Campaign.buildings[k][1] && c.buildings[k].level < cap
        && c.buildings[k].health > 0 && !Campaign.queued(c, 'build', k));
      if (next) act(c, 'build', next);
    }
    // dragon
    if (Campaign.livingDragon(c)) {
      if (c.dragon.level < A.dragonLevel) act(c, 'dragon-grow');
      if (c.dragon.health < Campaign.dragonMax(c) - 14) act(c, 'salve');
      if (c.dragon.favor < 45 && profile.skill >= .6) act(c, 'offer');
      if (c.dragon.stance !== 'guard' && c.threat?.wave !== 3) act(c, 'stance', 'guard');
    }
    // army
    const targetArmy = Math.min(A.army, c.level === 2 ? 3 + Math.floor(Math.max(0, c.residents - 10) * .25)
      : Math.floor(c.residents * (c.level === 3 ? .3 : A.army > 12 ? .45 : .35)) + 2);
    if (!saving && Campaign.troops(c) < targetArmy) {
      for (const t of ['cavalry', 'swordsmen', 'archers', 'spearmen']) if (act(c, 'train', t)) break;
    }
    for (const t of Object.keys(c.army)) if (c.gear[t].tier < profile.gearTier) act(c, 'gear', `${t}.${c.gear[t].tier === 3 && plan(c) !== 'none' ? 1 : 0}`);
    const share = kitShare(c);
    const nearest = Campaign.kitShares.reduce((a, b) => Math.abs(b - share) < Math.abs(a - share) ? b : a);
    if (c.kitShare !== nearest) act(c, 'kit', String(nearest));
    // counters
    const p = plan(c);
    if ((p === 'walls' || (p === 'balanced' && profile.choices === 'balanced' && A.army === 0)) && !profile.noWalls) act(c, 'reinforce');
    const boltsWanted = p === 'ballistae' ? 30 : p === 'balanced' ? 10 : profile.learns && c.flyRaids ? 5 : 0;
    if (c.bolts < boltsWanted) act(c, 'bolts');
    // heroes
    if (c.heroes.length < Math.min(profile.heroes, c.level - 1)) {
      if (!c.altar.offer && act(c, 'summon')) {
        const prefer = A.army ? ['attack', 'defense', 'fortifications', 'production', 'dragon'] : ['dragon', 'fortifications', 'production', 'defense', 'attack'];
        const pick = prefer.find(k => c.altar.offer.options.includes(k)) ?? c.altar.offer.options[0];
        act(c, 'category', pick);
        act(c, 'choose-hero', '0');
      }
    }
    c.heroes.forEach((h, i) => { if (h.mode !== 'fortifications') act(c, 'hero-mode', `${i}.fortifications`); act(c, 'hero-train', String(i)); });
  }

  return { day, plan, profile, approach: A };
}
