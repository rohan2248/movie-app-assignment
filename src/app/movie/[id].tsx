import { Stack, useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';

export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen options={{ title: `Movie ${id}` }} />
      <PlaceholderScreen
        icon="discover"
        title={`Movie #${id}`}
        body="Backdrop, poster, overview and the wishlist button arrive in Phase 6."
      />
    </>
  );
}
