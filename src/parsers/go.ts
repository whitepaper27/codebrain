/**
 * Go language parser for CodeBrain.
 * Extracts imports, exports, definitions, and calls from Go ASTs.
 */

import type { Tree, Node as SyntaxNode } from 'web-tree-sitter';
import type {
  ILanguageParser,
  Import,
  Export,
  Definition,
  Call,
} from './base.js';

/** Collect all descendants matching a node type. */
function collectNodes(root: SyntaxNode, type: string): SyntaxNode[] {
  const results: SyntaxNode[] = [];
  const cursor = root.walk();
  let reachedRoot = false;
  while (!reachedRoot) {
    if (cursor.nodeType === type) {
      results.push(cursor.currentNode);
    }
    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;
    while (true) {
      if (!cursor.gotoParent()) { reachedRoot = true; break; }
      if (cursor.gotoNextSibling()) break;
    }
  }
  return results;
}

/** Check if an identifier starts with an uppercase letter (Go export rule). */
function isExported(name: string): boolean {
  if (name.length === 0) return false;
  const first = name.charCodeAt(0);
  return first >= 65 && first <= 90; // A-Z
}

/** Strip quotes from a Go import path. */
function stripQuotes(text: string): string {
  return text.replace(/^["'`]|["'`]$/g, '');
}

/** Extract single import declarations: import "pkg". */
function extractSingleImports(root: SyntaxNode): Import[] {
  const imports: Import[] = [];
  const importDecls = collectNodes(root, 'import_declaration');
  for (const decl of importDecls) {
    const specs = collectNodes(decl, 'import_spec');
    if (specs.length > 0) {
      for (const spec of specs) {
        imports.push(parseImportSpec(spec));
      }
    } else {
      const pathNode = decl.namedChildren.find(
        (c: SyntaxNode) => c.type === 'interpreted_string_literal',
      );
      if (pathNode) {
        imports.push({
          source: stripQuotes(pathNode.text),
          specifiers: [],
          isDefault: true,
          isNamespace: false,
          isTypeOnly: false,
          line: decl.startPosition.row,
          column: decl.startPosition.column,
        });
      }
    }
  }
  return imports;
}

/** Parse a single import_spec node. */
function parseImportSpec(spec: SyntaxNode): Import {
  const nameNode = spec.childForFieldName('name');
  const pathNode = spec.childForFieldName('path');
  const source = pathNode ? stripQuotes(pathNode.text) : '';
  const alias = nameNode?.text;
  return {
    source,
    specifiers: alias ? [alias] : [],
    isDefault: !alias || alias === '.',
    isNamespace: alias === '.',
    isTypeOnly: false,
    line: spec.startPosition.row,
    column: spec.startPosition.column,
  };
}

/** Extract exported identifiers across function, type, var, and const declarations. */
function extractGoExports(root: SyntaxNode): Export[] {
  const exports: Export[] = [];
  addFuncExports(root, exports);
  addTypeExports(root, exports);
  addVarConstExports(root, exports);
  return exports;
}

/** Build an Export entry for a node with an exported name. */
function makeExport(name: string, node: SyntaxNode, isType = false): Export {
  return {
    name, isDefault: false, isReExport: false,
    isTypeOnly: isType, line: node.startPosition.row, column: node.startPosition.column,
  };
}

/** Add exported function and method declarations. */
function addFuncExports(root: SyntaxNode, exports: Export[]): void {
  const nodeTypes = ['function_declaration', 'method_declaration'];
  for (const nodeType of nodeTypes) {
    for (const node of collectNodes(root, nodeType)) {
      const name = node.childForFieldName('name')?.text ?? '';
      if (isExported(name)) exports.push(makeExport(name, node));
    }
  }
}

/** Add exported type declarations (struct, interface, etc.). */
function addTypeExports(root: SyntaxNode, exports: Export[]): void {
  const typeDecls = collectNodes(root, 'type_declaration');
  for (const decl of typeDecls) {
    const specs = collectNodes(decl, 'type_spec');
    for (const spec of specs) {
      const name = spec.childForFieldName('name')?.text ?? '';
      if (isExported(name)) exports.push(makeExport(name, spec, true));
    }
  }
}

/** Add exported var and const declarations. */
function addVarConstExports(root: SyntaxNode, exports: Export[]): void {
  for (const declType of ['var_declaration', 'const_declaration']) {
    for (const decl of collectNodes(root, declType)) {
      const specs = collectNodes(decl, 'var_spec').concat(collectNodes(decl, 'const_spec'));
      for (const spec of specs) {
        const name = spec.childForFieldName('name')?.text ?? '';
        if (isExported(name)) exports.push(makeExport(name, spec));
      }
    }
  }
}

/** Extract function and method definitions. */
function extractFuncDefs(root: SyntaxNode): Definition[] {
  const defs: Definition[] = [];
  for (const node of collectNodes(root, 'function_declaration')) {
    const name = node.childForFieldName('name')?.text ?? '<anonymous>';
    defs.push({
      name,
      kind: 'function',
      exported: isExported(name),
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
  for (const node of collectNodes(root, 'method_declaration')) {
    const name = node.childForFieldName('name')?.text ?? '<anonymous>';
    defs.push({
      name,
      kind: 'method',
      exported: isExported(name),
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
  return defs;
}

/** Extract type definitions (struct, interface, etc.). */
function extractTypeDefs(root: SyntaxNode): Definition[] {
  const defs: Definition[] = [];
  const typeDecls = collectNodes(root, 'type_declaration');
  for (const decl of typeDecls) {
    for (const spec of collectNodes(decl, 'type_spec')) {
      const name = spec.childForFieldName('name')?.text ?? '<anonymous>';
      const typeNode = spec.childForFieldName('type');
      const kind = typeNode?.type === 'interface_type' ? 'interface' as const
        : typeNode?.type === 'struct_type' ? 'struct' as const
        : 'type' as const;
      defs.push({
        name,
        kind,
        exported: isExported(name),
        line: spec.startPosition.row,
        column: spec.startPosition.column,
      });
    }
  }
  return defs;
}

/** Extract var and const definitions. */
function extractVarConstDefs(root: SyntaxNode): Definition[] {
  const defs: Definition[] = [];
  const pairs: Array<[string, string, 'variable' | 'constant']> = [
    ['var_declaration', 'var_spec', 'variable'],
    ['const_declaration', 'const_spec', 'constant'],
  ];
  for (const [declType, specType, kind] of pairs) {
    for (const decl of collectNodes(root, declType)) {
      for (const spec of collectNodes(decl, specType)) {
        const name = spec.childForFieldName('name')?.text ?? '<anonymous>';
        defs.push({
          name,
          kind,
          exported: isExported(name),
          line: spec.startPosition.row,
          column: spec.startPosition.column,
        });
      }
    }
  }
  return defs;
}

/** Extract function and method calls. */
function extractGoCalls(root: SyntaxNode): Call[] {
  const calls: Call[] = [];
  const callNodes = collectNodes(root, 'call_expression');
  for (const node of callNodes) {
    const func = node.childForFieldName('function');
    if (!func) continue;
    if (func.type === 'selector_expression') {
      calls.push({
        callee: func.childForFieldName('field')?.text ?? func.text,
        receiver: func.childForFieldName('operand')?.text,
        isConstructor: false,
        line: node.startPosition.row,
        column: node.startPosition.column,
      });
    } else {
      calls.push({
        callee: func.text,
        receiver: undefined,
        isConstructor: false,
        line: node.startPosition.row,
        column: node.startPosition.column,
      });
    }
  }
  return calls;
}

/** Go language parser implementation. */
export const goParser: ILanguageParser = {
  extensions: ['.go'],

  /** Extract import declarations from a Go AST. */
  extractImports(tree: Tree, _filePath: string): Import[] {
    return extractSingleImports(tree.rootNode);
  },

  /** Extract exported identifiers (capitalized names). */
  extractExports(tree: Tree, _filePath: string): Export[] {
    return extractGoExports(tree.rootNode);
  },

  /** Extract function, type, var, and const definitions. */
  extractDefinitions(tree: Tree, _filePath: string): Definition[] {
    const root = tree.rootNode;
    return [
      ...extractFuncDefs(root),
      ...extractTypeDefs(root),
      ...extractVarConstDefs(root),
    ];
  },

  /** Extract function and method calls. */
  extractCalls(tree: Tree, _filePath: string): Call[] {
    return extractGoCalls(tree.rootNode);
  },
};
