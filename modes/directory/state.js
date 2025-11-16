import path from 'node:path';
import { JsonStore } from '../../src/lib/jsonStore.js';
import { modeDataPath } from '../../src/lib/paths.js';
import { selectBestRelay } from '../../src/lib/relaySelector.js';

const defaults = {
  relays: [],
  canonicalManifest: { hashes: [], length: 0, checksum: '', latestHash: '' }
};

function compareManifests(canonical, candidate) {
  if (!canonical?.hashes?.length) return { matches: true };
  if (!candidate?.hashes?.length) {
    return { matches: false, missing: canonical.hashes };
  }
  const minLength = Math.min(canonical.hashes.length, candidate.hashes.length);
  for (let i = 0; i < minLength; i += 1) {
    if (canonical.hashes[i] !== candidate.hashes[i]) {
      return { matches: false, divergeAt: i };
    }
  }
  if (candidate.hashes.length < canonical.hashes.length) {
    return { matches: false, missingCount: canonical.hashes.length - candidate.hashes.length };
  }
  return { matches: true };
}

export class DirectoryState {
  constructor() {
    const filePath = path.join(modeDataPath('directory'), 'directory-state.json');
    this.store = new JsonStore(filePath, defaults);
  }

  async listRelays() {
    const data = await this.store.get();
    return data.relays;
  }

  async upsertRelay(payload) {
    const state = await this.store.get();
    let existing = state.relays.find((relay) => relay.onion === payload.onion);
    if (existing) {
      existing = {
        ...existing,
        ...payload,
        connectionMeta: { ...existing.connectionMeta, ...payload.connectionMeta },
        lastSeen: new Date().toISOString()
      };
    } else {
      const resolvedFingerprint = payload.fingerprint || this.generateFingerprint(payload.onion);
      existing = {
        id: payload.onion,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        ...payload,
        fingerprint: resolvedFingerprint
      };
      state.relays.push(existing);
    }
    const canonicalManifest = this.updateCanonicalManifest(state.canonicalManifest, existing.chainSummary);
    const comparison = compareManifests(canonicalManifest, existing.chainSummary);
    existing.syncStatus = {
      needsSync: Boolean(comparison.missingCount),
      needsRepair: comparison.matches === false && !comparison.missingCount,
      details: comparison
    };
    const relays = state.relays.map((relay) => (relay.onion === existing.onion ? existing : relay));
    await this.store.update(() => ({ relays, canonicalManifest }));
    return existing;
  }

  async updateRelayMetrics(onion, metricsUpdate = {}) {
    const sampledAt = metricsUpdate.metricsSampledAt || new Date().toISOString();
    await this.store.update((data) => {
      const relays = data.relays.map((relay) => {
        if (relay.onion !== onion) return relay;
        return {
          ...relay,
          latencyMs: metricsUpdate.latencyMs ?? relay.latencyMs ?? null,
          reachability:
            typeof metricsUpdate.reachability === 'number'
              ? metricsUpdate.reachability
              : relay.reachability ?? null,
          gfwBlocked:
            typeof metricsUpdate.gfwBlocked === 'boolean'
              ? metricsUpdate.gfwBlocked
              : relay.gfwBlocked ?? false,
          metricsSampledAt: sampledAt,
          metricsSource: metricsUpdate.metricsSource || 'directory-probe',
          metricsNotes: metricsUpdate.metricsNotes ?? relay.metricsNotes ?? null,
          metricsError: metricsUpdate.metricsError ?? null
        };
      });
      return { ...data, relays };
    });
  }

  updateCanonicalManifest(currentManifest, candidateSummary = {}) {
    if (!candidateSummary) return currentManifest;
    if ((candidateSummary.length ?? 0) > (currentManifest.length ?? 0)) {
      return candidateSummary;
    }
    return currentManifest;
  }

  async setCanonicalManifest(summary) {
    await this.store.update((data) => ({ ...data, canonicalManifest: summary }));
    return summary;
  }

  async getCanonicalManifest() {
    const data = await this.store.get();
    return data.canonicalManifest;
  }

  async getRelayByOnion(onion) {
    const relays = await this.listRelays();
    return relays.find((relay) => relay.onion === onion);
  }

  async findBestRelay() {
    const relays = await this.listRelays();
    return selectBestRelay(relays);
  }

  generateFingerprint(onion) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    const hash = onion?.substring(0, 16) || 'unknown';
    return `${hash}-${timestamp}-${random}`.toUpperCase();
  }
}
