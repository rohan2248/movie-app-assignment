/**
 * The API contract between the Expo app and the Express backend.
 *
 * No imports and no dependencies, so importing this from the app bundles
 * nothing but two small const arrays (see SORT_KEYS / SORT_LABELS at the
 * bottom — the one deliberate exception to "types only", because the sort list
 * would otherwise drift between server validation and the client's sort pills).
 *
 * Both sides compile against this file: the app consumes these types directly,
 * and the server pins its zod output to them with `satisfies`, so a DTO drift
 * becomes a compile error in `npm run typecheck` rather than a runtime surprise.
 *
 * Design rules that the rest of the codebase depends on:
 *
 * 1. No TMDB vocabulary. `poster_path`, `vote_average` and `genre_ids` never
 *    reach the client. Swapping the upstream provider touches server/src/tmdb/ only.
 * 2. Image URLs are absolute and already sized by the server. The client never
 *    knows about image.tmdb.org or `w342`, so image-size policy is a server
 *    deploy rather than an app release.
 * 3. `null` over `undefined`/absent. Every field is always present, so `strict`
 *    TypeScript forces the UI to handle every missing case. This is what makes
 *    "handle incomplete external data" a compiler guarantee instead of a hope.
 */

/* ------------------------------------------------------------------ movies */

export type Genre = {
  id: number;
  name: string;
};

export type MovieSummary = {
  id: number;
  /** Never empty. Falls back to the original title, then to 'Untitled'. */
  title: string;
  releaseYear: number | null;
  /** Absolute, pre-sized URL. `null` means the UI must render a placeholder tile. */
  posterUrl: string | null;
  /** 0-10, one decimal place. `null` when voteCount is 0 — never shown as "0.0". */
  rating: number | null;
  voteCount: number;
  genreIds: number[];
  popularity: number | null;
};

export type CastMember = {
  id: number;
  /** Never empty; entries without a usable name are dropped server-side. */
  name: string;
  /** The role played. `null` when TMDB has no character credited. */
  character: string | null;
  /** Absolute, pre-sized headshot URL. `null` means render an initials tile. */
  profileUrl: string | null;
};

/** A YouTube trailer. The client builds the watch URL from `key`. */
export type Trailer = {
  key: string;
  name: string;
};

export type MovieDetail = MovieSummary & {
  /** Empty/whitespace upstream values are normalized to `null`. */
  overview: string | null;
  backdropUrl: string | null;
  /** 'YYYY-MM-DD', validated. Garbage dates become `null`. */
  releaseDate: string | null;
  /** A runtime of 0 upstream becomes `null`. */
  runtimeMinutes: number | null;
  /** Names resolved; falls back to mapping genreIds through the cached genre list. */
  genres: Genre[];
  tagline: string | null;
  status: string | null;
  originalLanguage: string | null;
  /** Attribution link. Showing this is a TMDB licensing requirement. */
  tmdbUrl: string;
  /** Top-billed cast, ordered by TMDB's billing order. Empty when uncredited. */
  cast: CastMember[];
  /** `null` when no director is credited. */
  director: string | null;
  /** Deduplicated by name. Empty when none credited. */
  writers: string[];
  /** The official YouTube trailer, if TMDB has one. */
  trailer: Trailer | null;
};

/* ------------------------------------------------------- lists + pagination */

export type Paged<T> = {
  items: T[];
  page: number;
  /**
   * The single source of truth for "is there more?".
   *
   * Collapses three separate concerns into one nullable cursor: TMDB's hard
   * 500-page ceiling, the ordinary `page >= totalPages` end, and search-mode
   * quirks. The client does no arithmetic — `getNextPageParam: (last) =>
   * last.nextPage` cannot run off the end.
   */
  nextPage: number | null;
  /** Already clamped to the upstream ceiling; not the raw upstream figure. */
  totalPages: number;
  totalResults: number;
};

export type SortKey =
  | 'popularity'
  | 'rating'
  | 'release_date'
  | 'title'
  | 'revenue';

/** A filter the server accepted but could not apply, so the UI can say so. */
export type IgnoredFilter = 'sort' | 'genres';

/**
 * How the response was actually produced.
 *
 * This is the resilience channel: it lets the UI explain itself honestly
 * ("showing saved results, TMDB unreachable"; "sorting doesn't apply while
 * searching") from server-reported facts, with zero client-side inference.
 */
