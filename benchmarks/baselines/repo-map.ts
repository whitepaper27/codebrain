/**
 * Repo-map baseline for CodeAuthorityBench.
 * Simulates Aider-style repo-map: builds a structured summary of each file
 * (path + class/function/export names) and BM25-ranks summaries against queries.
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

/**
 * Extract a structured summary from file content using regex.
 * Returns a string combining the file path with extracted symbol names.
 */
function buildFileSummary(path: string, content: string): string {
  const symbols: string[] = [];

  // Class definitions (JS/TS/Python/Java/Go)
  const classRe = /(?:class|struct|interface|type)\s+([A-Z]\w*)/g;
  let match;
  while ((match = classRe.exec(content))) symbols.push(match[1]!);

  // Function/method definitions
  const funcRe =
    /(?:function|func|def|async\s+function)\s+([a-zA-Z_]\w*)/g;
  while ((match = funcRe.exec(content))) symbols.push(match[1]!);

  // Arrow function / const exports (TS/JS)
  const arrowRe =
    /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_]\w*)\s*=/g;
  while ((match = arrowRe.exec(content))) symbols.push(match[1]!);

  // Export statements
  const exportRe = /export\s+(?:default\s+)?(?:class|function|const|interface|type)\s+([a-zA-Z_]\w*)/g;
  while ((match = exportRe.exec(content))) symbols.push(match[1]!);

  // Python decorators (often mark important endpoints)
  const decorRe = /@(\w+(?:\.\w+)?)/g;
  while ((match = decorRe.exec(content))) symbols.push(match[1]!);

  // Deduplicate
  const unique = [...new Set(symbols)];

  // Build tree-like summary: path + symbols
  const pathParts = path.replace(/\\/g, '/').split('/');
  return `${path} ${pathParts.join(' ')} ${unique.join(' ')}`;
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
 * Rank files by BM25 over structured summaries.
 * Returns top-k file paths sorted by descending score.
 */
function rankRepoMap(
  query: string,
  files: Map<string, string>,
  topK: number,
): string[] {
  const summaryTokens = new Map<string, string[]>();
  let totalTokens = 0;

  for (const [path, content] of files) {
    const summary = buildFileSummary(path, content);
    const tokens = tokenize(summary);
    summaryTokens.set(path, tokens);
    totalTokens += tokens.length;
  }

  const totalDocs = files.size;
  const avgDocLen = totalDocs > 0 ? totalTokens / totalDocs : 0;
  const invertedIndex = buildInvertedIndex(summaryTokens);
  const queryTerms = tokenize(query);

  if (queryTerms.length === 0) return [];

  const scored: Array<{ path: string; score: number }> = [];
  for (const [path, tokens] of summaryTokens) {
    const score = bm25Score(
      tokens, queryTerms, invertedIndex, totalDocs, avgDocLen,
    );
    if (score > 0) {
      scored.push({ path, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.localeCompare(b.path);
  });

  return scored.slice(0, topK).map((s) => s.path);
}

/** Repo-map baseline implementation. */
export const repoMapBaseline: Baseline = {
  name: 'RepoMap',
  async rank(
    query: string,
    files: Map<string, string>,
    topK: number,
  ): Promise<string[]> {
    return rankRepoMap(query, files, topK);
  },
};
