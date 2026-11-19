# Emberhollow · The Last Hearth

[Play the opening chapter](https://pkumar1301.github.io/emberhollow/)

Rebuild an abandoned village, prepare its dragon and defenders, and face the first raid. The opening chapter ends when the village reaches Level 2. The **First raid checkpoint** on the title screen takes you straight to the defenses. Use **Menu → Save village** to keep your progress in the current browser.

The game runs as a static site. The original Python raid engine runs in a browser worker using Pyodide 0.27.7. The prologue is stored in two files to fit GitHub's browser upload limit and reassembled without changing the video.

To run a local development copy, use `python3 -m http.server 8000` from this directory and open `http://localhost:8000/`.
