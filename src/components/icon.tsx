import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

/**
 * Semantic name → platform glyph, in one table. Screens ask for `heart`, never
 * for an SF Symbol or Material name, so swapping icon sets is a one-file change.
 * iOS renders SF Symbols natively; Android and web render Material Symbols from
 * a font bundled with expo-symbols — no dev build and no extra dependency.
 */
const ICONS = {
  discover: { ios: 'film', android: 'movie', web: 'movie' },
  wishlist: { ios: 'heart', android: 'favorite_border', web: 'favorite_border' },
  wishlistFilled: { ios: 'heart.fill', android: 'favorite', web: 'favorite' },
  themeSystem: { ios: 'circle.lefthalf.filled', android: 'brightness_auto', web: 'brightness_auto' },
  themeLight: { ios: 'sun.max', android: 'light_mode', web: 'light_mode' },
  themeDark: { ios: 'moon', android: 'dark_mode', web: 'dark_mode' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  star: { ios: 'star.fill', android: 'star', web: 'star' },
  error: { ios: 'exclamationmark.circle', android: 'error_outline', web: 'error_outline' },
  offline: { ios: 'wifi.slash', android: 'wifi_off', web: 'wifi_off' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  external: { ios: 'arrow.up.right.square', android: 'open_in_new', web: 'open_in_new' },
} as const satisfies Record<string, SymbolName>;

export type IconName = keyof typeof ICONS;

type IconProps = {
  name: IconName;
  size?: number;
  color: ColorValue;
  style?: StyleProp<ViewStyle>;
};

export function Icon({ name, size = 24, color, style }: IconProps) {
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} style={style} />;
}
