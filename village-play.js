// Crown positions and click areas are percentages of the village panorama.
const places = {
  roost: ['Dragon roost', 69, 8, '67,10 72,6 77,7 80,14 79,25 74,25 67,21'],
  hall: ['Town Center', 48, 27, '43,35 46,32 46,28 50,28 50,33 53,34 55,41 42,41', ['civic', 0]],
  barracks: ['Barracks', 31, 42, '24,48 28,44 34,44 38,47 38,53 24,54', ['army', 0]],
  homes: ['Cottages', 49, 49, '45,54 47,50 51,51 53,54 55,50 58,53 58,58 45,58', ['civic', 2]],
  oven: ['Provisioner', 70, 53, '64,59 68,56 69,54 72,54 72,56 75,60 74,66 64,66', ['food', 2]],
  farm: ['Grain field', 32, 56, '22,62 27,62 30,58 35,57 38,64 40,72 36,74 22,70', ['land', 0]],
  wood: ['Woodcutters', 10, 49, '5,56 8,50 12,50 16,57 16,63 5,63', ['land', 2]],
  quarry: ['Quarry', 86, 50, '80,56 83,52 88,52 91,57 92,62 81,63', ['food', 0]],
  wall: ['Village gate', 50, 66, '47,69 49,67 52,68 54,71 54,78 47,79', ['defenses', 0]]
};

const $ = id => document.getElementById(id);
const phase = () => village.opening?.phase;
const raidDay = () => village.raidDay === undefined ? RAID_DAY : village.raidDay;
const fmt = value => String(Number(value.toFixed(2)));

let village = VillageEngine.newVillage();
let resolvingRaid = false;
let raidError = false;
let scoutStrength = null;
let scoutLoading = false;
let farmerDraft = false;
let selected = null;
let timer = null;
let speed = 1;
let noticeTimeout;
let lastStaffChange = null;
let trainingDraft = false;
let advancementDraft = false;
let dragonDraft = null;
let visited = new Set();
let activeProfile = null;
let playMode = 'title';
let lastSavedProgress = null;
let saveIssue = '';
let campaignPane = 'town';

const lessons = [
  ['Look around the village', 'Select the Cottages on the map. The inspector shows the details of the place you selected.', 'homes'],
  ['Return to the full map', 'Choose Village Overview, click open ground, or press Escape. Your village stays where you left it.', 'overview'],
  ['Read resources and queues', 'Hover over a resource icon for its name. Grain and provisions are separate. Free workers can take new jobs. Select the Barracks to see where training progress appears.', 'barracks'],
  ['Learn the clock', 'The village is paused. Next day advances once. Set the speed and use Resume to advance until you pause again. The tutorial asks you when to advance.', null, 'Start preparing'],
  ['Read the raid warning', 'Inspect the Town Center, then open the raid warning beside your resources.', 'hall'],
  ['Follow the food supply', 'Inspect the Grain field and the Provisioner. Look at the grain harvest, the bakery output, and daily rations.', 'farm'],
  ['Free a worker', 'At the Grain field, compare the harvest with one fewer farmer. Press − beside Farmers, then confirm to free one worker.', 'farm'],
  ['Train a spearman', 'Press + beside the spearman icon. Review the total cost, then confirm to start the training countdown.', 'barracks'],
  ['Decide how to prepare the dragon', 'Open the Dragon roost. Compare Guard and Rally, then confirm how the guardian will defend.', 'roost'],
  ['Advance one day', 'Use Next day. Then check the Barracks queue and the food forecast at the Provisioner.', 'nextDay'],
  ['Review your preparations', 'Return to Village Overview. Read when the spearman will be ready and what the dragon will contribute.', 'overview'],
  ['Face the first raid', 'Use Next day or Resume. The village pauses when the raid resolves.', 'nextDay'],
  ['Read the outcome', 'Compare the contributions of the wall guard, dragon, and spearmen. Open the wall from the report to see what needs repair.', 'report'],
  ['Inspect the damage', 'The wall you saw in the report is on the same map. Read the cost and time for repairs. Then continue at your own pace.', 'wall', 'Finish tutorial']
];

function guideActive() {
  return village.guide < lessons.length;
}

function nextLesson() {
  if (!guideActive()) return;
  village.guide += 1;
  visited.clear();
}

function freeWorkers() {
  return VillageEngine.freeWorkers(village);
}

function grainYield(farmers = village.farmers) {
  return VillageEngine.grainYield(farmers, village.altarBlessing);
}

function provisionsMade(bakers = village.bakers) {
  return VillageEngine.provisionsMade(village, bakers);
}

function dailyRations() {
  return VillageEngine.rations(village);
}

function row(label, value) {
  return `<div class="row"><span>${label}</span><strong>${value}</strong></div>`;
}

