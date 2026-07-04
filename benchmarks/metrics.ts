/**
 * Metric computation for CodeAuthorityBench.
 * All functions are deterministic except bootstrap CI (uses seeded RNG).
 */

import type {
  BenchmarkTask,
  BaselineResult,
  EvaluationMetrics,
  ConfidenceInterval,
  EvaluationMetricsWithCI,
  McNemarResult,
} from './types.js';

/**
 * Precision@k: of the top-k returned files, what fraction are in ground truth?
 * Returns 0 if k is 0 or no files returned.
 */
export function precisionAtK(
  ranked: string[],
  groundTruth: string[],
  k: number,
): number {
  if (k <= 0) return 0;
  const topK = ranked.slice(0, k);
  if (topK.length === 0) return 0;
  const gtSet = new Set(groundTruth);
  const hits = topK.filter((f) => gtSet.has(f)).length;
  return hits / topK.length;
}

/**
 * Recall@k: of ground-truth files, what fraction appear in top-k?
 * Returns 0 if ground truth is empty.
 */
export function recallAtK(
  ranked: string[],
  groundTruth: string[],
  k: number,
): number {
  if (groundTruth.length === 0 || k <= 0) return 0;
  const topK = new Set(ranked.slice(0, k));
  const hits = groundTruth.filter((f) => topK.has(f)).length;
  return hits / groundTruth.length;
}

/**
 * Authority recall: binary metric.
 * 1 if ANY ground-truth file appears in top-k, 0 otherwise.
 */
export function authorityRecall(
  ranked: string[],
  groundTruth: string[],
  k: number,
): number {
  if (groundTruth.length === 0 || k <= 0) return 0;
  const topK = new Set(ranked.slice(0, k));
  return groundTruth.some((f) => topK.has(f)) ? 1 : 0;
}

/**
 * Edit-risk accuracy: for 'is_safe_to_modify' tasks,
 * did the method correctly identify whether the file is high-authority?
 * Compares whether the top-1 result is in ground truth.
 */
export function editRiskAccuracy(
  ranked: string[],
  groundTruth: string[],
): number {
  if (ranked.length === 0 || groundTruth.length === 0) return 0;
  const gtSet = new Set(groundTruth);
  return gtSet.has(ranked[0]!) ? 1 : 0;
}

/**
 * Mean Reciprocal Rank: 1/(rank of first ground-truth file in results).
 * Returns 0 if no ground-truth file appears in the ranked list.
 */
