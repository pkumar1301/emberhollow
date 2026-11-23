# Adding an encounter

Encounters live in `campaign-events.js`, in the `roster` table. Adding one is a data change: no engine edits are needed.

## 1. Add a roster entry

Use the next two-digit ID (the next is `17`).

```js
'17': offer('Title shown to the player', 'people',   // category: people, land or dragon
  'One or two sentences describing the situation and what each choice costs.',
  c => /* eligible: when this encounter may be offered */ true,
  [option('Label for the choice', c => { /* what happens */ }, c => /* enabled: can the player afford it? */ true)],
  { limit: 1, days: 2 })   // optional settings, below
```

Optional settings:

| Setting | Meaning | Default |
|---|---|---|
| `limit` | How many times it can appear in one campaign | 1 |
| `days` | Days the player has to decide | 2 |
| `easy` | May appear as the first encounter of a campaign | false |
| `miss` | `(c, event) => …` runs if the player passes or the deadline expires | none ("Passed") |
| `target` | `c => …` picks something the encounter affects, shown to the player | none |
| `pane` | Campaign panel to open after the choice, e.g. `'altar'` | the current panel |

Helpers at the top of the file cover most outcomes: `stock(key, n)` adds stock now, `reward(key, n, days, workers, cost)` pays out later, `spend(cost)`, `has(cost)`, `worker`, `housing(c, n)`, and `project(key)`, which adds a journal page.

If the encounter adds a journal page, add its title and text to `journalEntries` in the same file. The tests fail if a page has no text.

## 2. Check it

```
node --test tests/campaign.test.mjs
node tests/scripted_runs.mjs --seeds 50 --check
```

The rule tests run every option of every encounter and check the save is still valid. The scripted campaigns fail if any encounter never appears, so an eligibility rule that can never be met is caught.

## 3. Optional clip

Put a video at `encounters/17.mp4`. The game shows **Play encounter clip** only when the file exists.

## Scheduling rules

- The game tries to open an encounter every 5 days, with a 50% chance each time.
- At least 6 days separate two encounters, and 10 days separate two encounters of the same category.
- No encounter opens within 3 days of an attack, while a dragon demand or departure request is waiting, or on a day that already paused the game.
- Encounter `16` only appears during the invasion countdown; no other encounter appears then.
