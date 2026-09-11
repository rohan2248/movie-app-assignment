import { SORT_KEYS, SORT_LABELS, type Genre, type SortKey } from '@shared/api-types';
import { ScrollView, View } from 'react-native';

import { MAX_GENRES } from '@/api/query-keys';
import { Chip } from '@/components/discover/chip';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';

type GenreRowProps = {
  genres: Genre[] | undefined;
  /** Placeholder chips only while loading; a failed load just leaves "All". */
  loading: boolean;
  selected: number[];
  onChange: (next: number[]) => void;
  horizontalPadding: number;
};

export function GenreRow({ genres, loading, selected, onChange, horizontalPadding }: GenreRowProps) {
  const atCap = selected.length >= MAX_GENRES;

  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter((g) => g !== id) : [...selected, id]);
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: horizontalPadding }}>
      <Chip label="All" selected={selected.length === 0} onPress={() => onChange([])} />
      {genres
        ? genres.map((genre) => {
            const isSelected = selected.includes(genre.id);
            return (
              <Chip
                key={genre.id}
                label={genre.name}
                selected={isSelected}
                disabled={atCap && !isSelected}
                accessibilityHint={atCap && !isSelected ? `Up to ${MAX_GENRES} genres` : undefined}
                onPress={() => toggle(genre.id)}
              />
            );
          })
        : loading &&
          Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} width={72} height={34} radius={Radius.pill} />
          ))}
    </ScrollView>
  );
}

type SortRowProps = {
  value: SortKey;
  onChange: (sort: SortKey) => void;
  /** Sorting cannot apply to search results; the row stays visible but inert. */
  disabled: boolean;
  horizontalPadding: number;
};

export function SortRow({ value, onChange, disabled, horizontalPadding }: SortRowProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: Spacing.two,
          alignItems: 'center',
          paddingHorizontal: horizontalPadding,
        }}>
        <ThemedText type="small" themeColor="textSecondary">
          Sort
        </ThemedText>
        {SORT_KEYS.map((key) => (
          <Chip
            key={key}
            label={SORT_LABELS[key]}
            selected={!disabled && value === key}
            disabled={disabled}
            onPress={() => onChange(key)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
