import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  /** Shows an inline spinner — the field itself is never blocked on the network. */
  busy: boolean;
};

export function SearchField({ value, onChangeText, busy }: Props) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.two,
        height: 44,
        paddingHorizontal: Spacing.three - Spacing.one,
        borderRadius: Radius.md,
        borderCurve: 'continuous',
        backgroundColor: theme.backgroundElement,
      }}>
      <Icon name="search" size={18} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Search movies"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Search movies"
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
        maxLength={120}
        style={{ flex: 1, height: '100%', fontSize: 16, color: theme.text }}
      />
      {busy && <ActivityIndicator size="small" color={theme.textSecondary} />}
      {value.length > 0 && (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Clear search">
          <Icon name="close" size={18} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}
