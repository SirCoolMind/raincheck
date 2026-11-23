// PURE display formatting.
export function formatMmh(v: number | null): string {
  if (v === null) return '—';
  if (v === 0) return '0';
  return `${v.toFixed(1)} mm/h`;
}

export function formatAgo(ms: number, nowMs: number): string {
  const min = Math.floor((nowMs - ms) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ago`;
}

export function formatProb(p: number | null): string {
  return p === null ? '—' : `${Math.round(p)}%`;
}
