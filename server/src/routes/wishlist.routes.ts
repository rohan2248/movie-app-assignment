import { Router } from 'express';

import type {
  WishlistIdsResponse,
  WishlistItemResponse,
  WishlistResponse,
  WishlistSyncResponse,
} from '@shared/api-types';

import { badRequest } from '../http/errors';
import { asyncHandler, requireDeviceId } from '../http/middleware';
import { baseMeta } from '../services/dto';
import * as wishlistService from '../services/wishlist.service';
import {
  wishlistAddSchema,
  wishlistMovieIdParamSchema,
  wishlistSyncSchema,
} from '../validation/request-schemas';

export const wishlistRouter = Router();

// Identity is required for every route here, but nowhere else in the API:
// browsing must never demand it.
wishlistRouter.use(requireDeviceId);

// The wishlist is user state, not cacheable content.
wishlistRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

wishlistRouter.get('/', (req, res) => {
  const deviceId = req.ctx.deviceId!;
  const items = wishlistService.getWishlist(deviceId);

  const body: WishlistResponse = {
    items,
    count: items.length,
    meta: baseMeta(req.ctx.id, { source: 'live', notes: [] }),
  };
  res.json(body);
});

/** Ids only — the grid needs ~200 heart states, not 200 payloads. */
wishlistRouter.get('/ids', (req, res) => {
  const body: WishlistIdsResponse = {
    ids: wishlistService.getWishlistIds(req.ctx.deviceId!),
  };
  res.json(body);
});

wishlistRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = wishlistAddSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid wishlist payload.', parsed.error.issues);
    }

    const { movieId, movie } = parsed.data;
    const { entry, created } = await wishlistService.addToWishlist(
      req.ctx.deviceId!,
      movieId,
      movie,
    );

    // 200 rather than 201 when it was already there, so a double-tap or a
    // retried request is a success instead of a duplicate-key error.
    const body: WishlistItemResponse = { item: entry };
    res.status(created ? 201 : 200).json(body);
  }),
);

wishlistRouter.delete('/:movieId', (req, res) => {
  const parsed = wishlistMovieIdParamSchema.safeParse(req.params);
  if (!parsed.success) throw badRequest('Invalid movie id.');

  wishlistService.removeFromWishlist(req.ctx.deviceId!, parsed.data.movieId);

  // 204 whether or not a row existed: the client's intent is "not in my list",
  // and that is now true either way.
  res.status(204).end();
});

/** Flushes a client's offline queue in one round trip. */
wishlistRouter.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const parsed = wishlistSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid sync payload.', parsed.error.issues);
    }

    const result = await wishlistService.syncWishlist(req.ctx.deviceId!, parsed.data.ops);
    const body: WishlistSyncResponse = result;
    res.json(body);
  }),
);
