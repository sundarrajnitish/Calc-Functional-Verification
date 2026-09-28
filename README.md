# Calc1 & Calc3 Functional Verification

**Interactive site: https://sundarrajnitish.github.io/Calc-Functional-Verification/**

Functional verification of the Calc1 and Calc3 four-port calculator designs (the IBM "calc" teaching designs used in COEN 6541, Functional Hardware Verification, at Concordia University). The project started as the 2024 course project. This repository is a 2026 rewrite: a layered, self-checking SystemVerilog testbench; open reference RTL with injected bugs, so everything runs on free simulators; a data-driven re-analysis of the 2024 Questa failure logs; and a website where anyone can drive the designs cycle by cycle.

## Highlights

- **The 2024 ADD failures have a root cause.** Every X in the 2024 port-1 ADD log follows one rule: X appears when bit 4 and bit 5 of operand 2 differ (3,321 / 3,321 log lines). Modelling this as a bridge between the bit-4 and bit-5 nets, feeding a ripple-carry adder, reproduces **all 3,321 result lines digit for digit**. The SHL-by-0 and SHR-by-0/1 failures are reproduced the same way (672 / 672 each).
- **14 / 14 injected bugs caught, 0 false failures**, over 3 seeds, with 100 % verification-plan coverage on the golden designs.
- **The website's simulators are the RTL.** `sim/check_js_models.py` drives random stimulus (protocol violations included) into the Verilog on Icarus and into the JavaScript models, and compares every output on every cycle, for every bug variant: 48 / 48 runs identical.
- **The 2024 testbench bugs are documented and fixed**: response 2 treated as a hang, a global cycle counter that never reset, posedge races, an off-by-one scoreboard that compared all four ports on every response, tag-blind matching of out-of-order responses, scan clocks driven with the functional clock, and coverage that never sampled the command.

## Repository layout

```
rtl/calc1/calc1_top.v         open Calc1 reference model (port-compatible with the course DUT) + 7 injectable bugs
rtl/calc3/calc3_top.v         open Calc3 reference model + 7 injectable bugs
tb/calc1/calc1_if.sv          interface with race-free clocking blocks
tb/calc1/calc1_pkg.sv         transaction, reference model, coverage, scoreboard, env, tests
tb/calc1/calc1_tb_top.sv      top level: +TEST=smoke|directed|priority|random|regress  +N=  +SEED=
tb/calc1/calc1_replay_2024.v  4-state replay of the 2024 port-1 sweeps (Icarus)
tb/calc3/...                  same structure for Calc3 (tags, out-of-order, hazards, branches)
tb/trace/                     cycle-trace harnesses used for the RTL == JavaScript check
sim/build.sh                  Verilator build of all 16 variants (2 designs x golden + 7 bugs)
sim/regress.py                regression: golden must pass, every bug must be caught
sim/check_replay.py           diff the open RTL against the 2024 Questa logs
sim/check_js_models.py        prove the website models are cycle-identical to the RTL
sim/js_regress.js             headless run of the in-browser testbench
analysis/analyze_2024_logs.py mine the 2024 logs for failure signatures
results/                      2024 logs, regression results, replay and equivalence reports
docs/                         the website (GitHub Pages)
```

The encrypted course netlists are not included. With Questa and the course's `calc1_top.v` / `calc3_top.v`, the files in `tb/` compile unchanged: the port lists match, and the `BUG` parameter is simply unused.

## The designs

**Calc1**: four ports. A command and operand 1 arrive in one cycle, operand 2 in the next, and exactly one response comes back later. Commands: add (1), sub (2), shift left (5), shift right (6). Responses: 1 = success, 2 = overflow / underflow / invalid. There are two 3-stage execution units (ADD, SHIFT), and fixed-priority arbitration gives port 1 the highest priority.

**Calc3**: sixteen 32-bit registers and 2-bit tags (up to four commands in flight per port), with store (9), fetch (10), branch-if-zero (12) and branch-if-equal (13). A taken branch skips that port's next command, which then gets response 3. Commands take effect in the cycle they are accepted, in port order 1 to 4. Responses return after 1, 3 or 4 cycles depending on the command, so they can come back out of order.

## Testbench architecture

```
generator --mailbox--> driver[p] --clocking block--> DUT --> monitor --> scoreboard <-- reference model
                                                                            |
                                                                        coverage
```

