"""Resolve Emberhollow campaign battles with the frozen run 10 rules in dv_engine.

The engine file itself is never edited. Campaign-only rules live here:
- hero specialties (GAME-FIX-1 A4), applied through a Run subclass and per-battle settings;
- dragon stance (Hunt and Rest);
- the Level 1 safety net (brief 4.5) and the stall rule (GAME-FIX-1 A3).

resolve_encounter(snapshot) takes a JSON-safe dict built by campaign-engine.js and returns a JSON-safe dict.
"""
import json
import math
import random
from pathlib import Path

try:  # package import inside the browser worker, plain import in tests
    from .dv_engine import Run, VERSION, soldier_power
except ImportError:  # pragma: no cover
    from dv_engine import Run, VERSION, soldier_power

CONFIG = json.loads(Path(__file__).with_name("run10.json").read_text())
UNITS = ("spearmen", "archers", "swordsmen", "cavalry")
INFANTRY = (0, 2)
TYPES = ("horde", "siege", "wyrm")
STOCK_KEYS = ("grain", "food", "timber", "stone")
HERO_BONUS = 0.10          # +10% in the hero's own area
STRONG_BONUS = 0.15        # the "Strong bonus" trait
INFANTRY_SAVE = 0.15       # Infantry defense: share of infantry losses that recover
WALL_DEFENSE = 0.85        # Wall defense: walls take 85% of the damage
HUNT_POWER, HUNT_INJURY = 1.15, 1.25
TOWN_SCALE = 0.7           # engine Town Center health 70 = campaign 100
BLOCK = 4000               # rounds per block before the stall rule decides


def wall_capacity(level, reinforced, bastion):
    """Engine wall strength for a campaign wall level (engine caps are 40/62/84/106 at stages 1-4)."""
    if level <= 0:
        return 0.0
    return (18 + 8.8 * level) * (1.3 if reinforced else 1.0) + 6.0 * bastion


def hero_bonus(hero):
    return STRONG_BONUS if hero.get("trait") == 0 else HERO_BONUS


class CampaignRun(Run):
    """Run with the campaign's per-type hero multipliers and dragon stance."""

    type_mult = (1.0, 1.0, 1.0, 1.0)
    resting = False
    encounter = None

    def setup_encounter(self, final, evil):
        enemy, boss, kind, scout, mobilized, choice, fortune = super().setup_encounter(final, evil)
        if self.resting and not evil:
            mobilized = False
        self.encounter = (enemy, boss, kind, scout, mobilized, choice, fortune)
        return self.encounter

    def army_split(self, kind, choice, boss_alive, focus):
        """Same as Run.army_split, with a per-type multiplier for the Archer and Infantry damage heroes."""
        c = self.c
        field = boss = 0.0
        mult = (1 + self.vet * .02) * choice * (1 + self.defense_bonus)
        if c['PARTIAL_KIT']:
            elig = sum(1 for sd in self.soldiers if self.tier_of(sd) >= c['KIT_TIER'])
            kits = round((self.kit_frac or 0) * elig)
            seen = 0
        for sd in self.soldiers:
            t = self.tier_of(sd)
            gm = 1 + (sum(c['GEAR_TABLE'][:t]) if c['DR'] else c['GEAR_TIER'] * t)
            pw = (soldier_power(sd[0]) + c['B6_POWER'] * 1.4) * (1.3 if sd[0] == kind else 1) * gm * mult * self.type_mult[sd[0]]
            if c['PARTIAL_KIT']:
                ad = t >= c['KIT_TIER'] and seen < kits
                seen += int(t >= c['KIT_TIER'])
            else:
                ad = self.p['anti_dragon_gear'] and t >= 4
            if boss_alive:
                share = (c['AD_SHARE'] if ad else (0.0 if c['AD_ONLY'] else c['PLAIN_SHARE'])) * focus
                boss += pw * share
                field += pw * (1 - share) * (c['AD_ARMY'] if ad else 1)
            else:
                field += pw * (c['AD_ARMY'] if ad else 1)
        return field, boss


def _num(payload, name, lo, hi, default=None):
    value = payload.get(name, default)
    if type(value) not in (int, float) or isinstance(value, bool) or not (lo <= value <= hi) or math.isnan(value):
        raise ValueError(f"Invalid {name}")
    return value


def _kit_right_share(variant, has_dragon):
    c = CONFIG
    table = c.get('KIT_RIGHT_NODRAGON') if not has_dragon else None
    table = table or {'horde': .33, 'wyrm': .5, 'siege': .33}
    return table[variant]


