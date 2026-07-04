import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { goParser } from '../../src/parsers/go.js';

const GRAMMARS_DIR = join(import.meta.dirname, '..', '..', 'grammars');

let Parser: any;
let Language: any;
let parser: any;

/** Parse a Go source string into a tree. */
function parse(source: string) {
  return parser.parse(source);
}

describe('GoParser', () => {
  beforeAll(async () => {
    const mod = await import('web-tree-sitter');
    Parser = mod.Parser;
    Language = mod.Language;
    await Parser.init();
    const language = await Language.load(
      join(GRAMMARS_DIR, 'tree-sitter-go.wasm'),
    );
    parser = new Parser();
    parser.setLanguage(language);
  });

  afterAll(() => {
    parser?.delete();
  });

  it('extracts single import declarations', () => {
    const tree = parse('package main\nimport "fmt"\n');
    const imports = goParser.extractImports(tree, 'main.go');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('fmt');
  });

  it('extracts grouped import declarations', () => {
    const src = 'package main\nimport (\n\t"fmt"\n\t"os"\n\t"strings"\n)\n';
    const tree = parse(src);
    const imports = goParser.extractImports(tree, 'main.go');
    expect(imports).toHaveLength(3);
    const sources = imports.map((i: any) => i.source);
    expect(sources).toContain('fmt');
    expect(sources).toContain('os');
    expect(sources).toContain('strings');
  });

  it('extracts named (aliased) imports', () => {
    const src = 'package main\nimport (\n\tpb "google/protobuf"\n)\n';
    const tree = parse(src);
    const imports = goParser.extractImports(tree, 'main.go');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('google/protobuf');
    expect(imports[0].specifiers).toContain('pb');
  });

  it('extracts exported function declarations (capitalized)', () => {
    const src = 'package main\nfunc Hello() {}\nfunc hello() {}\n';
    const tree = parse(src);
    const exports = goParser.extractExports(tree, 'main.go');
    const names = exports.map((e: any) => e.name);
    expect(names).toContain('Hello');
    expect(names).not.toContain('hello');
  });

  it('extracts exported type declarations', () => {
    const src = 'package main\ntype Server struct {\n\tPort int\n}\ntype handler struct{}\n';
    const tree = parse(src);
    const exports = goParser.extractExports(tree, 'server.go');
    const names = exports.map((e: any) => e.name);
    expect(names).toContain('Server');
    expect(names).not.toContain('handler');
  });

  it('extracts function and method definitions', () => {
    const src = [
      'package main',
      'func New() *Server { return nil }',
      'func (s *Server) Start() {}',
    ].join('\n');
    const tree = parse(src);
    const defs = goParser.extractDefinitions(tree, 'server.go');
    expect(defs.find((d: any) => d.name === 'New')?.kind).toBe('function');
    expect(defs.find((d: any) => d.name === 'Start')?.kind).toBe('method');
  });

  it('extracts type definitions (struct and interface)', () => {
    const src = [
      'package main',
      'type Reader interface { Read() }',
      'type Config struct { Port int }',
    ].join('\n');
    const tree = parse(src);
    const defs = goParser.extractDefinitions(tree, 'types.go');
    expect(defs.find((d: any) => d.name === 'Reader')?.kind).toBe('interface');
    expect(defs.find((d: any) => d.name === 'Config')?.kind).toBe('struct');
  });

  it('extracts var and const definitions', () => {
    const src = [
      'package main',
      'var MaxRetries = 3',
      'const Version = "1.0"',
    ].join('\n');
    const tree = parse(src);
    const defs = goParser.extractDefinitions(tree, 'config.go');
    expect(defs.find((d: any) => d.name === 'MaxRetries')?.kind).toBe('variable');
    expect(defs.find((d: any) => d.name === 'Version')?.kind).toBe('constant');
  });

  it('extracts function and method calls', () => {
    const src = [
      'package main',
      'func main() {',
      '  fmt.Println("hello")',
      '  process()',
      '}',
    ].join('\n');
    const tree = parse(src);
    const calls = goParser.extractCalls(tree, 'main.go');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const fmtCall = calls.find((c: any) => c.callee === 'Println');
    expect(fmtCall?.receiver).toBe('fmt');
    expect(calls.find((c: any) => c.callee === 'process')).toBeDefined();
  });

  it('handles empty files gracefully', () => {
    const tree = parse('package main\n');
    expect(goParser.extractImports(tree, 'empty.go')).toEqual([]);
    expect(goParser.extractDefinitions(tree, 'empty.go')).toEqual([]);
    expect(goParser.extractCalls(tree, 'empty.go')).toEqual([]);
  });
});
