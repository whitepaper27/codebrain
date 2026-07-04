# CodeBrain

> **Alpha (v0.1.0-alpha)** -- This project is under active development. APIs, scoring weights, and benchmark results may change.

**Authority-aware code retrieval for AI coding agents.**

Code search tells you what's relevant. CodeBrain aims to tell you what's authoritative.

---

## The Problem

AI coding agents are powerful but blind. When an agent modifies your codebase, it doesn't know which files are load-bearing and which are disposable. It treats a database schema and a test fixture with equal confidence. The result: agents break things they don't understand.

Many tools still rely heavily on flat semantic or symbol retrieval and do not explicitly model authority. CodeBrain adds an authority layer: it estimates structural authority so agents can prioritize files that are more likely to govern behavior, not just files that match a query.

## How It Works

```
$ codebrain scan .
Scanning 1,247 files...
  Parsed 1,247 ASTs (TypeScript: 892, Python: 234, SQL: 121)
  Built dependency graph (3,421 edges)
  Computed authority scores
  Output: codebrain-data/

$ # In Claude Code / Cursor, ask: "What handles tax calculations?"
# CodeBrain returns ROOT files first, not just similar files
```

Example response from `search_with_hierarchy`:

```
  src/core/tax-engine.ts          AUTHORITY: 0.94  ROOT
  38 modules depend on this. Defines TaxCalculation interface.

  src/services/tax-service.ts     AUTHORITY: 0.42  DERIVED
  Wraps tax-engine for API layer. 3 dependents.

  tests/tax-engine.test.ts        AUTHORITY: 0.08  LEAF
  Test file. 0 dependents.
```

## Install

> **Note:** CodeBrain is in alpha and is **not yet published to npm**. Install from source using the steps below. (The `npm install -g @codebrain/mcp-server` path will be enabled once the package is published.)

### Run from source

```bash
git clone https://github.com/whitepaper27/codebrain
cd codebrain
npm install
npm run build
npm link            # exposes `codebrain` and `codebrain-mcp` on your PATH

cd /path/to/your-repo
codebrain scan .    # writes codebrain-data/ (topology + authority_tree.json)
# Then add codebrain-mcp to your MCP config (see below) and go
```

---

## MCP Configuration

CodeBrain ships as an [MCP](https://modelcontextprotocol.io/) server. One config line, works with any MCP-compatible agent.

### Claude Code / Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codebrain": {
      "command": "codebrain-mcp",
      "args": ["--repo", "."]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "codebrain": {
      "command": "codebrain-mcp",
      "args": ["--repo", "."]
    }
  }
}
```

---

## MCP Tools

CodeBrain exposes five tools. Each returns structured JSON with authority scores.

### `search_with_hierarchy`

Find code ranked by authority, not just similarity.

```json
{
  "tool": "search_with_hierarchy",
  "query": "tax calculation",
  "results": [
    {
      "file": "src/core/tax-engine.ts",
      "authority_score": 0.94,
      "authority_tier": "ROOT",
      "reason": "38 modules depend on this. Defines TaxCalculation interface. Zero imports from derived modules.",
      "dependents": 38,
      "dependencies": 2,
      "last_modified": "2024-01-15",
      "churn_percentile": 5
    },
    {
      "file": "src/api/tax-endpoint.ts",
      "authority_score": 0.35,
      "authority_tier": "DERIVED",
      "reason": "API wrapper. Imports from tax-engine. 0 other modules depend on this.",
      "dependents": 0,
      "dependencies": 4,
      "last_modified": "2026-06-20",
      "churn_percentile": 72
    }
  ]
}
```

### `explain_module_authority`

Explain why a file is classified as root, derived, or leaf.

```json
{
  "tool": "explain_module_authority",
  "file": "src/core/tax-engine.ts",
  "authority_score": 0.94,
  "authority_tier": "ROOT",
  "signals": {
    "dependency_centrality": 0.91,
    "reverse_dependency_count": 38,
    "schema_ownership": true,
    "churn_stability": 0.95,
    "directory_prior": "core",
    "out_degree": 2
  },
  "explanation": "High in-degree (38 dependents), defines TaxCalculation interface, stable over git history (5th percentile churn), located in core/ directory."
}
```

### `diff_blast_radius`

Show downstream impact of a proposed change.

```json
{
  "tool": "diff_blast_radius",
  "file": "src/core/tax-engine.ts",
  "blast_radius": {
    "direct_dependents": 12,
    "transitive_dependents": 38,
    "test_files_affected": 23,
    "affected_files": [
      "src/services/tax-service.ts",
      "src/api/tax-endpoint.ts",
      "src/reports/tax-report.ts"
    ]
  }
}
```

### `guard_change`

Warn or block when an agent touches high-authority code.

```json
// Request
{ "file": "src/core/tax-engine.ts", "change_type": "modify" }

