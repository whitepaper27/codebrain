/**
 * Shared data loader for MCP tools.
 * Reads pre-computed topology, authority tree, and SQLite data.
 * Caches in memory for fast tool responses (<500ms).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { TopologyGraph } from '../parsers/base.js';
import type { AuthorityTree } from '../storage/json-output.js';
import { logger } from '../utils/logger.js';

/** Output directory name matching json-output.ts convention. */
const OUTPUT_DIR = 'codebrain-data';

/** Cached data available to all tools. */
export interface LoadedData {
  topology: TopologyGraph;
  authorityTree: AuthorityTree;
  db: Database.Database;
  repoRoot: string;
}

/** In-memory cache — loaded once, reused across tool calls. */
let cached: LoadedData | null = null;

/** Read and parse a JSON file, throwing actionable errors. */
function readJson<T>(filePath: string, label: string): T {
  if (!existsSync(filePath)) {
    throw new Error(
      `${label} not found at ${filePath}. ` +
      `Run \`codebrain scan .\` first to generate it.`,
    );
  }
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

/**
 * Load all pre-computed data from the codebrain-data directory.
 * Returns cached data on subsequent calls.
 */
export function loadData(repoRoot: string): LoadedData {
  if (cached && cached.repoRoot === repoRoot) {
    return cached;
  }

  const dataDir = join(repoRoot, OUTPUT_DIR);

  if (!existsSync(dataDir)) {
    throw new Error(
      `No codebrain-data/ directory found in ${repoRoot}. ` +
      `Run \`codebrain scan ${repoRoot}\` first.`,
    );
  }

  const topologyPath = join(dataDir, 'topology.json');
  const authorityPath = join(dataDir, 'authority_tree.json');
  const dbPath = join(dataDir, 'codebrain.db');

  const topology = readJson<TopologyGraph>(
    topologyPath, 'topology.json',
  );
  const authorityTree = readJson<AuthorityTree>(
    authorityPath, 'authority_tree.json',
  );

  if (!existsSync(dbPath)) {
    throw new Error(
      `Database not found at ${dbPath}. ` +
      `Run \`codebrain scan .\` first.`,
    );
  }

  const db = new Database(dbPath, { readonly: true });
  db.pragma('journal_mode = WAL');

  logger.info('Loaded pre-computed data', {
    files: authorityTree.entries.length,
    edges: topology.edges.length,
  });

  cached = { topology, authorityTree, db, repoRoot };
  return cached;
}

/** Clear the cached data (used in tests). */
export function clearCache(): void {
  if (cached?.db) {
    cached.db.close();
  }
  cached = null;
}
