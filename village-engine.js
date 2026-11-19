// Interactive Level 1 rules. The Python Run 10 resolver owns combat.
const RAID_DAY = 36;
const RALLY_BONUS = 15;
const DRAGON_STANCES = {
  guard: { name: 'Guard', cost: 0 },
  rally: { name: 'Rally', cost: 5 }
};
const TRAINING = { provisions: 3, timber: 2, days: 3 };
const UPGRADE = { timber: 4, stone: 3, days: 2 };
const REPAIR = { timber: 3, days: 2 };
const LEVEL_TWO = { timber: 16, stone: 12, days: 5 };
const OPENING_BUILDINGS = {
  homes: { name: 'First house', timber: 6, stone: 4, days: 2 },
  farm: { name: 'Grain field', timber: 4, stone: 0, days: 1 },
  oven: { name: 'Provisioner', timber: 5, stone: 2, days: 1 },
  wood: { name: 'Woodcutters', timber: 3, stone: 0, days: 1 },
  quarry: { name: 'Quarry', timber: 3, stone: 3, days: 1 }
};
const OPENING_STOCKS = { grain: 12, food: 35, timber: 36, stone: 24 };
const FIRST_HOUSEHOLD = 8;
const HUNGER_LIMIT = 4;
const DRAGON_RATION = 0.6;
const DRAGON_RESERVE = 18;
const DEFAULT_VILLAGE_NAME = 'Last Hearth';

