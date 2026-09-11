import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';

import { useSystemColorScheme } from '@/hooks/use-system-color-scheme';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = 'movieapp:theme-preference:v1';
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

type ThemePreferenceValue = {
  preference: ThemePreference;
  /** What is actually rendered: the preference, or the OS setting under 'system'. */
  scheme: ResolvedScheme;
  /** False until the stored preference has been read (or the read failed). */
  ready: boolean;
  setPreference: (next: ThemePreference) => void;
};

const ThemePreferenceContext = createContext<ThemePreferenceValue | null>(null);

function isPreference(value: unknown): value is ThemePreference {
  return PREFERENCES.includes(value as ThemePreference);
}

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const system = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);

  // Read in an effect, never at module scope: the static web export prerenders
  // in Node, where there is no storage.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isPreference(stored)) setPreferenceState(stored);
      })
      .catch(() => {
        // Unreadable storage just means "follow the system".
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // On native, also override the OS-level scheme so system chrome we don't
  // render (keyboard, alerts, date pickers) matches the app. Web has no
  // equivalent; there the context value alone drives rendering.
  useEffect(() => {
    if (process.env.EXPO_OS === 'web') return;
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Non-fatal: the choice still applies for this session.
    });
  }

  const scheme: ResolvedScheme =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  return (
    <ThemePreferenceContext value={{ preference, scheme, ready, setPreference }}>
      {children}
    </ThemePreferenceContext>
  );
}

export function useThemePreference(): ThemePreferenceValue {
  const value = use(ThemePreferenceContext);
  if (!value) throw new Error('useThemePreference must be used inside ThemePreferenceProvider');
  return value;
}
