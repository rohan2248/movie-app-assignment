import type { FlashListRef } from '@shopify/flash-list';
import type { MovieSummary } from '@shared/api-types';
import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { DEFAULT_SORT, normalizeFilters } from '@/api/query-keys';
import { GenreRow, SortRow } from '@/components/discover/filter-bar';
import { SearchField } from '@/components/discover/search-field';
import { MovieGrid, MovieGridSkeleton } from '@/components/movie-grid';
import { Banner, EmptyState, ErrorState } from '@/components/state-views';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useDiscoverParams } from '@/hooks/use-discover-params';
import { GRID_SIDE_PADDING, useGridLayout } from '@/hooks/use-grid-layout';
import { useGenresQuery, useMoviesQuery } from '@/hooks/use-movies-query';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/format';

const SEARCH_DEBOUNCE_MS = 350;
const SORT_IN_SEARCH_NOTE = 'Sorting applies while browsing, not while searching.';
/** Bound on auto-fetching when a genre-filtered search leaves pages sparse. */
const MAX_AUTOFILL_PAGES = 5;

export default function DiscoverScreen() {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(windowWidth);
  const layout = useGridLayout(containerWidth);
  const listRef = useRef<FlashListRef<MovieSummary>>(null);

  const { filters, setFilters } = useDiscoverParams();

  // Raw text drives the input; only the debounced value reaches the query key
  // (via the URL), so typing is never gated on the network.
  const [text, setText] = useState(filters.query);
  const debouncedText = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (debouncedText.trim() !== filters.query.trim()) setFilters({ query: debouncedText });
    // Only a settled keystroke should write; filters are read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedText]);

  // The URL changed from outside the field (browser back, deep link): adopt it.
  // Changes that *we* wrote match the debounced text and are skipped, so a
  // late param update can never swallow keystrokes typed in the meantime.
  useEffect(() => {
    if (filters.query !== debouncedText.trim()) setText(filters.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.query]);

  const movies = useMoviesQuery(filters);
  const genres = useGenresQuery();
  const { items, meta, firstPage } = movies;
  const searching = filters.query.length > 0;

  // New filters mean a new list: start it from the top.
  const filterKey = JSON.stringify(normalizeFilters(filters));
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [filterKey]);

  // A genre-filtered search is filtered page-by-page on the server, so a page
  // can come back nearly empty while more pages exist. Pull a few more rather
  // than showing "no results" or a lone row.
  const pageCount = movies.data?.pages.length ?? 0;
  useEffect(() => {
    if (
      movies.isSuccess &&
      !movies.isFetching &&
      movies.hasNextPage &&
      items.length < layout.columns * 2 &&
      pageCount < MAX_AUTOFILL_PAGES
    ) {
      movies.fetchNextPage();
    }
  });

  function clearFilters() {
    setText('');
    setFilters({ query: '', genres: [], sort: DEFAULT_SORT });
  }

  const hasFilters = searching || filters.genres.length > 0 || filters.sort !== DEFAULT_SORT;
  const notes = meta?.degraded ? [] : [...(meta?.notes ?? [])];
  if (searching && !notes.includes(SORT_IN_SEARCH_NOTE)) notes.unshift(SORT_IN_SEARCH_NOTE);

  let summary: string | null = null;
  if (firstPage && items.length > 0) {
    // Upstream totals are untrusted: never claim fewer results than are on screen.
    const count = formatCount(Math.max(firstPage.totalResults, items.length));
    summary = searching ? `${count} results for “${filters.query}”` : `${count} movies`;
  }

  let body;
  if (movies.isPending) {
    body = <MovieGridSkeleton layout={layout} />;
  } else if (movies.isError && items.length === 0) {
    body = (
      <ErrorState error={movies.error} onRetry={() => movies.refetch()} retrying={movies.isFetching} />
    );
  } else {
    body = (
      <View style={{ flex: 1, opacity: movies.isPlaceholderData ? 0.55 : 1 }}>
        <MovieGrid
          listRef={listRef}
          items={items}
          layout={layout}
          hasNextPage={movies.hasNextPage}
          isFetchingNextPage={movies.isFetchingNextPage}
          onLoadMore={() => movies.fetchNextPage()}
          loadMoreError={movies.isFetchNextPageError ? movies.error : null}
          refreshing={movies.isRefetching && !movies.isFetchingNextPage && !movies.isPlaceholderData}
          onRefresh={() => movies.refetch()}
          ListEmptyComponent={
            <EmptyState
              icon="search"
              title={
                searching
                  ? `No results for “${filters.query}”`
                  : filters.genres.length > 0
                    ? 'No movies match these genres'
                    : 'No movies found'
              }
              message={
                searching
                  ? 'Check the spelling, or try fewer genres.'
                  : filters.genres.length > 0
                    ? 'Try removing a genre.'
                    : null
              }
              action={hasFilters ? { label: 'Clear filters', onPress: clearFilters } : undefined}
            />
          }
        />
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.background }}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}>
      <View style={{ flex: 1, width: '100%', maxWidth: layout.gridWidth, alignSelf: 'center' }}>
        {/* Fixed above the list rather than a list header: filters stay
            reachable while scrolling, and FlashList never has to measure them. */}
        <View style={{ gap: Spacing.two + Spacing.half, paddingTop: Spacing.two, paddingBottom: Spacing.two }}>
          <View style={{ paddingHorizontal: GRID_SIDE_PADDING }}>
            <SearchField
              value={text}
              onChangeText={setText}
              busy={movies.isFetching && !movies.isFetchingNextPage && !movies.isPending}
            />
          </View>
          <GenreRow
            genres={genres.data}
            loading={genres.isPending}
            selected={filters.genres}
            onChange={(next) => setFilters({ genres: next })}
            horizontalPadding={GRID_SIDE_PADDING}
          />
          <SortRow
            value={filters.sort}
            onChange={(sort) => setFilters({ sort })}
            disabled={searching}
            horizontalPadding={GRID_SIDE_PADDING}
          />

          <View style={{ paddingHorizontal: GRID_SIDE_PADDING, gap: Spacing.two }}>
            {meta?.degraded && (
              <Banner
                tone="warning"
                icon="offline"
                text="Showing saved results. The movie service can't be reached right now."
              />
            )}
            {movies.isRefetchError && items.length > 0 && (
              <Banner tone="warning" icon="error" text="Couldn't refresh. Showing the last results." />
            )}
            {(summary || notes.length > 0) && (
              <Animated.View entering={FadeIn.duration(150)} style={{ gap: Spacing.half }}>
                {summary && (
                  <ThemedText
                    selectable
                    type="small"
                    themeColor="textSecondary"
                    style={{ fontVariant: ['tabular-nums'] }}>
                    {summary}
                  </ThemedText>
                )}
                {notes.map((note) => (
                  <ThemedText key={note} type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                    {note}
                  </ThemedText>
                ))}
              </Animated.View>
            )}
          </View>
        </View>

        {body}
      </View>
    </View>
  );
}
