import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, setLogLevel, setJsonMode } from '../../src/utils/logger.js';

describe('logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setLogLevel('debug');
    setJsonMode(false);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    setLogLevel('info');
    setJsonMode(false);
  });

  it('logs info messages', () => {
    logger.info('test message');
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('INFO');
    expect(output).toContain('test message');
  });

  it('respects log level filtering', () => {
    setLogLevel('warn');
    logger.debug('should not appear');
    logger.info('should not appear');
    expect(stderrSpy).not.toHaveBeenCalled();

    logger.warn('should appear');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('includes context in output', () => {
    logger.info('with context', { file: 'test.ts', count: 42 });
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('test.ts');
    expect(output).toContain('42');
  });

  it('outputs JSON when json mode is enabled', () => {
    setJsonMode(true);
    logger.info('json test', { key: 'value' });
    const output = stderrSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('json test');
    expect(parsed.context.key).toBe('value');
  });

  it('logs all levels', () => {
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(stderrSpy).toHaveBeenCalledTimes(4);
  });
});
