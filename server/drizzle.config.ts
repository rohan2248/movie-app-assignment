import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Used only by `npm run db:generate` and `npm run db:studio`.
 *
 * drizzle-kit is a devDependency and is never loaded at runtime: the server
 * applies the already-generated SQL files in ./drizzle via `migrate()`, so a
 * fresh clone bootstraps its database without it.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? './data/movies.db',
  },
  strict: true,
  verbose: true,
});
