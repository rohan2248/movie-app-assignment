import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  movieId: number;
  posterUrl: string | null;
  title: string;
};

/**
 * Fills its parent (which fixes the 2:3 box). `contentFit="cover"` is the whole
 * answer to posters with inconsistent dimensions: any intrinsic ratio crops
 * rather than distorts. A missing or broken poster becomes a titled tile, never
 * a broken-image glyph.
 */
export function PosterImage({ movieId, posterUrl, title }: Props) {
  const theme = useTheme();
  // Tracks *which* URL failed, so a recycled cell showing a different movie
  // never inherits the previous movie's error state.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = posterUrl !== null && failedUrl !== posterUrl;

  return (
    <View style={{ flex: 1, backgroundColor: theme.posterPlaceholder }}>
      {showImage ? (
        <Image
          source={{ uri: posterUrl }}
          style={{ flex: 1 }}
          contentFit="cover"
          transition={180}
          cachePolicy="memory-disk"
          // Mandatory under a recycling list, or a reused cell briefly shows
          // the previous movie's poster while the new one loads.
          recyclingKey={String(movieId)}
          onError={() => setFailedUrl(posterUrl)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: Spacing.two,
            padding: Spacing.three,
          }}>
          <Icon name="discover" size={32} color={theme.textSecondary} />
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={3}
            style={{ textAlign: 'center' }}>
            {title}
          </ThemedText>
        </View>
      )}
    </View>
  );
}
