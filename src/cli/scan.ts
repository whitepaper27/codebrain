/**
 * Scan pipeline — runs Phase 1 (Structure) and Phase 2 (Authority).
 * Orchestrates file discovery, AST parsing, graph building,
 * authority scoring, classification, and output generation.
 */

import { loadConfig } from '../utils/config.js';
import { discoverFiles } from '../scanner/file-discovery.js';
import { parseAllFiles } from '../scanner/ast-parser.js';
import { buildGraph } from '../scanner/graph-builder.js';
import { writeTopology, writeAuthorityTree } from '../storage/json-output.js';
import type { AuthorityTree, AuthorityEntry } from '../storage/json-output.js';
import { analyzeChurn } from '../utils/git.js';
import { scoreAuthority } from '../authority/scorer.js';
import { classifyFiles } from '../authority/classifier.js';
import { computeAllBlastRadii } from '../authority/blast-radius.js';
import { openDatabase, storeFiles, storeEdges, storeMetadata } from '../storage/sqlite.js';
import { logger } from '../utils/logger.js';

/**
 * Build the AuthorityTree from classified files and blast radii.
 * Maps internal types to the output format.
 */
function buildAuthorityTree(
  classified: ReturnType<typeof classifyFiles>,
  blastRadii: ReturnType<typeof computeAllBlastRadii>,
): AuthorityTree {
  let rootCount = 0;
  let derivedCount = 0;
  let leafCount = 0;

  const entries: AuthorityEntry[] = classified.map((f) => {
    if (f.tier === 'ROOT') rootCount++;
    else if (f.tier === 'DERIVED') derivedCount++;
    else leafCount++;

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

  return {
    entries,
    metadata: {
      computedAt: new Date().toISOString(),
      fileCount: entries.length,
      rootCount,
      derivedCount,
      leafCount,
    },
  };
}

/** Store all scan data in SQLite. */
function persistToDatabase(
  repoRoot: string,
  classified: ReturnType<typeof classifyFiles>,
  graph: ReturnType<typeof buildGraph>,
  blastRadii: ReturnType<typeof computeAllBlastRadii>,
): void {
  const db = openDatabase(repoRoot);
  storeFiles(db, classified, blastRadii);
  storeEdges(db, graph.edges);
  storeMetadata(db, {
    scannedAt: new Date().toISOString(),
    fileCount: String(graph.nodes.length),
    edgeCount: String(graph.edges.length),
  });
  db.close();
}

/** Print a summary of the scan results. */
function printSummary(
  tree: AuthorityTree,
  graph: ReturnType<typeof buildGraph>,
): void {
  const langs = Object.entries(graph.metadata.languages)
    .map(([lang, count]) => `${lang}: ${count}`)
    .join(', ');

  const lines = [
    '',
    `Scanned ${graph.metadata.fileCount} files (${langs})`,
    `Built dependency graph (${graph.metadata.edgeCount} edges)`,
    `Authority: ${tree.metadata.rootCount} ROOT, ${tree.metadata.derivedCount} DERIVED, ${tree.metadata.leafCount} LEAF`,
    `Output: codebrain-data/`,
    '',
  ];

  for (const line of lines) {
    process.stderr.write(line + '\n');
  }
}

/**
 * Run the full scan pipeline (Phase 1 + Phase 2).
 * Discovers files, parses ASTs, builds graphs, scores authority,
 * and writes all output to codebrain-data/.
 */
export async function runScan(repoRoot: string): Promise<void> {
  logger.info('Starting scan', { repoRoot });

  // Phase 1: Structure
  const config = loadConfig(repoRoot);
  const files = await discoverFiles(repoRoot, config);

  if (files.length === 0) {
    logger.warn('No supported source files found', { repoRoot });
    process.stderr.write('No supported source files found.\n');
    return;
  }

  const parseResults = await parseAllFiles(files);
  const graph = buildGraph(parseResults);
  writeTopology(repoRoot, graph);

  // Phase 2: Authority
  const churnData = await analyzeChurn(repoRoot);
  const scored = scoreAuthority(graph, config, churnData);
  const classified = classifyFiles(scored, config);
  const blastRadii = computeAllBlastRadii(graph);

  const authorityTree = buildAuthorityTree(classified, blastRadii);
  writeAuthorityTree(repoRoot, authorityTree);

  // Persist to SQLite
  persistToDatabase(repoRoot, classified, graph, blastRadii);

  // Summary
  printSummary(authorityTree, graph);
  logger.info('Scan complete');
}
