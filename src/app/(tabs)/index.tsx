import { Link } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';

export default function DiscoverScreen() {
  return (
    <PlaceholderScreen
      icon="discover"
      title="Discover"
      body="Search, genre filters, sorting and the infinite poster grid arrive in Phase 5.">
      <Link href={{ pathname: '/movie/[id]', params: { id: '550' } }}>
        <ThemedText type="linkPrimary">Open a sample movie</ThemedText>
      </Link>
    </PlaceholderScreen>
  );
}
