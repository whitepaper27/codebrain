/**
 * Dense retrieval baseline for CodeAuthorityBench.
 * Uses Gemini gemini-embedding-001 for vector search.
 * Caches embeddings to benchmarks/.embedding-cache/ to avoid recomputation.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Baseline } from './index.js';

/** Gemini embedding API endpoint. */
const EMBED_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

/** Cache directory for stored embeddings. */
const CACHE_DIR = join(
  import.meta.dirname ?? '.', '..', '.embedding-cache',
);

/** Maximum content length to embed (characters). */
const MAX_CONTENT_LENGTH = 8000;

/** Delay between API calls to avoid rate limiting (ms). */
const API_DELAY_MS = 100;

/** Embedding response from Gemini API. */
interface EmbedResponse {
  embedding: {
    values: number[];
  };
}

/** Cached embedding entry. */
interface CacheEntry {
  hash: string;
  vector: number[];
}

/** Get a stable hash for content to use as cache key. */
function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Ensure the cache directory exists. */
function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/** Load cached embeddings for a given repo from disk. */
function loadCache(repoKey: string): Map<string, number[]> {
  ensureCacheDir();
  const cachePath = join(CACHE_DIR, `${repoKey}.json`);
  if (!existsSync(cachePath)) return new Map();

  try {
    const raw = readFileSync(cachePath, 'utf-8');
    const entries: CacheEntry[] = JSON.parse(raw);
    return new Map(entries.map((e) => [e.hash, e.vector]));
  } catch {
    return new Map();
  }
}

/** Save embeddings cache to disk. */
function saveCache(
  repoKey: string,
  cache: Map<string, number[]>,
): void {
  ensureCacheDir();
  const cachePath = join(CACHE_DIR, `${repoKey}.json`);
  const entries: CacheEntry[] = [...cache.entries()].map(
    ([hash, vector]) => ({ hash, vector }),
  );
  writeFileSync(cachePath, JSON.stringify(entries), 'utf-8');
}

/** Maximum number of retries for transient API errors. */
const MAX_RETRIES = 1;

/** Delay before retrying a failed API call (ms). */
const RETRY_DELAY_MS = 1000;

/** Call the Gemini embedding API for a single text, with retry logic. */
async function embedText(
  text: string,
  apiKey: string,
): Promise<number[]> {
  const truncated = text.trim().slice(0, MAX_CONTENT_LENGTH);
  if (!truncated) {
    throw new Error('Cannot embed empty text');
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_MS);
    }

    const response = await fetch(`${EMBED_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: truncated }] },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      lastError = new Error(
        `Gemini embedding API error (${response.status}): ${errText}`,
      );
      // Retry on transient errors (429, 500, 502, 503, 504)
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        continue;
      }
      throw lastError;
    }

    const data = (await response.json()) as EmbedResponse;
    return data.embedding.values;
  }

  throw lastError ?? new Error('Embedding failed after retries');
}

/** Cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/** Sleep for a given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embed all files and query, rank by cosine similarity.
 * Caches embeddings to avoid recomputation across runs.
 */
async function rankByDenseRetrieval(
  query: string,
  files: Map<string, string>,
  topK: number,
): Promise<string[]> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY environment variable not set. ' +
      'Required for dense retrieval baseline. ' +
      'Set it in .env or export it before running benchmarks.',
    );
  }

  // Use a stable repo key for caching
  const filePaths = [...files.keys()].sort();
  const repoKey = contentHash(filePaths.join('\n'));

  // Load existing cache
  const cache = loadCache(repoKey);

  // Embed files (with caching)
  const fileEmbeddings = new Map<string, number[]>();
  let apiCalls = 0;

  for (const [path, content] of files) {
    // Skip files with empty or whitespace-only content
    if (!content.trim()) {
      continue;
    }

    const hash = contentHash(content);
    const cached = cache.get(hash);

    if (cached) {
      fileEmbeddings.set(path, cached);
    } else {
      if (apiCalls > 0) await sleep(API_DELAY_MS);
      const vector = await embedText(content, apiKey);
      cache.set(hash, vector);
      fileEmbeddings.set(path, vector);
      apiCalls++;
    }
  }

  // Embed query
  const queryHash = contentHash(`query:${query}`);
  let queryVector = cache.get(queryHash);
  if (!queryVector) {
    if (apiCalls > 0) await sleep(API_DELAY_MS);
    queryVector = await embedText(query, apiKey);
    cache.set(queryHash, queryVector);
  }

  // Save updated cache
  saveCache(repoKey, cache);

  // Rank by cosine similarity
  const scored: Array<{ path: string; score: number }> = [];
  for (const [path, vector] of fileEmbeddings) {
    const score = cosineSimilarity(queryVector, vector);
    scored.push({ path, score });
  }

  // Sort by score descending, then by path for determinism
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.localeCompare(b.path);
  });

  return scored.slice(0, topK).map((s) => s.path);
}

/** Dense retrieval baseline implementation. */
export const denseRetrievalBaseline: Baseline = {
  name: 'DenseRetrieval',
  async rank(
    query: string,
    files: Map<string, string>,
    topK: number,
  ): Promise<string[]> {
    return rankByDenseRetrieval(query, files, topK);
  },
};