export function meanReciprocalRank(
  groundTruth: string[],
  rankedFiles: string[],
): number {
  if (groundTruth.length === 0 || rankedFiles.length === 0) return 0;
  const gtSet = new Set(groundTruth);
  for (let i = 0; i < rankedFiles.length; i++) {
    if (gtSet.has(rankedFiles[i]!)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Blast-radius F1: for 'what_breaks' tasks.
 * F1 between predicted affected files and actual affected files.
 */
export function blastRadiusF1(
  predicted: string[],
  actual: string[],
): number {
  if (predicted.length === 0 && actual.length === 0) return 1;
  if (predicted.length === 0 || actual.length === 0) return 0;

  const predSet = new Set(predicted);
  const actualSet = new Set(actual);

  const truePositives = predicted.filter((f) => actualSet.has(f)).length;
  const precision = truePositives / predicted.length;
  const recall = truePositives / actual.length;

  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Compute aggregate metrics for one method across all tasks.
 * Groups results by task and computes mean metrics.
 */
export function computeMetrics(
  tasks: BenchmarkTask[],
  results: BaselineResult[],
  methodName: string,
  k: number = 10,
): EvaluationMetrics {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const methodResults = results.filter((r) => r.method === methodName);

  if (methodResults.length === 0) {
    return emptyMetrics(methodName);
  }

  let p5Sum = 0;
  let r1Sum = 0;
  let r5Sum = 0;
  let r10Sum = 0;
  let arSum = 0;
  let mrrSum = 0;
  let erCount = 0;
  let erSum = 0;
  let brCount = 0;
  let brSum = 0;

  for (const result of methodResults) {
    const task = taskMap.get(result.task_id);
    if (!task) continue;

    const gt = task.ground_truth_files;
    const ranked = result.ranked_files;

    p5Sum += precisionAtK(ranked, gt, 5);
    r1Sum += recallAtK(ranked, gt, 1);
    r5Sum += recallAtK(ranked, gt, 5);
    r10Sum += recallAtK(ranked, gt, k);
    arSum += authorityRecall(ranked, gt, k);
    mrrSum += meanReciprocalRank(gt, ranked);

    if (task.task_type === 'is_safe_to_modify') {
      erSum += editRiskAccuracy(ranked, gt);
      erCount++;
    }

    if (task.task_type === 'what_breaks') {
      brSum += blastRadiusF1(ranked, gt);
      brCount++;
    }
  }

  const n = methodResults.length;

  return {
    method: methodName,
    precision_at_5: p5Sum / n,
    recall_at_1: r1Sum / n,
    recall_at_5: r5Sum / n,
    recall_at_10: r10Sum / n,
    authority_recall: arSum / n,
    mrr: mrrSum / n,
    edit_risk_accuracy: erCount > 0 ? erSum / erCount : undefined,
    blast_radius_f1: brCount > 0 ? brSum / brCount : undefined,
  };
}

/** Return zero-filled metrics for a method with no results. */
function emptyMetrics(method: string): EvaluationMetrics {
  return {
    method,
    precision_at_5: 0,
    recall_at_1: 0,
    recall_at_5: 0,
    recall_at_10: 0,
    authority_recall: 0,
    mrr: 0,
  };
}

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Deterministic given the same seed.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap confidence intervals (95%) for all core metrics.
 * Uses seeded RNG for reproducibility (1000 samples).
 */
export function bootstrapCI(
  tasks: BenchmarkTask[],
  results: BaselineResult[],
  methodName: string,
  k: number = 10,
  numSamples: number = 1000,
  seed: number = 42,
): EvaluationMetricsWithCI {
  const rng = mulberry32(seed);
  const methodResults = results.filter((r) => r.method === methodName);

  const bootMetrics: EvaluationMetrics[] = [];

  for (let i = 0; i < numSamples; i++) {
    // Sample tasks with replacement
    const sampledTasks: BenchmarkTask[] = [];
    const sampledResults: BaselineResult[] = [];

    for (let j = 0; j < tasks.length; j++) {
      const idx = Math.floor(rng() * tasks.length);
      const task = tasks[idx]!;
      sampledTasks.push(task);

      const matchingResult = methodResults.find(
        (r) => r.task_id === task.id,
      );
      if (matchingResult) {
        sampledResults.push(matchingResult);
      }
    }

    bootMetrics.push(
      computeMetrics(sampledTasks, sampledResults, methodName, k),
    );
  }

  const pointEstimate = computeMetrics(tasks, results, methodName, k);

  return {
    ...pointEstimate,
    ci: {
      precision_at_5: extractCI(bootMetrics.map((m) => m.precision_at_5)),
      recall_at_1: extractCI(bootMetrics.map((m) => m.recall_at_1)),
      recall_at_5: extractCI(bootMetrics.map((m) => m.recall_at_5)),
      recall_at_10: extractCI(bootMetrics.map((m) => m.recall_at_10)),
      authority_recall: extractCI(
        bootMetrics.map((m) => m.authority_recall),
      ),
      mrr: extractCI(bootMetrics.map((m) => m.mrr)),
    },
  };
}

/** Extract 95% confidence interval from an array of bootstrap values. */
function extractCI(values: number[]): ConfidenceInterval {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const lowerIdx = Math.floor(n * 0.025);
  const upperIdx = Math.floor(n * 0.975);
  const mean = values.reduce((a, b) => a + b, 0) / n;

  return {
    lower: sorted[lowerIdx] ?? 0,
    point: mean,
    upper: sorted[upperIdx] ?? 0,
  };
}

/**
 * McNemar's test: compare two methods on per-task correct/incorrect.
 * A task is "correct" if any ground-truth file appears in top-k.
 * Returns chi-squared statistic and approximate p-value.
 */
export function mcnemarsTest(
  tasks: BenchmarkTask[],
  resultsA: BaselineResult[],
  resultsB: BaselineResult[],
  methodA: string,
  methodB: string,
  k: number = 10,
): McNemarResult {
  const aMap = new Map(
    resultsA
      .filter((r) => r.method === methodA)
      .map((r) => [r.task_id, r]),
  );
  const bMap = new Map(
    resultsB
      .filter((r) => r.method === methodB)
      .map((r) => [r.task_id, r]),
  );

  let bothCorrect = 0;
  let aCorrectBWrong = 0;
  let aWrongBCorrect = 0;
  let bothWrong = 0;

  for (const task of tasks) {
    const aResult = aMap.get(task.id);
    const bResult = bMap.get(task.id);

    const aCorrect = aResult
      ? authorityRecall(aResult.ranked_files, task.ground_truth_files, k) === 1
      : false;
    const bCorrect = bResult
      ? authorityRecall(bResult.ranked_files, task.ground_truth_files, k) === 1
      : false;

    if (aCorrect && bCorrect) bothCorrect++;
    else if (aCorrect && !bCorrect) aCorrectBWrong++;
    else if (!aCorrect && bCorrect) aWrongBCorrect++;
    else bothWrong++;
  }

  // McNemar's chi-squared with continuity correction
  const b = aCorrectBWrong;
  const c = aWrongBCorrect;
  const numerator = (Math.abs(b - c) - 1) ** 2;
  const denominator = b + c;
  const chiSquared = denominator > 0 ? numerator / denominator : 0;

  // Approximate p-value from chi-squared (1 df)
  // Using the survival function of chi-squared distribution
  const pValue = chiSquaredSurvival(chiSquared, 1);

  return {
    method_a: methodA,
    method_b: methodB,
    a_correct_b_wrong: aCorrectBWrong,
    a_wrong_b_correct: aWrongBCorrect,
    both_correct: bothCorrect,
    both_wrong: bothWrong,
    chi_squared: chiSquared,
    p_value: pValue,
  };
}

/**
 * Approximate survival function (1 - CDF) for chi-squared distribution
 * with the given degrees of freedom.
 * Uses the regularized incomplete gamma function approximation.
 */
function chiSquaredSurvival(x: number, df: number): number {
  if (x <= 0) return 1;
  // For df=1: P(X > x) = 2 * (1 - normalCDF(sqrt(x)))
  if (df === 1) {
    return 2 * (1 - normalCDF(Math.sqrt(x)));
  }
  // For other df, use incomplete gamma approximation
  return 1 - regularizedGammaP(df / 2, x / 2);
}

/** Approximate standard normal CDF using Abramowitz and Stegun. */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Regularized incomplete gamma function P(a, x).
 * Uses series expansion for small x and continued fraction for large x.
 */
function regularizedGammaP(a: number, x: number): number {
  if (x < 0) return 0;
  if (x === 0) return 0;
  if (x < a + 1) {
    return gammaPSeries(a, x);
  }
  return 1 - gammaPContinuedFraction(a, x);
}

/** Series expansion for regularized incomplete gamma P(a, x). */
function gammaPSeries(a: number, x: number): number {
  const maxIter = 200;
  const eps = 1e-10;
  let sum = 1 / a;
  let term = 1 / a;

  for (let n = 1; n < maxIter; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < eps * Math.abs(sum)) break;
  }

  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/** Continued fraction for regularized incomplete gamma Q(a, x). */
function gammaPContinuedFraction(a: number, x: number): number {
  const maxIter = 200;
  const eps = 1e-10;
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i < maxIter; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }

  return h * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/** Log-gamma function using Stirling's approximation. */
function lnGamma(x: number): number {
  const coeffs = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of coeffs) {
    y += 1;
    ser += c / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
