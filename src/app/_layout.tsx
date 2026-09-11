import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { createQueryClient } from '@/api/query-client';
import { Colors } from '@/constants/theme';
import { ThemePreferenceProvider, useThemePreference } from '@/providers/theme-preference';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // One client per app instance, never module scope: the static web export
  // prerenders every route in the same Node process.
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemePreferenceProvider>
      <QueryClientProvider client={queryClient}>
        <RootNavigator />
      </QueryClientProvider>
    </ThemePreferenceProvider>
  );
}

function RootNavigator() {
  const { scheme, ready } = useThemePreference();
  const colors = Colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  // preventAutoHideAsync() above means nothing hides the splash but this call.
  // Hold it only until the saved theme is read (a local read that settles on
  // success *or* failure), so the first frame is never the wrong theme — and
  // never hold it behind a network request.
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

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
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="movie/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
      </Stack>
    </ThemeProvider>
  );
}
