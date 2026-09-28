#!/usr/bin/env python3
"""Regression runner: golden design must PASS, every injected bug must be caught.

usage:  python3 sim/regress.py [--design calc1|calc3|all] [--seeds 1,2,3] [--jobs 2]
Requires the executables produced by sim/build.sh.  Writes results/regression.json
and prints a table.  Exit code is non-zero if the golden model fails or a bug escapes.

Author: Nitish Sundarraj
"""
import argparse
import concurrent.futures as cf
import json
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]

BUGS = {
    "calc1": {
        0: "golden (no bug)",
        1: "Port-1 adder: operand-2 bit 4 bridged to bit 5",
        2: "Port-1 SUB result stuck at 0, borrow never flagged",
        3: "SHL by 0 drives X on every set bit",
        4: "SHR by 0 returns 0, SHR by 1 does not shift",
        5: "ADD carry-out (overflow) not reported",
        6: "Port-4 request dropped when port 1 wins arbitration",
        7: "Invalid command never answered",
    },
    "calc3": {
        0: "golden (no bug)",
        1: "Back-to-back responses reuse the previous tag",
        2: "No same-cycle forwarding between ports (store->fetch)",
        3: "Skipped command still writes its destination",
        4: "Shift amount taken from d2 field instead of R[d2]",
        5: "Port-4 SUB underflow not flagged",
        6: "Port-3 writes to R15 are lost",
        7: "Branch-if-equal compares only the low 16 bits",
    },
}


def run_one(design, bug, seed, n):
    exe = ROOT / "build" / f"{design}_bug{bug}" / f"V{design}_tb_top"
    cmd = [str(exe), f"+SEED={seed}", f"+verilator+seed+{seed}", f"+N={n}"]
    t0 = time.time()
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=1800).stdout
    summary = None
    for line in out.splitlines():
        if line.startswith("@@SUMMARY "):
            summary = json.loads(line[len("@@SUMMARY "):])
    if summary is None:
        summary = {"design": design, "bug": bug, "fail": -1, "error": out[-500:]}
    summary.update(seed=seed, seconds=round(time.time() - t0, 1), description=BUGS[design][bug])
    log = ROOT / "results" / "logs" / f"{design}_bug{bug}_seed{seed}.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(out.replace(str(ROOT) + "/", ""))
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--design", default="all")
    ap.add_argument("--seeds", default="1")
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--n", type=int, default=0, help="random transactions (0 = test default)")
    a = ap.parse_args()
    designs = ["calc1", "calc3"] if a.design == "all" else [a.design]
    seeds = [int(s) for s in a.seeds.split(",")]
    jobs = [(d, b, s) for d in designs for b in BUGS[d] for s in seeds]
    n = a.n or 0
    results = []
    with cf.ThreadPoolExecutor(a.jobs) as ex:
        futs = {ex.submit(run_one, d, b, s, n if n else (2000 if d == "calc1" else 3000)): (d, b, s)
                for d, b, s in jobs}
        for f in cf.as_completed(futs):
            r = f.result()
            results.append(r)
            print(f"  done {r['design']} BUG={r['bug']} seed={r['seed']}  fail={r['fail']}  ({r['seconds']}s)",
                  flush=True)
    results.sort(key=lambda r: (r["design"], r["bug"], r["seed"]))

    ok = True
    print("\n design  bug  verdict      checked   fail  coverage  description")
    print(" ------  ---  -----------  -------  -----  --------  -----------")
    for r in results:
        if r["bug"] == 0:
            verdict = "PASS" if r["fail"] == 0 else "FALSE-FAIL"
            ok &= r["fail"] == 0
        else:
            verdict = "CAUGHT" if r["fail"] > 0 else "ESCAPED"
            ok &= r["fail"] > 0
        r["verdict"] = verdict
        print(f" {r['design']:6}  {r['bug']:3}  {verdict:11}  {r.get('checked', 0):7}  {r['fail']:5}  "
              f"{r.get('coverage', 0):7.1f}%  {r['description']}")
    out = ROOT / "results" / "regression.json"
    out.write_text(json.dumps(results, indent=1))
    print(f"\nwrote {out.relative_to(ROOT)}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
