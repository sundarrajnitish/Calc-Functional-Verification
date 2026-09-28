#!/usr/bin/env python3
"""Copy the machine-readable results the website reads into docs/data/.  (Nitish Sundarraj)"""
import json, pathlib, shutil
ROOT = pathlib.Path(__file__).resolve().parents[1]
out = ROOT / "docs" / "data"
out.mkdir(parents=True, exist_ok=True)
import sys
sys.path.insert(0, str(ROOT / "sim"))
from regress import BUGS
reg = json.loads((ROOT / "results" / "regression.json").read_text())
for r in reg:
    r["description"] = BUGS[r["design"]][r["bug"]]
(ROOT / "results" / "regression.json").write_text(json.dumps(reg, indent=1))
slim = [{k: r.get(k) for k in ("design", "bug", "seed", "checked", "pass", "fail", "coverage", "verdict",
                               "description", "first_fail", "fail_kinds", "seconds", "cov")} for r in reg]
(out / "regression.json").write_text(json.dumps(slim, separators=(",", ":")))
for f in ("replay_2024.json", "js_model_equivalence.json"):
    shutil.copy(ROOT / "results" / f, out / f)
print("published", [p.name for p in out.iterdir()])

# ---- README results table
rows = {}
for r in reg:
    rows.setdefault((r["design"], r["bug"]), []).append(r)
md = ["| design | variant | verdict | failures per seed | checked | coverage |", "|---|---|---|---|---|---|"]
for (d, b), rs in sorted(rows.items()):
    rs.sort(key=lambda r: r["seed"])
    golden = b == 0
    ok = all((r["fail"] == 0) if golden else (r["fail"] > 0) for r in rs)
    verdict = ("PASS" if ok else "FALSE FAIL") if golden else ("caught" if ok else "ESCAPED")
    md.append(f"| {d} | {'golden (no bug)' if golden else 'bug ' + str(b) + ': ' + BUGS[d][b]} | {verdict} | "
              f"{' / '.join(str(r['fail']) for r in rs)} | {rs[0]['checked']} | {min(r['coverage'] for r in rs):.1f} % |")
rd = ROOT / "README.md"
t = rd.read_text()
a, b2 = t.index("<!--RESULTS-->"), t.index("<!--/RESULTS-->")
rd.write_text(t[:a] + "<!--RESULTS-->\n" + "\n".join(md) + "\n" + t[b2:])
print("README table updated")
