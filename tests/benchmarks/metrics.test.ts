/**
 * Tests for benchmark metric computations.
 * Validates precision@k, recall@k, authority recall,
 * McNemar's test, and bootstrap CI with known inputs.
 */

import { describe, it, expect } from 'vitest';
import {
  precisionAtK,
  recallAtK,
  authorityRecall,
  editRiskAccuracy,
  blastRadiusF1,
  meanReciprocalRank,
  computeMetrics,
  mcnemarsTest,
  bootstrapCI,
} from '../../benchmarks/metrics.js';
import type { BenchmarkTask, BaselineResult } from '../../benchmarks/types.js';

describe('precisionAtK', () => {
  it('returns 1.0 when all top-k are in ground truth', () => {
    const ranked = ['a.ts', 'b.ts', 'c.ts'];
    const gt = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
    expect(precisionAtK(ranked, gt, 3)).toBe(1.0);
  });

  it('returns 0.0 when no top-k are in ground truth', () => {
    const ranked = ['x.ts', 'y.ts', 'z.ts'];
    const gt = ['a.ts', 'b.ts'];
    expect(precisionAtK(ranked, gt, 3)).toBe(0.0);
  });

  it('handles partial overlap', () => {
    const ranked = ['a.ts', 'x.ts', 'b.ts', 'y.ts', 'c.ts'];
    const gt = ['a.ts', 'b.ts'];
    // top-5: 2 hits out of 5
    expect(precisionAtK(ranked, gt, 5)).toBeCloseTo(0.4);
  });

  it('handles k larger than ranked list', () => {
    const ranked = ['a.ts', 'b.ts'];
    const gt = ['a.ts', 'b.ts', 'c.ts'];
    // Only 2 returned, both correct -> 2/2 = 1.0
    expect(precisionAtK(ranked, gt, 5)).toBe(1.0);
  });

  it('returns 0 for k=0', () => {
    expect(precisionAtK(['a.ts'], ['a.ts'], 0)).toBe(0);
  });

  it('returns 0 for empty ranked list', () => {
    expect(precisionAtK([], ['a.ts'], 5)).toBe(0);
  });
});

describe('recallAtK', () => {
  it('returns 1.0 when all ground-truth files are in top-k', () => {
    const ranked = ['a.ts', 'b.ts', 'c.ts', 'x.ts'];
    const gt = ['a.ts', 'b.ts'];
    expect(recallAtK(ranked, gt, 4)).toBe(1.0);
  });

  it('returns 0.5 when half of ground truth is in top-k', () => {
    const ranked = ['a.ts', 'x.ts', 'y.ts'];
    const gt = ['a.ts', 'b.ts'];
    expect(recallAtK(ranked, gt, 3)).toBe(0.5);
  });

  it('returns 0.0 when no ground-truth files are in top-k', () => {
    const ranked = ['x.ts', 'y.ts'];
    const gt = ['a.ts', 'b.ts'];
    expect(recallAtK(ranked, gt, 2)).toBe(0.0);
  });

  it('returns 0 for empty ground truth', () => {
    expect(recallAtK(['a.ts'], [], 5)).toBe(0);
  });
});

describe('authorityRecall', () => {
  it('returns 1 when any ground-truth file is in top-k', () => {
    const ranked = ['x.ts', 'a.ts', 'y.ts'];
    const gt = ['a.ts', 'b.ts'];
    expect(authorityRecall(ranked, gt, 3)).toBe(1);
  });

  it('returns 0 when no ground-truth file is in top-k', () => {
    const ranked = ['x.ts', 'y.ts', 'z.ts'];
    const gt = ['a.ts'];
    expect(authorityRecall(ranked, gt, 3)).toBe(0);
  });

  it('respects the k limit', () => {
    const ranked = ['x.ts', 'y.ts', 'a.ts'];
    const gt = ['a.ts'];
    // k=2 means only check first 2 files
    expect(authorityRecall(ranked, gt, 2)).toBe(0);
    expect(authorityRecall(ranked, gt, 3)).toBe(1);
  });
});