export type ResponseMeta = {
  mode: 'discover' | 'search';
  /** What the server actually used, after clamping and validation. */
  applied: {
    query: string | null;
    genres: number[];
    sort: SortKey;
    page: number;
  };
  ignored: IgnoredFilter[];
  /** Human-readable strings the UI may surface verbatim. */
  notes: string[];
  source: 'live' | 'cache' | 'stale-cache';
  /** True when served despite an upstream failure. Drives the degraded banner. */
  degraded: boolean;
  upstreamStatus: 'ok' | 'unavailable' | 'rate-limited' | 'not-configured';
  /** ISO timestamp of when stale data was stored; `null` when fresh or live. */
  staleAt: string | null;
  /** Items dropped by per-item validation. Proves malformed rows were survived. */
  droppedItems: number;
  /** Items removed by the best-effort genre filter in search mode. */
  filteredOut: number;
  requestId: string;
};

export type MovieListResponse = Paged<MovieSummary> & { meta: ResponseMeta };
export type MovieDetailResponse = { movie: MovieDetail; meta: ResponseMeta };
export type GenreListResponse = { items: Genre[]; meta: ResponseMeta };

/* --------------------------------------------------------------- wishlist */

export type WishlistEntry = {
  movie: MovieSummary;
  /** ISO timestamp. */
  addedAt: string;
};

export type WishlistResponse = {
  items: WishlistEntry[];
  count: number;
  meta: ResponseMeta;
};

/** Cheap heart-state sync for the grid — ids only, no payloads. */
export type WishlistIdsResponse = { ids: number[] };

export type WishlistItemResponse = { item: WishlistEntry };

/** One queued offline write. `movie` lets the server snapshot without a fetch. */
export type WishlistOp = {
  op: 'add' | 'remove';
  movieId: number;
  movie?: MovieSummary;
  /** ISO timestamp, used for last-write-wins resolution. */
  at: string;
};

export type WishlistSyncRequest = { ops: WishlistOp[] };

export type WishlistSyncResponse = {
  items: WishlistEntry[];
  applied: number;
  rejected: number;
};

/* ----------------------------------------------------------------- errors */

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'MISSING_DEVICE_ID'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_MISCONFIGURED'
  | 'INTERNAL';

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Drives both the client retry predicate and whether the UI offers Retry. */
    retryable: boolean;
    requestId: string;
    details?: unknown;
  };
};

/* ----------------------------------------------------------------- health */

export type BreakerState = 'closed' | 'open' | 'half-open';

export type FaultMode =
  | 'off'
  | 'slow'
  | 'fail'
  | 'rate-limit'
  | 'malformed'
  | 'empty';

/**
 * Powers the Status screen. The backend's caching, breaking and limiting are
 * invisible in a movie grid, so they are reported here instead of merely claimed.
 */
export type HealthResponse = {
  status: 'ok' | 'degraded';
  version: string;
  uptimeMs: number;
  tmdb: {
    configured: boolean;
    breaker: BreakerState;
    consecutiveFailures: number;
    lastErrorAt: string | null;
    lastErrorCode: string | null;
  };
  cache: {
    l1Entries: number;
    l2Entries: number;
    hits: number;
    misses: number;
    staleServes: number;
    hitRate: number;
  };
  /** Compare against request count to demonstrate coalescing and caching. */
  upstreamCalls: number;
  faultInjection: {
    enabled: boolean;
    mode: FaultMode;
    latencyMs: number;
    failRate: number;
  };
  db: {
    path: string;
    wishlistRows: number;
    movieRows: number;
  };
};

/* -------------------------------------------------- request param contract */

/** Query parameters accepted by `GET /api/movies`, before parsing. */
export type MovieListParams = {
  query?: string;
  /** Comma-separated genre ids, e.g. "28,35". Max 5. */
  genres?: string;
  sort?: SortKey;
  page?: number;
  minRating?: number;
  year?: number;
};

export const SORT_KEYS: readonly SortKey[] = [
  'popularity',
  'rating',
  'release_date',
  'title',
  'revenue',
];

/** Labels live with the contract so the app and any docs cannot disagree. */
export const SORT_LABELS: Record<SortKey, string> = {
  popularity: 'Popularity',
  rating: 'Rating',
  release_date: 'Newest',
  title: 'Title',
  revenue: 'Revenue',
};