def build_run(snap):
    """Create a CampaignRun that mirrors the campaign state in the snapshot."""
    level = int(_num(snap, "level", 1, 4))
    day = int(_num(snap, "day", 1, 100000))
    wave = int(_num(snap, "wave", 0, 3))
    seed = int(_num(snap, "seed", 0, 2**32 - 1))
    heroes = snap.get("heroes", [])
    specialties = {h["specialty"]: h for h in heroes}
    dragon = snap["dragon"]
    alive = bool(dragon.get("alive"))

    cfg = dict(CONFIG)
    if "Counter-fire" in specialties:
        b = 1 + hero_bonus(specialties["Counter-fire"])
        cfg['TOWER_FIRE'] = CONFIG['TOWER_FIRE'] * b
        cfg['WALL_FIRE'] = .075 * b
        cfg['WALL_FIRE_CAP'] = 6.0 * b
    dpow = [8, 12, 15, 17]
    gs = 1 + (hero_bonus(specialties["Guardian strength"]) if "Guardian strength" in specialties else 0)
    hunt = HUNT_POWER if dragon.get("stance") == "hunt" else 1
    cfg['DPOW_TABLE'] = [v * gs * hunt for v in dpow]

    has_dragon = alive and dragon.get("level", 0) > 0
    profile = {"walls": snap["wall"]["level"] > 0, "gear": any(snap["gear"].get(u, 0) > 0 for u in UNITS),
               "dragon": int(dragon.get("level", 0)) if has_dragon else 0}
    run = CampaignRun(seed, profile, cfg)
    run.day = day
    run.stage = level
    run.level = max(1, int(dragon.get("level", 1)))
    run.hp = float(dragon.get("health", 0)) if alive else 0.0
    run.favor = float(dragon.get("favor", 0)) if alive else 0.0
    reserve = float(dragon.get("reserve", 0)) / 25.0
    run.reserves = {k: reserve * (18 + 4 * run.level) for k in ("food", "livestock", "herbs")}
    run.buff_until = day if dragon.get("buff") else 0
    run.resting = dragon.get("stance") == "rest" and alive
    run.hoard = 0.0

    # army: oldest first, every soldier carries its type's equipment tier
    run.soldiers = []
    for i, unit in enumerate(UNITS):
        tier = int(snap["gear"].get(unit, 0))
        for n in range(int(snap["army"].get(unit, 0))):
            run.soldiers.append([i, tier, n, n])
    run.people = len(run.soldiers) + 10
    run.vet = int(_num(snap, "veterancy", 0, 3, 0))
    run.kit_frac = float(_num(snap, "kitShare", 0, 1, 0))
    mult = [1.0] * 4
    if "Archer damage" in specialties:
        mult[1] += hero_bonus(specialties["Archer damage"])
    if "Infantry damage" in specialties:
        b = hero_bonus(specialties["Infantry damage"])
        for i in INFANTRY:
            mult[i] += b
    run.type_mult = tuple(mult)

    # fortifications
    wall = snap["wall"]
    run.reinforced = bool(snap.get("reinforced"))
    cap = wall_capacity(int(wall["level"]), run.reinforced, int(snap.get("bastion", 0)))
    real_fort = cap * float(wall["health"]) / 100.0
    run.wall_scale = WALL_DEFENSE if "Wall defense" in specialties else 1.0
    run.fort = real_fort / run.wall_scale
    run.towers = int(snap.get("towers", 0)) if cap else 0
    run.ballistae = int(snap.get("ballistae", 0)) if cap else 0
    run.bolts = float(snap.get("bolts", 0))
    run.plan = 'balanced' if run.towers >= 2 and run.ballistae >= 2 else 'none'
    run.town = float(snap["hallHealth"]) * TOWN_SCALE

    # heroes: fortification heroes fire, engaged heroes count double
    run.heroes = sum(1 for h in heroes if h["mode"] == "fortifications") + 2 * sum(1 for h in heroes if h["mode"] == "engage")
    run.hero_names = ["scouting"] if "Scouting" in specialties else []

    # invasion: one type for all three waves, decided by the campaign
    final = wave > 0
    if final:
        run.variant = snap["invasionType"]
        right = _kit_right_share(run.variant, has_dragon)
        run.kit_right = abs(run.kit_frac - right) <= CONFIG.get('KIT_TOL', .08)
    run.flier = float(_num(snap, "flier", 0, 1, 0)) if not final else 0.0
    run.l2_grace = bool(snap.get("l2Grace", False))
    for k in STOCK_KEYS:
        run.s[k] = float(snap["stocks"].get(k, 0))
    run.difficulty = float(_num(snap, "difficulty", 0.1, 10, .95))
    run.log_rounds = True
    meta = dict(cap=cap, real_fort=real_fort, final=final, evil=wave == 3, specialties=specialties, has_dragon=has_dragon)
    return run, meta


