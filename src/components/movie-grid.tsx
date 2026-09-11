import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import type { MovieSummary } from '@shared/api-types';
import type { ReactElement, Ref } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';

import { MoviePosterCard, MoviePosterCardSkeleton } from '@/components/movie-poster-card';
import { ActionButton } from '@/components/state-views';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { GRID_GUTTER, type GridLayout } from '@/hooks/use-grid-layout';
import { useTheme } from '@/hooks/use-theme';
import { describeError } from '@/lib/error-copy';

type GridExtraData = { layout: GridLayout };

// Module scope, so FlashList never sees a new renderItem identity. Everything
// that varies per render arrives through `extraData`, which also tells
// recycled cells to re-render when the layout changes.
function renderItem({ item, extraData }: ListRenderItemInfo<MovieSummary>) {
  const { layout } = extraData as GridExtraData;
  return (
    <View style={{ paddingHorizontal: GRID_GUTTER / 2, paddingBottom: GRID_GUTTER + Spacing.two }}>
      <MoviePosterCard movie={item} layout={layout} />
    </View>
  );
}

function keyExtractor(item: MovieSummary) {
  return String(item.id);
}

type Props = {
  items: MovieSummary[];
  layout: GridLayout;
  listRef?: Ref<FlashListRef<MovieSummary>>;
  /** Pagination. Omit for a finite list such as the wishlist. */
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  /** Set when loading the *next* page failed; the loaded pages stay on screen. */
  loadMoreError?: unknown;
  refreshing?: boolean;
  onRefresh?: () => void;
  ListEmptyComponent?: ReactElement | null;
  endMessage?: string;
};

/** All FlashList configuration lives here so screens never repeat it. */
export function MovieGrid({
  items,
  layout,
  listRef,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  loadMoreError,
  refreshing = false,
  onRefresh,
  ListEmptyComponent,
  endMessage = "You've reached the end",
}: Props) {
  const theme = useTheme();

  function handleEndReached() {
    // FlashList v2 can fire this repeatedly while the next page is loading,
    // and after a failed page we wait for an explicit retry.
    if (!onLoadMore || !hasNextPage || isFetchingNextPage || loadMoreError) return;
    onLoadMore();
  }

  let footer: ReactElement | null = null;
  if (isFetchingNextPage) {
    footer = <ActivityIndicator color={theme.textSecondary} />;
  } else if (loadMoreError && onLoadMore) {
    // Footer-level retry: page 11 timing out must never throw away pages 1–10.
    const copy = describeError(loadMoreError);
    footer = (
      <View style={{ alignItems: 'center', gap: Spacing.two }}>
        <ThemedText selectable type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {copy.title}. Couldn&apos;t load more movies.
        </ThemedText>
        <ActionButton label="Try again" onPress={onLoadMore} />
      </View>
    );
  } else if (!hasNextPage && items.length > 0 && onLoadMore) {
    footer = (
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        {endMessage}
      </ThemedText>
    );
  }

  return (
    <FlashList
      ref={listRef}
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      extraData={{ layout } satisfies GridExtraData}
      // Changing column count re-creates the layout; keying on it avoids
      // recycled cells being measured against the old column width.
      key={`cols-${layout.columns}`}
      numColumns={layout.columns}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.6}
      // This list replaces its data when filters change rather than prepending,
      // so v2's default scroll anchoring would only fight the scroll-to-top.
      maintainVisibleContentPosition={{ disabled: true }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: layout.horizontalPadding,
        paddingTop: Spacing.two,
        paddingBottom: Spacing.five,
      }}
      ListEmptyComponent={ListEmptyComponent}
      ListFooterComponent={footer}
      ListFooterComponentStyle={{ paddingVertical: Spacing.four }}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} />
        ) : undefined
      }
    />
  );
}

/** First-load placeholder in exactly the grid's geometry. */
export function MovieGridSkeleton({ layout, rows = 3 }: { layout: GridLayout; rows?: number }) {
  return (
    <View
      accessibilityLabel="Loading movies"
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingHorizontal: layout.horizontalPadding,
        paddingTop: Spacing.two,
      }}>
      {Array.from({ length: layout.columns * rows }, (_, index) => (
        <View key={index} style={{ paddingHorizontal: GRID_GUTTER / 2, paddingBottom: GRID_GUTTER + Spacing.two }}>
          <MoviePosterCardSkeleton layout={layout} />
        </View>
      ))}
    </View>
  );
}
