# Emberhollow · The Last Hearth

Rebuild the settlement, survive the opening raid, and develop the village through Level 4. The local campaign includes recurring raids, the invasion countdown, three invasion waves, and victory and defeat outcomes. The campaign opens with an illustrated prologue. All encounters can be played through their text and choices.

## Play locally

Run `python3 -m http.server 8000` from this directory and open `http://localhost:8000/`. Every battle, from the first raid to the final wave, is resolved by the run 10 Python engine (`dv_engine.py` with `run10.json`) in a browser worker, so the game needs access to the Pyodide CDN. The first-raid practice shortcut is independent of campaign saves.

The **Campaign** panel appears after you reach Level 2. Use it to manage the economy, military, Altar, guardian, encounters, journal, and checkpoints. Open **Valley watch** to scout a reported threat. On the day it arrives, choose **Resolve battle**.

## Profiles and saves

Start a story to create a browser profile using your chief name, or create a named profile under **Profiles & saves**. The game autosaves as you play. **Menu → Save village** saves immediately. Choose **Continue** beside a profile to return to it. Each completed campaign level saves a milestone. Continuing a pre-campaign save at the old Level 2 ending starts the expanded campaign.

**Export backup** saves a portable JSON file. Import creates a separate profile. Browser storage can be cleared, so keep the backup file if you want a second copy. A legacy single-slot save appears under **Previous village**.

## How battles work

- `first_raid.py` resolves the opening raid. At Village Level 1 the Town Center cannot fall: raiders who push the wall below 75% carry off stores above the protected reserve instead.
- `campaign_battle.py` resolves every campaign raid and invasion wave. It builds a run 10 engine run from the campaign state and applies the campaign-only rules: hero specialties, dragon stance, the Level 1 safety net and the stall rule (a battle that cannot finish is either held or lost, never left open).
- `dv_engine.py` is the frozen run 10 engine. Do not edit it; the tests pin its SHA-256.

The run 10 rules in the campaign: one invasion type for all three waves (Horde, Siege or Wyrm), each with its own counter (watchtowers, reinforced walls, or ballistae with bolts and the anti-dragon kit); Level 4 raids every 10 days through the countdown, with flying raiders; only your guardian, ballistae and kit carriers can hurt flying enemies; the guardian enters the duel once the army is down to its tolerance, and the evil dragon recovers to 70% when it does.

## Tests

```
python3 -m unittest discover -s tests -p "test_*.py"   # engine pin, battle adapter, stall rule, heroes, counters, first raid
node --test tests/campaign.test.mjs                     # campaign rules and every encounter option
node tests/scripted_runs.mjs --seeds 200 --check        # scripted full campaigns: win rates, pacing, errors
python3 tests/browser_smoke.py                          # browser checks; PYODIDE=1 adds the engine steps (needs internet)
```

GitHub Actions runs all four on every push, and the 200-seed battery nightly.

## Encounter clips

Create an `encounters` directory alongside `index.html`. Use the two-digit IDs in the design brief, for example `encounters/01.mp4` for **Lanterns on the Road** and `encounters/16.mp4` for **Lamps Along the Ridge**. The game looks for the corresponding video when the encounter opens. It displays **Play encounter clip** only when the server returns a video. The text, decisions, deadlines and outcomes work without the clips.

[Play Emberhollow on GitHub Pages](https://pkumar1301.github.io/emberhollow/)
