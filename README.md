# Emberhollow · The Last Hearth

Rebuild the settlement, survive the opening raid, and develop the village through Level 4. The local campaign includes recurring raids, the invasion countdown, three invasion waves, and victory and defeat outcomes. The campaign opens with an illustrated prologue. All encounters can be played through their text and choices.

## Play locally

Run `python3 -m http.server 8000` from this directory and open `http://localhost:8000/`. The opening raid uses the original Python resolver in a browser worker and needs access to the Pyodide CDN. Later campaign battles use their own deterministic resolver and prototype balance settings. The first-raid practice shortcut is independent of campaign saves.

The **Campaign** panel appears after you reach Level 2. Use it to manage the economy, military, Altar, guardian, encounters, journal, and checkpoints. Open **Valley watch** to scout a reported threat. On the day it arrives, choose **Resolve battle**.

## Profiles and saves

Start a story to create a browser profile using your chief name, or create a named profile under **Profiles & saves**. The game autosaves as you play. **Menu → Save village** saves immediately. Choose **Continue** beside a profile to return to it. Each completed campaign level saves a milestone. Continuing a pre-campaign save at the old Level 2 ending starts the expanded campaign.

**Export backup** saves a portable JSON file. Import creates a separate profile. Browser storage can be cleared, so keep the backup file if you want a second copy. A legacy single-slot save appears under **Previous village**.

## Encounter clips

Create an `encounters` directory alongside `index.html`. Use the two-digit IDs in the design brief, for example `encounters/01.mp4` for **Lanterns on the Road** and `encounters/16.mp4` for **Lamps Along the Ridge**. The game looks for the corresponding video when the encounter opens. It displays **Play encounter clip** only when the server returns a video. The text, decisions, deadlines and outcomes work without the clips.

[Play Emberhollow on GitHub Pages](https://pkumar1301.github.io/emberhollow/)
