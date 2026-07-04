#!/usr/bin/env node

/**
 * CodeBrain CLI entry point.
 * Authority-aware code retrieval for AI coding agents.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { logger, setLogLevel } from './utils/logger.js';
import { runScan } from './cli/scan.js';

const program = new Command();

program
  .name('codebrain')
  .description('Authority-aware code retrieval for AI coding agents')
  .version('0.1.0');

program
  .command('scan <path>')
  .description('Scan a repository and compute authority scores')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (path: string, options: { verbose?: boolean }) => {
    if (options.verbose) setLogLevel('debug');
    const repoRoot = resolve(path);
    await runScan(repoRoot);
  });

program
  .command('serve')
  .description('Start the MCP server')
  .action(async () => {
    logger.info('Starting MCP server');
    const mod = await import('./mcp-server.js');
    // mcp-server.ts self-starts via main() — import triggers it
  });

program
  .command('version')
  .description('Print the version')
  .action(() => {
    process.stderr.write('codebrain 0.1.0\n');
  });

program.parse();
