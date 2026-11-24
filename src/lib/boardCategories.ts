/** Each board has its own competitive groups, with one unlimited zero group. */
export function boardCategory<T extends { rank?: number | null }>(
  rows: readonly T[],
  viewerId: string | null | undefined,
  identity: (row: T) => string,
  value: (row: T) => number,
) {
  const score = (row: T) => Number(value(row)) || 0;
  const ranked = [...rows].sort((a, b) => score(b) - score(a)
    || Number(a.rank ?? Number.MAX_SAFE_INTEGER) - Number(b.rank ?? Number.MAX_SAFE_INTEGER)
    || identity(a).localeCompare(identity(b)));
  const competitive = ranked.filter((row) => score(row) !== 0);
  const zero = ranked.filter((row) => score(row) === 0);
  if (zero.some((row) => identity(row) === viewerId) || competitive.length === 0 && zero.length > 0) {
    return { rows: zero, label: 'Zero-score category', observer: !zero.some((row) => identity(row) === viewerId) };
  }
  const index = competitive.findIndex((row) => identity(row) === viewerId);
  const start = Math.floor(Math.max(index, 0) / 10) * 10;
  const group = competitive.slice(start, start + 10);
  return { rows: group, label: group.length ? `Positions ${start + 1}–${start + group.length}` : 'Unranked', observer: index < 0 };
}
