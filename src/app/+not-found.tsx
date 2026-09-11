import { Link } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';

export default function NotFoundScreen() {
  return (
    <PlaceholderScreen icon="error" title="Page not found" body="This screen doesn't exist.">
      <Link href="/" replace>
        <ThemedText type="linkPrimary">Go to Discover</ThemedText>
      </Link>
    </PlaceholderScreen>
  );
}
