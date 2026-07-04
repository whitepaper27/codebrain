/**
 * Graph builder — transforms per-file parse results into a unified
 * dependency graph with import path resolution.
 */

import { dirname, join, resolve, extname } from 'node:path';
import { existsSync } from 'node:fs';
import type {
  ParseResult, GraphNode, GraphEdge,
  TopologyGraph, Definition,
} from '../parsers/base.js';
import { logger } from '../utils/logger.js';

/** Extensions to try when resolving imports without extensions. */
const RESOLVE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.c', '.h',
];

/**
 * Extensions that TypeScript and other tools allow in import specifiers
 * but that should be swapped for the actual source extension.
 * For example, `import './foo.js'` may resolve to `./foo.ts`.
 */
const SWAPPABLE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];

/** Index files to try when resolving directory imports. */
const INDEX_FILES = [
  'index.ts', 'index.tsx', 'index.js', 'index.jsx',
  '__init__.py', 'mod.go',
];

/**
 * Try to resolve a relative import source to a file path.
 * Returns the resolved relative path or null if not found.
 */
function resolveImportPath(
  importSource: string,
  fromFile: string,
  knownFiles: Set<string>,
  repoRoot?: string,
): string | null {
  if (!importSource.startsWith('.') && !importSource.startsWith('/')) {
    return null; // External package — skip
  }

  const fromDir = dirname(fromFile);
  const candidate = join(fromDir, importSource).replace(/\\/g, '/');

  // Direct match
  if (knownFiles.has(candidate)) return candidate;

  // Try adding extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = candidate + ext;
    if (knownFiles.has(withExt)) return withExt;
  }

  // Try swapping extensions (e.g. .js -> .ts for ESM TypeScript imports)
  const candidateExt = extname(candidate);
  if (SWAPPABLE_EXTENSIONS.includes(candidateExt)) {
    const stripped = candidate.slice(0, -candidateExt.length);
    for (const ext of RESOLVE_EXTENSIONS) {
      const swapped = stripped + ext;
      if (knownFiles.has(swapped)) return swapped;
    }
  }

  // Try index files (directory import)
  for (const indexFile of INDEX_FILES) {
    const asIndex = join(candidate, indexFile).replace(/\\/g, '/');
    if (knownFiles.has(asIndex)) return asIndex;
  }

  return null;
}

/**
 * Build import edges from parse results.
 * Resolves relative import paths to actual file paths.
 */
function buildImportEdges(
  parseResults: Map<string, ParseResult>,
): GraphEdge[] {
  const knownFiles = new Set(parseResults.keys());
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();

  for (const [filePath, result] of parseResults) {
    for (const imp of result.imports) {
      const resolved = resolveImportPath(
        imp.source, filePath, knownFiles,
      );
      if (!resolved) continue;

      const edgeKey = `${filePath}|${resolved}|import`;
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);

      edges.push({
        source: filePath,
        target: resolved,
        type: 'import',
        symbols: imp.specifiers,
      });
    }
  }

  return edges;
}

/**
 * Build call edges from parse results.
 * Matches calls to definitions in other files.
 */
function buildCallEdges(
  parseResults: Map<string, ParseResult>,
): GraphEdge[] {
  // Build index of exported definitions
  const defIndex = new Map<string, string[]>();
  for (const [filePath, result] of parseResults) {
    for (const def of result.definitions) {
      if (!def.exported) continue;
      const existing = defIndex.get(def.name) ?? [];
      existing.push(filePath);
      defIndex.set(def.name, existing);
    }
  }

  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();

  for (const [filePath, result] of parseResults) {
    for (const call of result.calls) {
      const targets = defIndex.get(call.callee);
      if (!targets) continue;

      for (const target of targets) {
        if (target === filePath) continue;

        const edgeKey = `${filePath}|${target}|call`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        edges.push({
          source: filePath,
          target,
          type: 'call',
          symbols: [call.callee],
        });
      }
    }
  }

  return edges;
}

/** Compute in-degree and out-degree for each node. */
function computeDegrees(
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
): void {
  for (const edge of edges) {
    const sourceNode = nodes.get(edge.source);
    const targetNode = nodes.get(edge.target);
    if (sourceNode) sourceNode.outDegree++;
    if (targetNode) targetNode.inDegree++;
  }
}

/** Detect circular dependencies and log warnings. */
function detectCycles(edges: GraphEdge[]): string[][] {
  const adj = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, new Set());
    adj.get(edge.source)!.add(edge.target);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart >= 0) {
        cycles.push([...path.slice(cycleStart), node]);
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const neighbors = adj.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        dfs(neighbor);
      }
    }

    path.pop();
    inStack.delete(node);
  }

  for (const node of adj.keys()) {
    dfs(node);
  }

  return cycles;
}

/**
 * Build the complete dependency graph from parse results.
 * Resolves imports, builds call edges, detects cycles.
 */
export function buildGraph(
  parseResults: Map<string, ParseResult>,
): TopologyGraph {
  logger.info('Building dependency graph', {
    fileCount: parseResults.size,
  });

  // Create nodes
  const nodes = new Map<string, GraphNode>();
  const languageCounts: Record<string, number> = {};

  for (const [filePath, result] of parseResults) {
    nodes.set(filePath, {
      filePath,
      language: result.language,
      inDegree: 0,
      outDegree: 0,
      definitions: result.definitions,
    });

    languageCounts[result.language] =
      (languageCounts[result.language] ?? 0) + 1;
  }

  // Build edges
  const importEdges = buildImportEdges(parseResults);
  const callEdges = buildCallEdges(parseResults);
  const allEdges = [...importEdges, ...callEdges];

  // Compute degrees
  computeDegrees(nodes, allEdges);

  // Detect cycles
  const cycles = detectCycles(allEdges);
  if (cycles.length > 0) {
    logger.warn('Circular dependencies detected', {
      count: cycles.length,
      examples: cycles.slice(0, 3).map((c) => c.join(' -> ')),
    });
  }

  const graph: TopologyGraph = {
    nodes: [...nodes.values()],
    edges: allEdges,
    metadata: {
      scannedAt: new Date().toISOString(),
      fileCount: nodes.size,
      edgeCount: allEdges.length,
      languages: languageCounts,
    },
  };

  logger.info('Graph built', {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    languages: languageCounts,
  });

  return graph;
}
