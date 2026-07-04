/**
 * C language parser for CodeBrain.
 * Extracts imports, exports, definitions, and calls from C/H ASTs.
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

/** Check if a file path is a header file. */
function isHeaderFile(filePath: string): boolean {
  return filePath.endsWith('.h');
}

/** Extract #include directives. */
function extractIncludes(root: SyntaxNode): Import[] {
  const includes = collectNodes(root, 'preproc_include');
  return includes.map((node) => {
    const pathNode = node.namedChildren.find(
      (c: SyntaxNode) => c.type === 'string_literal' || c.type === 'system_lib_string',
    );
    const raw = pathNode?.text ?? '';
    const isSystem = pathNode?.type === 'system_lib_string';
    const source = raw.replace(/^["<]|[">]$/g, '');
    return {
      source,
      specifiers: [],
      isDefault: false,
      isNamespace: isSystem,
      isTypeOnly: false,
      line: node.startPosition.row,
      column: node.startPosition.column,
    };
  });
}

/** Check if a function definition has the 'static' storage class. */
function isStatic(node: SyntaxNode): boolean {
  return node.children.some(
    (c: SyntaxNode) => c.type === 'storage_class_specifier' && c.text === 'static',
  );
}

/** Extract exports from header files (declarations) and C files (non-static functions). */
function extractCExports(root: SyntaxNode, filePath: string): Export[] {
  if (isHeaderFile(filePath)) {
    return extractHeaderExports(root);
  }
  return extractSourceExports(root);
}

/** Extract exports from .h files: function declarations and extern declarations. */
function extractHeaderExports(root: SyntaxNode): Export[] {
  const exports: Export[] = [];
  const declarations = collectNodes(root, 'declaration');
  for (const decl of declarations) {
    const declarator = decl.namedChildren.find(
      (c: SyntaxNode) => c.type === 'function_declarator' || c.type === 'init_declarator',
    );
    const name = extractDeclaratorName(declarator);
    if (name) {
      exports.push({
        name,
        isDefault: false,
        isReExport: false,
        isTypeOnly: false,
        line: decl.startPosition.row,
        column: decl.startPosition.column,
      });
    }
  }
  return exports;
}

/** Extract the name from a declarator node. */
function extractDeclaratorName(node: SyntaxNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'function_declarator') {
    return node.childForFieldName('declarator')?.text;
  }
  if (node.type === 'init_declarator') {
    return node.childForFieldName('declarator')?.text;
  }
  return node.childForFieldName('name')?.text;
}

/** Extract exports from .c files: non-static function definitions. */
function extractSourceExports(root: SyntaxNode): Export[] {
  const funcs = collectNodes(root, 'function_definition');
  const exports: Export[] = [];
  for (const func of funcs) {
    if (isStatic(func)) continue;
    const declarator = func.childForFieldName('declarator');
    const name = declarator?.childForFieldName('declarator')?.text
      ?? declarator?.text;
    if (name) {
      exports.push({
        name,
        isDefault: false,
        isReExport: false,
        isTypeOnly: false,
        line: func.startPosition.row,
        column: func.startPosition.column,
      });
    }
  }
  return exports;
}

/** Extract function definitions. */
function extractFunctionDefs(root: SyntaxNode): Definition[] {
  const funcs = collectNodes(root, 'function_definition');
  return funcs.map((node) => {
    const declarator = node.childForFieldName('declarator');
    const name = declarator?.childForFieldName('declarator')?.text
      ?? declarator?.text ?? '<anonymous>';
    return {
      name,
      kind: 'function' as const,
      exported: !isStatic(node),
      line: node.startPosition.row,
      column: node.startPosition.column,
    };
  });
}

/** Extract struct, union, and enum definitions. */
function extractCompositeDefs(root: SyntaxNode): Definition[] {
  const defs: Definition[] = [];
  const types: Array<[string, 'struct' | 'union' | 'enum']> = [
    ['struct_specifier', 'struct'],
    ['union_specifier', 'union'],
    ['enum_specifier', 'enum'],
  ];
  for (const [nodeType, kind] of types) {
    for (const node of collectNodes(root, nodeType)) {
      const name = node.childForFieldName('name')?.text;
      if (!name) continue;
      defs.push({
        name,
        kind,
        exported: true,
        line: node.startPosition.row,
        column: node.startPosition.column,
      });
    }
  }
  return defs;
}

/** Extract typedef declarations. */
function extractTypedefDefs(root: SyntaxNode): Definition[] {
  const defs: Definition[] = [];
  const typedefs = collectNodes(root, 'type_definition');
  for (const node of typedefs) {
    const declarator = node.childForFieldName('declarator');
    const name = declarator?.type === 'type_identifier'
      ? declarator.text
      : (declarator?.text ?? undefined);
    if (name) {
      defs.push({
        name,
        kind: 'type',
        exported: true,
        line: node.startPosition.row,
        column: node.startPosition.column,
      });
    }
  }
  return defs;
}

/** Extract #define macros. */
function extractMacroDefs(root: SyntaxNode): Definition[] {
  const macros = collectNodes(root, 'preproc_def');
  return macros.map((node) => ({
    name: node.childForFieldName('name')?.text ?? '<macro>',
    kind: 'macro' as const,
    exported: true,
    line: node.startPosition.row,
    column: node.startPosition.column,
  }));
}

/** Extract function call expressions. */
function extractCallExpressions(root: SyntaxNode): Call[] {
  const callNodes = collectNodes(root, 'call_expression');
  return callNodes.map((node) => {
    const func = node.childForFieldName('function');
    const callee = func?.text ?? '<unknown>';
    return {
      callee,
      receiver: undefined,
      isConstructor: false,
      line: node.startPosition.row,
      column: node.startPosition.column,
    };
  });
}

/** C language parser implementation. */
export const cParser: ILanguageParser = {
  extensions: ['.c', '.h'],

  /** Extract #include directives from a C AST. */
  extractImports(tree: Tree, _filePath: string): Import[] {
    return extractIncludes(tree.rootNode);
  },

  /** Extract exports based on file type (.h vs .c). */
  extractExports(tree: Tree, filePath: string): Export[] {
    return extractCExports(tree.rootNode, filePath);
  },

  /** Extract all definitions: functions, structs, unions, enums, typedefs, macros. */
  extractDefinitions(tree: Tree, _filePath: string): Definition[] {
    const root = tree.rootNode;
    return [
      ...extractFunctionDefs(root),
      ...extractCompositeDefs(root),
      ...extractTypedefDefs(root),
      ...extractMacroDefs(root),
    ];
  },

  /** Extract function call expressions. */
  extractCalls(tree: Tree, _filePath: string): Call[] {
    return extractCallExpressions(tree.rootNode);
  },
};
