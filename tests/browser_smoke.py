"""Browser checks (GAME-FIX-1 C4), run with Playwright on Chromium.

Usage: python3 tests/browser_smoke.py [--chrome /path/to/chrome]
Set PYODIDE=1 to include the steps that load the Python engine from the Pyodide CDN (needs internet access).
"""
import argparse
import functools
import http.server
import json
import os
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ONLINE = os.environ.get("PYODIDE") == "1"
checks = []


def check(name, ok, detail=""):
    checks.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'} · {name}{' · ' + detail if detail and not ok else ''}")


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--chrome", default=None, help="Chrome or Chromium executable (default: Playwright's Chromium)")
    args = parser.parse_args()
    server = serve()
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chrome, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(f"page error: {e}"))
        page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" and "favicon" not in m.text and "404" not in m.text else None)
        page.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 and not r.url.endswith("favicon.ico") and "/encounters/" not in r.url else None)

        page.goto(url)
        page.wait_for_selector("#story[open]")
        check("prologue opens", "PROLOGUE" in page.inner_text("#storyContent"))
        check("speed options are 1x, 2x and 3x", page.eval_on_selector_all("#speed option", "o => o.map(x => x.value)") == ["1", "2", "3"])

        page.click("text=Skip to naming")
        page.fill("input[name=chief]", "Tester")
        page.fill("input[name=village]", "Smoke Hollow")
        page.click("text=Take charge")
        page.wait_for_timeout(300)
        check("new story starts the opening", page.evaluate("village.opening && village.chiefName === 'Tester'"))

        # Jump to the end of the opening chapter and start the campaign.
        page.evaluate("""() => {
            stop(); document.querySelectorAll('dialog[open]').forEach(d => d.close());
            Object.assign(village, { level: 2, residents: 10, farmers: 3, bakers: 2, woodcutters: 1, quarrymen: 1, spearmen: 3,
              defenders: 3, barracksLevel: 2, grain: 30, food: 30, timber: 30, stone: 30, day: 50 });
            village.opening.phase = 'chapter-complete';
            beginCampaign();
        }""")
        page.wait_for_timeout(200)
        check("campaign starts", page.evaluate("Boolean(village.campaign) && Campaign.validate(village.campaign)"))
        names = page.evaluate("Object.keys(CampaignView.names)")
        for pane in names:
            page.click(f"#panel .campaign-tabs button[data-action='campaign:pane:{pane}']")
            text = page.inner_text("#panel")
            check(f"campaign pane '{pane}' renders", len(text) > 40 and "undefined" not in text and "NaN" not in text, text[:120])

        # Play days until a threat arrives, answering encounters as they open.
        for _ in range(120):
            state = page.evaluate("({ day: village.campaign.day, threat: village.campaign.threat, event: village.campaign.event, active: Campaign.active(village.campaign) })")
            if state["threat"] and state["day"] >= state["threat"]["day"]:
                break
            if state["event"]:
                page.evaluate("Campaign.action(village.campaign, 'event', 'pass')")
            page.click("#nextDay")
        state = page.evaluate("({ day: village.campaign.day, threat: village.campaign.threat })")
        check("a raid arrives during play", state["threat"] is not None and state["day"] >= state["threat"]["day"], json.dumps(state))
        page.click("#panel .campaign-tabs button[data-action='campaign:pane:threat']")
        check("the watch offers Resolve battle", page.locator("button[data-action='campaign:fight:']").count() == 1)

        if ONLINE:
            page.click("button[data-action='campaign:fight:']")
            page.wait_for_function("village.campaign.reports.length > 0", timeout=120000)
            report = page.evaluate("village.campaign.reports.at(-1)")
            check("the battle resolves in the run 10 engine", report.get("engine") == "3.2h-trial", json.dumps(report)[:200])
            check("battle report renders", "combat round" in page.inner_text("#panel"))

        # Save, reload and continue.
        page.click("#menu")
        page.click("#settings button[data-action='save']")
        day = page.evaluate("village.campaign.day")
        page.reload()
        page.wait_for_timeout(500)
        page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
        page.click("#menu")
        page.click("#settings button[data-action='profiles']")
        page.wait_for_selector("#profiles[open]")
        page.locator("#profileList button", has_text="Continue").first.click()
        page.wait_for_timeout(300)
        check("save and continue restores the campaign", page.evaluate("village.campaign?.day") == day)

        # Export, then import as a separate profile.
        page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
        page.click("#menu")
        with page.expect_download() as info:
            page.click("#settings button[data-action='export-session']")
        path = Path(tempfile.mkdtemp()) / "backup.json"
        info.value.save_as(path)
        backup = json.loads(path.read_text())
        check("export writes a backup file", backup.get("kind") == "emberhollow-save" or "progress" in backup, str(list(backup))[:80])
        page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
        page.click("#menu")
        page.click("#settings button[data-action='profiles']")
        before = page.locator("#profileList button", has_text="Continue").count()
        page.set_input_files("#saveFile", str(path))
        page.wait_for_timeout(500)
        check("import creates a separate profile", page.locator("#profileList button", has_text="Continue").count() == before + 1)

        if ONLINE:
            page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
            page.click("#menu")
            page.click("#settings button[data-action='checkpoint']")
            page.wait_for_function("village.result !== null", timeout=120000)
            check("first raid checkpoint resolves", page.evaluate("['won','defeat'].includes(village.result.status)"))

        check("no page or console errors", not errors, "; ".join(errors[:5]))
        browser.close()
    server.shutdown()
    failed = [c for c in checks if not c[1]]
    print(f"\n{len(checks) - len(failed)} of {len(checks)} browser checks passed{'' if ONLINE else ' (Pyodide steps skipped: set PYODIDE=1)'}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
