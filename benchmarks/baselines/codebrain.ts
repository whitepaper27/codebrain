/**
 * CodeBrain authority-aware retrieval baseline.
 *
 * Uses the real tree-sitter pipeline (AST parsing, dependency graph,
 * authority scoring) when pre-computed scores are available, falling
 * back to the heuristic for ablation variants.
 *
 * Architecture: "Authority is a layer on top of retrieval."
 * Step 1: Hybrid (BM25 + Dense) retrieves a relevance-ranked pool.
 * Step 2: Real authority scores re-rank candidates, boosting
 *         structurally important files within the relevant set.
 */

import type { Baseline } from './index.js';
import {
  createRealCodebrainBaseline,
  type scanRepoAuthority,
} from './real-authority.js';
import {
  authorityHeuristic,
  DEFAULT_AUTHORITY_CONFIG,
  type AuthorityConfig,
} from './authority-heuristic.js';
import { bm25Baseline } from './bm25.js';
import { denseRetrievalBaseline } from './dense-retrieval.js';

/** Size of the candidate pool from each retrieval method. */
const CANDIDATE_POOL_SIZE = 50;

/** Weight for authority in the final combination. */
const AUTHORITY_WEIGHT = 0.3;

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

/** Pre-computed real authority scores, set by evaluate.ts before running. */
let precomputedScores: Map<string, Map<string, number>> | null = null;

/**
 * Set pre-computed real authority scores for use by the CodeBrain baseline.
 * Called by evaluate.ts after scanning repos with the real pipeline.
 */
export function setPrecomputedScores(
  scores: Map<string, Map<string, number>>,
): void {
  precomputedScores = scores;
}

/**
 * Create a CodeBrain baseline that uses the heuristic for ablation.
 * This allows ablation variants to test different heuristic signal subsets.
 *
 * @param config - Authority config controlling which signals are active.
 * @param name - Optional custom name for the baseline.
 * @returns A Baseline instance using the heuristic configuration.
 */
export function createCodebrainBaseline(
  config?: AuthorityConfig,
  name?: string,
): Baseline {
  const cfg = config ?? DEFAULT_AUTHORITY_CONFIG;
  const baselineName = name ?? 'CodeBrain';

  return {
    name: baselineName,

    async rank(
      query: string,
      files: Map<string, string>,
      topK: number,
    ): Promise<string[]> {
      // Step 1: Get candidate pools from BM25 and Dense retrieval
      let bm25Results: string[];
      let denseResults: string[];

      try {
        [bm25Results, denseResults] = await Promise.all([
          bm25Baseline.rank(query, files, CANDIDATE_POOL_SIZE),
          denseRetrievalBaseline.rank(query, files, CANDIDATE_POOL_SIZE),
        ]);
      } catch {
        bm25Results = await bm25Baseline.rank(
          query, files, CANDIDATE_POOL_SIZE,
        );
        denseResults = [];
      }

      // Step 2: Merge hybrid relevance scores
      const bm25Scores = normalizeScores(rankToScores(bm25Results));
      const denseScores = normalizeScores(rankToScores(denseResults));
      const allCandidates = new Set([...bm25Results, ...denseResults]);

      // Step 3: Re-rank with authority
      const reranked: Array<{ path: string; score: number }> = [];

      for (const path of allCandidates) {
        const bm25Score = bm25Scores.get(path) ?? 0;
        const denseScore = denseScores.get(path) ?? 0;
        const hybridRelevance = 0.5 * bm25Score + 0.5 * denseScore;

        const content = files.get(path) ?? '';
        const auth = authorityHeuristic(path, content, files, cfg);

        const combined =
          (1 - AUTHORITY_WEIGHT) * hybridRelevance +
          AUTHORITY_WEIGHT * auth;

        reranked.push({ path, score: combined });
      }

      reranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.path.localeCompare(b.path);
      });

      return reranked.slice(0, topK).map((s) => s.path);
    },
  };
}

/**
 * Create the primary CodeBrain baseline.
 * Uses real tree-sitter scores if available (set via setPrecomputedScores),
 * falls back to heuristic otherwise.
 */
function createPrimaryBaseline(): Baseline {
  return {
    name: 'CodeBrain',

    async rank(
      query: string,
      files: Map<string, string>,
      topK: number,
    ): Promise<string[]> {
      // Use real scores if pre-computed
      if (precomputedScores && precomputedScores.size > 0) {
        const realBaseline = createRealCodebrainBaseline(
          precomputedScores, AUTHORITY_WEIGHT,
        );
        return realBaseline.rank(query, files, topK);
      }

      // Fallback to heuristic
      const fallback = createCodebrainBaseline();
      return fallback.rank(query, files, topK);
    },
  };
}

/** Default CodeBrain baseline — uses real scores when available. */
export const codebrainBaseline: Baseline = createPrimaryBaseline();
