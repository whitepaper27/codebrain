#!/usr/bin/env python3
"""
build_sample.py -- draw a stratified 100-task sample for external re-annotation.

WHY: the whole benchmark is currently single-annotator / LLM-assisted. A second,
independent human labeling a stratified subset lets us report Cohen's kappa and
say "disagreements were adjudicated and incorporated" -- which upgrades the
dataset from "solo benchmark" to "credibly validated artifact".

Stratifies by (repo x task_type x difficulty) so the sample covers every repo,
all four task types, and the easy/medium/hard spread proportionally. Deterministic
(fixed seed).

Optional win/loss balancing: if --winloss <json> is given (a map
{task_id: "win"|"loss"|"tie"} of CodeBrain vs a strong baseline), it is added as a
4th stratification axis so the sample includes tasks where CodeBrain wins AND loses.
Not required; without it the sample is balanced on the deterministic axes only.

Usage:
    python build_sample.py --out ./out [--n 100] [--winloss winloss.json]
Output:
    ./out/sample_100.json   (task ids + metadata, frozen seed)
    ./out/sample_report.md  (coverage tables)
"""
import argparse, json, os, random, glob
from collections import defaultdict

SEED = 20260703
DDIR = os.path.join(os.path.dirname(__file__), "..", "datasets")


def load_tasks():
    tasks = []
    for fp in sorted(glob.glob(os.path.join(DDIR, "*-tasks.json"))):
        data = json.load(open(fp, encoding="utf-8"))
        commit = data.get("commit", "")
        for t in data["tasks"]:
            tasks.append({
                "id": t["id"],
                "repo": t["repo"],
                "task_type": t.get("task_type", "unknown"),
                "difficulty": t.get("difficulty", "unknown"),
                "query": t["query"],
                "ground_truth_files": t.get("ground_truth_files", []),
                "commit": commit,
            })
    return tasks


def stratified_take(strata, n_total, rng):
    """Proportional allocation across strata with rounding repair; deterministic."""
    sizes = {k: len(v) for k, v in strata.items()}
    pool = sum(sizes.values())
    if pool <= n_total:
        return [i for v in strata.values() for i in v]
    alloc = {k: min(int(round(n_total * s / pool)), s) for k, s in sizes.items()}
    diff = n_total - sum(alloc.values())
    order = sorted(strata, key=lambda k: sizes[k], reverse=True)
    i = 0
    while diff != 0 and order:
        k = order[i % len(order)]
        if diff > 0 and alloc[k] < sizes[k]:
            alloc[k] += 1; diff -= 1
        elif diff < 0 and alloc[k] > 0:
            alloc[k] -= 1; diff += 1
        i += 1
        if i > 100000:
            break
    taken = []
    for k, nk in alloc.items():
        taken.extend(strata[k][:nk])
    return taken


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./out")
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--winloss", help="optional {task_id: win|loss|tie} json")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    tasks = load_tasks()
    by_id = {t["id"]: t for t in tasks}
    winloss = json.load(open(args.winloss)) if args.winloss else {}

    strata = defaultdict(list)
    for t in tasks:
        key = (t["repo"], t["task_type"], t["difficulty"])
        if winloss:
            key = key + (winloss.get(t["id"], "unknown"),)
        strata[key].append(t["id"])

    rng = random.Random(SEED)
    for k in strata:
        strata[k] = sorted(strata[k])
        rng.shuffle(strata[k])

    sample_ids = stratified_take(dict(strata), args.n, rng)
    sample = [by_id[i] for i in sorted(sample_ids)]

    json.dump({"seed": SEED, "n": len(sample),
               "winloss_applied": bool(winloss), "tasks": sample},
              open(os.path.join(args.out, "sample_100.json"), "w"), indent=2)

    # coverage report
    def tally(field):
        c = defaultdict(int)
        for t in sample:
            c[t[field]] += 1
        return dict(sorted(c.items()))
    lines = ["# Annotation sample coverage", "",
             f"- total sampled: {len(sample)} (target {args.n}), seed {SEED}",
             f"- win/loss balancing: {'yes' if winloss else 'no (deterministic axes only)'}",
             "", "## by task_type", ""]
    for k, v in tally("task_type").items():
        lines.append(f"- {k}: {v}")
    lines += ["", "## by repo", ""]
    for k, v in tally("repo").items():
        lines.append(f"- {k}: {v}")
    lines += ["", "## by difficulty", ""]
    for k, v in tally("difficulty").items():
        lines.append(f"- {k}: {v}")
    open(os.path.join(args.out, "sample_report.md"), "w").write("\n".join(lines) + "\n")

    print(f"Sampled {len(sample)} tasks -> {args.out}/sample_100.json")
    print("Coverage:", tally("task_type"))


if __name__ == "__main__":
    main()
