# Authority Scoring Algorithm

This document specifies the authority scoring algorithm used by CodeBrain to rank files by structural importance.

## Overview

Authority is a graph-based property. It measures how much structural control a file has over downstream behavior in a codebase. Files that many other modules depend on, that define schemas and interfaces, and that remain stable over time receive higher authority scores.

The scoring is deterministic. The same repository and configuration always produce the same scores. No LLM, no embeddings, no randomness between runs.

## Formula

```
Authority(file) = w1 * dependency_centrality
               + w2 * reverse_dependency_count
               + w3 * schema_config_interface_ownership
               + w4 * churn_stability
               + w5 * directory_prior
               + w6 * test_reference_coverage
```

The output is a float in the range [0.0, 1.0]. Each signal is normalized to [0.0, 1.0] before weighting.

## Signal Descriptions

### 1. Dependency Centrality (`w1`, default: 0.35)

Measures the file's centrality in the import/call graph. Files that sit at the center of the dependency network -- imported by many modules, on many dependency paths -- receive higher scores.

Computed as normalized PageRank or betweenness centrality over the import graph.

**High centrality:** A database schema module imported by 40 service files.
**Low centrality:** A utility function used by one test file.

### 2. Reverse Dependency Count (`w2`, default: 0.15)

The raw count of modules that directly or transitively depend on this file, normalized against the maximum in the repository.

This is simpler than centrality but captures a direct measure of blast radius: if this file breaks, how many files are affected?

### 3. Schema/Config/Interface Ownership (`w3`, default: 0.20)

Detects whether the file defines types, interfaces, schemas, configuration, or contracts that other modules consume. Identified via AST analysis:

- TypeScript/JavaScript: `interface`, `type`, `enum`, exported type definitions
- Python: class definitions in `models/`, `schema/`, or `types/` directories; dataclass/Pydantic model decorators
- Java: `interface` declarations, abstract classes
- C: struct definitions in header files, `#define` constants
- Go: `type` declarations, interface definitions

Files that define contracts consumed by others score higher than files that only implement logic.

### 4. Churn Stability (`w4`, default: 0.15)

Measures how stable the file is over git history. Files that change rarely are more likely to be foundational. Files that change frequently may be under active development or may be volatile implementation details.

Computed as `1 - normalized_churn`, where churn is the number of commits touching this file relative to the repository median.

**High stability:** A database migration file last modified 6 months ago.
**Low stability:** A UI component modified 12 times this month.

Note: Churn is a heuristic. Some stable files are simply abandoned, and some high-churn files are actively maintained core modules. The other signals compensate for these edge cases.

### 5. Directory Prior (`w5`, default: 0.15)

A heuristic based on the file's directory path. Certain directory names strongly predict authority tier.

**Root-biased patterns** (increase score):
- `**/core/**`
- `**/schema/**`
- `**/migrations/**`
- `**/config/**`
- `**/models/**`
- `**/types/**`

**Leaf-biased patterns** (decrease score):
- `**/test/**`, `**/tests/**`, `**/__tests__/**`
- `**/scripts/**`
- `**/examples/**`
- `**/fixtures/**`
- `**/mocks/**`

These patterns are configurable via `.codebrain/config.json` under `authority.directory_overrides`.

### 6. Test Reference Coverage (`w6`, default: implicit)

Files that are heavily referenced by test files have their authority modulated. Being tested does not make a file authoritative, but a core module with strong test coverage is more likely to be intentionally maintained as a source of truth.

This signal is secondary and currently folded into the dependency centrality computation (test files create inbound edges).

## Classification Tiers

After computing the authority score, files are classified into tiers:

| Tier    | Score Range | Description                                          |
| ------- | ----------- | ---------------------------------------------------- |
| ROOT    | 0.8 -- 1.0  | Source-of-truth files. Schemas, core domain, configs. |
| DERIVED | 0.3 -- 0.7  | Implementation files. Services, controllers, adapters.|
| LEAF    | 0.0 -- 0.2  | Tests, scripts, one-offs, generated code.             |

The gap between 0.2 and 0.3 and between 0.7 and 0.8 is intentional. Files in these ranges are borderline and may be classified differently depending on configuration. Consumers can set their own thresholds.

### Threshold Configuration

```json
{
  "authority": {
    "thresholds": {
      "root": 0.8,
      "derived_upper": 0.7,
      "derived_lower": 0.3,
      "leaf": 0.2
    }
  }
}
```

