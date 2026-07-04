# Annotator instructions — CodeAuthorityBench source-of-truth labeling

Thank you for labeling. Your independent judgments let us measure how reliable the
benchmark's answer key is. Please read this fully before starting — **how** you decide
matters as much as the decision.

## Your task

For each question you'll see ~8–12 **candidate files** (path + a short snippet). For each
candidate, decide: **is this file a *source of truth* for the question?** Mark
`authoritative_0_1` = 1 (yes) or 0 (no) in `annotation_form.csv`. Then, per question, mark
exactly one `primary_0_1` = 1 for the single file you'd call *the* definitive one.

## What "source of truth" means (judge behaviorally — this is important)

Decide by what the code **does**, using this test:

> **If you had to change (or were told never to change) the behavior/structure the question
> asks about, which file(s) would you actually edit? Where does this thing genuinely *live*?**

- **what_governs** → the file whose code actually decides/controls the behavior. Not a file
  that merely *uses* or *calls* it.
- **where_is_schema** → the file that *defines* the canonical structure / type / contract /
  route table, not one that consumes it.
- **what_breaks** → the file(s) that *own* the behavior that would break if the thing changed.
- **is_safe_to_modify** → is this a load-bearing definition, or peripheral glue/wiring?

## Please do NOT

- ❌ Do **not** decide by "how many other files import this" or "it's in a core/ folder."
  Those are heuristics the tool being evaluated already uses — judging that way would just
  re-confirm the tool instead of testing it. Judge from what the code *does*.
- ❌ Do not run CodeBrain, look at authority scores/tiers, or check the existing answer key.
- ❌ Do not guess from the file name alone — read the snippet.

## You MAY

- ✅ Open the full file if the snippet isn't enough. The repos are checked out at the exact
  evaluated commit under `benchmarks/repos/<repo>/` (see `../PIN_PROVENANCE.md` for the SHA).
- ✅ Mark more than one file authoritative if the behavior genuinely spans them.
- ✅ Leave a short note in `notes` when you're unsure — that flags a task for adjudication.
- ✅ A candidate marked `[not present at pinned commit]` should be left `0` (and noted) — it
  is itself a finding.

## Practical

- Work through `sheet.md` (readable, has the snippets) and record answers in
  `annotation_form.csv` (one row per candidate; only the last three columns are yours).
- Budget ~1–2 minutes per candidate, ~2–3 hours total for 100 tasks. Take breaks; consistency
  matters more than speed.
- When done, return the filled `annotation_form.csv`. We compute agreement with
  `score_kappa.py` and adjudicate every disagreement together.
