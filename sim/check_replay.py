#!/usr/bin/env python3
"""Reproduce the 2024 course-DUT failure signatures with the open reference DUT.

Runs tb/calc1/calc1_replay_2024.v on Icarus Verilog (4-state) with the matching
injected bug and diffs every result against the 2024 Questa logs.

usage: python3 sim/check_replay.py            -> writes results/replay_2024.json
Author: Nitish Sundarraj
"""
import json
import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOGS = ROOT / "results" / "2024_questa"


def sim(bug, mode):
    with tempfile.TemporaryDirectory() as td:
        exe = pathlib.Path(td) / "replay"
        subprocess.run(["iverilog", "-g2012", f"-Pcalc1_replay_2024.BUG={bug}", "-o", str(exe),
                        str(ROOT / "rtl/calc1/calc1_top.v"), str(ROOT / "tb/calc1/calc1_replay_2024.v")],
                       check=True)
        return subprocess.run(["vvp", "-n", str(exe), f"+MODE={mode}"], capture_output=True,
                              text=True, check=True).stdout


def norm(v):
    return v.strip().lower()


def main():
    report = {}

    # ---------------------------------------------------------------- ADD
    ours = {}
    for line in sim(1, "add").splitlines():
        m = re.match(r"ADD operation result: (\w+) \+ (\w+) = (\w+)", line)
        if m:
            ours[(int(m.group(1), 16), int(m.group(2), 16))] = norm(m.group(3))
    same = diff = 0
    first_diff = None
    for line in (LOGS / "calc1_port1_add.log").read_text().splitlines():
        m = re.search(r"ADD operation result: (\w+) \+ (\w+) = (\w+)", line)
        if m:
            k = (int(m.group(1), 16), int(m.group(2), 16))
            if ours.get(k) == norm(m.group(3)):
                same += 1
            else:
                diff += 1
                first_diff = first_diff or (k, m.group(3), ours.get(k))
    report["add_bridge_bug1"] = {"compared": same + diff, "identical": same, "first_diff": first_diff}
    print(f"ADD  (BUG=1): {same}/{same + diff} results identical to the 2024 log")

    # -------------------------------------------------------------- SHIFTS
    log = (LOGS / "calc1_port1_shift.log").read_text().splitlines()
    for bug, op in ((3, "SLL"), (4, "SRL")):
        ours = {}
        for line in sim(bug, "shift").splitlines():
            m = re.match(rf"{op} (\d+) (\d+) (\S+)", line)
            if m:
                ours[(int(m.group(1)), int(m.group(2)))] = norm(m.group(3))
        same = diff = 0
        first_diff = None
        for line in log:
            m = re.search(rf"(Correct|Error) \({op}\):\s+(\d+) (?:<<|>>)\s+(\d+) =\s+(\d+)(?:, but calculator output is\s+(\S+))?", line)
            if m:
                k = (int(m.group(2)), int(m.group(3)))
                got = norm(m.group(5) or m.group(4))
                if ours.get(k) == got:
                    same += 1
                else:
                    diff += 1
                    first_diff = first_diff or (k, got, ours.get(k))
        report[f"{op.lower()}_bug{bug}"] = {"compared": same + diff, "identical": same, "first_diff": first_diff}
        print(f"{op}  (BUG={bug}): {same}/{same + diff} results identical to the 2024 log")

    (ROOT / "results" / "replay_2024.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
