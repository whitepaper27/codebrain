/**
 * Main evaluation runner for CodeAuthorityBench.
 * Loads tasks, runs baselines + CodeBrain, computes metrics,
 * and outputs results tables.
 *
 * Usage: tsx benchmarks/evaluate.ts [--skip-dense] [--dataset <name>]
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BenchmarkTask,
  BaselineResult,
  EvaluationReport,
  EvaluationMetrics,
  TaskType,
} from './types.js';
import {
  computeMetrics,
  bootstrapCI,
  mcnemarsTest,
  wilcoxonSignedRank,
} from './metrics.js';
import { getBaselines, type Baseline } from './baselines/index.js';
import { scanRepoAuthority } from './baselines/real-authority.js';
import { setPrecomputedScores } from './baselines/codebrain.js';

/** Directory containing this file. */
const BENCH_DIR = import.meta.dirname ?? join(process.cwd(), 'benchmarks');

/** Directory for benchmark task datasets. */
const DATASETS_DIR = join(BENCH_DIR, 'datasets');

/** Directory for evaluation results output. */
const RESULTS_DIR = join(BENCH_DIR, 'results');

/** Top-k for retrieval evaluation. */
const TOP_K = 10;

/** Parse CLI arguments. */
function parseArgs(): { skipDense: boolean; dataset: string | null; ablation: boolean } {
  const args = process.argv.slice(2);
  let skipDense = false;
  let dataset: string | null = null;
  let ablation = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip-dense') {
      skipDense = true;
    }
    if (args[i] === '--ablation') {
      ablation = true;
    }
    if (args[i] === '--dataset' && args[i + 1]) {
      dataset = args[i + 1]!;
      i++;
    }
  }

  return { skipDense, dataset, ablation };
}

/** Load benchmark tasks from JSON files in the datasets directory. */
function loadTasks(datasetFilter: string | null): BenchmarkTask[] {
  if (!existsSync(DATASETS_DIR)) {
    console.error(
      `No datasets directory found at ${DATASETS_DIR}. ` +
      'Create benchmark task files in benchmarks/datasets/*.json.',
    );
    process.exit(1);
  }

  const files = readdirSync(DATASETS_DIR)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !datasetFilter || f.includes(datasetFilter));

  if (files.length === 0) {
    console.error(
      `No .json task files found in ${DATASETS_DIR}` +
      (datasetFilter ? ` matching "${datasetFilter}"` : '') + '.',
    );
    process.exit(1);
  }

  const tasks: BenchmarkTask[] = [];
  for (const file of files) {
    const raw = readFileSync(join(DATASETS_DIR, file), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      tasks.push(...parsed);
    } else if (parsed.tasks && Array.isArray(parsed.tasks)) {
      tasks.push(...parsed.tasks);
    }
  }

  return tasks;
}

/**
 * Load file contents for a repository referenced by tasks.
 * For now, expects a repo_root field or loads from a fixture path.
 */
function loadRepoFiles(repoPath: string): Map<string, string> {
  const files = new Map<string, string>();

  function walkDir(dir: string, prefix: string): void {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Skip common non-source directories
      if (entry.isDirectory()) {
        const skipDirs = new Set([
          'node_modules', '.git', 'dist', 'build',
          'vendor', '__pycache__', '.next', 'coverage',
        ]);
        if (!skipDirs.has(entry.name)) {
          walkDir(fullPath, relPath);
        }
        continue;
      }

      // Only include source files
      const sourceExts = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.py', '.java',
        '.go', '.c', '.h', '.rs', '.rb', '.sql',
        '.json', '.yaml', '.yml', '.toml',
      ]);
      const ext = entry.name.includes('.')
        ? '.' + entry.name.split('.').pop()!
        : '';
      if (!sourceExts.has(ext)) continue;

      try {
        const content = readFileSync(fullPath, 'utf-8');
        // Skip very large files
        if (content.length <= 500 * 1024) {
          files.set(relPath, content);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  walkDir(repoPath, '');
  return files;
}

/**
 * Run a single baseline on all tasks for a given repo.
 * Returns an array of BaselineResults.
 */
async function runBaseline(
  baseline: Baseline,
  tasks: BenchmarkTask[],
  repoFiles: Map<string, Map<string, string>>,
): Promise<BaselineResult[]> {
  const results: BaselineResult[] = [];

  for (const task of tasks) {
    const files = repoFiles.get(task.repo);
    if (!files) {
      console.warn(
        `  Skipping task ${task.id}: no files loaded for repo "${task.repo}"`,
      );
      continue;
    }

    try {
      const ranked = await baseline.rank(task.query, files, TOP_K);
      results.push({
        task_id: task.id,
        method: baseline.name,
        ranked_files: ranked,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `  Error on task ${task.id} with ${baseline.name}: ${msg}`,
      );
      results.push({
        task_id: task.id,
        method: baseline.name,
        ranked_files: [],
      });
    }
  }

  return results;
}

/** Format a number as a percentage with 1 decimal place. */
function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

/** Print a formatted comparison table to stdout. */
function printResultsTable(
  allMetrics: EvaluationMetrics[],
): void {
  const methods = allMetrics.map((m) => m.method);
  const maxNameLen = Math.max(...methods.map((m) => m.length), 6);

  const header = [
    'Method'.padEnd(maxNameLen),
    'P@5'.padStart(7),
    'R@1'.padStart(7),
    'R@5'.padStart(7),
    'R@10'.padStart(7),
    'MRR'.padStart(7),
    'N@5'.padStart(7),
    'N@10'.padStart(7),
    'Auth'.padStart(7),
    'EditR'.padStart(7),
    'BRF1'.padStart(7),
  ].join(' | ');

  const separator = '-'.repeat(header.length);

  console.log('\n' + separator);
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
      pct(m.ndcg_at_5 ?? 0).padStart(7),
      pct(m.ndcg_at_10 ?? 0).padStart(7),
      pct(m.authority_recall).padStart(7),
      (m.edit_risk_accuracy !== undefined
        ? pct(m.edit_risk_accuracy) : '  N/A').padStart(7),
      (m.blast_radius_f1 !== undefined
        ? pct(m.blast_radius_f1) : '  N/A').padStart(7),
    ].join(' | ');
    console.log(row);
  }

  console.log(separator + '\n');
}

