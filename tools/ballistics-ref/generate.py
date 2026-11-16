"""Reference trajectories for src/app/core/ballistics/solver/solver.spec.ts.

py-ballisticcalc solves the same point-mass model with the same G1/G7 tables, so the
app's solver is checked against it rather than against the illustrative numbers on the
mockups.

    python3 -m venv .venv && .venv/bin/pip install 'py-ballisticcalc>=2.1'
    .venv/bin/python tools/ballistics-ref/generate.py > src/testing/ballistics-ref.json

Spin drift is off (twist 0) and the wind is compared by size only: the two programs
name wind directions differently, and the sign is tested separately.
"""

import json
from importlib.metadata import version

from py_ballisticcalc import (
    Ammo,
    Angular,
    Atmo,
    Calculator,
    Distance,
    DragModel,
    Pressure,
    Shot,
    TableG1,
    TableG7,
    Temperature,
    Unit,
    Velocity,
    Weapon,
    Weight,
    Wind,
)

CASES = [
    {"name": ".308 168 gr", "dragModel": "G7", "bc": 0.218, "v0": 795, "weightGr": 168, "diameterIn": 0.308},
    {"name": "6.5 mm 140 gr", "dragModel": "G7", "bc": 0.305, "v0": 820, "weightGr": 140, "diameterIn": 0.264},
    {"name": ".223 55 gr", "dragModel": "G1", "bc": 0.250, "v0": 990, "weightGr": 55, "diameterIn": 0.224},
]
ATMOSPHERES = [
    {"temp": 15, "pressure": 1013.25, "humidity": 0.5},
    {"temp": -10, "pressure": 1000, "humidity": 0.8},
]
SIGHT_HEIGHT_MM = 45
ZERO_M = 100
WIND = {"speed": 3, "clock": 3}
STEP_M = 50
RANGE_M = 1000


def angle(value, unit):
    return float(value >> unit)


def run(case, atmosphere):
    table = TableG7 if case["dragModel"] == "G7" else TableG1
    drag = DragModel(
        case["bc"],
        table,
        weight=Weight.Grain(case["weightGr"]),
        diameter=Distance.Inch(case["diameterIn"]),
    )
    weapon = Weapon(sight_height=Distance.Millimeter(SIGHT_HEIGHT_MM), twist=Distance.Inch(0))
    ammo = Ammo(drag, Velocity.MPS(case["v0"]))
    atmo = Atmo(
        altitude=Distance.Meter(0),
        pressure=Pressure.hPa(atmosphere["pressure"]),
        temperature=Temperature.Celsius(atmosphere["temp"]),
        humidity=atmosphere["humidity"],
    )
    calc = Calculator()
    calc.set_weapon_zero(Shot(weapon=weapon, ammo=ammo, atmo=atmo), Distance.Meter(ZERO_M))
    wind = Wind(Velocity.MPS(WIND["speed"]), Angular.OClock(WIND["clock"]))
    shot = Shot(weapon=weapon, ammo=ammo, atmo=atmo, winds=[wind])
    result = calc.fire(shot, trajectory_range=Distance.Meter(RANGE_M), trajectory_step=Distance.Meter(STEP_M))
    rows = []
    for p in result.trajectory:
        d = round(float(p.distance >> Unit.Meter), 3)
        if d < STEP_M - 1e-6:
            continue
        drop = p.drop_angle if hasattr(p, "drop_angle") else p.drop_adj
        windage = p.windage_angle if hasattr(p, "windage_angle") else p.windage_adj
        rows.append(
            {
                "d": d,
                # Below the line of sight is negative there; the app dials up positive.
                "elev": round(-angle(drop, Unit.MRad), 4) + 0.0,
                "wind": round(abs(angle(windage, Unit.MRad)), 4),
                "v": round(float(p.velocity >> Unit.MPS), 2),
                "time": round(float(p.time), 5),
            }
        )
    return rows


def main():
    cases = [
        {
            **case,
            "sightHeight": SIGHT_HEIGHT_MM,
            "zeroDist": ZERO_M,
            "atmosphere": atmosphere,
            "wind": WIND,
            "rows": run(case, atmosphere),
        }
        for case in CASES
        for atmosphere in ATMOSPHERES
    ]
    print(json.dumps({"generator": f"py-ballisticcalc {version('py-ballisticcalc')}", "cases": cases}, indent=2))


if __name__ == "__main__":
    main()
