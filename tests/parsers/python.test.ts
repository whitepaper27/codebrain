import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { pythonParser } from '../../src/parsers/python.js';

const GRAMMARS_DIR = join(import.meta.dirname, '..', '..', 'grammars');

let Parser: any;
let Language: any;
let parser: any;
let language: any;

/** Parse a Python source string into a tree. */
function parse(source: string) {
  return parser.parse(source);
}

describe('PythonParser', () => {
  beforeAll(async () => {
    const mod = await import('web-tree-sitter');
    Parser = mod.Parser;
    Language = mod.Language;
    await Parser.init();
    language = await Language.load(
      join(GRAMMARS_DIR, 'tree-sitter-python.wasm'),
    );
    parser = new Parser();
    parser.setLanguage(language);
  });

  afterAll(() => {
    parser?.delete();
  });

  it('extracts simple import statements', () => {
    const tree = parse('import os\nimport sys\n');
    const imports = pythonParser.extractImports(tree, 'main.py');
    expect(imports).toHaveLength(2);
    expect(imports[0].source).toBe('os');
    expect(imports[1].source).toBe('sys');
  });

  it('extracts from-import statements with specifiers', () => {
    const tree = parse('from os.path import join, dirname\n');
    const imports = pythonParser.extractImports(tree, 'main.py');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('os.path');
    expect(imports[0].specifiers).toContain('join');
    expect(imports[0].specifiers).toContain('dirname');
  });

  it('extracts relative imports', () => {
    const tree = parse('from . import utils\nfrom .core import engine\n');
    const imports = pythonParser.extractImports(tree, 'pkg/sub.py');
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts wildcard imports', () => {
    const tree = parse('from module import *\n');
    const imports = pythonParser.extractImports(tree, 'main.py');
    expect(imports).toHaveLength(1);
    expect(imports[0].isNamespace).toBe(true);
    expect(imports[0].specifiers).toContain('*');
  });

  it('extracts module-level exports (defs + classes + assignments)', () => {
    const tree = parse(
      'def hello(): pass\nclass Foo: pass\nVALUE = 42\n',
    );
    const exports = pythonParser.extractExports(tree, 'mod.py');
    const names = exports.map((e) => e.name);
    expect(names).toContain('hello');
    expect(names).toContain('Foo');
    expect(names).toContain('VALUE');
  });

  it('extracts function and class definitions', () => {
    const tree = parse(
      'def foo(): pass\nasync def bar(): pass\nclass Baz: pass\n',
    );
    const defs = pythonParser.extractDefinitions(tree, 'mod.py');
    expect(defs.find((d) => d.name === 'foo')?.kind).toBe('function');
    expect(defs.find((d) => d.name === 'bar')?.kind).toBe('function');
    expect(defs.find((d) => d.name === 'Baz')?.kind).toBe('class');
  });

  it('extracts method definitions inside classes', () => {
    const tree = parse(
      'class MyClass:\n    def method(self): pass\n',
    );
    const defs = pythonParser.extractDefinitions(tree, 'mod.py');
    const method = defs.find((d) => d.name === 'method');
    expect(method?.kind).toBe('method');
  });

  it('extracts module-level variable assignments', () => {
    const tree = parse('MAX_SIZE = 100\nDEBUG = True\n');
    const defs = pythonParser.extractDefinitions(tree, 'config.py');
    expect(defs).toHaveLength(2);
    expect(defs[0].kind).toBe('variable');
    expect(defs[0].exported).toBe(true);
  });

  it('extracts function and method calls', () => {
    const tree = parse('print("hello")\nos.path.join("a", "b")\n');
    const calls = pythonParser.extractCalls(tree, 'main.py');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const printCall = calls.find((c) => c.callee === 'print');
    expect(printCall).toBeDefined();
  });

  it('extracts decorator calls', () => {
    const tree = parse('@app.route("/api")\ndef handler(): pass\n');
    const calls = pythonParser.extractCalls(tree, 'routes.py');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty files gracefully', () => {
    const tree = parse('');
    expect(pythonParser.extractImports(tree, 'empty.py')).toEqual([]);
    expect(pythonParser.extractExports(tree, 'empty.py')).toEqual([]);
    expect(pythonParser.extractDefinitions(tree, 'empty.py')).toEqual([]);
    expect(pythonParser.extractCalls(tree, 'empty.py')).toEqual([]);
  });
});
