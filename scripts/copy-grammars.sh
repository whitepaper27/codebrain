#!/bin/bash
# Copy pre-built WASM grammars from npm packages to grammars/
set -e
mkdir -p grammars
cp node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm grammars/
cp node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm grammars/
cp node_modules/tree-sitter-python/tree-sitter-python.wasm grammars/
cp node_modules/tree-sitter-c/tree-sitter-c.wasm grammars/
cp node_modules/tree-sitter-java/tree-sitter-java.wasm grammars/
cp node_modules/tree-sitter-go/tree-sitter-go.wasm grammars/
echo "Copied all WASM grammars to grammars/"
