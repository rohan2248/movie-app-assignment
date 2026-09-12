import type { MovieSummary } from '@shared/api-types';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { Banner } from '@/components/state-views';
import { Radius } from '@/constants/theme';
import { useWishlistIds, useWishlistToggle } from '@/hooks/use-wishlist';
import { describeError } from '@/lib/error-copy';
import { useWishlistContext } from '@/providers/wishlist-provider';

const SIZE = 32;

/**
 * The heart on a poster.
 *
 * It subscribes to the wishlist query itself rather than receiving its state as
 * a prop: FlashList recycles cells, and a cell that re-renders from its own
 * subscription can never show the previous movie's heart.
 */
export function WishlistHeart({
  movie,
  style,
}: {
  movie: MovieSummary;
  style?: StyleProp<ViewStyle>;
}) {
  const ids = useWishlistIds();
  const { toggle, enabled } = useWishlistToggle();
  const inWishlist = ids.has(movie.id);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: inWishlist, disabled: !enabled }}
      accessibilityLabel={
        inWishlist ? `Remove ${movie.title} from your wishlist` : `Add ${movie.title} to your wishlist`
      }
      disabled={!enabled}
      // The visible circle is 32pt; hitSlop takes the touch target to 44.
      hitSlop={(44 - SIZE) / 2}
      onPress={() => toggle(movie, !inWishlist)}
      style={({ pressed }) => [
        {
          width: SIZE,
          height: SIZE,
          borderRadius: Radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}>
      <Icon
        name={inWishlist ? 'wishlistFilled' : 'wishlist'}
        size={17}
        // Static colors, not theme tokens: this sits on a fixed dark scrim over
        // the poster, so it must not follow the page background.
        color={inWishlist ? '#FF6B6B' : '#ffffff'}
      />
    </Pressable>
  );
}

/**
 * The one place a failed toggle is explained. Rendered by the screens rather
 * than by the heart, since a banner inside a recycled grid cell would scroll
 * away from the action that caused it.
 */
export function WishlistErrorBanner() {
  const { lastError } = useWishlistContext();
  if (lastError === null) return null;

  const copy = describeError(lastError);
  return <Banner tone="warning" icon="error" text={`${copy.title}. Your wishlist was not changed.`} />;
}
