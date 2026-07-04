# CodeAuthorityBench — commit pinning provenance & findings

**Last updated:** 2026-07-03. **Scope:** dataset reproducibility — every repo is pinned to the
exact commit the benchmark evaluated against, replacing the earlier `"commit": "latest"`.

## Correction history (read this)

The **first** pinning pass (commit `4d23149`) pinned each dataset to a GitHub **release
tag** resolved via the GitHub API (e.g. flask 3.1.3, fastapi 0.115.0). That was **wrong**:
the benchmark (`benchmarks/evaluate.ts`) evaluates against the **local clones** in
`benchmarks/repos/`, which sit at *different* commits than those release tags — and the
fastapi tag commit `40e33e…` was not even present in the local clone (a "bad object"). API
tags are therefore not a faithful — or even always reproducible — anchor.

The **current** pins are the **local HEAD SHAs = the exact commits the benchmark actually
evaluated against**, verified with `git ls-tree` on the local clones (authoritative, no
network). Anyone can reproduce by checking out these SHAs.

## Pinned commits (local HEAD = evaluated state)

| Repo    | Commit SHA (short) | HEAD date | GT paths | Unresolved at pinned commit |
| ------- | ------------------ | --------- | -------- | --------------------------- |
| flask   | 36e4a824f3         | 2026-05-31 | 24      | 0 ✅ |
| express | 18e5985b8a         | 2026-06-15 | 12      | **3** (lib/router/index.js, layer.js, route.js) |
| fastapi | 1929ac2319         | 2026-06-27 | 21      | **2** (fastapi/_compat.py, tests/…/test_tutorial001.py) |
| django  | e78991410b         | 2026-06-26 | 66      | 0 ✅ |
| gin     | 34dac209ff         | 2026-06-27 | 29      | 0 ✅ |
| nestjs  | eef6183961         | 2026-06-27 | 56      | 0 ✅ |
| spring  | ce718cf699         | 2026-06-28 | 55      | 0 ✅ |

The commits carry no release tags (`git describe` falls back to the bare SHA) — they are
whatever was cloned when the benchmark was built. Full SHAs and the unresolved lists are in
`benchmarks/.pin-verify.json`.

## Finding: a few express & fastapi paths are absent from the evaluated checkout

For **5 of 7** repos every ground-truth path exists at the pinned (evaluated) commit. For
**express** (3 paths) and **fastapi** (2 paths), a few ground-truth paths reference files that
do **not** exist in the local clone the benchmark ran on:

- express `lib/router/{index,layer,route}.js` — absent at the evaluated commit (the local
  express checkout has a restructured router; these v4-style paths don't exist there).
- fastapi `fastapi/_compat.py` — a **package** `fastapi/_compat/` at the evaluated commit,
  not a module; and `…/test_tutorial001.py` was renamed/merged.

Those specific tasks scored their retrieval against non-existent target files (auto-miss). It
affects 5 tasks' worth of ground truth, not the aggregate conclusions. The paths are flagged
here and left unedited; correcting them is part of the planned re-annotation pass.

## Caveat — pinning is necessary, not sufficient

Path existence at the pinned commit proves a path *resolves*; it does not by itself confirm
the path is the most authoritative file for the query. Re-validating ground-truth paths
against their pinned commits is part of the planned re-annotation pass.

## Planned improvements

- Fix the 5 express/fastapi ground-truth paths against the evaluated commit.
- Cohen's kappa with an external annotator on a 100-task sample (kit under
  `benchmarks/annotation-kit/`).
- Re-validate ground-truth authority roles against the pinned commits.
- Add 2–3 additional lower-profile repositories to test memorization sensitivity, with
  independent annotation.
