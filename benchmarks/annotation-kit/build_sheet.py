#!/usr/bin/env python3
"""
build_sheet.py -- turn the sampled tasks into a BLIND annotation form.

Design that defeats circularity: for each task the candidate file pool is the
top-k files from a plain BM25 lexical search over the repo (union'd with the gold
files so the answer is always in the pool). The annotator sees only relevant
files and must pick which are the *source of truth* -- i.e. they supply the
AUTHORITY judgment independently of CodeBrain's authority scores. Candidates are
shuffled; the annotator never sees scores, tiers, gold labels, or which method
retrieved what.

Snippets are read from the local repo checkouts in benchmarks/repos/, which are
pinned to the evaluated commit (see benchmarks/PIN_PROVENANCE.md). Gold files that
don't exist at the pinned commit (the flagged express/fastapi cases) are marked
"[not present at pinned commit]" rather than dropped -- that itself is signal.

Usage:
    python build_sheet.py --sample ./out/sample_100.json --out ./out
Outputs (in ./out):
    annotation_form.csv   <- the annotator fills columns authoritative / primary / notes
    sheet.md              <- human-readable: question + candidate snippets per task
    answer_key.json       <- HIDDEN gold key (do NOT give to the annotator)
"""
import argparse, csv, json, os, re, random
from collections import defaultdict

REPOS = os.path.join(os.path.dirname(__file__), "..", "repos")
REPO_DIR = {"flask": "flask", "express": "express", "fastapi": "fastapi",
            "django": "django", "gin": "gin", "nestjs": "nestjs",
            "spring": "spring-framework"}
SRC_EXT = {".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".go",
           ".java", ".rb", ".php", ".c", ".h", ".cc", ".cpp", ".hpp", ".kt", ".scala"}
SKIP_DIR = {".git", "node_modules", "vendor", "dist", "build", ".venv",
            "__pycache__", ".tox", ".mypy_cache", "site-packages"}
MAX_BYTES = 200_000
POOL_K = 8          # BM25 candidates per task (before union with gold)
SNIPPET_LINES = 22
SEED = 20260703

_word = re.compile(r"[A-Za-z0-9]+")
def tokenize(text):
    out = []
    for w in _word.findall(text):
        w2 = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", w)   # split camelCase
        for part in w2.replace("_", " ").split():
            if len(part) > 1:
                out.append(part.lower())
    return out


class BM25:
    """Minimal BM25 over a repo's source files. Index once per repo, reuse."""
    def __init__(self, repo_path, k1=1.5, b=0.75):
        self.k1, self.b = k1, b
        self.paths, self.tf, self.dl = [], [], []
        self.df = defaultdict(int)
        for root, dirs, files in os.walk(repo_path):
            dirs[:] = [d for d in dirs if d not in SKIP_DIR]
            for fn in files:
                ext = os.path.splitext(fn)[1].lower()
                if ext not in SRC_EXT:
                    continue
                fp = os.path.join(root, fn)
                try:
                    if os.path.getsize(fp) > MAX_BYTES:
                        continue
                    text = open(fp, encoding="utf-8", errors="ignore").read()
                except OSError:
                    continue
                rel = os.path.relpath(fp, repo_path).replace("\\", "/")
                toks = tokenize(rel) + tokenize(text)
                if not toks:
                    continue
                counts = defaultdict(int)
                for t in toks:
                    counts[t] += 1
                self.paths.append(rel)
                self.tf.append(counts)
                self.dl.append(len(toks))
                for t in counts:
                    self.df[t] += 1
        self.N = len(self.paths)
        self.avgdl = (sum(self.dl) / self.N) if self.N else 0.0

    def search(self, query, k):
        import math
        q = set(tokenize(query))
        scores = []
        for i in range(self.N):
            tf, dl = self.tf[i], self.dl[i]
            s = 0.0
            for term in q:
                f = tf.get(term, 0)
                if not f:
                    continue
                idf = math.log(1 + (self.N - self.df[term] + 0.5) / (self.df[term] + 0.5))
                s += idf * (f * (self.k1 + 1)) / (f + self.k1 * (1 - self.b + self.b * dl / self.avgdl))
            if s > 0:
                scores.append((s, self.paths[i]))
        scores.sort(reverse=True)
        return [p for _, p in scores[:k]]


def snippet_for(repo_path, rel):
    fp = os.path.join(repo_path, rel.rstrip("/"))
    if not os.path.isfile(fp):
        return "[not present at pinned commit]"
    try:
        lines = open(fp, encoding="utf-8", errors="ignore").read().splitlines()
    except OSError:
        return "[unreadable]"
    body = [ln for ln in lines if ln.strip()][:SNIPPET_LINES]
    tail = f"\n… ({len(lines)} lines total)" if len(lines) > SNIPPET_LINES else ""
    return "\n".join(body) + tail


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", default="./out/sample_100.json")
    ap.add_argument("--out", default="./out")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    sample = json.load(open(args.sample))["tasks"]
    rng = random.Random(SEED)
    indexes = {}          # repo -> BM25 (cache)

    form_rows, key, md = [], {}, ["# CodeAuthorityBench — blind annotation sheet", ""]
    md.append("For each task, read the question and the candidate file snippets, then in "
              "`annotation_form.csv` mark which files are the **source of truth** for the "
              "question (`authoritative`=1) and which single file is the primary one "
              "(`primary`=1). See ANNOTATOR_README.md. Do not consult any other CodeBrain "
              "output.\n")

    for t in sample:
        repo = t["repo"]
        rpath = os.path.join(REPOS, REPO_DIR.get(repo, repo))
        if repo not in indexes:
            indexes[repo] = BM25(rpath)
        cand = indexes[repo].search(t["query"], POOL_K)
        gold = [g for g in t["ground_truth_files"]]
        pool = list(dict.fromkeys(cand + gold))       # union, gold guaranteed in
        rng.shuffle(pool)

        key[t["id"]] = {"gold_files": gold, "repo": repo, "commit": t["commit"]}
        md.append(f"## {t['id']}  ({repo}, {t['task_type']})\n")
        md.append(f"**Q: {t['query']}**\n")
        for idx, path in enumerate(pool):
            cid = f"{t['id']}::c{idx}"
            form_rows.append({"task_id": t["id"], "repo": repo, "task_type": t["task_type"],
                              "question": t["query"], "candidate_id": cid,
                              "candidate_path": path,
                              "authoritative_0_1": "", "primary_0_1": "", "notes": ""})
            md.append(f"### {cid}  `{path}`\n```\n{snippet_for(rpath, path)}\n```\n")
        md.append("")

    # write the annotator form (blind), snippets, and hidden key
    with open(os.path.join(args.out, "annotation_form.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(form_rows[0].keys()))
        w.writeheader(); w.writerows(form_rows)
    open(os.path.join(args.out, "sheet.md"), "w", encoding="utf-8").write("\n".join(md))
    json.dump(key, open(os.path.join(args.out, "answer_key.json"), "w"), indent=2)

    n_tasks = len(sample)
    print(f"Built blind sheet for {n_tasks} tasks: {len(form_rows)} candidate rows "
          f"(~{len(form_rows)//max(n_tasks,1)}/task).")
    print(f"  annotation_form.csv  (give to annotator)")
    print(f"  sheet.md             (give to annotator — snippets)")
    print(f"  answer_key.json      (KEEP HIDDEN)")


if __name__ == "__main__":
    main()
