import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { cParser } from '../../src/parsers/c.js';

const GRAMMARS_DIR = join(import.meta.dirname, '..', '..', 'grammars');

let Parser: any;
let Language: any;
let parser: any;

/** Parse a C source string into a tree. */
function parse(source: string) {
  return parser.parse(source);
}

describe('CParser', () => {
  beforeAll(async () => {
    const mod = await import('web-tree-sitter');
    Parser = mod.Parser;
    Language = mod.Language;
    await Parser.init();
    const language = await Language.load(
      join(GRAMMARS_DIR, 'tree-sitter-c.wasm'),
    );
    parser = new Parser();
    parser.setLanguage(language);
  });

  afterAll(() => {
    parser?.delete();
  });

  it('extracts local #include directives', () => {
    const tree = parse('#include "myheader.h"\n');
    const imports = cParser.extractImports(tree, 'main.c');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('myheader.h');
    expect(imports[0].isNamespace).toBe(false);
  });

  it('extracts system #include directives with isNamespace flag', () => {
    const tree = parse('#include <stdio.h>\n#include <stdlib.h>\n');
    const imports = cParser.extractImports(tree, 'main.c');
    expect(imports).toHaveLength(2);
    expect(imports[0].source).toBe('stdio.h');
    expect(imports[0].isNamespace).toBe(true);
    expect(imports[1].source).toBe('stdlib.h');
  });

  it('extracts exports from .h files (function declarations)', () => {
    const tree = parse('int add(int a, int b);\nvoid process(void);\n');
    const exports = cParser.extractExports(tree, 'math.h');
    expect(exports.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts exports from .c files (non-static functions)', () => {
    const src = 'int add(int a, int b) { return a + b; }\nstatic void helper() {}\n';
    const tree = parse(src);
    const exports = cParser.extractExports(tree, 'math.c');
    const names = exports.map((e) => e.name);
    expect(names).toContain('add');
    expect(names).not.toContain('helper');
  });

  it('extracts function definitions', () => {
    const src = 'int main(int argc, char** argv) { return 0; }\n';
    const tree = parse(src);
    const defs = cParser.extractDefinitions(tree, 'main.c');
    expect(defs.find((d) => d.name === 'main')).toBeDefined();
    expect(defs.find((d) => d.name === 'main')?.kind).toBe('function');
  });

  it('extracts struct, union, and enum definitions', () => {
    const src = 'struct Point { int x; int y; };\nunion Data { int i; float f; };\nenum Color { RED, GREEN, BLUE };\n';
    const tree = parse(src);
    const defs = cParser.extractDefinitions(tree, 'types.h');
    expect(defs.find((d) => d.name === 'Point')?.kind).toBe('struct');
    expect(defs.find((d) => d.name === 'Data')?.kind).toBe('union');
    expect(defs.find((d) => d.name === 'Color')?.kind).toBe('enum');
  });

  it('extracts typedef declarations', () => {
    const src = 'typedef unsigned int uint;\ntypedef struct { int x; } Vec2;\n';
    const tree = parse(src);
    const defs = cParser.extractDefinitions(tree, 'types.h');
    const typedefs = defs.filter((d) => d.kind === 'type');
    expect(typedefs.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts #define macros', () => {
    const src = '#define MAX_SIZE 100\n#define PI 3.14\n';
    const tree = parse(src);
    const defs = cParser.extractDefinitions(tree, 'config.h');
    expect(defs.filter((d) => d.kind === 'macro')).toHaveLength(2);
    expect(defs.find((d) => d.name === 'MAX_SIZE')).toBeDefined();
  });

  it('extracts function calls', () => {
    const src = 'void test() { printf("hello"); malloc(100); }\n';
    const tree = parse(src);
    const calls = cParser.extractCalls(tree, 'test.c');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.find((c) => c.callee === 'printf')).toBeDefined();
    expect(calls.find((c) => c.callee === 'malloc')).toBeDefined();
  });

  it('handles empty files gracefully', () => {
    const tree = parse('');
    expect(cParser.extractImports(tree, 'empty.c')).toEqual([]);
    expect(cParser.extractExports(tree, 'empty.c')).toEqual([]);
    expect(cParser.extractDefinitions(tree, 'empty.c')).toEqual([]);
    expect(cParser.extractCalls(tree, 'empty.c')).toEqual([]);
  });
});
