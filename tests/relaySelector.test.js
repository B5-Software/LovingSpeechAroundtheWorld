import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBestRelay } from '../src/lib/relaySelector.js';

test('selects relay with lowest latency and good reachability', () => {
  const relays = [
    { onion: 'a', latencyMs: 400, reachability: 0.9, chainFreshness: 0.9 },
    { onion: 'b', latencyMs: 120, reachability: 0.8, chainFreshness: 0.95 },
    { onion: 'c', latencyMs: 90, reachability: 0.4, chainFreshness: 0.3 }
  ];
  const best = selectBestRelay(relays);
  assert.equal(best.onion, 'b');
});
