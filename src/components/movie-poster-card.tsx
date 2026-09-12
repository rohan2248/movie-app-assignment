import type { MovieSummary } from '@shared/api-types';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PosterImage } from '@/components/poster-image';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { WishlistHeart } from '@/components/wishlist-heart';
import { Radius, Spacing } from '@/constants/theme';
import {
  CARD_MAX_FONT_SCALE,
  CARD_META_LINE_HEIGHT,
  CARD_TEXT_GAP,
  CARD_TITLE_LINE_HEIGHT,
  type GridLayout,
} from '@/hooks/use-grid-layout';
import { prefetchMovieDetail } from '@/hooks/use-movie-detail';
import { useTheme } from '@/hooks/use-theme';
import { formatRating } from '@/lib/format';

type Props = {
  movie: MovieSummary;
  layout: GridLayout;
};

/**
 * Fixed total height (poster + exactly two title lines + one meta line), taken
 * from the grid layout, so neither a missing year nor an 87-character title can
 * change a row's height.
 */
export function MoviePosterCard({ movie, layout }: Props) {
  const queryClient = useQueryClient();
  const year = movie.releaseYear ? String(movie.releaseYear) : 'Year unknown';
  const ratingLabel = movie.rating !== null ? `, rated ${formatRating(movie.rating)} out of 10` : '';

  return (
    <View style={{ width: layout.cardWidth, height: layout.cardHeight }}>
      <Link href={{ pathname: '/movie/[id]', params: { id: String(movie.id) } }} asChild>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${movie.title}, ${year}${ratingLabel}`}
          // Touch-down, not tap: the detail request starts before the push does.
          onPressIn={() => prefetchMovieDetail(queryClient, movie.id)}
          // Static style on purpose: under `Link asChild` on web a function-form
          // style is dropped, silently losing the fixed size. Pressed feedback
          // lives in the children render function instead.
          style={{ width: layout.cardWidth, height: layout.cardHeight }}>
          {({ pressed }) => <CardBody movie={movie} layout={layout} year={year} pressed={pressed} />}
        </Pressable>
      </Link>

      {/* A sibling of the link, not a child of it: nesting a button inside an
          anchor is invalid on web and its click would also follow the link. */}
      <WishlistHeart
        movie={movie}
        style={{
          position: 'absolute',
          right: Spacing.two,
          top: layout.posterHeight - 32 - Spacing.two,
        }}
      />
    </View>
  );
}

function CardBody({
  movie,
  layout,
  year,
  pressed,
}: Props & { year: string; pressed: boolean }) {
  const theme = useTheme();

  return (
    <View style={{ flex: 1, gap: Spacing.two, opacity: pressed ? 0.75 : 1 }}>
      <View
        style={{
          width: layout.cardWidth,
          height: layout.posterHeight,
          borderRadius: Radius.md,
          borderCurve: 'continuous',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
        }}>
        <PosterImage movieId={movie.id} posterUrl={movie.posterUrl} title={movie.title} />
        {/* No votes means no rating: the badge is hidden, never shown as 0.0. */}
        {movie.rating !== null && (
          <View
            style={{
              position: 'absolute',
              top: Spacing.two,
              right: Spacing.two,
              flexDirection: 'row',
              alignItems: 'center',
              gap: Spacing.half,
              paddingVertical: Spacing.half,
              paddingHorizontal: Spacing.two - Spacing.half,
              borderRadius: Radius.pill,
              backgroundColor: 'rgba(0, 0, 0, 0.72)',
            }}>
            <Icon name="star" size={11} color={theme.rating} />
            <ThemedText
              maxFontSizeMultiplier={1.3}
              style={{
                color: '#ffffff',
                fontSize: 12,
                lineHeight: 16,
                fontWeight: 700,
                fontVariant: ['tabular-nums'],
              }}>
              {formatRating(movie.rating)}
            </ThemedText>
          </View>
        )}
      </View>

      <View style={{ gap: CARD_TEXT_GAP }}>
        <ThemedText
          numberOfLines={2}
          ellipsizeMode="tail"
          maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
          style={{
            fontSize: 14,
            lineHeight: CARD_TITLE_LINE_HEIGHT,
            fontWeight: 600,
            // Always two lines tall, so the year sits at the same height across
            // a row whether the title wraps or not.
            minHeight: layout.titleHeight,
          }}>
          {movie.title}
        </ThemedText>
        <ThemedText
          numberOfLines={1}
          themeColor="textSecondary"
          maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
          style={{
            fontSize: 12,
            lineHeight: CARD_META_LINE_HEIGHT,
            fontWeight: 500,
            fontVariant: ['tabular-nums'],
          }}>
          {year}
        </ThemedText>
      </View>
    </View>
  );
}

/** Same footprint as the real card, so the first load never reflows the grid. */
export function MoviePosterCardSkeleton({ layout }: { layout: GridLayout }) {
  return (
    <View style={{ width: layout.cardWidth, height: layout.cardHeight, gap: Spacing.two }}>
      <Skeleton height={layout.posterHeight} radius={Radius.md} />
      <View style={{ gap: CARD_TEXT_GAP }}>
        <Skeleton height={CARD_TITLE_LINE_HEIGHT - 4} width="85%" />
        <Skeleton height={CARD_META_LINE_HEIGHT - 4} width="35%" />
      </View>
    </View>
  );
}