/** Print per-task-type breakdown. */
function printTaskTypeBreakdown(
  byType: Record<TaskType, EvaluationMetrics[]>,
): void {
  const taskTypes: TaskType[] = [
    'what_governs', 'where_is_schema',
    'what_breaks', 'is_safe_to_modify',
  ];

  for (const tt of taskTypes) {
    const metrics = byType[tt];
    if (!metrics || metrics.length === 0) continue;

    console.log(`--- ${tt} ---`);
    printResultsTable(metrics);
  }
}

/** Save results to benchmarks/results/ as JSON. */
function saveResults(report: EvaluationReport): string {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = join(RESULTS_DIR, `eval-${timestamp}.json`);
  writeFileSync(
    outputPath,
    JSON.stringify(report, null, 2),
    'utf-8',
  );

  return outputPath;
}

/** Print per-repo breakdown table. */
function printRepoBreakdown(
  byRepo: Record<string, EvaluationMetrics[]>,
): void {
  const repos = Object.keys(byRepo).sort();

  for (const repo of repos) {
    const metrics = byRepo[repo];
    if (!metrics || metrics.length === 0) continue;

    console.log(`--- ${repo} ---`);
    printResultsTable(metrics);
  }
}

/** Main evaluation entry point. */
async function main(): Promise<void> {
  const { skipDense, dataset, ablation } = parseArgs();

  console.log('CodeAuthorityBench Evaluation Harness');
  console.log('=====================================\n');

  // Load tasks
  console.log('Loading benchmark tasks...');
  const tasks = loadTasks(dataset);
  console.log(`  Loaded ${tasks.length} tasks\n`);

  // Identify unique repos and load their files
  const repoNames = [...new Set(tasks.map((t) => t.repo))];
  console.log(`Loading repo files for: ${repoNames.join(', ')}`);

  const repoFiles = new Map<string, Map<string, string>>();
  for (const repo of repoNames) {
    // Try multiple locations for the repo
    const candidates = [
      repo,
      join(BENCH_DIR, 'repos', repo),
      join(process.cwd(), repo),
      join(process.cwd(), 'tests', 'fixtures', repo),
    ];

    let loaded = false;
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const files = loadRepoFiles(candidate);
        repoFiles.set(repo, files);
        console.log(`  ${repo}: ${files.size} files`);
        loaded = true;
        break;
      }
    }

    if (!loaded) {
      console.warn(
        `  ${repo}: NOT FOUND (tried ${candidates.join(', ')})`,
      );
      repoFiles.set(repo, new Map());
    }
  }

  // Pre-scan repos with real tree-sitter pipeline for authority scores
  console.log('\nScanning repos with real tree-sitter pipeline...');
  const repoAuthorityScores = new Map<string, Map<string, number>>();

  for (const repo of repoNames) {
    const candidates = [
      repo,
      join(BENCH_DIR, 'repos', repo),
      join(process.cwd(), repo),
      join(process.cwd(), 'tests', 'fixtures', repo),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        try {
          const scores = await scanRepoAuthority(candidate, repo);
          repoAuthorityScores.set(repo, scores);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  ${repo}: scan failed (${msg}), using heuristic fallback`);
        }
        break;
      }
    }
  }

  // Inject real scores into CodeBrain baseline
  if (repoAuthorityScores.size > 0) {
    setPrecomputedScores(repoAuthorityScores);
    console.log(`  Injected real authority scores for ${repoAuthorityScores.size} repos\n`);
  }

  // Get baselines
  console.log('Loading baselines...');
  const baselines = await getBaselines({
    includeDense: !skipDense,
  });
  console.log(
    `  Using: ${baselines.map((b) => b.name).join(', ')}\n`,
  );

  // Run all baselines
  const allResults: BaselineResult[] = [];

  for (const baseline of baselines) {
    console.log(`Running ${baseline.name}...`);
    const results = await runBaseline(baseline, tasks, repoFiles);
    allResults.push(...results);
    console.log(
      `  ${baseline.name}: ${results.length} results\n`,
    );
  }

  // Compute metrics
  console.log('Computing metrics...\n');
  const methodNames = [...new Set(allResults.map((r) => r.method))];

  const allMetrics = methodNames.map((method) =>
    computeMetrics(tasks, allResults, method, TOP_K),
  );

  const allMetricsWithCI = methodNames.map((method) =>
    bootstrapCI(tasks, allResults, method, TOP_K),
  );

  // Compute per-task-type breakdown
  const taskTypes: TaskType[] = [
    'what_governs', 'where_is_schema',
    'what_breaks', 'is_safe_to_modify',
  ];

  const byTaskType: Record<TaskType, EvaluationMetrics[]> = {
    what_governs: [],
    where_is_schema: [],
    what_breaks: [],
    is_safe_to_modify: [],
  };

  for (const tt of taskTypes) {
    const ttTasks = tasks.filter((t) => t.task_type === tt);
    if (ttTasks.length === 0) continue;

    for (const method of methodNames) {
      byTaskType[tt].push(
        computeMetrics(ttTasks, allResults, method, TOP_K),
      );
    }
  }

  // Compute per-repo breakdown
  const repoNamesForBreakdown = [...new Set(tasks.map((t) => t.repo))];
  const byRepo: Record<string, EvaluationMetrics[]> = {};

  for (const repo of repoNamesForBreakdown) {
    const repoTasks = tasks.filter((t) => t.repo === repo);
    if (repoTasks.length === 0) continue;

    byRepo[repo] = [];
    for (const method of methodNames) {
      byRepo[repo]!.push(
        computeMetrics(repoTasks, allResults, method, TOP_K),
      );
    }
  }

  // McNemar's tests (if CodeBrain is among the methods)
  const mcnemarTests = [];
  const codebrainMethod = methodNames.find(
    (m) => m.toLowerCase().includes('codebrain'),
  );

  if (codebrainMethod) {
    for (const method of methodNames) {
      if (method === codebrainMethod) continue;
      mcnemarTests.push(
        mcnemarsTest(
          tasks, allResults, allResults,
          codebrainMethod, method, TOP_K,
        ),
      );
    }
  }

  // Print results
  console.log('=== Overall Results ===');
  printResultsTable(allMetrics);

  console.log('=== Per-Task-Type Breakdown ===');
  printTaskTypeBreakdown(byTaskType);

  console.log('=== Per-Repo Breakdown ===');
  printRepoBreakdown(byRepo);

  if (mcnemarTests.length > 0) {
    console.log('=== McNemar\'s Tests (CodeBrain vs baselines) ===');
    for (const test of mcnemarTests) {
      const sig = test.p_value < 0.05 ? '*' : '';
      console.log(
        `  ${test.method_a} vs ${test.method_b}: ` +
        `chi2=${test.chi_squared.toFixed(3)}, ` +
        `p=${test.p_value.toFixed(4)}${sig}`,
      );
    }
    console.log();
  }

  // Wilcoxon signed-rank tests
  const wilcoxonTests = [];

  if (codebrainMethod) {
    for (const method of methodNames) {
      if (method === codebrainMethod) continue;
      wilcoxonTests.push(
        wilcoxonSignedRank(tasks, allResults, codebrainMethod, method),
      );
    }
  }

  if (wilcoxonTests.length > 0) {
    console.log('=== Wilcoxon Signed-Rank Tests (CodeBrain vs baselines, on MRR) ===');
    for (const test of wilcoxonTests) {
      const sig = test.p_value < 0.001 ? '***'
        : test.p_value < 0.01 ? '**'
        : test.p_value < 0.05 ? '*' : '';
      console.log(
        `  ${test.method_a} vs ${test.method_b}: ` +
        `W=${test.w_statistic.toFixed(1)}, ` +
        `Z=${test.z_score.toFixed(3)}, ` +
        `p=${test.p_value.toFixed(4)}${sig}, ` +
        `r=${test.effect_size_r.toFixed(3)}, ` +
        `Δ=${test.mean_diff > 0 ? '+' : ''}${test.mean_diff.toFixed(4)}`,
      );
    }
    console.log();
  }

  // Save report
  const report: EvaluationReport = {
    evaluated_at: new Date().toISOString(),
    task_count: tasks.length,
    metrics: allMetricsWithCI,
    by_task_type: byTaskType,
    by_repo: byRepo,
    mcnemar_tests: mcnemarTests,
    wilcoxon_tests: wilcoxonTests,
  };

  const outputPath = saveResults(report);
  console.log(`Results saved to ${outputPath}`);

  // Run ablation if requested
  if (ablation) {
    console.log('\n=== Running Ablation Study ===\n');
    const { runAblation } = await import('./ablation.js');
    await runAblation(tasks, repoFiles, TOP_K);
  }
}

main().catch((err) => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
