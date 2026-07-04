/**
 * TypeScript/JavaScript parser for CodeBrain.
 * Extracts imports, exports, definitions, and call sites from TS/JS ASTs.
 * Handles ESM imports/exports, CJS require, dynamic imports, and all
 * TypeScript-specific syntax (interfaces, type aliases, enums).
 */

import type { Tree } from 'web-tree-sitter';
import type {
  ILanguageParser,
  Import,
  Export,
  Definition,
  Call,
} from './base.js';

/** Tree-sitter node with the fields we access. */
interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  namedChildren: SyntaxNode[];
  childForFieldName(name: string): SyntaxNode | null;
  descendantsOfType(type: string | string[]): SyntaxNode[];
  parent: SyntaxNode | null;
  namedChild(index: number): SyntaxNode | null;
  childCount: number;
  child(index: number): SyntaxNode | null;
}

/** Extract the string value from a tree-sitter string node, stripping quotes. */
function stripQuotes(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, '');
}

/** Check whether a node is inside a function/method body (not module-level). */
function isModuleLevel(node: SyntaxNode): boolean {
  let current = node.parent;
  while (current) {
    const t = current.type;
    if (
      t === 'function_declaration' ||
      t === 'method_definition' ||
      t === 'arrow_function' ||
      t === 'function' ||
      t === 'class_body'
    ) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

/**
 * Find the source string node inside an import or export statement.
 * Returns the stripped module path or null if not found.
 */
function findSourceString(node: SyntaxNode): string | null {
  const sourceNode = node.childForFieldName('source');
  if (sourceNode) return stripQuotes(sourceNode.text);
  const stringNodes = node.descendantsOfType('string');
  if (stringNodes.length > 0) return stripQuotes(stringNodes[0].text);
  return null;
}

/** Check if a node has the 'type' keyword indicating type-only import/export. */
function hasTypeKeyword(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === 'type' && child.text === 'type') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

/** Extract ESM import statements from the AST root. */
function extractEsmImports(root: SyntaxNode): Import[] {
  const results: Import[] = [];
  const importNodes = root.descendantsOfType('import_statement');

  for (const node of importNodes) {
    const source = findSourceString(node);
    if (!source) continue;

    const isTypeOnly = hasTypeKeyword(node);
    const clause = node.descendantsOfType('import_clause')[0] ?? null;

    if (!clause) {
      // Side-effect import: import 'module'
      results.push(makeSideEffectImport(source, isTypeOnly, node));
      continue;
    }

    processImportClause(clause, source, isTypeOnly, node, results);
  }

  return results;
}

/** Create a side-effect import (no specifiers). */
function makeSideEffectImport(
  source: string,
  isTypeOnly: boolean,
  node: SyntaxNode,
): Import {
  return {
    source,
    specifiers: [],
    isDefault: false,
    isNamespace: false,
    isTypeOnly,
    line: node.startPosition.row,
    column: node.startPosition.column,
  };
}

/** Process an import clause and push results. */
function processImportClause(
  clause: SyntaxNode,
  source: string,
  isTypeOnly: boolean,
  node: SyntaxNode,
  results: Import[],
): void {
  const nsImports = clause.descendantsOfType('namespace_import');
  const namedImports = clause.descendantsOfType('named_imports');
  const identifiers = clause.namedChildren.filter(
    (c) => c.type === 'identifier',
  );

  // Default import: import x from 'module'
  if (identifiers.length > 0) {
    results.push({
      source,
      specifiers: [identifiers[0].text],
      isDefault: true,
      isNamespace: false,
      isTypeOnly,
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }

  // Namespace import: import * as x from 'module'
  if (nsImports.length > 0) {
    const alias =
      nsImports[0].descendantsOfType('identifier')[0]?.text ?? '*';
    results.push({
      source,
      specifiers: [alias],
      isDefault: false,
      isNamespace: true,
      isTypeOnly,
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }

  // Named imports: import { a, b } from 'module'
  if (namedImports.length > 0) {
    const specs = namedImports[0]
      .descendantsOfType('import_specifier')
      .map((s) => {
        const alias = s.childForFieldName('alias');
        return alias ? alias.text : s.descendantsOfType('identifier')[0]?.text;
      })
      .filter(Boolean) as string[];

    results.push({
      source,
      specifiers: specs,
      isDefault: false,
      isNamespace: false,
      isTypeOnly: isTypeOnly || hasTypeKeyword(namedImports[0]),
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
}

/** Extract CJS require calls: const x = require('module'). */
function extractRequireCalls(root: SyntaxNode): Import[] {
  const results: Import[] = [];
  const calls = root.descendantsOfType('call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn || fn.text !== 'require') continue;

    const args = call.childForFieldName('arguments');
    if (!args) continue;
    const strNode = args.descendantsOfType('string')[0];
    if (!strNode) continue;

    results.push({
      source: stripQuotes(strNode.text),
      specifiers: [],
      isDefault: true,
      isNamespace: false,
      isTypeOnly: false,
      line: call.startPosition.row,
      column: call.startPosition.column,
    });
  }

  return results;
}

/** Extract dynamic imports: import('module'). */
function extractDynamicImports(root: SyntaxNode): Import[] {
  const results: Import[] = [];

  // tree-sitter parses dynamic import as call_expression with "import" function
  const calls = root.descendantsOfType('call_expression');
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn || fn.type !== 'import') continue;

    const args = call.childForFieldName('arguments');
    if (!args) continue;
    const strNode = args.descendantsOfType('string')[0];
    if (!strNode) continue;

    results.push({
      source: stripQuotes(strNode.text),
      specifiers: [],
      isDefault: false,
      isNamespace: false,
      isTypeOnly: false,
      line: call.startPosition.row,
      column: call.startPosition.column,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

/** Extract all export statements from the AST root. */
function extractExportStatements(root: SyntaxNode): Export[] {
  const results: Export[] = [];
  const exportNodes = root.descendantsOfType('export_statement');

  for (const node of exportNodes) {
    const isTypeOnly = hasTypeKeyword(node);
    const source = findSourceString(node);
    const isReExport = source !== null;

    // Check for export * from 'module' (re-export all)
    if (isReExportAll(node)) {
      results.push({
        name: '*',
        isDefault: false,
        isReExport: true,
        reExportSource: source ?? undefined,
        isTypeOnly,
        line: node.startPosition.row,
        column: node.startPosition.column,
      });
      continue;
    }

    // Named re-exports or named exports: export { a, b } [from 'module']
    const exportClause = node.descendantsOfType('export_clause')[0];
    if (exportClause) {
      extractNamedExports(exportClause, isReExport, source, isTypeOnly, node, results);
      continue;
    }

    // Default export
    if (nodeHasDefault(node)) {
      extractDefaultExport(node, isTypeOnly, results);
      continue;
    }

    // Declaration exports: export const/function/class/interface/type/enum
    extractDeclarationExports(node, isTypeOnly, results);
  }

  return results;
}

/** Check if an export statement is `export *`. */
function isReExportAll(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === '*') return true;
  }
  return false;
}

/** Check if node contains the 'default' keyword. */
function nodeHasDefault(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.text === 'default') return true;
  }
  return false;
}

/** Extract named exports from an export clause. */
function extractNamedExports(
  clause: SyntaxNode,
  isReExport: boolean,
  source: string | null,
  isTypeOnly: boolean,
  node: SyntaxNode,
  results: Export[],
): void {
  const specifiers = clause.descendantsOfType('export_specifier');
  for (const spec of specifiers) {
    const alias = spec.childForFieldName('alias');
    const name = alias
      ? alias.text
      : spec.descendantsOfType('identifier')[0]?.text ?? spec.text;

    results.push({
      name,
      isDefault: name === 'default',
      isReExport,
      reExportSource: source ?? undefined,
      isTypeOnly,
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
}

/** Extract a default export. */
function extractDefaultExport(
  node: SyntaxNode,
  isTypeOnly: boolean,
  results: Export[],
): void {
  let name = 'default';
  const decl = findDeclarationChild(node);
  if (decl) {
    const nameNode = decl.childForFieldName('name');
    if (nameNode) name = nameNode.text;
  }

  results.push({
    name,
    isDefault: true,
    isReExport: false,
    isTypeOnly,
    line: node.startPosition.row,
    column: node.startPosition.column,
  });
}

/** Find a declaration child node inside an export statement. */
function findDeclarationChild(node: SyntaxNode): SyntaxNode | null {
  const declTypes = [
    'function_declaration',
    'class_declaration',
    'lexical_declaration',
    'variable_declaration',
  ];
  for (const t of declTypes) {
    const found = node.descendantsOfType(t);
    if (found.length > 0) return found[0];
  }
  return null;
}

/** Extract exports from declaration statements (export const/function/etc). */
function extractDeclarationExports(
  node: SyntaxNode,
  isTypeOnly: boolean,
  results: Export[],
): void {
  const declTypes = [
    'function_declaration',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
  ];

  for (const t of declTypes) {
    const decls = node.descendantsOfType(t);
    for (const decl of decls) {
      const nameNode = decl.childForFieldName('name');
      if (!nameNode) continue;
      results.push({
        name: nameNode.text,
        isDefault: false,
        isReExport: false,
        isTypeOnly: isTypeOnly || t === 'type_alias_declaration' || t === 'interface_declaration',
        line: node.startPosition.row,
        column: node.startPosition.column,
      });
    }
  }

  // Lexical declarations: export const x = ..., export let y = ...
  const lexDecls = node.descendantsOfType('lexical_declaration');
  const varDecls = node.descendantsOfType('variable_declaration');
  for (const decl of [...lexDecls, ...varDecls]) {
    const declarators = decl.descendantsOfType('variable_declarator');
    for (const d of declarators) {
      const nameNode = d.childForFieldName('name');
      if (!nameNode) continue;
      results.push({
        name: nameNode.text,
        isDefault: false,
        isReExport: false,
        isTypeOnly,
        line: node.startPosition.row,
        column: node.startPosition.column,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Definition extraction
// ---------------------------------------------------------------------------

/** Map of tree-sitter node types to Definition kinds. */
const DEFINITION_TYPE_MAP: Record<string, Definition['kind']> = {
  function_declaration: 'function',
  class_declaration: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
};

/** Extract module-level definitions from the AST root. */
function extractModuleLevelDefinitions(root: SyntaxNode): Definition[] {
  const results: Definition[] = [];
  const types = Object.keys(DEFINITION_TYPE_MAP);

  for (const type of types) {
    const nodes = root.descendantsOfType(type);
    for (const node of nodes) {
      if (!isModuleLevel(node)) continue;
      const nameNode = node.childForFieldName('name');
      if (!nameNode) continue;

      results.push({
        name: nameNode.text,
        kind: DEFINITION_TYPE_MAP[type],
        exported: isExported(node),
        line: node.startPosition.row,
        column: node.startPosition.column,
      });
    }
  }

  // Module-level variable/const/let declarations
  extractModuleLevelVariables(root, results);

  return results;
}

/** Check if a node is inside an export_statement. */
function isExported(node: SyntaxNode): boolean {
  return node.parent?.type === 'export_statement';
}

/** Extract module-level const/let/var declarations. */
function extractModuleLevelVariables(
  root: SyntaxNode,
  results: Definition[],
): void {
  const lexDecls = root.descendantsOfType('lexical_declaration');
  const varDecls = root.descendantsOfType('variable_declaration');

  for (const decl of [...lexDecls, ...varDecls]) {
    if (!isModuleLevel(decl)) continue;

    const isConst = decl.text.startsWith('const');
    const exported = isExported(decl);
    const declarators = decl.descendantsOfType('variable_declarator');

    for (const d of declarators) {
      const nameNode = d.childForFieldName('name');
      if (!nameNode || nameNode.type !== 'identifier') continue;

      results.push({
        name: nameNode.text,
        kind: isConst ? 'constant' : 'variable',
        exported,
        line: d.startPosition.row,
        column: d.startPosition.column,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Call extraction
// ---------------------------------------------------------------------------

/** Build the receiver string from a member_expression chain. */
function buildReceiver(memberExpr: SyntaxNode): {
  callee: string;
  receiver: string;
} {
  const prop = memberExpr.childForFieldName('property');
  const obj = memberExpr.childForFieldName('object');
  const callee = prop?.text ?? memberExpr.text;
  const receiver = obj?.text ?? '';
  return { callee, receiver };
}

/** Extract function and method call sites from the AST root. */
function extractCallExpressions(root: SyntaxNode): Call[] {
  const results: Call[] = [];

  // Regular call expressions: foo(), obj.method(), a.b.c()
  const calls = root.descendantsOfType('call_expression');
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    // Skip require() and import() — handled by import extraction
    if (fn.type === 'identifier' && fn.text === 'require') continue;
    if (fn.type === 'import') continue;

    if (fn.type === 'member_expression') {
      const { callee, receiver } = buildReceiver(fn);
      results.push({
        callee,
        receiver,
        isConstructor: false,
        line: call.startPosition.row,
        column: call.startPosition.column,
      });
    } else {
      results.push({
        callee: fn.text,
        receiver: undefined,
        isConstructor: false,
        line: call.startPosition.row,
        column: call.startPosition.column,
      });
    }
  }

  // Constructor calls: new Foo()
  const newExprs = root.descendantsOfType('new_expression');
  for (const expr of newExprs) {
    const constructor = expr.childForFieldName('constructor');
    if (!constructor) continue;

    results.push({
      callee: constructor.text,
      receiver: undefined,
      isConstructor: true,
      line: expr.startPosition.row,
      column: expr.startPosition.column,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Parser implementation
// ---------------------------------------------------------------------------

/**
 * TypeScript/JavaScript language parser.
 * Implements ILanguageParser for .ts, .tsx, .js, .jsx files.
 */
export const typescriptParser: ILanguageParser = {
  extensions: ['.ts', '.tsx', '.js', '.jsx'],

  /** Extract all import statements (ESM, CJS require, dynamic import). */
  extractImports(tree: Tree, _filePath: string): Import[] {
    const root = tree.rootNode as unknown as SyntaxNode;
    return [
      ...extractEsmImports(root),
      ...extractRequireCalls(root),
      ...extractDynamicImports(root),
    ];
  },

  /** Extract all export declarations. */
  extractExports(tree: Tree, _filePath: string): Export[] {
    const root = tree.rootNode as unknown as SyntaxNode;
    return extractExportStatements(root);
  },

  /** Extract module-level symbol definitions. */
  extractDefinitions(tree: Tree, _filePath: string): Definition[] {
    const root = tree.rootNode as unknown as SyntaxNode;
    return extractModuleLevelDefinitions(root);
  },

  /** Extract function/method call sites. */
  extractCalls(tree: Tree, _filePath: string): Call[] {
    const root = tree.rootNode as unknown as SyntaxNode;
    return extractCallExpressions(root);
  },
};