const VillageEngine = {
  newVillage() {
    return {
      version: 2, seed: 1, day: 32, raidDay: RAID_DAY, chiefName: 'Chief', villageName: DEFAULT_VILLAGE_NAME, grain: 12, food: 35, timber: 18, stone: 12,
      residents: 16, otherWorkers: 11, settled: true, economicDefeat: false,
      hunger: { civilians: 0, soldiers: 0, dragon: 0 },
      dragon: { reserve: DRAGON_RESERVE, health: 60, favor: 65 },
      farmers: 3, bakers: 2, spearmen: 0, defenders: 0,
      trainingDay: null, offered: false, rallyPaid: false, barracksLevel: 1,
      upgradeDay: null, level: 1, advancementDay: null, wallHealth: 100, repairDay: null, result: null, guide: 0
    };
  },
  newOpening(chiefName, villageName) {
    return {
      ...this.newVillage(), chiefName, villageName, day: 1, raidDay: null,
      residents: 0, otherWorkers: 0, settled: false, farmers: 0, bakers: 0, woodcutters: 0, quarrymen: 0,
      grain: 0, food: 0, timber: 0, stone: 0, guide: 14,
      opening: { phase: 'stockpile', plots: {}, hints: true }
    };
  },
  claimStockpile(state) {
    if (state.opening?.phase !== 'stockpile') return false;
    Object.assign(state, OPENING_STOCKS);
    state.opening.phase = 'homes';
    return true;
  },
  beds(state) {
    return state.opening ? (state.opening.plots.homes?.ready ? 10 : 0) : 28;
  },
  admitHousehold(state) {
    if (state.opening?.phase !== 'refugees' || this.beds(state) - state.residents < FIRST_HOUSEHOLD) return false;
    state.residents += FIRST_HOUSEHOLD;
    state.settled = true;
    state.opening.phase = 'farm';
    return true;
  },
  canBuild(state, place) {
    const plan = OPENING_BUILDINGS[place];
    return Boolean(plan && state.opening?.phase === place && !state.opening.plots[place]
      && state.timber >= plan.timber && state.stone >= plan.stone);
  },
  build(state, place) {
    if (!this.canBuild(state, place)) return false;
    const plan = OPENING_BUILDINGS[place];
    state.timber -= plan.timber;
    state.stone -= plan.stone;
    state.opening.plots[place] = { due: state.day + plan.days, ready: false };
    return true;
  },
  startRaidWarning(state) {
    if (state.opening?.phase !== 'scout') return false;
    state.raidDay = state.day + 4;
    state.opening.phase = 'prepare';
    return true;
  },
  freeWorkers(state) {
    return state.residents - state.otherWorkers - state.farmers - state.bakers - (state.woodcutters ?? 0) - (state.quarrymen ?? 0) - state.spearmen
      - Number(Boolean(state.trainingDay));
  },
  grainYield(farmers) {
    return 2 * farmers;
  },
  provisionsMade(state, bakers = state.bakers) {
    return Math.min(2 * bakers, (state.grain + this.grainYield(state.farmers)) / 1.5);
  },
  rations(state) {
    return 0.15 * (state.residents + state.spearmen) + (state.dragon.health > 0 ? DRAGON_RATION : 0);
  },
  restore(state) {
    state.otherWorkers ??= state.opening ? 0 : 11;
    state.settled ??= !state.opening || state.residents > 0;
    state.hunger ??= { civilians: 0, soldiers: 0, dragon: 0 };
    state.dragon ??= { reserve: DRAGON_RESERVE, health: state.result?.dragonAfter ?? 60, favor: 65 };
    state.economicDefeat ??= false;
    state.level ??= 1;
    state.advancementDay ??= null;
    return state;
  },
  foodForecast(state) {
    const daily = this.rations(state);
    const maxBake = 2 * state.bakers;
    const grainRate = this.grainYield(state.farmers) / 1.5;
    const daysUntil = (stock, rate) => daily > rate
      ? Math.floor((stock + 1e-8) / (daily - rate)) + 1 : Infinity;
    return {
      net: this.provisionsMade(state) - daily,
      shortageIn: Math.min(daysUntil(state.food, maxBake), daysUntil(state.food + state.grain / 1.5, grainRate))
    };
  },
  feed(state, events) {
    const bill = { civilians: 0.15 * (state.residents - state.spearmen), soldiers: 0.30 * state.spearmen };
    for (const [group, need] of Object.entries(bill)) {
      const paid = Math.min(state.food, need);
      state.food -= paid;
      state.hunger[group] = paid + 1e-8 < need ? state.hunger[group] + 1 : 0;
    }
    const dragon = state.dragon;
    const dragonWasAlive = dragon.health > 0;
    if (dragonWasAlive) {
      const available = state.food + dragon.reserve;
      const paid = Math.min(state.food, DRAGON_RATION);
      state.food -= paid;
      dragon.reserve = Math.max(0, dragon.reserve - (DRAGON_RATION - paid));
      state.hunger.dragon = available + 1e-8 < DRAGON_RATION ? state.hunger.dragon + 1 : 0;
      if (state.hunger.dragon) {
        dragon.health = Math.max(0, dragon.health - 1.2);
        dragon.favor = Math.max(0, dragon.favor - 0.8);
      }
    } else {
      state.hunger.dragon = 0;
    }
    let firstHungerLoss = false;
    if (state.hunger.soldiers >= HUNGER_LIMIT && state.spearmen > 0) {
      state.spearmen -= 1;
      state.defenders = Math.min(state.defenders, state.spearmen);
      firstHungerLoss ||= state.hunger.soldiers === HUNGER_LIMIT;
      events.push('A hungry spearman deserted and returned to civilian work.');
    }
    if (state.hunger.civilians >= HUNGER_LIMIT && state.residents > state.spearmen) {
      if (this.freeWorkers(state) <= 0) {
        const job = ['otherWorkers', 'quarrymen', 'woodcutters', 'bakers', 'farmers'].find(role => state[role] > 0);
        if (job) state[job] -= 1;
        else state.trainingDay = null;
      }
      state.residents -= 1;
      firstHungerLoss ||= state.hunger.civilians === HUNGER_LIMIT;
      events.push('A resident left after four or more hungry days.');
    }
    const refugeesCanEnter = state.opening?.phase === 'refugees' && this.beds(state) >= FIRST_HOUSEHOLD;
    state.economicDefeat = state.settled && state.residents === 0 && !refugeesCanEnter;
    const dragonDied = dragonWasAlive && dragon.health <= 0;
    if (dragonDied) {
      state.offered = false;
      events.push('The golden dragon died after its reserves ran out.');
    }
    return {
      firstMissedRation: Object.values(state.hunger).some(days => days === 1),
      impendingLoss: ['civilians', 'soldiers'].some(group => state.hunger[group] === HUNGER_LIMIT - 1),
      firstHungerLoss, dragonDied
    };
  },
  refillDragonReserve(state, dailySurplus) {
    const surplus = Math.max(0, dailySurplus);
    const amount = Math.min(state.food, surplus, 0.2, DRAGON_RESERVE - state.dragon.reserve);
    if (state.dragon.health <= 0 || amount <= 0) return;
    state.food -= amount;
    state.dragon.reserve += amount;
  },
  changeStaff(state, role, delta) {
    const max = { farmers: 3, bakers: 2, woodcutters: 2, quarrymen: 2 }[role];
    if (delta < 0 ? state[role] < 1 : state[role] >= max || this.freeWorkers(state) < 1) return false;
    state[role] += delta;
    return true;
  },
  canTrain(state) {
    return !state.trainingDay && !state.hunger.civilians && !state.hunger.soldiers && this.freeWorkers(state) > 0
      && state.food >= TRAINING.provisions && state.timber >= TRAINING.timber;
  },
  train(state) {
    if (!this.canTrain(state)) return false;
    state.food -= TRAINING.provisions;
    state.timber -= TRAINING.timber;
    state.trainingDay = state.day + TRAINING.days;
    return true;
  },
  cancelTraining(state) {
    if (!state.trainingDay) return;
    state.trainingDay = null;
    state.food += TRAINING.provisions;
    state.timber += TRAINING.timber;
  },
  stanceCost(state, stance) {
    return stance === 'rally' && state.rallyPaid ? 0 : DRAGON_STANCES[stance].cost;
  },
  chooseStance(state, stance) {
    const cost = this.stanceCost(state, stance);
    if (state.result || state.food < cost) return false;
    state.food -= cost;
    state.offered = stance === 'rally';
    state.rallyPaid ||= state.offered;
    return true;
  },
  changeDefenders(state, delta) {
    const count = state.defenders + delta;
    if (!state.result && count >= 0 && count <= state.spearmen) state.defenders = count;
  },
  canUpgrade(state) {
    return state.barracksLevel === 1 && !state.upgradeDay
      && state.timber >= UPGRADE.timber && state.stone >= UPGRADE.stone;
  },
  upgrade(state) {
    if (!this.canUpgrade(state)) return;
    state.timber -= UPGRADE.timber;
    state.stone -= UPGRADE.stone;
    state.upgradeDay = state.day + UPGRADE.days;
  },
  canRepair(state) {
    return state.wallHealth < 100 && !state.repairDay && state.timber >= REPAIR.timber;
  },
  repair(state) {
    if (!this.canRepair(state)) return;
    state.timber -= REPAIR.timber;
    state.repairDay = state.day + REPAIR.days;
  },
  canAdvanceVillage(state) {
    return state.opening?.phase === 'memory' && state.result?.status === 'won' && state.level === 1
      && !state.advancementDay && state.timber >= LEVEL_TWO.timber && state.stone >= LEVEL_TWO.stone;
  },
  advanceVillage(state) {
    if (!this.canAdvanceVillage(state)) return false;
    state.timber -= LEVEL_TWO.timber;
    state.stone -= LEVEL_TWO.stone;
    state.advancementDay = state.day + LEVEL_TWO.days;
    return true;
  },
  advance(state) {
    state.day += 1;
    const events = [];
    if (state.advancementDay === state.day) {
      state.level = 2;
      state.advancementDay = null;
      state.opening.phase = 'chapter-complete';
      events.push('Village Level 2 reached. The opening chapter is complete.');
    }
    if (state.opening) {
      const nextPhase = { homes: 'refugees', farm: 'farmers', oven: 'bakers', wood: 'woodcutters', quarry: 'quarrymen' };
      for (const [place, plot] of Object.entries(state.opening.plots)) {
        if (plot.ready || plot.due !== state.day) continue;
        plot.ready = true;
        if (state.opening.phase === place) state.opening.phase = nextPhase[place];
        events.push(`${OPENING_BUILDINGS[place].name} complete.`);
      }
      state.timber += 2 * state.woodcutters;
      state.stone += state.quarrymen;
    }
    if (state.trainingDay === state.day) {
      state.spearmen += 1;
      state.defenders += 1;
      state.trainingDay = null;
      events.push('Spearman ready.');
    }
    if (state.upgradeDay === state.day) {
      state.barracksLevel = 2;
      state.upgradeDay = null;
      events.push('Barracks upgraded.');
    }
    if (state.repairDay === state.day) {
      state.wallHealth = 100;
      state.repairDay = null;
      events.push('Wall repaired.');
    }
    const made = this.provisionsMade(state);
    state.grain = Math.max(0, state.grain + this.grainYield(state.farmers) - 1.5 * made);
    const dailySurplus = made - this.rations(state);
    state.food += made;
    const shortage = this.feed(state, events);
    this.refillDragonReserve(state, dailySurplus);
    if (state.food < 1e-8) state.food = 0;
    return { events, ...shortage };
  },
  raidInput(state) {
    return {
      day: state.day, tutorial: Boolean(state.opening), seed: state.seed, defenders: state.defenders, rallied: state.offered,
      wallHealth: state.wallHealth, dragonHealth: state.dragon.health, dragonFavor: state.dragon.favor,
      stocks: { grain: state.grain, provisions: state.food, timber: state.timber, stone: state.stone }
    };
  },
  applyRaid(state, result) {
    state.wallHealth = result.wallAfter;
    state.dragon.health = result.dragonAfter;
    state.food = result.stocks.provisions;
    state.grain = result.stocks.grain;
    state.timber = result.stocks.timber;
    state.stone = result.stocks.stone;
    state.spearmen -= result.casualties;
    state.defenders -= result.casualties;
    state.residents -= result.casualties;
    state.result = result;
    if (state.opening) state.opening.phase = 'aftermath';
  }
};
