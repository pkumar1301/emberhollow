// The opening uses illustrated story panels and the same village state as the raid.
const STORY_SCENES = [
  ['The closed gate', 'A bell rings once. Beyond the gate, people call through the smoke. The doors close. A thread of gold appears between the stones. You reach for it.'],
  ['Under an open sky', 'You wake with sweat on your brow. A wounded golden dragon is watching the valley. “I found you beneath the gatehouse. The kingdom fell to the other dragon and its army. I could carry one person clear. I was fleeing too.”'],
  ['A light in the window', '“There is an abandoned village below. Its hall still stands, and there are supplies inside. I will keep watch while my presence helps. Take charge of the village. Give people a reason to come home.”']
];

const OPENING_LESSONS = {
  stockpile: ['Claim the stockpile', 'Open the Town Center and collect the supplies.', 'hall'],
  homes: ['Build the first hearth', 'Select the housing plot, build a house, then advance time. Next day moves one day. Resume runs construction at the chosen speed and pauses when the work is ready.', 'homes'],
  refugees: ['A knock at the gate', 'A light in the new house draws survivors out of the trees. Inspect the Village gate and decide when to welcome them.', 'wall'],
  farm: ['Plant the grain field', 'Use the supplies to build the grain field. Advance a day to finish it.', 'farm'],
  farmers: ['Assign farmers', 'Press + to assign three farmers. The harvest changes with each worker.', 'farm'],
  oven: ['Build the Provisioner', 'Build the oven to turn grain into provisions.', 'oven'],
  bakers: ['Staff the oven', 'Assign two bakers. Check grain use and provisions made in the table.', 'oven'],
  wood: ['Build the Woodcutters', 'Open the timber plot to start construction.', 'wood'],
  woodcutters: ['Staff the Woodcutters', 'Assign one woodcutter. Timber arrives as time advances.', 'wood'],
  quarry: ['Build the Quarry', 'Open the stone plot to start construction.', 'quarry'],
  quarrymen: ['Staff the Quarry', 'Assign one quarry worker. Leave a worker free for training.', 'quarry'],
  scout: ['Tracks on the road', 'A scout followed fresh tracks above the valley. Open the warning when ready to hear the report.', 'warning'],
  prepare: ['Prepare for the first raid', 'Check the Barracks, wall, and dragon. Orders that finish before contact can help defend the village.', 'warning'],
  aftermath: ['What the village remembers', 'Read the report, inspect the wall, then revisit the memory when ready.', 'report'],
  memory: ['Memory recovered', 'Open the Town Center to review and confirm the Level 2 costs.', 'hall']
};

const STAFF_MILESTONES = {
  farmers: ['farmers', 3, 'oven'],
  bakers: ['bakers', 2, 'wood'],
  woodcutters: ['woodcutters', 1, 'quarry'],
  quarrymen: ['quarrymen', 1, 'scout']
};

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function showPrologue(step = 0) {
  const dialog = $('story');
  dialog.dataset.scene = String(step);
  const content = $('storyContent');
  if (step < STORY_SCENES.length) {
    const [title, passage] = STORY_SCENES[step];
    content.innerHTML = `<small>PROLOGUE · ${step + 1}/3</small><h2 id="storyTitle">${title}</h2>
      <p>${passage}</p><div class="actions">${button(`story-${step + 1}`, 'Continue')}
      ${button('story-3', 'Skip to naming')}${button('profiles', 'Profiles &amp; saves')}
      ${button('checkpoint', 'First raid checkpoint')}</div><p id="storyStatus" role="status"></p>`;
  } else {
    content.innerHTML = `<small>THE LAST HEARTH</small><h2 id="storyTitle">Name your settlement</h2>
      <details><summary>Story recap</summary><p>A wounded golden dragon rescued you when the kingdom fell. In a distant valley, an abandoned village offers a place to begin again.</p></details>
      <form id="newVillageForm">
        <label>Chief name <input name="chief" maxlength="32" required value="Chief"></label>
        <label>Village name <input name="village" maxlength="32" required value="${DEFAULT_VILLAGE_NAME}"></label>
        <button type="submit">Take charge</button>
      </form>
      <div class="actions">${button('profiles', 'Profiles &amp; saves')}</div>
      <p>${activeProfile ? `Profile: ${escapeText(activeProfile.name)}` : 'Your chief name will also label your browser profile.'}</p>`;
  }
  if (!dialog.open) dialog.showModal();
}

function showMemory() {
  $('story').dataset.scene = 'memory';
  $('storyContent').innerHTML = `<small>FIRST MEMORY</small><h2 id="storyTitle">The colors at the gate</h2>
    <p>That night, the sound of the raid horn brings the gate back to you. This time you see the colors on the cloaks of those left outside. They belonged to your kingdom.</p>
    <div class="actions">${button('return-memory', 'Return to the village')}</div>`;
  $('story').showModal();
}
