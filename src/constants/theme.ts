/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    // App tokens. Add every key to BOTH schemes: ThemeColor is the
    // intersection of the two key sets, so a one-sided key silently vanishes.
    accent: '#0B63CE',
    accentContrast: '#ffffff',
    border: '#E0E1E6',
    posterPlaceholder: '#E8E9ED',
    rating: '#B7791F',
    danger: '#D92D20',
    warning: '#B54708',
    success: '#067647',
    overlay: 'rgba(0, 0, 0, 0.45)',
    skeleton: '#E8E9ED',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    accent: '#5FA8FF',
    accentContrast: '#00122B',
    border: '#2E3135',
    posterPlaceholder: '#1A1B1E',
    rating: '#F5C451',
    danger: '#F97066',
    warning: '#FDB022',
    success: '#47CD89',
    overlay: 'rgba(0, 0, 0, 0.6)',
    skeleton: '#1F2023',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
/** Text measure: detail overview, empty and error states. */
export const MaxContentWidth = 800;
/** Grid measure: the poster grid may run wider than a comfortable line of text. */
export const MaxGridWidth = 1400;
/** Columns are derived from this target width, not from device breakpoints. */
export const TargetCardWidth = 168;
/** Below this width the tab bar sits at the bottom; at or above it becomes a sidebar. */
export const SidebarBreakpoint = 900;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const PosterAspectRatio = 2 / 3;
export const BackdropAspectRatio = 16 / 9;

export const Durations = {
  fast: 150,
  base: 220,
  slow: 350,
} as const;
