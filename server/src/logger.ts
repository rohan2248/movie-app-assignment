import { env, redact } from './env';

/**
 * A ~40-line logger instead of pino.
 *
 * The only consumer is a human reading a terminal during a demo, and every log
 * line passes through `redact()` so a TMDB key can never appear in output —
 * which is easier to guarantee here than through a library's serializers.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

const threshold = LEVELS[env.LOG_LEVEL];

function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;

  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), message];

  if (fields) {
    const rendered = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    if (rendered) parts.push(rendered);
  }

  const line = redact(parts.join(' '));

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};

/** Formats an unknown throwable for logging without leaking a full stack by default. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` <- ${error.cause.message}` : '';
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}
