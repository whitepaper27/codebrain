/**
 * Python language parser for CodeBrain.
 * Extracts imports, exports, definitions, and calls from Python ASTs.
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

/** Extract the text of a named child, or undefined. */
function childText(node: SyntaxNode, fieldName: string): string | undefined {
  return node.childForFieldName(fieldName)?.text;
}

/** Extract imports from `import x` and `from x import y` statements. */
function extractImportsFromTree(root: SyntaxNode): Import[] {
  const imports: Import[] = [];
  const importNodes = collectNodes(root, 'import_statement');
  for (const node of importNodes) {
    const nameNode = node.namedChildren.find(
      (c: SyntaxNode) => c.type === 'dotted_name' || c.type === 'aliased_import',
    );
    const source =
      nameNode?.type === 'aliased_import'
        ? (nameNode.childForFieldName('name')?.text ?? nameNode.text)
        : (nameNode?.text ?? '');
    imports.push({
      source,
      specifiers: [],
      isDefault: true,
      isNamespace: false,
      isTypeOnly: false,
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
  return imports;
}

/** Extract imports from `from x import y` statements. */
function extractFromImports(root: SyntaxNode): Import[] {
  const imports: Import[] = [];
  const fromNodes = collectNodes(root, 'import_from_statement');
  for (const node of fromNodes) {
    const moduleName = childText(node, 'module_name') ?? '';
    const specifiers = node.namedChildren
      .filter((c: SyntaxNode) => c.type === 'dotted_name' || c.type === 'aliased_import')
      .map((c: SyntaxNode) =>
        c.type === 'aliased_import'
          ? (c.childForFieldName('name')?.text ?? c.text)
          : c.text,
      )
      .filter((s: string) => s !== moduleName);
    const isWildcard = node.children.some((c) => c.type === 'wildcard_import');
    imports.push({
      source: moduleName,
      specifiers: isWildcard ? ['*'] : specifiers,
      isDefault: false,
      isNamespace: isWildcard,
      isTypeOnly: false,
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
  return imports;
}

/** Extract module-level definitions as exports (Python has no explicit exports). */
function extractExportsFromDefs(root: SyntaxNode): Export[] {
  const exports: Export[] = [];
  for (const child of root.namedChildren) {
    const name = getDefinitionName(child);
    if (name) {
      exports.push({
        name,
        isDefault: false,
        isReExport: false,
        isTypeOnly: false,
        line: child.startPosition.row,
        column: child.startPosition.column,
      });
    }
  }
  return exports;
}

/** Get the name of a definition node, or undefined if not a definition. */
function getDefinitionName(node: SyntaxNode): string | undefined {
  if (
    node.type === 'function_definition' ||
    node.type === 'class_definition'
  ) {
    return childText(node, 'name');
  }
  if (node.type === 'expression_statement') {
    const expr = node.namedChildren[0];
    if (expr?.type === 'assignment') {
      const left = expr.childForFieldName('left');
      if (left?.type === 'identifier') return left.text;
    }
  }
  return undefined;
}

/** Extract definitions: functions, classes, module-level assignments. */
function extractDefs(root: SyntaxNode): Definition[] {
  const defs: Definition[] = [];
  addFunctionDefs(root, defs);
  addClassDefs(root, defs);
  addAssignmentDefs(root, defs);
  return defs;
}

/** Add function definitions to the list. */
function addFunctionDefs(root: SyntaxNode, defs: Definition[]): void {
  const funcs = collectNodes(root, 'function_definition');
  for (const node of funcs) {
    const name = childText(node, 'name') ?? '<anonymous>';
    const isTopLevel = node.parent?.type === 'module';
    const isMethod = node.parent?.type === 'block' &&
      node.parent.parent?.type === 'class_definition';
    defs.push({
      name,
      kind: isMethod ? 'method' : 'function',
      exported: isTopLevel,
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
}

/** Add class definitions to the list. */
function addClassDefs(root: SyntaxNode, defs: Definition[]): void {
  const classes = collectNodes(root, 'class_definition');
  for (const node of classes) {
    const name = childText(node, 'name') ?? '<anonymous>';
    defs.push({
      name,
      kind: 'class',
      exported: node.parent?.type === 'module',
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
}

/** Add module-level assignment definitions. */
function addAssignmentDefs(root: SyntaxNode, defs: Definition[]): void {
  for (const child of root.namedChildren) {
    if (child.type !== 'expression_statement') continue;
    const expr = child.namedChildren[0];
    if (expr?.type !== 'assignment') continue;
    const left = expr.childForFieldName('left');
    if (left?.type === 'identifier') {
      defs.push({
        name: left.text,
        kind: 'variable',
        exported: true,
        line: child.startPosition.row,
        column: child.startPosition.column,
      });
    }
  }
}

/** Extract function calls, method calls, and decorator calls. */
function extractCallSites(root: SyntaxNode): Call[] {
  const calls: Call[] = [];
  addCallExpressions(root, calls);
  addDecoratorCalls(root, calls);
  return calls;
}

/** Add call expressions to the list. */
function addCallExpressions(root: SyntaxNode, calls: Call[]): void {
  const callNodes = collectNodes(root, 'call');
  for (const node of callNodes) {
    const func = node.childForFieldName('function');
    if (!func) continue;
    if (func.type === 'attribute') {
      calls.push({
        callee: func.childForFieldName('attribute')?.text ?? func.text,
        receiver: func.childForFieldName('object')?.text,
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
}

/** Add decorator calls (e.g. @decorator). */
function addDecoratorCalls(root: SyntaxNode, calls: Call[]): void {
  const decorators = collectNodes(root, 'decorator');
  for (const node of decorators) {
    const expr = node.namedChildren[0];
    if (!expr) continue;
    const callee =
      expr.type === 'call'
        ? (expr.childForFieldName('function')?.text ?? expr.text)
        : expr.text;
    calls.push({
      callee,
      receiver: undefined,
      isConstructor: false,
      line: node.startPosition.row,
      column: node.startPosition.column,
    });
  }
}

/** Python language parser implementation. */
export const pythonParser: ILanguageParser = {
  extensions: ['.py'],

  /** Extract all import statements from a Python AST. */
  extractImports(tree: Tree, _filePath: string): Import[] {
    const root = tree.rootNode;
    return [...extractImportsFromTree(root), ...extractFromImports(root)];
  },

  /** Extract exports (all module-level definitions in Python). */
  extractExports(tree: Tree, _filePath: string): Export[] {
    return extractExportsFromDefs(tree.rootNode);
  },

  /** Extract definitions: functions, classes, and module-level assignments. */
  extractDefinitions(tree: Tree, _filePath: string): Definition[] {
    return extractDefs(tree.rootNode);
  },

  /** Extract function calls, method calls, and decorator calls. */
  extractCalls(tree: Tree, _filePath: string): Call[] {
    return extractCallSites(tree.rootNode);
  },
};