function button(action, label, disabled = false) {
  return `<button data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}

function stop() {
  clearInterval(timer);
  timer = null;
  document.querySelector('.village-clock').classList.remove('running');
}

function note(message) {
  clearTimeout(noticeTimeout);
  $('notice').textContent = message;
  noticeTimeout = setTimeout(() => { $('notice').textContent = ''; }, 4200);
}

function open(place) {
  if (village.campaign && places[place]) {
    const mapPane = { hall:'town', homes:'town', barracks:'army', wall:'army', roost:'dragon' };
    return openCampaign(mapPane[place] ?? 'economy');
  }
  if (place !== selected) {
    trainingDraft = false;
    advancementDraft = false;
    dragonDraft = null;
    farmerDraft = false;
  }
  selected = place;
  lastStaffChange = null;
  visited.add(place);
  const step = village.guide;
  if ((step === 0 && place === 'homes')
      || (step === 1 && !place)
      || (step === 2 && place === 'barracks')
      || (step === 4 && visited.has('hall') && visited.has('warning'))
      || (step === 5 && visited.has('farm') && visited.has('oven'))
      || (step === 9 && visited.has('day') && visited.has('barracks') && visited.has('oven'))
      || (step === 10 && !place)
      || (step === 12 && place === 'wall')) {
    nextLesson();
  }
  render();
  if (place === 'warning' && phase() === 'scout') fetchScoutReport();
}

function raidPending() {
  return village.day === raidDay() && !village.result;
}

async function fetchScoutReport() {
  if (scoutLoading || scoutStrength !== null) return;
  scoutLoading = true;
  const scoutingVillage = village;
  try {
    const report = await RaidClient.request('scout', { seed: village.seed });
    if (village === scoutingVillage) scoutStrength = report.attackerStrength;
  } catch {
    if (village === scoutingVillage) note('Scout estimate unavailable. Try again.');
  } finally {
    scoutLoading = false;
    render();
  }
}

async function resolveRaid() {
  if (resolvingRaid || !raidPending() || village.economicDefeat) return;
  stop();
  resolvingRaid = true;
  raidError = false;
  selected = 'warning';
  render();
  const raidingVillage = village;
  try {
    const result = await RaidClient.request('resolve', VillageEngine.raidInput(village));
    if (village !== raidingVillage) return;
    VillageEngine.applyRaid(village, result);
    if (village.guide === 11) nextLesson();
    persistCampaign();
    selected = 'report';
    note(result.status === 'stall' ? 'Encounter paused without a verdict.' : 'Raid resolved. Time is paused.');
  } catch {
    if (village !== raidingVillage) return;
    raidError = true;
    selected = 'warning';
    note('Raid engine unavailable. Retry from the warning.');
  } finally {
    resolvingRaid = false;
    render();
  }
}

function canAdvance() {
  if (village.campaign) return Campaign.active(village.campaign);
  return !village.economicDefeat && !raidPending() && !['stall', 'defeat'].includes(village.result?.status)
    && (!village.opening || !['stockpile', 'scout', 'chapter-complete'].includes(phase()))
    && (!guideActive() || village.guide === 11 || (village.guide === 9 && !visited.has('day')));
}

function canResume() {
  if (village.campaign) return Campaign.active(village.campaign);
  if (!canAdvance() || (guideActive() && village.guide !== 11)) return false;
  if (!village.opening || ['prepare', 'aftermath', 'memory'].includes(phase())) return true;
  return Object.values(village.opening.plots).some(plot => !plot.ready);
}

function advance() {
  if (village.campaign) {
    const c = village.campaign;
    const result = Campaign.advance(c);
    if (!result) return;
    syncCampaign();
    if (result.pause) stop();
    if (result.pane) return openCampaign(result.pane);
    if (c.status !== 'active') return openCampaign('records');
    render();
    return;
  }
  const previousPhase = phase();
  if (!canAdvance()) return;
  lastStaffChange = null;
  const { events, firstMissedRation, impendingLoss, firstHungerLoss, dragonDied } = VillageEngine.advance(village);
  if (events.length) note(events.join(' '));
  if (phase() !== previousPhase || !canResume()) stop();
  if (phase() === 'chapter-complete') return beginCampaign();
  const pausedForFood = firstMissedRation || impendingLoss || firstHungerLoss || dragonDied || village.economicDefeat;
  if (pausedForFood) {
    stop();
    selected = dragonDied && !village.economicDefeat ? 'roost' : 'food';
    if (village.economicDefeat) note('The settlement has no residents left.');
    else if (dragonDied || firstHungerLoss) note(events.join(' '));
    else if (impendingLoss) note('Time paused. Another missed ration may cost a resident or spearman.');
    else note('A ration was missed. Time paused.');
  }
  if (village.guide === 9) {
    visited.clear();
    visited.add('day');
  }
  persistCampaign();
  if (raidPending() && !pausedForFood) return resolveRaid();
  render();
}

function toggleTime() {
  if (timer) stop();
  else if (canResume()) {
    const dayLength = 1600 / speed;
    const clock = document.querySelector('.village-clock');
    clock.style.setProperty('--day-length', `${dayLength}ms`);
    clock.classList.add('running');
    timer = setInterval(advance, dayLength);
  }
  render();
}

function guideTarget() {
  if (village.opening) return village.opening.hints ? OPENING_LESSONS[phase()]?.[2] : null;
  const step = village.guide;
  if (step === 4) return visited.has('hall') ? 'warning' : 'hall';
  if (step === 5) return visited.has('farm') ? 'oven' : 'farm';
  if (step === 9 && visited.has('day')) return visited.has('barracks') ? 'oven' : 'barracks';
  return lessons[step]?.[2];
}

function renderGuide() {
  if (village.economicDefeat || village.campaign) {
    $('guide').hidden = true;
    return;
  }
  if (village.opening) {
    const lesson = OPENING_LESSONS[phase()];
    $('guide').hidden = !lesson || !village.opening.hints;
    if (!lesson) return;
    const action = phase() === 'aftermath' && village.result?.status === 'won'
      ? button('memory', 'Recall the first memory') : phase() === 'memory' ? button('hall', 'View next level') : '';
    const recovering = village.settled && village.residents < FIRST_HOUSEHOLD && STAFF_MILESTONES[phase()];
    const instruction = recovering ? 'Assign one worker to continue. Move a worker from another building if needed.' : lesson[1];
    const html = `<small>THE LAST HEARTH</small><h2 id="guideTitle">${lesson[0]}</h2><p>${instruction}</p>${action}`;
    if ($('guideText').innerHTML !== html) $('guideText').innerHTML = html;
    return;
  }
  const lesson = lessons[village.guide];
  $('guide').hidden = !lesson;
  if (!lesson) return;
  const [title, text, , next] = lesson;
  const step = village.guide;
  const detail = step === 9 && visited.has('day')
    ? 'One day has passed. Check the Barracks and Provisioner before advancing again.'
    : text;
  const progress = step < 4 ? `Controls · ${step + 1} of 4`
    : step < 12 ? `First raid · ${step - 3} of 8` : 'First raid · aftermath';
  const summary = step === 11 ? '<strong>Readiness</strong>' + readiness() : '';
  const html = `<small>${progress}</small><h2 id="guideTitle">${title}</h2><p>${detail}</p>${summary}${next ? button('guideNext', next) : ''}`;
  if ($('guideText').innerHTML !== html) $('guideText').innerHTML = html;
}

function readiness() {
  const training = village.trainingDay
    ? `Spearman due on day ${village.trainingDay}`
    : `${village.defenders} ${village.defenders === 1 ? 'spearman' : 'spearmen'} assigned to defense`;
  return `<ul class="report-list"><li>Wall guard ready</li><li>${training}</li><li>Dragon ${village.offered ? 'rallied' : 'guarding'}</li></ul>`;
}

function nextActions(items) {
  return `<section class="report-actions" aria-label="Next actions"><h3>Next actions</h3>
    <ol class="report-list">${items.map(item => `<li>${item}</li>`).join('')}</ol></section>`;
}

function renderMap() {
  const target = guideTarget();
  for (const pin of $('map').querySelectorAll('.pin')) {
    const place = pin.dataset.place;
    const poly = $('mapStage').querySelector(`polygon[data-place="${place}"]`);
    const plot = village.opening?.plots[place];
    const availablePlot = village.opening && OPENING_BUILDINGS[place];
    pin.hidden = !village.opening && ['wood', 'quarry'].includes(place);
    poly.classList.toggle('no-plot', pin.hidden);
    if (availablePlot && !['wall', 'barracks'].includes(place)) {
      pin.dataset.state = plot?.ready ? (place === 'homes' ? 'Hearth lit' : '') : plot ? `Building · Day ${plot.due}` : target === place ? 'Plot' : '';
      pin.dataset.tone = plot && !plot.ready ? 'work' : '';
      poly.classList.toggle('construction', Boolean(plot && !plot.ready));
      poly.classList.toggle('hearth-lit', place === 'homes' && Boolean(plot?.ready));
    } else if (availablePlot === undefined) {
      if (!['wall', 'barracks'].includes(place)) {
        delete pin.dataset.state;
        poly.classList.remove('construction', 'hearth-lit');
      }
    }
    pin.classList.toggle('guided', target === place);
    pin.setAttribute('aria-pressed', String(place === selected));
    poly.classList.toggle('on', place === selected);
    if (place === 'barracks') {
      pin.dataset.state = village.upgradeDay ? `Upgrading · Day ${village.upgradeDay}`
        : village.barracksLevel === 2 ? 'Level 2 · upgraded'
        : village.trainingDay ? `Training · Day ${village.trainingDay}` : '';
      pin.dataset.tone = village.upgradeDay || village.trainingDay ? 'work' : village.barracksLevel === 2 ? 'complete' : '';
      poly.classList.toggle('construction', Boolean(village.upgradeDay));
      poly.classList.toggle('complete', village.barracksLevel === 2);
    }
    if (place === 'wall') {
      pin.dataset.state = village.repairDay ? `Repairing · Day ${village.repairDay}`
        : village.wallHealth < 100 ? `Damaged · ${village.wallHealth}%` : '';
      pin.dataset.tone = village.repairDay ? 'work' : village.wallHealth < 100 ? 'damage' : '';
      poly.classList.toggle('damaged', village.wallHealth < 100);
    }
    if (place === 'wall' && phase() === 'refugees') pin.dataset.state = `${FIRST_HOUSEHOLD} people waiting`;
    if (!pin.dataset.state) delete pin.dataset.state;
    pin.setAttribute('aria-label', [places[place][0], pin.dataset.state].filter(Boolean).join(', '));
  }
  for (const id of ['warning', 'overview', 'nextDay']) $(id).classList.toggle('guided', target === id);
}

function provisionerTable() {
  const provisions = provisionsMade();
  const flows = [
    ['Grain', village.grain, grainYield(), provisions * 1.5],
    ['Provisions', village.food, provisions, dailyRations()]
  ];
  return `<table class="production-table">
    <caption>Stocks and next-day flow</caption>
    <thead><tr><th scope="col">Resource</th><th scope="col">Stock</th><th scope="col">Made</th><th scope="col">Used</th><th scope="col">Net</th></tr></thead>
    <tbody>${flows.map(([name, stock, made, used]) => {
      const net = made - used;
      return `<tr><th scope="row">${trainingIcon(name, name)}</th>
        <td>${fmt(stock)}</td><td>${fmt(made)}</td><td>${fmt(used)}</td>
        <td class="${net < 0 ? 'deficit' : ''}">${net > 0 ? '+' : ''}${fmt(net)}</td></tr>`;
    }).join('')}</tbody>
  </table>`;
}

function foodForecast() {
  if (!village.bakers) return 'Bakery idle · No bakers';
  const grainBalance = grainYield() - 3 * village.bakers;
  const fullBakeDays = grainBalance < 0 ? Math.floor(village.grain / -grainBalance) : null;
  const futureFood = Math.min(2 * village.bakers, grainYield() / 1.5) - dailyRations();
  return grainBalance < 0
    ? `Full output · ${fullBakeDays}d left. Then ${futureFood > 0 ? '+' : ''}${fmt(futureFood)} provisions/day net.`
    : 'Full output sustained';
}

function canTrain() {
  return (!village.opening || ['prepare','aftermath','memory'].includes(phase()))
    && (!guideActive() || village.guide === 7)
    && VillageEngine.canTrain(village);
}

function canChooseDragonStance() {
  return (!village.opening || phase() === 'prepare') && (!guideActive() || village.guide === 8) && !village.result && village.dragon.health > 0;
}

function stanceCost(stance) {
  return VillageEngine.stanceCost(village, stance);
}

function dragonStances() {
  if (village.dragon.health <= 0) {
    return row('Golden dragon', 'Fallen')
      + '<p>The guardian has died. Scouts will bring future warnings to the village.</p>'
      + button('warning', village.result ? 'Read battle report' : 'Check the valley watch');
  }
  const current = village.offered ? 'rally' : 'guard';
  const impact = stance => stance === 'rally' ? `+${RALLY_BONUS}% dragon power` : 'Base dragon power';
  const cards = Object.entries(DRAGON_STANCES).map(([key, stance]) => `
    <div class="stance-card">
      <button data-action="stance-${key}" aria-pressed="${dragonDraft === key}"
        ${canChooseDragonStance() ? '' : 'disabled'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">${stanceIcons[key]}</svg>
        <span>${stance.name}</span>
      </button>
      ${trainingIcon('Provisions', 'Provisions', stanceCost(key))}
      <strong>${impact(key)}</strong>
    </div>`).join('');
  return row('Current stance', DRAGON_STANCES[current].name)
    + row('Dragon health', `${fmt(village.dragon.health)}/64`)
    + row('Dragon provisions reserve', fmt(village.dragon.reserve))
    + (village.hunger.dragon ? row('Hungry days', village.hunger.dragon) : '')
    + '<p class="stance-basis">First-raid defense modifier</p>'
    + `<div class="stance-cards" aria-label="First-raid dragon stances">${cards}</div>`
    + (dragonDraft && canChooseDragonStance() ? `
      <div class="stance-confirm">
        <p>${impact(current)} → ${impact(dragonDraft)}</p>
        ${village.food < stanceCost(dragonDraft) ? '<p>Not enough provisions.</p>' : ''}
        <div class="actions">${button('confirm-stance', `Confirm ${DRAGON_STANCES[dragonDraft].name}`, village.food < stanceCost(dragonDraft))}${button('cancel-stance', 'Cancel')}</div>
      </div>` : '');
}

const staff = {
  farmers: { label: 'Farmers', role: 'farmer', max: 3, outputLabel: 'Grain produced', output: grainYield },
  bakers: { label: 'Bakers', role: 'baker', max: 2, outputLabel: 'Provisions produced', output: provisionsMade },
  woodcutters: { label: 'Woodcutters', role: 'woodcutter', max: 2, outputLabel: 'Timber produced', output: count => 2 * count },
  quarrymen: { label: 'Quarry workers', role: 'quarry worker', max: 2, outputLabel: 'Stone produced', output: count => count }
};

function canChangeStaff(kind, delta) {
  const count = village[kind];
  if (village.opening && ['stockpile','homes','refugees'].includes(phase())) return false;
  if (guideActive()) return village.guide === 6 && kind === 'farmers' && delta < 0 && count > 0;
  return delta < 0 ? count > 0 : count < staff[kind].max && freeWorkers() > 0;
}

function countControl(label, count, [remove, removeLabel, canRemove], [add, addLabel, canAdd], labelContent = label) {
  return `<div class="row"><span>${labelContent}</span><div class="count-control" role="group" aria-label="${label}">
    <button data-action="${remove}" aria-label="${removeLabel}" title="${removeLabel}" ${canRemove ? '' : 'disabled'}>−</button>
    <strong>${count}</strong>
    <button data-action="${add}" aria-label="${addLabel}" title="${addLabel}" ${canAdd ? '' : 'disabled'}>+</button>
  </div></div>`;
}

function staffing(kind) {
  const { label, role, max, outputLabel, output } = staff[kind];
  const count = village[kind];
  const current = output(count);
  const canRemove = canChangeStaff(kind, -1);
  const change = lastStaffChange?.kind === kind ? lastStaffChange : null;
  const comparison = change && !farmerDraft
    ? row('Output before → now', `${fmt(change.before)}/day → ${fmt(current)}/day`)
    : canRemove ? row('Output now → with one fewer', `${fmt(current)}/day → ${fmt(output(count - 1))}/day`)
      : row(outputLabel, `${fmt(current)}/day`);
  return countControl(label, `${count}/${max}`,
    [`remove-${kind}`, `Remove one ${role}`, canRemove && !farmerDraft],
    [`add-${kind}`, `Add one ${role}`, !farmerDraft && canChangeStaff(kind, 1)]) + comparison
    + (kind === 'farmers' && farmerDraft
      ? `<div class="actions">${button('confirm-farmer', 'Confirm removal', !canRemove)}${button('cancel-farmer', 'Cancel')}</div>` : '');
}

function adjustStaff(kind, delta) {
  if (!canChangeStaff(kind, delta)) return;
  lastStaffChange = { kind, before: staff[kind].output(village[kind]) };
  VillageEngine.changeStaff(village, kind, delta);
  const milestone = STAFF_MILESTONES[kind];
  if (village.opening && phase() === milestone?.[0] && village[kind] >= (village.residents < FIRST_HOUSEHOLD ? 1 : milestone[1])) {
    village.opening.phase = milestone[2];
    if (phase() === 'scout') stop();
  }
  if (village.guide === 6) nextLesson();
}

function canUpgrade() {
  return (!village.opening || Boolean(village.result)) && !guideActive() && VillageEngine.canUpgrade(village);
}

function canRepair() {
  return (!guideActive() || village.guide === 13) && VillageEngine.canRepair(village);
}

function battleForces(label, faction, columns, side) {
  const values = (key) => columns.map(column => `<td>${column[key] ?? '—'}</td>`).join('');
  return `<table class="battle-forces ${side}">
    <caption><strong>${label}</strong><span>${faction}</span></caption>
    <thead><tr><th scope="col">Forces</th>
      ${columns.map(({ icon, name }) => `<th scope="col">${trainingIcon(icon, name)}<small>${name}</small></th>`).join('')}
    </tr></thead>
    <tbody>
      <tr><th scope="row">Deployed</th>${values('deployed')}</tr>
      <tr><th scope="row">Casualties</th>${values('casualties')}</tr>
      <tr><th scope="row">${side === 'attackers' ? 'Starting strength' : 'First-round damage'}</th>${values('strength')}</tr>
    </tbody>
  </table>`;
}

const raidTitles = { won: 'Raiders repelled', defeat: 'Town Center destroyed', stall: 'Encounter unresolved' };

function retreatExplanation(result) {
  const lastRound = result.rounds.at(-1);
  if (result.retreatAt === undefined || lastRound?.enemyAfter === undefined) {
    return '<p>Level 1 raiders withdraw after losing 40% of their starting strength. Earlier saves contain only the original round summary.</p>';
  }
  const remaining = lastRound.enemyAfter;
  return `<section class="battle-comparison"><h3>Why the raid ended</h3>
    <p>Level 1 raiders withdraw after losing 40% of their starting strength.</p>
    ${row('Raider strength · start → end', `${fmt(result.attackerStrength)} → ${fmt(remaining)}`)}
    ${row('Retreat at or below', fmt(result.retreatAt))}
    <small>Figures are rounded for display.</small>
    ${result.status === 'won' ? `<small>${remaining === 0 ? 'The raiding force was eliminated.' : 'The remaining strength crossed the retreat threshold.'}</small>` : ''}
  </section>`;
}

function reportBody() {
  const result = village.result;
  const first = result.rounds[0];
  const attacker = [{ icon: 'Spearmen', name: 'Raiding party', strength: fmt(result.attackerStrength) }];
  const defender = [
    { icon: 'Wall guard', name: 'Wall guard', strength: first ? fmt(first.wall) : undefined },
    { icon: 'Dragon', name: result.offered ? 'Dragon · Rally' : 'Dragon · Guard', deployed: result.dragonBefore <= 0 ? 'Absent' : result.rounds.some(round => round.dragonPower > 0) ? 'Fought' : 'Held back',
      casualties: result.dragonBefore > 0 ? Number(result.dragonAfter === 0) : undefined, strength: first ? fmt(first.dragonDamage ?? first.dragonPower) : undefined },
    { icon: 'Spearmen', name: 'Spearmen', deployed: result.spearmen, casualties: result.casualties,
      strength: first ? fmt(first.spearmen) : undefined }
  ];
  const resources = [['Grain', 'grain'], ['Provisions', 'provisions'], ['Timber', 'timber'], ['Stone', 'stone']];
  const stolen = resources.filter(([, key]) => result.plunder[key] > 0);
  const rounds = result.rounds.map(round => `<tr><th scope="row">${round.round}</th>
    <td>${fmt(round.spearmen)}</td><td>${fmt(round.dragonDamage ?? round.dragonPower)}</td>
    <td>${fmt(round.wall)}</td><td>${round.damage === undefined ? '—' : fmt(round.damage)}</td>
    <td>${round.enemyAfter === undefined ? '—' : fmt(round.enemyAfter)}</td></tr>`).join('');
  const title = result.status === 'won' && result.breached ? 'Raiders broke through' : raidTitles[result.status];
  return `<div class="battle-banner ${result.status === 'won' && !result.breached ? 'victory' : 'breach'}">
      <div class="battle-portrait raiders" aria-hidden="true"></div>
      <div class="battle-result"><small>FIRST RAID · DAY ${result.day}</small>
        <strong>${title}</strong>
        <span>${result.rounds.length} ${result.rounds.length === 1 ? 'round' : 'rounds'}</span>
      </div>
      <div class="battle-portrait guardian" aria-hidden="true"></div>
    </div>
    <section class="battle-aftermath" aria-label="Aftermath">
      <h3>Aftermath</h3>
      <ul class="report-list">
        <li>Wall health <strong>${result.wallBefore}% → ${result.wallAfter}%</strong></li>
        <li>Dragon health <strong>${fmt(result.dragonBefore)}/${result.dragonMax} → ${fmt(result.dragonAfter)}/${result.dragonMax}</strong></li>
        ${result.breached ? `<li>${result.safetyNet ? 'The raiders reached the Town Center. At Level 1 it cannot fall, but they' : 'The raiders pressed the wall below three-quarters health and'} carried off stores above the protected reserve.</li>` : ''}
        <li>Plunder ${stolen.length ? stolen.map(([name, key]) => trainingIcon(name, `${name} taken`, fmt(result.plunder[key]))).join(' ') : '<strong>None</strong>'}</li>
      </ul>
    </section>
    ${retreatExplanation(result)}
    ${battleComparison(result)}
    <div class="actions">${button('wall', village.wallHealth < 100 ? 'Inspect damaged gate' : 'Inspect village gate')}</div>
    <p class="battle-scroll-hint">Scroll for forces, round details, and next actions ↓</p>
    <div class="battle-tables">
      ${battleForces('Attacker', 'Eastern raiders', attacker, 'attackers')}
      ${battleForces('Defender', escapeText(village.villageName ?? DEFAULT_VILLAGE_NAME) + (village.opening ? ` · ${escapeText(village.chiefName)}` : ''), defender, 'defenders')}
      <small class="battle-legend">${first?.dragonDamage === undefined ? '— Untracked · Earlier save shows pre-roll dragon power' : '— Untracked · Defender values are first-round damage'}</small>
    </div>
    <details><summary>Round details</summary><table class="battle-forces">
      <thead><tr><th>Round</th><th>Spearmen</th><th>Dragon</th><th>Wall</th><th>Total damage</th><th>Raiders left</th></tr></thead>
      <tbody>${rounds}</tbody></table></details>
    ${nextActions([
      button('overview', 'Return to Village Overview'),
      ...(phase() === 'aftermath' && result.status === 'won' ? [button('memory', 'Recall the first memory')] : [])
    ])}
    <small class="battle-legend">Run 10 combat · ${escapeText(result.engine)} · ${village.opening ? 'Opening' : 'Checkpoint'} seed ${result.seed}</small>`;
}

function battleComparison(result) {
  if (!result.unprepared) return '';
  const base = result.unprepared;
  const orders = [result.spearmen ? `${result.spearmen} assigned ${result.spearmen === 1 ? 'spearman' : 'spearmen'}` : null,
    result.offered ? 'Rally' : null].filter(Boolean).join(' + ');
  if (!orders) return '<p class="battle-comparison">No spearmen or Rally were used in this raid.</p>';
  return `<section class="battle-comparison"><h3>What your orders changed</h3>
    <small>${orders} · same raid and starting village</small>
    ${row('Wall health · unprepared → actual', `${base.wallAfter}% → ${result.wallAfter}%`)}
    ${row('Rounds · unprepared → actual', `${base.rounds} → ${result.rounds.length}`)}
    ${base.plunder ? row('Stores taken · unprepared → actual', `${fmt(Object.values(base.plunder).reduce((a, b) => a + b, 0))} → ${fmt(Object.values(result.plunder).reduce((a, b) => a + b, 0))}`) : ''}</section>`;
}

function foodInspector() {
  if (village.economicDefeat) {
    return '<p>The last resident left after going hungry. No household is waiting at the gate, so the settlement can no longer recover.</p>'
      + nextActions([button('load', 'Load saved village'), button('restart', 'Start a new story')]);
  }
  const forecast = VillageEngine.foodForecast(village);
  const groups = [['Civilians', 'civilians'], ['Spearmen', 'soldiers'], ['Dragon', 'dragon']];
  return row('Provisions in store', fmt(village.food))
    + row('Next-day net', `${forecast.net > 0 ? '+' : ''}${fmt(forecast.net)}/day`)
    + row('Full ration from village stock', Number.isFinite(forecast.shortageIn) ? `Short in ${forecast.shortageIn}d` : 'Sustained')
    + row('Dragon reserves', fmt(village.dragon.reserve))
    + groups.filter(([, key]) => village.hunger[key]).map(([name, key]) => row(`${name} · hungry days`, village.hunger[key])).join('')
    + '<p>On the fourth consecutive hungry day, a resident can leave or a spearman can desert. A fully fed day resets that group’s count.</p>'
    + (village.hunger.civilians === HUNGER_LIMIT - 1 ? '<p class="shortage-warning">If the next civilian ration is missed, one resident will leave.</p>' : '')
    + (village.hunger.soldiers === HUNGER_LIMIT - 1 ? '<p class="shortage-warning">If the next army ration is missed, one spearman will desert.</p>' : '')
    + nextActions([button('farm', 'Inspect Grain field'), button('oven', 'Inspect Provisioner')]);
}

function wallInspector() {
  const damaged = village.wallHealth < 100;
  return `<div class="wall-condition">
      ${trainingIcon('Wall guard', 'Wall health', `${village.wallHealth}%`)}
      <meter min="0" max="100" value="${village.wallHealth}" aria-label="Wall health"></meter>
      <span class="wall-status">${village.repairDay ? 'Repairing' : damaged ? 'Damaged' : 'Intact'}</span>
    </div>`
    + (!village.result ? countControl('Spearmen on defense', `${village.defenders}/${village.spearmen}`,
      ['remove-defender', 'Remove one defender', !guideActive() && village.defenders > 0],
      ['add-defender', 'Add one defender', !guideActive() && village.defenders < village.spearmen]) : '')
    + (village.repairDay
      ? `<div class="inspector-metrics">${trainingIcon('Clock', 'Repair time remaining', `${village.repairDay - village.day}d`)}</div>`
      : damaged ? `<div class="inspector-metrics">
          ${trainingIcon('Timber', 'Repair cost in timber', REPAIR.timber)}
          ${trainingIcon('Clock', 'Repair duration', `${REPAIR.days}d`)}
          ${button('repair', 'Repair gate', !canRepair())}
        </div>` : '')
    + (village.result ? `<div class="actions">${button('report', 'Battle report')}</div>` : '');
}

function barracksUpgrade() {
  if (village.upgradeDay) {
    return `<div class="inspector-metrics">${trainingIcon('Clock', 'Upgrade time remaining', `${village.upgradeDay - village.day}d`)}</div>`;
  }
  if (village.barracksLevel !== 1) return '';
  return `<div class="inspector-metrics">
    ${trainingIcon('Timber', 'Upgrade cost in timber', UPGRADE.timber)}
    ${trainingIcon('Stone', 'Upgrade cost in stone', UPGRADE.stone)}
    ${trainingIcon('Clock', 'Upgrade duration', `${UPGRADE.days}d`)}
    ${button('upgrade', 'Upgrade Barracks', !canUpgrade())}
  </div>` + (!canUpgrade() ? `<small>${village.opening && !village.result ? 'Available after the first raid.' : 'Requires 4 timber and 3 stone.'}</small>` : '');
}

function openingPlot(place) {
  const plan = OPENING_BUILDINGS[place];
  const plot = village.opening.plots[place];
  return plot ? row('Construction', `Ready on day ${plot.due}`) : `<div class="inspector-metrics">
    ${trainingIcon('Timber', 'Timber', plan.timber)}
    ${trainingIcon('Stone', 'Stone', plan.stone)}
    ${trainingIcon('Clock', 'Construction duration', `${plan.days}d`)}
    ${button('build-plot', `Build ${plan.name.toLowerCase()}`, !VillageEngine.canBuild(village, place))}
  </div>` + (!VillageEngine.canBuild(village, place) ? `<small>${phase() !== place
    ? `Required step · ${OPENING_LESSONS[phase()]?.[0] ?? 'the opening'}.`
    : 'Gather the timber and stone shown above.'}</small>` : '');
}

function townOpening() {
  const identity = row('Village', escapeText(village.villageName))
    + row('Chief', escapeText(village.chiefName)) + row('Village level', village.level);
  const preview = '<h3>Level 2 unlock preview</h3>' + unlockIcons(2) + button('tech-tree', 'View tech tree');
  if (village.level === 2) {
    return identity + button('begin-campaign', 'Continue to the campaign') + preview;
  }
  if (phase() === 'stockpile') return identity + button('claim-stockpile', 'Claim stockpile') + preview;
  if (village.advancementDay) return identity + row('Level 2 ready on', `Day ${village.advancementDay}`) + preview;
  const ready = VillageEngine.canAdvanceVillage(village);
  const requirement = phase() !== 'memory' ? 'Survive the raid and recall the first memory.'
    : ready ? '' : 'Gather the remaining timber and stone.';
  return identity + '<h3>Advance to Level 2</h3>'
    + `<div class="inspector-metrics">${trainingIcon('Timber', 'Timber', LEVEL_TWO.timber)}
      ${trainingIcon('Stone', 'Stone', LEVEL_TWO.stone)}${trainingIcon('Clock', 'Construction duration', `${LEVEL_TWO.days}d`)}</div>`
    + (requirement ? `<p>${requirement}</p>` : '')
    + (advancementDraft
      ? `<div class="actions">${button('confirm-level-two', 'Confirm advancement', !ready)}${button('cancel-level-two', 'Cancel')}</div>`
      : button('plan-level-two', 'Advance to Level 2', !ready))
    + preview;
}

const levelUnlocks = [
  [['Spearmen', 'Spearmen'], ['Wall guard', 'Walls'], ['Altar', 'Altar blessing']],
  [['Archer', 'Archery range and archers'], ['Tower', 'Towers'], ['Hero', 'First hero slot']],
  [['Swords', 'Swordsmen'], ['Cavalry', 'Cavalry'], ['Ballista', 'Ballistae'], ['Hero', 'Second hero slot']],
  [['Tower', 'Bastion'], ['Hero', 'Third hero slot'], ['Dragon', 'Final invasion']]
];

function unlockIcons(level) {
  return `<div class="unlock-icons">${levelUnlocks[level - 1].map(([icon, name]) => (`<span class="unlock-entry">${trainingIcon(icon, name)}<small>${name}</small></span>`)).join('')}</div>`;
}

function techTree() {
  return `<table class="production-table tech-tree"><caption>Village progression</caption>
    <thead><tr><th scope="col">Level</th><th scope="col">Unlocks</th><th scope="col">Building cap</th></tr></thead>
    <tbody>${[3,6,9,10].map((cap, i) => `<tr><th scope="row">${i + 1}</th>
      <td>${unlockIcons(i + 1)}</td><td>${cap}</td></tr>`).join('')}</tbody></table>
    <p>Reaching Level 4 starts the final invasion countdown.</p>`;
}

function inspector() {
  if (selected === 'campaign') return CampaignView.renderPane(village.campaign, campaignPane);
  if (selected === 'opening-altar') return row('Blessing', Campaign.blessings[village.altarBlessing] ?? 'Choose a blessing')
    + row('Hero recruitment', 'First slot at Village Level 2')
    + Object.entries(Campaign.blessings).map(([key,label])=>button(`opening-bless:${key}`,label,
      village.altarBlessing===key || village.day<(village.altarLockedUntil??0) || raidPending())).join('');
  if (village.opening && OPENING_BUILDINGS[selected] && !village.opening.plots[selected]?.ready) return openingPlot(selected);
  switch (selected) {
    case 'homes':
      return row('Residents', `${village.residents} / ${VillageEngine.beds(village)} beds`) + row('Farmers', village.farmers)
        + row('Bakers', village.bakers) + (village.opening ? row('Woodcutters', village.woodcutters) + row('Quarry workers', village.quarrymen) : row('Other workers', 11)) + row('Free workers', freeWorkers())
        + row('In training', Number(Boolean(village.trainingDay))) + row('Spearmen', village.spearmen);
    case 'hall':
      if (village.opening) return townOpening();
      return row('Town Center', village.result?.status === 'defeat' ? 'Destroyed' : 'Standing')
        + button('warning', 'Read raid warning');
    case 'tech':
      return techTree();
    case 'food':
      return foodInspector();
    case 'warning':
      if (phase() === 'scout') return row('Estimated raider strength', scoutStrength === null ? (scoutLoading ? 'Scouting…' : 'Unavailable') : fmt(scoutStrength))
        + row('Preparation window', '4 game days')
        + row('Spearman training', `${TRAINING.days} game days`)
        + '<p>Starting the countdown sets the raid date. Next day advances one day toward contact.</p>'
        + (scoutStrength === null
          ? button('retry-scout', 'Get scout estimate', scoutLoading)
          : button('start-warning', 'Start 4-day countdown'));
      if (!raidDay()) return '<p>The valley is quiet.</p>';
      if (raidPending()) return row('First raid', resolvingRaid ? 'Resolving…' : 'Awaiting engine')
        + (resolvingRaid ? '' : button('retry-raid', 'Resolve raid'))
        + (raidError ? '<small>Check your connection, then retry.</small>' : '');
      return row('Expected arrival', `Day ${raidDay()}`) + row('Days to prepare', Math.max(0, raidDay() - village.day))
        + '<h3>Defense readiness</h3>' + readiness()
        + nextActions([
          button('barracks', 'Check Barracks and training') + '<small>Recruits ready on raid day can fight.</small>',
          button('roost', village.offered ? 'Review Rally' : 'Compare Guard and Rally'),
          button('overview', 'Return to Village Overview')
        ]);
    case 'farm':
      return staffing('farmers');
    case 'wood':
      return staffing('woodcutters');
    case 'quarry':
      return staffing('quarrymen');
    case 'oven':
      return staffing('bakers') + provisionerTable() + `<p>${foodForecast()}</p>`;
    case 'barracks':
      return row('Building level', village.barracksLevel)
        + `<div class="training-unit">${countControl('Spearmen ready', village.spearmen,
          ['cancel-training', trainingDraft ? 'Remove planned recruit' : 'Cancel queued training', trainingDraft || (!guideActive() && Boolean(village.trainingDay))],
          ['train', 'Plan one spearman', !trainingDraft && canTrain()], trainingIcon('Spearmen', 'Spearman'))}</div>`
        + (trainingDraft ? '<small>+1 recruit planned</small>' : '')
        + (!village.trainingDay && !trainingDraft && freeWorkers() <= 0
          ? '<small>Free a worker before recruiting. No training order is queued to cancel.</small>' : '')
        + `<div class="training-cost"><small>${trainingDraft ? 'Total training cost · 1 recruit' : 'Cost per recruit'}</small>
          ${trainingIcon('Free workers', 'Free villager', 1)}
          ${trainingIcon('Provisions', 'Provisions', TRAINING.provisions)}
          ${trainingIcon('Timber', 'Timber', TRAINING.timber)}
        </div>`
        + (village.trainingDay ? trainingCountdown()
          : `<p class="training-timing">${TRAINING.days} days to train</p>`)
        + (trainingDraft ? button('confirm-training', 'Confirm training', !canTrain()) : '')
        + (guideActive() ? '' : barracksUpgrade());
    case 'roost':
      return dragonStances();
    case 'wall':
      if (phase() === 'refugees') return row('People at the gate', FIRST_HOUSEHOLD)
        + row('Beds available', VillageEngine.beds(village) - village.residents)
        + '<p>They saw the light in your new house.</p>' + button('admit-household', 'Welcome the household');
      return wallInspector();
    case 'report':
      return reportBody();
    default:
      return '';
  }
}

const stockIcons = {
  Altar: '<path fill="#a887b8" d="M3 20h18v2H3zm3-8h12v7H6Z"/><path fill="#ffe098" d="m12 2 4 5-4 4-4-4Z"/>',
  Archer: '<path fill="none" stroke="#efb875" stroke-width="2" d="M7 3c13 2 13 16 0 18M7 3v18M3 12h17m-4-3 4 3-4 3"/>',
  Tower: '<path fill="#aab6ba" d="M5 3h3v3h2V3h4v3h2V3h3v7l-3 2 2 10H6l2-10-3-2Z"/><path fill="#42362e" d="M11 11h2v4h-2Z"/>',
  Hero: '<path fill="#e6bd62" d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',
  Swords: '<path fill="#bbdae7" d="m4 3 5 2 10 12-2 2L5 8Zm16 0-5 2L5 17l2 2L19 8Z"/><path stroke="#e1a353" stroke-width="2" d="m3 15 6 6m6 0 6-6"/>',
  Cavalry: '<path fill="#be8355" d="m4 21 4-9 1-7 4 2 3-4 5 9-2 4h-4l-2-2-1 7Z"/><circle cx="16" cy="10" r="1" fill="#2e2118"/>',
  Ballista: '<path fill="none" stroke="#dda265" stroke-width="2" d="M3 9q9 6 18 0M3 9h18M12 4v14m0 0-5 4m5-4 5 4"/><path fill="#c9e1ea" d="m12 2 3 5H9Z"/>',
  Clock: `<circle cx="12" cy="12" r="9" fill="#3c3325" stroke="#d9b577" stroke-width="1.7"/><path d="M12 6v6l4 2" fill="none" stroke="#ffe1a3" stroke-width="1.7" stroke-linecap="round"/>`,
  'Wall guard': `<path fill="#83b9d0" d="M12 2 21 6v6c0 5-5 8-9 10-4-2-9-5-9-10V6Z"/><path fill="none" stroke="#e9f8ff" d="M12 6v12M7 11h10"/>`,
  Dragon: `<path fill="#e1ad4d" d="m2 17 4-8 5 3 5-8 6 3-2 7-4 4-7 3 1-5-4 3Z"/><path fill="#f8d789" d="m9 14 7-10-1 9Z"/><circle cx="18" cy="8" r="1" fill="#452818"/>`,
  Grain: `<path fill="#f7c84c" d="M12 4c2 3 2 6 0 8-2-2-2-5 0-8ZM5 7c4 0 6 2 6 5-4 0-6-2-6-5Zm14 0c0 3-2 5-6 5 0-3 2-5 6-5ZM4 12c4 0 7 2 7 5-4 0-7-2-7-5Zm16 0c0 3-3 5-7 5 0-3 3-5 7-5Z"/><path fill="none" stroke="#e99d31" d="M12 10v12"/>`,
  Provisions: `<path fill="#d98641" d="M2 15c0-6 5-10 11-10 5 0 9 4 9 9v4c0 2-20 2-20 0Z"/><path fill="#f6b765" stroke="none" d="M3 14c1-5 6-8 10-8 5 0 7 3 8 6-6 4-12 5-18 2Z"/><path fill="none" stroke="#ffe1a2" d="m7 12 3-4m1 5 3-5m1 5 3-4"/>`,
  Timber: `<path fill="#955234" d="m3 13 10-8c4-2 8 2 7 5l-10 9Z"/><path fill="#c98546" d="m7 14 10-8 4 1 1 5-10 8Z"/><ellipse fill="#efb871" cx="9" cy="17" rx="4" ry="4"/><path fill="none" stroke="#9d592e" d="M10 18c-3 2-4-3-1-3"/>`,
  Stone: `<path fill="#82b2d1" d="m2 17 5-9 6-3 7 4 2 9-5 3H6Z"/><path fill="#b7dceb" d="m7 8 6-3 7 4-8 5Z"/><path fill="#537899" d="m12 14 8-5 2 9-5 3h-5Z"/>`,
  'Free workers': `<path fill="#58b7a5" d="M4 21v-2c0-4 3-6 7-6h2c4 0 7 2 7 6v2Z"/><circle fill="#ffd196" cx="12" cy="9" r="4"/><path fill="#62d0bd" d="M7 8c0-6 10-6 10 0Z"/>`,
  Spearmen: `<path fill="#b87948" d="m4 21-2-2L16 5l2 2Z"/><path fill="#c6e8ff" d="m13 7 9-5-5 9Z"/><path fill="#d87c6a" d="M9 12c2 0 4-1 5-2 1 1 3 2 5 2 0 5-2 8-5 10-3-2-5-5-5-10Z"/><path fill="none" stroke="#ffd695" d="M14 12v7"/>`
};

function trainingCountdown() {
  const remaining = village.trainingDay - village.day;
  return `<p class="training-timing training-countdown">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>
    </svg>
    <span><strong>${remaining} ${remaining === 1 ? 'day' : 'days'} left</strong> · Ready on day ${village.trainingDay}</span>
  </p>`;
}

function trainingIcon(icon, name, value) {
  const label = value === undefined ? name : `${name}: ${value}`;
  return `<span class="training-icon" role="img" tabindex="0" aria-label="${label}" data-tooltip="${name}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${stockIcons[icon]}</svg>
    ${value === undefined ? '' : `<b aria-hidden="true">${value}</b>`}
  </span>`;
}

const stanceIcons = {
  guard: '<path fill="#6bb5ce" stroke="#25353b" d="M12 2 21 6v6c0 5-5 8-9 10-4-2-9-5-9-10V6Z"/><path fill="none" stroke="#e1f3f5" stroke-width="1.6" d="M12 6v12M7 11h10"/>',
  rally: '<path fill="#ed9445" stroke="#573525" d="M13 2c1 4-2 6 0 9 2-1 3-3 3-4 4 4 6 7 4 11-2 4-9 5-13 2-4-3-4-7 0-11 0 3 1 4 2 5 0-4 1-8 4-12Z"/><path fill="#ffe299" d="M12 13c3 3 4 6 1 7-3 1-5-2-1-7Z"/>'
};

const crown = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path fill="#f4be43" stroke="#382514" stroke-width="1.2" stroke-linejoin="round" d="m3 7 5 4 4-7 4 7 5-4-2 12H5Z"/>
  <path fill="#fff09b" d="m6 12 3 2 3-6 3 6 3-2-1 4H7Z"/>
  <path fill="#a56823" d="M6 17h12v2H6Z"/>
  <path fill="#b84659" d="m12 12 2 2-2 2-2-2Z"/>
</svg>`;

function buildingArtwork(place) {
  const art = places[place]?.[4];
  if (!art) return '';
  const [sheet, row] = art;
  const damagedWall = place === 'wall' && village.wallHealth < 100;
  const damage = damagedWall ? `<svg class="wall-damage" viewBox="0 0 100 100" aria-hidden="true">
    <path fill="#241b14" d="m16 55 3-4 1 9 3-5 2 7 2-5 2 6-1 13-12 4z"/>
    <path fill="#7d5430" stroke="#39271a" stroke-width=".55" d="m17 73 3-15 1 6-1 10zm6-2 1-14 2 8 1 5zm5-3 3-7 2 2-2 8z"/>
    <path fill="#a77643" d="m17 80 10-5 1 1-9 6zm12-4 7-3 1 1-7 4z"/>
    <circle cx="24" cy="66" r="14" fill="none" stroke="#ffab7c" stroke-width=".7" stroke-dasharray="2 2"/>
  </svg>` : '';
  return `<div class="building-art ${place === 'wall' ? 'wall-art' : ''}" role="img"
    aria-label="${damagedWall ? 'Village gate with an illustrated damage marker' : `${places[place][0]} architecture study`}"
    style="background-image:url('architecture-${sheet}.png');background-position:0 ${row * 50}%">${damage}</div>`;
}

function placeInspector() {
  const crown = document.querySelector('.pin[data-place="roost"]');
  $('layout').style.setProperty('--roost-clearance', `${crown.getBoundingClientRect().bottom + 24}px`);
}

function render() {
  const c = village.campaign;
  $('campaignButton').hidden = !c;
  $('altarButton').hidden = Boolean(c) || !village.opening;
  $('encounterAlert').hidden = !c?.event;
  $('encounterAlert').textContent = c?.event ? `Encounter · due Day ${c.event.due}` : '';
  $('clock').textContent = `Day ${c?.day ?? village.day} · ${timer ? 'Running' : 'Paused'}`;
  $('time').textContent = timer ? 'Pause' : 'Resume';
  $('time').disabled = !timer && !canResume();
  $('time').title = !canResume() && !timer && village.opening && !village.result
    ? 'Finish the current village task or use Next day where available.' : '';
  const forecast = VillageEngine.foodForecast(village);
  const foodAlert = $('foodAlert');
  foodAlert.hidden = c ? !c.shortage : phase() === 'stockpile' || (!village.economicDefeat && !Object.values(village.hunger).some(Boolean) && forecast.shortageIn > 3);
  foodAlert.textContent = c ? 'Missed rations' : village.economicDefeat ? 'Settlement lost'
    : Object.values(village.hunger).some(Boolean) ? 'Missed rations' : `Provisions short in ${forecast.shortageIn}d`;
  $('nextDay').disabled = Boolean(timer) || !canAdvance();
  $('stocks').innerHTML = [
    ['Grain', fmt(c?.stock.grain ?? village.grain)], ['Provisions', fmt(c?.stock.food ?? village.food)],
    ['Timber', fmt(c?.stock.timber ?? village.timber)], ['Stone', fmt(c?.stock.stone ?? village.stone)],
    ['Free workers', c ? Campaign.free(c) : freeWorkers()], [c ? 'Army' : 'Spearmen', c ? Campaign.troops(c) : village.spearmen]
  ].map(([name, value]) => `<span class="stock" tabindex="0" data-tooltip="${name}" aria-label="${name}: ${value}" role="img">
    <svg viewBox="0 0 24 24" aria-hidden="true">${stockIcons[name] ?? stockIcons.Spearmen}</svg><b aria-hidden="true">${value}</b>
  </span>`).join('');
  $('warning').textContent = c ? (c.status!=='active' ? 'Campaign outcome'
    : c.threat ? `Defense · Day ${c.threat.day}` : `Valley watch · Day ${Campaign.nextAttack(c)}`) : phase() === 'scout' ? 'Scout report' : !raidDay() ? 'Valley watch' : village.result ? 'First raid · View report' : raidPending() ? 'First raid · Resolve encounter' : `Raid on day ${raidDay()} · ${raidDay() - village.day} ${raidDay() - village.day === 1 ? 'day' : 'days'} to prepare`;

  renderGuide();
  renderMap();
  placeInspector();
  const panel = $('panel');
  $('layout').classList.toggle('inspecting', Boolean(selected));
  panel.hidden = !selected;
  panel.classList.toggle('battle-panel', selected === 'report' || selected === 'campaign');
  panel.classList.toggle('campaign-panel', selected === 'campaign');
  panel.classList.toggle('wall-panel', selected === 'wall');
  const panelAnchor = places[guideTarget()] ?? places[selected];
  panel.classList.toggle('left', Boolean(panelAnchor && panelAnchor[1] > 65));
  if (!selected) return;
  const title = selected === 'campaign' ? CampaignView.names[campaignPane]
    : selected === 'opening-altar' ? 'Altar' : selected === 'report' ? 'Battle report'
    : selected === 'warning' ? 'Raid warning' : selected === 'tech' ? 'Tech tree' : selected === 'food' ? (village.economicDefeat ? 'Settlement lost' : 'Food and rations') : places[selected][0];
  const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.action : null;
  const scroll = panel.scrollTop;
  panel.innerHTML = `<div class="panelbody"><button class="close-panel" data-action="overview" aria-label="Close inspector">×</button>
    <small class="eyebrow">${selected === 'report' ? 'Battle record' : 'Village ledger'}</small><h2 tabindex="-1">${title}</h2>${buildingArtwork(selected)}${inspector()}</div>`;
  panel.scrollTop = scroll;
  if (focused) {
    const replacement = panel.querySelector(`[data-action="${focused}"]:not(:disabled)`);
    (replacement ?? panel.querySelector('h2')).focus({ preventScroll: true });
  }
}

function currentProgress() {
  return { village, visited: [...visited], speed };
}

function persistCampaign(manual = false) {
  if (playMode !== 'campaign') return false;
  const progress = currentProgress();
  if (!activeProfile) {
    if (manual) $('menuStatus').textContent = 'Choose a profile or export this game as a backup.';
    return false;
  }
  const serialized = JSON.stringify(progress);
  if (!manual && serialized === lastSavedProgress) return true;
  try {
    activeProfile = VillageSaves.save(activeProfile, progress);
    lastSavedProgress = serialized;
    saveIssue = '';
    if (manual) $('menuStatus').textContent = `Saved to ${activeProfile.name} · Day ${village.day}.`;
    return true;
  } catch (error) {
    const previousIssue = saveIssue;
    saveIssue = error.name === 'SaveConflict' ? error.message : 'This browser could not save. Export this game to keep your progress.';
    if (manual) $('menuStatus').textContent = saveIssue;
    else if (saveIssue !== previousIssue) note(saveIssue);
    return false;
  }
}

function mayLeaveCampaign() {
  return playMode !== 'campaign' || persistCampaign()
    || window.confirm('This session has not been saved. Leave it without saving?');
}

function resetInteraction() {
  stop();
  scoutStrength = null;
  trainingDraft = false;
  advancementDraft = false;
  dragonDraft = null;
  farmerDraft = false;
  raidError = false;
  lastStaffChange = null;
}

function useProfile(profile, progress) {
  activeProfile = profile;
  saveIssue = '';
  playMode = progress ? 'campaign' : 'title';
  lastSavedProgress = progress ? JSON.stringify(progress) : null;
  resetInteraction();
  village = progress?.village ?? VillageEngine.newVillage();
  if (village.opening?.phase === 'chapter-complete' && !village.campaign) Campaign.start(village);
  campaignPane = village.campaign?.status === 'active' ? 'town' : 'records';
  visited = new Set(progress?.visited);
  speed = progress?.speed ?? 1;
  $('speed').value = String(speed);
  selected = village.campaign ? 'campaign' : village.economicDefeat || Object.values(village.hunger).some(Boolean) ? 'food'
    : raidPending() ? 'warning' : village.result && phase() === 'aftermath' ? 'report' : null;
  for (const id of ['profiles', 'settings', 'story']) {
    if ($(id).open) $(id).close();
  }
  render();
  if (progress) note(`${profile.name} · Day ${village.day} restored.`);
  else showPrologue();
}

function showProfiles() {
  stop();
  render();
  const list = $('profileList');
  $('profileStatus').textContent = '';
  list.replaceChildren();
  try {
    const { profiles, unreadable } = VillageSaves.list();
    if (!profiles.length) list.textContent = 'No profiles yet.';
    if (unreadable) $('profileStatus').textContent = 'Some browser profiles could not be read.';
    for (const profile of profiles) {
      const row = document.createElement('div');
      row.className = 'profile-row';
      const saved = profile.progress?.village;
      const day = Number.isSafeInteger(saved?.day) ? ` · Day ${saved.day}` : '';
      const savedAt = new Date(profile.savedAt);
      const date = profile.savedAt && Number.isFinite(savedAt.getTime()) ? ' · ' + savedAt.toLocaleString() : '';
      const detail = saved ? escapeText(saved.villageName ?? DEFAULT_VILLAGE_NAME) + day + escapeText(date) : 'Ready for a new story';
      const id = escapeText(profile.id);
      row.innerHTML = `<span><strong>${escapeText(profile.name)}</strong><small>${detail}</small></span>
        <div class="actions">${button(`profile-open:${id}`, saved ? 'Continue' : 'Start story')}
          ${saved ? button(`profile-export:${id}`, 'Export backup') : ''}</div>`;
      list.append(row);
    }
  } catch {
    $('profileStatus').textContent = 'Browser storage is unavailable. You can play and export a backup from the village menu.';
  }
  $('createProfile').reset();
  $('profiles').showModal();
}

function exportProgress(name, progress) {
  const file = new Blob([VillageSaves.encode(name, progress)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const download = document.createElement('a');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  download.href = url;
  download.download = `emberhollow-${slug || 'village'}.json`;
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function profileAction(action) {
  const [operation, id] = action.split(':');
  try {
    const profile = VillageSaves.read(id);
    if (!profile) throw new Error('This profile could not be read.');
    if (operation === 'profile-export') return exportProgress(profile.name, VillageSaves.validateProgress(profile.progress));
    if (resolvingRaid) throw new Error('Wait for the raid to finish before switching profiles.');
    if (mayLeaveCampaign()) {
      // A save from this tab may have changed the selected profile while leaving.
      const latest = VillageSaves.read(id);
      if (!latest) throw new Error('This profile could not be read.');
      useProfile(latest, latest.progress ? VillageSaves.validateProgress(latest.progress) : null);
    }
  } catch (error) {
    $('profileStatus').textContent = error.message;
  }
}

function syncCampaign() {
  village.day = village.campaign.day;
  persistCampaign();
}

let resolvingBattle = false;

// Campaign battles run in the run 10 Python engine in the browser worker (campaign_battle.py).
async function resolveCampaignBattle() {
  const c = village.campaign;
  if (resolvingBattle || !c || c.status !== 'active' || !c.threat || c.day < c.threat.day) return;
  stop();
  resolvingBattle = true;
  note('Resolving the battle…');
  render();
  const battleVillage = village;
  try {
    const result = await RaidClient.request('campaign', Campaign.battleSnapshot(c));
    if (village !== battleVillage) return;
    Campaign.applyBattle(c, result);
    syncCampaign();
    note('Battle resolved. Time is paused.');
    openCampaign('records');
  } catch (error) {
    if (village !== battleVillage) return;
    note('The battle engine could not load. Check the connection and choose Resolve battle again.');
    render();
  } finally {
    resolvingBattle = false;
  }
}

function beginCampaign() {
  stop();
  Campaign.start(village);
  syncCampaign();
  openCampaign('journal');
}

function openCampaign(pane) {
  if (!village.campaign || !Object.hasOwn(CampaignView.names,pane)) return;
  selected = 'campaign';
  campaignPane = pane;
  render();
  if (pane==='encounters' && village.campaign.event) CampaignView.discoverMedia(village.campaign.event.id);
}

function campaignCommand(action) {
  const [,verb,key] = action.split(':');
  if (verb==='close-clip') return $('encounterMedia').close();
  const c = village.campaign;
  if (!c) return;
  if (verb==='pane') return openCampaign(key);
  if (verb==='clip') return CampaignView.clip(key);
  if (verb==='first-report') return open('report');
  if (verb==='restore' && (!c.checkpoints[key] || !window.confirm(`Resume Level ${key} from its saved milestone? Current progress will be replaced.`))) return;
  const route = verb==='event' && key!=='pass' && c.event ? CampaignEvents.roster[c.event.id]?.pane : null;
  if (verb==='fight') return resolveCampaignBattle();
  if (!Campaign.action(c,verb,key)) {
    note('That action is not available right now.');
    return render();
  }
  syncCampaign();
  if (verb==='restore') { stop(); return openCampaign('town'); }
  return openCampaign(route ?? campaignPane);
}

function command(action) {
  if (action.startsWith('campaign:')) return campaignCommand(action);
  if (action==='begin-campaign' && phase()==='chapter-complete') return beginCampaign();
  if (action==='opening-altar' && village.opening) return open('opening-altar');
  if (action.startsWith('opening-bless:') && village.opening && !village.campaign && !raidPending()) {
    const key=action.split(':')[1];
    if (!Object.hasOwn(Campaign.blessings,key) || village.day < (village.altarLockedUntil??0)) return;
    village.altarBlessing=key; village.altarLockedUntil=village.day+5;
    return render();
  }
  if (action === 'overview') return open(null);
  if (action === 'food-alert') return village.campaign ? openCampaign('economy') : open('food');
  if (action === 'retry-scout') return fetchScoutReport();
  if (action === 'tech-tree') return open('tech');
  if (action === 'warning') return village.campaign ? openCampaign(village.campaign.status==='active'?'threat':'records') : open(village.result ? 'report' : 'warning');
  if (action === 'report' && village.result) return open('report');
  if (places[action]) return open(action);
  if (action === 'nextDay') return advance();
  if (action === 'time') return toggleTime();
  if (action === 'save') return persistCampaign(true);
  if (action === 'profiles') return showProfiles();
  if (action === 'close-profiles') return $('profiles').close();
  if (action.startsWith('profile-')) return profileAction(action);
  if (action === 'export-session' && playMode === 'campaign') return exportProgress(activeProfile?.name ?? village.chiefName, currentProgress());
  if (action === 'closeMenu') return $('settings').close();
  if (/^story-[0-3]$/.test(action)) return showPrologue(Number(action.slice(-1)));
  if (action === 'return-memory') {
    $('story').close();
    return open('hall');
  }

  if (resolvingRaid) return;
  if (action === 'retry-raid') return resolveRaid();
  if (raidPending() && !['restart', 'checkpoint'].includes(action)) return;
  if ((village.economicDefeat || ['defeat', 'stall'].includes(village.result?.status)) && !['restart', 'checkpoint', 'skip'].includes(action)) return;
  if (action === 'restart' || action === 'checkpoint') {
    if (!mayLeaveCampaign()) return;
    resetInteraction();
    playMode = action === 'checkpoint' ? 'practice' : 'title';
    village = VillageEngine.newVillage();
    if (playMode === 'practice') {
      activeProfile = null;
      lastSavedProgress = null;
      village.guide = lessons.length;
    }
    selected = null;
    visited.clear();
    if ($('settings').open) $('settings').close();
    if ($('story').open) $('story').close();
    if (action === 'restart') showPrologue();
    else note('First raid practice loaded.');
  }
  if (action === 'show-hints' && village.opening) {
    village.opening.hints = true;
    $('settings').close();
  }
  if (action === 'skip' && village.opening) {
    village.opening.hints = false;
    return render();
  }
  if (action === 'skip') {
    village.guide = lessons.length;
    note('Guidance is off. You can replay the tutorial from the menu.');
  }
  if (action === 'guideNext' && (village.guide === 3 || village.guide === 13)) nextLesson();
  if (action === 'claim-stockpile' && VillageEngine.claimStockpile(village)) note('Stockpile claimed.');
  if (action === 'build-plot' && VillageEngine.build(village, selected)) note('Construction started.');
  if (action === 'admit-household' && VillageEngine.admitHousehold(village)) note('The first household has arrived.');
  if (action === 'start-warning' && scoutStrength !== null && VillageEngine.startRaidWarning(village)) note(`Raid expected on day ${raidDay()}.`);
  if (action === 'memory' && phase() === 'aftermath' && village.result?.status === 'won') {
    village.opening.phase = 'memory';
    return showMemory();
  }
  const staffAction = /^(add|remove)-(farmers|bakers|woodcutters|quarrymen)$/.exec(action);
  if (action === 'remove-farmers' && canChangeStaff('farmers', -1)) farmerDraft = true;
  else if (staffAction) adjustStaff(staffAction[2], staffAction[1] === 'add' ? 1 : -1);
  if (action === 'cancel-farmer') farmerDraft = false;
  if (action === 'confirm-farmer' && farmerDraft) {
    farmerDraft = false;
    adjustStaff('farmers', -1);
  }
  if (action === 'cancel-training' && trainingDraft) {
    trainingDraft = false;
  } else if (action === 'cancel-training' && !guideActive() && village.trainingDay) {
    VillageEngine.cancelTraining(village);
    note('Training cancelled. The worker and supplies are available again.');
  }
  if (!guideActive() && !village.result) {
    if (action === 'remove-defender') VillageEngine.changeDefenders(village, -1);
    if (action === 'add-defender') VillageEngine.changeDefenders(village, 1);
  }
  if (action === 'train' && canTrain()) trainingDraft = true;
  if (action === 'confirm-training' && trainingDraft && canTrain()) {
    trainingDraft = false;
    VillageEngine.train(village);
    if (village.guide === 7) nextLesson();
    note(`Training begins. The spearman will be ready on day ${village.trainingDay}.`);
  }
  if (action === 'stance-guard' && canChooseDragonStance()) dragonDraft = 'guard';
  if (action === 'stance-rally' && canChooseDragonStance()) dragonDraft = 'rally';
  if (action === 'cancel-stance') dragonDraft = null;
  if (action === 'confirm-stance' && dragonDraft && canChooseDragonStance() && village.food >= stanceCost(dragonDraft)) {
    VillageEngine.chooseStance(village, dragonDraft);
    dragonDraft = null;
    if (village.guide === 8) nextLesson();
    note(village.offered ? 'The dragon is rallied.' : 'The dragon remains on guard.');
  }
  if (action === 'plan-level-two' && VillageEngine.canAdvanceVillage(village)) advancementDraft = true;
  if (action === 'cancel-level-two') advancementDraft = false;
  if (action === 'confirm-level-two' && advancementDraft && VillageEngine.advanceVillage(village)) {
    advancementDraft = false;
    note(`Town Center advancement started. Ready on day ${village.advancementDay}.`);
  }
  if (action === 'upgrade' && canUpgrade()) {
    VillageEngine.upgrade(village);
    note(`Barracks construction started. Ready on day ${village.upgradeDay}.`);
  }
  if (action === 'repair' && canRepair()) {
    VillageEngine.repair(village);
    note(`Wall repairs started. Ready on day ${village.repairDay}.`);
  }
  render();
}

for (const [place, [name, x, y, points]] of Object.entries(places)) {
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  outline.setAttribute('points', points);
  outline.dataset.place = place;
  $('trace').append(outline);
  const pin = document.createElement('button');
  pin.className = 'pin';
  pin.innerHTML = `${crown}<span aria-hidden="true">${name}</span>`;
  pin.style.left = `${x}%`;
  pin.style.top = `${y}%`;
  pin.dataset.place = place;
  $('mapStage').append(pin);
}

$('map').addEventListener('click', event => {
  const place = event.target.closest('[data-place]');
  open(place?.dataset.place ?? null);
  persistCampaign();
});
document.addEventListener('click', event => {
  const icon = event.target.closest('[data-tooltip]');
  document.querySelectorAll('.tooltip-open').forEach(openIcon => {
    if (openIcon !== icon) openIcon.classList.remove('tooltip-open');
  });
  if (icon) icon.classList.toggle('tooltip-open');
  const button = event.target.closest('button[data-action]');
  if (button && !button.disabled) {
    command(button.dataset.action);
    if (button.dataset.action !== 'save') persistCampaign();
  }
});
document.addEventListener('keydown', event => {
  if ($('settings').open || $('story').open || $('profiles').open || $('encounterMedia').open) return;
  if (event.key === 'Escape' && selected) {
    open(null);
    $('overview').focus();
    persistCampaign();
  }
  if (event.code === 'Space' && event.target === document.body) {
    event.preventDefault();
    toggleTime();
  }
});
$('menu').addEventListener('click', () => {
  stop();
  render();
  $('menuStatus').textContent = saveIssue;
  $('activeProfile').textContent = playMode === 'practice' ? 'Raid practice. Your campaign saves are kept separately.'
    : activeProfile ? `Profile: ${activeProfile.name} · Autosave on` : 'This session is not linked to a browser profile.';
  $('settings').querySelector('[data-action="save"]').disabled = playMode !== 'campaign' || !activeProfile;
  $('settings').querySelector('[data-action="export-session"]').disabled = playMode !== 'campaign';
  $('showHints').hidden = !village.opening || village.opening.hints;
  $('settings').showModal();
});
$('speed').addEventListener('change', event => {
  speed = Number(event.target.value);
  if (timer) {
    stop();
    toggleTime();
  }
  note(`Game speed set to ${speed}×.`);
  persistCampaign();
});
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--hud-height', `${$('hud').offsetHeight}px`);
  placeInspector();
}).observe($('hud'));
$('createProfile').addEventListener('submit', event => {
  event.preventDefault();
  if (resolvingRaid || !mayLeaveCampaign()) return;
  try {
    const profile = VillageSaves.create(new FormData(event.currentTarget).get('name'));
    useProfile(profile, null);
  } catch (error) {
    $('profileStatus').textContent = error.message;
  }
});
$('importSave').addEventListener('click', () => $('saveFile').click());
$('saveFile').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('The backup is too large.');
    const profile = VillageSaves.importBackup(await file.text());
    if (!$('profiles').open) return;
    $('profiles').close();
    showProfiles();
    $('profileStatus').textContent = `Imported ${profile.name} as a separate profile. Choose Continue to play it.`;
  } catch (error) {
    $('profileStatus').textContent = error instanceof SyntaxError
      ? 'This file does not contain a readable Emberhollow backup.' : error.message;
  }
});
$('story').addEventListener('submit', event => {
  if (event.target.id !== 'newVillageForm') return;
  event.preventDefault();
  const fields = new FormData(event.target);
  const chief = fields.get('chief').trim() || 'Chief';
  if (activeProfile?.progress && !window.confirm(`Replace the saved village in ${activeProfile.name} with a new story?`)) return;
  if (!activeProfile) {
    try {
      activeProfile = VillageSaves.create(chief);
    } catch {
      saveIssue = 'Browser storage is unavailable. You can export this game from the village menu.';
    }
  }
  lastSavedProgress = null;
  playMode = 'campaign';
  village = VillageEngine.newOpening(chief, fields.get('village').trim() || DEFAULT_VILLAGE_NAME);
  resetInteraction();
  visited.clear();
  selected = null;
  $('story').close();
  if (activeProfile) persistCampaign();
  else note(saveIssue);
  render();
});
$('story').addEventListener('cancel', event => event.preventDefault());
$('encounterMedia').addEventListener('close', () => {
  const video=$('encounterVideo');
  video.pause();video.removeAttribute('src');video.load();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !timer) return;
  stop();persistCampaign();render();
});
render();
showPrologue();