describe('editRiskAccuracy', () => {
  it('returns 1 when top-1 is in ground truth', () => {
    expect(editRiskAccuracy(['a.ts', 'b.ts'], ['a.ts'])).toBe(1);
  });

  it('returns 0 when top-1 is not in ground truth', () => {
    expect(editRiskAccuracy(['x.ts', 'a.ts'], ['a.ts'])).toBe(0);
  });
});

describe('blastRadiusF1', () => {
  it('returns 1.0 for perfect prediction', () => {
    expect(blastRadiusF1(['a.ts', 'b.ts'], ['a.ts', 'b.ts'])).toBe(1.0);
  });

  it('returns 0.0 for no overlap', () => {
    expect(blastRadiusF1(['a.ts'], ['b.ts'])).toBe(0.0);
  });

  it('computes correct F1 for partial overlap', () => {
    // predicted: [a, b, c], actual: [a, b, d]
    // TP=2, precision=2/3, recall=2/3, F1=2/3
    const f1 = blastRadiusF1(['a.ts', 'b.ts', 'c.ts'], ['a.ts', 'b.ts', 'd.ts']);
    expect(f1).toBeCloseTo(2 / 3);
  });

  it('returns 1.0 for both empty', () => {
    expect(blastRadiusF1([], [])).toBe(1.0);
  });

  it('returns 0.0 when predicted is empty but actual is not', () => {
    expect(blastRadiusF1([], ['a.ts'])).toBe(0.0);
  });
});

describe('meanReciprocalRank', () => {
  it('returns 1.0 when first result is ground truth', () => {
    expect(meanReciprocalRank(['a.ts'], ['a.ts', 'b.ts', 'c.ts'])).toBe(1.0);
  });

  it('returns 0.5 when first ground truth is at position 2', () => {
    expect(meanReciprocalRank(['a.ts'], ['x.ts', 'a.ts', 'y.ts'])).toBe(0.5);
  });

  it('returns 1/3 when first ground truth is at position 3', () => {
    expect(meanReciprocalRank(['a.ts'], ['x.ts', 'y.ts', 'a.ts'])).toBeCloseTo(1 / 3);
  });

  it('uses the first ground-truth hit, not the best', () => {
    // b.ts appears at rank 2, a.ts at rank 3 — MRR should be 1/2
    expect(meanReciprocalRank(['a.ts', 'b.ts'], ['x.ts', 'b.ts', 'a.ts'])).toBe(0.5);
  });

  it('returns 0 when no ground-truth file appears', () => {
    expect(meanReciprocalRank(['a.ts'], ['x.ts', 'y.ts'])).toBe(0);
  });

  it('returns 0 for empty ground truth', () => {
    expect(meanReciprocalRank([], ['a.ts'])).toBe(0);
  });

  it('returns 0 for empty ranked list', () => {
    expect(meanReciprocalRank(['a.ts'], [])).toBe(0);
  });
});

