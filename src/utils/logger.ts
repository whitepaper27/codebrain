/**
 * Structured logger for CodeBrain.
 * All logging must go through this module — no console.log anywhere else.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  context?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';
let jsonMode = process.env['LOG_FORMAT'] === 'json';

/** Set the minimum log level. Messages below this level are suppressed. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Enable or disable JSON output mode. */
export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatEntry(entry: LogEntry): string {
  if (jsonMode) {
    return JSON.stringify(entry);
  }
  const prefix = `[${entry.timestamp}] ${entry.level.toUpperCase()}`;
  const ctx = entry.context
    ? ` ${JSON.stringify(entry.context)}`
    : '';
  return `${prefix}: ${entry.message}${ctx}`;
}

function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    context,
  };

  const output = formatEntry(entry);

  if (level === 'error') {
    process.stderr.write(output + '\n');
  } else {
    process.stderr.write(output + '\n');
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
};
