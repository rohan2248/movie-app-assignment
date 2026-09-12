import type { Genre, MovieDetail, MovieSummary } from '@shared/api-types';
import { Image } from 'expo-image';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ExternalLink } from '@/components/external-link';
import { Icon } from '@/components/icon';
import { PosterImage } from '@/components/poster-image';
import { Skeleton } from '@/components/skeleton';
import { ActionButton, Banner } from '@/components/state-views';
import { ThemedText } from '@/components/themed-text';
import { CollapsibleText } from '@/components/ui/collapsible';
import { WishlistErrorBanner } from '@/components/wishlist-heart';
import { BackdropAspectRatio, PosterAspectRatio, Radius, Spacing } from '@/constants/theme';
import { useGenresQuery } from '@/hooks/use-movies-query';
import { useTheme } from '@/hooks/use-theme';
import { useWishlistIds, useWishlistToggle } from '@/hooks/use-wishlist';
import { describeError } from '@/lib/error-copy';
import { formatCount, formatRating, formatReleaseDate, formatRuntime } from '@/lib/format';

/** At or above this width the poster gets its own column beside the text. */
export const DETAIL_WIDE_BREAKPOINT = 768;
const MAX_DETAIL_WIDTH = 1080;
const MAX_WIDE_BACKDROP_HEIGHT = 420;
const SIDE_PADDING = Spacing.three;

type Props = {
  /** Always present: the grid's summary, or the loaded detail itself. */
  base: MovieSummary;
  /** `null` until the detail request succeeds. */
  movie: MovieDetail | null;
  loading: boolean;
  /** A detail failure while `base` is still showable. */
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  degraded: boolean;
};

function useDetailLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= DETAIL_WIDE_BREAKPOINT;
  const contentWidth = Math.min(width, MAX_DETAIL_WIDTH);
  const backdropHeight = Math.round(
    Math.min(contentWidth / BackdropAspectRatio, wide ? MAX_WIDE_BACKDROP_HEIGHT : Infinity),
  );
  const posterWidth = wide ? 220 : 112;
  return {
    wide,
    backdropHeight,
    posterWidth,
    // The poster rides up over the backdrop by a fraction of its own height.
    posterOverlap: Math.round((posterWidth / PosterAspectRatio) * (wide ? 0.45 : 0.4)),
  };
}

export function MovieDetailView(props: Props) {
  const { base, movie, loading } = props;
  const layout = useDetailLayout();

  const heading = (
    <View style={{ gap: Spacing.two }}>
      <ThemedText
        selectable
        numberOfLines={3}
        accessibilityRole="header"
        style={{
          fontSize: layout.wide ? 34 : 22,
          lineHeight: layout.wide ? 40 : 28,
          fontWeight: 700,
        }}>
        {base.title}
      </ThemedText>
      <MetaRow base={base} movie={movie} loading={loading} />
    </View>
  );

  return (
    <View style={{ width: '100%', maxWidth: MAX_DETAIL_WIDTH, alignSelf: 'center' }}>
      <Backdrop
        url={movie?.backdropUrl ?? null}
        pending={loading && !movie}
        height={layout.backdropHeight}
        rounded={layout.wide}
      />

      <View style={{ paddingHorizontal: SIDE_PADDING, gap: Spacing.four }}>
        <View
          style={{
            flexDirection: 'row',
            gap: layout.wide ? Spacing.five : Spacing.three,
            alignItems: layout.wide ? 'flex-start' : 'flex-end',
          }}>
          <Poster base={base} width={layout.posterWidth} overlap={layout.posterOverlap} />
          <View
            style={{
              flex: 1,
              gap: Spacing.four,
              paddingTop: layout.wide ? Spacing.four : 0,
            }}>
            {heading}
            {layout.wide && <DetailSections {...props} wide />}
          </View>
        </View>

        {!layout.wide && <DetailSections {...props} wide={false} />}
      </View>
    </View>
  );
}

