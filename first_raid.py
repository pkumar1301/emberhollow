"""Connect the interactive Level 1 village to the Run 10 combat engine."""
import json
from pathlib import Path
import math

from .dv_engine import Run, VERSION

CONFIG = json.loads(Path(__file__).with_name("run10.json").read_text())
RESOURCE_KEYS = {"grain": "grain", "provisions": "food", "timber": "timber", "stone": "stone"}
RAID_DAY = 36
# A repeatable tutorial encounter with visible consequences for Guard and Rally (GAME-FIX-1 A5).
# The tutorial narrows the raid's random spread so one lesson is not undone by a lucky or unlucky draw.
TUTORIAL_DIFFICULTY = 4.7
TUTORIAL_SPREAD = (0.9, 1.1)
# Level 1 breach: raiders who push the wall below this share carry off stores above the protected reserve.
BREACH_WALL = 75
BREACH_PLUNDER = 0.10
PROTECTED = {"grain": 10, "provisions": 10, "timber": 8, "stone": 8}


def checked_number(payload, name, minimum, maximum, *, integer=False):
    value = payload.get(name)
    if type(value) not in (int, float) or not minimum <= value <= maximum:
        raise ValueError(f"Invalid {name}")
    if integer and type(value) is not int:
        raise ValueError(f"Invalid {name}")
    return value


def tutorial_run(seed):
    run = Run(seed, {"walls": True, "gear": False, "dragon": 1}, dict(CONFIG, SPREAD=TUTORIAL_SPREAD))
    run.day = RAID_DAY
    run.difficulty = TUTORIAL_DIFFICULTY
    return run


def scout_first_raid(payload):
    if not isinstance(payload, dict):
        raise ValueError("A village snapshot is required")
    seed = checked_number(payload, "seed", 0, 2**32 - 1, integer=True)
    return {"attackerStrength": tutorial_run(seed).setup_encounter(False, False)[0]}


def resolve_first_raid(payload, compare=False):
    if not isinstance(payload, dict):
        raise ValueError("A village snapshot is required")
    tutorial = payload.get("tutorial", False)
    if type(tutorial) is not bool:
        raise ValueError("Invalid tutorial flag")
    day = checked_number(payload, "day", 1 if tutorial else RAID_DAY, 10000 if tutorial else RAID_DAY, integer=True)
    seed = checked_number(payload, "seed", 0, 2**32 - 1, integer=True)
    defenders = checked_number(payload, "defenders", 0, 5, integer=True)
    wall = checked_number(payload, "wallHealth", 0, 100)
    rally = payload.get("rallied")
    if type(rally) is not bool:
        raise ValueError("Invalid rallied flag")
    stocks = payload.get("stocks")
    if not isinstance(stocks, dict):
        raise ValueError("Resource stocks are required")
    starting = {label: checked_number(stocks, label, 0, 10000) for label in RESOURCE_KEYS}

    run = tutorial_run(seed)
    run.hp = checked_number({"dragonHealth": 60, **payload}, "dragonHealth", 0, run.dmax())
    run.favor = checked_number({"dragonFavor": 65, **payload}, "dragonFavor", 0, 100)
    wall_capacity = run.fort
    run.fort = wall_capacity * wall / 100
    run.soldiers = [[0, 0, day - 1, day - 1] for _ in range(defenders)]
    run.buff_until = day if rally else 0
    run.log_rounds = True
    for label, key in RESOURCE_KEYS.items():
        run.s[key] = starting[label]

    # Preserve the tuned first-raid strength while the narrative calendar follows the player.
    run.day = RAID_DAY
    encounter = run.setup_encounter(False, False)
    run.day = day
    run.force = encounter  # Reuse the drawn encounter without advancing the random streams twice.
    dragon_before = run.hp
    status = run.fight(False, False)
    safety_net = False
    if status == "defeat":
        # Level 1 safety net (brief 4.5): the Town Center cannot fall below 1 health. The raiders take stores and leave.
        status, safety_net = "won", True
        run.town = max(run.town, 1)
        run.cause = None
    wall_after = min(100, math.floor(run.fort / wall_capacity * 100 + 0.5))
    breached = safety_net or wall_after < BREACH_WALL
    if breached:
        for label, key in RESOURCE_KEYS.items():
            run.s[key] -= max(0, run.s[key] - PROTECTED[label]) * BREACH_PLUNDER
    remaining = {label: run.s[key] for label, key in RESOURCE_KEYS.items()}
    plunder = {label: max(0, starting[label] - remaining[label]) for label in RESOURCE_KEYS}
    rounds = [{
        "round": log["round"],
        "spearmen": log["soldiers>field"],
        "dragonPower": log["dragon>field"],
        "wall": log["walls>field"],
        "incoming": log["incoming"],
        "dragonDamage": log["dragon>field_rolled"],
        "enemyBefore": log["enemy_before"],
        "enemyAfter": log["enemy_after"],
        "damage": log["field_damage"],
    } for log in run.report]
    result = {
        "engine": VERSION, "seed": seed, "day": day, "status": status,
        "attackerStrength": encounter[0], "retreatAt": encounter[0] * (1 - 0.4), "spearmen": defenders,
        "casualties": defenders - run.army(),
        "dragonBefore": dragon_before, "dragonAfter": run.hp, "dragonMax": run.dmax(),
        "wallBefore": wall, "wallAfter": wall_after, "breached": breached, "safetyNet": safety_net,
        "offered": rally, "stocks": remaining, "plunder": plunder, "rounds": rounds,
        "cause": run.cause,
    }
    if compare:
        unprepared = resolve_first_raid(dict(payload, defenders=0, rallied=False))
        result["unprepared"] = {
            key: unprepared[key] for key in ("status", "wallAfter", "dragonAfter", "plunder")
        }
        result["unprepared"]["rounds"] = len(unprepared["rounds"])
    return result
