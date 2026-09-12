import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WishlistEntry } from '@shared/api-types';

/**
 * The on-device mirror of the server's wishlist.
 *
 * The server is the source of truth; this is a read cache with one job: the
 * Wishlist tab must be populated on the first frame after a cold start, with no
 * network and with the API stopped. It is written from a single query-cache
 * subscriber, so there is no second copy of the state to keep in step.
 */

const STORAGE_KEY = 'movieapp:wishlist:v1';

type Mirror = {
  /** Scoped to the device, so a regenerated id can never read a stale list. */
  deviceId: string;
  items: WishlistEntry[];
  savedAt: string;
};

/**
 * Storage is untrusted input like any other: an old app version, a partial
 * write or a hand-edited value must not crash the screen it feeds. Anything
 * unrecognizable is treated as "nothing cached".
 */
function isEntry(value: unknown): value is WishlistEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<WishlistEntry>;
  return (
    typeof entry.addedAt === 'string' &&
    typeof entry.movie === 'object' &&
    entry.movie !== null &&
    typeof entry.movie.id === 'number' &&
    typeof entry.movie.title === 'string'
  );
}

export async function readWishlistMirror(deviceId: string): Promise<WishlistEntry[] | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<Mirror>;
    if (parsed?.deviceId !== deviceId || !Array.isArray(parsed.items)) return null;

    // Bad rows are dropped rather than failing the whole read, exactly as the
    // server drops malformed upstream items.
    return parsed.items.filter(isEntry);
  } catch {
    return null;
  }
}

export async function writeWishlistMirror(
  deviceId: string,
  items: WishlistEntry[],
): Promise<void> {
  const mirror: Mirror = { deviceId, items, savedAt: new Date().toISOString() };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(mirror));
  } catch {
    // Non-fatal: the server still has the list.
  }
}
