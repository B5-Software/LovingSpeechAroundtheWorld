export function scoreRelay(relay) {
  if (!relay) return 0;
  const latency = Number(relay.latencyMs ?? 1500);
  const latencyScore = Math.max(0, 1 - Math.min(latency, 3000) / 3000);
  const reachabilityScore = relay.reachability ?? 0.5;
  const freshnessScore = relay.chainFreshness ?? 0.5;
  const gfwPenalty = relay.gfwBlocked ? 0.2 : 1;
  return (latencyScore * 0.5 + reachabilityScore * 0.25 + freshnessScore * 0.25) * gfwPenalty;
}

export function selectBestRelay(relays = []) {
  return [...relays]
    .map((relay) => ({ relay, score: scoreRelay(relay) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.relay)[0];
}
