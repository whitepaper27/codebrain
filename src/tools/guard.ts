/**
 * guard_change MCP tool.
 * Warns or blocks when an agent touches high-authority code.
 * Verdicts: SAFE (< warn_above), CAUTION (warn_above..require_human_above),
 * REQUIRES_HUMAN_APPROVAL (> require_human_above).
 */

import type { LoadedData } from './data-loader.js';
import type { CodeBrainConfig } from '../utils/config.js';
import { loadConfig } from '../utils/config.js';

/** Change types that can be guarded. */
export type ChangeType = 'modify' | 'delete' | 'rename';

/** Possible guard verdicts. */
export type Verdict = 'SAFE' | 'CAUTION' | 'REQUIRES_HUMAN_APPROVAL';

/** Blast radius summary in guard response. */
interface GuardBlastRadius {
  direct_dependents: number;
  transitive_dependents: number;
  test_files_affected: number;
}

/** Full response from guard_change. */
interface GuardResponse {
  tool: 'guard_change';
  file: string;
  change_type: ChangeType;
  verdict: Verdict;
  authority_score: number;
  reason: string;
  blast_radius: GuardBlastRadius;
  recommendation: string;
}

/** Determine the verdict based on score and config thresholds. */
function determineVerdict(
  score: number,
  config: CodeBrainConfig,
): Verdict {
  if (score > config.guard.require_human_above) {
    return 'REQUIRES_HUMAN_APPROVAL';
  }
  if (score > config.guard.warn_above) {
    return 'CAUTION';
  }
  return 'SAFE';
}

/** Generate a recommendation based on verdict and context. */
function generateRecommendation(
  verdict: Verdict,
  changeType: ChangeType,
  blastRadius: GuardBlastRadius,
): string {
  if (verdict === 'SAFE') {
    return 'This file has low authority. Changes are unlikely to affect other modules.';
  }

  if (verdict === 'REQUIRES_HUMAN_APPROVAL') {
    const base = 'Review with a senior engineer before modifying.';
    if (blastRadius.transitive_dependents > 10) {
      return `${base} ${blastRadius.transitive_dependents} modules depend on this transitively.`;
    }
    return `${base} Consider whether the change should be in a derived module instead.`;
  }

  // CAUTION
  if (changeType === 'delete') {
    return `This file has moderate authority. Deletion would affect ${blastRadius.direct_dependents} direct dependents.`;
  }
  return 'This file has moderate authority. Test affected modules after changes.';
}

/**
 * Evaluate whether a proposed change is safe.
 * Returns a verdict with blast radius and recommendation.
 */
export function guardChange(
  data: LoadedData,
  file: string,
  changeType: ChangeType,
): GuardResponse {
  const config = loadConfig(data.repoRoot);

  const entry = data.authorityTree.entries.find(
    (e) => e.file === file,
  );

  if (!entry) {
    return {
      tool: 'guard_change',
      file,
      change_type: changeType,
      verdict: 'SAFE',
      authority_score: 0,
      reason: `File "${file}" not found in authority tree. It may be new or outside the scanned scope.`,
      blast_radius: {
        direct_dependents: 0,
        transitive_dependents: 0,
        test_files_affected: 0,
      },
      recommendation: 'File not tracked. Proceed with normal review.',
    };
  }

  const score = entry.authority_score;
  const verdict = determineVerdict(score, config);

  const blastRadius: GuardBlastRadius = {
    direct_dependents: entry.blast_radius_direct,
    transitive_dependents: entry.blast_radius_transitive,
    test_files_affected: 0, // Populated from topology below
  };

  // Count test files among dependents
  const testPatterns = [
    /\.test\./, /\.spec\./, /[\\/]test[\\/]/,
    /[\\/]tests[\\/]/, /[\\/]__tests__[\\/]/,
  ];
  const dependents = data.topology.edges
    .filter((e) => e.target === file)
    .map((e) => e.source);
  blastRadius.test_files_affected = dependents.filter(
    (d) => testPatterns.some((p) => p.test(d)),
  ).length;

  const recommendation = generateRecommendation(
    verdict, changeType, blastRadius,
  );

  return {
    tool: 'guard_change',
    file,
    change_type: changeType,
    verdict,
    authority_score: score,
    reason: entry.reason,
    blast_radius: blastRadius,
    recommendation,
  };
}
