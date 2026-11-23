"""Line-based JSON server so Node tests can resolve campaign battles with the same Python adapter the browser uses.

Each input line is {"id": n, "action": "campaign" | "first", "snapshot": {...}}; each output line is {"id": n, "result": ...}
or {"id": n, "error": "..."}.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from campaign_battle import resolve_encounter  # noqa: E402

for line in sys.stdin:
    if not line.strip():
        continue
    message = json.loads(line)
    try:
        result = resolve_encounter(message["snapshot"])
        out = {"id": message["id"], "result": result}
    except Exception as error:  # reported to the test, which fails
        out = {"id": message["id"], "error": f"{type(error).__name__}: {error}"}
    sys.stdout.write(json.dumps(out, allow_nan=False) + "\n")
    sys.stdout.flush()
