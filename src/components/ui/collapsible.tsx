import { useState } from 'react';
import { Pressable, View, type StyleProp, type TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type Props = {
  text: string;
  /** Texts at or under this length are shown in full with no toggle. */
  threshold?: number;
  collapsedLines?: number;
  style?: StyleProp<TextStyle>;
};

/**
 * Long text clamped to a few lines with a "Read more" toggle. The decision is
 * by length rather than by measuring rendered lines: measuring differs across
 * iOS, Android and web, and a toggle that appears only after a layout pass
 * makes the content below it jump.
 */
export function CollapsibleText({ text, threshold = 300, collapsedLines = 5, style }: Props) {
  const [open, setOpen] = useState(false);
  const collapsible = text.length > threshold;

  return (
    <View style={{ gap: Spacing.two, alignItems: 'flex-start' }}>
      <ThemedText selectable numberOfLines={collapsible && !open ? collapsedLines : undefined} style={style}>
        {text}
      </ThemedText>
      {collapsible && (
        <Pressable
          onPress={() => setOpen((value) => !value)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <ThemedText type="smallBold" themeColor="accent">
            {open ? 'Show less' : 'Read more'}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}
