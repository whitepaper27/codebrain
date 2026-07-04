/**
 * AST parser orchestrator.
 * Reads and parses files concurrently using the parser registry.
 */

import { readFileSync } from 'node:fs';
import type { DiscoveredFile } from './file-discovery.js';
import type { ParseResult } from '../parsers/base.js';
import { parseFile } from '../parsers/index.js';
import { logger } from '../utils/logger.js';

/** Default concurrency for parallel parsing. */
const DEFAULT_CONCURRENCY = 8;

/**
 * Parse a batch of files with a concurrency limit.
 * Returns results only for successfully parsed files.
 */
async function parseBatch(
  files: DiscoveredFile[],
  concurrency: number,
): Promise<ParseResult[]> {
  const results: ParseResult[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < files.length) {
      const current = index++;
      const file = files[current]!;

      try {
        const content = readFileSync(file.absolutePath, 'utf-8');
        const result = await parseFile(file.relativePath, content);
        if (result) {
          results.push(result);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Failed to parse file', {
          file: file.relativePath,
          error: msg,
        });
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, files.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Parse all discovered files and return their structural information.
 * Skips files that fail to parse with a warning.
 */
export async function parseAllFiles(
  files: DiscoveredFile[],
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<Map<string, ParseResult>> {
  logger.info('Parsing files', { count: files.length, concurrency });

  const results = await parseBatch(files, concurrency);
  const resultMap = new Map<string, ParseResult>();

  for (const result of results) {
    resultMap.set(result.filePath, result);
  }

  const errorCount = files.length - resultMap.size;
  logger.info('Parsing complete', {
    parsed: resultMap.size,
    errors: errorCount,
  });

  if (errorCount > 0) {
    logger.warn('Some files could not be parsed', { count: errorCount });
  }

  return resultMap;
}