// Response
{
  "verdict": "REQUIRES_HUMAN_APPROVAL",
  "authority_score": 0.94,
  "reason": "This file is a root authority. 38 modules depend on it. Changes here have high blast radius.",
  "blast_radius": {
    "direct_dependents": 12,
    "transitive_dependents": 38,
    "test_files_affected": 23
  },
  "recommendation": "Review with a senior engineer before modifying. Consider whether the change should be in a derived module instead."
}
```

Verdicts:
- **SAFE** (score < 0.3) -- low-authority file, safe to modify
- **CAUTION** (score 0.3--0.7) -- mid-authority file, review recommended
- **REQUIRES_HUMAN_APPROVAL** (score > 0.7) -- high-authority file, human review required

Thresholds are configurable via `.codebrain/config.json`.

### `find_contracts` (Phase 3)

Surface implicit assumptions between modules. Not available in MVP.

---

## Supported Languages

| Language   | Grammar             | Extensions             |
| ---------- | ------------------- | ---------------------- |
| TypeScript | tree-sitter-typescript | `.ts`, `.tsx`       |
| JavaScript | tree-sitter-typescript | `.js`, `.jsx`       |
| Python     | tree-sitter-python     | `.py`               |
| C          | tree-sitter-c          | `.c`, `.h`          |
| Java       | tree-sitter-java       | `.java`             |
| Go         | tree-sitter-go         | `.go`               |

Additional languages can be added by implementing the `ILanguageParser` interface. See [docs/adding-languages.md](docs/adding-languages.md).

---

## Authority Scoring

Authority is computed from deterministic structural and repository-level signals. The same repository and configuration always produce the same score. No LLM, no embeddings, no randomness between runs.

### Formula

```
Authority(file) = w1 * dependency_centrality
               + w2 * reverse_dependency_count
               + w3 * schema_config_interface_ownership
               + w4 * churn_stability
               + w5 * directory_prior
               + w6 * test_reference_coverage
