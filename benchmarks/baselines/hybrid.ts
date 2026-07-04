/**
 * Hybrid baseline for CodeAuthorityBench.
 * Combines BM25 + dense retrieval scores with linear interpolation.
 * Weight: 0.5 * BM25_normalized + 0.5 * dense_normalized.
 */

import type { Baseline } from './index.js';
import { bm25Baseline } from './bm25.js';
import { denseRetrievalBaseline } from './dense-retrieval.js';

/** Number of candidates to retrieve from each method before merging. */
const CANDIDATE_POOL_SIZE = 50;

/**
 * Min-max normalize scores to [0, 1].
 * If all scores are equal, returns 0.5 for all.
 */
function normalizeScores(
  scored: Map<string, number>,
): Map<string, number> {
  const values = [...scored.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  const normalized = new Map<string, number>();
  for (const [path, score] of scored) {
    normalized.set(path, range > 0 ? (score - min) / range : 0.5);
  }

  return normalized;
}

/**
 * Assign rank-based scores to a ranked list.
 * Top file gets score 1.0, decreasing linearly.
 */
function rankToScores(ranked: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  const n = ranked.length;
  for (let i = 0; i < n; i++) {
    scores.set(ranked[i]!, (n - i) / n);
  }
  return scores;
}

/**
 * Merge BM25 and dense retrieval rankings using linear combination.
 * Files appearing in only one method get 0 for the missing score.
 */
function mergeRankings(
  bm25Ranked: string[],
  denseRanked: string[],
  topK: number,
): string[] {
  const bm25Scores = normalizeScores(rankToScores(bm25Ranked));
  const denseScores = normalizeScores(rankToScores(denseRanked));

  // Collect all candidate files
  const allFiles = new Set([...bm25Ranked, ...denseRanked]);

  const combined: Array<{ path: string; score: number }> = [];
  for (const path of allFiles) {
    const bm25Score = bm25Scores.get(path) ?? 0;
    const denseScore = denseScores.get(path) ?? 0;
    combined.push({
      path,
      score: 0.5 * bm25Score + 0.5 * denseScore,
    });
  }

  // Sort by combined score descending, then by path for determinism
  combined.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.localeCompare(b.path);
  });

  return combined.slice(0, topK).map((s) => s.path);
}

/** Hybrid baseline implementation. */
export const hybridBaseline: Baseline = {
  name: 'Hybrid',
  async rank(
    query: string,
    files: Map<string, string>,
    topK: number,
  ): Promise<string[]> {
    // Get candidates from both methods
    const [bm25Results, denseResults] = await Promise.all([
      bm25Baseline.rank(query, files, CANDIDATE_POOL_SIZE),
      denseRetrievalBaseline.rank(query, files, CANDIDATE_POOL_SIZE),
    ]);

    return mergeRankings(bm25Results, denseResults, topK);
  },
};
