/**
 * Integration test for the scanner pipeline.
 * Runs file discovery, AST parsing, graph building, and topology output
 * against the simple-webapp fixture, then verifies the results match
 * the expected dependency structure in GROUND_TRUTH.json.
 */

import { join } from 'node:path';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { discoverFiles } from '../../src/scanner/file-discovery.js';
import { parseAllFiles } from '../../src/scanner/ast-parser.js';
import { buildGraph } from '../../src/scanner/graph-builder.js';
import { writeTopology } from '../../src/storage/json-output.js';
import { loadConfig } from '../../src/utils/config.js';
import type { TopologyGraph } from '../../src/parsers/base.js';

/** Ground truth structure loaded from the fixture. */
interface GroundTruth {
  expected_authority_ranking: Array<{
    file: string;
    tier: string;
    min_score?: number;
  }>;
  expected_imports: Record<string, string[]>;
  expected_in_degrees: Record<string, number>;
}

const FIXTURE_PATH = join(import.meta.dirname, '../fixtures/simple-webapp');
const OUTPUT_DIR = join(FIXTURE_PATH, 'codebrain-data');

let graph: TopologyGraph;
let groundTruth: GroundTruth;

beforeAll(async () => {
  groundTruth = JSON.parse(
    readFileSync(join(FIXTURE_PATH, 'GROUND_TRUTH.json'), 'utf-8'),
  ) as GroundTruth;

  const config = loadConfig(FIXTURE_PATH);
  const files = await discoverFiles(FIXTURE_PATH, config);
  const parseResults = await parseAllFiles(files);
  graph = buildGraph(parseResults);
});

afterAll(() => {
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

describe('file discovery', () => {
  it('discovers all 10 fixture files', () => {
    expect(graph.nodes.length).toBe(10);
  });

  it('detects all files as TypeScript', () => {
    for (const node of graph.nodes) {
      expect(node.language).toBe('typescript');
    }
  });

  it('includes every expected file from ground truth', () => {
    const filePaths = new Set(graph.nodes.map((n) => n.filePath));
    for (const entry of groundTruth.expected_authority_ranking) {
      expect(filePaths.has(entry.file)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Import edge resolution
// ---------------------------------------------------------------------------

describe('import edges', () => {
  it('resolves all expected import edges', () => {
    const importEdges = graph.edges.filter((e) => e.type === 'import');

    for (const [sourceFile, expectedTargets] of Object.entries(
      groundTruth.expected_imports,
    )) {
      for (const expectedTarget of expectedTargets) {
        const found = importEdges.some(
          (e) => e.source === sourceFile && e.target === expectedTarget,
        );
        expect(
          found,
          `Expected import edge: ${sourceFile} -> ${expectedTarget}`,
        ).toBe(true);
      }
    }
  });

  it('has the correct total number of import edges', () => {
    const importEdges = graph.edges.filter((e) => e.type === 'import');
    const expectedCount = Object.values(groundTruth.expected_imports)
      .reduce((sum, targets) => sum + targets.length, 0);
    expect(importEdges.length).toBe(expectedCount);
  });

  it('does not contain self-edges', () => {
    for (const edge of graph.edges) {
      expect(edge.source).not.toBe(edge.target);
    }
  });
});

// ---------------------------------------------------------------------------
// In-degree verification
// ---------------------------------------------------------------------------

describe('in-degree counts', () => {
  it('matches expected in-degrees for all files', () => {
    const nodeMap = new Map(graph.nodes.map((n) => [n.filePath, n]));

    for (const [file, expectedDegree] of Object.entries(
      groundTruth.expected_in_degrees,
    )) {
      const node = nodeMap.get(file);
      expect(node, `Node not found: ${file}`).toBeDefined();
      expect(
        node!.inDegree,
        `In-degree mismatch for ${file}: expected ${expectedDegree}, got ${node!.inDegree}`,
      ).toBe(expectedDegree);
    }
  });

  it('database.ts has the highest in-degree (imports + calls)', () => {
    const sorted = [...graph.nodes].sort((a, b) => b.inDegree - a.inDegree);
    expect(sorted[0].filePath).toBe('src/core/database.ts');
  });

  it('schema.ts has zero out-degree (pure provider)', () => {
    const schemaNode = graph.nodes.find(
      (n) => n.filePath === 'src/core/schema.ts',
    );
    expect(schemaNode).toBeDefined();
    expect(schemaNode!.outDegree).toBe(0);
  });

  it('test files have zero in-degree', () => {
    const testNodes = graph.nodes.filter((n) =>
      n.filePath.startsWith('tests/'),
    );
    for (const node of testNodes) {
      expect(
        node.inDegree,
        `Test file ${node.filePath} should have 0 in-degree`,
      ).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Topology output
// ---------------------------------------------------------------------------

describe('topology.json output', () => {
  it('writes a valid topology.json file', () => {
    const outputPath = writeTopology(FIXTURE_PATH, graph);
    expect(existsSync(outputPath)).toBe(true);

    const written = JSON.parse(
      readFileSync(outputPath, 'utf-8'),
    ) as TopologyGraph;
    expect(written.nodes.length).toBe(graph.nodes.length);
    expect(written.edges.length).toBe(graph.edges.length);
    expect(written.metadata.fileCount).toBe(10);
    expect(written.metadata.languages['typescript']).toBe(10);
  });

  it('topology.json contains correct metadata', () => {
    const outputPath = join(OUTPUT_DIR, 'topology.json');
    const written = JSON.parse(
      readFileSync(outputPath, 'utf-8'),
    ) as TopologyGraph;

    expect(written.metadata.scannedAt).toBeDefined();
    expect(written.metadata.edgeCount).toBeGreaterThan(0);
  });
});