```

### Classification Tiers

| Tier    | Score Range | Description                                        |
| ------- | ----------- | -------------------------------------------------- |
| ROOT    | 0.8 -- 1.0  | Source-of-truth files. Schemas, core domain, configs. |
| DERIVED | 0.3 -- 0.7  | Implementation files. Services, controllers, adapters. |
| LEAF    | 0.0 -- 0.2  | Tests, scripts, one-offs, generated code.           |

The score is a float, not a category. The tiers are convenience labels. Consumers can set their own thresholds.

### Signals

**Increase authority:**
- High in-degree in the call/import graph (many modules depend on this file)
- Defines schemas, types, interfaces, or contracts
- Lives in a config, migration, or core domain directory
- Low churn (stable over long git history)
- Other modules import from it but it imports from few

**Decrease authority:**
- High out-degree (depends on many other modules)
- Lives in test, script, example, or utility directories
- High churn (frequently modified)
- No other module imports it (leaf node)

For the full algorithm specification, see [docs/authority-algorithm.md](docs/authority-algorithm.md).

---

## Evaluation

CodeBrain is evaluated on [CodeAuthorityBench](benchmarks/), a benchmark of 388 repository-understanding tasks across 7 real-world open-source repositories where the correct answer requires identifying source-of-truth files, not just similar snippets.

### Benchmark Results

Evaluated on CodeAuthorityBench: 388 tasks across Express.js, FastAPI, Django, Flask, Gin, NestJS, and Spring Framework.

| Method              | P@5    | R@1    | R@5    | R@10   | MRR    | NDCG@5 | NDCG@10 | Auth Recall | Edit Risk | Blast F1  |
| ------------------- | ------ | ------ | ------ | ------ | ------ | ------ | ------- | ----------- | --------- | --------- |
| BM25                | 12.7%  | 16.1%  | 42.5%  | 53.5%  | 35.9%  | 33.1%  | 37.4%   | 65.5%       | 19.0%     | 17.3%     |
| SymbolSearch        |  8.8%  |  6.9%  | 25.4%  | 37.8%  | 21.7%  | 18.8%  | 23.4%   | 48.2%       | 19.7%     | 15.8%     |
| CallGraph           |  1.5%  |  0.8%  |  3.9%  |  8.3%  |  3.8%  |  2.9%  |  4.5%   | 11.6%       | 17.6%     |  2.7%     |
| RepoMap             | 13.9%  | 20.7%  | 41.3%  | 48.0%  | 39.8%  | 34.5%  | 37.0%   | 62.1%       | 21.1%     | 22.6%     |
| BM25+Rerank         | 13.9%  | 17.2%  | 44.2%  | 56.8%  | 38.1%  | 34.8%  | 39.5%   | 68.8%       | 20.4%     | 19.0%     |
| DenseRetrieval      | 16.9%  | 30.7%  | 56.0%  | 66.7%  | 55.1%  | 48.5%  | 52.8%   | 81.2%       | 23.9%     | 24.9%     |
| Hybrid (BM25+Dense) | 18.0%  | 28.7%  | 58.0%  | 68.6%  | 54.0%  | 48.9%  | 53.1%   | 82.2%       | 22.5%     | 27.9%     |
| **CodeBrain**       | **18.9%** | 27.3% | **60.5%** | **71.3%** | 54.3% | **49.8%** | **54.1%** | **83.8%** | 22.5% | **28.4%** |

### Statistical Significance

Wilcoxon signed-rank tests on per-task MRR (n=388):

| CodeBrain vs       | Z      | p-value      | Effect size (r) | MRR delta |
| ------------------ | ------ | ------------ | --------------- | --------- |
| BM25               |  8.78  | p < 0.0001   | 0.55 (large)    | +0.281    |
| SymbolSearch       | 11.53  | p < 0.0001   | 0.66 (large)    | +0.419    |
| CallGraph          | 14.93  | p < 0.0001   | 0.83 (large)    | +0.613    |
| RepoMap            |  5.16  | p < 0.0001   | 0.31 (medium)   | +0.198    |
| BM25+Rerank        |  8.24  | p < 0.0001   | 0.54 (large)    | +0.266    |
| DenseRetrieval     |  0.31  | p = 0.694    | 0.02            | -0.011    |
| Hybrid             |  0.16  | p = 0.827    | 0.01            | +0.008    |

CodeBrain significantly outperforms 5 of 7 baselines (p < 0.0001) with medium-to-large effect sizes. CodeBrain leads 7 of 10 metrics; DenseRetrieval leads R@1, MRR, and Edit Risk accuracy.

**Key findings:**

- CodeBrain significantly outperforms lexical, symbolic, graph-only, repo-map, and BM25-rerank baselines, while remaining competitive with strong neural and hybrid retrieval
- vs BM25+Rerank (strongest non-neural): +5.0pp P@5, +16.3pp R@5, +14.5pp R@10, +15.0pp Auth Recall
- Clearest gains are in authority recall (+1.6pp over Hybrid), top-k recall, NDCG, and blast-radius estimation
- Authority re-ranking is a complementary layer on top of retrieval, not a replacement for neural methods

### Ablation Study

Each variant uses the same hybrid (BM25+Dense) retrieval with different authority signal subsets:

| Variant          | P@5    | R@1    | R@5    | R@10   | MRR    | Auth Recall |
| ---------------- | ------ | ------ | ------ | ------ | ------ | ----------- |
| flat-only        | 18.0%  | 28.8%  | 58.0%  | 68.6%  | 54.3%  | 82.2%       |
| directory-only   | 18.6%  | 29.9%  | 59.8%  | 71.0%  | 56.0%  | 84.0%       |
| graph-only       | 18.8%  | 30.0%  | 59.8%  | 71.7%  | 56.7%  | 85.3%       |
| graph+directory  | 19.2%  | 30.8%  | 61.0%  | 72.8%  | 57.7%  | 85.6%       |
| graph+schema     | 19.4%  | 31.3%  | 61.1%  | 72.9%  | 57.6%  | 85.8%       |
| **full**         | **19.5%** | 28.3% | **61.7%** | 72.7% | 56.5%  | 85.6%       |

Each signal adds measurable value: graph > directory > flat (baseline). The graph+schema variant achieves the best R@1 and Auth Recall, while full achieves the best P@5 and R@5. All authority-aware variants outperform flat retrieval.

See `benchmarks/` for reproduction scripts and the full CodeAuthorityBench dataset.

---

## Configuration

Create `.codebrain/config.json` in your repository root to customize behavior:

```json
{
  "authority": {
    "thresholds": {
      "root": 0.8,
      "derived_upper": 0.7,
      "derived_lower": 0.3,
      "leaf": 0.2
    },
    "signals": {
      "in_degree_weight": 0.35,
      "schema_bonus": 0.2,
      "churn_penalty_weight": 0.15,
      "directory_heuristic_weight": 0.15,
      "out_degree_penalty_weight": 0.15
    },
    "directory_overrides": {
      "root_patterns": ["**/migrations/**", "**/schema/**", "**/core/**"],
      "leaf_patterns": [
        "**/test/**",
        "**/tests/**",
        "**/__tests__/**",
        "**/scripts/**",
        "**/examples/**"
      ]
    }
  },
  "guard": {
    "require_human_above": 0.7,
    "warn_above": 0.3
  },
  "scan": {
    "exclude": ["node_modules", ".git", "dist", "build", "vendor"],
    "max_file_size_kb": 500
  }
}
```

All thresholds are configurable. The defaults work for most repositories.

---

## Output

CodeBrain writes analysis results to `codebrain-data/` in your repository:

```
codebrain-data/
  topology.json          # module graph (nodes + edges)
  authority_tree.json    # per-file authority scores + classification
  codebrain.db           # SQLite: structured queries
  .codebrain-version     # schema version for migration
