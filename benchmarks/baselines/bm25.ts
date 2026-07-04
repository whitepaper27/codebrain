/**
 * BM25 baseline for CodeAuthorityBench.
 * Implements Okapi BM25 text search from scratch.
 * Fully deterministic: same inputs always produce same rankings.
 */

import type { Baseline } from './index.js';

/** BM25 hyperparameters (standard defaults). */
const K1 = 1.5;
const B = 0.75;

/** Simple whitespace + punctuation tokenizer. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Build an inverted index mapping term -> set of document IDs. */
function buildInvertedIndex(
  docs: Map<string, string[]>,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const [docId, tokens] of docs) {
    for (const token of tokens) {
      if (!index.has(token)) {
        index.set(token, new Set());
      }
      index.get(token)!.add(docId);
    }
  }
  return index;
}

/** Compute IDF for a term: log((N - df + 0.5) / (df + 0.5) + 1). */
function idf(docFreq: number, totalDocs: number): number {
  return Math.log(
    (totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1,
  );
}

/**
 * Score a single document against query terms using BM25.
 * score = SUM_q IDF(q) * (tf * (k1+1)) / (tf + k1 * (1 - b + b * dl/avgdl))
 */
function bm25Score(
  docTokens: string[],
  queryTerms: string[],
  invertedIndex: Map<string, Set<string>>,
  totalDocs: number,
  avgDocLen: number,
): number {
  const docLen = docTokens.length;
  if (docLen === 0) return 0;

  // Count term frequencies in document
  const tfMap = new Map<string, number>();
  for (const token of docTokens) {
    tfMap.set(token, (tfMap.get(token) ?? 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const tf = tfMap.get(term) ?? 0;
    if (tf === 0) continue;

    const df = invertedIndex.get(term)?.size ?? 0;
    const termIdf = idf(df, totalDocs);

    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (docLen / avgDocLen));

    score += termIdf * (numerator / denominator);
  }

  return score;
}

/**
 * Rank all files by BM25 score against the query.
 * Returns top-k file paths sorted by descending score.
 */
function rankBM25(
  query: string,
  files: Map<string, string>,
  topK: number,
): string[] {
  // Tokenize all documents
  const docTokens = new Map<string, string[]>();
  let totalTokens = 0;

  for (const [path, content] of files) {
    const tokens = tokenize(content);
    docTokens.set(path, tokens);
    totalTokens += tokens.length;
  }

  const totalDocs = files.size;
  const avgDocLen = totalDocs > 0 ? totalTokens / totalDocs : 0;

  // Build inverted index
  const invertedIndex = buildInvertedIndex(docTokens);

  // Tokenize query
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  // Score each document
  const scored: Array<{ path: string; score: number }> = [];
  for (const [path, tokens] of docTokens) {
    const score = bm25Score(
      tokens, queryTerms, invertedIndex, totalDocs, avgDocLen,
    );
    if (score > 0) {
      scored.push({ path, score });
    }
  }

  // Sort by score descending, then by path for determinism
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.localeCompare(b.path);
  });

  return scored.slice(0, topK).map((s) => s.path);
}

/** BM25 baseline implementation. */
export const bm25Baseline: Baseline = {
  name: 'BM25',
  async rank(
    query: string,
    files: Map<string, string>,
    topK: number,
  ): Promise<string[]> {
    return rankBM25(query, files, topK);
  },
};
