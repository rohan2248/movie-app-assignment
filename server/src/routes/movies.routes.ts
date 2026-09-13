import { Router } from 'express';

import type { GenreListResponse } from '@shared/api-types';

import { badRequest } from '../http/errors';
import { asyncHandler } from '../http/middleware';
import { baseMeta } from '../services/dto';
import { getGenres } from '../services/genres.service';
import { getMovieDetail, getMovieList } from '../services/movies.service';
import { movieIdParamSchema, movieListQuerySchema } from '../validation/request-schemas';

export const moviesRouter = Router();
export const genresRouter = Router();

/**
 * These responses were briefly cacheable by the client (`max-age` 60s for
 * lists, 300s for details, 3600s for genres). That was wrong, and only visible
 * on web: the browser's own HTTP cache sits *above* this server's L1/L2 cache
 * and answers without asking, so
 *
 *   - flipping a fault mode changed nothing on screen for up to an hour, since
 *     the request that would have seen the fault was never made;
 *   - the `degraded ? 'no-store'` guard could not help, because the response
 *     already stored was the healthy one;
 *   - `meta` — this API's honesty channel, reporting `source`, `degraded` and
 *     `requestId` per response — was served from a body minutes old.
 *
 * Caching belongs to the layer that can report what it did. `no-store` costs
 * one round trip that an L1 hit answers in ~1-2ms, and in exchange the client
 * always sees the true current state. (A public deployment behind a CDN could
 * reintroduce shared caching, but then `meta` becomes advisory rather than a
 * fact about the response in hand.)
 */
const NO_CLIENT_CACHE = 'no-store';

/**
 * Browse and search share one endpoint; the presence of `query` selects the
 * mode. Two endpoints would have duplicated the client's infinite-scroll hook,
 * its cache namespace and the grid wiring in order to express the same list.
 */
moviesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = movieListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest('Invalid query parameters.', parsed.error.issues);
    }

    const result = await getMovieList(parsed.data, req.ctx.id);

    // Mirror what happened into the request context so one log line per
    // request shows cache source and upstream cost.
    req.ctx.cacheSource = result.meta.source;
    req.ctx.degraded = result.meta.degraded;

    res.setHeader('Cache-Control', NO_CLIENT_CACHE);
    res.json(result);
  }),
);

moviesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = movieIdParamSchema.safeParse(req.params);
    if (!parsed.success) throw badRequest('Invalid movie id.');

    const result = await getMovieDetail(parsed.data.id, req.ctx.id);

    req.ctx.cacheSource = result.meta.source;
    req.ctx.degraded = result.meta.degraded;

    res.setHeader('Cache-Control', NO_CLIENT_CACHE);
    res.json(result);
  }),
);

genresRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await getGenres();

    req.ctx.cacheSource = result.source;
    req.ctx.degraded = result.degraded;

    const body: GenreListResponse = {
      items: result.items,
      meta: baseMeta(req.ctx.id, {
        source: result.source,
        degraded: result.degraded,
        upstreamStatus: result.degraded ? 'unavailable' : 'ok',
        notes: result.degraded ? ['Showing a saved genre list.'] : [],
      }),
    };

    res.setHeader('Cache-Control', NO_CLIENT_CACHE);
    res.json(body);
  }),
);
