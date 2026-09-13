import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { Skeleton } from "@/components/skeleton";
import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing } from "@/constants/theme";

type Props<T> = {
  title: string;
  /** `null` while loading — renders skeleton placeholders instead. */
  items: T[] | null;
  keyExtractor: (item: T) => string | number;
  renderItem: (item: T) => ReactNode;
  itemWidth: number;
  /** Height of one skeleton placeholder; real items size themselves. */
  skeletonHeight: number;
  skeletonCount?: number;
};

/**
 * A themed horizontal scroller for a short, non-paginated list — cast,
 * similar movies, and the like.
 *
 * Plain `ScrollView` rather than `FlatList`: these lists are small and fixed
 * (TMDB credits are already truncated server-side), so virtualization would
 * be overhead without benefit. Renders nothing once loaded with zero items,
 * so an empty cast list from TMDB doesn't leave a titled empty rail.
 */
export function HorizontalRail<T>({
  title,
  items,
  keyExtractor,
  renderItem,
  itemWidth,
  skeletonHeight,
  skeletonCount = 6,
}: Props<T>) {
  if (items !== null && items.length === 0) return null;

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="smallBold" style={{ fontSize: 17, lineHeight: 24 }}>
        {title}
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: Spacing.three }}
      >
        {items === null
          ? Array.from({ length: skeletonCount }, (_, index) => (
              <Skeleton
                key={index}
                width={itemWidth}
                height={skeletonHeight}
                radius={Radius.md}
              />
            ))
          : items.map((item) => (
              <View key={keyExtractor(item)} style={{ width: itemWidth }}>
                {renderItem(item)}
              </View>
            ))}
      </ScrollView>
    </View>
  );
}
