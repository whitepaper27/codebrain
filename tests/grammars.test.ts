import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const GRAMMARS_DIR = join(import.meta.dirname, '..', 'grammars');

const GRAMMAR_FILES = [
  'tree-sitter-typescript.wasm',
  'tree-sitter-tsx.wasm',
  'tree-sitter-python.wasm',
  'tree-sitter-c.wasm',
  'tree-sitter-java.wasm',
  'tree-sitter-go.wasm',
];

// web-tree-sitter exports Parser and Language as named exports
// but the types are declared as namespace, so we import dynamically
let Parser: any;
let Language: any;

describe('WASM grammars', () => {
  beforeAll(async () => {
    const mod = await import('web-tree-sitter');
    Parser = mod.Parser;
    Language = mod.Language;
    await Parser.init();
  });

  for (const grammarFile of GRAMMAR_FILES) {
    it(`loads ${grammarFile}`, async () => {
      const wasmPath = join(GRAMMARS_DIR, grammarFile);
      expect(existsSync(wasmPath)).toBe(true);

      const lang = await Language.load(wasmPath);
      expect(lang).toBeDefined();

      const parser = new Parser();
      parser.setLanguage(lang);

      const tree = parser.parse('');
      expect(tree).toBeDefined();
      parser.delete();
    });
  }

  it('parses TypeScript code', async () => {
    const lang = await Language.load(
      join(GRAMMARS_DIR, 'tree-sitter-typescript.wasm'),
    );
    const parser = new Parser();
    parser.setLanguage(lang);

    const tree = parser.parse('const x: number = 42;');
    expect(tree.rootNode.type).toBe('program');
    expect(tree.rootNode.childCount).toBeGreaterThan(0);
    parser.delete();
  });

  it('parses Python code', async () => {
    const lang = await Language.load(
      join(GRAMMARS_DIR, 'tree-sitter-python.wasm'),
    );
    const parser = new Parser();
    parser.setLanguage(lang);

    const tree = parser.parse('def hello():\n    pass\n');
    expect(tree.rootNode.type).toBe('module');
    parser.delete();
  });
});
