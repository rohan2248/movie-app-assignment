import Constants from 'expo-constants';

const API_PORT = 4000;

/**
 * Where the Express API lives, in priority order:
 *
 * 1. `EXPO_PUBLIC_API_URL` — an explicit override (deployed API, tunnel, other port).
 *    Must stay a literal dot-access: Metro only inlines `process.env.EXPO_PUBLIC_X`
 *    written exactly like this, so destructuring would silently yield undefined.
 * 2. Web: the host that served the page.
 * 3. Native: the host of the Expo dev server. A phone running Expo Go reached
 *    Metro at this address, so it can reach the API on the same machine too —
 *    this is what makes a physical device work with zero configuration.
 * 4. Android emulator loopback, then localhost.
 *
 * Resolved lazily, never at module scope: the static web export prerenders in
 * Node, where there is no `window`.
 */
function resolveApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  if (process.env.EXPO_OS === 'web') {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    return `http://${host || 'localhost'}:${API_PORT}`;
  }

  // e.g. "192.168.1.20:8081"
  const devServerHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (devServerHost) return `http://${devServerHost}:${API_PORT}`;

  if (process.env.EXPO_OS === 'android') return `http://10.0.2.2:${API_PORT}`;
  return `http://localhost:${API_PORT}`;
}

let cachedBaseUrl: string | null = null;

export function getApiBaseUrl(): string {
  cachedBaseUrl ??= resolveApiBaseUrl();
  return cachedBaseUrl;
}
