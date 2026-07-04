/**
 * Integration test for MCP tools.
 * Runs the full scan pipeline on the simple-webapp fixture,
 * then tests each tool function directly against the output.
 */

import { join } from 'node:path';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadConfig } from '../../src/utils/config.js';
import { discoverFiles } from '../../src/scanner/file-discovery.js';
import { parseAllFiles } from '../../src/scanner/ast-parser.js';
import { buildGraph } from '../../src/scanner/graph-builder.js';
import {
  writeTopology, writeAuthorityTree,
} from '../../src/storage/json-output.js';
import type { AuthorityTree, AuthorityEntry } from '../../src/storage/json-output.js';
import { analyzeChurn } from '../../src/utils/git.js';
import { scoreAuthority } from '../../src/authority/scorer.js';
import { classifyFiles } from '../../src/authority/classifier.js';
import { computeAllBlastRadii } from '../../src/authority/blast-radius.js';
import {
  openDatabase, storeFiles, storeEdges, storeMetadata,
} from '../../src/storage/sqlite.js';
import { loadData, clearCache } from '../../src/tools/data-loader.js';
import type { LoadedData } from '../../src/tools/data-loader.js';
import { searchWithHierarchy } from '../../src/tools/search.js';
import { explainModuleAuthority } from '../../src/tools/explain.js';
import { diffBlastRadius } from '../../src/tools/blast-radius.js';
import { guardChange } from '../../src/tools/guard.js';
import { findContracts } from '../../src/tools/contracts.js';

const FIXTURE_PATH = join(
  import.meta.dirname, '../fixtures/simple-webapp',
);
const OUTPUT_DIR = join(FIXTURE_PATH, 'codebrain-data');

let data: LoadedData;

beforeAll(async () => {
  // Run full scan pipeline
  const config = loadConfig(FIXTURE_PATH);
  const files = await discoverFiles(FIXTURE_PATH, config);
  const parseResults = await parseAllFiles(files);
  const graph = buildGraph(parseResults);
  writeTopology(FIXTURE_PATH, graph);

  const churnData = await analyzeChurn(FIXTURE_PATH);
  const scored = scoreAuthority(graph, config, churnData);
  const classified = classifyFiles(scored, config);
  const blastRadii = computeAllBlastRadii(graph);

  // Build authority tree
  const entries: AuthorityEntry[] = classified.map((f) => {
    const br = blastRadii.get(f.filePath);
    return {
      file: f.filePath,
      authority_score: f.score,
      authority_tier: f.tier,
      reason: f.reason,
      in_degree: f.metrics.inDegree,
      out_degree: f.metrics.outDegree,
      churn_percentile: f.metrics.churnPercentile,
      definitions_count: f.metrics.definitionsCount,
      blast_radius_direct: br?.counts.direct ?? 0,
      blast_radius_transitive: br?.counts.transitive ?? 0,
    };
  });

  let rootCount = 0;
  let derivedCount = 0;
  let leafCount = 0;
  for (const e of entries) {
    if (e.authority_tier === 'ROOT') rootCount++;
    else if (e.authority_tier === 'DERIVED') derivedCount++;
    else leafCount++;
  }

  const authorityTree: AuthorityTree = {
    entries,
    metadata: {
      computedAt: new Date().toISOString(),
      fileCount: entries.length,
      rootCount,
      derivedCount,
      leafCount,
    },
  };
  writeAuthorityTree(FIXTURE_PATH, authorityTree);

  // Persist to SQLite
  const db = openDatabase(FIXTURE_PATH);
  storeFiles(db, classified, blastRadii);
  storeEdges(db, graph.edges);
  storeMetadata(db, {
    scannedAt: new Date().toISOString(),
    fileCount: String(graph.nodes.length),
    edgeCount: String(graph.edges.length),
  });
  db.close();

  // Load data for tools
  data = loadData(FIXTURE_PATH);
});

