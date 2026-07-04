/**
 * SQLite storage for CodeBrain structured data.
 * Uses better-sqlite3 for synchronous, high-performance access.
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import type { ClassifiedFile } from '../authority/classifier.js';
import type { TopologyGraph, GraphEdge } from '../parsers/base.js';
import type { BlastRadius } from '../authority/blast-radius.js';
import { logger } from '../utils/logger.js';

const SCHEMA_VERSION = '1';
const DB_FILENAME = 'codebrain.db';
const VERSION_FILENAME = '.codebrain-version';

/** Initialize the database with the required schema. */
function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      authority_score REAL NOT NULL,
      authority_tier TEXT NOT NULL,
      reason TEXT NOT NULL,
      in_degree INTEGER NOT NULL,
      out_degree INTEGER NOT NULL,
      churn_percentile REAL,
      definitions_count INTEGER NOT NULL,
      blast_radius_direct INTEGER NOT NULL DEFAULT 0,
      blast_radius_transitive INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS edges (
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      symbols TEXT,
      PRIMARY KEY (source, target, edge_type)
    );

    CREATE TABLE IF NOT EXISTS definitions (
      file_path TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      line INTEGER NOT NULL,
      col INTEGER NOT NULL,
      exported INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (file_path, name, line)
    );

    CREATE TABLE IF NOT EXISTS scan_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
    CREATE INDEX IF NOT EXISTS idx_defs_file ON definitions(file_path);
    CREATE INDEX IF NOT EXISTS idx_files_tier ON files(authority_tier);
  `);
}

/**
 * Open or create the CodeBrain SQLite database.
 * Creates the output directory and schema if needed.
 */
export function openDatabase(repoRoot: string): Database.Database {
  const outputDir = join(repoRoot, 'codebrain-data');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const dbPath = join(outputDir, DB_FILENAME);
  const versionPath = join(outputDir, VERSION_FILENAME);

  // Check schema version
  if (existsSync(versionPath)) {
    const existingVersion = readFileSync(versionPath, 'utf-8').trim();
    if (existingVersion !== SCHEMA_VERSION) {
      logger.info('Schema version changed, recreating database', {
        old: existingVersion,
        new: SCHEMA_VERSION,
      });
      // Drop and recreate for now (v1 — no migration needed)
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  writeFileSync(versionPath, SCHEMA_VERSION, 'utf-8');

  logger.debug('Database opened', { path: dbPath });
  return db;
}

/** Store classified files in the database. */
export function storeFiles(
  db: Database.Database,
  files: ClassifiedFile[],
  blastRadii: Map<string, BlastRadius>,
): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO files
    (path, language, authority_score, authority_tier, reason,
     in_degree, out_degree, churn_percentile, definitions_count,
     blast_radius_direct, blast_radius_transitive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    db.exec('DELETE FROM files');
    for (const f of files) {
      const br = blastRadii.get(f.filePath);
      insert.run(
        f.filePath, f.language, f.score, f.tier, f.reason,
        f.metrics.inDegree, f.metrics.outDegree,
        f.metrics.churnPercentile, f.metrics.definitionsCount,
        br?.counts.direct ?? 0, br?.counts.transitive ?? 0,
      );
    }
  });

  transaction();
  logger.debug('Stored files', { count: files.length });
}

/** Store graph edges in the database. */
export function storeEdges(
  db: Database.Database,
  edges: GraphEdge[],
): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO edges (source, target, edge_type, symbols)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    db.exec('DELETE FROM edges');
    for (const e of edges) {
      insert.run(
        e.source, e.target, e.type,
        e.symbols.length > 0 ? JSON.stringify(e.symbols) : null,
      );
    }
  });

  transaction();
  logger.debug('Stored edges', { count: edges.length });
}

/** Store scan metadata. */
export function storeMetadata(
  db: Database.Database,
  metadata: Record<string, string>,
): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO scan_metadata (key, value)
    VALUES (?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(metadata)) {
      insert.run(key, value);
    }
  });

  transaction();
}

/** Query files by authority tier. */
export function queryFilesByTier(
  db: Database.Database,
  tier: string,
): Array<{ path: string; score: number; reason: string }> {
  return db.prepare(
    'SELECT path, authority_score as score, reason FROM files WHERE authority_tier = ? ORDER BY authority_score DESC',
  ).all(tier) as Array<{ path: string; score: number; reason: string }>;
}

/** Query all files ordered by authority score descending. */
export function queryAllFiles(
  db: Database.Database,
): Array<{
  path: string;
  score: number;
  tier: string;
  reason: string;
  in_degree: number;
  out_degree: number;
}> {
  return db.prepare(
    'SELECT path, authority_score as score, authority_tier as tier, reason, in_degree, out_degree FROM files ORDER BY authority_score DESC',
  ).all() as Array<{
    path: string;
    score: number;
    tier: string;
    reason: string;
    in_degree: number;
    out_degree: number;
  }>;
}
