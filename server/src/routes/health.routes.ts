import { Router } from 'express';

import { buildHealth } from '../services/health.service';

export const healthRouter = Router();

/**
 * Powers the app's Status tab, which polls this every 5s.
 *
 * Never cached: the whole point is to show the current breaker state and cache
 * counters, so a cached health report would be worse than none.
 */
healthRouter.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(buildHealth(process.env.npm_package_version ?? '1.0.0'));
});
