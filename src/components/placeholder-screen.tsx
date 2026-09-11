import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = { icon: IconName; title: string; body: string; children?: ReactNode };

/** Temporary body for routes whose real screen lands in a later phase. */
export function PlaceholderScreen({ icon, title, body, children }: Props) {
  const theme = useTheme();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.three,
        padding: Spacing.four,
      }}>
      <Icon name={icon} size={48} color={theme.textSecondary} />
      <ThemedText type="subtitle" style={{ textAlign: 'center' }}>
        {title}
      </ThemedText>
      <ThemedText
        themeColor="textSecondary"
        style={{ textAlign: 'center', maxWidth: MaxContentWidth }}>
        {body}
      </ThemedText>
      {children}
    </ScrollView>
  );
}
