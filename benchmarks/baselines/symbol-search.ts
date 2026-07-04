/**
 * Symbol search baseline for CodeAuthorityBench.
 * Matches query terms against function, class, and variable names
 * extracted from CodeBrain's topology. Falls back to regex extraction
 * if topology is not available.
 *
 * Fully deterministic.
 */

import type { Baseline } from './index.js';

/**
 * Extract symbol-like identifiers from source code.
 * Matches camelCase, snake_case, PascalCase identifiers.
 */
function extractSymbols(content: string): string[] {
  const symbolPattern = /\b([A-Za-z_][A-Za-z0-9_]{2,})\b/g;
  const symbols = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = symbolPattern.exec(content)) !== null) {
    symbols.add(match[1]!.toLowerCase());
  }

  return [...symbols];
}

/**
 * Split a camelCase or PascalCase identifier into parts.
 * "getUserById" -> ["get", "user", "by", "id"]
 */
function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_\-]+/)
    .filter((p) => p.length > 1);
}

/**
 * Score a file by how many of its symbols match query terms.
 * Handles camelCase splitting so "tax calculation" matches "TaxCalculation".
 */
function symbolMatchScore(
  symbols: string[],
  queryParts: string[],
): number {
  let score = 0;

  for (const symbol of symbols) {
    const parts = splitIdentifier(symbol);
    for (const qp of queryParts) {
      // Exact symbol match
      if (symbol === qp) {
        score += 3;
      }
      // Substring match in symbol
      else if (symbol.includes(qp)) {
        score += 2;
      }
      // Part-level match (camelCase split)
      else if (parts.some((p) => p === qp || p.includes(qp))) {
        score += 1;
      }
    }
  }

  return score;
}

/**
 * Rank files by symbol name matches against query.
 * Returns top-k file paths sorted by descending match score.
 */
function rankBySymbols(
  query: string,
  files: Map<string, string>,
  topK: number,
): string[] {
  const queryParts = query
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 1);

  if (queryParts.length === 0) return [];

  const scored: Array<{ path: string; score: number }> = [];

  for (const [path, content] of files) {
    const symbols = extractSymbols(content);
    const score = symbolMatchScore(symbols, queryParts);

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

/** Symbol search baseline implementation. */
export const symbolSearchBaseline: Baseline = {
  name: 'SymbolSearch',
  async rank(
    query: string,
    files: Map<string, string>,
    topK: number,
  ): Promise<string[]> {
    return rankBySymbols(query, files, topK);
  },
};
