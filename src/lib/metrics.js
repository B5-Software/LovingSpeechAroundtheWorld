export function normalizeLatency(latencyMs) {
  if (!latencyMs || latencyMs <= 0) return 1;
  const clamped = Math.min(latencyMs, 5000);
  return 1 - clamped / 5000;
}

export function buildRelayMetrics({ latencyMs, gfwBlocked, reachability, notes }) {
  return {
    latencyMs: latencyMs ?? null,
    gfwBlocked: Boolean(gfwBlocked),
    reachability: reachability ?? 0.5,
    notes: notes || ''
  };
}
