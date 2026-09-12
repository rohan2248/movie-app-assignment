import type { WishlistEntry } from '@shared/api-types';
import { hashKey, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';

import { wishlistKeys } from '@/api/query-keys';
import { loadDeviceId } from '@/lib/device-id';
import { readWishlistMirror, writeWishlistMirror } from '@/lib/wishlist-mirror';

/** Long enough to coalesce a burst of toggles, short enough to survive a kill. */
const MIRROR_WRITE_DEBOUNCE_MS = 300;
/** A failed toggle explains itself, then gets out of the way. */
const ERROR_VISIBLE_MS = 6000;

type WishlistContextValue = {
  /** `null` until the stored id has been read. */
  deviceId: string | null;
  /** True once the id and the mirror have been read — success *or* failure. */
  ready: boolean;
  /** The last failed toggle, for screens to surface as a banner. */
  lastError: unknown;
  reportError: (error: unknown) => void;
  clearError: () => void;
};

const WishlistContext = createContext<WishlistContextValue | null>(null);

/**
 * Owns the wishlist's identity and its durability.
 *
 * Three jobs, in order: read the device id, seed the query cache from the
 * on-device mirror so the Wishlist tab is populated on the first frame (with no
 * network, and with the API stopped), then keep the mirror in step by watching
 * the one cache entry that holds the list. There is no second store — the query
 * cache is the state, and this writes it through.
 */
export function WishlistProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [lastError, setLastError] = useState<unknown>(null);

  // In an effect, never at module scope: the static web export prerenders every
  // route in Node, where there is no storage.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const id = await loadDeviceId();
      const cached = await readWishlistMirror(id);
      if (cancelled) return;

      // Seeded before the id reaches state, so the first render of any
      // wishlist query already observes data instead of a pending fetch.
      //
      // `updatedAt: 1` backdates the entry past any staleTime, which matters:
      // seeded as fresh, the query would skip its refetch-on-mount entirely and
      // the app would show a possibly hours-old list without ever trying the
      // server — and without being able to say so. Stale means the list is on
      // screen immediately *and* reconciled, and a failure to reconcile is
      // visible as the "saved copy" banner.
      if (cached) {
        queryClient.setQueryData<WishlistEntry[]>(wishlistKeys.list(id), cached, { updatedAt: 1 });
      }
      setDeviceId(id);
    }

    bootstrap()
      .catch(() => {
        // An unreadable store is not a reason to hold the splash screen: the
        // wishlist will simply start empty and load from the server.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  // Write-through. One subscriber on the cache, rather than a save call at
  // every mutation site, so optimistic patches, server reconciliations and
  // rollbacks are all mirrored by the same code path.
  useEffect(() => {
    if (deviceId === null) return;

    const queryHash = hashKey(wishlistKeys.list(deviceId));
    let timer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.query.queryHash !== queryHash) return;

      const data = event.query.state.data;
      // Only ever mirror real data. An error state leaves the previous mirror
      // in place, which is exactly what the next cold start needs.
      if (!Array.isArray(data)) return;

      const items = data as WishlistEntry[];
      clearTimeout(timer);
      timer = setTimeout(() => void writeWishlistMirror(deviceId, items), MIRROR_WRITE_DEBOUNCE_MS);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [deviceId, queryClient]);

  const clearError = useCallback(() => setLastError(null), []);
  const reportError = useCallback((error: unknown) => setLastError(error), []);

  useEffect(() => {
    if (lastError === null) return;
    const timer = setTimeout(() => setLastError(null), ERROR_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [lastError]);

  return (
    <WishlistContext value={{ deviceId, ready, lastError, reportError, clearError }}>
      {children}
    </WishlistContext>
  );
}

export function useWishlistContext(): WishlistContextValue {
  const value = use(WishlistContext);
  if (!value) throw new Error('useWishlistContext must be used inside WishlistProvider');
  return value;
}