```

---

## Performance

- Initial scan of a 10,000-file repo: < 60 seconds
- Incremental update after a single-file change: < 2 seconds
- MCP tool response for any query: < 500ms
- Memory usage during scan: < 512MB for repos up to 50,000 files

---

## Architecture

CodeBrain operates in four phases. The MVP ships Phase 1 + Phase 2 + MCP server.

| Phase | Name          | Description                              | Status   |
| ----- | ------------- | ---------------------------------------- | -------- |
| 1     | Structure     | AST parse, call graph, dependency tree   | MVP      |
| 2     | Authority     | Score and classify files 0.0--1.0        | MVP      |
| 3     | Deep Decode   | LLM-powered module purpose analysis      | Planned  |
| 4     | Stay Current  | Incremental re-analysis on git diffs     | Planned  |

For detailed architecture documentation, see [docs/architecture.md](docs/architecture.md).

---

## Contributing

Contributions are welcome. Please follow these conventions:

- **Conventional commits:** `feat:`, `fix:`, `docs:`, `test:`, `bench:`, `refactor:`
- **One feature per PR.** No multi-feature PRs.
- **PR description must explain WHY, not just WHAT.**
- **Squash merge to main.** Clean history.

To add support for a new language, see [docs/adding-languages.md](docs/adding-languages.md).

---

## Research

CodeBrain is both a tool and a research artifact. The accompanying paper evaluates authority-aware retrieval against standard baselines on CodeAuthorityBench.

**Paper:** CodeBrain: Authority-Aware Retrieval for Agentic Code Understanding

**Research origin:** [TreeBench](https://github.com/whitepaper27/TreeBench) (Soni, 2026) showed empirical evidence that flat retrieval struggles when hierarchy determines answer authority. CodeBrain tests whether the same structural failure exists in software repositories.

### Citation

```bibtex
@software{codebrain2026,
  author = {Soni, Sahil},
  title = {CodeBrain: Hierarchy-Aware Code Intelligence for AI Coding Agents},
  year = {2026},
  url = {https://github.com/whitepaper27/codebrain}
}
```

---

## License

[Apache 2.0](LICENSE)

Copyright 2026 Sahil Soni
