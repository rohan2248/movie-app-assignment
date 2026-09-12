import type {
  MovieSummary,
  WishlistItemResponse,
  WishlistResponse,
} from '@shared/api-types';

import { apiFetch } from '@/api/client';

/**
 * Wishlist endpoints. These are the only requests that carry an identity.
 *
 * `meta` is dropped here on purpose: the wishlist is served from our own
 * database with `Cache-Control: no-store`, so it has no upstream resilience
 * story to report, and a bare `WishlistEntry[]` is exactly what the on-device
 * mirror stores — the cache, the mirror and the screen all hold one shape.
 */

function deviceHeaders(deviceId: string) {
  return { 'x-device-id': deviceId };
}

export async function fetchWishlist(deviceId: string, signal?: AbortSignal) {
  const response = await apiFetch<WishlistResponse>('/api/wishlist', {
    signal,
    headers: deviceHeaders(deviceId),
  });
  return response.items;
}

/**
 * The summary is posted alongside the id so the server can snapshot the movie
 * without an upstream call — which is what lets a movie be wishlisted while
 * TMDB is down.
 */
export async function addWishlistItem(deviceId: string, movie: MovieSummary) {
  const response = await apiFetch<WishlistItemResponse>('/api/wishlist', {
    method: 'POST',
    headers: deviceHeaders(deviceId),
    body: { movieId: movie.id, movie },
  });
  return response.item;
}

export function removeWishlistItem(deviceId: string, movieId: number) {
  return apiFetch<void>(`/api/wishlist/${movieId}`, {
    method: 'DELETE',
    headers: deviceHeaders(deviceId),
  });
}
