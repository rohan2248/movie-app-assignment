import { Router } from 'express';

import { badRequest } from '../http/errors';
import { logger } from '../logger';
import * as cache from '../resilience/cache';
import { resetMetrics } from '../resilience/metrics';
import { breakerControl, faultStats, limiterStats, tmdbStats } from '../tmdb/tmdb-client';
import { setFaultState } from '../tmdb/fault-injection';
import { breakerSchema, cacheClearSchema, faultSchema } from '../validation/request-schemas';

/**
 * Demo and debugging controls.
 *
 * Mounted **only** when ENABLE_FAULT_INJECTION is set, so in any other
 * configuration these paths 404 exactly like an unknown route — there is no
 * endpoint to discover and no behaviour to abuse.
 *
 * These exist because the resilience requirements are otherwise impossible to
 * demonstrate on demand: you cannot ask TMDB to start failing.
 */
export const debugRouter = Router();

debugRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/** Switches the injected upstream behaviour. */
debugRouter.post('/fault', (req, res) => {
  const parsed = faultSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid fault payload.', parsed.error.issues);

  const state = setFaultState(parsed.data);
  res.json({ faultInjection: { enabled: true, ...state } });
});

/** Forces a genuinely cold path, for honest before/after latency comparison. */
debugRouter.post('/cache/clear', (req, res) => {
  const parsed = cacheClearSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Invalid payload.', parsed.error.issues);

  const cleared = cache.clear(parsed.data.namespace);
  logger.warn('Cache cleared via debug endpoint', {
    namespace: parsed.data.namespace ?? 'all',
    cleared,
  });
  res.json({ cleared, namespace: parsed.data.namespace ?? 'all' });
});

/** Trips or resets the breaker without waiting for real failures. */
debugRouter.post('/breaker', (req, res) => {
  const parsed = breakerSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid payload.', parsed.error.issues);

  if (parsed.data.action === 'open') breakerControl.open();
  else breakerControl.close();

  res.json({ breaker: tmdbStats() });
});

debugRouter.post('/metrics/reset', (_req, res) => {
  resetMetrics();
  res.json({ reset: true });
});

/** Deeper internals than /api/health exposes, for diagnosis. */
debugRouter.get('/state', (_req, res) => {
  res.json({
    tmdb: tmdbStats(),
    limiter: limiterStats(),
    fault: faultStats(),
    cache: cache.stats(),
  });
});
