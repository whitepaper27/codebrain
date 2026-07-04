#!/usr/bin/env python3
"""
score_kappa.py -- compare the human annotator's labels to the existing benchmark
gold, and report agreement.

Two raters on the same items:
  - Rater A = existing benchmark gold (candidate_path in that task's gold_files)
  - Rater B = the human annotator (authoritative_0_1 column they filled)
Each item is one (task, candidate) pair -> binary authoritative/not.

Reports:
  - observed agreement (raw %)
  - Cohen's kappa (chance-corrected) over all (task,candidate) decisions
  - source-of-truth agreement: per task, did the annotator's authoritative set
    cover the gold source-of-truth file(s)? (recall-style, and exact-set match)
  - disagreement report for adjudication (written to disagreements.md)

Zero external dependencies (kappa computed directly).

Usage:
    python score_kappa.py --form ./out/annotation_form.csv --key ./out/answer_key.json --out ./out
"""
import argparse, csv, json, os
from collections import defaultdict


def cohens_kappa(pairs):
    """pairs: list of (a, b) binary labels. Returns (kappa, po, pe, n)."""
    n = len(pairs)
    if n == 0:
        return None, None, None, 0
    agree = sum(1 for a, b in pairs if a == b)
    po = agree / n
    # marginals
    a1 = sum(1 for a, _ in pairs if a == 1) / n
    b1 = sum(1 for _, b in pairs if b == 1) / n
    pe = a1 * b1 + (1 - a1) * (1 - b1)
    kappa = (po - pe) / (1 - pe) if pe != 1 else 1.0
    return kappa, po, pe, n


def norm(v):
    return 1 if str(v).strip() in ("1", "1.0", "yes", "y", "true", "True") else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--form", default="./out/annotation_form.csv")
    ap.add_argument("--key", default="./out/answer_key.json")
    ap.add_argument("--out", default="./out")
    args = ap.parse_args()

    key = json.load(open(args.key))
    rows = list(csv.DictReader(open(args.form, encoding="utf-8")))

    # sanity: has the annotator actually filled anything?
    filled = sum(1 for r in rows if str(r.get("authoritative_0_1", "")).strip() != "")
    if filled == 0:
        raise SystemExit("annotation_form.csv has no filled 'authoritative_0_1' values — "
                         "has the annotator completed it?")

    pairs = []                         # (gold, annotator) per candidate
    by_task = defaultdict(lambda: {"gold": set(), "human": set(), "rows": []})
    for r in rows:
        tid, path = r["task_id"], r["candidate_path"]
        gold_files = set(key[tid]["gold_files"]) if tid in key else set()
        gold = 1 if path in gold_files else 0
        human = norm(r.get("authoritative_0_1", ""))
        pairs.append((gold, human))
        bt = by_task[tid]
        bt["gold"] = gold_files
        if human:
            bt["human"].add(path)
        bt["rows"].append((path, gold, human, norm(r.get("primary_0_1", "")), r.get("notes", "")))

    kappa, po, pe, n = cohens_kappa(pairs)

    # source-of-truth agreement per task
    tasks = list(by_task.values())
    covered = sum(1 for t in tasks if t["gold"] and t["gold"] & t["human"])   # any gold picked
    exact = sum(1 for t in tasks if t["gold"] and t["gold"] == t["human"])    # exact set match
    n_tasks_scored = sum(1 for t in tasks if t["gold"])

    summary = {
        "candidate_decisions": n,
        "observed_agreement": round(po, 4),
        "chance_agreement": round(pe, 4),
        "cohens_kappa": round(kappa, 4) if kappa is not None else None,
        "tasks_scored": n_tasks_scored,
        "source_of_truth_recall": round(covered / n_tasks_scored, 4) if n_tasks_scored else None,
        "exact_set_match_rate": round(exact / n_tasks_scored, 4) if n_tasks_scored else None,
    }
    print(json.dumps(summary, indent=2))
    kv = summary["cohens_kappa"]
    band = ("poor" if kv is None or kv < .2 else "fair" if kv < .4 else "moderate"
            if kv < .6 else "substantial" if kv < .8 else "almost perfect")
    print(f"\nCohen's kappa = {kv} ({band}). "
          f"Report as: an independent annotator labeled {n_tasks_scored} tasks; "
          f"agreement with the released gold was kappa={kv}; "
          f"disagreements adjudicated and folded into the final benchmark.")

    # disagreement report for adjudication
    md = ["# Annotator vs gold — disagreements to adjudicate", "",
          json.dumps(summary, indent=2), ""]
    for tid, bt in sorted(by_task.items()):
        diffs = [(p, g, h) for (p, g, h, _, _) in bt["rows"] if g != h]
        if not diffs:
            continue
        md.append(f"## {tid}")
        for p, g, h in diffs:
            tag = "gold says AUTH, annotator NO" if g and not h else "annotator says AUTH, gold NO"
            md.append(f"- `{p}` — {tag}")
        md.append("")
    open(os.path.join(args.out, "disagreements.md"), "w", encoding="utf-8").write("\n".join(md))
    print(f"\nDisagreements written to {args.out}/disagreements.md ({sum(1 for a,b in pairs if a!=b)} items).")


if __name__ == "__main__":
    main()
