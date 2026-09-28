#!/usr/bin/env python3
"""Mine the 2024 Questa logs (course DUT, encrypted) for failure signatures.

Inputs : results/2024_questa/*.log   (raw transcripts from the 2024 campaign)
Outputs: results/2024_findings.json  and  docs/data/findings2024.json

The goal is root-cause *inference*: every conclusion printed here is backed by
a statistic computed from the log, e.g. "X appears iff op2 bit4 != op2 bit5
(n/n samples)".

Author: Nitish Sundarraj
"""
import json
import pathlib
import re
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOGS = ROOT / "results" / "2024_questa"


def bit(v, i):
    return (v >> i) & 1


def analyze_add():
    rows = []
    totals = {}
    for line in (LOGS / "calc1_port1_add.log").read_text().splitlines():
        m = re.search(r"result: (\w+) \+ (\w+) = (\w+)", line)
        if m:
            a, b, r = int(m.group(1), 16), int(m.group(2), 16), m.group(3)
            rows.append({"a": a, "b": b, "out": r, "x": "x" in r.lower()})
        m = re.search(r"(Correct|Error) results:\s+(\d+)", line)
        if m:
            totals[m.group(1).lower()] = int(m.group(2))
    # hypothesis test: X  <=>  op2 bit4 != op2 bit5
    agree = sum(1 for r in rows if r["x"] == (bit(r["b"], 4) != bit(r["b"], 5)))
    # which hex digit carries the X (from the right, 1-based)
    xpos = Counter(len(r["out"]) - r["out"].lower().find("x") for r in rows if r["x"])
    # the non-X digits always match the true sum?
    clean = all(all(y == "x" or x == y for x, y in zip("%08x" % (r["a"] + r["b"]), r["out"].lower()))
                for r in rows)
    # compact grid for the website: for each a, a string over b (1 = X)
    grid = {}
    for r in rows:
        grid.setdefault(r["a"], {})[r["b"]] = 1 if r["x"] else 0
    grid_rows = []
    for a in sorted(grid):
        bs = grid[a]
        lo, hi = min(bs), max(bs)
        grid_rows.append({"a": a, "b0": lo, "bits": "".join(str(bs.get(b, 9)) for b in range(lo, hi + 1))})
    return {
        "samples_in_log": len(rows),
        "x_results_in_log": sum(r["x"] for r in rows),
        "campaign_totals": totals,          # printed by the 2024 TB at the end
        "hypothesis": "X  <=>  operand2 bit4 != operand2 bit5  (LSB = bit 0)",
        "hypothesis_agreement": [agree, len(rows)],
        "x_hex_digit_from_right": dict(xpos),
        "non_x_digits_correct": clean,
        "grid": grid_rows,
        "examples": [r for r in rows if r["x"]][:6] + [r for r in rows if not r["x"]][:3],
    }


def analyze_sub():
    cells = []
    totals = {}
    for line in (LOGS / "calc1_port1_sub.log").read_text().splitlines():
        m = re.search(r"(Error|Correct) \(SUB\):\s+(\d+) -\s+(\d+) =\s+(\d+)(?:, but calculator output is\s+(\S+))?", line)
        if m:
            kind, a, b, exp, got = m.groups()
            cells.append({"a": int(a), "b": int(b), "exp": int(exp), "got": got if got else exp, "ok": kind == "Correct"})
        m = re.search(r"(Correct results|Error results|Underflow results|No Response):\s+(\d+)", line)
        if m:
            totals[m.group(1)] = int(m.group(2))
    got_values = Counter(c["got"] for c in cells if not c["ok"])
    return {"cells": cells, "totals": totals, "wrong_output_values": dict(got_values),
            "underflow_cases": sum(1 for c in cells if c["b"] > c["a"]),
            "only_correct_when_equal": all((c["a"] == c["b"]) == c["ok"] for c in cells)}


