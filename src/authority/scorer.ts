/**
 * Authority scoring algorithm.
 * Computes a deterministic authority score (0.0–1.0) for each file
 * based on structural and repository-level signals.
 *
 * Formula:
 *   Authority(file) = w1*dependency_centrality
 *                   + w2*reverse_dependency_count
 *                   + w3*schema_config_interface_ownership
 *                   + w4*churn_stability
 *                   + w5*directory_prior
 */

import { minimatch } from 'minimatch';
import type { TopologyGraph, GraphNode, GraphEdge } from '../parsers/base.js';
import type { CodeBrainConfig } from '../utils/config.js';
import type { ChurnData } from '../utils/git.js';
import { computeChurnPercentiles } from '../utils/git.js';
import { logger } from '../utils/logger.js';

/** Scored file with all signal contributions. */
export interface ScoredFile {
  filePath: string;
  language: string;
  /** Final authority score (0.0–1.0). */
  score: number;
  /** Individual signal contributions (for explain tool). */
  signals: {
    dependencyCentrality: number;
    reverseDependencyCount: number;
    schemaOwnership: number;
    churnStability: number;
    directoryPrior: number;
  };
  /** Raw graph metrics. */
  metrics: {
    inDegree: number;
    outDegree: number;
    churnPercentile: number | null;
    definitionsCount: number;
    hasSchemaDefinitions: boolean;
  };
}

/** Schema/interface definition kinds that increase authority. */
const SCHEMA_KINDS = new Set([
  'interface', 'type', 'struct', 'enum', 'union',
]);

/** Check if a file defines schemas, interfaces, or types. */
function hasSchemaDefinitions(node: GraphNode): boolean {
  return node.definitions.some((d) => SCHEMA_KINDS.has(d.kind));
}

/** Check if a file path matches any of the given glob patterns. */
function matchesPatterns(
  filePath: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((p) => minimatch(filePath, p));
}

/** Normalize a value to [0, 1] given the max in the dataset. */
function normalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(value / max, 1);
}

/**
 * Compute authority scores for all files in the topology graph.
 * The same inputs always produce the same outputs (deterministic).
 */
export function scoreAuthority(
  graph: TopologyGraph,
  config: CodeBrainConfig,
  churnData: ChurnData,
): ScoredFile[] {
  const weights = config.authority.signals;
  const dirOverrides = config.authority.directory_overrides;
  const filePaths = graph.nodes.map((n) => n.filePath);

  // Compute churn percentiles
  const churnPercentiles = computeChurnPercentiles(
    churnData, filePaths,
  );

  // Find max values for normalization
  const maxInDegree = Math.max(
    ...graph.nodes.map((n) => n.inDegree), 1,
  );
  const maxOutDegree = Math.max(
    ...graph.nodes.map((n) => n.outDegree), 1,
  );

  // Count how many test files reference each file
  const testReferences = countTestReferences(graph);

  const scored: ScoredFile[] = [];

  for (const node of graph.nodes) {
    const churnPct = churnPercentiles.get(node.filePath) ?? 50;
    const hasSchema = hasSchemaDefinitions(node);

    // Signal 1: Dependency centrality (normalized in-degree)
    const depCentrality = normalize(node.inDegree, maxInDegree);

    // Signal 2: Reverse dependency (normalized, penalize high out-degree)
    const outPenalty = normalize(node.outDegree, maxOutDegree);
    const revDep = Math.max(0, depCentrality - outPenalty * 0.5);

    // Signal 3: Schema/config/interface ownership
    const schemaScore = computeSchemaScore(
      node, hasSchema, dirOverrides.root_patterns,
    );

    // Signal 4: Churn stability (low churn = high stability)
    const churnStability = 1 - (churnPct / 100);

    // Signal 5: Directory prior
    const dirPrior = computeDirectoryPrior(
      node.filePath, dirOverrides,
    );

    // Weighted sum
    const rawScore =
      weights.in_degree_weight * depCentrality +
      weights.out_degree_penalty_weight * revDep +
      weights.schema_bonus * schemaScore +
      weights.churn_penalty_weight * churnStability +
      weights.directory_heuristic_weight * dirPrior;

    // Clamp to [0, 1]
    const score = Math.max(0, Math.min(1, rawScore));

    scored.push({
      filePath: node.filePath,
      language: node.language,
      score,
      signals: {
        dependencyCentrality: depCentrality,
        reverseDependencyCount: revDep,
        schemaOwnership: schemaScore,
        churnStability,
        directoryPrior: dirPrior,
      },
      metrics: {
        inDegree: node.inDegree,
        outDegree: node.outDegree,
        churnPercentile: churnData.isGitRepo ? churnPct : null,
        definitionsCount: node.definitions.length,
        hasSchemaDefinitions: hasSchema,
      },
    });
  }

  logger.info('Authority scoring complete', {
    fileCount: scored.length,
  });

  return scored;
}

/** Compute the schema ownership signal (0.0–1.0). */
function computeSchemaScore(
  node: GraphNode,
  hasSchema: boolean,
  rootPatterns: readonly string[],
): number {
  let score = 0;

  if (hasSchema) {
    score += 0.6;
  }

  if (matchesPatterns(node.filePath, rootPatterns)) {
    score += 0.4;
  }

  return Math.min(score, 1);
}

/** Compute directory prior signal (-1.0 to 1.0 mapped to 0.0–1.0). */
function computeDirectoryPrior(
  filePath: string,
  overrides: CodeBrainConfig['authority']['directory_overrides'],
): number {
  const isRoot = matchesPatterns(filePath, overrides.root_patterns);
  const isLeaf = matchesPatterns(filePath, overrides.leaf_patterns);

  if (isRoot && !isLeaf) return 1.0;
  if (isLeaf && !isRoot) return 0.0;
  return 0.5; // Neutral
}

/** Count how many test files reference each non-test file. */
function countTestReferences(
  graph: TopologyGraph,
): Map<string, number> {
  const testPatterns = [
    '**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**',
    '**/__tests__/**',
  ];
  const counts = new Map<string, number>();

  const testFiles = new Set(
    graph.nodes
      .filter((n) => matchesPatterns(n.filePath, testPatterns))
      .map((n) => n.filePath),
  );

  for (const edge of graph.edges) {
    if (testFiles.has(edge.source) && !testFiles.has(edge.target)) {
      counts.set(
        edge.target, (counts.get(edge.target) ?? 0) + 1,
      );
    }
  }

  return counts;
}
