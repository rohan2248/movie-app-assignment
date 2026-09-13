import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { createQueryClient } from '@/api/query-client';
import { Colors } from '@/constants/theme';
import { ThemePreferenceProvider, useThemePreference } from '@/providers/theme-preference';
import { WishlistProvider, useWishlistContext } from '@/providers/wishlist-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // One client per app instance, never module scope: the static web export
  // prerenders every route in the same Node process.
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemePreferenceProvider>
      <QueryClientProvider client={queryClient}>
        {/* Inside the query client: its whole job is to seed and mirror one
            cache entry. */}
        <WishlistProvider>
          <RootNavigator />
        </WishlistProvider>
      </QueryClientProvider>
    </ThemePreferenceProvider>
  );
}

function RootNavigator() {
  const { scheme, ready: themeReady } = useThemePreference();
  const { ready: wishlistReady } = useWishlistContext();
  const colors = Colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  // preventAutoHideAsync() above means nothing hides the splash but this call.
  // Held only for the two local reads — the saved theme and the device id plus
  // wishlist mirror — each of which settles on success *or* failure. So the
  // first frame is never the wrong theme and never an empty wishlist, and the
  // splash is never waiting on the network.
  const ready = themeReady && wishlistReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // The root view sits behind the navigator and shows through while a screen
  // slides in or out. Left at the Android default it is white, which flashes
  // against the dark theme. Runtime call rather than app.json: the theme is
  // user-switchable, and this is the only path that also works in Expo Go.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          primary: colors.accent,
          background: colors.background,
          card: colors.background,
          text: colors.text,
          border: colors.border,
        },
      }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          // The navigator paints this before the screen's own ScrollView lays
          // out, so it is what the push/pop actually slides over.
          contentStyle: { backgroundColor: colors.background },
          // iOS keeps 'default' so the interactive edge-swipe back is untouched.
          animation: process.env.EXPO_OS === 'android' ? 'slide_from_right' : 'default',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="movie/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
      </Stack>
    </ThemeProvider>
  );
}
