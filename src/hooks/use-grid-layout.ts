import { useWindowDimensions } from 'react-native';

import { MaxGridWidth, PosterAspectRatio, Spacing, TargetCardWidth } from '@/constants/theme';

export const GRID_GUTTER = Spacing.two + Spacing.one; // 12
export const GRID_SIDE_PADDING = Spacing.three;
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;

/** Text sizes inside a card, shared with the card so its height is exact. */
export const CARD_TITLE_LINE_HEIGHT = 18;
export const CARD_META_LINE_HEIGHT = 16;
export const CARD_TEXT_GAP = Spacing.one;
/** Cap on font scaling inside cards; beyond this we drop a column instead. */
export const CARD_MAX_FONT_SCALE = 1.6;

export type GridLayout = {
  columns: number;
  /** Width of one cell including its share of the gutter. */
  cellWidth: number;
  cardWidth: number;
  cardHeight: number;
  posterHeight: number;
  /** Two title lines at the current (capped) font scale. */
  titleHeight: number;
  /** Padding for the list's content container, so outer gutters match inner ones. */
  horizontalPadding: number;
  /** Total width the grid occupies, centred when the screen is wider. */
  gridWidth: number;
};

/**
 * Target-width columns, not device breakpoints: one rule covers phones,
 * rotation, foldables, iPad split view, browser resizing and — via fontScale —
 * accessibility text sizes. `containerWidth` is the measured width of the
 * screen area, which on wide web excludes the tab sidebar.
 */
export function useGridLayout(containerWidth: number): GridLayout {
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(fontScale, CARD_MAX_FONT_SCALE);

  const gridWidth = Math.min(containerWidth, MaxGridWidth);
  const contentWidth = Math.max(gridWidth - 2 * GRID_SIDE_PADDING, 0);

  let columns = Math.round(contentWidth / (TargetCardWidth + GRID_GUTTER));
  columns = Math.min(Math.max(columns, MIN_COLUMNS), MAX_COLUMNS);
  // Large system text needs wider cards to keep two readable title lines.
  if (fontScale >= 1.3 && columns > MIN_COLUMNS) columns -= 1;

  // Each cell carries half a gutter on either side, so the container adds the
  // other half at the edges.
  const cellWidth = (contentWidth + GRID_GUTTER) / columns;
  const cardWidth = cellWidth - GRID_GUTTER;
  const posterHeight = cardWidth / PosterAspectRatio;

  // Fixed total height: a 90-character title can never shift the grid, and
  // FlashList's numColumns rows stay uniform.
  const titleHeight = 2 * CARD_TITLE_LINE_HEIGHT * scale;
  const textHeight = titleHeight + CARD_META_LINE_HEIGHT * scale;
  const cardHeight = Math.ceil(posterHeight + Spacing.two + textHeight + CARD_TEXT_GAP);

  return {
    columns,
    cellWidth,
    cardWidth,
    cardHeight,
    posterHeight,
    titleHeight,
    horizontalPadding: GRID_SIDE_PADDING - GRID_GUTTER / 2,
    gridWidth,
  };
}
