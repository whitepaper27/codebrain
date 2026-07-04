/**
 * explain_module_authority MCP tool.
 * Returns a full signal breakdown explaining why a file
 * has its authority score and classification.
 */

import type { LoadedData } from './data-loader.js';

/** Signal contribution detail. */
interface SignalDetail {
  signal: string;
  value: number;
  description: string;
}

/** Full response from explain_module_authority. */
interface ExplainResponse {
  tool: 'explain_module_authority';
  file: string;
  authority_score: number;
  authority_tier: string;
  reason: string;
  signals: SignalDetail[];
  metrics: {
    in_degree: number;
    out_degree: number;
    definitions_count: number;
    churn_percentile: number | null;
    blast_radius_direct: number;
    blast_radius_transitive: number;
  };
  dependents: string[];
  dependencies: string[];
}

/** Find files that depend on the target file. */
function findDependents(
  data: LoadedData,
  filePath: string,
): string[] {
  return data.topology.edges
    .filter((e) => e.target === filePath)
    .map((e) => e.source);
}

/** Find files that the target file depends on. */
function findDependencies(
  data: LoadedData,
  filePath: string,
): string[] {
  return data.topology.edges
    .filter((e) => e.source === filePath)
    .map((e) => e.target);
}

/** Build signal details from the SQLite data. */
function buildSignalDetails(
  data: LoadedData,
  filePath: string,
): SignalDetail[] {
  const row = data.db.prepare(
    'SELECT * FROM files WHERE path = ?',
  ).get(filePath) as Record<string, unknown> | undefined;

  if (!row) return [];

  const inDeg = row['in_degree'] as number;
  const outDeg = row['out_degree'] as number;

  return [
    {
      signal: 'dependency_centrality',
      value: inDeg,
      description: `${inDeg} module${inDeg !== 1 ? 's' : ''} import this file`,
    },
    {
      signal: 'reverse_dependency',
      value: outDeg,
      description: `This file imports ${outDeg} other module${outDeg !== 1 ? 's' : ''}`,
    },
    {
      signal: 'schema_ownership',
      value: (row['definitions_count'] as number) > 0 ? 1 : 0,
      description: `Defines ${row['definitions_count']} symbol(s)`,
    },
    {
      signal: 'churn_stability',
      value: row['churn_percentile'] as number ?? 50,
      description: `Churn percentile: ${row['churn_percentile'] ?? 'unknown'}`,
    },
  ];
}

/**
 * Explain the authority score for a single file.
 * Returns full signal breakdown, metrics, and dependency lists.
 */
export function explainModuleAuthority(
  data: LoadedData,
  file: string,
): ExplainResponse {
  const entry = data.authorityTree.entries.find(
    (e) => e.file === file,
  );

  if (!entry) {
    return {
      tool: 'explain_module_authority',
      file,
      authority_score: 0,
      authority_tier: 'UNKNOWN',
      reason: `File "${file}" not found in authority tree. Check the path is relative to the repo root.`,
      signals: [],
      metrics: {
        in_degree: 0, out_degree: 0, definitions_count: 0,
        churn_percentile: null,
        blast_radius_direct: 0, blast_radius_transitive: 0,
      },
      dependents: [],
      dependencies: [],
    };
  }

  const dependents = findDependents(data, file);
  const dependencies = findDependencies(data, file);
  const signals = buildSignalDetails(data, file);

  return {
    tool: 'explain_module_authority',
    file,
    authority_score: entry.authority_score,
    authority_tier: entry.authority_tier,
    reason: entry.reason,
    signals,
    metrics: {
      in_degree: entry.in_degree,
      out_degree: entry.out_degree,
      definitions_count: entry.definitions_count,
      churn_percentile: entry.churn_percentile,
      blast_radius_direct: entry.blast_radius_direct,
      blast_radius_transitive: entry.blast_radius_transitive,
    },
    dependents,
    dependencies,
  };
}
