/**
 * Blast radius computation.
 * Computes transitive closure over the dependency graph
 * to determine downstream impact of changes.
 */

import type { TopologyGraph, GraphEdge } from '../parsers/base.js';
import { logger } from '../utils/logger.js';

/** Blast radius result for a single file. */
export interface BlastRadius {
  /** File being analyzed. */
  filePath: string;
  /** Files that directly import/call this file. */
  directDependents: string[];
  /** All files transitively affected (includes direct). */
  transitiveDependents: string[];
  /** Test files among the transitive dependents. */
  testFilesAffected: string[];
  /** Count summaries. */
  counts: {
    direct: number;
    transitive: number;
    tests: number;
  };
}

/** Test file detection patterns. */
const TEST_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /[\\/]test[\\/]/,
  /[\\/]tests[\\/]/,
  /[\\/]__tests__[\\/]/,
];

/** Check if a file path looks like a test file. */
function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(filePath));
}

/**
 * Build a reverse adjacency list (target -> sources that depend on it).
 * This represents "who depends on me?"
 */
function buildReverseAdj(
  edges: GraphEdge[],
): Map<string, Set<string>> {
  const reverseAdj = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!reverseAdj.has(edge.target)) {
      reverseAdj.set(edge.target, new Set());
    }
    reverseAdj.get(edge.target)!.add(edge.source);
  }
  return reverseAdj;
}

/**
 * Compute transitive closure using BFS from a starting node.
 * Handles cycles by tracking visited nodes.
 */
function transitiveClosureBFS(
  startNode: string,
  reverseAdj: Map<string, Set<string>>,
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [startNode];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = reverseAdj.get(current);
    if (!dependents) continue;

    for (const dep of dependents) {
      if (dep === startNode) continue; // Skip self
      if (visited.has(dep)) continue;
      visited.add(dep);
      queue.push(dep);
    }
  }

  return visited;
}

/**
 * Compute blast radius for a single file.
 * Uses BFS over the reverse dependency graph.
 */
export function computeBlastRadius(
  filePath: string,
  graph: TopologyGraph,
): BlastRadius {
  const reverseAdj = buildReverseAdj(graph.edges);

  // Direct dependents
  const directSet = reverseAdj.get(filePath) ?? new Set();
  const directDependents = [...directSet];

  // Transitive dependents (includes direct)
  const transitiveSet = transitiveClosureBFS(filePath, reverseAdj);
  const transitiveDependents = [...transitiveSet];

  // Test files in transitive dependents
  const testFilesAffected = transitiveDependents.filter(isTestFile);

  return {
    filePath,
    directDependents,
    transitiveDependents,
    testFilesAffected,
    counts: {
      direct: directDependents.length,
      transitive: transitiveDependents.length,
      tests: testFilesAffected.length,
    },
  };
}

/**
 * Compute blast radius for all files in the graph.
 * Results are cached internally — call once per graph.
 */
export function computeAllBlastRadii(
  graph: TopologyGraph,
): Map<string, BlastRadius> {
  const results = new Map<string, BlastRadius>();
  const reverseAdj = buildReverseAdj(graph.edges);

  for (const node of graph.nodes) {
    const directSet = reverseAdj.get(node.filePath) ?? new Set();
    const transitiveSet = transitiveClosureBFS(
      node.filePath, reverseAdj,
    );
    const transitiveDeps = [...transitiveSet];

    results.set(node.filePath, {
      filePath: node.filePath,
      directDependents: [...directSet],
      transitiveDependents: transitiveDeps,
      testFilesAffected: transitiveDeps.filter(isTestFile),
      counts: {
        direct: directSet.size,
        transitive: transitiveSet.size,
        tests: transitiveDeps.filter(isTestFile).length,
      },
    });
  }

  logger.info('Blast radius computed', {
    fileCount: results.size,
  });

  return results;
}
