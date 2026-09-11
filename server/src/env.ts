import path from 'node:path';
import { z } from 'zod';

/**
 * Validated configuration.
 *
 * Config errors are the most common reason a reviewer's first `npm run dev`
 * fails, so a bad value must produce one actionable line naming the file and
 * the variable — never a stack trace from three modules deeper.
 */

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * In a .env file, `FOO=` means "I left this blank", not "set FOO to empty".
 * Zod's `.default()` and `.optional()` only trigger on `undefined`, so without
 * this the .env.example shipped with blank TMDB credentials would be a fatal
 * config error on a reviewer's very first run. Stripping blanks up front fixes
 * the whole class of problem rather than one field.
 */
function stripBlankValues(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    result[key] = value;
  }
  return result;
}

const EnvShape = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  /**
   * Both TMDB credential styles are optional on purpose. Missing credentials
   * are a *degraded* state, not a fatal one: the server still boots, the
   * wishlist still works from local snapshots, genres fall back to a hardcoded
   * list, and movie routes return a labelled 503 that names this file. An
   * empty grid looks like a bug; a labelled banner looks like a feature.
   */
  TMDB_ACCESS_TOKEN: z.string().trim().min(1).optional(),
  TMDB_API_KEY: z.string().trim().min(1).optional(),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:8081,http://localhost:19006')
    .transform(csv),

  DATABASE_PATH: z.string().trim().min(1).default('./data/movies.db'),

  /** Gates POST /api/debug/* entirely — the routes 404 when this is off. */
  ENABLE_FAULT_INJECTION: z
    .enum(['0', '1', 'true', 'false'])
    .default('0')
    .transform((value) => value === '1' || value === 'true'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const EnvSchema = z.preprocess(stripBlankValues, EnvShape);

export type Env = z.infer<typeof EnvShape> & {
  /** True when at least one TMDB credential is present. */
  tmdbConfigured: boolean;
  /** Absolute, so the DB path never depends on the process working directory. */
  databaseAbsolutePath: string;
};

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    console.error(
      `\nInvalid server configuration in server/.env:\n${issues}\n\n` +
        `Copy server/.env.example to server/.env and correct the values above.\n`,
    );
    process.exit(1);
  }

  const env = parsed.data;

  return {
    ...env,
    tmdbConfigured: Boolean(env.TMDB_ACCESS_TOKEN || env.TMDB_API_KEY),
    databaseAbsolutePath: path.resolve(process.cwd(), env.DATABASE_PATH),
  };
}

export const env = loadEnv();

/**
 * Strip credentials from any string before it reaches a log, an error message
 * or an HTTP response. Applied in the logger and in the TMDB client's error
 * paths, because a leaked key in a stack trace is still a leaked key.
 */
export function redact(input: string): string {
  let output = input.replace(/([?&]api_key=)[^&\s]+/gi, '$1[REDACTED]');
  output = output.replace(/(Bearer\s+)[\w.-]+/gi, '$1[REDACTED]');

  for (const secret of [env.TMDB_ACCESS_TOKEN, env.TMDB_API_KEY]) {
    if (secret && secret.length >= 8) {
      output = output.split(secret).join('[REDACTED]');
    }
  }

  return output;
}
