/**
 * search_with_hierarchy MCP tool.
 * Finds code ranked by authority, not just similarity.
 * Uses substring matching on file paths and definition names.
 */

import type { LoadedData } from './data-loader.js';
import type { AuthorityEntry } from '../storage/json-output.js';

/** A single search result with authority context. */
interface SearchResult {
  file: string;
  authority_score: number;
  authority_tier: string;
  reason: string;
  dependents: number;
  dependencies: number;
  last_modified: string | null;
  churn_percentile: number | null;
}

/** Full response from search_with_hierarchy. */
interface SearchResponse {
  tool: 'search_with_hierarchy';
  query: string;
  results: SearchResult[];
}

/** Compute a relevance score for a file against the query. */
function matchScore(
  entry: AuthorityEntry,
  queryLower: string,
  definitionNames: Map<string, string[]>,
): number {
  const fileLower = entry.file.toLowerCase();
  let score = 0;

  // Exact path segment match is strongest
  const segments = fileLower.split('/');
  if (segments.some((s) => s.includes(queryLower))) {
    score += 2;
  } else if (fileLower.includes(queryLower)) {
    score += 1;
  }

  // Definition name match
  const defs = definitionNames.get(entry.file) ?? [];
  for (const defName of defs) {
    if (defName.toLowerCase().includes(queryLower)) {
      score += 1.5;
      break;
    }
  }

  return score;
}

/** Build a map of file -> definition names from topology. */
function buildDefinitionIndex(
  data: LoadedData,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const node of data.topology.nodes) {
    index.set(
      node.filePath,
      node.definitions.map((d) => d.name),
    );
  }
  return index;
}

/** Convert an authority entry to a search result. */
function toSearchResult(
  entry: AuthorityEntry,
  data: LoadedData,
): SearchResult {
  const node = data.topology.nodes.find(
    (n) => n.filePath === entry.file,
  );

  return {
    file: entry.file,
    authority_score: entry.authority_score,
    authority_tier: entry.authority_tier,
    reason: entry.reason,
    dependents: entry.blast_radius_direct,
    dependencies: node?.outDegree ?? entry.out_degree,
    last_modified: null,
    churn_percentile: entry.churn_percentile,
  };
}

/**
 * Execute search_with_hierarchy against loaded data.
 * Returns files matching the query, ranked by authority score.
 */
export function searchWithHierarchy(
  data: LoadedData,
  query: string,
  topK: number = 10,
): SearchResponse {
  const queryLower = query.toLowerCase();
  const defIndex = buildDefinitionIndex(data);

  // Score each entry for relevance
  const scored = data.authorityTree.entries
    .map((entry) => ({
      entry,
      relevance: matchScore(entry, queryLower, defIndex),
    }))
    .filter((item) => item.relevance > 0);

  // Sort by relevance first, then by authority score
  scored.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return b.entry.authority_score - a.entry.authority_score;
  });

  const results = scored
    .slice(0, topK)
    .map((item) => toSearchResult(item.entry, data));

  return { tool: 'search_with_hierarchy', query, results };
}