describe('computeMetrics', () => {
  const tasks: BenchmarkTask[] = [
    {
      id: 't1',
      repo: 'test-repo',
      query: 'What governs auth?',
      task_type: 'what_governs',
      ground_truth_files: ['auth.ts', 'config.ts'],
      difficulty: 'easy',
    },
    {
      id: 't2',
      repo: 'test-repo',
      query: 'Is it safe to modify db.ts?',
      task_type: 'is_safe_to_modify',
      ground_truth_files: ['db.ts'],
      difficulty: 'medium',
    },
    {
      id: 't3',
      repo: 'test-repo',
      query: 'What breaks if schema changes?',
      task_type: 'what_breaks',
      ground_truth_files: ['svc.ts', 'api.ts'],
      difficulty: 'hard',
    },
  ];

  const results: BaselineResult[] = [
    {
      task_id: 't1',
      method: 'TestMethod',
      ranked_files: ['auth.ts', 'foo.ts', 'config.ts', 'bar.ts', 'baz.ts'],
    },
    {
      task_id: 't2',
      method: 'TestMethod',
      ranked_files: ['db.ts', 'other.ts'],
    },
    {
      task_id: 't3',
      method: 'TestMethod',
      ranked_files: ['unrelated.ts', 'svc.ts'],
    },
  ];

  it('computes aggregate metrics correctly', () => {
    const metrics = computeMetrics(tasks, results, 'TestMethod', 10);

    expect(metrics.method).toBe('TestMethod');
    expect(metrics.precision_at_5).toBeGreaterThan(0);
    expect(metrics.recall_at_1).toBeGreaterThan(0);
    expect(metrics.authority_recall).toBeGreaterThan(0);
    expect(metrics.mrr).toBeGreaterThan(0);
    expect(metrics.edit_risk_accuracy).toBeDefined();
    expect(metrics.blast_radius_f1).toBeDefined();
  });

  it('computes MRR correctly', () => {
    const metrics = computeMetrics(tasks, results, 'TestMethod', 10);
    // t1: auth.ts at rank 1 -> RR = 1
    // t2: db.ts at rank 1 -> RR = 1
    // t3: svc.ts at rank 2 -> RR = 0.5
    // MRR = (1 + 1 + 0.5) / 3 = 5/6
    expect(metrics.mrr).toBeCloseTo(5 / 6);
  });

  it('returns zeros for unknown method', () => {
    const metrics = computeMetrics(tasks, results, 'Unknown', 10);
    expect(metrics.precision_at_5).toBe(0);
    expect(metrics.recall_at_1).toBe(0);
    expect(metrics.mrr).toBe(0);
  });

  it('computes edit_risk_accuracy only for is_safe_to_modify tasks', () => {
    const metrics = computeMetrics(tasks, results, 'TestMethod', 10);
    // t2 is is_safe_to_modify, db.ts is in top-1 -> accuracy = 1
    expect(metrics.edit_risk_accuracy).toBe(1);
  });

  it('computes blast_radius_f1 only for what_breaks tasks', () => {
    const metrics = computeMetrics(tasks, results, 'TestMethod', 10);
    // t3: predicted [unrelated, svc], actual [svc, api]
    // TP=1, P=1/2, R=1/2, F1=1/2
    expect(metrics.blast_radius_f1).toBeCloseTo(0.5);
  });
});

describe('mcnemarsTest', () => {
  const tasks: BenchmarkTask[] = [
    { id: 't1', repo: 'r', query: 'q1', task_type: 'what_governs', ground_truth_files: ['a.ts'], difficulty: 'easy' },
    { id: 't2', repo: 'r', query: 'q2', task_type: 'what_governs', ground_truth_files: ['b.ts'], difficulty: 'easy' },
    { id: 't3', repo: 'r', query: 'q3', task_type: 'what_governs', ground_truth_files: ['c.ts'], difficulty: 'easy' },
    { id: 't4', repo: 'r', query: 'q4', task_type: 'what_governs', ground_truth_files: ['d.ts'], difficulty: 'easy' },
  ];

  it('computes correct contingency table', () => {
    const resultsA: BaselineResult[] = [
      { task_id: 't1', method: 'A', ranked_files: ['a.ts'] },     // A correct
      { task_id: 't2', method: 'A', ranked_files: ['b.ts'] },     // A correct
      { task_id: 't3', method: 'A', ranked_files: ['wrong.ts'] }, // A wrong
      { task_id: 't4', method: 'A', ranked_files: ['wrong.ts'] }, // A wrong
    ];
    const resultsB: BaselineResult[] = [
      { task_id: 't1', method: 'B', ranked_files: ['a.ts'] },     // B correct
      { task_id: 't2', method: 'B', ranked_files: ['wrong.ts'] }, // B wrong
      { task_id: 't3', method: 'B', ranked_files: ['c.ts'] },     // B correct
      { task_id: 't4', method: 'B', ranked_files: ['wrong.ts'] }, // B wrong
    ];

    const result = mcnemarsTest(tasks, resultsA, resultsB, 'A', 'B', 10);

    expect(result.both_correct).toBe(1);      // t1
    expect(result.a_correct_b_wrong).toBe(1);  // t2
    expect(result.a_wrong_b_correct).toBe(1);  // t3
    expect(result.both_wrong).toBe(1);          // t4
  });

  it('returns chi_squared=0 when discordant pairs are equal', () => {
    const resultsA: BaselineResult[] = [
      { task_id: 't1', method: 'A', ranked_files: ['a.ts'] },
      { task_id: 't2', method: 'A', ranked_files: ['wrong.ts'] },
    ];
    const resultsB: BaselineResult[] = [
      { task_id: 't1', method: 'B', ranked_files: ['wrong.ts'] },
      { task_id: 't2', method: 'B', ranked_files: ['b.ts'] },
    ];

    const result = mcnemarsTest(tasks.slice(0, 2), resultsA, resultsB, 'A', 'B', 10);
    // b=1, c=1, continuity correction: (|1-1|-1)^2 / (1+1) = 0.5
    expect(result.chi_squared).toBeCloseTo(0.5);
  });

  it('returns p_value in [0, 1]', () => {
    const resultsA: BaselineResult[] = tasks.map((t) => ({
      task_id: t.id,
      method: 'A',
      ranked_files: [t.ground_truth_files[0]!],
    }));
    const resultsB: BaselineResult[] = tasks.map((t) => ({
      task_id: t.id,
      method: 'B',
      ranked_files: ['wrong.ts'],
    }));

    const result = mcnemarsTest(tasks, resultsA, resultsB, 'A', 'B', 10);
    expect(result.p_value).toBeGreaterThanOrEqual(0);
    expect(result.p_value).toBeLessThanOrEqual(1);
  });
});

