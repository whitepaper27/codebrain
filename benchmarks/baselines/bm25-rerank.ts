/**
 * BM25 + Authority Rerank baseline for CodeAuthorityBench.
 * First retrieves top-20 candidates via BM25, then re-ranks
 * using authority heuristics.
 *
 * Final score = 0.6 * BM25_normalized + 0.4 * authority_normalized.
 *
 * This baseline tests whether CodeBrain's improvement over BM25
 * is simply due to naive authority reranking on top of BM25.
 */

import type { Baseline } from './index.js';
import { bm25Baseline } from './bm25.js';
import { authorityHeuristic } from './authority-heuristic.js';

/** Number of BM25 candidates to retrieve before reranking. */
const BM25_CANDIDATE_POOL = 20;

/**
 * Min-max normalize an array of scores to [0, 1].
 * If all scores are equal, returns 0.5 for all.
 */
function normalizeScores(
  scores: Map<string, number>,
): Map<string, number> {
  const values = [...scores.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  const normalized = new Map<string, number>();
  for (const [key, value] of scores) {
    normalized.set(key, range > 0 ? (value - min) / range : 0.5);
  }

  return normalized;
}

/**
 * Assign rank-based scores to a ranked list.
 * Top file gets score 1.0, last gets score close to 0.
 */
function rankToScores(ranked: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  const n = ranked.length;
  for (let i = 0; i < n; i++) {
    scores.set(ranked[i]!, (n - i) / n);
  }
  return scores;
}

/** BM25 + Authority Rerank baseline implementation. */
export const bm25RerankBaseline: Baseline = {
  name: 'BM25+Rerank',

  async rank(
    query: string,
    files: Map<string, string>,
    topK: number,
  ): Promise<string[]> {
    // Step 1: Get top-20 candidates from BM25
    const bm25Candidates = await bm25Baseline.rank(
      query, files, BM25_CANDIDATE_POOL,
    );

    if (bm25Candidates.length === 0) {
      return [];
    }

    // Step 2: Compute authority scores for candidates
    const bm25Scores = normalizeScores(rankToScores(bm25Candidates));

    const authorityScores = new Map<string, number>();
    for (const path of bm25Candidates) {
      const content = files.get(path) ?? '';
      authorityScores.set(path, authorityHeuristic(path, content, files));
    }
    const normAuthority = normalizeScores(authorityScores);

    // Step 3: Combine with linear interpolation
    const combined: Array<{ path: string; score: number }> = [];
    for (const path of bm25Candidates) {
      const bm25Score = bm25Scores.get(path) ?? 0;
      const authScore = normAuthority.get(path) ?? 0;
      combined.push({
        path,
        score: 0.6 * bm25Score + 0.4 * authScore,
      });
    }

    // Sort by combined score descending, then by path for determinism
    combined.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    });

    return combined.slice(0, topK).map((s) => s.path);
  },
};
