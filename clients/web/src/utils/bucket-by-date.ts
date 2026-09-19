/**
 * Group timestamped items into the date bands a long history reads best in:
 * Today, Yesterday, Previous 7 days, Previous 30 days, then one band per
 * calendar month.
 *
 * Pure, and `now` is a parameter, so a caller can render the same grouping a
 * test asserts. Labels are not produced here: the four relative bands are
 * translated copy and a month band is formatted in the reader's locale, both
 * of which belong to the surface rendering them.
 *
 * Boundaries are local calendar midnights computed through the `Date`
 * constructor rather than by subtracting 86_400_000 milliseconds, so a band
 * still ends at midnight across a daylight-saving transition.
 */

/** Which band an item landed in. `month` is 0-indexed, as `Date` reports it. */
export type DateBucketId =
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "previous7Days" }
  | { kind: "previous30Days" }
  | { kind: "month"; year: number; month: number };

export interface DateBucket<T> {
  /** Stable, collision-free identity for React keys and scroll anchors. */
  key: string;
  id: DateBucketId;
  items: T[];
}

/** Epoch ms of local midnight `offsetDays` from the day `date` falls in. */
function localDayStart(date: Date, offsetDays = 0): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + offsetDays,
  ).getTime();
}

export function dateBucketKey(id: DateBucketId): string {
  return id.kind === "month" ? `month:${id.year}-${id.month}` : id.kind;
}

function bucketIdFor(timestamp: number, now: Date): DateBucketId {
  const today = localDayStart(now);
  if (timestamp >= today) {
    return { kind: "today" };
  }
  if (timestamp >= localDayStart(now, -1)) {
    return { kind: "yesterday" };
  }
  if (timestamp >= localDayStart(now, -7)) {
    return { kind: "previous7Days" };
  }
  if (timestamp >= localDayStart(now, -30)) {
    return { kind: "previous30Days" };
  }
  const date = new Date(timestamp);
  return { kind: "month", year: date.getFullYear(), month: date.getMonth() };
}

/** Newest band first, with the four relative bands ahead of every month. */
const RELATIVE_ORDER: DateBucketId["kind"][] = [
  "today",
  "yesterday",
  "previous7Days",
  "previous30Days",
];

/** Rank inside the fixed band order; every month sorts after all four. */
function bandRank(id: DateBucketId): number {
  return id.kind === "month"
    ? RELATIVE_ORDER.length
    : RELATIVE_ORDER.indexOf(id.kind);
}

function compareBuckets<T>(a: DateBucket<T>, b: DateBucket<T>): number {
  const byBand = bandRank(a.id) - bandRank(b.id);
  if (byBand !== 0 || a.id.kind !== "month" || b.id.kind !== "month") {
    return byBand;
  }
  return b.id.year - a.id.year || b.id.month - a.id.month;
}

/**
 * Band `items` by the instant `getTime` reads off each one, newest band first.
 * Items keep their relative order inside a band, so a recency-sorted input
 * stays recency-sorted throughout. An item with no usable instant is dropped:
 * a row with no date cannot be placed under a date heading, and inventing one
 * would file it under today.
 */
export function bucketByDate<T>(
  items: readonly T[],
  getTime: (item: T) => number | null | undefined,
  now: Date,
): DateBucket<T>[] {
  const buckets = new Map<string, DateBucket<T>>();
  for (const item of items) {
    const timestamp = getTime(item);
    if (timestamp == null || !Number.isFinite(timestamp)) {
      continue;
    }
    const id = bucketIdFor(timestamp, now);
    const key = dateBucketKey(id);
    const existing = buckets.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      buckets.set(key, { key, id, items: [item] });
    }
  }
  /* Sorted rather than emitted in first-seen order: the caller's input is
     recency-ordered in practice but nothing here depends on that, and a band
     order that changes with the input is a band order nobody can test. */
  return [...buckets.values()].sort(compareBuckets);
}
