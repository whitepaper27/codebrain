/**
 * JSON output writers for topology and authority data.
 * Produces human-readable, diffable JSON files.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { TopologyGraph } from '../parsers/base.js';
import { logger } from '../utils/logger.js';

/** Default output directory name. */
const OUTPUT_DIR = 'codebrain-data';

/** Ensure the output directory exists. */
function ensureOutputDir(repoRoot: string): string {
  const outputDir = join(repoRoot, OUTPUT_DIR);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

/**
 * Write the topology graph to codebrain-data/topology.json.
 * Human-readable format with 2-space indentation.
 */
export function writeTopology(
  repoRoot: string,
  graph: TopologyGraph,
): string {
  const outputDir = ensureOutputDir(repoRoot);
  const outputPath = join(outputDir, 'topology.json');

  const json = JSON.stringify(graph, null, 2);
  writeFileSync(outputPath, json, 'utf-8');

  logger.info('Wrote topology.json', {
    path: outputPath,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  });

  return outputPath;
}

/** Authority data for a single file. */
export interface AuthorityEntry {
  file: string;
  authority_score: number;
  authority_tier: string;
  reason: string;
  in_degree: number;
  out_degree: number;
  churn_percentile: number | null;
  definitions_count: number;
  blast_radius_direct: number;
  blast_radius_transitive: number;
}

/** The full authority tree output. */
export interface AuthorityTree {
  entries: AuthorityEntry[];
  metadata: {
    computedAt: string;
    fileCount: number;
    rootCount: number;
    derivedCount: number;
    leafCount: number;
  };
}

/**
 * Write the authority tree to codebrain-data/authority_tree.json.
 * Human-readable format with 2-space indentation.
 */
export function writeAuthorityTree(
  repoRoot: string,
  tree: AuthorityTree,
): string {
  const outputDir = ensureOutputDir(repoRoot);
  const outputPath = join(outputDir, 'authority_tree.json');

  const json = JSON.stringify(tree, null, 2);
  writeFileSync(outputPath, json, 'utf-8');

  logger.info('Wrote authority_tree.json', {
    path: outputPath,
    files: tree.entries.length,
    root: tree.metadata.rootCount,
    derived: tree.metadata.derivedCount,
    leaf: tree.metadata.leafCount,
  });

  return outputPath;
}
