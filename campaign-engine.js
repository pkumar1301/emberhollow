// The first raid keeps its original resolver. The campaign carries the same village forward.
const Campaign = (() => {
  const resources = { grain: 'Grain', food: 'Provisions', timber: 'Timber', stone: 'Stone',
    livestock: 'Livestock', herbs: 'Herbs', salve: 'Salve', iron: 'Iron', equipment: 'Equipment' };
  const jobs = {
    farmers: ['Farmers', 1, 'farm', 'grain', 2], bakers: ['Bakers', 1, 'oven', 'food', 2],
    woodcutters: ['Woodcutters', 1, 'wood', 'timber', 2], quarrymen: ['Quarry workers', 1, 'quarry', 'stone', 1],
    herders: ['Herders', 2, 'pasture', 'livestock', .75], growers: ['Herb growers', 2, 'herbGarden', 'herbs', 1],
    healers: ['Healers', 2, 'healer', 'salve', .5], miners: ['Miners', 3, 'mine', 'iron', 1],
    smiths: ['Smiths', 3, 'workshop', 'equipment', .75]
  };
  const buildings = {
    hall: ['Town Center', 1, { timber: 12, stone: 10 }],
    homes: ['Cottages', 1, { timber: 10, stone: 6 }],
    farm: ['Grain field', 1, { timber: 8, stone: 4 }],
    oven: ['Provisioner', 1, { timber: 8, stone: 5 }],
    wood: ['Woodcutters', 1, { timber: 7, stone: 4 }],
    quarry: ['Quarry', 1, { timber: 7, stone: 5 }],
    barracks: ['Barracks', 1, { timber: 8, stone: 6 }],
    wall: ['Walls', 1, { timber: 9, stone: 8 }],
    granary: ['Granary', 1, { timber: 8, stone: 5 }],
    warehouse: ['Warehouse', 1, { timber: 9, stone: 7 }],
    archery: ['Archery range', 2, { timber: 12, stone: 6 }],
    tower: ['Watchtowers', 2, { timber: 12, stone: 14 }],
    pasture: ['Livestock enclosure', 2, { timber: 8, stone: 4 }],
    herbGarden: ['Herb garden', 2, { timber: 8, stone: 4 }],
    healer: ['Healer', 2, { timber: 10, stone: 7 }],
    mine: ['Iron mine', 3, { timber: 14, stone: 10 }],
    workshop: ['Workshop', 3, { timber: 16, stone: 14, iron: 3 }],
    stables: ['Stables', 3, { timber: 20, stone: 10 }],
    ballista: ['Ballistae', 3, { timber: 16, stone: 14, iron: 6 }],
    bastion: ['Bastion', 4, { timber: 26, stone: 28, iron: 8 }]
  };
  const troopTypes = {
    spearmen: ['Spearmen', 1, 'barracks', { food: 3, timber: 2 }, 3, 2.4],
    archers: ['Archers', 2, 'archery', { food: 4, timber: 3 }, 3, 3.2],
    swordsmen: ['Swordsmen', 3, 'barracks', { food: 5, iron: 2 }, 4, 4.5],
    cavalry: ['Cavalry', 3, 'stables', { food: 6, livestock: 2 }, 5, 5.3]
  };
  const equipment = {
    spearmen: [['Spear and shield','Pike'], ['Ash shafts','Iron heads'], ['Leather','Scale mail'], ['Halberds','Harpoon spears']],
    archers: [['Short bow','Longbow'], ['Composite bow','Crossbow'], ['Leather','Pavise shield'], ['Bodkin tips','Obsidian tips']],
    swordsmen: [['Sword and shield','Greatsword'], ['Balanced blade','Axe'], ['Chainmail','Plate'], ['Masterwork blades','Fireward shields']],
    cavalry: [['Light horse with sabres','Lancers'], ['Coursers','Destriers'], ['Light barding','Heavy barding'], ['Shock cavalry','Dragon hunters']]
  };
  const advancement = { 3: { timber: 48, stone: 36, food: 20 }, 4: { timber: 144, stone: 108, food: 60, iron: 12 } };
  const caps = [3, 6, 9, 10];
  const raidGaps = [25, 20, 15, 10];
  const stories = {
    2: ['The Old Seal', 'A survivor traces the seal in the dust. The chief remembers giving the order to close the gate, though the reason still escapes them.'],
    3: ['The Second Road', 'A recovered dispatch shows another road out of the city. Holding the first gate bought time for the families using that second road.'],
    4: ['The Hand at the Lever', 'The chief recognizes the torn cuff on the hand at the lever. In the smoke, the line of gold was the guardian reaching through the gate.']
  };
  const blessings = { harvest: 'Harvest · +5% grain', trust: 'Trust · slower favor loss', watch: 'Watch · +1 scouting' };
  const categories = { production: ['Grain production', 'Timber production'], defense: ['Scouting', 'Infantry defense'],
    attack: ['Archer damage', 'Infantry damage'], fortifications: ['Counter-fire', 'Wall defense'], dragon: ['Favor', 'Guardian strength'] };
  const traits = ['Strong bonus', 'Low upkeep', 'Battle-hardened'];
  const ranks = ['Recruit', 'Trained', 'Veteran', 'Elite'];
  const emptyMap = keys => Object.fromEntries(Object.keys(keys).map(key => [key, 0]));
  const defenses=['wall','tower','ballista','bastion'];

  function start(v) {
    if (v.campaign) return v.campaign;
    const built = Object.fromEntries(Object.keys(buildings).map(key => [key, { level: 0, health: 100 }]));
    for (const key of ['hall', 'homes', 'farm', 'oven', 'wood', 'quarry', 'wall', 'granary', 'warehouse']) built[key].level = 1;
    built.barracks.level = v.barracksLevel;
    built.wall.health = v.wallHealth;
    const army = { spearmen: Array.from({ length: v.spearmen }, () => 0), archers: [], swordsmen: [], cavalry: [] };
    const stock = emptyMap(resources);
    for (const key of ['grain', 'food', 'timber', 'stone']) stock[key] = v[key];
    const c = {
      version: 1, day: v.day, level: 2, seed: (v.campaignSeed ?? (v.seed ^ 0x84df1539)) >>> 0, draws: 0, residents: v.residents,
      stock, jobs: emptyMap(jobs), buildings: built, army, gear: { spearmen: { tier: 0, mode: 'field' }, archers: { tier: 0, mode: 'field' }, swordsmen: { tier: 0, mode: 'field' }, cavalry: { tier: 0, mode: 'field' } },
      dragon: { ...v.dragon, level: 1, victories: v.result?.status === 'won' ? 1 : 0, stance: 'guard', departed: false },
      shortage: 0, soldierShortage: 0, dragonShortage: 0, queue: [], reports: [], log: [],
      heroes: [], altar: { blessing: v.altarBlessing ?? null, lockedUntil: v.altarLockedUntil ?? 0, offer: null },
      threat: null, raidAt: v.day + raidGaps[1], raidCount: 0, wave: 0, invasionAt: null,
      event: null, eventAt: v.day + 5, eventDraws: 0, eventHistory: [], effects: [], checkpoints: {},
      demand: null, demandAt: v.day + 10, departure: false, journal: [2], repairDiscount: 0, status: 'active'
    };
    for (const key of ['farmers', 'bakers', 'woodcutters', 'quarrymen']) c.jobs[key] = v[key] ?? 0;
    if (v.trainingDay) c.queue.push({ kind: 'train', key: 'spearmen', day: v.trainingDay, workers: 1 });
    if (v.upgradeDay) c.queue.push({ kind: 'build', key: 'barracks', day: v.upgradeDay, workers: 0 });
    if (v.repairDay) c.queue.push({ kind: 'repair', key: 'wall', day: v.repairDay, workers: 0 });
    v.campaign = c;
    checkpoint(c);
    return c;
  }

  function random(seed, index) {
    let n = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
    n = Math.imul(n ^ n >>> 16, 0x21f0aaad);
    n = Math.imul(n ^ n >>> 15, 0x735a2d97);
    return ((n ^ n >>> 15) >>> 0) / 4294967296;
  }

  function checkpoint(c) {
    const { checkpoints, ...snapshot } = c;
    checkpoints[c.level] = structuredClone(snapshot);
  }

  function restorePoint(c, level) {
    const point = c.checkpoints[level];
    if (!point) return false;
    const checkpoints = c.checkpoints;
    Object.assign(c, structuredClone(point), { checkpoints });
    return true;
  }

  const troops = c => Object.values(c.army).reduce((count, units) => count + units.length, 0);
  const beds = c => 5 + 5 * c.buildings.homes.level;
  const livingDragon = c => c.dragon.health > 0 && !c.dragon.departed;
  const dragonMax = c => 50 + 14 * c.dragon.level;
  const levelOf = (c, key) => c.buildings[key].health > 0 ? c.buildings[key].level : 0;
  const free = c => Math.max(0, c.residents - troops(c) - Object.values(c.jobs).reduce((a,b) => a+b,0)
    - c.queue.reduce((n,j) => n + j.workers, 0));
  const garrison = c => [8,14,19,24][c.level - 1];
  const militaryLoad = c => troops(c) + Number(livingDragon(c)) * c.dragon.level * 2
    + ['tower','ballista','bastion'].reduce((n,key) => n + levelOf(c,key),0)
    + c.queue.filter(j => j.kind === 'train' || j.kind === 'build' && ['tower','ballista','bastion'].includes(j.key)).length;
  const canPay = (c, cost) => Object.entries(cost).every(([key,n]) => c.stock[key] + 1e-8 >= n);
  const pay = (c, cost) => { for (const [key,n] of Object.entries(cost)) c.stock[key] = Math.max(0,c.stock[key]-n); };
  const scaled = (cost, multiplier) => Object.fromEntries(Object.entries(cost).map(([key,n]) => [key, Math.ceil(n * multiplier)]));
  const labelCost = cost => Object.entries(cost).map(([key,n]) => `${n} ${resources[key].toLowerCase()}`).join(' · ');
  const queued = (c, kind, key) => c.queue.some(j => j.kind === kind && j.key === key);
  const nextAttack = c => c.threat?.day ?? c.invasionAt ?? c.raidAt;
  const rations = c => .15 * (c.residents + troops(c)) + c.heroes.reduce((n,h) => n + (h.trait === 1 ? .08 : .2),0)
    + (livingDragon(c) ? .6 + .24 * (c.dragon.level-1) : 0);
  const storage = (c,key) => (key === 'grain' || key === 'food' ? 36+34*levelOf(c,'granary') :
    key === 'livestock' ? 8+14*levelOf(c,'pasture') : 38+55*levelOf(c,'warehouse'));
  const add = (c,key,amount) => { c.stock[key] += Math.max(0, Math.min(amount, storage(c,key)-c.stock[key])); };
  const active = c => c.status === 'active' && (!c.threat || c.day < c.threat.day);
  const rank = units => units.length ? ranks[Math.min(3,Math.floor(units.reduce((a,b)=>a+b,0)/units.length/2))] : ranks[0];

  function record(c, text) {
    c.log.push({ day: c.day, text });
    if (c.log.length > 120) c.log.shift();
  }

  function buildCost(c, key) { return scaled(buildings[key][2], 1 + .55*c.buildings[key].level); }
  function repairCost(c, key) {
    const discount = defenses.includes(key) ? c.repairDiscount : 0;
    return { timber: Math.max(0,3+c.buildings[key].level-discount), stone: 2 };
  }
  function canBuild(c, key) {
    const b = buildings[key];
    return active(c) && b && c.level >= b[1] && c.buildings[key].level < caps[c.level-1]
      && free(c) > 0 && !queued(c,'build',key) && !queued(c,'repair',key)
      && c.buildings[key].health > 0 && canPay(c,buildCost(c,key))
      && (!['tower','ballista','bastion'].includes(key) || militaryLoad(c)<garrison(c));
  }
  function canRepair(c,key) {
    const b = c.buildings[key];
    return active(c) && b?.level > 0 && b.health < 100 && free(c)>0 && !queued(c,'repair',key) && canPay(c,repairCost(c,key));
  }
  function canTrain(c,key) {
    const t = troopTypes[key];
    return active(c) && t && c.level>=t[1] && levelOf(c,t[2]) && free(c)>0 && militaryLoad(c)<garrison(c)
      && !queued(c,'train',key) && c.shortage===0 && canPay(c,t[3]);
  }
  function gearCost(c,key,choice=0) {
    const tier = c.gear[key].tier;
    if(tier===0)return {timber:6+2*choice};
    if(tier===1 && key==='spearmen' && choice===0)return {timber:8};
    return { equipment:tier+1, iron:tier+choice };
  }
  function upkeep(gear,key) {
    const choices=gear.choices??[];
    return {
      equipment: .10*(Number(key==='archers'&&choices[1]===0)+Number(key==='swordsmen'&&choices[1]===0)
        +Number(['spearmen','swordsmen'].includes(key)&&choices[0]===0)),
      iron:.12*(Number(key==='spearmen'&&choices[1]===1)+Number(['swordsmen','cavalry'].includes(key)&&choices[2]===1)),
      food:key==='cavalry'&&choices[1]===1?.12:0
    };
  }
  const gearCap = (c,key) => [1,3,6,9].filter(level=>levelOf(c,troopTypes[key][2])>=level).length;
  const recruitmentViable = c => c.residents+c.queue.filter(j=>j.kind==='recruit').length<beds(c)
    && !queued(c,'recruit','homes') && canPay(c,{food:6,timber:3});
  const canRecruit = c => active(c) && recruitmentViable(c);
  function requirements(c) {
    const next = c.level+1;
    if (!advancement[next]) return [];
    return [
      [`Town Center building level ${next-1}`,levelOf(c,'hall')>=next-1],
      [`${next===3?10:15} residents`,c.residents>=(next===3?10:15)],
      [`Provisioner building level ${next-1}`,levelOf(c,'oven')>=next-1],
      [labelCost(advancement[next]),canPay(c,advancement[next])]
    ];
  }
  const canAdvance = c => active(c) && c.level<4 && !queued(c,'advance','hall') && requirements(c).every(([,met])=>met);
  const summonCost = c => scaled({ food: 10, timber: 8, stone: 6 },1 + c.heroes.length*.5);
  const availableCategories = c => Object.keys(categories).filter(key => categories[key].some(x=>!c.heroes.some(h=>h.specialty===x)));
  const canSummon = c => active(c) && c.heroes.length<c.level-1 && c.day>=c.altar.lockedUntil && !c.altar.offer
    && availableCategories(c).length>=3 && canPay(c,summonCost(c));
  const lockAltar = c => { c.altar.offer=null; c.altar.lockedUntil=c.day+5; };
  function offerHero(c, type) {
    const o = c.altar.offer;
    let available = categories[type].filter(x=>!c.heroes.some(h=>h.specialty===x) && x!==o.specialty);
    if (!available.length) return false;
    o.category = type;
    o.specialty = available[Math.floor(random(c.seed,c.draws++)*available.length)];
    return true;
  }

  function order(c, kind, key, days, cost={}, workers=0, extra={}) {
    pay(c,cost);
    c.queue.push({ kind,key,day:c.day+days,workers,...extra });
    return true;
  }

  function action(c, verb, key) {
    if (verb==='restore') return restorePoint(c,Number(key));
    if (verb==='fight') return c.status==='active' && c.threat?.day<=c.day && fight(c);
    if (!active(c)) return false;
    if (verb==='build' && canBuild(c,key)) return order(c,'build',key,2+c.buildings[key].level,buildCost(c,key),1);
    if (verb==='repair' && canRepair(c,key)) {
      const cost=repairCost(c,key);
      if (defenses.includes(key)) c.repairDiscount=0;
      return order(c,'repair',key,2,cost,1);
    }
    if (verb==='train' && canTrain(c,key)) return order(c,'train',key,troopTypes[key][4],troopTypes[key][3],1);
    if (verb==='demobilize' && c.army[key]?.length) {
      c.army[key].shift();
      return order(c,'demobilize',key,1,{},1);
    }
    if (verb==='accelerate') {
      const project=c.queue.find(j=>j.kind==='build'&&j.key===key);
      if(!project||project.day<=c.day+1||!free(c)||project.workers>=3)return false;
      project.day--;project.workers++;
      return true;
    }
    if (verb==='recruit' && canRecruit(c)) return order(c,'recruit','homes',2,{food:6,timber:3});
    if (verb==='advance' && canAdvance(c)) return order(c,'advance','hall',c.level+3,advancement[c.level+1]);
    if (['assign','unassign'].includes(verb) && Object.hasOwn(jobs,key)) {
      const cap = (key==='farmers'?3:2) + Math.max(0,levelOf(c,jobs[key][2])-1)*2;
      if (verb==='assign' && free(c)>0 && levelOf(c,jobs[key][2]) && c.jobs[key]<cap) c.jobs[key]++;
      else if (verb==='unassign' && c.jobs[key]>0) c.jobs[key]--;
      else return false;
      return true;
    }
    if (verb==='gear') {
      const [group,choice='0']=key.split('.');
      if(Object.hasOwn(c.gear,group)&&['0','1'].includes(choice)&&c.army[group].length&&!queued(c,'gear',group)
          && c.gear[group].tier<gearCap(c,group)&&canPay(c,gearCost(c,group,Number(choice)))) {
        return order(c,'gear',group,2,gearCost(c,group,Number(choice)),0,{choice:Number(choice)});
      }
      return false;
    }
    if (verb==='loadout' && c.gear[key]?.tier>=2 && c.army[key].length && !queued(c,'loadout',key)
        && canPay(c,{equipment:1})) return order(c,'loadout',key,1,{equipment:1});
    if (verb==='stance' && ['guard','hunt','rest'].includes(key) && livingDragon(c)) {
      if (key==='rest' && c.threat?.wave===3) return false;
      c.dragon.stance=key; return true;
    }
    if (verb==='salve' && livingDragon(c) && c.dragon.health<dragonMax(c) && canPay(c,{salve:1})) {
      pay(c,{salve:1}); c.dragon.health=Math.min(dragonMax(c),c.dragon.health+14); return true;
    }
    if (verb==='dragon-grow' && livingDragon(c) && c.dragon.level<c.level && c.dragon.victories>=c.dragon.level
        && canPay(c,{food:12,livestock:4,herbs:4})) {
      pay(c,{food:12,livestock:4,herbs:4}); c.dragon.level++; c.dragon.health+=14; return true;
    }
    if (verb==='offer' && livingDragon(c) && canPay(c,{food:5})) {
      pay(c,{food:5}); c.dragon.reserve=Math.min(25,c.dragon.reserve+5); c.dragon.favor=Math.min(100,c.dragon.favor+6); return true;
    }
    if (verb==='demand' && c.demand && (key==='refuse' || key==='deliver' && canPay(c,c.demand.cost))) {
      if (key==='deliver') { pay(c,c.demand.cost);c.dragon.favor=Math.min(100,c.dragon.favor+9); }
      else c.dragon.favor=Math.max(0,c.dragon.favor-(c.altar.blessing==='trust'?7:9));
      c.demand=null; c.demandAt=c.day+9; return true;
    }
    if (verb==='departure' && c.departure && ['keep','leave'].includes(key)) {
      c.departure=false; c.departureAt=c.day+8;
      if (key==='leave') {
        c.dragon.departed=true;c.demand=null;
        for (const [name,b] of Object.entries(c.buildings)) {
          if (name!=='hall' && b.level) {
            b.health=Math.max(0,b.health-15-Math.floor(random(c.seed^0x3414,c.draws++)*16));
            if (!b.health && defenses.includes(name)) b.level=0;
          }
        }
        for (const units of Object.values(c.army)) if (units.length>=4) {
          const losses=Math.floor(units.length*.1);
          units.splice(0,losses);c.residents-=losses;
        }
        record(c,'The guardian departed. The village must defend itself.');
      }
      return true;
    }
    if (verb==='bless' && Object.hasOwn(blessings,key) && c.day>=c.altar.lockedUntil && c.altar.blessing!==key) {
      c.altar.blessing=key; c.altar.lockedUntil=c.day+5; return true;
    }
    if (verb==='summon' && canSummon(c)) {
      const cost=summonCost(c);
      pay(c,cost);
      const remaining=availableCategories(c), options=[];
      while (options.length<3) options.push(remaining.splice(Math.floor(random(c.seed,c.draws++)*remaining.length),1)[0]);
      c.altar.offer={ options,cost, rerolls:0, category:null, specialty:null }; return true;
    }
    const o=c.altar.offer;
    if (verb==='category' && o && !o.category && o.options.includes(key)) return offerHero(c,key);
    if (verb==='reroll' && o?.category && o.rerolls<3 && categories[o.category].some(x=>x!==o.specialty&&!c.heroes.some(h=>h.specialty===x))) {
      const cost=scaled(o.cost,.5*(o.rerolls+1));
      if (!canPay(c,cost)) return false;
      pay(c,cost);o.rerolls++; return offerHero(c,o.category);
    }
    if (verb==='cancel-hero' && o && !o.arrival) { lockAltar(c);return true; }
    if (verb==='choose-hero' && o?.category && !o.arrival && ['0','1','2'].includes(key)) {
      o.arrival=c.day+3+c.heroes.length; o.trait=Number(key); return true;
    }
    if (verb==='scout' && c.threat && !c.threat.intel && free(c)>0 && c.day+1<c.threat.day && canPay(c,{food:3}) && !queued(c,'scout','watch')) {
      return order(c,'scout','watch',1,{food:3},1,{attackDay:c.threat.day});
    }
    const [heroIndex,mode] = key.split('.');
    const hero = c.heroes[Number(heroIndex)];
    if (verb==='hero-mode' && hero && ['inside','fortifications','engage'].includes(mode)) { hero.mode=mode; return true; }
    if (verb==='hero-train' && hero && hero.level<4 && canPay(c,{food:8,equipment:1})) {
      pay(c,{food:8,equipment:1});hero.level++;hero.health+=3;return true;
    }
    if (verb==='dismiss' && hero && c.day>=c.altar.lockedUntil && !o) { c.heroes.splice(Number(heroIndex),1);lockAltar(c);return true; }
    if (verb==='event') return CampaignEvents.choose(c,key);
    return false;
  }

  function finishOrders(c) {
    const pausedByBattle = j => ['repair','build'].includes(j.kind) && c.threat?.day === c.day;
    const ready = c.queue.filter(j=>j.day<=c.day && !pausedByBattle(j));
    c.queue=c.queue.filter(j=>j.day>c.day || pausedByBattle(j));
    let reachedLevel=false;
    for (const j of ready) {
      const b=c.buildings[j.key];
      if (j.kind==='build') { b.level++; b.health=100; record(c,`${buildings[j.key][0]} reached building level ${b.level}.`); }
      if (j.kind==='repair') { b.health=100; record(c,`${buildings[j.key][0]} repaired.`); }
      if (j.kind==='train') { c.army[j.key].push(0);record(c,`A recruit joined the ${troopTypes[j.key][0].toLowerCase()}.`); }
      if (j.kind==='recruit') {
        if (c.residents<beds(c)) { c.residents++; record(c,'A new resident arrived.'); }
        else { j.day++;c.queue.push(j); }
      }
      if (j.kind==='gear') {
        const kit=c.gear[j.key];
        kit.choices??=Array(kit.tier).fill(0);
        kit.choices.push(j.choice??0);kit.tier++;
        if(kit.tier===4)kit.mode=j.choice===1?'dragon':'field';
      }
      if (j.kind==='loadout') c.gear[j.key].mode=c.gear[j.key].mode==='dragon'?'field':'dragon';
      if (j.kind==='advance') {
        c.level++;
        c.journal.push(c.level);
        record(c,`Village Level ${c.level} reached. ${stories[c.level][0]} was added to the journal.`);
        if(c.level===4){ c.invasionAt=c.day+48; c.raidAt=null;record(c,`The invasion begins on Day ${c.invasionAt}.`); }
        reachedLevel=true;
      }
      if(j.kind==='scout' && c.threat?.day===j.attackDay){
        const guardian=livingDragon(c) && !c.effects.some(effect=>effect.key==='scout' && effect.until>=c.day);
        const roll=1+Math.floor(random(c.seed^0x65aa,c.draws++)*20);
        const total=roll+Number(c.altar.blessing==='watch')+3*Number(c.heroes.some(h=>h.specialty==='Scouting'))+Number(guardian);
        const dc=c.threat.wave===3?18:c.threat.wave?15:12;
        c.threat.intel={roll,total,dc,margin:total-dc};
        record(c,total>=dc?'The scout returned with reliable intelligence.':'The scout returned with incomplete intelligence.');
      }
      if(j.kind==='reward') {
        add(c,j.key,j.amount);
        record(c,`Collected ${j.amount} ${resources[j.key].toLowerCase()} from an encounter.`);
      }
      if(j.kind==='clue'){c.journal.push(j.key); if(j.key==='lamps')c.repairDiscount=2;}
    }
    const o=c.altar.offer;
    if (o?.arrival<=c.day) {
      c.heroes.push({ specialty:o.specialty, trait:o.trait, level:1, health:o.trait===2?20:14, mode:'inside' });
      record(c,`A hero specializing in ${o.specialty.toLowerCase()} arrived.`);
      lockAltar(c);
    }
    return reachedLevel;
  }

  function produce(c) {
    for (const [key,[,,building,product,rate]] of Object.entries(jobs)) {
      if (!levelOf(c,building) || !c.jobs[key]) continue;
      const affected=c.effects.some(effect=>effect.key===building && effect.until>=c.day);
      const bonus=(product==='grain' && c.altar.blessing==='harvest'?.05:0)
        + (product==='grain' && c.heroes.some(h=>h.specialty==='Grain production')?.1:0)
        + (product==='timber' && c.heroes.some(h=>h.specialty==='Timber production')?.1:0);
      let made=c.jobs[key]*rate*c.buildings[building].health/100*(affected?.5:1)*(1+bonus);
      const input={food:['grain',1.5],livestock:['grain',.8],salve:['herbs',2],equipment:['iron',1.5]}[product];
      made=Math.min(made,Math.max(0,storage(c,product)-c.stock[product]));
      if (input) {
        made=Math.min(made,c.stock[input[0]]/input[1]);
        c.stock[input[0]]=Math.max(0,c.stock[input[0]]-made*input[1]);
      }
      add(c,product,made);
    }
    for(const [key,units] of Object.entries(c.army)){
      const cost=upkeep(c.gear[key],key);
      for(const [input,amount] of Object.entries(cost)){
        c.stock[input]=Math.max(0,c.stock[input]-units.length*amount);
      }
    }
    const needed=rations(c)-(livingDragon(c)?.6+.24*(c.dragon.level-1):0);
    const deficit=Math.max(0,needed-c.stock.food);
    c.stock.food=Math.max(0,c.stock.food-needed);
    c.shortage=deficit>1e-8?c.shortage+1:0;
    if (c.shortage===1)record(c,'The village missed rations. Check the Provisioner and staffing.');
    if (c.shortage>=4 && c.residents>0) {
      const job=Object.keys(jobs).reverse().find(key=>c.jobs[key]);
      const unit=Object.keys(c.army).find(key=>c.army[key].length);
      if (free(c)===0) {
        if(job)c.jobs[job]--;
        else if(unit)c.army[unit].shift();
        else { const order=c.queue.findIndex(j=>j.workers);if(order>=0)c.queue.splice(order,1); }
      }
      c.residents--;record(c,'A resident left after repeated missed rations.');
    }
    if (!livingDragon(c)) { c.demand=null;c.departure=false;return; }
    const d=c.dragon;
    const food=.6+.24*(d.level-1);
    const served=Math.min(c.stock.food,food);
    c.stock.food-=served;
    const missed=d.reserve+served+1e-8<food;
    d.reserve=Math.max(0,d.reserve+served-food);
    const advanced={ livestock:d.level>=2?.22*(d.level-1):0, herbs:d.level>=3?.18*(d.level-2):0 };
    const supplied=canPay(c,advanced);
    if(supplied)pay(c,advanced);
    if(missed || !supplied){
      d.health=Math.max(0,d.health-1.2);
      d.favor=Math.max(0,d.favor-(c.altar.blessing==='trust'?.6:.9));
      c.dragonShortage++;
      if(c.dragonShortage===1)record(c,'The guardian missed part of its upkeep.');
    } else {
      c.dragonShortage=0;
      if(d.favor>0)d.health=Math.min(dragonMax(c),d.health+(d.stance==='rest'?1.3:.3));
      if(c.stock.food>food && d.reserve<25){ const extra=Math.min(.25,25-d.reserve);c.stock.food-=extra;d.reserve+=extra; }
    }
    if (d.favor>40 && troops(c)>2+d.level) d.favor=Math.max(40,d.favor-Math.min(.5,.04*(troops(c)-2-d.level)));
    if (!d.health) { c.departure=false;c.demand=null;record(c,'The guardian fell. The campaign can continue.'); }
  }

  function openThreat(c) {
    const day=nextAttack(c);
    if(c.threat || day===null || day-c.day>4)return false;
    const wave=c.invasionAt===null?0:c.wave+1;
    const type=['horde','siege','wyrm'][Math.floor(random(c.seed^0x2be9, c.raidCount+c.wave*3)*3)];
    const pressure=wave ? [0,56,71,84][wave] : [0,0,17,26,36][c.level]+Math.min(30,c.raidCount*3);
    const field=Math.round(pressure*(.87+random(c.seed^0x67ba,day)*.26));
    c.threat={ day,wave,type,field,boss:wave===3?125:!wave&&c.level>=3&&type==='wyrm'?28:0,intel:null };
    record(c,`${wave?`Invasion wave ${wave}`:'Raiders'} expected on Day ${day}.`);
    return true;
  }

  function advance(c) {
    if (!active(c)) return null;
    c.day++;
    const reachedLevel=finishOrders(c);
    const entries=c.log.length ? c.log.at(-1) : null;
    produce(c);
    if (c.demand?.due<=c.day) action(c,'demand','refuse');
    if(livingDragon(c) && c.dragon.favor===0 && c.day>=(c.departureAt??0)) c.departure=true;
    const warned=openThreat(c);
    if(!c.demand && livingDragon(c) && !c.departure && c.day>=c.demandAt && nextAttack(c)-c.day>6){
      const estimate=Math.max(c.stock.food,2*c.jobs.bakers*4);
      const amount=Math.min(4+c.dragon.level,Math.floor(.3*estimate));
      if(amount>0){
        c.demand={cost:{food:amount},due:c.day+4};
        record(c,'The guardian requests provisions.');
      }
      c.demandAt=c.day+10;
    }
    const opened=CampaignEvents.tick(c, warned || reachedLevel || entries!==c.log.at(-1));
    if(c.residents<=0 && !recruitmentViable(c) && !queued(c,'recruit','homes') && !CampaignEvents.canRecover(c)){
      c.status='defeat';record(c,'The settlement ran out of residents and has no way to recruit or admit a household.');
    }
    if(reachedLevel && c.status==='active')checkpoint(c);
    if(c.day>=nextAttack(c) && c.threat) return { pane:'threat', pause:true };
    if(reachedLevel)return {pane:'journal',pause:true};
    if(warned)return {pane:'threat',pause:true};
    if(opened)return {pane:'encounters',pause:true};
    if(c.departure || c.demand && c.demand.due===c.day+4)return {pane:'dragon',pause:true};
    return {pane:null,pause:c.shortage===1 || c.status!=='active'};
  }

  function armyPower(c, dragonTarget=false, threat=null, round=0) {
    return Object.entries(c.army).reduce((total,[key,units])=>{
      const kit=c.gear[key];
      const xp=units.reduce((a,b)=>a+Math.min(b,6),0);
      const choices=kit.choices??[];
      const modifier=kit.mode==='dragon' ? (dragonTarget?1.40:.90) : (dragonTarget?.18:1);
      let special=0;
      if(!dragonTarget && threat){
        if(key==='archers'&&choices[0]===1&&choices[2]!==1&&round===1)special+=1;
        if(key==='archers'&&choices[1]===1&&threat==='siege')special+=.65;
        if(key==='spearmen'&&choices[0]===1&&threat==='horde')special+=.6;
        if(key==='cavalry'&&choices[0]===1)special+=round===1?2.3:-.4;
        if(choices[1]===0&&['archers','swordsmen'].includes(key)&&c.stock.equipment>0)special+=.3;
        if(choices[1]===1&&key==='spearmen'&&c.stock.iron>0)special+=.4;
      }
      return total+(units.length*(troopTypes[key][5]+kit.tier*.8+special)+xp*.18)*modifier;
    },0);
  }

  function fight(c) {
    const t=c.threat;
    let field=t.field, boss=t.boss;
    const wall=c.buildings.wall, hall=c.buildings.hall;
    const report={day:c.day,wave:t.wave,type:t.type,field,boss,wallBefore:wall.health,hallBefore:hall.health,
      guardianBefore:c.dragon.health, rounds:[], casualties:emptyMap(troopTypes), repairs:[], plunder:{}, outcome:'stall'};
    const threshold=t.wave?0:t.field*([0,.6,.6,.45,.30][c.level]);
    let guardBuffer=wall.level*4, fallen=0;
    const fortPower=()=>[['wall',1.4],['tower',3.4],['ballista',1],['bastion',4]].reduce((n,[key,m])=>n+levelOf(c,key)*c.buildings[key].health/100*m,0);
    for(let round=1;round<=64;round++){
      const roll=.85+random(c.seed^0x40d52,t.day*128+round)*.30;
      const guardian=livingDragon(c)&&c.dragon.favor>0&&(c.dragon.stance!=='rest'||t.wave===3);
      const stancePower=c.dragon.stance==='hunt'?1.18:1;
      const bonus=guardian?(4+c.dragon.level*3)*c.dragon.health/dragonMax(c)*(.5+c.dragon.favor/120)*stancePower:0;
      const heroes=c.heroes.filter(h=>h.mode!=='inside' && h.health>0);
      const support=heroes.reduce((n,h)=>n+(h.trait===0?1.8:1.2)+h.level*.35,0);
      const towardBoss=boss>0;
      const air=towardBoss?(levelOf(c,'ballista')*4+armyPower(c,true)*.55+bonus*1.15)*roll:0;
      const counter=(armyPower(c,false,t.type,round)*(towardBoss?.74:1)+fortPower()+support+(towardBoss?0:bonus))*roll;
      const attack=(field*.26+boss*.095)*(2-roll);
      const exposed=Math.max(0,attack-(armyPower(c)*.32+fortPower()*.55+bonus*.45+support));
      const wallLoss=wall.level?Math.min(wall.health,exposed*.66):0;
      wall.health=Math.max(0,wall.health-wallLoss);
      if(wall.level && wall.health<=0){wall.level=0;wall.health=100;}
      const breach=Math.max(0,exposed-guardBuffer);
      guardBuffer=Math.max(0,guardBuffer-exposed*.38);
      if(breach && (!wall.level || wall.health<42)){
        for(const key of ['tower','ballista','bastion']){
          const b=c.buildings[key];
          if(!b.level)continue;
          b.health=Math.max(0,b.health-breach*.16);
          if(!b.health){b.level=0;b.health=100;}
        }
        if(!wall.level && !troops(c) && !guardian && !['tower','ballista','bastion'].some(key=>levelOf(c,key))) {
          hall.health=Math.max(0,hall.health-breach*.38);
        }
      }
      const protection=Object.entries(c.army).reduce((n,[key,units])=>n+(c.gear[key].tier>=3?units.length*(c.gear[key].choices?.[2]===1?.12:.08):0),0);
      const armyHarm=Math.max(0,exposed*.10+(attack*.045)*(t.wave||!wall.level?1:.5)-protection);
      fallen+=armyHarm;
      const defender=Object.keys(c.army).find(key=>c.army[key].length);
      if(fallen>=3 && defender){c.army[defender].shift();c.residents--;report.casualties[defender]++;fallen-=3;}
      if(guardian)c.dragon.health=Math.max(0,c.dragon.health-(towardBoss?boss*.038:attack*(c.dragon.stance==='hunt'?.10:.07)));
      for(const h of heroes)if(h.mode==='engage' || !wall.level)h.health=Math.max(0,h.health-attack*.06);
      field=Math.max(0,field-counter);
      boss=Math.max(0,boss-air);
      if(boss && !t.wave && boss<=t.boss*.5)boss=0;
      report.rounds.push({ round,roll,field,boss,wall:wall.level?wall.health:0,town:hall.health,guardian:c.dragon.health });
      if(hall.health<=0){report.outcome='defeat';break;}
      if(field<=threshold && boss<=0){report.outcome=t.wave?'repelled':'withdrawal';break;}
      if(!t.wave && round>=16){report.outcome='breach';break;}
    }
    c.heroes=c.heroes.filter(h=>h.health>0);
    report.wallAfter=wall.level?wall.health:0;report.hallAfter=hall.health;report.guardianAfter=c.dragon.health;
    if(!t.wave && report.outcome!=='defeat' && (report.hallAfter<report.hallBefore || !wall.level)){
      for(const key of ['grain','food','timber','stone']){
        const protectedAmount=key==='food'?Math.max(8,3*rations(c)):8;
        const amount=Math.max(0,Math.min(c.stock[key]-protectedAmount,c.stock[key]*.15));
        c.stock[key]-=amount;report.plunder[key]=amount;
      }
      for(const key of ['farm','oven','wood','quarry']){
        const b=c.buildings[key];
        const loss=Math.min(28,8+t.field*.22);
        b.health=Math.max(15,b.health-loss);
        if(b.health<=30 && b.level>1)b.level--;
        report.repairs.push(key);
      }
    }
    if (['repelled','withdrawal'].includes(report.outcome)){
      for(const key of Object.keys(c.army))c.army[key]=c.army[key].map(xp=>Math.min(6,xp+1));
      if(livingDragon(c) && report.guardianAfter<report.guardianBefore)c.dragon.victories++;
    }
    c.reports.push(report);
    if(report.outcome==='stall' || report.outcome==='defeat')c.status=report.outcome;
    else if(t.wave){
      c.wave=t.wave;
      if(c.wave===3){c.status='victory';c.invasionAt=null;}
      else c.invasionAt=c.day+12;
    } else {
      c.raidCount++; c.raidAt=c.day+raidGaps[c.level-1];
    }
    if(c.status!=='stall')c.threat=null;
    record(c,`${t.wave?`Invasion wave ${t.wave}`:'Raid'} · ${report.outcome}.`);
    return true;
  }

  function validate(c, isPoint=false) {
    const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
    const int=v=>Number.isSafeInteger(v)&&v>=0;
    const number=v=>Number.isFinite(v)&&v>=0;
    if(!obj(c)||c.version!==1||![2,3,4].includes(c.level)||!int(c.day)||!int(c.seed)||!int(c.draws)
      ||!int(c.residents)||!int(c.wave)||!['active','victory','defeat','stall'].includes(c.status))return false;
    if(!obj(c.stock)||!Object.keys(resources).every(key=>number(c.stock[key])) || !obj(c.jobs)||!Object.keys(jobs).every(key=>int(c.jobs[key])))return false;
    if(!obj(c.buildings)||!Object.keys(buildings).every(key=>obj(c.buildings[key])&&int(c.buildings[key].level)&&number(c.buildings[key].health))
      ||!obj(c.army)||!obj(c.gear)||!Object.keys(troopTypes).every(key=>Array.isArray(c.army[key])&&c.army[key].every(int)
        &&int(c.gear[key]?.tier)&&c.gear[key].tier<=4&&['field','dragon'].includes(c.gear[key].mode)
        &&(c.gear[key].choices===undefined||Array.isArray(c.gear[key].choices)&&c.gear[key].choices.length===c.gear[key].tier
          &&c.gear[key].choices.every(x=>x===0||x===1))))return false;
    const validCost=value=>obj(value)&&Object.entries(value).every(([key,n])=>Object.hasOwn(resources,key)&&number(n));
    const nullableDay=value=>value===null||int(value);
    if(!['raidAt','invasionAt'].every(key=>nullableDay(c[key]))||!int(c.demandAt)
      ||!int(c.repairDiscount)||!int(c.dragonShortage)||c.wave>3||c.seed>0xffffffff) return false;
    if(c.demand&&(!obj(c.demand)||!int(c.demand.due)||!validCost(c.demand.cost)))return false;
    if(!obj(c.dragon)||!['reserve','health','favor','victories','level'].every(key=>number(c.dragon[key]))
      ||!['guard','hunt','rest'].includes(c.dragon.stance)||!obj(c.altar)||!int(c.altar.lockedUntil))return false;
    if(!['queue','reports','log','heroes','eventHistory','effects','journal'].every(key=>Array.isArray(c[key])))return false;
    if(!c.queue.every(j=>obj(j)&&int(j.day)&&int(j.workers)&&['build','repair','train','recruit','gear','loadout','advance','scout','reward','clue','demobilize'].includes(j.kind)
        && (['build','repair'].includes(j.kind)?Object.hasOwn(buildings,j.key):['train','gear','loadout'].includes(j.kind)?Object.hasOwn(troopTypes,j.key):j.kind==='reward'?Object.hasOwn(resources,j.key)&&number(j.amount):typeof j.key==='string')))return false;
    if(!c.heroes.every(h=>obj(h)&&typeof h.specialty==='string'&&int(h.level)&&number(h.health)&&[0,1,2].includes(h.trait)&&['inside','fortifications','engage'].includes(h.mode)))return false;
    const o=c.altar.offer;
    if(o&&(!obj(o)||!Array.isArray(o.options)||!o.options.every(x=>Object.hasOwn(categories,x))||!validCost(o.cost)||!int(o.rerolls)||o.rerolls>3||o.arrival!==undefined&&(!int(o.arrival)||![0,1,2].includes(o.trait))
      ||o.category!==null&&!Object.hasOwn(categories,o.category)))return false;
    if(c.threat&&(!obj(c.threat)||!int(c.threat.day)||!int(c.threat.wave)||!number(c.threat.field)||!number(c.threat.boss)
      ||!['horde','siege','wyrm'].includes(c.threat.type)))return false;
    if(!['eventAt','eventDraws','raidCount','shortage'].every(k=>int(c[k])))return false;
    if(c.event&&(!obj(c.event)||!int(c.event.offered)||!int(c.event.due)||!Object.hasOwn(CampaignEvents.roster,c.event.id)))return false;
    if(!c.reports.every(r=>obj(r)&&int(r.day)&&int(r.wave)&&r.wave<=3&&typeof r.outcome==='string'
        &&Array.isArray(r.rounds)&&r.rounds.every(round=>obj(round)&&['round','field','boss','wall','town'].every(k=>number(round[k])))
        &&validCost(r.plunder)&&obj(r.casualties)&&Object.keys(troopTypes).every(k=>int(r.casualties[k])))
      ||!c.eventHistory.every(e=>obj(e)&&int(e.day)&&int(e.offered)&&Object.hasOwn(CampaignEvents.roster,e.id)&&typeof e.result==='string')||!c.log.every(e=>obj(e)&&int(e.day)&&typeof e.text==='string'))return false;
    return isPoint || obj(c.checkpoints)&&Object.keys(c.checkpoints).every(l=>['2','3','4'].includes(l)&&validate(c.checkpoints[l],true));
  }

  return { start, resources, jobs, buildings, troopTypes, equipment, advancement, stories, blessings, categories, traits,
    canBuild, canRepair, canTrain, canRecruit, canSummon, canAdvance, buildCost, repairCost, gearCost, gearCap, summonCost, requirements,
    troops, beds, free, garrison, militaryLoad, levelOf, labelCost, livingDragon, dragonMax, nextAttack, queued, active,
    canPay, pay, add, record, random, order, rations, storage, rank, armyPower, advance, action, validate };
})();