def analyze_shift():
    cells = []
    totals = {}
    for line in (LOGS / "calc1_port1_shift.log").read_text().splitlines():
        m = re.search(r"(Error|Correct) \((SLL|SRL)\):\s+(\d+) (<<|>>)\s+(\d+) =\s+(\d+)(?:, but calculator output is\s+(\S+))?", line)
        if m:
            kind, op, a, _, s, exp, got = m.groups()
            cells.append({"op": op, "a": int(a), "s": int(s), "exp": int(exp),
                          "got": got if got else exp, "ok": kind == "Correct"})
        m = re.search(r"(Correct|Error) results:\s+(\d+)", line)
        if m:
            totals[m.group(1).lower()] = int(m.group(2))
    sll_fail = [c for c in cells if c["op"] == "SLL" and not c["ok"]]
    srl_fail = [c for c in cells if c["op"] == "SRL" and not c["ok"]]
    return {
        "cells": cells, "totals": totals,
        "sll_fail_shift_amounts": sorted({c["s"] for c in sll_fail}),
        "sll_fail_outputs": sorted({c["got"] for c in sll_fail}),
        "srl_fail_shift_amounts": sorted({c["s"] for c in srl_fail}),
        "srl_by0_returns_zero": all(c["got"] == "0" for c in srl_fail if c["s"] == 0),
        "srl_by1_returns_operand": all(int(c["got"]) == c["a"] for c in srl_fail if c["s"] == 1),
        "sll_zero_operand_ok": all(c["ok"] for c in cells if c["op"] == "SLL" and c["a"] == 0),
    }


def analyze_calc3():
    txt = (LOGS / "calc3_env_run.log").read_text()
    mism = re.findall(r"ERROR: Mismatch detected at Port (\d)\n# Port \d Checked Values:\n#\s+Expected Data: (\d+), Actual Data: (\d+)\n#\s+Expected Response: (\d+), Actual Response: (\d+)\n#\s+Expected Tag: (\d+), Actual Tag: (\d+)", txt)
    corr = re.findall(r"CORRECT: Outputs are matching at Port (\d)\n# Port \d Checked Values:\n#\s+Expected Data: (\d+)", txt)
    kinds = Counter()
    for _, ed, ad, er, ar, et, at in mism:
        k = []
        if ed != ad: k.append("data")
        if er != ar: k.append("resp")
        if et != at: k.append("tag")
        kinds["+".join(k) or "none"] += 1
    totals = re.findall(r"Total correct outputs: (\d+), Total errors detected: (\d+)", txt)
    stale = sum(1 for p, d in corr if p != "1" and d == "703")
    per_check = len(re.findall(r"Total correct outputs", txt))
    return {
        "final_counters": {"correct": int(totals[-1][0]), "errors": int(totals[-1][1])} if totals else {},
        "log_excerpt_checks": per_check,
        "mismatch_kinds_in_excerpt": dict(kinds),
        "ports_compared_per_response": 4,
        "stale_port_matches": stale,
        "stale_value": 703,
        "note": ("Every DUT response triggered a comparison on ALL FOUR ports; ports 2-4 kept "
                 "re-matching the same stale value (703), inflating 'CORRECT' counts, while the "
                 "port that actually responded was compared against expected values from an array "
                 "indexed with ports[i-1] (off by one).")
    }


def main():
    out = {"calc1_add": analyze_add(), "calc1_sub": analyze_sub(),
           "calc1_shift": analyze_shift(), "calc3": analyze_calc3()}
    a = out["calc1_add"]
    print(f"ADD : {a['x_results_in_log']}/{a['samples_in_log']} X results in excerpt; "
          f"hypothesis '{a['hypothesis']}' agrees on {a['hypothesis_agreement'][0]}/{a['hypothesis_agreement'][1]}; "
          f"campaign totals {a['campaign_totals']}")
    s = out["calc1_sub"]
    print(f"SUB : totals {s['totals']}; correct only when a==b: {s['only_correct_when_equal']}; wrong outputs {s['wrong_output_values']}")
    h = out["calc1_shift"]
    print(f"SHIFT: SLL fails at amounts {h['sll_fail_shift_amounts']} -> {h['sll_fail_outputs']}; "
          f"SRL fails at {h['srl_fail_shift_amounts']} (by0->0: {h['srl_by0_returns_zero']}, by1->operand: {h['srl_by1_returns_operand']})")
    c = out["calc3"]
    print(f"CALC3: final counters {c['final_counters']}; mismatch kinds {c['mismatch_kinds_in_excerpt']}; stale matches {c['stale_port_matches']}")
    (ROOT / "results" / "2024_findings.json").write_text(json.dumps(out, indent=1))
    web = ROOT / "docs" / "data"
    web.mkdir(parents=True, exist_ok=True)
    (web / "findings2024.json").write_text(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
