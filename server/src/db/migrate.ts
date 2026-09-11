import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from '../logger';
import { db } from './client';

/**
 * Applies any pending migrations at boot.
 *
 * The generated SQL in ./drizzle is committed, so this needs no drizzle-kit at
 * runtime and a fresh clone bootstraps on the first `npm run dev`. `migrate()`
 * tracks what it has applied in its own table, so running it every boot is
 * idempotent and cheap.
 */
export function runMigrations(): void {
  // Resolved from this file, not process.cwd(), so the server works regardless
  // of the directory it was launched from (npm --prefix, an IDE, a tunnel).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(here, '../../drizzle');

  try {
    migrate(db, { migrationsFolder });
    logger.info('Database ready', { migrationsFolder });
  } catch (error) {
    logger.error(
      'Migration failed. If you changed src/db/schema.ts, run `npm run db:generate` ' +
        'in server/ and commit the generated SQL.',
      { error: String(error) },
    );
    throw error;
  }
}
