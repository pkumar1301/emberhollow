const runtimeUrl = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let engine;

async function loadEngine() {
  importScripts(runtimeUrl + 'pyodide.js');
  const sources = ['dv_engine.py', 'first_raid.py', 'run10.json'];
  const [python, files] = await Promise.all([
    self.loadPyodide({ indexURL: runtimeUrl }),
    Promise.all(sources.map(async name => {
      const response = await fetch(name);
      if (!response.ok) throw new Error(`Could not load ${name}`);
      return response.text();
    }))
  ]);

  const directory = '/home/pyodide/emberhollow_engine';
  python.FS.mkdirTree(directory);
  sources.forEach((name, index) => python.FS.writeFile(`${directory}/${name}`, files[index]));
  python.runPython(`
import json
import sys
sys.path.insert(0, "/home/pyodide")
from emberhollow_engine.first_raid import scout_first_raid, resolve_first_raid

def dispatch_raid(action, payload):
    snapshot = json.loads(payload)
    if action == "scout":
        result = scout_first_raid(snapshot)
    elif action == "resolve":
        result = resolve_first_raid(snapshot, compare=True)
    else:
        raise ValueError("Unknown raid action")
    return json.dumps(result, allow_nan=False)
`);
  return python.globals.get('dispatch_raid');
}

self.addEventListener('message', async ({ data: { id, action, snapshot } }) => {
  try {
    engine ??= loadEngine().catch(error => {
      engine = undefined;
      throw error;
    });
    const dispatch = await engine;
    const result = JSON.parse(dispatch(action, JSON.stringify(snapshot)));
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
});
