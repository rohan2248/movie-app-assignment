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

/** 139 → "2h 19m"; 120 → "2h"; 45 → "45m". */
export function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '1999-10-15' → "15 Oct 1999". The server has already validated the format. */
export function formatReleaseDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const monthName = MONTHS[month - 1];
  if (!year || !monthName || !day) return isoDate;
  return `${day} ${monthName} ${year}`;
}
