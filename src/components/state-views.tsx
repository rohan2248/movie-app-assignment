import { ActivityIndicator, Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError } from '@/lib/error-copy';

type ActionProps = { label: string; onPress: () => void; busy?: boolean };

export function ActionButton({ label, onPress, busy }: ActionProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: Spacing.four,
        borderRadius: Radius.pill,
        backgroundColor: theme.accent,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: Spacing.two,
        opacity: pressed || busy ? 0.7 : 1,
      })}>
      {busy && <ActivityIndicator size="small" color={theme.accentContrast} />}
      <ThemedText type="smallBold" style={{ color: theme.accentContrast }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

type MessageProps = {
  icon: IconName;
  title: string;
  message?: string | null;
  action?: ActionProps;
};

function CenteredMessage({ icon, title, message, action }: MessageProps) {
  const theme = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={{
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.three,
        padding: Spacing.four,
      }}>
      <Icon name={icon} size={44} color={theme.textSecondary} />
      <View style={{ gap: Spacing.one, alignItems: 'center', maxWidth: MaxContentWidth / 1.6 }}>
        <ThemedText type="smallBold" style={{ fontSize: 18, lineHeight: 24, textAlign: 'center' }}>
          {title}
        </ThemedText>
        {message ? (
          <ThemedText selectable themeColor="textSecondary" type="small" style={{ textAlign: 'center' }}>
            {message}
          </ThemedText>
        ) : null}
      </View>
      {action && <ActionButton {...action} />}
    </Animated.View>
  );
}

export function EmptyState(props: MessageProps) {
  return <CenteredMessage {...props} />;
}

export function ErrorState({
  error,
  onRetry,
  retrying,
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const copy = describeError(error);
  return (
    <CenteredMessage
      icon="error"
      title={copy.title}
      message={copy.message}
      action={copy.canRetry ? { label: 'Try again', onPress: onRetry, busy: retrying } : undefined}
    />
  );
}

type BannerTone = 'warning' | 'info';

export function Banner({
  tone,
  icon,
  text,
}: {
  tone: BannerTone;
  icon: IconName;
  text: string;
}) {
  const theme = useTheme();
  const color = tone === 'warning' ? theme.warning : theme.textSecondary;
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.two,
        paddingVertical: Spacing.two,
        paddingHorizontal: Spacing.three,
        borderRadius: Radius.md,
        borderCurve: 'continuous',
        backgroundColor: theme.backgroundElement,
      }}>
      <Icon name={icon} size={18} color={color} />
      <ThemedText selectable type="small" style={{ flex: 1, color }}>
        {text}
      </ThemedText>
    </Animated.View>
  );
}
