import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/utils/config.js';
import { join } from 'node:path';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    const config = loadConfig('/nonexistent/path');
    expect(config.authority.signals.in_degree_weight).toBe(0.35);
    expect(config.authority.signals.schema_bonus).toBe(0.2);
    expect(config.authority.signals.churn_penalty_weight).toBe(0.15);
    expect(config.authority.signals.directory_heuristic_weight).toBe(0.15);
    expect(config.authority.signals.out_degree_penalty_weight).toBe(0.15);
    expect(config.authority.thresholds.root).toBe(0.8);
    expect(config.authority.thresholds.leaf).toBe(0.2);
    expect(config.guard.require_human_above).toBe(0.7);
    expect(config.guard.warn_above).toBe(0.3);
    expect(config.scan.exclude).toContain('node_modules');
    expect(config.scan.max_file_size_kb).toBe(500);
  });

  it('loads config from project root', () => {
    const projectRoot = join(import.meta.dirname, '..', '..');
    const config = loadConfig(projectRoot);
    expect(config.authority.signals.in_degree_weight).toBe(0.35);
    expect(config.authority.thresholds.root).toBe(0.8);
  });

  it('has correct default directory overrides', () => {
    const config = loadConfig('/nonexistent/path');
    expect(config.authority.directory_overrides.root_patterns).toContain('**/core/**');
    expect(config.authority.directory_overrides.leaf_patterns).toContain('**/test/**');
    expect(config.authority.directory_overrides.leaf_patterns).toContain('**/tests/**');
  });

  it('default signal weights sum to 1.0', () => {
    const config = loadConfig('/nonexistent/path');
    const s = config.authority.signals;
    const sum = s.in_degree_weight + s.schema_bonus +
      s.churn_penalty_weight + s.directory_heuristic_weight +
      s.out_degree_penalty_weight;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});
