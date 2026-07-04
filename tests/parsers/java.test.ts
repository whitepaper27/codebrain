import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { javaParser } from '../../src/parsers/java.js';

const GRAMMARS_DIR = join(import.meta.dirname, '..', '..', 'grammars');

let Parser: any;
let Language: any;
let parser: any;

/** Parse a Java source string into a tree. */
function parse(source: string) {
  return parser.parse(source);
}

describe('JavaParser', () => {
  beforeAll(async () => {
    const mod = await import('web-tree-sitter');
    Parser = mod.Parser;
    Language = mod.Language;
    await Parser.init();
    const language = await Language.load(
      join(GRAMMARS_DIR, 'tree-sitter-java.wasm'),
    );
    parser = new Parser();
    parser.setLanguage(language);
  });

  afterAll(() => {
    parser?.delete();
  });

  it('extracts simple import declarations', () => {
    const tree = parse('import java.util.List;\nimport java.io.File;\n');
    const imports = javaParser.extractImports(tree, 'Main.java');
    expect(imports).toHaveLength(2);
    expect(imports[0].source).toBe('java.util.List');
    expect(imports[0].specifiers).toContain('List');
  });

  it('extracts wildcard imports', () => {
    const tree = parse('import java.util.*;\n');
    const imports = javaParser.extractImports(tree, 'Main.java');
    expect(imports).toHaveLength(1);
    expect(imports[0].isNamespace).toBe(true);
    expect(imports[0].specifiers).toContain('*');
  });

  it('extracts static imports', () => {
    const tree = parse('import static org.junit.Assert.assertEquals;\n');
    const imports = javaParser.extractImports(tree, 'Test.java');
    expect(imports).toHaveLength(1);
    expect(imports[0].isTypeOnly).toBe(false);
  });

  it('extracts public class declarations as exports', () => {
    const tree = parse('public class MyService {\n}\n');
    const exports = javaParser.extractExports(tree, 'MyService.java');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('MyService');
  });

  it('extracts public interface and enum as exports', () => {
    const src = 'public interface Runnable {}\npublic enum Status { OK, FAIL }\n';
    const tree = parse(src);
    const exports = javaParser.extractExports(tree, 'Types.java');
    const names = exports.map((e) => e.name);
    expect(names).toContain('Runnable');
    expect(names).toContain('Status');
  });

  it('does not export non-public classes', () => {
    const tree = parse('class Internal {}\n');
    const exports = javaParser.extractExports(tree, 'Internal.java');
    expect(exports).toHaveLength(0);
  });

  it('extracts class and method definitions', () => {
    const src = [
      'public class Calculator {',
      '  public int add(int a, int b) { return a + b; }',
      '  private static void helper() {}',
      '}',
    ].join('\n');
    const tree = parse(src);
    const defs = javaParser.extractDefinitions(tree, 'Calculator.java');
    expect(defs.find((d) => d.name === 'Calculator')?.kind).toBe('class');
    expect(defs.find((d) => d.name === 'add')?.kind).toBe('method');
    expect(defs.find((d) => d.name === 'helper')?.kind).toBe('method');
  });

  it('extracts method invocation calls', () => {
    const src = [
      'public class Main {',
      '  void run() {',
      '    System.out.println("hello");',
      '    list.add("item");',
      '  }',
      '}',
    ].join('\n');
    const tree = parse(src);
    const calls = javaParser.extractCalls(tree, 'Main.java');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.find((c) => c.callee === 'println')).toBeDefined();
    expect(calls.find((c) => c.callee === 'add')).toBeDefined();
  });

  it('extracts constructor calls (new Class())', () => {
    const src = [
      'public class Main {',
      '  void run() {',
      '    List<String> list = new ArrayList<>();',
      '  }',
      '}',
    ].join('\n');
    const tree = parse(src);
    const calls = javaParser.extractCalls(tree, 'Main.java');
    const ctorCalls = calls.filter((c) => c.isConstructor);
    expect(ctorCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty files gracefully', () => {
    const tree = parse('');
    expect(javaParser.extractImports(tree, 'Empty.java')).toEqual([]);
    expect(javaParser.extractExports(tree, 'Empty.java')).toEqual([]);
    expect(javaParser.extractDefinitions(tree, 'Empty.java')).toEqual([]);
    expect(javaParser.extractCalls(tree, 'Empty.java')).toEqual([]);
  });
});
