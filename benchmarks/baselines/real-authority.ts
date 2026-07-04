/**
 * Real authority scoring for CodeAuthorityBench.
 * Runs the actual CodeBrain pipeline (tree-sitter AST parsing,
 * dependency graph construction, authority scoring) on benchmark
 * repos instead of using regex-based heuristics.
 *
 * Scores are cached to benchmarks/.authority-cache/ to avoid
 * re-scanning on every benchmark run.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { discoverFiles } from '../../src/scanner/file-discovery.js';
import { parseAllFiles } from '../../src/scanner/ast-parser.js';
import { buildGraph } from '../../src/scanner/graph-builder.js';
import { scoreAuthority, type ScoredFile } from '../../src/authority/scorer.js';
import { analyzeChurn } from '../../src/utils/git.js';
import { loadConfig, type CodeBrainConfig } from '../../src/utils/config.js';
import type { Baseline } from './index.js';
import { bm25Baseline } from './bm25.js';
import { denseRetrievalBaseline } from './dense-retrieval.js';

/** Cache directory for pre-computed authority scores. */
const CACHE_DIR = join(
  import.meta.dirname ?? '.', '..', '.authority-cache',
);

/** Size of the candidate pool from each retrieval method. */
const CANDIDATE_POOL_SIZE = 50;

/** Weight for authority in the final combination. */
const DEFAULT_AUTHORITY_WEIGHT = 0.3;

/** Cached authority scores: repo name -> (file path -> score). */
interface CachedScores {
  scannedAt: string;
  fileCount: number;
  edgeCount: number;
  scores: Array<{
    filePath: string;
    score: number;
    signals: ScoredFile['signals'];
    metrics: ScoredFile['metrics'];
  }>;
}

/** Ensure the cache directory exists. */
function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/** Load cached scores for a repo, if available. */
function loadCachedScores(repoName: string): Map<string, number> | null {
  ensureCacheDir();
  const cachePath = join(CACHE_DIR, `${repoName}.json`);
  if (!existsSync(cachePath)) return null;

  try {
    const raw = readFileSync(cachePath, 'utf-8');
    const data: CachedScores = JSON.parse(raw);
    return new Map(data.scores.map((s) => [s.filePath, s.score]));
  } catch {
    return null;
  }
}

/** Save scored files to cache. */
function saveCachedScores(
  repoName: string,
  scored: ScoredFile[],
  edgeCount: number,
): void {
  ensureCacheDir();
  const cachePath = join(CACHE_DIR, `${repoName}.json`);
  const data: CachedScores = {
    scannedAt: new Date().toISOString(),
    fileCount: scored.length,
    edgeCount,
    scores: scored.map((s) => ({
      filePath: s.filePath,
      score: s.score,
      signals: s.signals,
      metrics: s.metrics,
    })),
  };
  writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Run the real CodeBrain pipeline on a repository.
 * Returns a map of file path -> authority score.
 *
 * @param repoPath - Absolute path to the repository root.
 * @param repoName - Short name for caching (e.g., 'express').
 * @param config - Optional CodeBrainConfig override.
 * @returns Map of relative file path -> authority score (0.0-1.0).
 */
export async function scanRepoAuthority(
  repoPath: string,
  repoName: string,
  config?: CodeBrainConfig,
): Promise<Map<string, number>> {
  // Try cache first
  const cached = loadCachedScores(repoName);
  if (cached) {
    console.log(`  ${repoName}: loaded ${cached.size} cached authority scores`);
    return cached;
  }

  console.log(`  ${repoName}: scanning with real tree-sitter pipeline...`);

  // Load config with extended exclusions for large repos
  const cfg = config ?? loadConfig(repoPath);

  // Exclude test directories to keep memory usage manageable
  // on large repos (e.g., Spring Framework at 9K+ files)
  const testExcludes = [
    'test', 'tests', '__tests__', 'testFixtures',
    'jmh', 'benchmarks', 'docs', 'integration',
  ];
  for (const dir of testExcludes) {
    if (!cfg.scan.exclude.includes(dir)) {
      cfg.scan.exclude.push(dir);
    }
  }

  // Phase 1: Structure
  const files = await discoverFiles(repoPath, cfg);
  const parseResults = await parseAllFiles(files);
  const graph = buildGraph(parseResults);

  // Churn analysis
  const churnData = await analyzeChurn(repoPath);

  // Phase 2: Authority
  const scored = scoreAuthority(graph, cfg, churnData);

  // Cache results
  saveCachedScores(repoName, scored, graph.edges.length);

  console.log(
    `  ${repoName}: scored ${scored.length} files ` +
    `(${graph.edges.length} edges, ${churnData.isGitRepo ? 'with' : 'without'} churn)`,
  );

  return new Map(scored.map((s) => [s.filePath, s.score]));
}

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
 * Create a CodeBrain baseline using real tree-sitter authority scores.
 *
 * @param authorityScores - Pre-computed authority scores per repo.
 * @param signalWeights - Optional weight overrides for ablation.
 * @param name - Optional custom name for the baseline.
 * @returns A Baseline instance using real authority scores.
 */
export function createRealCodebrainBaseline(
  authorityScores: Map<string, Map<string, number>>,
  authorityWeight: number = DEFAULT_AUTHORITY_WEIGHT,
  name: string = 'CodeBrain',
): Baseline {
  return {
    name,

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

      // Find the matching repo scores
      // (match by checking which repo's file paths overlap with input files)
      let repoScores: Map<string, number> | undefined;
      for (const [, scores] of authorityScores) {
        const filePaths = [...files.keys()];
        const overlap = filePaths.filter((f) => scores.has(f));
        if (overlap.length > filePaths.length * 0.1) {
          repoScores = scores;
          break;
        }
      }

      // Step 3: Re-rank with real authority scores
      const reranked: Array<{ path: string; score: number }> = [];

      for (const path of allCandidates) {
        const bm25Score = bm25Scores.get(path) ?? 0;
        const denseScore = denseScores.get(path) ?? 0;
        const hybridRelevance = 0.5 * bm25Score + 0.5 * denseScore;

        // Use real tree-sitter authority score (default 0.5 if not found)
        const auth = repoScores?.get(path) ?? 0.5;

        const combined =
          (1 - authorityWeight) * hybridRelevance +
          authorityWeight * auth;

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
