import type { MovieSummary, WishlistEntry } from '@shared/api-types';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { addWishlistItem, fetchWishlist, removeWishlistItem } from '@/api/wishlist';
import { wishlistKeys } from '@/api/query-keys';
import { hapticError, hapticToggle } from '@/lib/haptics';
import { useWishlistContext } from '@/providers/wishlist-provider';

/**
 * One query holds the wishlist, and everything else is derived from it: the
 * Wishlist screen renders its entries, the hearts read an id Set out of the
 * same cache entry, and the on-device mirror is written from it. The server
 * also exposes `/api/wishlist/ids` for cheap heart state, but a user-curated
 * list is small enough that a second source would buy nothing and could
 * disagree with the first — so the ids come from the entries we already hold.
 */

/**
 * `gcTime: Infinity` because this entry is the hydrated mirror. If it were
 * garbage-collected while the user is offline, the Wishlist tab would go empty
 * with no way to refill it.
 */
function wishlistQuery(deviceId: string) {
  return queryOptions({
    queryKey: wishlistKeys.list(deviceId),
    queryFn: ({ signal }) => fetchWishlist(deviceId, signal),
    staleTime: 30_000,
    gcTime: Infinity,
  });
}

const EMPTY_ENTRIES: WishlistEntry[] = [];
const EMPTY_IDS: ReadonlySet<number> = new Set();

// Module scope so React Query can memoize the selected value: a new Set on
// every render would re-render every heart on the screen.
function toIdSet(items: WishlistEntry[]): ReadonlySet<number> {
  return new Set(items.map((entry) => entry.movie.id));
}

/** The full list, for the Wishlist screen. */
export function useWishlistEntries() {
  const { deviceId } = useWishlistContext();
  const query = useQuery({ ...wishlistQuery(deviceId ?? ''), enabled: deviceId !== null });
  return { ...query, entries: query.data ?? EMPTY_ENTRIES };
}

/** Heart state for the grid and the detail screen. */
export function useWishlistIds(): ReadonlySet<number> {
  const { deviceId } = useWishlistContext();
  const { data } = useQuery({
    ...wishlistQuery(deviceId ?? ''),
    enabled: deviceId !== null,
    select: toIdSet,
  });
  return data ?? EMPTY_IDS;
}

type ToggleVariables = { movie: MovieSummary; next: boolean };

/**
 * The optimistic toggle every heart shares.
 *
 * `scope` makes React Query run wishlist mutations one at a time, so a rapid
 * double-tap cannot interleave two snapshot/patch cycles and leave the cache
 * holding the earlier of the two intents.
 */
export function useWishlistToggle() {
  const queryClient = useQueryClient();
  const { deviceId, reportError } = useWishlistContext();
  const key = wishlistKeys.list(deviceId ?? '');

  const mutation = useMutation({
    scope: { id: 'wishlist' },
    // The response is discarded: `onSettled` invalidates, so the server's own
    // ordering and `addedAt` arrive through the list query rather than being
    // spliced in here.
    mutationFn: async ({ movie, next }: ToggleVariables): Promise<void> => {
      if (deviceId === null) throw new Error('Wishlist is not ready yet.');
      if (next) await addWishlistItem(deviceId, movie);
      else await removeWishlistItem(deviceId, movie.id);
    },

    onMutate: async ({ movie, next }): Promise<{ previous: WishlistEntry[] }> => {
      // Fires with the optimistic patch, not with the server's reply: the tap
      // should feel answered immediately, and it is immediately true on screen.
      hapticToggle();

      // An in-flight GET would otherwise land after this patch and undo it.
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<WishlistEntry[]>(key) ?? EMPTY_ENTRIES;

      const without = previous.filter((entry) => entry.movie.id !== movie.id);
      // Newest first, matching the server's `added_at DESC`.
      const optimistic = next
        ? [{ movie, addedAt: new Date().toISOString() }, ...without]
        : without;

      queryClient.setQueryData<WishlistEntry[]>(key, optimistic);
      return { previous };
    },

    onError: (error, _variables, context) => {
      if (context) queryClient.setQueryData<WishlistEntry[]>(key, context.previous);
      reportError(error);
      // The heart just moved back on its own; the buzz explains why.
      hapticError();
    },

    // Reconcile with the server's ordering and its real `addedAt`. Harmless
    // when offline: the refetch fails and the rolled-back cache stands.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
    },
  });

  return {
    toggle: (movie: MovieSummary, next: boolean) => mutation.mutate({ movie, next }),
    /** False until the device id has been read; hearts stay disabled that long. */
    enabled: deviceId !== null,
    isPending: mutation.isPending,
  };
}
