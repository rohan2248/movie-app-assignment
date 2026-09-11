import { Pressable } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemePreference, type ThemePreference } from '@/providers/theme-preference';

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

const ICON: Record<ThemePreference, IconName> = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
};

const LABEL: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** Header button cycling System → Light → Dark. The icon shows the current mode. */
export function ThemeToggle() {
  const theme = useTheme();
  const { preference, setPreference } = useThemePreference();
  const next = NEXT[preference];

  return (
    <Pressable
      onPress={() => setPreference(next)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`Appearance: ${LABEL[preference]}`}
      accessibilityHint={`Switches to ${LABEL[next]}`}
      style={({ pressed }) => ({ paddingHorizontal: Spacing.three, opacity: pressed ? 0.5 : 1 })}>
      <Icon name={ICON[preference]} size={22} color={theme.text} />
    </Pressable>
  );
}