afterAll(() => {
  clearCache();
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// search_with_hierarchy
// ---------------------------------------------------------------------------

describe('search_with_hierarchy', () => {
  it('returns results matching the query', () => {
    const result = searchWithHierarchy(data, 'schema');
    expect(result.tool).toBe('search_with_hierarchy');
    expect(result.query).toBe('schema');
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('returns ROOT files before LEAF files for core queries', () => {
    const result = searchWithHierarchy(data, 'database');
    expect(result.results.length).toBeGreaterThan(0);

    // database.ts (high authority) should come before test files
    const dbIndex = result.results.findIndex(
      (r) => r.file.includes('core/database'),
    );
    expect(dbIndex).toBeGreaterThanOrEqual(0);

    // If any test files match, they should be ranked lower
    const testIndex = result.results.findIndex(
      (r) => r.file.includes('test'),
    );
    if (testIndex >= 0) {
      expect(dbIndex).toBeLessThan(testIndex);
    }
  });

  it('respects top_k limit', () => {
    const result = searchWithHierarchy(data, 'service', 2);
    expect(result.results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty results for non-matching queries', () => {
    const result = searchWithHierarchy(
      data, 'xyznonexistent123',
    );
    expect(result.results).toHaveLength(0);
  });

  it('includes required fields in each result', () => {
    const result = searchWithHierarchy(data, 'schema');
    for (const r of result.results) {
      expect(r).toHaveProperty('file');
      expect(r).toHaveProperty('authority_score');
      expect(r).toHaveProperty('authority_tier');
      expect(r).toHaveProperty('reason');
      expect(r).toHaveProperty('dependents');
      expect(r).toHaveProperty('dependencies');
    }
  });
});

// ---------------------------------------------------------------------------
// explain_module_authority
// ---------------------------------------------------------------------------

describe('explain_module_authority', () => {
  it('returns signal breakdown for a known file', () => {
    const result = explainModuleAuthority(
      data, 'src/core/schema.ts',
    );
    expect(result.tool).toBe('explain_module_authority');
    expect(result.file).toBe('src/core/schema.ts');
    expect(result.authority_score).toBeGreaterThan(0);
    expect(result.authority_tier).toBeDefined();
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('includes dependency lists', () => {
    const result = explainModuleAuthority(
      data, 'src/services/user-service.ts',
    );
    expect(result.dependents.length).toBeGreaterThanOrEqual(0);
    expect(result.dependencies.length).toBeGreaterThan(0);
  });

  it('returns UNKNOWN tier for nonexistent files', () => {
    const result = explainModuleAuthority(
      data, 'nonexistent.ts',
    );
    expect(result.authority_tier).toBe('UNKNOWN');
    expect(result.authority_score).toBe(0);
  });

  it('includes metrics in the response', () => {
    const result = explainModuleAuthority(
      data, 'src/core/database.ts',
    );
    expect(result.metrics).toHaveProperty('in_degree');
    expect(result.metrics).toHaveProperty('out_degree');
    expect(result.metrics).toHaveProperty('definitions_count');
    expect(result.metrics).toHaveProperty('blast_radius_direct');
    expect(result.metrics).toHaveProperty('blast_radius_transitive');
  });
});

// ---------------------------------------------------------------------------
// diff_blast_radius
// ---------------------------------------------------------------------------

describe('diff_blast_radius', () => {
  it('returns dependents for a core file', () => {
    const result = diffBlastRadius(
      data, ['src/core/schema.ts'],
    );
    expect(result.tool).toBe('diff_blast_radius');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.file).toBe('src/core/schema.ts');
    expect(result.files[0]!.counts.transitive).toBeGreaterThan(0);
  });

  it('handles multiple files', () => {
    const result = diffBlastRadius(data, [
      'src/core/schema.ts',
      'src/core/database.ts',
    ]);
    expect(result.files).toHaveLength(2);
    expect(result.total_affected).toBeGreaterThan(0);
  });

  it('returns zero dependents for leaf files', () => {
    const result = diffBlastRadius(
      data, ['src/index.ts'],
    );
    expect(result.files[0]!.counts.direct).toBe(0);
  });

  it('includes authority scores on affected files', () => {
    const result = diffBlastRadius(
      data, ['src/core/schema.ts'],
    );
    for (const dep of result.files[0]!.direct_dependents) {
      expect(dep).toHaveProperty('authority_score');
      expect(dep).toHaveProperty('authority_tier');
    }
  });
});

// ---------------------------------------------------------------------------
// guard_change
// ---------------------------------------------------------------------------

describe('guard_change', () => {
  it('returns SAFE for leaf files', () => {
    const result = guardChange(data, 'src/index.ts', 'modify');
    expect(result.tool).toBe('guard_change');
    expect(result.verdict).toBe('SAFE');
  });

  it('returns correct verdict structure', () => {
    const result = guardChange(
      data, 'src/core/schema.ts', 'modify',
    );
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('authority_score');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('blast_radius');
    expect(result).toHaveProperty('recommendation');
    expect(result.blast_radius).toHaveProperty('direct_dependents');
    expect(result.blast_radius).toHaveProperty('transitive_dependents');
  });

  it('handles unknown files gracefully', () => {
    const result = guardChange(data, 'nonexistent.ts', 'delete');
    expect(result.verdict).toBe('SAFE');
    expect(result.authority_score).toBe(0);
  });

  it('distinguishes change types', () => {
    const modify = guardChange(
      data, 'src/core/schema.ts', 'modify',
    );
    const del = guardChange(
      data, 'src/core/schema.ts', 'delete',
    );
    expect(modify.change_type).toBe('modify');
    expect(del.change_type).toBe('delete');
  });

  it('returns higher concern for high-authority files', () => {
    const schema = guardChange(
      data, 'src/core/schema.ts', 'modify',
    );
    const index = guardChange(data, 'src/index.ts', 'modify');

    expect(schema.authority_score).toBeGreaterThan(
      index.authority_score,
    );
  });
});

// ---------------------------------------------------------------------------
// find_contracts (stub)
// ---------------------------------------------------------------------------

describe('find_contracts', () => {
  it('returns Phase 3 status message', () => {
    const result = findContracts();
    expect(result.tool).toBe('find_contracts');
    expect(result.status).toContain('Phase 3');
  });
});
