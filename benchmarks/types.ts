/**
 * Type definitions for the CodeAuthorityBench evaluation harness.
 * Covers benchmark tasks, baseline results, and computed metrics.
 */

/** Supported benchmark task types, each testing a different authority query. */
export type TaskType =
  | 'what_governs'
  | 'where_is_schema'
  | 'what_breaks'
  | 'is_safe_to_modify';

/** Difficulty level for a benchmark task. */
export type Difficulty = 'easy' | 'medium' | 'hard';

/** Risk level for is_safe_to_modify tasks. */
export type RiskLevel = 'SAFE' | 'CAUTION' | 'REQUIRES_HUMAN_APPROVAL';

/** A single benchmark task with a query and ground-truth files. */
export interface BenchmarkTask {
  /** Unique task identifier (e.g. "express-001"). */
  id: string;
  /** Target repository name or path. */
  repo: string;
  /** Natural-language query an agent would ask. */
  query: string;
  /** Category of query for per-type metric breakdowns. */
  task_type: TaskType;
  /** Files that are the correct authoritative answers. */
  ground_truth_files: string[];
  /** Human-assessed difficulty. */
  difficulty: Difficulty;
  /** Expected risk level for is_safe_to_modify tasks. */
  expected_risk?: RiskLevel;
}

/** Result of running a single baseline on a single task. */
export interface BaselineResult {
  /** Task this result corresponds to. */
  task_id: string;
  /** Name of the retrieval method. */
  method: string;
  /** Top-k files returned, ordered by predicted relevance. */
  ranked_files: string[];
  /** Optional relevance or authority scores for each file. */
  scores?: number[];
}

/** Aggregated evaluation metrics for one method. */
export interface EvaluationMetrics {
  /** Name of the retrieval method. */
  method: string;
  /** Fraction of top-5 files that are in ground truth. */
  precision_at_5: number;
  /** Fraction of ground-truth files appearing in top-1. */
  recall_at_1: number;
  /** Fraction of ground-truth files appearing in top-5. */
  recall_at_5: number;
  /** Fraction of ground-truth files appearing in top-10. */
  recall_at_10: number;
  /** Binary: did any ground-truth file appear in top-k? */
  authority_recall: number;
  /** For 'is_safe_to_modify' tasks: accuracy of risk classification. */
  edit_risk_accuracy?: number;
  /** For 'what_breaks' tasks: F1 of predicted vs actual affected files. */
  blast_radius_f1?: number;
  /** Mean Reciprocal Rank: 1/(rank of first ground-truth file). */
  mrr: number;
  /** NDCG@5: Normalized Discounted Cumulative Gain at 5. */
  ndcg_at_5?: number;
  /** NDCG@10: Normalized Discounted Cumulative Gain at 10. */
  ndcg_at_10?: number;
}

/** Bootstrap confidence interval for a metric. */
export interface ConfidenceInterval {
  /** Lower bound (2.5th percentile). */
  lower: number;
  /** Point estimate (mean of bootstrap distribution). */
  point: number;
  /** Upper bound (97.5th percentile). */
  upper: number;
}

/** Extended metrics with confidence intervals. */
export interface EvaluationMetricsWithCI extends EvaluationMetrics {
  ci: {
    precision_at_5: ConfidenceInterval;
    recall_at_1: ConfidenceInterval;
    recall_at_5: ConfidenceInterval;
    recall_at_10: ConfidenceInterval;
    authority_recall: ConfidenceInterval;
    mrr: ConfidenceInterval;
    ndcg_at_5: ConfidenceInterval;
    ndcg_at_10: ConfidenceInterval;
  };
}

/** Result of Wilcoxon signed-rank test comparing two methods. */
export interface WilcoxonResult {
  /** First method name. */
  method_a: string;
  /** Second method name. */
  method_b: string;
  /** Number of non-zero paired differences. */
  n_pairs: number;
  /** Wilcoxon W statistic (smaller of W+ and W-). */
  w_statistic: number;
  /** Z-score with continuity correction. */
  z_score: number;
  /** Two-sided p-value via normal approximation. */
  p_value: number;
  /** Effect size r = |Z| / sqrt(N). */
  effect_size_r: number;
  /** Mean per-task MRR difference (A - B). */
  mean_diff: number;
}

/** Result of McNemar's test comparing two methods. */
export interface McNemarResult {
  /** First method name. */
  method_a: string;
  /** Second method name. */
  method_b: string;
  /** Number of tasks where A is correct and B is wrong. */
  a_correct_b_wrong: number;
  /** Number of tasks where B is correct and A is wrong. */
  a_wrong_b_correct: number;
  /** Number of tasks where both are correct. */
  both_correct: number;
  /** Number of tasks where both are wrong. */
  both_wrong: number;
  /** Chi-squared statistic. */
  chi_squared: number;
  /** Two-sided p-value. */
  p_value: number;
}

/** Full evaluation report for all methods on all tasks. */
export interface EvaluationReport {
  /** When the evaluation was run. */
  evaluated_at: string;
  /** Total number of tasks. */
  task_count: number;
  /** Per-method aggregate metrics. */
  metrics: EvaluationMetricsWithCI[];
  /** Per-task-type breakdown. */
  by_task_type: Record<TaskType, EvaluationMetrics[]>;
  /** Per-repo breakdown. */
  by_repo: Record<string, EvaluationMetrics[]>;
  /** Pairwise McNemar's tests (CodeBrain vs each baseline). */
  mcnemar_tests: McNemarResult[];
  /** Pairwise Wilcoxon signed-rank tests (CodeBrain vs each baseline). */
  wilcoxon_tests: WilcoxonResult[];
}