def resolve_encounter(snap):
    if not isinstance(snap, dict):
        raise ValueError("A campaign snapshot is required")
    run, meta = build_run(snap)
    final, evil = meta["final"], meta["evil"]
    level = run.stage
    run.c['HARD_CAP'] = BLOCK
    town0, hp0, fort0 = run.town, run.hp, run.fort
    stocks0 = {k: run.s[k] for k in STOCK_KEYS}
    before = [sd[0] for sd in run.soldiers]
    civ0, lost0 = run.civ, run.lost_levels
    status = run.fight(final, evil)
    enemy, boss = run.encounter[0], run.encounter[1]
    rounds = len(run.report)
    deadlock = None

    status, deadlock = settle_stall(status, rounds, town0, run.town)
    if deadlock and status == "defeat":
        run.town = 0.0
        run.cause = "Town Center destroyed"
    elif deadlock:
        run.cause = None

    breach_l1 = False
    if level == 1 and status == "defeat":
        # Level 1 safety net (brief 4.5): the Town Center cannot fall below 1 health.
        breach_l1 = True
        status = "won"
        run.town = TOWN_SCALE
        for k in STOCK_KEYS:
            take = max(0.0, run.s[k] - run.c['RESERVE'][k]) * .20
            run.s[k] -= take

    # casualties by type
    after = [sd[0] for sd in run.soldiers]
    lost = [before.count(i) - after.count(i) for i in range(4)]
    if "Infantry defense" in meta["specialties"]:
        rng = random.Random(run.seed + 1440000 + run.day)
        save = INFANTRY_SAVE * (1 + (.5 if meta["specialties"]["Infantry defense"].get("trait") == 0 else 0))
        for i in INFANTRY:
            back = sum(1 for _ in range(lost[i]) if rng.random() < save)
            lost[i] -= back

    real_fort_after = run.fort * run.wall_scale
    destroyed = meta["cap"] > 0 and run.fort <= 0
    wall_after = 0.0 if destroyed or not meta["cap"] else min(100.0, 100.0 * real_fort_after / meta["cap"])
    hp_after = run.hp
    if run.resting is False and hp_after < hp0 and snap["dragon"].get("stance") == "hunt":
        hp_after = max(0.0, hp0 - (hp0 - hp_after) * HUNT_INJURY)
    incoming_total = sum(r.get("incoming", 0) for r in run.report)
    hero_damage = []
    for h in snap.get("heroes", []):
        exposed = h["mode"] == "engage" or (h["mode"] == "fortifications" and destroyed)
        hero_damage.append(round(incoming_total * (.04 if h["mode"] == "engage" else .02), 3) if exposed else 0)

    boss_left = boss
    log = []
    for r in run.report:
        boss_left = max(0.0, boss_left - r.get("ballista>boss", 0) - r.get("dragon>boss", 0) - r.get("soldiers>boss", 0))
        log.append({"round": r["round"], "field": round(r.get("enemy_after", 0), 2), "boss": round(boss_left, 2),
                    "incoming": round(r.get("incoming", 0), 2), "damage": round(r.get("field_damage", 0), 2)})
    if status in ("won", "held") and log:
        log[-1]["boss"] = 0.0

    plunder = {k: round(max(0.0, stocks0[k] - run.s[k]), 3) for k in STOCK_KEYS}
    return {
        "engine": VERSION, "status": status, "deadlock": deadlock, "cause": run.cause,
        "enemy": round(enemy, 3), "boss": round(boss, 3), "rounds": log,
        "casualties": {u: lost[i] for i, u in enumerate(UNITS)},
        "wallAfter": round(wall_after, 3), "wallDestroyed": bool(destroyed),
        "hallAfter": round(max(0.0, min(100.0, run.town / TOWN_SCALE)), 3),
        "dragonAfter": round(hp_after, 3), "boltsAfter": round(run.bolts, 3),
        "stocks": {k: round(run.s[k], 3) for k in STOCK_KEYS}, "plunder": plunder,
        "civDamage": round(run.civ - civ0, 3), "levelsLost": int(run.lost_levels - lost0), "l2Grace": run.l2_grace,
        "breached": bool(breach_l1 or plunder_taken(plunder) or run.lost_levels > lost0),
        "safetyNet": breach_l1, "heroDamage": hero_damage,
        "counter": run.counter, "kitRight": run.kit_right if final else None,
        "duel": run.duel["winner"] if (evil and run.duel) else None,
        "bossKilledBy": run.boss_killed_by if evil else None,
    }


def settle_stall(status, rounds, town_before, town_after):
    """GAME-FIX-1 A3: turn an engine stall into a result, so the player is never left on an unresolved battle.

    The engine stalls in two ways: nothing changed for ROUND_LIMIT rounds (idle), or the battle ran a full block.
    If the Town Center was still losing health, the enemy can reach it: the battle ends as a defeat.
    Otherwise neither side can finish the other and the village holds.
    """
    if status != "stall":
        return status, None
    idle = rounds < BLOCK
    if not idle and town_after < town_before - 1e-6:
        return "defeat", "the Town Center was still under attack when the battle limit was reached"
    return "held", ("neither side could damage the other" if idle else "the attackers could not reach the Town Center")


def plunder_taken(plunder):
    return any(v > 1e-6 for v in plunder.values())
