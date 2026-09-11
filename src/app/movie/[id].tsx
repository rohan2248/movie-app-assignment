import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { MovieDetailSkeleton, MovieDetailView } from '@/components/movie-detail-view';
import { EmptyState, ErrorState } from '@/components/state-views';
import { Spacing } from '@/constants/theme';
import { parseMovieId, useMovieDetail } from '@/hooks/use-movie-detail';
import { useTheme } from '@/hooks/use-theme';

export default function MovieDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const id = parseMovieId(params.id);
  const { query, movie, meta, summary } = useMovieDetail(id);

  // A malformed id never reaches the network; a real 404 is cached server-side.
  const notFound = id === null || (query.error instanceof ApiError && query.error.code === 'NOT_FOUND');
  const base = movie ?? summary;

  function leave() {
    // A deep link has nothing to go back to.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  let content;
  if (notFound) {
    content = (
      <EmptyState
        icon="search"
        title="Movie not found"
        message="It may have been removed from TMDB, or the link is wrong."
        action={{ label: 'Back to Discover', onPress: leave }}
      />
    );
  } else if (base) {
    content = (
      <MovieDetailView
        base={base}
        movie={movie}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
        degraded={meta?.degraded ?? false}
      />
    );
  } else if (query.isError) {
    content = <ErrorState error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />;
  } else {
    content = <MovieDetailSkeleton />;
  }

  return (
    <>
      <Stack.Screen options={{ title: notFound ? 'Not found' : (base?.title ?? '') }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: theme.background }}
        contentContainerStyle={{
          flexGrow: 1,
          // iOS adds the home-indicator inset itself via contentInsetAdjustmentBehavior.
          paddingBottom: Spacing.five + (process.env.EXPO_OS === 'ios' ? 0 : insets.bottom),
        }}>
        {content}
      </ScrollView>
    </>
  );
}
