import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useSystemColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    // A genuine one-time effect, not a derived-state shortcut: the static web
    // export prerenders in Node, where there is no OS colour scheme, so the
    // server and the client's first paint must both say 'light' or React
    // flags a hydration mismatch. Flipping this only after mount is what lets
    // the *second* client render safely diverge from the prerendered markup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
