/**
 * Configuration loader for CodeBrain.
 * Loads .codebrain/config.json with defaults, validates with Zod.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { logger } from './logger.js';

/** Default signal weights for authority scoring. */
export const DEFAULT_SIGNALS = {
  in_degree_weight: 0.35,
  schema_bonus: 0.2,
  churn_penalty_weight: 0.15,
  directory_heuristic_weight: 0.15,
  out_degree_penalty_weight: 0.15,
} as const;

/** Default authority tier thresholds. */
export const DEFAULT_THRESHOLDS = {
  root: 0.8,
  derived_upper: 0.7,
  derived_lower: 0.3,
  leaf: 0.2,
} as const;

/** Default directory patterns for authority heuristics. */
export const DEFAULT_DIRECTORY_OVERRIDES = {
  root_patterns: [
    '**/core/**', '**/schema/**', '**/schemas/**',
    '**/models/**', '**/model/**',
    '**/config/**', '**/conf/**', '**/settings/**',
    '**/migrations/**',
    '**/routing/**', '**/router/**', '**/urls/**',
    '**/middleware/**',
    '**/lib/**', '**/src/lib/**',
    '**/app/**', '**/apps/**',
    '**/base/**', '**/foundation/**',
    '**/types/**', '**/interfaces/**',
    '**/db/**', '**/database/**',
    '**/auth/**', '**/security/**',
    '**/dispatch/**', '**/signals/**',
  ],
  leaf_patterns: [
    '**/test/**', '**/tests/**', '**/__tests__/**',
    '**/scripts/**', '**/examples/**',
    '**/fixtures/**', '**/mocks/**',
    '**/docs/**', '**/benchmarks/**',
    '**/contrib/*/tests/**',
  ],
} as const;

/** Default scan exclusions. */
export const DEFAULT_SCAN_EXCLUDE = [
  'node_modules', '.git', 'dist', 'build', 'vendor',
] as const;

const SignalsSchema = z.object({
  in_degree_weight: z.number().min(0).max(1),
  schema_bonus: z.number().min(0).max(1),
  churn_penalty_weight: z.number().min(0).max(1),
  directory_heuristic_weight: z.number().min(0).max(1),
  out_degree_penalty_weight: z.number().min(0).max(1),
});

const ThresholdsSchema = z.object({
  root: z.number().min(0).max(1),
  derived_upper: z.number().min(0).max(1),
  derived_lower: z.number().min(0).max(1),
  leaf: z.number().min(0).max(1),
});

const DirectoryOverridesSchema = z.object({
  root_patterns: z.array(z.string()),
  leaf_patterns: z.array(z.string()),
});

const AuthorityConfigSchema = z.object({
  thresholds: ThresholdsSchema,
  signals: SignalsSchema,
  directory_overrides: DirectoryOverridesSchema,
});

const GuardConfigSchema = z.object({
  require_human_above: z.number().min(0).max(1),
  warn_above: z.number().min(0).max(1),
});

const ScanConfigSchema = z.object({
  exclude: z.array(z.string()),
  max_file_size_kb: z.number().positive(),
});

const ConfigSchema = z.object({
  authority: AuthorityConfigSchema,
  guard: GuardConfigSchema,
  scan: ScanConfigSchema,
});

export type CodeBrainConfig = z.infer<typeof ConfigSchema>;

/** Build a complete config by merging partial user input over defaults. */
function buildDefaults(): CodeBrainConfig {
  return {
    authority: {
      thresholds: { ...DEFAULT_THRESHOLDS },
      signals: { ...DEFAULT_SIGNALS },
      directory_overrides: {
        root_patterns: [...DEFAULT_DIRECTORY_OVERRIDES.root_patterns],
        leaf_patterns: [...DEFAULT_DIRECTORY_OVERRIDES.leaf_patterns],
      },
    },
    guard: {
      require_human_above: 0.7,
      warn_above: 0.3,
    },
    scan: {
      exclude: [...DEFAULT_SCAN_EXCLUDE],
      max_file_size_kb: 500,
    },
  };
}

/** Deep merge source into target, returning a new object. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv && typeof sv === 'object' && !Array.isArray(sv) &&
      tv && typeof tv === 'object' && !Array.isArray(tv)
    ) {
      result[key] = deepMerge(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>,
      );
    } else {
      result[key] = sv;
    }
  }
  return result;
}

/**
 * Load CodeBrain configuration from .codebrain/config.json.
 * Falls back to defaults if the file doesn't exist.
 * Throws with an actionable message if the file is invalid.
 */
export function loadConfig(repoRoot: string): CodeBrainConfig {
  const defaults = buildDefaults();
  const configPath = join(repoRoot, '.codebrain', 'config.json');

  if (!existsSync(configPath)) {
    logger.debug('No .codebrain/config.json found, using defaults', {
      path: configPath,
    });
    return defaults;
  }

  let raw: unknown;
  try {
    const content = readFileSync(configPath, 'utf-8');
    raw = JSON.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to read .codebrain/config.json: ${message}. ` +
      `Ensure the file contains valid JSON.`,
    );
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error(
      'Invalid .codebrain/config.json: expected a JSON object.',
    );
  }

  const merged = deepMerge(
    defaults as unknown as Record<string, unknown>,
    raw as Record<string, unknown>,
  );

  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid .codebrain/config.json:\n${issues}\n` +
      `See https://github.com/whitepaper27/codebrain#configuration for the schema.`,
    );
  }

  logger.info('Loaded configuration', { path: configPath });
  return result.data;
}
