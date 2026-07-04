#!/usr/bin/env node

/**
 * CodeBrain MCP server entry point.
 * Exposes 5 tools over stdio transport for AI coding agents.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { loadData } from './tools/data-loader.js';
import { searchWithHierarchy } from './tools/search.js';
import { explainModuleAuthority } from './tools/explain.js';
import { diffBlastRadius } from './tools/blast-radius.js';
import { guardChange } from './tools/guard.js';
import { findContracts } from './tools/contracts.js';
import { logger, setLogLevel } from './utils/logger.js';

/** Resolve the repo root from args or default to cwd. */
function resolveRepoRoot(): string {
  const repoArg = process.argv.find((a) => a.startsWith('--repo='));
  if (repoArg) {
    return resolve(repoArg.split('=')[1]!);
  }

  const repoIdx = process.argv.indexOf('--repo');
  if (repoIdx >= 0 && process.argv[repoIdx + 1]) {
    return resolve(process.argv[repoIdx + 1]!);
  }

  return resolve('.');
}

/** Create and configure the MCP server with all 5 tools. */
function createServer(): McpServer {
  const server = new McpServer({
    name: 'codebrain',
    version: '0.1.0',
  });

  const repoRoot = resolveRepoRoot();

  registerSearchTool(server, repoRoot);
  registerExplainTool(server, repoRoot);
  registerBlastRadiusTool(server, repoRoot);
  registerGuardTool(server, repoRoot);
  registerContractsTool(server);

  return server;
}

/** Register search_with_hierarchy tool. */
function registerSearchTool(
  server: McpServer, repoRoot: string,
): void {
  server.tool(
    'search_with_hierarchy',
    'Find code ranked by authority, not just similarity. Returns files matching the query sorted by structural authority score.',
    {
      query: z.string().describe('Search query (file names, function names, concepts)'),
      top_k: z.number().optional().default(10).describe('Maximum results to return'),
    },
    async (args) => {
      const data = loadData(repoRoot);
      const result = searchWithHierarchy(data, args.query, args.top_k);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}

/** Register explain_module_authority tool. */
function registerExplainTool(
  server: McpServer, repoRoot: string,
): void {
  server.tool(
    'explain_module_authority',
    'Explain why a file has its authority score. Returns signal breakdown, metrics, and dependency lists.',
    {
      file: z.string().describe('File path relative to repo root'),
    },
    async (args) => {
      const data = loadData(repoRoot);
      const result = explainModuleAuthority(data, args.file);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}

/** Register diff_blast_radius tool. */
function registerBlastRadiusTool(
  server: McpServer, repoRoot: string,
): void {
  server.tool(
    'diff_blast_radius',
    'Show downstream impact of a proposed change. Returns affected files with authority scores.',
    {
      file: z.string().optional().describe('Single file to analyze'),
      files: z.array(z.string()).optional().describe('Multiple files to analyze'),
    },
    async (args) => {
      const data = loadData(repoRoot);
      const fileList = args.files ?? (args.file ? [args.file] : []);
      if (fileList.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Provide "file" or "files" parameter' }),
          }],
        };
      }
      const result = diffBlastRadius(data, fileList);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}

/** Register guard_change tool. */
function registerGuardTool(
  server: McpServer, repoRoot: string,
): void {
  server.tool(
    'guard_change',
    'Warn or block when agent touches high-authority code. Returns verdict: SAFE, CAUTION, or REQUIRES_HUMAN_APPROVAL.',
    {
      file: z.string().describe('File path relative to repo root'),
      change_type: z.enum(['modify', 'delete', 'rename']).describe('Type of proposed change'),
    },
    async (args) => {
      const data = loadData(repoRoot);
      const result = guardChange(data, args.file, args.change_type);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}

/** Register find_contracts stub tool. */
function registerContractsTool(server: McpServer): void {
  server.tool(
    'find_contracts',
    'Surface implicit assumptions between modules (Phase 3 — not yet implemented).',
    {},
    async () => {
      const result = findContracts();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}

/** Start the MCP server with stdio transport. */
async function main(): Promise<void> {
  // Suppress info/debug logs when running as MCP server (stdout is protocol)
  setLogLevel('error');

  const server = createServer();
  const transport = new StdioServerTransport();

  logger.info('CodeBrain MCP server starting', {
    repoRoot: resolveRepoRoot(),
  });

  await server.connect(transport);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`CodeBrain MCP server error: ${msg}\n`);
  process.exit(1);
});
