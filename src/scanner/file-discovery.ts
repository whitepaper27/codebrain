/**
 * File discovery module.
 * Finds source files respecting .gitignore and config exclusions.
 */

import fg from 'fast-glob';
import ignore, { type Ignore } from 'ignore';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getSupportedExtensions } from '../parsers/index.js';
import { logger } from '../utils/logger.js';
import type { CodeBrainConfig } from '../utils/config.js';

/** A discovered source file. */
export interface DiscoveredFile {
  /** Absolute file path. */
  absolutePath: string;
  /** Path relative to repo root. */
  relativePath: string;
  /** File extension (e.g., '.ts'). */
  extension: string;
  /** File size in bytes. */
  sizeBytes: number;
}

/** Load .gitignore rules from the repo root. */
function loadGitignore(repoRoot: string): Ignore {
  const ig = ignore();
  const gitignorePath = join(repoRoot, '.gitignore');
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    ig.add(content);
  }
  return ig;
}

/**
 * Discover all supported source files in a repository.
 * Respects .gitignore and config exclusion patterns.
 */
export async function discoverFiles(
  repoRoot: string,
  config: CodeBrainConfig,
): Promise<DiscoveredFile[]> {
  const extensions = getSupportedExtensions();
  const patterns = extensions.map((ext) => `**/*${ext}`);
  const maxSizeBytes = config.scan.max_file_size_kb * 1024;
  const ig = loadGitignore(repoRoot);

  const ignorePatterns = config.scan.exclude.map(
    (p) => `**/${p}/**`,
  );

  logger.debug('Discovering files', {
    repoRoot,
    extensions,
    excludePatterns: config.scan.exclude,
  });

  const rawPaths = await fg(patterns, {
    cwd: repoRoot,
    absolute: false,
    dot: false,
    ignore: ignorePatterns,
    followSymbolicLinks: false,
  });

  const files: DiscoveredFile[] = [];

  for (const relPath of rawPaths) {
    // Normalize path separators for gitignore matching
    const normalizedPath = relPath.replace(/\\/g, '/');

    if (ig.ignores(normalizedPath)) {
      continue;
    }

    const absPath = join(repoRoot, relPath);
    try {
      const stat = statSync(absPath);
      if (stat.size > maxSizeBytes) {
        logger.debug('Skipping oversized file', {
          file: relPath,
          sizeKB: Math.round(stat.size / 1024),
          limitKB: config.scan.max_file_size_kb,
        });
        continue;
      }

      const ext = relPath.substring(relPath.lastIndexOf('.'));
      files.push({
        absolutePath: absPath,
        relativePath: normalizedPath,
        extension: ext,
        sizeBytes: stat.size,
      });
    } catch {
      logger.warn('Could not stat file', { file: relPath });
    }
  }

  logger.info('Discovered files', { count: files.length });
  return files;
}
