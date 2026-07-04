/**
 * Tree-sitter WASM initialization helper.
 * Ensures Parser.init() is called exactly once, and provides
 * lazy language loading with caching.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let initPromise: Promise<void> | null = null;
let ParserClass: any = null;
let LanguageClass: any = null;

const languageCache = new Map<string, any>();

/** Get the grammars directory path. */
function getGrammarsDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return join(thisDir, '..', '..', 'grammars');
}

/** Initialize web-tree-sitter (called once, cached). */
export async function initTreeSitter(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import('web-tree-sitter');
      ParserClass = mod.Parser;
      LanguageClass = mod.Language;
      await ParserClass.init();
    })();
  }
  await initPromise;
}

/** Create a new Parser instance. Must call initTreeSitter() first. */
export function createParser(): any {
  if (!ParserClass) {
    throw new Error(
      'Tree-sitter not initialized. Call initTreeSitter() first.',
    );
  }
  return new ParserClass();
}

/** Load a language grammar (cached). */
export async function loadLanguage(grammarName: string): Promise<any> {
  await initTreeSitter();

  const cached = languageCache.get(grammarName);
  if (cached) return cached;

  const wasmPath = join(getGrammarsDir(), `tree-sitter-${grammarName}.wasm`);
  const lang = await LanguageClass.load(wasmPath);
  languageCache.set(grammarName, lang);
  return lang;
}