function Backdrop({
  url,
  pending,
  height,
  rounded,
}: {
  url: string | null;
  pending: boolean;
  height: number;
  rounded: boolean;
}) {
  const theme = useTheme();
  const radius = rounded ? Radius.lg : 0;

  // The band is always reserved, image or not, so nothing below it moves when
  // the detail arrives.
  if (pending) return <Skeleton height={height} radius={radius} />;

  return (
    <View
      style={{
        height,
        borderRadius: radius,
        borderCurve: 'continuous',
        overflow: 'hidden',
        backgroundColor: theme.posterPlaceholder,
      }}>
      {url && (
        <Image
          source={{ uri: url }}
          style={{ flex: 1 }}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

function Poster({ base, width, overlap }: { base: MovieSummary; width: number; overlap: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width,
        height: width / PosterAspectRatio,
        marginTop: -overlap,
        borderRadius: Radius.md,
        borderCurve: 'continuous',
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: theme.background,
        boxShadow: '0 6px 16px rgba(0, 0, 0, 0.28)',
      }}>
      <PosterImage movieId={base.id} posterUrl={base.posterUrl} title={base.title} />
    </View>
  );
}

function MetaRow({ base, movie, loading }: Pick<Props, 'base' | 'movie' | 'loading'>) {
  const theme = useTheme();
  const items: ReactNode[] = [];

  items.push(
    <ThemedText key="year" selectable type="small" themeColor="textSecondary">
      {base.releaseYear ?? 'Year unknown'}
    </ThemedText>,
  );

  if (movie?.runtimeMinutes) {
    items.push(
      <ThemedText key="runtime" selectable type="small" themeColor="textSecondary">
        {formatRuntime(movie.runtimeMinutes)}
      </ThemedText>,
    );
  } else if (loading && !movie) {
    items.push(<Skeleton key="runtime" width={44} height={14} />);
  }

  // No votes means no rating: omitted, never shown as 0.0.
  if (base.rating !== null) {
    items.push(
      <View key="rating" style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }}>
        <Icon name="star" size={13} color={theme.rating} />
        <ThemedText selectable type="smallBold" style={{ fontVariant: ['tabular-nums'] }}>
          {formatRating(base.rating)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
          ({formatCount(base.voteCount)})
        </ThemedText>
      </View>,
    );
  }

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: Spacing.one }}>
      {items.map((item, index) => (
        <View key={index} style={{ flexDirection: 'row', alignItems: 'center' }}>
          {index > 0 && (
            <ThemedText type="small" themeColor="textSecondary" style={{ paddingHorizontal: Spacing.two }}>
              ·
            </ThemedText>
          )}
          {item}
        </View>
      ))}
    </View>
  );
}

function DetailSections({
  base,
  movie,
  loading,
  error,
  onRetry,
  retrying,
  degraded,
  wide,
}: Props & { wide: boolean }) {
  const failure = error && !movie ? describeError(error) : null;

  return (
    <View style={{ gap: Spacing.four }}>
      <GenreTags base={base} movie={movie} />

      {/* `base` on purpose, not `movie`: the summary from the grid cache is a
          complete MovieSummary, so the movie can be saved before its detail
          has loaded — or while TMDB is unreachable. */}
      <WishlistButton movie={base} wide={wide} />
      <WishlistErrorBanner />

      {degraded && (
        <Banner
          tone="warning"
          icon="offline"
          text="Showing saved details. The movie service can't be reached right now."
        />
      )}
      {failure && (
        <View style={{ gap: Spacing.two, alignItems: 'flex-start' }}>
          <Banner tone="warning" icon="error" text={`${failure.title}. Showing what we already had.`} />
          {failure.canRetry && <ActionButton label="Try again" onPress={onRetry} busy={retrying} />}
        </View>
      )}

      <Overview movie={movie} loading={loading} />

      {movie && <Facts movie={movie} />}

      <Attribution tmdbUrl={movie?.tmdbUrl ?? null} />
    </View>
  );
}

/**
 * Before the detail lands, names come from the genre list the Discover chips
 * already loaded, so the tags usually appear instantly too.
 */
