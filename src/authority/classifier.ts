/**
 * Authority classifier.
 * Assigns ROOT / DERIVED / LEAF tiers using percentile-based
 * classification combined with hard structural signals.
 *
 * Pure absolute thresholds fail on real repos because in-degree
 * gets spread across many files. Percentile-based tiers adapt
 * to each repo's score distribution.
 */

import type { CodeBrainConfig } from '../utils/config.js';
import type { ScoredFile } from './scorer.js';
import { logger } from '../utils/logger.js';

/** Authority tier labels. */
export type AuthorityTier = 'ROOT' | 'DERIVED' | 'LEAF';

/** A classified file with tier and explanation. */
export interface ClassifiedFile {
  filePath: string;
  language: string;
  score: number;
  tier: AuthorityTier;
  reason: string;
  signals: ScoredFile['signals'];
  metrics: ScoredFile['metrics'];
}

/** Test/script file patterns (always LEAF). */
const LEAF_PATH_PATTERNS = [
  /[\\/](tests?|__tests__|spec|specs)[\\/]/i,
  /[\\/](scripts?|examples?|fixtures?|benchmarks?)[\\/]/i,
  /\.(test|spec)\.[a-z]+$/i,
  /[\\/]test_[^/\\]+\.py$/i,
  /_test\.(go|py|js|ts)$/i,
];

/** Check if file is clearly a test/script (always LEAF). */
function isTestOrScript(filePath: string): boolean {
  return LEAF_PATH_PATTERNS.some((p) => p.test(filePath));
}

/**
 * Compute the percentile cutoff value for an array of scores.
 * percentile is 0-100.
 */
function percentileValue(
  sortedScores: number[],
  percentile: number,
): number {
  if (sortedScores.length === 0) return 0;
  const idx = Math.ceil((percentile / 100) * sortedScores.length) - 1;
  return sortedScores[Math.max(0, idx)]!;
}

/**
 * Classify a file using percentile-based tiers.
 *
 * Strategy:
 * - Filter out test/script files first (always LEAF)
 * - Among production files, top ~5% by score → ROOT
 * - Next ~20% → DERIVED
 * - Rest → LEAF
 *
 * Also apply hard ROOT signals:
 * - Files with both high in-degree (P95) and schema definitions
 * - Files in core framework directories with high in-degree
 */
function classifyWithPercentiles(
  file: ScoredFile,
  p95Score: number,
  p80Score: number,
  p95InDegree: number,
): AuthorityTier {
  // Hard LEAF: test and script files
  if (isTestOrScript(file.filePath)) return 'LEAF';

  // Hard ROOT signals (override percentile if met)
  const isHardRoot = checkHardRootSignals(
    file, p95InDegree,
  );
  if (isHardRoot) return 'ROOT';

  // Percentile-based classification
  if (file.score >= p95Score) return 'ROOT';
  if (file.score >= p80Score) return 'DERIVED';

  // Files with some in-degree are at least DERIVED potential
  if (file.metrics.inDegree > 0 && file.score >= p80Score * 0.7) {
    return 'DERIVED';
  }

  return 'LEAF';
}

/**
 * Check hard ROOT signals that override percentile tiers.
 * A file is ROOT if it meets structural criteria regardless of score.
 */
function checkHardRootSignals(
  file: ScoredFile,
  p95InDegree: number,
): boolean {
  const m = file.metrics;

  // High in-degree AND defines schemas/types
  if (m.inDegree >= p95InDegree && m.hasSchemaDefinitions) {
    return true;
  }

  // Very high in-degree (top of the repo)
  if (m.inDegree >= p95InDegree && m.outDegree <= m.inDegree * 0.5) {
    return true;
  }

  // In a core directory AND has significant in-degree
  if (file.signals.directoryPrior >= 0.8 && m.inDegree >= p95InDegree * 0.5) {
    return true;
  }

  return false;
}

/** Generate a human-readable reason for the classification. */
function generateReason(
  file: ScoredFile, tier: AuthorityTier,
): string {
  const parts: string[] = [];
  const m = file.metrics;
  const s = file.signals;

  if (m.inDegree > 0) {
    parts.push(
      `${m.inDegree} module${m.inDegree > 1 ? 's' : ''} depend on this`,
    );
  } else {
    parts.push('No other modules depend on this');
  }

  if (m.hasSchemaDefinitions) {
    parts.push('Defines types/interfaces/schemas');
  }

  if (m.outDegree === 0) {
    parts.push('Zero imports (pure provider)');
  } else if (m.outDegree > 3) {
    parts.push(`Imports from ${m.outDegree} modules`);
  }

  if (m.churnPercentile !== null) {
    if (m.churnPercentile <= 20) {
      parts.push('Very stable (low churn)');
    } else if (m.churnPercentile >= 80) {
      parts.push('Frequently modified');
    }
  }

  if (s.directoryPrior >= 0.8) {
    parts.push('Core/config/schema directory');
  } else if (s.directoryPrior <= 0.2) {
    parts.push('Test/script/example directory');
  }

  return parts.join('. ') + '.';
}

/**
 * Classify all scored files into authority tiers.
 * Uses percentile-based classification that adapts to each repo.
 */
export function classifyFiles(
  scoredFiles: ScoredFile[],
  config: CodeBrainConfig,
): ClassifiedFile[] {
  // Separate production files from test/script files
  const prodFiles = scoredFiles.filter(
    (f) => !isTestOrScript(f.filePath),
  );

  // Compute percentile cutoffs from production files only
  const prodScores = prodFiles
    .map((f) => f.score)
    .sort((a, b) => a - b);

  const prodInDegrees = prodFiles
    .map((f) => f.metrics.inDegree)
    .sort((a, b) => a - b);

  const p95Score = percentileValue(prodScores, 95);
  const p80Score = percentileValue(prodScores, 80);
  const p95InDegree = percentileValue(prodInDegrees, 95);

  logger.debug('Classification percentiles', {
    p95Score: p95Score.toFixed(4),
    p80Score: p80Score.toFixed(4),
    p95InDegree,
    prodFileCount: prodFiles.length,
  });

  const classified: ClassifiedFile[] = [];
  let rootCount = 0;
  let derivedCount = 0;
  let leafCount = 0;

  for (const file of scoredFiles) {
    const tier = classifyWithPercentiles(
      file, p95Score, p80Score, p95InDegree,
    );
    const reason = generateReason(file, tier);

    if (tier === 'ROOT') rootCount++;
    else if (tier === 'DERIVED') derivedCount++;
    else leafCount++;

    classified.push({
      filePath: file.filePath,
      language: file.language,
      score: file.score,
      tier,
      reason,
      signals: file.signals,
      metrics: file.metrics,
    });
  }

  logger.info('Classification complete', {
    root: rootCount,
    derived: derivedCount,
    leaf: leafCount,
  });

  return classified;
}
