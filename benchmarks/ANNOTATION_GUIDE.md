# CodeAuthorityBench Annotation Guide

## Overview

CodeAuthorityBench evaluates whether retrieval systems can identify **structurally authoritative** files in software repositories — files that govern system behavior, not just files that match a query.

Each task consists of:
- A natural-language **query** about the repository
- A **task type** (one of four categories)
- A set of **ground-truth authoritative files** that a senior engineer would consult first
- The **repository** the task applies to

## Task Types

### 1. `what_governs` — "What governs X?"

Identify the source-of-truth file(s) for a given behavior or concept.

**Examples:**
- "What file controls how HTTP requests are routed to handlers?"
- "What governs user authentication in this application?"

**Ground truth criteria:** The file(s) that define the core logic, not wrappers, adapters, or consumers.

### 2. `where_is_schema` — "Where is the schema for X?"

Locate the defining schema, interface, type, or contract for a concept.

**Examples:**
- "Where is the database model for users defined?"
- "Where is the Request type/interface defined?"

**Ground truth criteria:** The file(s) that define the type, schema, or contract — not files that import or use it.

### 3. `what_breaks` — "What breaks if Z changes?"

Predict the blast radius of modifying a specific file.

**Examples:**
- "What breaks if the main router configuration changes?"
- "What breaks if the database connection module is modified?"

**Ground truth criteria:** Files with direct or transitive dependencies on the target file that would be functionally affected. Include both direct importers and files that depend on the target's behavior transitively. Exclude test files unless the test is specifically testing the target.

### 4. `is_safe_to_modify` — "Is it safe to modify Y?"

Assess whether modifying a file carries high downstream risk.

**Examples:**
- "Is it safe to modify the logging utility?"
- "Is it safe to modify the core middleware chain?"

**Ground truth criteria:** The file itself plus files that would be affected. High-authority files (many dependents, defines schemas) should have more ground-truth files reflecting their blast radius. Low-authority files (leaf nodes, tests) should have fewer.

## Ground Truth Selection Criteria

A file is **authoritative** for a query if:

1. It **defines** the behavior or schema being asked about (not just references it)
2. It is the file a **senior engineer** would open first when investigating the query
3. Other files **depend on it** for the queried behavior (it is upstream, not downstream)
4. Modifying it would **change the behavior** described in the query

A file is **NOT** authoritative if:
- It merely imports or calls the authoritative file
- It is a test that exercises the behavior
- It is documentation or comments about the behavior
- It is a wrapper or adapter that delegates to the real implementation

## File Path Format

All file paths in ground truth must be **relative to the repository root**, using forward slashes:

- `lib/router/index.js` (correct)
- `D:\repos\express\lib\router\index.js` (incorrect — absolute path)
- `lib\router\index.js` (incorrect — backslashes)

## Task JSON Format

```json
{
  "id": "flask-001",
  "repo": "flask",
  "query": "What file controls how Flask handles incoming HTTP requests?",
  "task_type": "what_governs",
  "ground_truth_files": [
    "src/flask/app.py",
    "src/flask/wrappers.py"
  ],
  "difficulty": "easy",
  "annotation_method": "manual",
  "annotator_id": "codebrain-team",
  "annotation_date": "2026-06-28",
  "rationale": "app.py contains the Flask class with wsgi_app() and full_dispatch_request(). wrappers.py defines Request/Response classes."
}
```

## Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique ID: `{repo}-{number}` (e.g., `flask-001`) |
| `repo` | string | Repository name matching `benchmarks/repos/{name}` |
| `query` | string | Natural-language question |
| `task_type` | string | One of: `what_governs`, `where_is_schema`, `what_breaks`, `is_safe_to_modify` |
| `ground_truth_files` | string[] | List of relative file paths |
| `difficulty` | string | `easy`, `medium`, or `hard` |
| `annotation_method` | string | `manual` or `llm-assisted-validated` |
| `annotator_id` | string | Annotator identifier |
| `annotation_date` | string | ISO date (YYYY-MM-DD) |
| `rationale` | string | Brief explanation of why these files are authoritative |

## Task Distribution Guidelines

Per repository, aim for:
- **50-80 tasks total**
- ~30% `what_governs` (most common real-world query)
- ~25% `where_is_schema`
- ~25% `what_breaks`
- ~20% `is_safe_to_modify`

Difficulty distribution:
- ~30% easy (obvious ROOT files, well-named)
- ~40% medium (requires understanding dependency structure)
- ~30% hard (indirect authority, dynamic dispatch, implicit contracts)

## Annotation Methodology

### Manual annotation
1. Read the repository's README and architecture docs
2. Examine the dependency graph (use `codebrain scan` or read import statements)
3. Identify core files by in-degree (how many files import them)
4. Write the query as a natural-language question a developer would ask
5. Select ground-truth files based on the criteria above
6. Write a rationale explaining the selection

### LLM-assisted annotation (with validation)
1. Use an LLM to generate candidate tasks and ground-truth files
2. Validate each task manually by checking:
   - Ground-truth files actually exist in the repo
   - Ground-truth files are genuinely authoritative (check imports/dependents)
   - Query is natural and answerable
   - Rationale is accurate
3. Mark `annotation_method` as `llm-assisted-validated`

## Inter-Annotator Agreement

For a 100-task sample across repos:
1. Two annotators independently select ground-truth files for each task
2. Compute Cohen's kappa on binary file-level agreement (is file X in ground truth? yes/no)
3. Report in the paper with per-task-type breakdown

## Quality Checks

Before including a task:
- [ ] All ground-truth files exist in the repository
- [ ] At least 1 ground-truth file is a high-authority file (in-degree > 0 or defines schemas)
- [ ] Query is specific enough that a developer could answer it
- [ ] Rationale explains why each ground-truth file was selected
- [ ] Task type matches the query format
