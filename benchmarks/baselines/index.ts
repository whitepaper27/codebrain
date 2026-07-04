/**
 * Baseline registry for CodeAuthorityBench.
 * Exports all baselines with a common interface.
 */

/** Common interface for all retrieval baselines. */
export interface Baseline {
  /** Human-readable name for results tables. */
  name: string;
  /**
   * Rank files by relevance to the query.
   * @param query - Natural-language query.
   * @param files - Map of file path -> file content.
   * @param topK - Number of top results to return.
   * @returns Ordered list of file paths, most relevant first.
   */
  rank(
    query: string,
    files: Map<string, string>,
    topK: number,
  ): Promise<string[]>;
}

export { bm25Baseline } from './bm25.js';
export { symbolSearchBaseline } from './symbol-search.js';
export { callGraphBaseline } from './call-graph.js';
export { denseRetrievalBaseline } from './dense-retrieval.js';
export { hybridBaseline } from './hybrid.js';
export { bm25RerankBaseline } from './bm25-rerank.js';
export { repoMapBaseline } from './repo-map.js';

/** All available baselines in evaluation order. */
export const ALL_BASELINES: Baseline[] = [];

/**
 * Get all baselines, lazily populated.
 * Imports are at the top but we populate the array here
 * to allow selective use (e.g., skip dense if no API key).
 */
export async function getBaselines(
  options: { includeDense?: boolean } = {},
): Promise<Baseline[]> {
  const { bm25Baseline } = await import('./bm25.js');
  const { symbolSearchBaseline } = await import('./symbol-search.js');
  const { callGraphBaseline } = await import('./call-graph.js');

  const { bm25RerankBaseline } = await import('./bm25-rerank.js');
  const { codebrainBaseline } = await import('./codebrain.js');

  const { repoMapBaseline } = await import('./repo-map.js');

  const baselines: Baseline[] = [
    bm25Baseline,
    symbolSearchBaseline,
    callGraphBaseline,
    repoMapBaseline,
    bm25RerankBaseline,
    codebrainBaseline,
  ];

  if (options.includeDense !== false && process.env['GEMINI_API_KEY']) {
    const { denseRetrievalBaseline } = await import('./dense-retrieval.js');
    const { hybridBaseline } = await import('./hybrid.js');
    baselines.push(denseRetrievalBaseline, hybridBaseline);
  }

  return baselines;
}
