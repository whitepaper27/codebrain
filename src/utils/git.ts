/**
 * Git utilities for churn analysis.
 * Uses simple-git to compute per-file change frequency.
 */

import { simpleGit, type SimpleGit } from 'simple-git';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';

/** Churn data for a single file. */
export interface FileChurn {
  /** Number of commits that touched this file. */
  commitCount: number;
  /** Last modified date (ISO string). */
  lastModified: string | null;
}

/** Churn data for the entire repo. */
export interface ChurnData {
  /** Per-file churn information. */
  files: Map<string, FileChurn>;
  /** Whether git data was available. */
  isGitRepo: boolean;
}

/** Check if a directory is a git repository. */
function isGitRepo(repoRoot: string): boolean {
  return existsSync(join(repoRoot, '.git'));
}

/**
 * Analyze git churn for all files in a repository.
 * Returns null churn data gracefully if not a git repo.
 */
export async function analyzeChurn(
  repoRoot: string,
): Promise<ChurnData> {
  if (!isGitRepo(repoRoot)) {
    logger.warn('Not a git repository, skipping churn analysis', {
      path: repoRoot,
    });
    return { files: new Map(), isGitRepo: false };
  }

  const git: SimpleGit = simpleGit(repoRoot);

  try {
    const logResult = await git.log(['--name-only', '--pretty=format:%aI']);
    const fileChurns = new Map<string, FileChurn>();

    // Parse git log output: alternating date lines and file lists
    let currentDate: string | null = null;
    const lines = logResult.latest?.hash
      ? [] // Use raw parsing instead
      : [];

    // Use raw git command for reliable parsing
    const raw = await git.raw([
      'log', '--name-only', '--pretty=format:COMMIT:%aI',
      '--diff-filter=ACDMR',
    ]);

    parseGitLog(raw, fileChurns);

    logger.info('Churn analysis complete', {
      filesWithHistory: fileChurns.size,
    });

    return { files: fileChurns, isGitRepo: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Git churn analysis failed', { error: msg });
    return { files: new Map(), isGitRepo: true };
  }
}

/** Parse raw git log output into per-file churn data. */
function parseGitLog(
  raw: string,
  fileChurns: Map<string, FileChurn>,
): void {
  let currentDate: string | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('COMMIT:')) {
      currentDate = trimmed.substring(7);
      continue;
    }

    // This is a file path
    const filePath = trimmed.replace(/\\/g, '/');
    const existing = fileChurns.get(filePath);

    if (existing) {
      existing.commitCount++;
      // Keep the most recent date
      if (currentDate && (!existing.lastModified ||
        currentDate > existing.lastModified)) {
        existing.lastModified = currentDate;
      }
    } else {
      fileChurns.set(filePath, {
        commitCount: 1,
        lastModified: currentDate,
      });
    }
  }
}

/**
 * Compute churn percentiles for a set of files.
 * Returns a map of file path to percentile (0-100).
 * Higher percentile = more churn = less stable.
 */
export function computeChurnPercentiles(
  churnData: ChurnData,
  filePaths: string[],
): Map<string, number> {
  const percentiles = new Map<string, number>();

  if (!churnData.isGitRepo || churnData.files.size === 0) {
    // No git data — assign neutral 50th percentile to all
    for (const fp of filePaths) {
      percentiles.set(fp, 50);
    }
    return percentiles;
  }

  // Collect commit counts for known files
  const counts: { path: string; count: number }[] = [];
  for (const fp of filePaths) {
    const churn = churnData.files.get(fp);
    counts.push({ path: fp, count: churn?.commitCount ?? 0 });
  }

  // Sort by commit count ascending
  counts.sort((a, b) => a.count - b.count);

  // Assign percentiles
  const n = counts.length;
  for (let i = 0; i < n; i++) {
    const percentile = n > 1
      ? Math.round((i / (n - 1)) * 100)
      : 50;
    percentiles.set(counts[i]!.path, percentile);
  }

  return percentiles;
}