function GenreTags({ base, movie }: Pick<Props, 'base' | 'movie'>) {
  const theme = useTheme();
  const genreList = useGenresQuery();

  let genres: Genre[] | null;
  if (movie) {
    genres = movie.genres;
  } else if (genreList.data) {
    const byId = new Map(genreList.data.map((genre) => [genre.id, genre]));
    genres = base.genreIds.flatMap((id) => byId.get(id) ?? []);
  } else {
    genres = genreList.isPending ? null : [];
  }

  if (genres === null) {
    return (
      <View style={{ flexDirection: 'row', gap: Spacing.two }}>
        {[64, 84, 56].map((width) => (
          <Skeleton key={width} width={width} height={28} radius={Radius.pill} />
        ))}
      </View>
    );
  }
  if (genres.length === 0) return null;

  return (
    <View
      accessibilityLabel={`Genres: ${genres.map((genre) => genre.name).join(', ')}`}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
      {genres.map((genre) => (
        <View
          key={genre.id}
          style={{
            height: 28,
            justifyContent: 'center',
            paddingHorizontal: Spacing.three - Spacing.one,
            borderRadius: Radius.pill,
            backgroundColor: theme.backgroundElement,
          }}>
          <ThemedText type="small" maxFontSizeMultiplier={1.4} style={{ fontSize: 13 }}>
            {genre.name}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/**
 * The full-width CTA. Saved state inverts it to an outline, so "in your
 * wishlist" reads as a state rather than as another call to action — and
 * pressing it again removes the movie.
 */
function WishlistButton({ movie, wide }: { movie: MovieSummary; wide: boolean }) {
  const theme = useTheme();
  const ids = useWishlistIds();
  const { toggle, enabled } = useWishlistToggle();
  const inWishlist = ids.has(movie.id);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: inWishlist, disabled: !enabled }}
      accessibilityLabel={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
      disabled={!enabled}
      onPress={() => toggle(movie, !inWishlist)}
      style={({ pressed }) => ({
        minHeight: 48,
        alignSelf: wide ? 'flex-start' : 'stretch',
        minWidth: wide ? 260 : undefined,
        paddingHorizontal: Spacing.four,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.two,
        borderRadius: Radius.md,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: theme.accent,
        backgroundColor: inWishlist ? 'transparent' : theme.accent,
        opacity: !enabled ? 0.5 : pressed ? 0.75 : 1,
      })}>
      <Icon
        name={inWishlist ? 'wishlistFilled' : 'wishlist'}
        size={18}
        color={inWishlist ? theme.accent : theme.accentContrast}
      />
      <ThemedText
        type="smallBold"
        style={{ color: inWishlist ? theme.accent : theme.accentContrast, fontSize: 16 }}>
        {inWishlist ? 'In your Wishlist' : 'Add to Wishlist'}
      </ThemedText>
    </Pressable>
  );
}

function Overview({ movie, loading }: Pick<Props, 'movie' | 'loading'>) {
  if (!movie) {
    if (!loading) return null;
    return (
      <View style={{ gap: Spacing.two }}>
        {['100%', '96%', '92%', '60%'].map((width) => (
          <Skeleton key={width} width={width as `${number}%`} height={14} />
        ))}
      </View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(200)} style={{ gap: Spacing.two }}>
      {movie.tagline && (
        <ThemedText selectable themeColor="textSecondary" style={{ fontStyle: 'italic' }}>
          {movie.tagline}
        </ThemedText>
      )}
      <ThemedText type="smallBold" style={{ fontSize: 17, lineHeight: 24 }}>
        Overview
      </ThemedText>
      {movie.overview ? (
        <CollapsibleText text={movie.overview} style={{ fontSize: 16, lineHeight: 24, fontWeight: 400 }} />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          No overview available.
        </ThemedText>
      )}
    </Animated.View>
  );
}

function Facts({ movie }: { movie: MovieDetail }) {
  const theme = useTheme();
  const rows: [string, string][] = [];
  if (movie.releaseDate) rows.push(['Released', formatReleaseDate(movie.releaseDate)]);
  if (movie.runtimeMinutes) rows.push(['Runtime', formatRuntime(movie.runtimeMinutes)]);
  if (movie.status) rows.push(['Status', movie.status]);
  if (movie.originalLanguage) rows.push(['Original language', movie.originalLanguage.toUpperCase()]);
  if (rows.length === 0) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={{
        borderRadius: Radius.md,
        borderCurve: 'continuous',
        backgroundColor: theme.backgroundElement,
        paddingHorizontal: Spacing.three,
      }}>
      {rows.map(([label, value], index) => (
        <View
          key={label}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: Spacing.three,
            paddingVertical: Spacing.two + Spacing.one,
            borderTopWidth: index === 0 ? 0 : 1,
            borderColor: theme.border,
          }}>
          <ThemedText type="small" themeColor="textSecondary">
            {label}
          </ThemedText>
          <ThemedText selectable type="small" style={{ flexShrink: 1, textAlign: 'right' }}>
            {value}
          </ThemedText>
        </View>
      ))}
    </Animated.View>
  );
}

/** Crediting TMDB is a condition of its API licence, not decoration. */
function Attribution({ tmdbUrl }: { tmdbUrl: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ gap: Spacing.two, paddingTop: Spacing.two }}>
      {tmdbUrl && (
        <ExternalLink href={tmdbUrl as Href & string} asChild>
          <Pressable
            accessibilityRole="link"
            accessibilityHint="Opens The Movie Database in your browser"
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one, alignSelf: 'flex-start' }}>
            <ThemedText type="smallBold" themeColor="accent">
              View on TMDB
            </ThemedText>
            <Icon name="external" size={14} color={theme.accent} />
          </Pressable>
        </ExternalLink>
      )}
      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12, lineHeight: 16 }}>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </ThemedText>
    </View>
  );
}

/** Deep link with nothing cached: the full shape, so the real content fades in place. */
export function MovieDetailSkeleton() {
  const layout = useDetailLayout();
  const posterHeight = layout.posterWidth / PosterAspectRatio;
  return (
    <View style={{ width: '100%', maxWidth: MAX_DETAIL_WIDTH, alignSelf: 'center' }}>
      <Skeleton height={layout.backdropHeight} radius={layout.wide ? Radius.lg : 0} />
      <View
        style={{
          paddingHorizontal: SIDE_PADDING,
          flexDirection: 'row',
          gap: layout.wide ? Spacing.five : Spacing.three,
          alignItems: layout.wide ? 'flex-start' : 'flex-end',
        }}>
        <Skeleton
          width={layout.posterWidth}
          height={posterHeight}
          radius={Radius.md}
          style={{ marginTop: -layout.posterOverlap }}
        />
        <View style={{ flex: 1, gap: Spacing.two, paddingTop: layout.wide ? Spacing.four : 0 }}>
          <Skeleton width="80%" height={layout.wide ? 32 : 22} />
          <Skeleton width="45%" height={14} />
        </View>
      </View>
    </View>
  );
}
