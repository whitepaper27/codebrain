# CodeAuthorityBench annotation kit

Tools to run a **second, independent human annotation** of a stratified 100-task subset and
report Cohen's kappa against the released gold. This is the fix for the benchmark's single
biggest credibility weakness: the labels are currently effectively single-author /
LLM-assisted. A validated kappa turns it from "solo benchmark" into "credibly validated
dataset artifact."

Zero external dependencies — plain Python 3.9+. Reads the pinned datasets in
`../datasets/` and the repo checkouts in `../repos/` (pinned to the evaluated commits; see
`../PIN_PROVENANCE.md`).

## Pipeline

```bash
cd benchmarks/annotation-kit

# 1. draw the stratified 100-task sample (deterministic; repo x task_type x difficulty)
python build_sample.py --out ./out

# 2. build the BLIND annotation form (BM25 candidate pools + snippets; ~90s, indexes 7 repos)
python build_sheet.py --sample ./out/sample_100.json --out ./out

# 3. hand ./out/annotation_form.csv + ./out/sheet.md + ANNOTATOR_README.md to the annotator.
#    KEEP ./out/answer_key.json HIDDEN from them.

# 4. once they return the filled annotation_form.csv, score agreement
python score_kappa.py --form ./out/annotation_form.csv --key ./out/answer_key.json --out ./out
```

`score_kappa.py` prints observed agreement, **Cohen's kappa**, source-of-truth recall, and
exact-set-match rate, and writes `./out/disagreements.md` — the adjudication worklist.

## Why the design defeats circularity

The critique of the benchmark: gold files were chosen using dependency-centrality / schema-
ownership criteria — the *same signals* the CodeBrain scorer uses. So the method is graded
against its own features.

This kit breaks that loop two ways:
1. **Candidate pools are relevance-based, not authority-based.** They come from a plain BM25
   lexical search (top-k) unioned with the gold. The annotator is shown *relevant* files and
   must supply the *authority* judgment themselves — exactly the relevance-vs-authority
   distinction the paper claims.
2. **The annotator judges behaviorally, not structurally.** `ANNOTATOR_README.md` instructs
   them to decide "which file would you edit to change this behavior," and explicitly *not*
   to count imports or use directory heuristics. So their label is independent of the
   scoring function.

If gold and an independent behavioral annotator agree at a healthy kappa, the labels reflect
real source-of-truth, not just the scorer's own definition.

## Reproducibility

Everything is seeded (`SEED = 20260703`) and deterministic. `./out/` is regenerable from the
scripts and is gitignored; commit only the scripts + READMEs. To freeze a specific sample for
the paper, copy `out/sample_100.json` somewhere durable.

## Files

| File | Role |
| --- | --- |
| `build_sample.py` | stratified 100-task sample (+ optional win/loss balancing hook) |
| `build_sheet.py` | BM25 candidate pools + snippets → blind `annotation_form.csv`, `sheet.md`, hidden `answer_key.json` |
| `score_kappa.py` | Cohen's kappa + source-of-truth agreement + `disagreements.md` |
| `ANNOTATOR_README.md` | instructions handed to the human annotator |

## Limitations (state these in the paper)

- One external annotator gives gold-vs-annotator agreement, not full inter-annotator
  reliability across multiple independents. Two+ annotators would be stronger.
- BM25 pools can miss a truly non-lexical authoritative file; the gold union guarantees the
  answer is always present, but distractor realism is bounded by lexical retrieval.
- Snippets are 22 lines; annotators are told they may open the full file at the pinned commit.
