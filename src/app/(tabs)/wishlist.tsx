import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { MovieGrid, MovieGridSkeleton } from '@/components/movie-grid';
import { Banner, EmptyState, ErrorState } from '@/components/state-views';
import { ThemedText } from '@/components/themed-text';
import { WishlistErrorBanner } from '@/components/wishlist-heart';
import { Spacing } from '@/constants/theme';
import { GRID_SIDE_PADDING, useGridLayout } from '@/hooks/use-grid-layout';
import { useWishlistEntries } from '@/hooks/use-wishlist';
import { useTheme } from '@/hooks/use-theme';
import { useWishlistContext } from '@/providers/wishlist-provider';

export default function WishlistScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(windowWidth);
  const layout = useGridLayout(containerWidth);

  const { ready } = useWishlistContext();
  const query = useWishlistEntries();
  const movies = query.entries.map((entry) => entry.movie);

  // The hydrated mirror means data is usually already here; a failed request
  // with data on screen is a banner, not an error state.
  const showingSavedCopy = query.isError && movies.length > 0;

  let body;
  if (!ready || (query.isPending && movies.length === 0)) {
    body = <MovieGridSkeleton layout={layout} rows={2} />;
  } else if (query.isError && movies.length === 0) {
    body = <ErrorState error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />;
  } else {
    body = (
      // Reuses the Discover grid verbatim: no pagination props, so it renders
      // as a finite list with no footer and no onEndReached.
      <MovieGrid
        items={movies}
        layout={layout}
        refreshing={query.isRefetching}
        onRefresh={() => query.refetch()}
        ListEmptyComponent={
          <EmptyState
            icon="wishlist"
            title="Nothing saved yet"
            message="Tap the heart on any poster to keep it here. Your list is saved on this device and on the server."
            action={{ label: 'Browse movies', onPress: () => router.navigate('/') }}
          />
        }
      />
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.background }}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}>
      <View style={{ flex: 1, width: '100%', maxWidth: layout.gridWidth, alignSelf: 'center' }}>
        {(movies.length > 0 || showingSavedCopy) && (
          <View
            style={{
              paddingHorizontal: GRID_SIDE_PADDING,
              paddingTop: Spacing.two,
              gap: Spacing.two,
            }}>
            {showingSavedCopy && (
              <Banner
                tone="warning"
                icon="offline"
                text="Showing your saved copy. The server can't be reached right now."
              />
            )}
            <WishlistErrorBanner />
            {movies.length > 0 && (
              <ThemedText
                selectable
                type="small"
                themeColor="textSecondary"
                style={{ fontVariant: ['tabular-nums'] }}>
                {movies.length === 1 ? '1 saved movie' : `${movies.length} saved movies`}
              </ThemedText>
            )}
          </View>
        )}

        {body}
      </View>
    </View>
  );
}
