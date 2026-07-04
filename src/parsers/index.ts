/**
 * Parser registry — maps file extensions to language parser instances.
 * Lazy-loads WASM grammars on first use.
 */

import { extname } from 'node:path';
import type { Tree } from 'web-tree-sitter';
import type { ILanguageParser, ParseResult } from './base.js';
import { typescriptParser } from './typescript.js';
import { pythonParser } from './python.js';
import { cParser } from './c.js';
import { javaParser } from './java.js';
import { goParser } from './go.js';
import { loadLanguage, createParser, initTreeSitter } from './tree-sitter-init.js';

/** Map of file extension to parser instance and grammar name. */
interface ParserEntry {
  parser: ILanguageParser;
  grammarName: string;
  languageName: string;
}

const PARSER_MAP = new Map<string, ParserEntry>();

function registerParser(
  parser: ILanguageParser,
  grammarName: string,
  languageName: string,
): void {
  for (const ext of parser.extensions) {
    PARSER_MAP.set(ext, { parser, grammarName, languageName });
  }
}

// Register all parsers
registerParser(typescriptParser, 'typescript', 'typescript');

// TSX uses a different grammar
const tsxEntry: ParserEntry = {
  parser: typescriptParser,
  grammarName: 'tsx',
  languageName: 'typescript',
};
PARSER_MAP.set('.tsx', tsxEntry);
PARSER_MAP.set('.jsx', tsxEntry);

registerParser(pythonParser, 'python', 'python');
registerParser(cParser, 'c', 'c');
registerParser(javaParser, 'java', 'java');
registerParser(goParser, 'go', 'go');

/** Get the parser entry for a file path, or null if unsupported. */
export function getParserEntry(filePath: string): ParserEntry | null {
  const ext = extname(filePath).toLowerCase();
  return PARSER_MAP.get(ext) ?? null;
}

/** Get supported file extensions. */
export function getSupportedExtensions(): string[] {
  return [...PARSER_MAP.keys()];
}

/** Check if a file is supported by any parser. */
export function isSupported(filePath: string): boolean {
  return getParserEntry(filePath) !== null;
}

/**
 * Parse a single file's contents and extract structural information.
 * Returns null if the file extension is not supported.
 */
export async function parseFile(
  filePath: string,
  content: string,
): Promise<ParseResult | null> {
  const entry = getParserEntry(filePath);
  if (!entry) return null;

  await initTreeSitter();

  const lang = await loadLanguage(entry.grammarName);
  const parser = createParser();
  parser.setLanguage(lang);

  const tree: Tree = parser.parse(content);
  const hasErrors = tree.rootNode.hasError;

  const result: ParseResult = {
    filePath,
    language: entry.languageName,
    imports: entry.parser.extractImports(tree, filePath),
    exports: entry.parser.extractExports(tree, filePath),
    definitions: entry.parser.extractDefinitions(tree, filePath),
    calls: entry.parser.extractCalls(tree, filePath),
    hasErrors,
  };

  parser.delete();
  return result;
}
