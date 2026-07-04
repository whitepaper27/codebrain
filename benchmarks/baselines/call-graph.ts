/**
 * Call-graph-only baseline for CodeAuthorityBench.
 * Ranks files purely by PageRank centrality on the dependency graph.
 * No query relevance — just graph structure.
 *
 * Deterministic (converges to stable ranking).
 */

import type { Baseline } from './index.js';

/** PageRank damping factor (standard default). */
const DAMPING = 0.85;

/** Maximum iterations for PageRank convergence. */
const MAX_ITERATIONS = 100;

/** Convergence threshold. */
const EPSILON = 1e-6;

/**
 * Build adjacency list from file contents by detecting import-like patterns.
 * This is a lightweight heuristic — the real CodeBrain pipeline uses
 * tree-sitter, but this baseline intentionally uses simpler detection.
 */
function buildDependencyGraph(
  files: Map<string, string>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const filePaths = [...files.keys()];

  for (const path of filePaths) {
    adj.set(path, new Set());
  }

  // Build a lookup from filename stems to full paths
  const stemIndex = new Map<string, string[]>();
  for (const path of filePaths) {
    const parts = path.split('/');
    const fileName = parts[parts.length - 1] ?? '';
    const stem = fileName.replace(/\.[^.]+$/, '');
    if (!stemIndex.has(stem)) {
      stemIndex.set(stem, []);
    }
    stemIndex.get(stem)!.push(path);
  }

  for (const [sourcePath, content] of files) {
    // Match import/require/from patterns
    const importPatterns = [
      /(?:import|from)\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /^#include\s+["<]([^">]+)[">]/gm,
    ];

    for (const pattern of importPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const importPath = match[1]!;
        // Try to resolve to a known file
        const resolved = resolveImport(
          importPath, sourcePath, filePaths, stemIndex,
        );
        if (resolved && resolved !== sourcePath) {
          adj.get(sourcePath)!.add(resolved);
        }
      }
    }
  }

  return adj;
}

/** Try to resolve an import specifier to a known file path. */
function resolveImport(
  importPath: string,
  fromPath: string,
  allPaths: string[],
  stemIndex: Map<string, string[]>,
): string | null {
  // Extract the last segment as a potential file stem
  const segments = importPath.replace(/\\/g, '/').split('/');
  const lastSegment = segments[segments.length - 1] ?? '';
  const stem = lastSegment.replace(/\.[^.]+$/, '');

  // Check stem index
  const candidates = stemIndex.get(stem);
  if (!candidates || candidates.length === 0) return null;

  // If only one candidate, use it
  if (candidates.length === 1) return candidates[0]!;

  // Prefer files in the same or nearby directory
  const fromDir = fromPath.split('/').slice(0, -1).join('/');
  const sorted = [...candidates].sort((a, b) => {
    const aDist = commonPrefixLength(a, fromDir);
    const bDist = commonPrefixLength(b, fromDir);
    return bDist - aDist;
  });

  return sorted[0]!;
}

/** Count shared prefix length between two paths. */
function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Compute PageRank for all nodes in the graph.
 * Returns a map from node -> PageRank score.
 */
function computePageRank(
  adj: Map<string, Set<string>>,
): Map<string, number> {
  const nodes = [...adj.keys()];
  const n = nodes.length;
  if (n === 0) return new Map();

  // Build reverse adjacency (who points to me?)
  const reverseAdj = new Map<string, Set<string>>();
  for (const node of nodes) {
    reverseAdj.set(node, new Set());
  }
  for (const [source, targets] of adj) {
    for (const target of targets) {
      reverseAdj.get(target)?.add(source);
    }
  }

  // Initialize scores uniformly
  let scores = new Map<string, number>();
  for (const node of nodes) {
    scores.set(node, 1 / n);
  }

  // Iterate until convergence
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const newScores = new Map<string, number>();
    let maxDelta = 0;

    for (const node of nodes) {
      let inScore = 0;
      const inLinks = reverseAdj.get(node) ?? new Set();

      for (const source of inLinks) {
        const outDegree = adj.get(source)?.size ?? 1;
        inScore += (scores.get(source) ?? 0) / outDegree;
      }

      const newScore = (1 - DAMPING) / n + DAMPING * inScore;
      newScores.set(node, newScore);

      const delta = Math.abs(newScore - (scores.get(node) ?? 0));
      if (delta > maxDelta) maxDelta = delta;
    }

    scores = newScores;
    if (maxDelta < EPSILON) break;
  }

  return scores;
}

/**
 * Rank files by PageRank centrality.
 * Returns top-k file paths sorted by descending PageRank.
 */
function rankByPageRank(
  files: Map<string, string>,
  topK: number,
): string[] {
  const adj = buildDependencyGraph(files);
  const pageRank = computePageRank(adj);

  const sorted = [...pageRank.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });

  return sorted.slice(0, topK).map(([path]) => path);
}

/** Call-graph (PageRank) baseline implementation. */
export const callGraphBaseline: Baseline = {
  name: 'CallGraph',
  async rank(
    query: string,
    files: Map<string, string>,
    topK: number,
  ): Promise<string[]> {
    // Query is intentionally ignored — rank by graph structure only
    return rankByPageRank(files, topK);
  },
};