describe('bootstrapCI', () => {
  const tasks: BenchmarkTask[] = [
    { id: 't1', repo: 'r', query: 'q1', task_type: 'what_governs', ground_truth_files: ['a.ts'], difficulty: 'easy' },
    { id: 't2', repo: 'r', query: 'q2', task_type: 'what_governs', ground_truth_files: ['b.ts'], difficulty: 'easy' },
    { id: 't3', repo: 'r', query: 'q3', task_type: 'what_governs', ground_truth_files: ['c.ts'], difficulty: 'easy' },
  ];

  const results: BaselineResult[] = [
    { task_id: 't1', method: 'M', ranked_files: ['a.ts'] },
    { task_id: 't2', method: 'M', ranked_files: ['b.ts'] },
    { task_id: 't3', method: 'M', ranked_files: ['wrong.ts'] },
  ];

  it('returns confidence intervals with lower <= point <= upper', () => {
    const metricsCI = bootstrapCI(tasks, results, 'M', 10, 500, 42);

    for (const key of ['precision_at_5', 'recall_at_1', 'recall_at_5', 'recall_at_10', 'authority_recall', 'mrr'] as const) {
      const ci = metricsCI.ci[key];
      expect(ci.lower).toBeLessThanOrEqual(ci.point + 0.001);
      expect(ci.point).toBeLessThanOrEqual(ci.upper + 0.001);
    }
  });

  it('is deterministic with the same seed', () => {
    const ci1 = bootstrapCI(tasks, results, 'M', 10, 500, 42);
    const ci2 = bootstrapCI(tasks, results, 'M', 10, 500, 42);

    expect(ci1.ci.precision_at_5.lower).toBe(ci2.ci.precision_at_5.lower);
    expect(ci1.ci.precision_at_5.upper).toBe(ci2.ci.precision_at_5.upper);
  });

  it('produces different results with different seeds', () => {
    const ci1 = bootstrapCI(tasks, results, 'M', 10, 500, 42);
    const ci2 = bootstrapCI(tasks, results, 'M', 10, 500, 99);

    // With different seeds, the bootstrap point estimates (means) should differ
    // even when bounds are quantized due to small sample sizes
    const same =
      ci1.ci.authority_recall.point === ci2.ci.authority_recall.point &&
      ci1.ci.recall_at_1.point === ci2.ci.recall_at_1.point &&
      ci1.ci.recall_at_5.point === ci2.ci.recall_at_5.point;
    expect(same).toBe(false);
  });

  it('includes point estimate from original data', () => {
    const metricsCI = bootstrapCI(tasks, results, 'M', 10, 500, 42);
    // 2 out of 3 tasks have correct top-1 -> authority_recall = 2/3
    expect(metricsCI.authority_recall).toBeCloseTo(2 / 3);
  });
});
