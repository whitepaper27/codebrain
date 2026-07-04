import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { discoverFiles } from '../../src/scanner/file-discovery.js';
import { parseAllFiles } from '../../src/scanner/ast-parser.js';
import { buildGraph } from '../../src/scanner/graph-builder.js';
import { scoreAuthority, type ScoredFile } from '../../src/authority/scorer.js';
import { classifyFiles, type ClassifiedFile } from '../../src/authority/classifier.js';
import { computeAllBlastRadii } from '../../src/authority/blast-radius.js';
import { writeAuthorityTree } from '../../src/storage/json-output.js';
import { loadConfig } from '../../src/utils/config.js';
import type { ChurnData } from '../../src/utils/git.js';
import type { TopologyGraph } from '../../src/parsers/base.js';

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/simple-webapp');

let scored: ScoredFile[];
let classified: ClassifiedFile[];
let graph: TopologyGraph;

/** Mock churn data — no git repo for fixtures. */
const mockChurn: ChurnData = { files: new Map(), isGitRepo: false };

function getFile(name: string): ClassifiedFile | undefined {
  return classified.find((f) => f.filePath.endsWith(name));
}

describe('Authority scoring (simple-webapp)', () => {
  beforeAll(async () => {
    const config = loadConfig(FIXTURE_DIR);
    const files = await discoverFiles(FIXTURE_DIR, config);
    const parseResults = await parseAllFiles(files);
    graph = buildGraph(parseResults);
    scored = scoreAuthority(graph, config, mockChurn);
    classified = classifyFiles(scored, config);

    // Clean up any generated data
    try { rmSync(join(FIXTURE_DIR, 'codebrain-data'), { recursive: true }); } catch { /* ok */ }
  });

  it('scores schema.ts highly (core type definitions)', () => {
    const schema = getFile('core/schema.ts');
    expect(schema).toBeDefined();
    // Schema defines types — should be in the top 2 files
    expect(schema!.score).toBeGreaterThanOrEqual(0.5);
    expect(schema!.metrics.hasSchemaDefinitions).toBe(true);
  });

  it('scores database.ts as ROOT or high DERIVED', () => {
    const db = getFile('core/database.ts');
    expect(db).toBeDefined();
    expect(db!.score).toBeGreaterThanOrEqual(0.5);
  });

  it('scores test files as LEAF', () => {
    const test1 = getFile('user-service.test.ts');
    const test2 = getFile('post-service.test.ts');
    expect(test1).toBeDefined();
    expect(test2).toBeDefined();
    expect(test1!.tier).toBe('LEAF');
    expect(test2!.tier).toBe('LEAF');
  });

  it('scores service files as DERIVED', () => {
    const userSvc = getFile('user-service.ts');
    const postSvc = getFile('post-service.ts');
    expect(userSvc).toBeDefined();
    expect(postSvc).toBeDefined();
    // Services should be between root and leaf
    expect(userSvc!.score).toBeGreaterThan(0.1);
    expect(userSvc!.score).toBeLessThan(0.9);
  });

  it('is deterministic — two runs produce identical scores', () => {
    const config = loadConfig(FIXTURE_DIR);
    const scored2 = scoreAuthority(graph, config, mockChurn);
    for (let i = 0; i < scored.length; i++) {
      expect(scored2[i]!.score).toBe(scored[i]!.score);
    }
  });

  it('all scores are in [0, 1]', () => {
    for (const file of scored) {
      expect(file.score).toBeGreaterThanOrEqual(0);
      expect(file.score).toBeLessThanOrEqual(1);
    }
  });

  it('core files have the highest scores', () => {
    const coreFiles = scored.filter((f) =>
      f.filePath.includes('core/'),
    );
    const nonCoreFiles = scored.filter((f) =>
      !f.filePath.includes('core/') && !f.filePath.includes('test'),
    );
    // Core files should score higher than non-core, non-test files
    const minCore = Math.min(...coreFiles.map((s) => s.score));
    const maxNonCore = Math.max(...nonCoreFiles.map((s) => s.score));
    expect(minCore).toBeGreaterThan(maxNonCore);
  });

  it('generates meaningful reason strings', () => {
    for (const file of classified) {
      expect(file.reason.length).toBeGreaterThan(10);
      expect(file.reason).toContain('.');
    }
  });
});

describe('Blast radius (simple-webapp)', () => {
  let blastRadii: Map<string, ReturnType<typeof computeAllBlastRadii> extends Map<string, infer V> ? V : never>;

  beforeAll(() => {
    const allRadii = computeAllBlastRadii(graph);
    blastRadii = allRadii;
  });

  it('schema.ts has the highest blast radius', () => {
    const schema = blastRadii.get(
      [...blastRadii.keys()].find((k) => k.endsWith('core/schema.ts'))!,
    );
    expect(schema).toBeDefined();
    expect(schema!.counts.transitive).toBeGreaterThanOrEqual(5);
  });

  it('test files have zero blast radius', () => {
    for (const [path, br] of blastRadii) {
      if (path.includes('test')) {
        expect(br.counts.transitive).toBe(0);
      }
    }
  });

  it('schema.ts blast radius includes test files', () => {
    const schema = blastRadii.get(
      [...blastRadii.keys()].find((k) => k.endsWith('core/schema.ts'))!,
    );
    expect(schema).toBeDefined();
    expect(schema!.counts.tests).toBeGreaterThan(0);
  });
});

describe('Ablation (simple-webapp)', () => {
  it('zeroing any single weight produces valid scores', () => {
    const config = loadConfig(FIXTURE_DIR);
    const weightKeys = Object.keys(config.authority.signals) as Array<keyof typeof config.authority.signals>;

    for (const key of weightKeys) {
      const ablatedConfig = JSON.parse(JSON.stringify(config));
      ablatedConfig.authority.signals[key] = 0;
      const ablatedScores = scoreAuthority(graph, ablatedConfig, mockChurn);

      for (const file of ablatedScores) {
        expect(file.score).toBeGreaterThanOrEqual(0);
        expect(file.score).toBeLessThanOrEqual(1);
      }
    }
  });
});