## Worked Example

Consider a small Express.js application:

```
src/
  models/user.ts          # defines User interface, Prisma schema
  models/order.ts         # defines Order interface, Prisma schema
  services/user-service.ts  # implements user CRUD, imports user.ts
  services/order-service.ts # implements order CRUD, imports order.ts, user.ts
  api/user-endpoint.ts    # Express route, imports user-service.ts
  api/order-endpoint.ts   # Express route, imports order-service.ts
  utils/logger.ts         # logging utility, imported by services
  config/database.ts      # database connection config
  app.ts                  # Express app setup, imports all endpoints
tests/
  user-service.test.ts    # tests user-service.ts
```

### Step 1: Build the dependency graph

```
user.ts         <- user-service.ts, order-service.ts, user-service.test.ts
order.ts        <- order-service.ts
user-service.ts <- user-endpoint.ts, user-service.test.ts
order-service.ts <- order-endpoint.ts
logger.ts       <- user-service.ts, order-service.ts
database.ts     <- user-service.ts, order-service.ts
app.ts          <- (entry point, no dependents)
```

### Step 2: Compute signals

| File                  | Centrality | Rev. Deps | Schema | Churn Stab. | Dir. Prior | Raw Score |
| --------------------- | ---------- | --------- | ------ | ----------- | ---------- | --------- |
| models/user.ts        | 0.95       | 3         | 1.0    | 0.9         | 1.0        | **0.92**  |
| models/order.ts       | 0.60       | 1         | 1.0    | 0.9         | 1.0        | **0.78**  |
| config/database.ts    | 0.50       | 2         | 0.5    | 0.95        | 1.0        | **0.72**  |
| services/user-service | 0.40       | 2         | 0.0    | 0.6         | 0.5        | **0.38**  |
| services/order-service| 0.30       | 1         | 0.0    | 0.6         | 0.5        | **0.32**  |
| utils/logger.ts       | 0.35       | 2         | 0.0    | 0.8         | 0.3        | **0.34**  |
| api/user-endpoint.ts  | 0.10       | 0         | 0.0    | 0.5         | 0.5        | **0.18**  |
| api/order-endpoint.ts | 0.10       | 0         | 0.0    | 0.5         | 0.5        | **0.18**  |
| app.ts                | 0.05       | 0         | 0.0    | 0.7         | 0.5        | **0.20**  |
| user-service.test.ts  | 0.00       | 0         | 0.0    | 0.4         | 0.0        | **0.06**  |

### Step 3: Classify

| File                  | Score  | Tier    |
| --------------------- | ------ | ------- |
| models/user.ts        | 0.92   | ROOT    |
| models/order.ts       | 0.78   | DERIVED |
| config/database.ts    | 0.72   | DERIVED |
| services/user-service | 0.38   | DERIVED |
| utils/logger.ts       | 0.34   | DERIVED |
| services/order-service| 0.32   | DERIVED |
| app.ts                | 0.20   | LEAF    |
| api/user-endpoint.ts  | 0.18   | LEAF    |
| api/order-endpoint.ts | 0.18   | LEAF    |
| user-service.test.ts  | 0.06   | LEAF    |

The model files rank highest because they define the interfaces that multiple services consume. The test file and API endpoints rank lowest because nothing depends on them.

## Ablation Variants

For research evaluation, each signal can be zeroed out independently by setting its weight to 0 in the configuration:

| Variant          | Configuration                                             |
| ---------------- | --------------------------------------------------------- |
| Graph-only       | Set `schema_bonus`, `churn_penalty_weight`, `directory_heuristic_weight` to 0 |
| Directory-only   | Set `in_degree_weight`, `schema_bonus`, `churn_penalty_weight` to 0 |
| Graph + churn    | Set `schema_bonus`, `directory_heuristic_weight` to 0     |
| Graph + schema   | Set `churn_penalty_weight`, `directory_heuristic_weight` to 0 |
| Full CodeBrain   | Default weights                                           |

This allows ablation studies without any code changes.

## Weight Configuration

Override default weights in `.codebrain/config.json`:

```json
{
  "authority": {
    "signals": {
      "in_degree_weight": 0.35,
      "schema_bonus": 0.2,
      "churn_penalty_weight": 0.15,
      "directory_heuristic_weight": 0.15,
      "out_degree_penalty_weight": 0.15
    }
  }
}
```

Weights do not need to sum to 1.0. They are normalized internally.