- **Constrained-random** stimulus with `dist` constraints biased toward corners (0, 1, all-ones, small shift amounts, carries, borrows, illegal opcodes), plus directed tests from the verification plan: the 2024 test-plan cases, boundaries, every shift amount, walking ones, priority contention, branch and skip side effects, same-cycle cross-port hazards, four commands in flight.
- **Reference model** written directly from the spec, sharing no code with the RTL. For Calc3 it is fed by an *input monitor* (what the DUT actually sampled), and expected results are keyed by (port, tag).
- **Scoreboard** classifies each outcome as `wrong_data`, `wrong_resp`, `x_on_output`, `no_response`, `spurious` or `unexpected_tag`, with a per-transaction timeout.
- **Coverage** is measured as verification-plan items (9 groups on Calc1, 11 on Calc3) and exported as JSON.

## Injected bugs and regression results

Bugs 1 to 4 of Calc1 reproduce the 2024 failure signatures. The others are classic arbitration, protocol and hazard defects added for teaching.

<!--RESULTS-->
| design | variant | verdict | failures per seed | checked | coverage |
|---|---|---|---|---|---|
| calc1 | golden (no bug) | PASS | 0 / 0 / 0 | 2640 | 100.0 % |
| calc1 | bug 1: Port-1 adder: operand-2 bit 4 bridged to bit 5 | caught | 65 / 71 / 70 | 2640 | 100.0 % |
| calc1 | bug 2: Port-1 SUB result stuck at 0, borrow never flagged | caught | 155 / 165 / 166 | 2640 | 100.0 % |
| calc1 | bug 3: SHL by 0 drives X on every set bit | caught | 24 / 25 / 15 | 2640 | 100.0 % |
| calc1 | bug 4: SHR by 0 returns 0, SHR by 1 does not shift | caught | 28 / 37 / 38 | 2640 | 100.0 % |
| calc1 | bug 5: ADD carry-out (overflow) not reported | caught | 216 / 204 / 203 | 2640 | 99.3 % |
| calc1 | bug 6: Port-4 request dropped when port 1 wins arbitration | caught | 1131 / 1157 / 1153 | 2640 | 96.7 % |
| calc1 | bug 7: Invalid command never answered | caught | 2332 / 2332 / 2332 | 2640 | 73.0 % |
| calc3 | golden (no bug) | PASS | 0 / 0 / 0 | 3538 | 100.0 % |
| calc3 | bug 1: Back-to-back responses reuse the previous tag | caught | 1484 / 1451 / 1485 | 4227 | 100.0 % |
| calc3 | bug 2: No same-cycle forwarding between ports (store->fetch) | caught | 251 / 178 / 185 | 3538 | 100.0 % |
| calc3 | bug 3: Skipped command still writes its destination | caught | 110 / 100 / 138 | 3538 | 100.0 % |
| calc3 | bug 4: Shift amount taken from d2 field instead of R[d2] | caught | 378 / 353 / 315 | 3538 | 100.0 % |
| calc3 | bug 5: Port-4 SUB underflow not flagged | caught | 254 / 210 / 199 | 3538 | 100.0 % |
| calc3 | bug 6: Port-3 writes to R15 are lost | caught | 47 / 13 / 8 | 3538 | 100.0 % |
| calc3 | bug 7: Branch-if-equal compares only the low 16 bits | caught | 39 / 36 / 12 | 3538 | 100.0 % |
<!--/RESULTS-->

## Running it

Requirements: Verilator 5.036 or newer with `z3` (for the constrained-random testbench), Icarus Verilog 12, Python 3, Node 18+.

```bash
sim/build.sh                                   # 16 Verilator builds
python3 sim/regress.py --seeds 1,2,3 --jobs 4  # golden passes, every bug is caught
python3 sim/check_replay.py                    # open RTL vs the 2024 Questa logs
python3 sim/check_js_models.py                 # website JS models == RTL, cycle by cycle
python3 analysis/analyze_2024_logs.py          # re-mine the 2024 logs
node sim/js_regress.js 2000 1                  # the in-browser testbench, headless
python3 sim/publish_data.py                    # refresh docs/data and this table
```

A single run: `build/calc3_bug2/Vcalc3_tb_top +TEST=hazards +SEED=7 +verilator+seed+7`.

To view the site locally: `python3 -m http.server -d docs` and open http://localhost:8000.

## Author

Nitish Sundarraj
