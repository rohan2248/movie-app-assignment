import { useThemePreference, type ResolvedScheme } from '@/providers/theme-preference';

/** The scheme to render with: the user's in-app choice, else the OS setting. */
export function useColorScheme(): ResolvedScheme {
  return useThemePreference().scheme;
}
