import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The anonymous device id that *is* the user.
 *
 * There is no sign-in, so a wishlist belongs to a device. The id is generated
 * once, stored locally, and sent as `x-device-id` on wishlist requests only —
 * browsing never demands an identity.
 */

const STORAGE_KEY = 'movieapp:device-id:v1';

/** Must agree with DEVICE_ID_PATTERN in the server's middleware. */
const PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const LENGTH = 32;

/**
 * Base36 from `Date.now()` plus `Math.random()`, deliberately *not*
 * `crypto.randomUUID()`: the one code path that runs on first launch should not
 * depend on a global that may need a polyfill. Collisions don't matter here —
 * the id only has to be unique, not unguessable, since it grants access to
 * nothing but its own wishlist.
 */
export function createDeviceId(): string {
  let id = Date.now().toString(36);
  // Bounded rather than `while`: Math.random() can in principle return 0,
  // whose base36 slice is empty.
  for (let attempt = 0; attempt < 12 && id.length < LENGTH; attempt += 1) {
    id += Math.random().toString(36).slice(2);
  }
  return id.padEnd(LENGTH, '0').slice(0, LENGTH);
}

/**
 * Reads the stored id, creating and persisting one on first launch.
 *
 * Called from an async bootstrap in the root layout, never at module scope:
 * the static web export prerenders every route in Node, where there is no
 * storage. If storage is unreadable the caller still gets a usable id for this
 * session — the wishlist then works but does not survive a relaunch, which is
 * better than a screen that cannot load at all.
 */
export async function loadDeviceId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && PATTERN.test(stored)) return stored;
  } catch {
    // Fall through to a fresh id.
  }

  const created = createDeviceId();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, created);
  } catch {
    // Non-fatal: the id still identifies this session.
  }
  return created;
}
