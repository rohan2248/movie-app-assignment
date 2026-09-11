import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { env } from '../env';
import { logger } from '../logger';
import * as schema from './schema';

/**
 * Opens the database and hands the driver to Drizzle.
 *
 * Constructing better-sqlite3 ourselves (rather than letting Drizzle open it
 * from a path) is deliberate: pragmas must be set on the raw connection before
 * any query runs, and they materially change behaviour.
 *
 * Note on the pin: better-sqlite3 is native. `~12.11.1` is the newest version
 * publishing a prebuilt binary for this Node ABI (137) — 13.x ships none, so
 * installing it would fall back to node-gyp and fail on any machine without a
 * C++ toolchain and Python. See the README.
 */

const sqlite = (() => {
  mkdirSync(path.dirname(env.databaseAbsolutePath), { recursive: true });

  const connection = new Database(env.databaseAbsolutePath);

  // Concurrent readers alongside a writer, instead of readers blocking on it.
  connection.pragma('journal_mode = WAL');
  // Durable enough for a cache + wishlist; avoids an fsync per transaction.
  connection.pragma('synchronous = NORMAL');
  // Off by default in SQLite. Without this the wishlist -> movies foreign key
  // would be decorative, and the "no wishlist row without a snapshot"
  // guarantee would silently not hold.
  connection.pragma('foreign_keys = ON');
  // Wait rather than throw SQLITE_BUSY if a write overlaps the cache GC.
  connection.pragma('busy_timeout = 5000');

  return connection;
})();

export const db = drizzle({ client: sqlite, schema });

export type Db = typeof db;

/** Escape hatch for pragmas, VACUUM and the health row counts. */
export const rawSqlite = sqlite;

export function closeDb(): void {
  try {
    // Fold the WAL back into the main file so the .db is self-contained.
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    sqlite.close();
  } catch (error) {
    logger.warn('Failed to close database cleanly', { error: String(error) });
  }
}
