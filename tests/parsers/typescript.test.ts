/**
 * Tests for the TypeScript/JavaScript parser.
 * Covers ESM imports, CJS require, dynamic imports, exports, definitions, and calls.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Tree } from 'web-tree-sitter';
import {
  initTreeSitter,
  loadLanguage,
  createParser,
} from '../../src/parsers/tree-sitter-init.js';
import { typescriptParser } from '../../src/parsers/typescript.js';

let parser: any;

/** Parse a TypeScript code snippet and return the tree. */
function parse(code: string): Tree {
  return parser.parse(code);
}

beforeAll(async () => {
  await initTreeSitter();
  const lang = await loadLanguage('typescript');
  parser = createParser();
  parser.setLanguage(lang);
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

describe('extractImports', () => {
  it('extracts named imports', () => {
    const tree = parse(`import { foo, bar } from 'my-module';`);
    const imports = typescriptParser.extractImports(tree, 'test.ts');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('my-module');
    expect(imports[0].specifiers).toEqual(['foo', 'bar']);
    expect(imports[0].isDefault).toBe(false);
    expect(imports[0].isNamespace).toBe(false);
    expect(imports[0].isTypeOnly).toBe(false);
  });

  it('extracts default imports', () => {
    const tree = parse(`import React from 'react';`);
    const imports = typescriptParser.extractImports(tree, 'test.ts');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('react');
    expect(imports[0].specifiers).toEqual(['React']);
    expect(imports[0].isDefault).toBe(true);
  });

  it('extracts namespace imports', () => {
    const tree = parse(`import * as path from 'node:path';`);
    const imports = typescriptParser.extractImports(tree, 'test.ts');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('node:path');
    expect(imports[0].specifiers).toEqual(['path']);
    expect(imports[0].isNamespace).toBe(true);
  });

  it('extracts type-only imports', () => {
    const tree = parse(`import type { MyType } from './types';`);
    const imports = typescriptParser.extractImports(tree, 'test.ts');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('./types');
    expect(imports[0].isTypeOnly).toBe(true);
  });

  it('extracts CJS require calls', () => {
    const tree = parse(`const fs = require('fs');`);
    const imports = typescriptParser.extractImports(tree, 'test.ts');
    const requireImport = imports.find((i) => i.source === 'fs');
    expect(requireImport).toBeDefined();
    expect(requireImport!.isDefault).toBe(true);
  });

  it('extracts dynamic imports', () => {
    const tree = parse(`const mod = import('./lazy-module');`);
    const imports = typescriptParser.extractImports(tree, 'test.ts');
    const dynImport = imports.find((i) => i.source === './lazy-module');
    expect(dynImport).toBeDefined();
    expect(dynImport!.isDefault).toBe(false);
  });

  it('handles side-effect imports', () => {
    const tree = parse(`import 'reflect-metadata';`);
    const imports = typescriptParser.extractImports(tree, 'test.ts');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('reflect-metadata');
    expect(imports[0].specifiers).toEqual([]);
  });

  it('handles mixed default and named imports', () => {
    const tree = parse(`import React, { useState, useEffect } from 'react';`);
    const imports = typescriptParser.extractImports(tree, 'test.ts');
    // Should produce a default import and a named import
    expect(imports.length).toBeGreaterThanOrEqual(2);
    const defaultImport = imports.find((i) => i.isDefault);
    const namedImport = imports.find(
      (i) => !i.isDefault && !i.isNamespace,
    );
    expect(defaultImport).toBeDefined();
    expect(defaultImport!.specifiers).toContain('React');
    expect(namedImport).toBeDefined();
    expect(namedImport!.specifiers).toEqual(
      expect.arrayContaining(['useState', 'useEffect']),
    );
  });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

describe('extractExports', () => {
  it('extracts named exports', () => {
    const tree = parse(`export { foo, bar };`);
    const exports = typescriptParser.extractExports(tree, 'test.ts');
    const names = exports.map((e) => e.name);
    expect(names).toContain('foo');
    expect(names).toContain('bar');
  });

  it('extracts default export', () => {
    const tree = parse(`export default function main() {}`);
    const exports = typescriptParser.extractExports(tree, 'test.ts');
    expect(exports).toHaveLength(1);
    expect(exports[0].isDefault).toBe(true);
    expect(exports[0].name).toBe('main');
  });

  it('extracts declaration exports (const)', () => {
    const tree = parse(`export const MY_CONST = 42;`);
    const exports = typescriptParser.extractExports(tree, 'test.ts');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('MY_CONST');
  });

  it('extracts declaration exports (function)', () => {
    const tree = parse(`export function calculate() { return 1; }`);
    const exports = typescriptParser.extractExports(tree, 'test.ts');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('calculate');
  });

  it('extracts re-export all', () => {
    const tree = parse(`export * from './utils';`);
    const exports = typescriptParser.extractExports(tree, 'test.ts');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('*');
    expect(exports[0].isReExport).toBe(true);
    expect(exports[0].reExportSource).toBe('./utils');
  });

  it('extracts re-export named', () => {
    const tree = parse(`export { foo, bar } from './helpers';`);
    const exports = typescriptParser.extractExports(tree, 'test.ts');
    expect(exports.length).toBe(2);
    expect(exports[0].isReExport).toBe(true);
    expect(exports[0].reExportSource).toBe('./helpers');
  });

  it('extracts type-only exports', () => {
    const tree = parse(`export type { MyInterface } from './types';`);
    const exports = typescriptParser.extractExports(tree, 'test.ts');
    expect(exports).toHaveLength(1);
    expect(exports[0].isTypeOnly).toBe(true);
    expect(exports[0].isReExport).toBe(true);
  });

  it('extracts exported interface', () => {
    const tree = parse(`export interface Config { port: number; }`);
    const exports = typescriptParser.extractExports(tree, 'test.ts');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('Config');
    expect(exports[0].isTypeOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

describe('extractDefinitions', () => {
  it('extracts function declarations', () => {
    const tree = parse(`function greet(name: string) { return name; }`);
    const defs = typescriptParser.extractDefinitions(tree, 'test.ts');
    const greet = defs.find((d) => d.name === 'greet');
    expect(greet).toBeDefined();
    expect(greet!.kind).toBe('function');
    expect(greet!.exported).toBe(false);
  });

  it('extracts async function declarations', () => {
    const tree = parse(`async function fetchData() { return []; }`);
    const defs = typescriptParser.extractDefinitions(tree, 'test.ts');
    const fn = defs.find((d) => d.name === 'fetchData');
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe('function');
  });

  it('extracts class declarations', () => {
    const tree = parse(`class UserService { async find() {} }`);
    const defs = typescriptParser.extractDefinitions(tree, 'test.ts');
    const cls = defs.find((d) => d.name === 'UserService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
  });

  it('extracts interface declarations', () => {
    const tree = parse(`interface IParser { parse(): void; }`);
    const defs = typescriptParser.extractDefinitions(tree, 'test.ts');
    const iface = defs.find((d) => d.name === 'IParser');
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe('interface');
  });

  it('extracts type alias declarations', () => {
    const tree = parse(`type Result<T> = { ok: boolean; value: T };`);
    const defs = typescriptParser.extractDefinitions(tree, 'test.ts');
    const typeDef = defs.find((d) => d.name === 'Result');
    expect(typeDef).toBeDefined();
    expect(typeDef!.kind).toBe('type');
  });

  it('extracts enum declarations', () => {
    const tree = parse(`enum Status { Active, Inactive }`);
    const defs = typescriptParser.extractDefinitions(tree, 'test.ts');
    const enumDef = defs.find((d) => d.name === 'Status');
    expect(enumDef).toBeDefined();
    expect(enumDef!.kind).toBe('enum');
  });

  it('extracts const declarations at module level', () => {
    const tree = parse(`const MAX_RETRIES = 3;`);
    const defs = typescriptParser.extractDefinitions(tree, 'test.ts');
    const constDef = defs.find((d) => d.name === 'MAX_RETRIES');
    expect(constDef).toBeDefined();
    expect(constDef!.kind).toBe('constant');
  });

  it('marks exported definitions', () => {
    const tree = parse(`export function serve() {}`);
    const defs = typescriptParser.extractDefinitions(tree, 'test.ts');
    const fn = defs.find((d) => d.name === 'serve');
    expect(fn).toBeDefined();
    expect(fn!.exported).toBe(true);
  });

  it('excludes function-scoped declarations', () => {
    const tree = parse(`
function outer() {
  const inner = 5;
  function nested() {}
}
    `);
    const defs = typescriptParser.extractDefinitions(tree, 'test.ts');
    expect(defs.find((d) => d.name === 'inner')).toBeUndefined();
    expect(defs.find((d) => d.name === 'nested')).toBeUndefined();
    expect(defs.find((d) => d.name === 'outer')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

describe('extractCalls', () => {
  it('extracts simple function calls', () => {
    const tree = parse(`foo();`);
    const calls = typescriptParser.extractCalls(tree, 'test.ts');
    const fooCall = calls.find((c) => c.callee === 'foo');
    expect(fooCall).toBeDefined();
    expect(fooCall!.receiver).toBeUndefined();
    expect(fooCall!.isConstructor).toBe(false);
  });

  it('extracts method calls with receiver', () => {
    const tree = parse(`obj.method();`);
    const calls = typescriptParser.extractCalls(tree, 'test.ts');
    const methodCall = calls.find((c) => c.callee === 'method');
    expect(methodCall).toBeDefined();
    expect(methodCall!.receiver).toBe('obj');
  });

  it('extracts constructor calls', () => {
    const tree = parse(`const x = new Map();`);
    const calls = typescriptParser.extractCalls(tree, 'test.ts');
    const ctorCall = calls.find((c) => c.callee === 'Map');
    expect(ctorCall).toBeDefined();
    expect(ctorCall!.isConstructor).toBe(true);
  });

  it('extracts chained method calls', () => {
    const tree = parse(`a.b.c();`);
    const calls = typescriptParser.extractCalls(tree, 'test.ts');
    const chainedCall = calls.find((c) => c.callee === 'c');
    expect(chainedCall).toBeDefined();
    expect(chainedCall!.receiver).toBe('a.b');
  });

  it('does not count require() as a call', () => {
    const tree = parse(`const x = require('fs');`);
    const calls = typescriptParser.extractCalls(tree, 'test.ts');
    expect(calls.find((c) => c.callee === 'require')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Parser metadata
// ---------------------------------------------------------------------------

describe('typescriptParser metadata', () => {
  it('supports correct file extensions', () => {
    expect(typescriptParser.extensions).toEqual(['.ts', '.tsx', '.js', '.jsx']);
  });
});
