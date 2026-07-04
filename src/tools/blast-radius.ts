/**
 * diff_blast_radius MCP tool.
 * Shows downstream impact of a proposed change to one or more files.
 */

import type { LoadedData } from './data-loader.js';

/** Blast radius info for a single affected file. */
interface AffectedFile {
  file: string;
  authority_score: number;
  authority_tier: string;
}

/** Blast radius result for a single source file. */
interface FileBlastRadius {
  file: string;
  direct_dependents: AffectedFile[];
  transitive_dependents: AffectedFile[];
  test_files_affected: string[];
  counts: {
    direct: number;
    transitive: number;
    tests: number;
  };
}

/** Full response from diff_blast_radius. */
interface BlastRadiusResponse {
  tool: 'diff_blast_radius';
  files: FileBlastRadius[];
  total_affected: number;
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

/** Build a reverse adjacency list from topology edges. */
function buildReverseAdj(
  data: LoadedData,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const edge of data.topology.edges) {
    if (!adj.has(edge.target)) {
      adj.set(edge.target, new Set());
    }
    adj.get(edge.target)!.add(edge.source);
  }
  return adj;
}

/** BFS to find all transitive dependents. */
function findTransitiveDependents(
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
      if (dep === startNode || visited.has(dep)) continue;
      visited.add(dep);
      queue.push(dep);
    }
  }
  return visited;
}

/** Look up authority info for a file path. */
function lookupAuthority(
  data: LoadedData,
  filePath: string,
): AffectedFile {
  const entry = data.authorityTree.entries.find(
    (e) => e.file === filePath,
  );
  return {
    file: filePath,
    authority_score: entry?.authority_score ?? 0,
    authority_tier: entry?.authority_tier ?? 'UNKNOWN',
  };
}

/** Compute blast radius for a single file. */
function computeForFile(
  filePath: string,
  data: LoadedData,
  reverseAdj: Map<string, Set<string>>,
): FileBlastRadius {
  const directSet = reverseAdj.get(filePath) ?? new Set();
  const transitiveSet = findTransitiveDependents(
    filePath, reverseAdj,
  );

  const directDeps = [...directSet].map(
    (f) => lookupAuthority(data, f),
  );
  const transitiveDeps = [...transitiveSet].map(
    (f) => lookupAuthority(data, f),
  );
  const testFiles = [...transitiveSet].filter(isTestFile);

  return {
    file: filePath,
    direct_dependents: directDeps,
    transitive_dependents: transitiveDeps,
    test_files_affected: testFiles,
    counts: {
      direct: directSet.size,
      transitive: transitiveSet.size,
      tests: testFiles.length,
    },
  };
}

/**
 * Compute blast radius for one or more files.
 * Returns downstream impact with authority scores.
 */
export function diffBlastRadius(
  data: LoadedData,
  files: string[],
): BlastRadiusResponse {
  const reverseAdj = buildReverseAdj(data);
  const results = files.map(
    (f) => computeForFile(f, data, reverseAdj),
  );

  // Count unique affected files across all inputs
  const allAffected = new Set<string>();
  for (const r of results) {
    for (const dep of r.transitive_dependents) {
      allAffected.add(dep.file);
    }
  }

  return {
    tool: 'diff_blast_radius',
    files: results,
    total_affected: allAffected.size,
  };
}
