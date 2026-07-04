/**
 * Java language parser for CodeBrain.
 * Extracts imports, exports, definitions, and calls from Java ASTs.
 */

import type { Tree, Node as SyntaxNode } from 'web-tree-sitter';
import type {
  ILanguageParser,
  Import,
  Export,
  Definition,
  Call,
  DefinitionKind,
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

/** Check if a declaration node has a specific modifier. */
function hasModifier(node: SyntaxNode, modifier: string): boolean {
  return node.namedChildren.some(
    (c: SyntaxNode) => c.type === 'modifiers' &&
      c.children.some((m: SyntaxNode) => m.text === modifier),
  );
}

/** Extract import declarations. */
function extractJavaImports(root: SyntaxNode): Import[] {
  const importNodes = collectNodes(root, 'import_declaration');
  return importNodes.map((node) => {
    const text = node.text;
    const isStaticImport = text.includes('import static');
    const isWildcard = text.includes('.*');
    const source = text
      .replace(/^import\s+(static\s+)?/, '')
      .replace(/;\s*$/, '')
      .trim();
    return {
      source,
      specifiers: isWildcard ? ['*'] : extractLastSegment(source),
      isDefault: false,
      isNamespace: isWildcard,
      isTypeOnly: !isStaticImport,
      line: node.startPosition.row,
      column: node.startPosition.column,
    };
  });
}

/** Extract the last segment of a dotted name as a specifier list. */
function extractLastSegment(source: string): string[] {
  const parts = source.split('.');
  const last = parts[parts.length - 1];
  return last && last !== '*' ? [last] : [];
}

/** Extract public class/interface/enum declarations as exports. */
function extractJavaExports(root: SyntaxNode): Export[] {
  const exports: Export[] = [];
  const typeDecls: Array<[string, string]> = [
    ['class_declaration', 'name'],
    ['interface_declaration', 'name'],
    ['enum_declaration', 'name'],
  ];
  for (const [nodeType, field] of typeDecls) {
    for (const node of collectNodes(root, nodeType)) {
      if (!hasModifier(node, 'public')) continue;
      const name = node.childForFieldName(field)?.text;
      if (name) {
        exports.push({
          name,
          isDefault: false,
          isReExport: false,
          isTypeOnly: false,
          line: node.startPosition.row,
          column: node.startPosition.column,
        });
      }
    }
  }
  return exports;
}

/** Map tree-sitter node types to definition kinds. */
function nodeTypeToKind(nodeType: string): DefinitionKind {
  const map: Record<string, DefinitionKind> = {
    class_declaration: 'class',
    interface_declaration: 'interface',
    enum_declaration: 'enum',
    method_declaration: 'method',
    constructor_declaration: 'method',
  };
  return map[nodeType] ?? 'variable';
}

/** Extract class, interface, and enum definitions. */
function extractTypeDefinitions(root: SyntaxNode): Definition[] {
  const defs: Definition[] = [];
  const types = ['class_declaration', 'interface_declaration', 'enum_declaration'];
  for (const nodeType of types) {
    for (const node of collectNodes(root, nodeType)) {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        defs.push({
          name,
          kind: nodeTypeToKind(nodeType),
          exported: hasModifier(node, 'public'),
          line: node.startPosition.row,
          column: node.startPosition.column,
        });
      }
    }
  }
  return defs;
}

/** Extract method definitions (including constructors). */
function extractMethodDefinitions(root: SyntaxNode): Definition[] {
  const defs: Definition[] = [];
  const methodTypes = ['method_declaration', 'constructor_declaration'];
  for (const nodeType of methodTypes) {
    for (const node of collectNodes(root, nodeType)) {
      const name = node.childForFieldName('name')?.text
        ?? node.childForFieldName('type')?.text
        ?? '<anonymous>';
      defs.push({
        name,
        kind: 'method',
        exported: hasModifier(node, 'public'),
        line: node.startPosition.row,
        column: node.startPosition.column,
      });
    }
  }
  return defs;
}

/** Extract method invocation calls. */
function extractMethodCalls(root: SyntaxNode): Call[] {
  const calls: Call[] = [];
  const invocations = collectNodes(root, 'method_invocation');
  for (const node of invocations) {
    const name = node.childForFieldName('name')?.text ?? '<unknown>';
    const obj = node.childForFieldName('object')?.text;
    calls.push({
      callee: name,
      receiver: obj,
      isConstructor: false,
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
  return calls;
}

/** Extract constructor calls (new Class()). */
function extractConstructorCalls(root: SyntaxNode): Call[] {
  const calls: Call[] = [];
  const newExprs = collectNodes(root, 'object_creation_expression');
  for (const node of newExprs) {
    const typeNode = node.childForFieldName('type');
    const name = typeNode?.text ?? '<unknown>';
    calls.push({
      callee: name,
      receiver: undefined,
      isConstructor: true,
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
  return calls;
}

/** Java language parser implementation. */
export const javaParser: ILanguageParser = {
  extensions: ['.java'],

  /** Extract import declarations from a Java AST. */
  extractImports(tree: Tree, _filePath: string): Import[] {
    return extractJavaImports(tree.rootNode);
  },

  /** Extract public type declarations as exports. */
  extractExports(tree: Tree, _filePath: string): Export[] {
    return extractJavaExports(tree.rootNode);
  },

  /** Extract all type and method definitions. */
  extractDefinitions(tree: Tree, _filePath: string): Definition[] {
    const root = tree.rootNode;
    return [
      ...extractTypeDefinitions(root),
      ...extractMethodDefinitions(root),
    ];
  },

  /** Extract method invocations and constructor calls. */
  extractCalls(tree: Tree, _filePath: string): Call[] {
    const root = tree.rootNode;
    return [
      ...extractMethodCalls(root),
      ...extractConstructorCalls(root),
    ];
  },
};
