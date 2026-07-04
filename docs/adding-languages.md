# Adding Language Support

CodeBrain uses [tree-sitter](https://tree-sitter.github.io/tree-sitter/) for AST parsing. Each supported language has a parser that implements the `ILanguageParser` interface. This document explains how to add support for a new language.

## Overview

1. Install the tree-sitter grammar for the language
2. Create a parser file in `src/parsers/`
3. Implement the `ILanguageParser` interface
4. Register the parser in `src/parsers/index.ts`
5. Write tests with a fixture repository
6. Submit a PR

## Step 1: Install the Grammar

Tree-sitter grammars are npm packages. Find yours at [tree-sitter's GitHub](https://github.com/tree-sitter) or search npm for `tree-sitter-<language>`.

```bash
npm install tree-sitter-rust
```

## Step 2: Create the Parser File

Create `src/parsers/rust.ts` (or the appropriate language name).

## Step 3: Implement ILanguageParser

Every parser must implement this interface:

```typescript
interface ILanguageParser {
  /** File extensions this parser handles */
  extensions: string[];

  /** Extract import statements from the AST */
  extractImports(tree: Tree, filePath: string): Import[];

  /** Extract export/public declarations from the AST */
  extractExports(tree: Tree, filePath: string): Export[];

  /** Extract function, class, and type definitions */
  extractDefinitions(tree: Tree, filePath: string): Definition[];

  /** Extract function calls and method invocations */
  extractCalls(tree: Tree, filePath: string): Call[];
}
```

### Data Types

```typescript
interface Import {
  /** The module or file being imported */
  source: string;
  /** Specific symbols imported (empty for wildcard imports) */
  symbols: string[];
  /** Line number in the source file */
  line: number;
}

interface Export {
  /** Name of the exported symbol */
  name: string;
  /** Kind: "function", "class", "interface", "type", "variable", "const" */
  kind: string;
  /** Line number in the source file */
  line: number;
}

interface Definition {
  /** Name of the defined symbol */
  name: string;
  /** Kind: "function", "class", "interface", "type", "method" */
  kind: string;
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
}

interface Call {
  /** Name of the called function or method */
  name: string;
  /** Line number of the call */
  line: number;
}
```

### Example: Rust Parser

```typescript
import Parser from "tree-sitter";
import Rust from "tree-sitter-rust";
import { ILanguageParser, Import, Export, Definition, Call } from "./base";

export class RustParser implements ILanguageParser {
  extensions = [".rs"];

  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Rust);
  }

  extractImports(tree: Parser.Tree, filePath: string): Import[] {
    const imports: Import[] = [];
    // Query for `use` statements
    // use std::collections::HashMap;
    // use crate::models::User;
    const query = new Parser.Query(
      Rust,
      "(use_declaration (scoped_identifier) @path)"
    );
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      for (const capture of match.captures) {
        imports.push({
          source: capture.node.text,
          symbols: [],
          line: capture.node.startPosition.row + 1,
        });
      }
    }
    return imports;
  }

  extractExports(tree: Parser.Tree, filePath: string): Export[] {
    const exports: Export[] = [];
    // Query for `pub` items
    const query = new Parser.Query(
      Rust,
      "(function_item (visibility_modifier) @vis name: (identifier) @name)"
    );
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      const vis = match.captures.find((c) => c.name === "vis");
      const name = match.captures.find((c) => c.name === "name");
      if (vis && name && vis.node.text === "pub") {
        exports.push({
          name: name.node.text,
          kind: "function",
          line: name.node.startPosition.row + 1,
        });
      }
    }
    return exports;
  }

  extractDefinitions(tree: Parser.Tree, filePath: string): Definition[] {
    const definitions: Definition[] = [];
    // Query for function definitions, struct definitions, impl blocks, etc.
    const query = new Parser.Query(
      Rust,
      `[
        (function_item name: (identifier) @name) @def
        (struct_item name: (type_identifier) @name) @def
        (enum_item name: (type_identifier) @name) @def
        (trait_item name: (type_identifier) @name) @def
      ]`
    );
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      const name = match.captures.find((c) => c.name === "name");
      const def = match.captures.find((c) => c.name === "def");
      if (name && def) {
        definitions.push({
          name: name.node.text,
          kind: def.node.type.replace("_item", ""),
          startLine: def.node.startPosition.row + 1,
          endLine: def.node.endPosition.row + 1,
        });
      }
    }
    return definitions;
  }

  extractCalls(tree: Parser.Tree, filePath: string): Call[] {
    const calls: Call[] = [];
    const query = new Parser.Query(
      Rust,
      "(call_expression function: (identifier) @name)"
    );
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      for (const capture of match.captures) {
        calls.push({
          name: capture.node.text,
          line: capture.node.startPosition.row + 1,
        });
      }
    }
    return calls;
  }
}
```

Note: This is a simplified example. A production parser should handle more node types (method calls, macro invocations, associated function calls, etc.) and edge cases.

## Step 4: Register the Parser

Add the parser to `src/parsers/index.ts`:

```typescript
import { RustParser } from "./rust";

// In the registry:
const parsers: Map<string, ILanguageParser> = new Map();

const rustParser = new RustParser();
for (const ext of rustParser.extensions) {
  parsers.set(ext, rustParser);
}
```

## Step 5: Write Tests

Create a fixture repository under `tests/fixtures/` with known dependency patterns in the new language. Write tests that verify:

1. **Import extraction** -- all import statements are found with correct source paths.
2. **Export extraction** -- all public/exported symbols are identified.
3. **Definition extraction** -- all functions, classes, types, and interfaces are found with correct line ranges.
4. **Call extraction** -- function calls are identified.
5. **Graph integration** -- the dependency graph includes edges from the new language to other files (including cross-language dependencies if applicable).

Example test structure:

```
tests/
  fixtures/
    rust-project/
      src/
        main.rs
        models/
          user.rs
          order.rs
        services/
          user_service.rs
  parsers/
    rust.test.ts
```

## Step 6: Submit a PR

- Follow conventional commit format: `feat: add Rust language support`
- Include the fixture repository in your PR
- Ensure all existing tests still pass
- Document any language-specific edge cases in the parser file

## Language-Specific Considerations

Different languages have different import and module systems. Some things to handle:

- **Relative vs absolute imports** (Python: `from . import foo` vs `import foo`)
- **Re-exports** (TypeScript: `export { foo } from './bar'`)
- **Wildcard imports** (Java: `import java.util.*`)
- **Conditional imports** (Python: `try: import foo except: import bar`)
- **Module systems** (Go packages, Rust crates, C `#include`)
- **Header files** (C/C++: `.h` files define interfaces, `.c` files implement)

The parser does not need to resolve every edge case perfectly. The authority scoring is robust to minor extraction errors because it aggregates across many signals. Focus on getting the common patterns right first.

## Currently Supported Languages

| Language   | Parser File       | Extensions         |
| ---------- | ----------------- | ------------------ |
| TypeScript | `typescript.ts`   | `.ts`, `.tsx`      |
| JavaScript | `typescript.ts`   | `.js`, `.jsx`      |
| Python     | `python.ts`       | `.py`              |
| C          | `c.ts`            | `.c`, `.h`         |
| Java       | `java.ts`         | `.java`            |
| Go         | `go.ts`           | `.go`              |
