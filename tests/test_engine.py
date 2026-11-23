"""Python checks for the run 10 engine copy, the campaign battle adapter and the first raid (GAME-FIX-1 C1, A3-A5).

Run from the repository root: python3 -m unittest discover -s tests -p 'test_*.py'
"""
import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import campaign_battle as cb  # noqa: E402
from campaign_battle import resolve_encounter, settle_stall, CampaignRun, BLOCK  # noqa: E402


def sha256(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()


# The engine and settings the game ships. If either changes, this test fails until the change is reviewed.
# Note: the frozen package for Codex lists engine prefix b3e34f3fbc4ac429; this repository's copy is 532a9fe987b1395e.
ENGINE_SHA256 = "532a9fe987b1395e8bb5bb477db3330b5cb8cde64086c6d56e7e1f7a1ae96cea"
CONFIG_SHA256 = "92e2707d6967c89e0a2df5f8b075ea071ae157ab31e62ab9a9ab086a4f1de584"


def snapshot(**changes):
    snap = dict(
        seed=7, day=200, level=3, wave=0, invasionType=None, flier=0,
        army=dict(spearmen=4, archers=3, swordsmen=2, cavalry=0), gear=dict(spearmen=2, archers=2, swordsmen=1, cavalry=0),
        kitShare=0, veterancy=1, wall=dict(level=6, health=100), reinforced=False, bastion=0, towers=1, ballistae=0, bolts=0,
        hallHealth=100, dragon=dict(alive=True, level=2, health=70, favor=60, reserve=15, stance="guard", buff=False),
        heroes=[], stocks=dict(grain=40, food=40, timber=40, stone=40), l2Grace=False)
    snap.update(changes)
    return snap


def final_snapshot(seed, kind, **changes):
    snap = snapshot(seed=seed, day=420, level=4, wave=3, invasionType=kind,
                    army=dict(spearmen=4, archers=4, swordsmen=3, cavalry=3), gear=dict(spearmen=4, archers=4, swordsmen=4, cavalry=4),
                    kitShare=.33, veterancy=3, wall=dict(level=10, health=100), towers=1, ballistae=1, bolts=5,
                    dragon=dict(alive=True, level=2, health=78, favor=70, reserve=25, stance="guard", buff=False))
    snap.update(changes)
    return snap


class EngineFiles(unittest.TestCase):
    def test_engine_and_config_are_pinned(self):
        self.assertEqual(sha256("dv_engine.py"), ENGINE_SHA256, "dv_engine.py changed: review the change, then update the pin")
        self.assertEqual(sha256("run10.json"), CONFIG_SHA256, "run10.json changed: review the change, then update the pin")

    def test_engine_version(self):
        self.assertEqual(json.loads(json.dumps(resolve_encounter(snapshot())))["engine"], "3.2h-trial")


class Adapter(unittest.TestCase):
    def test_same_snapshot_same_result(self):
        self.assertEqual(resolve_encounter(snapshot()), resolve_encounter(snapshot()))

    def test_result_is_json_safe(self):
        json.dumps(resolve_encounter(final_snapshot(3, "wyrm")), allow_nan=False)

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            resolve_encounter(snapshot(level=7))
        with self.assertRaises(ValueError):
            resolve_encounter("not a snapshot")

    def test_army_split_matches_engine_without_heroes(self):
        run, _ = cb.build_run(snapshot())
        base = cb.Run.army_split(run, 0, 1.0, True, .5)
        self.assertEqual(CampaignRun.army_split(run, 0, 1.0, True, .5), base)

    def test_destroyed_walls_are_reported(self):
        results = [resolve_encounter(snapshot(seed=s, level=4, day=500, army={}, wall=dict(level=1, health=20),
                                              dragon=dict(alive=False, level=1, health=0, favor=0, reserve=0, stance="guard")))
                   for s in range(20)]
        self.assertTrue(any(r["wallDestroyed"] for r in results))
        for r in results:
            if r["wallDestroyed"]:
                self.assertEqual(r["wallAfter"], 0)


class StallRule(unittest.TestCase):
    def test_finished_battles_pass_through(self):
        self.assertEqual(settle_stall("won", 5, 70, 70), ("won", None))

    def test_idle_deadlock_is_held(self):
        status, why = settle_stall("stall", 120, 70, 70)
        self.assertEqual(status, "held")
        self.assertIn("neither side", why)

    def test_town_under_attack_at_block_end_is_defeat(self):
        self.assertEqual(settle_stall("stall", BLOCK, 70, 40)[0], "defeat")

    def test_block_end_without_town_damage_is_held(self):
        self.assertEqual(settle_stall("stall", BLOCK, 70, 70)[0], "held")

    def test_no_stall_status_reaches_the_game(self):
        for s in range(40):
            self.assertIn(resolve_encounter(final_snapshot(s, ("horde", "siege", "wyrm")[s % 3]))["status"], ("won", "held", "defeat"))


class SafetyNet(unittest.TestCase):
    def test_level_one_town_center_never_falls(self):
        for s in range(30):
            r = resolve_encounter(snapshot(seed=s, level=1, day=60, army={}, wall=dict(level=0, health=100), towers=0,
                                           dragon=dict(alive=False, level=1, health=0, favor=0, reserve=0, stance="guard")))
            self.assertEqual(r["status"], "won")
            self.assertGreaterEqual(r["hallAfter"], 1)

    def test_level_two_can_fall(self):
        statuses = {resolve_encounter(snapshot(seed=s, level=2, day=400, army={}, wall=dict(level=0, health=100), towers=0,
                                               dragon=dict(alive=False, level=1, health=0, favor=0, reserve=0, stance="guard")))["status"]
                    for s in range(30)}
        self.assertIn("defeat", statuses)


class HeroSpecialties(unittest.TestCase):
    """GAME-FIX-1 A4: each battle specialty moves its own target by about +10% (or 15% loss reduction)."""

    def hero(self, name, mode="fortifications", trait=1):
        return dict(specialty=name, mode=mode, level=1, trait=trait, health=14)

    def test_archer_and_infantry_damage(self):
        for name, index in (("Archer damage", 1), ("Infantry damage", 0), ("Infantry damage", 2)):
            run, _ = cb.build_run(snapshot(heroes=[self.hero(name)]))
            self.assertAlmostEqual(run.type_mult[index], 1.10)
            untouched = [i for i in range(4) if run.type_mult[i] == 1.0]
            self.assertTrue(untouched)

    def test_strong_bonus_trait(self):
        run, _ = cb.build_run(snapshot(heroes=[self.hero("Archer damage", trait=0)]))
        self.assertAlmostEqual(run.type_mult[1], 1.15)

    def test_counter_fire(self):
        run, _ = cb.build_run(snapshot(heroes=[self.hero("Counter-fire")]))
        self.assertAlmostEqual(run.c["TOWER_FIRE"], cb.CONFIG["TOWER_FIRE"] * 1.1)
        self.assertAlmostEqual(run.c["WALL_FIRE"], .075 * 1.1)

    def test_guardian_strength(self):
        run, _ = cb.build_run(snapshot(heroes=[self.hero("Guardian strength")]))
        self.assertAlmostEqual(run.c["DPOW_TABLE"][1], 12 * 1.1)

    def test_wall_defense(self):
        plain, _ = cb.build_run(snapshot())
        guarded, _ = cb.build_run(snapshot(heroes=[self.hero("Wall defense")]))
        self.assertAlmostEqual(guarded.fort * cb.WALL_DEFENSE, plain.fort)

    def test_infantry_defense_saves_soldiers(self):
        def losses(heroes):
            total = 0
            for s in range(60):
                r = resolve_encounter(snapshot(seed=s, level=4, day=520, wall=dict(level=3, health=60), heroes=heroes,
                                               army=dict(spearmen=8, archers=0, swordsmen=6, cavalry=0)))
                total += r["casualties"]["spearmen"] + r["casualties"]["swordsmen"]
            return total
        plain, guarded = losses([]), losses([self.hero("Infantry defense")])
        self.assertGreater(plain, 0)
        self.assertLess(guarded, plain)

    def test_scouting_hero_reaches_the_engine(self):
        run, _ = cb.build_run(snapshot(heroes=[self.hero("Scouting")]))
        self.assertIn("scouting", run.hero_names)


class Counters(unittest.TestCase):
    """Each invasion type is countered by its own defense (run 10 counter model)."""

    COUNTERED = {"horde": dict(towers=4), "siege": dict(reinforced=True), "wyrm": dict(ballistae=3, bolts=30)}

    def test_counter_fraction(self):
        for kind, counter in self.COUNTERED.items():
            self.assertEqual(resolve_encounter(final_snapshot(1, kind, **counter))["counter"], 1)
            self.assertLess(resolve_encounter(final_snapshot(1, kind, towers=0, ballistae=0, bolts=0))["counter"], 1)

    def test_countered_village_wins_more(self):
        for kind, counter in self.COUNTERED.items():
            def wins(extra):
                return sum(resolve_encounter(final_snapshot(s, kind, **extra))["status"] != "defeat" for s in range(60))
            uncountered = wins(dict(towers=0, ballistae=0, bolts=0))
            self.assertGreater(wins(counter), uncountered, kind)


class FirstRaid(unittest.TestCase):
    """GAME-FIX-1 A5: an unprepared village loses something; a prepared one holds."""

    STOCKS = {"grain": 40, "provisions": 30, "timber": 20, "stone": 20}

    @classmethod
    def setUpClass(cls):
        # first_raid.py uses a relative import, as in the browser worker: load it inside a package
        import importlib.util
        import types
        package = types.ModuleType("eh_test_pkg")
        package.__path__ = [str(ROOT)]
        sys.modules["eh_test_pkg"] = package
        spec = importlib.util.spec_from_file_location("eh_test_pkg.first_raid", ROOT / "first_raid.py")
        cls.fr = importlib.util.module_from_spec(spec)
        sys.modules["eh_test_pkg.first_raid"] = cls.fr
        spec.loader.exec_module(cls.fr)

    def raid(self, seed, defenders, rallied, **extra):
        payload = dict(seed=seed, day=36, defenders=defenders, rallied=rallied, wallHealth=100, stocks=dict(self.STOCKS))
        payload.update(extra)
        return self.fr.resolve_first_raid(payload)

    def test_preparation_shows(self):
        n = 300
        unprepared = [self.raid(s, 0, False) for s in range(n)]
        prepared = [self.raid(s, 5, True) for s in range(n)]
        plundered = sum(sum(r["plunder"].values()) > 0 for r in unprepared) / n
        held = sum(r["wallAfter"] >= 85 for r in prepared) / n
        untouched = sum(sum(r["plunder"].values()) == 0 for r in prepared) / n
        self.assertGreaterEqual(plundered, .80, f"unprepared villages plundered in {plundered:.0%}")
        self.assertGreaterEqual(held, .90, f"prepared walls held at 85%+ in {held:.0%}")
        self.assertGreaterEqual(untouched, .95, f"prepared villages untouched in {untouched:.0%}")

    def test_town_center_never_falls_at_level_one(self):
        for s in range(40):
            r = self.raid(s, 0, False, wallHealth=0, dragonHealth=5)
            self.assertEqual(r["status"], "won")
            self.assertTrue(r["breached"])


if __name__ == "__main__":
    unittest.main()
