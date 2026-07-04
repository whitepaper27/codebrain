/**
 * Base types and interface for all CodeBrain language parsers.
 * Every parser implements ILanguageParser to extract structural information.
 */

import type { Tree } from 'web-tree-sitter';

/** A resolved or unresolved import statement. */
export interface Import {
  /** The module/file being imported (raw string from source). */
  source: string;
  /** Specific symbols imported. Empty for namespace/default imports. */
  specifiers: string[];
  /** Whether this is a default import. */
  isDefault: boolean;
  /** Whether this is a namespace import (import * as x). */
  isNamespace: boolean;
  /** Whether this is a type-only import (TypeScript). */
  isTypeOnly: boolean;
  /** Line number (0-based). */
  line: number;
  /** Column number (0-based). */
  column: number;
}

/** An exported symbol. */
export interface Export {
  /** Name of the exported symbol. */
  name: string;
  /** Whether this is a default export. */
  isDefault: boolean;
  /** Whether this is a re-export from another module. */
  isReExport: boolean;
  /** Source module for re-exports. */
  reExportSource?: string;
  /** Whether this is a type-only export (TypeScript). */
  isTypeOnly: boolean;
  /** Line number (0-based). */
  line: number;
  /** Column number (0-based). */
  column: number;
}

/** The kind of definition (function, class, interface, etc.). */
export type DefinitionKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'variable'
  | 'struct'
  | 'union'
  | 'macro'
  | 'method'
  | 'module';

/** A symbol definition within a file. */
export interface Definition {
  /** Name of the defined symbol. */
  name: string;
  /** Kind of definition. */
  kind: DefinitionKind;
  /** Whether this definition is exported / public. */
  exported: boolean;
  /** Line number (0-based). */
  line: number;
  /** Column number (0-based). */
  column: number;
}

/** A function or method call site. */
export interface Call {
  /** Name of the called function/method. */
  callee: string;
  /** For method calls, the object/receiver. */
  receiver?: string;
  /** Whether this is a constructor call (new X). */
  isConstructor: boolean;
  /** Line number (0-based). */
  line: number;
  /** Column number (0-based). */
  column: number;
}

/**
 * Interface that every language parser must implement.
 * Parsers extract structural information from tree-sitter ASTs.
 */
export interface ILanguageParser {
  /** File extensions this parser handles (e.g., ['.ts', '.tsx']). */
  extensions: string[];

  /** Extract import statements from the AST. */
  extractImports(tree: Tree, filePath: string): Import[];

  /** Extract export declarations from the AST. */
  extractExports(tree: Tree, filePath: string): Export[];

  /** Extract symbol definitions from the AST. */
  extractDefinitions(tree: Tree, filePath: string): Definition[];

  /** Extract function/method call sites from the AST. */
  extractCalls(tree: Tree, filePath: string): Call[];
}

/** Result of parsing a single file. */
export interface ParseResult {
  filePath: string;
  language: string;
  imports: Import[];
  exports: Export[];
  definitions: Definition[];
  calls: Call[];
  /** Whether tree-sitter reported parse errors. */
  hasErrors: boolean;
}

/** A node in the dependency graph. */
export interface GraphNode {
  /** File path relative to repo root. */
  filePath: string;
  /** Detected language. */
  language: string;
  /** Number of other files that import this file. */
  inDegree: number;
  /** Number of files this file imports. */
  outDegree: number;
  /** Definitions in this file. */
  definitions: Definition[];
}

/** An edge in the dependency graph. */
export interface GraphEdge {
  /** File that contains the import/call. */
  source: string;
  /** File being imported/called. */
  target: string;
  /** Type of dependency. */
  type: 'import' | 'call';
  /** Specific symbols involved (if known). */
  symbols: string[];
}

/** The full topology graph produced by Phase 1. */
export interface TopologyGraph {
  /** All files as graph nodes. */
  nodes: GraphNode[];
  /** All dependency edges. */
  edges: GraphEdge[];
  /** Metadata about the scan. */
  metadata: {
    scannedAt: string;
    fileCount: number;
    edgeCount: number;
    languages: Record<string, number>;
  };
}
