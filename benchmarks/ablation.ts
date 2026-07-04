/**
 * Ablation study runner for CodeBrain.
 * Tests each authority signal in isolation and in combination
 * to measure individual signal contributions.
 *
 * Usage: tsx benchmarks/evaluate.ts --ablation
 *   or:  tsx benchmarks/ablation.ts [--dataset <name>]
 */

import type {
  BenchmarkTask,
  EvaluationMetrics,
} from './types.js';
import { computeMetrics } from './metrics.js';
import { createCodebrainBaseline } from './baselines/codebrain.js';
import type { AuthorityConfig } from './baselines/authority-heuristic.js';
import type { Baseline } from './baselines/index.js';

/** Named ablation variant with its authority config. */
interface AblationVariant {
  /** Human-readable label for results tables. */
  name: string;
  /** Which authority signals to enable. */
  config: AuthorityConfig;
}

/**
 * Ablation variants testing each signal and combination.
 * Each variant zeroes out specific signals to measure their contribution.
 */
const ABLATION_VARIANTS: AblationVariant[] = [
  {
    name: 'flat-only',
    config: {
      useDirectory: false,
      useSchema: false,
      useFramework: false,
      useCrossFile: false,
      useExportDensity: false,
    },
  },
  {
    name: 'graph-only',
    config: {
      useDirectory: false,
      useSchema: false,
      useFramework: false,
      useCrossFile: true,
      useExportDensity: false,
    },
  },
  {
    name: 'directory-only',
    config: {
      useDirectory: true,
      useSchema: false,
      useFramework: false,
      useCrossFile: false,
      useExportDensity: false,
    },
  },
  {
    name: 'graph+schema',
    config: {
      useDirectory: false,
      useSchema: true,
      useFramework: false,
      useCrossFile: true,
      useExportDensity: false,
    },
  },
  {
    name: 'graph+directory',
    config: {
      useDirectory: true,
      useSchema: false,
      useFramework: false,
      useCrossFile: true,
      useExportDensity: false,
    },
  },
  {
    name: 'full',
    config: {
      useDirectory: true,
      useSchema: true,
      useFramework: true,
      useCrossFile: true,
      useExportDensity: true,
    },
  },
];

/** Format a number as a percentage with 1 decimal place. */
function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

/** Print the ablation results table to stdout. */
function printAblationTable(allMetrics: EvaluationMetrics[]): void {
  const methods = allMetrics.map((m) => m.method);
  const maxNameLen = Math.max(...methods.map((m) => m.length), 8);

  const header = [
    'Variant'.padEnd(maxNameLen),
    'P@5'.padStart(7),
    'R@1'.padStart(7),
    'R@5'.padStart(7),
    'R@10'.padStart(7),
    'MRR'.padStart(7),
    'Auth'.padStart(7),
  ].join(' | ');

  const separator = '-'.repeat(header.length);

  console.log(separator);
  console.log(header);
  console.log(separator);

  for (const m of allMetrics) {
    const row = [
      m.method.padEnd(maxNameLen),
      pct(m.precision_at_5).padStart(7),
      pct(m.recall_at_1).padStart(7),
      pct(m.recall_at_5).padStart(7),
      pct(m.recall_at_10).padStart(7),
      pct(m.mrr).padStart(7),
      pct(m.authority_recall).padStart(7),
    ].join(' | ');
    console.log(row);
  }

  console.log(separator);
}

/**
 * Run the ablation study: evaluate all variants on the given tasks.
 * Called from evaluate.ts with --ablation flag or standalone.
 *
 * @param tasks - Benchmark tasks to evaluate.
 * @param repoFiles - Map of repo name -> (file path -> content).
 * @param topK - Top-k for retrieval evaluation.
 */
export async function runAblation(
  tasks: BenchmarkTask[],
  repoFiles: Map<string, Map<string, string>>,
  topK: number,
): Promise<EvaluationMetrics[]> {
  const allResults: import('./types.js').BaselineResult[] = [];
  const variantBaselines: Baseline[] = ABLATION_VARIANTS.map((v) =>
    createCodebrainBaseline(v.config, `CB:${v.name}`),
  );

  for (const baseline of variantBaselines) {
    console.log(`  Running ablation variant: ${baseline.name}`);

    for (const task of tasks) {
      const files = repoFiles.get(task.repo);
      if (!files) continue;

      try {
        const ranked = await baseline.rank(task.query, files, topK);
        allResults.push({
          task_id: task.id,
          method: baseline.name,
          ranked_files: ranked,
        });
      } catch {
        allResults.push({
          task_id: task.id,
          method: baseline.name,
          ranked_files: [],
        });
      }
    }
  }

  // Compute metrics for each variant
  const ablationMetrics = variantBaselines.map((b) =>
    computeMetrics(tasks, allResults, b.name, topK),
  );

  // Print overall ablation table
  console.log('\n=== Ablation Results (Overall) ===');
  printAblationTable(ablationMetrics);

  // Print per-repo ablation breakdown
  const repoNames = [...new Set(tasks.map((t) => t.repo))];
  if (repoNames.length > 1) {
    for (const repo of repoNames) {
      const repoTasks = tasks.filter((t) => t.repo === repo);
      if (repoTasks.length === 0) continue;

      const repoMetrics = variantBaselines.map((b) =>
        computeMetrics(repoTasks, allResults, b.name, topK),
      );

      console.log(`\n=== Ablation: ${repo} ===`);
      printAblationTable(repoMetrics);
    }
  }

  return ablationMetrics;
}
