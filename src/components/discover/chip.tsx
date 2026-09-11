import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
};

export function Chip({ label, selected, disabled = false, onPress, accessibilityHint }: Props) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      // 34pt visual height + 5pt slop above and below = a 44pt touch target.
      hitSlop={{ top: 5, bottom: 5 }}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({
        height: 34,
        paddingHorizontal: Spacing.three - Spacing.one,
        borderRadius: Radius.pill,
        justifyContent: 'center',
        backgroundColor: selected ? theme.accent : theme.backgroundElement,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}>
      <ThemedText
        type="small"
        maxFontSizeMultiplier={1.4}
        style={{ color: selected ? theme.accentContrast : theme.text, fontWeight: selected ? 700 : 500 }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}
