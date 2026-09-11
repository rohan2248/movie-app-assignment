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

    // Clients may cache a page briefly; a degraded response must not be cached.
    res.setHeader(
      'Cache-Control',
      result.meta.degraded ? 'no-store' : 'public, max-age=60',
    );
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

    res.setHeader(
      'Cache-Control',
      result.meta.degraded ? 'no-store' : 'public, max-age=300',
    );
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

    res.setHeader('Cache-Control', result.degraded ? 'no-store' : 'public, max-age=3600');
    res.json(body);
  }),
);
