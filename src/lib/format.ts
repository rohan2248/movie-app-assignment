/** 1234 → "1,234"; 45_600 → "45.6k"; 1_400_000 → "1.4M". Hermes-safe (no Intl). */
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 10_000) return `${trimDecimal(value / 1_000)}k`;
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

export function formatRating(rating: number): string {
  return rating.toFixed(1);
}
