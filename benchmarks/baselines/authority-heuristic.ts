/**
 * Shared authority heuristic for CodeAuthorityBench baselines.
 * Estimates structural authority from file path and content signals.
 * Used by both the CodeBrain baseline and the BM25+Rerank baseline.
 */

/**
 * Framework-specific high-authority filename patterns.
 * These files are typically central to application behavior.
 */
const FRAMEWORK_AUTHORITY_PATTERNS: RegExp[] = [
  /\bapplication\.(js|ts|py|rb)$/i,
  /\bsettings\.py$/i,
  /\bconfig\.(js|ts|py|rb)$/i,
  /\bmodels\/base\.(py|ts|js)$/i,
  /\b__init__\.py$/,
  /\brouter\/index\.(js|ts)$/i,
  /\broutes\/index\.(js|ts)$/i,
  /\bapp\.(js|ts|py)$/i,
  /\bserver\.(js|ts|py)$/i,
  /\bmanage\.py$/i,
  /\burls\.py$/i,
  /\bwsgi\.py$/i,
  /\basgi\.py$/i,
];

/**
 * Pre-computed import index for a set of files.
 * Maps each file stem to the count of files that import it.
 * Computed once per repo, reused across all authority queries.
 */
let cachedImportIndex: Map<string, number> | null = null;
let cachedFilesKey: string | null = null;

/** Build import index: for each file, count how many other files reference it. */
function buildImportIndex(allFiles: Map<string, string>): Map<string, number> {
  const counts = new Map<string, number>();

  // Collect all file stems
  const stems = new Map<string, string>();
  for (const filePath of allFiles.keys()) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const filename = parts[parts.length - 1] ?? '';
    const stem = filename.replace(/\.[^.]+$/, '');
    if (stem) stems.set(filePath, stem);
  }

  // For each file's content, find which stems it references
  for (const [, content] of allFiles) {
    const matched = new Set<string>();
    for (const [targetPath, stem] of stems) {
      if (matched.has(targetPath)) continue;
      if (content.includes(stem)) {
        matched.add(targetPath);
      }
    }
    for (const targetPath of matched) {
      counts.set(targetPath, (counts.get(targetPath) ?? 0) + 1);
    }
  }

  return counts;
}

/** Get or build the import index (cached per unique file set). */
function getImportIndex(allFiles: Map<string, string>): Map<string, number> {
  const key = allFiles.size + ':' + [...allFiles.keys()].slice(0, 3).join(',');
  if (cachedImportIndex && cachedFilesKey === key) {
    return cachedImportIndex;
  }
  cachedImportIndex = buildImportIndex(allFiles);
  cachedFilesKey = key;
  return cachedImportIndex;
}

/**
 * Configuration for which authority signals to enable.
 * Used by the ablation runner to test individual signal contributions.
 */
export interface AuthorityConfig {
  /** Directory path signals (+0.2 core, -0.3 test). */
  useDirectory: boolean;
  /** Type/interface/class/struct/enum detection. */
  useSchema: boolean;
  /** Framework-specific filename patterns (app.ts, settings.py, etc.). */
  useFramework: boolean;
  /** Cross-file import analysis (how many files reference this one). */
  useCrossFile: boolean;
  /** Export/import density scoring. */
  useExportDensity: boolean;
}

/**
 * Default config: graph + schema signals only.
 * Ablation study showed graph+schema is the best-performing variant,
 * outperforming the full signal set (framework patterns and export
 * density add noise rather than signal).
 */
export const DEFAULT_AUTHORITY_CONFIG: AuthorityConfig = {
  useDirectory: false,
  useSchema: true,
  useFramework: false,
  useCrossFile: true,
  useExportDensity: false,
};

/**
 * Estimate authority from file content heuristics.
 *
 * @param filePath - Relative path of the file within the repo.
 * @param content - Full text content of the file.
 * @param allFiles - Optional map of all repo files for cross-file analysis.
 * @param config - Optional config to enable/disable individual signals (for ablation).
 * @returns Authority score between 0.0 and 1.0.
 */
export function authorityHeuristic(
  filePath: string,
  content: string,
  allFiles?: Map<string, string>,
  config?: AuthorityConfig,
): number {
  const cfg = config ?? DEFAULT_AUTHORITY_CONFIG;
  let score = 0.5;
  const path = filePath.toLowerCase();

  // Directory signals
  if (cfg.useDirectory) {
    if (/\/(core|schema|models?|types?|config|conf|migrations?|domain|contracts?)\//.test(path)) {
      score += 0.2;
    }
    if (/\/(test|tests|__tests__|spec|scripts?|examples?|fixtures?)\//.test(path)) {
      score -= 0.3;
    }
    if (/\.(test|spec)\.[a-z]+$/.test(path)) {
      score -= 0.3;
    }
  }

  // Framework-specific filename patterns
  if (cfg.useFramework) {
    for (const pattern of FRAMEWORK_AUTHORITY_PATTERNS) {
      if (pattern.test(path)) {
        score += 0.15;
        break;
      }
    }
  }

  // Content: type/interface/schema definitions
  if (cfg.useSchema) {
    const schemaCount = countPatterns(content, [
      /\binterface\s+\w+/g,
      /\btype\s+\w+\s*=/g,
      /\bclass\s+\w+/g,
      /\bstruct\s+\w+/g,
      /\benum\s+\w+/g,
    ]);
    if (schemaCount > 0) {
      score += Math.min(schemaCount * 0.05, 0.15);
    }

    // Base class / abstract class detection
    if (/\b(abstract\s+class|class\s+Base\w*|class\s+Abstract\w*)\b/.test(content)) {
      score += 0.15;
    }
  }

  // Export density
  if (cfg.useExportDensity) {
    const exportCount = (content.match(/\bexport\b/g) ?? []).length;
    if (exportCount > 8) score += 0.2;
    else if (exportCount > 3) score += 0.1;

    // Import density (consumers score lower)
    const importCount = (content.match(/\bimport\b/g) ?? []).length;
    if (importCount > 10) score -= 0.15;
    else if (importCount > 5) score -= 0.1;
  }

  // Cross-file analysis (cached, O(1) lookup)
  if (cfg.useCrossFile && allFiles) {
    const importIndex = getImportIndex(allFiles);
    const importedByCount = importIndex.get(filePath) ?? 0;
    if (importedByCount > 10) score += 0.25;
    else if (importedByCount > 5) score += 0.15;
    else if (importedByCount > 2) score += 0.08;
  }

  return Math.max(0, Math.min(1, score));
}

/** Count total matches across multiple patterns. */
function countPatterns(text: string, patterns: RegExp[]): number {
  let total = 0;
  for (const p of patterns) {
    const m = text.match(p);
    if (m) total += m.length;
  }
  return total;
}
