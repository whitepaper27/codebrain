# Architecture

CodeBrain is an authority-aware code retrieval framework. It parses repositories into structural graphs and ranks code by both relevance and behavioral authority. It ships as an MCP server that any compatible agent can query.

## Four Phases

CodeBrain operates in four phases. The MVP includes Phase 1, Phase 2, and the MCP server.

### Phase 1: Structure (MVP)

Deterministic, no LLM.

1. **File discovery** -- walk the repository, respect `.gitignore`, filter by supported extensions.
2. **AST parsing** -- parse each file with tree-sitter using the appropriate language grammar.
3. **Extraction** -- extract imports, exports, definitions, and calls from each AST.
4. **Graph construction** -- build the call graph, import graph, and dependency tree from extracted data.

Output: `codebrain-data/topology.json`

### Phase 2: Authority (MVP)

Deterministic, no LLM.

1. **Walk the topology** -- traverse the dependency graph from Phase 1.
2. **Score each file** -- compute authority score (0.0--1.0) from six weighted signals.
3. **Classify** -- assign ROOT, DERIVED, or LEAF tier based on configurable thresholds.
4. **Compute blast radius** -- calculate transitive closure for downstream impact analysis.

Output: `codebrain-data/authority_tree.json`

### Phase 3: Deep Decode (Post-MVP)

LLM-powered. Per-module purpose analysis, implicit contract detection, assumption extraction.

Output: `codebrain-data/domain_model.json` + `codebrain-data/codebrain.db` (reasoning traces)

### Phase 4: Stay Current (Post-MVP)

Git diff watcher. Incremental re-analysis triggered by repository changes.

Output: `codebrain-data/diff_impact.json`

## Data Flow

```
Repository files
      |
      v
File Discovery (fast-glob + ignore)
      |
      v
AST Parsing (tree-sitter, per-language grammar)
      |
      v
Extraction (imports, exports, definitions, calls)
      |
      v
Graph Builder (call graph + import graph + dependency tree)
      |
      v
topology.json
      |
      v
Authority Scorer (6 weighted signals)
      |
      v
Classifier (ROOT / DERIVED / LEAF)
      |
      v
authority_tree.json
      |
      v
MCP Server (5 tools exposed via stdio)
      |
      v
Agent queries (Claude Code, Cursor, etc.)
```

## Directory Structure

```
codebrain/
  CLAUDE.md                    # project instructions
  README.md                    # public-facing docs
  LICENSE                      # Apache 2.0
  package.json
  tsconfig.json
  .codebrain/                  # example config
    config.json
  src/
    index.ts                   # CLI entry point
    mcp-server.ts              # MCP server entry point
    scanner/
      file-discovery.ts        # respect .gitignore, find source files
      ast-parser.ts            # tree-sitter orchestrator
      graph-builder.ts         # build call/import/dependency graph
    parsers/                   # per-language tree-sitter extractors
      base.ts                  # ILanguageParser interface
      typescript.ts
      python.ts
      c.ts
      java.ts
      go.ts
      index.ts                 # registry: extension -> parser
    authority/
      scorer.ts                # authority scoring algorithm
      classifier.ts            # root / derived / leaf classification
      blast-radius.ts          # transitive dependency impact
    tools/                     # MCP tool implementations
      search.ts                # search_with_hierarchy
      explain.ts               # explain_module_authority
      blast-radius.ts          # diff_blast_radius
      guard.ts                 # guard_change
      contracts.ts             # find_contracts (Phase 3)
    storage/
      sqlite.ts                # structured data store
      json-output.ts           # topology.json, authority_tree.json writers
      chromadb.ts              # vector store (Phase 3, stubbed)
    utils/
      git.ts                   # git history, churn, diff watching
      config.ts                # .codebrain/config.json reader
      logger.ts                # structured logging
  tests/
    fixtures/                  # small repos with known authority patterns
    scanner/
    authority/
    tools/
    integration/               # end-to-end tests
  benchmarks/
    vs-flat-search/
    datasets/
  docs/
    architecture.md            # this file
    authority-algorithm.md
    adding-languages.md
```

## Storage Layer

```
codebrain-data/
  topology.json          # module graph (nodes + edges)
  authority_tree.json    # per-file authority scores + classification
  codebrain.db           # SQLite: structured queries, reasoning traces
  .codebrain-version     # schema version for migration
```

- **SQLite** is the primary store for structured data.
- **JSON files** (topology, authority tree) are human-readable and diffable.
- **ChromaDB** is additive for semantic search in Phase 3.

## MCP Server

The MCP server communicates over stdio and exposes five tools:

| Tool                       | Purpose                                              | Phase |
| -------------------------- | ---------------------------------------------------- | ----- |
| `search_with_hierarchy`    | Find code ranked by authority, not just similarity   | MVP   |
| `explain_module_authority` | Explain why a file is root, derived, or leaf         | MVP   |
| `diff_blast_radius`        | Show downstream impact of a proposed change          | MVP   |
| `guard_change`             | Warn or block when agent touches high-authority code | MVP   |
| `find_contracts`           | Surface implicit assumptions between modules         | 3     |

Every tool returns structured JSON with an `authority` field. Agents never receive flat results.

## Key Dependencies

| Package                       | Purpose                    |
| ----------------------------- | -------------------------- |
| tree-sitter                   | AST parsing (multi-language) |
| tree-sitter-typescript        | TS/JS grammar              |
| tree-sitter-python            | Python grammar             |
| tree-sitter-c                 | C grammar                  |
| tree-sitter-java              | Java grammar               |
| @modelcontextprotocol/sdk     | MCP server SDK             |
| better-sqlite3                | SQLite storage             |
| fast-glob                     | File discovery             |
| ignore                        | .gitignore parsing         |
| simple-git                    | Git history/churn analysis |

## Design Principles

- **Deterministic** -- the MVP uses no LLM, no embeddings, no randomness. The same repository always produces the same authority scores.
- **Local-first** -- all analysis runs locally. No cloud services, no data exfiltration.
- **Infrastructure, not application** -- CodeBrain sits below agents and above the filesystem. It never modifies code.
- **MCP-native** -- ships as an MCP server, works with any MCP-compatible agent without custom integration.
