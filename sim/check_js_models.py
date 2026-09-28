#!/usr/bin/env python3
"""Prove the website's JavaScript models are cycle-identical to the RTL.

For each design and each BUG value: generate random stimulus (including
protocol violations), run it through the Verilog RTL on Icarus and through the
JS model on Node, and diff every output of every cycle.

usage: python3 sim/check_js_models.py [--cycles 4000] [--seeds 3]
Author: Nitish Sundarraj
"""
import argparse, json, pathlib, random, subprocess, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]


def stim_calc1(rng, n):
    rows = ["7f 0 0 0 0 0 0 0 0"] * 3
    interesting = [0, 1, 2, 0x10, 0x20, 0x30, 31, 32, 0xFFFFFFFF, 0x80000000, 0xFFFFFFFE]
    for _ in range(n):
        rst = "7f" if rng.random() < 0.004 else "0"
        f = [rst]
        for _p in range(4):
            c = rng.choice([1, 2, 5, 6, 1, 2, 5, 6, 3, 7, 12]) if rng.random() < 0.35 else 0
            d = rng.choice(interesting) if rng.random() < 0.4 else rng.getrandbits(rng.choice([6, 12, 32]))
            f += [f"{c:x}", f"{d:x}"]
        rows.append(" ".join(f))
    return rows


def stim_calc3(rng, n):
    rows = ["1" + " 0 0 0 0 0 0" * 4] * 3
    for _ in range(n):
        f = ["1" if rng.random() < 0.003 else "0"]
        for _p in range(4):
            c = rng.choice([1, 2, 5, 6, 9, 9, 10, 10, 12, 13, 3, 15]) if rng.random() < 0.4 else 0
            regs = rng.choice([3, 7, 15])
            d = rng.choice([0, 1, 2, 31, 33, 0xFFFFFFFF, 0x80000000, 0x10000, 0x21234]) if rng.random() < 0.5 else rng.getrandbits(32)
            f += [f"{c:x}", f"{rng.randint(0, regs):x}", f"{rng.randint(0, regs):x}", f"{rng.randint(0, regs):x}",
                  f"{rng.randint(0, 3):x}", f"{d:x}"]
        rows.append(" ".join(f))
    return rows


def run(design, bug, rows, td):
    stim = pathlib.Path(td) / f"{design}_{bug}.stim"
    stim.write_text("\n".join(rows) + "\n")
    exe = pathlib.Path(td) / f"{design}_{bug}.vvp"
    subprocess.run(["iverilog", "-g2012", f"-P{design}_trace_tb.BUG={bug}", "-o", str(exe),
                    str(ROOT / f"rtl/{design}/{design}_top.v"), str(ROOT / f"tb/trace/{design}_trace_tb.v")], check=True)
    rtl = subprocess.run(["vvp", "-n", str(exe), f"+STIM={stim}"], capture_output=True, text=True, check=True).stdout
    js = subprocess.run(["node", str(ROOT / "sim/js_trace.js"), design, str(bug), str(stim)],
                        capture_output=True, text=True, check=True).stdout
    rtl_l = [l.strip().lower() for l in rtl.splitlines() if l.strip() and "$finish" not in l]
    js_l = [l.strip().lower() for l in js.splitlines() if l.strip()]
    mism = [(i, a, b) for i, (a, b) in enumerate(zip(rtl_l, js_l)) if a != b]
    nresp = sum(1 for l in rtl_l for v in l.split()[::(2 if design == 'calc1' else 3)] if v not in ("0", "00"))
    return len(rtl_l), len(js_l), mism, nresp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cycles", type=int, default=4000)
    ap.add_argument("--seeds", type=int, default=3)
    a = ap.parse_args()
    report, ok = [], True
    with tempfile.TemporaryDirectory() as td:
        for design, gen in (("calc1", stim_calc1), ("calc3", stim_calc3)):
            for bug in range(8):
                for seed in range(a.seeds):
                    rows = gen(random.Random(1000 * bug + seed), a.cycles)
                    n_rtl, n_js, mism, nresp = run(design, bug, rows, td)
                    good = n_rtl == n_js and not mism
                    ok &= good
                    report.append({"design": design, "bug": bug, "seed": seed, "cycles": n_rtl,
                                   "responses": nresp, "mismatches": len(mism), "first": mism[:1]})
                    print(f"{design} BUG={bug} seed={seed}: {n_rtl} cycles, {nresp} responses, "
                          f"{'IDENTICAL' if good else 'MISMATCH ' + str(mism[:2])}")
    (ROOT / "results" / "js_model_equivalence.json").write_text(json.dumps(report, indent=1))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
