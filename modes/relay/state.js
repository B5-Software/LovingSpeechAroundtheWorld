import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'fs-extra';
import { BlockStore } from '../../src/lib/blockchain.js';
import { modeDataPath } from '../../src/lib/paths.js';
import { ModeConfig } from '../../src/lib/modeConfig.js';
import { buildRelayMetrics } from '../../src/lib/metrics.js';
import { fetchJson, safeFetch } from '../../src/lib/network.js';
import { chooseRelay } from '../../src/lib/sync.js';
import { createLogger } from '../../src/lib/logger.js';
import { JsonStore } from '../../src/lib/jsonStore.js';

const logger = createLogger('relay-state');
const BLOCKS_FILENAME = 'blocks.json';
const FALLBACK_CHAIN_PREFIX = 'bootstrap';
const QUEUE_FILENAME = 'pending-letters.json';
const DEFAULT_RETRY_DELAY_MS = 2000;

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
}

export class RelayState {
  constructor() {
    this.dataRoot = modeDataPath('relay');
    this.chainRoot = path.join(this.dataRoot, 'chains');
    this.legacyBlocksPath = path.join(this.dataRoot, BLOCKS_FILENAME);
    this.blockStore = null;
    this.identityStore = new JsonStore(path.join(this.dataRoot, 'identity.json'), { fingerprint: null, createdAt: null });
    this.fingerprint = null;
    this.currentGenesisHash = null;
    this.config = new ModeConfig('relay', {
      directoryUrl: 'http://localhost:4600',
      onion: 'relay.local',
      publicUrl: 'http://localhost:4700',
      publicAccessUrl: '',
      metrics: buildRelayMetrics({ reachability: 0.9, latencyMs: 120 }),
      activeGenesisHash: null
    });
    this.lastReportInfo = { delivered: false, timestamp: null, reason: 'init', consecutiveFailures: 0 };
    this._reportPromise = null;
    this._reportRetryTimer = null;
    this.consecutiveReportFailures = 0;
    this._preWriteSyncPromise = null;
    this.lastPreWriteSync = null;
    this.lastSyncTime = null;
    this.queueStore = new JsonStore(path.join(this.dataRoot, QUEUE_FILENAME), { queue: [] });
    this.pendingQueue = [];
    this.queueDeferred = new Map();
    this.processingQueue = false;
    this.lastQueueError = null;
    this.lastConflictInfo = null;
  }

  async init() {
    await fs.ensureDir(this.chainRoot);
    await this.migrateLegacyChainIfNeeded();
    const cfg = await this.config.get();
    const normalizedConfig = await this.ensurePublicAccessAlignment(cfg);
    const activeConfig = normalizedConfig || cfg;
    await this.ensureFingerprint(activeConfig.onion);
    await this.ensureChainForGenesis(activeConfig.activeGenesisHash, { allowRenameToActual: !activeConfig.activeGenesisHash });
    await this.loadPendingQueue();
    this.processQueueSoon();
  }

  async ensurePublicAccessAlignment(cfg) {
    if (!cfg) return null;
    const sanitizedAccessUrl = normalizeUrl(cfg.publicAccessUrl);
    if (!sanitizedAccessUrl) {
      if (cfg.publicAccessUrl !== '') {
        return this.config.update({ publicAccessUrl: '' });
      }
      return cfg;
    }
    const currentPublicUrl = normalizeUrl(cfg.publicUrl);
    if (currentPublicUrl === sanitizedAccessUrl && cfg.publicAccessUrl === sanitizedAccessUrl) {
      return cfg;
    }
    return this.config.update({
      publicAccessUrl: sanitizedAccessUrl,
      publicUrl: sanitizedAccessUrl
    });
  }

  async ensureFingerprint(onion) {
    if (this.fingerprint) {
      return this.fingerprint;
    }
    const identity = await this.identityStore.get();
    if (identity?.fingerprint) {
      this.fingerprint = identity.fingerprint;
      return this.fingerprint;
    }
    const fingerprint = this.generateFingerprint(onion);
    await this.identityStore.update(() => ({ fingerprint, createdAt: new Date().toISOString() }));
    this.fingerprint = fingerprint;
    return fingerprint;
  }

  generateFingerprint(onion) {
    const seed = `${onion || 'relay'}-${randomUUID()}-${Date.now()}`;
    return createHash('sha256').update(seed).digest('hex').slice(0, 48).toUpperCase();
  }

  async acceptLetter(letterPayload, ownerFingerprint, relayMetrics = {}) {
    return this.enqueueLetter({ letterPayload, ownerFingerprint, relayMetrics });
  }

  async loadPendingQueue() {
    const snapshot = await this.queueStore.get();
    this.pendingQueue = snapshot.queue ?? [];
  }

  async persistQueue() {
    await this.queueStore.update(() => ({ queue: this.pendingQueue }));
  }

  async enqueueLetter({ letterPayload, ownerFingerprint, relayMetrics = {} }) {
    const entry = {
      id: randomUUID(),
      letterPayload,
      ownerFingerprint,
      relayMetrics,
      enqueuedAt: new Date().toISOString(),
      attempts: 0
    };
    this.pendingQueue.push(entry);
    await this.persistQueue();
    const deferred = createDeferred();
    this.queueDeferred.set(entry.id, deferred);
    this.processQueueSoon();
    return deferred.promise;
  }

  processQueueSoon() {
    if (this.processingQueue) {
      return;
    }
    this.processingQueue = true;
    queueMicrotask(() => {
      this.drainQueue().catch((err) => {
        logger.error('Letter queue processor crashed', err.message);
        this.lastQueueError = { message: err.message, at: new Date().toISOString() };
        this.processingQueue = false;
        if (this.pendingQueue.length > 0) {
          setTimeout(() => this.processQueueSoon(), DEFAULT_RETRY_DELAY_MS);
        }
      });
    });
  }

  async drainQueue() {
    while (this.pendingQueue.length > 0) {
      const entry = this.pendingQueue[0];
      try {
        const block = await this.processQueueEntry(entry);
        this.pendingQueue.shift();
        await this.persistQueue();
        this.resolveQueueEntry(entry.id, block);
      } catch (error) {
        const retryable = error?.retryable || error?.statusCode === 503;
        this.lastQueueError = { message: error.message, at: new Date().toISOString() };
        if (retryable) {
          await wait(error.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
          continue;
        }
        logger.error('Dropping queue entry after unrecoverable failure', {
          error: error.message,
          entryId: entry.id
        });
        this.pendingQueue.shift();
        await this.persistQueue();
        this.rejectQueueEntry(entry.id, error);
      }
    }
    this.processingQueue = false;
  }

  async processQueueEntry(entry) {
    entry.attempts += 1;
    await this.ensureFreshChainBeforeWrite();
    const block = await this.blockStore.appendLetterBlock(entry.letterPayload, entry.ownerFingerprint, entry.relayMetrics);
    try {
      await this.reportToDirectory('post-block');
    } catch (err) {
      logger.warn('Post-block directory notification failed', err.message);
    }
    return block;
  }

  resolveQueueEntry(id, payload) {
    const deferred = this.queueDeferred.get(id);
    if (deferred) {
      deferred.resolve(payload);
      this.queueDeferred.delete(id);
    }
  }

  rejectQueueEntry(id, error) {
    const deferred = this.queueDeferred.get(id);
    if (deferred) {
      deferred.reject(error);
      this.queueDeferred.delete(id);
    }
  }

  async clearQueue() {
    this.pendingQueue.forEach((entry) => {
      this.rejectQueueEntry(entry.id, new Error('队列已清空，任务被取消'));
    });
    this.pendingQueue = [];
    await this.persistQueue();
  }

  async getQueueStatus() {
    return {
      pending: this.pendingQueue.length,
      processing: this.processingQueue,
      lastError: this.lastQueueError,
      lastConflict: this.lastConflictInfo,
      items: this.pendingQueue.slice(0, 10).map((entry) => ({
        id: entry.id,
        enqueuedAt: entry.enqueuedAt,
        attempts: entry.attempts,
        ownerFingerprint: entry.ownerFingerprint
      }))
    };
  }

  async detectChainConflict(remoteBlocks) {
    if (!Array.isArray(remoteBlocks) || remoteBlocks.length === 0) {
      return null;
    }
    const localBlocks = await this.blockStore.getBlocks();
    if (!localBlocks.length) {
      return null;
    }
    const minLength = Math.min(localBlocks.length, remoteBlocks.length);
    for (let i = 0; i < minLength; i += 1) {
      if (localBlocks[i].hash !== remoteBlocks[i].hash) {
        return {
          divergeAt: i,
          localBlocks,
          orphanedBlocks: localBlocks.slice(i),
          localHeight: localBlocks.length,
          remoteHeight: remoteBlocks.length,
          shouldReplace: remoteBlocks.length >= localBlocks.length
        };
      }
    }
    return null;
  }

  async snapshotConflictChain(localBlocks) {
    try {
      const genesis = (await this.blockStore.getGenesisHash()) || 'unknown';
      const chainDir = path.join(this.chainRoot, genesis);
      const conflictsDir = path.join(chainDir, 'conflicts');
      await fs.ensureDir(conflictsDir);
      const backupPath = path.join(conflictsDir, `blocks-${Date.now()}.json`);
      await fs.writeJson(backupPath, { blocks: localBlocks }, { spaces: 2 });
      return backupPath;
    } catch (error) {
      logger.error('Failed to snapshot conflict chain', error.message);
      return null;
    }
  }

  async requeueOrphanedLetters(orphanedBlocks = []) {
    const entries = [];
    orphanedBlocks.forEach((block) => {
      (block.letters ?? []).forEach((letter) => {
        entries.push({
          id: randomUUID(),
          letterPayload: letter.payload,
          ownerFingerprint: letter.ownerFingerprint,
          relayMetrics: block.relayMetrics ?? {},
          enqueuedAt: new Date().toISOString(),
          attempts: 0,
          replayedFromBlock: block.index
        });
      });
    });
    if (!entries.length) {
      return 0;
    }
    this.pendingQueue.push(...entries);
    await this.persistQueue();
    this.processQueueSoon();
    return entries.length;
  }

  async getSummary() {
    const summary = await this.blockStore.getChainSummary();
    const config = await this.config.get();
    const queue = await this.getQueueStatus();
    return { summary, config, queue, lastConflict: this.lastConflictInfo };
  }

  async fetchDirectoryProfile() {
    const cfg = await this.config.get();
    if (!cfg.directoryUrl || !cfg.onion) {
      return null;
    }
    const endpoint = `${cfg.directoryUrl.replace(/\/$/, '')}/api/relays`;
    try {
      const payload = await safeFetch(endpoint);
      if (!payload?.relays) {
        return null;
      }
      return payload.relays.find((relay) => relay.onion === cfg.onion) || null;
    } catch (error) {
      logger.debug('Failed to fetch directory profile', error.message);
      return null;
    }
  }

  async listBlocks() {
    return this.blockStore.getBlocks();
  }

  async updateMetrics(partial) {
    const metrics = buildRelayMetrics(partial);
    const config = await this.config.update({ metrics });
    return config.metrics;
  }

  async updateDirectoryUrl(directoryUrl) {
    const config = await this.config.update({ directoryUrl });
    return config.directoryUrl;
  }

  async updateOnion(onion) {
    const config = await this.config.update({ onion });
    return config.onion;
  }

  async updatePublicUrl(publicUrl) {
    const config = await this.config.update({ publicUrl });
    return config.publicUrl;
  }

  async reportToDirectory(trigger = 'manual') {
    if (this._reportPromise) {
      return this._reportPromise;
    }
    const runReport = (async () => {
      const cfg = await this.config.get();
      if (!cfg.directoryUrl) {
        this.consecutiveReportFailures = 0;
        if (this._reportRetryTimer) {
          clearTimeout(this._reportRetryTimer);
          this._reportRetryTimer = null;
        }
        const info = {
          delivered: false,
          skipped: true,
          reason: 'No directoryUrl configured',
          trigger,
          timestamp: new Date().toISOString(),
          consecutiveFailures: this.consecutiveReportFailures
        };
        this.lastReportInfo = info;
        return info;
      }
      const summary = await this.blockStore.getChainSummary();
      const fingerprint = await this.ensureFingerprint(cfg.onion);
      const sanitizedPublicAccessUrl = normalizeUrl(cfg.publicAccessUrl);
      const effectivePublicUrl = sanitizedPublicAccessUrl || cfg.publicUrl;
      const payload = {
        onion: cfg.onion,
        publicUrl: effectivePublicUrl,
        publicAccessUrl: sanitizedPublicAccessUrl,
        nickname: cfg.nickname || cfg.onion?.substring(0, 8) || 'Anonymous',
        fingerprint,
        latencyMs: cfg.metrics?.latencyMs,
        reachability: cfg.metrics?.reachability,
        gfwBlocked: cfg.metrics?.gfwBlocked,
        chainSummary: summary
      };
      try {
        const endpoint = `${cfg.directoryUrl.replace(/\/$/, '')}/api/relays`;
        logger.debug('Reporting relay heartbeat', { endpoint, trigger, height: summary.length });
        const directoryResponse = await fetchJson(endpoint, { method: 'POST', body: payload });
        const directoryGenesis = directoryResponse?.genesisHash || null;
        let genesisMatch = true;
        if (directoryGenesis) {
          const localGenesis = await this.blockStore.getGenesisHash();
          genesisMatch = localGenesis === directoryGenesis;
          await this.ensureChainForGenesis(directoryGenesis);
        }
        this.consecutiveReportFailures = 0;
        if (this._reportRetryTimer) {
          clearTimeout(this._reportRetryTimer);
          this._reportRetryTimer = null;
        }
        const info = {
          delivered: true,
          trigger,
          timestamp: new Date().toISOString(),
          endpoint,
          height: summary.length,
          consecutiveFailures: this.consecutiveReportFailures,
          directoryGenesis,
          genesisMatch
        };
        this.lastReportInfo = info;
        return info;
      } catch (err) {
        this.consecutiveReportFailures += 1;
        const backoffMs = Math.min(30000, 2000 * this.consecutiveReportFailures);
        if (!this._reportRetryTimer) {
          this._reportRetryTimer = setTimeout(() => {
            this._reportRetryTimer = null;
            this.reportToDirectory('retry').catch((retryErr) => {
              logger.warn('Retry directory report failed', retryErr.message);
            });
          }, backoffMs);
          this._reportRetryTimer.unref?.();
        }
        const info = {
          delivered: false,
          error: err.message,
          trigger,
          timestamp: new Date().toISOString(),
          backoffMs,
          consecutiveFailures: this.consecutiveReportFailures
        };
        this.lastReportInfo = info;
        logger.warn('Report to directory failed', err.message);
        return info;
      }
    })()
      .finally(() => {
        this._reportPromise = null;
      });
    this._reportPromise = runReport;
    return runReport;
  }

  async syncFromDirectory() {
    const cfg = await this.config.get();
    if (!cfg.directoryUrl) return { skipped: true };
    const relay = await chooseRelay(cfg.directoryUrl);
    if (!relay || relay.onion === cfg.onion) {
      return { skipped: true, reason: 'No alternate relay available' };
    }
    const baseUrl = relay.publicUrl ?? relay.onion;
    if (!baseUrl) return { skipped: true, reason: 'Relay lacks URL' };
    const target = `${baseUrl.replace(/\/$/, '')}/api/blocks/full`;
    const data = await safeFetch(target);
    if (!data?.blocks) {
      return { skipped: true, reason: 'Failed to fetch blocks' };
    }
    const remoteBlocks = data.blocks;
    const conflict = await this.detectChainConflict(remoteBlocks);
    let backupPath = null;
    let replayedLetters = 0;
    if (conflict?.shouldReplace) {
      backupPath = await this.snapshotConflictChain(conflict.localBlocks);
      replayedLetters = await this.requeueOrphanedLetters(conflict.orphanedBlocks);
      this.lastConflictInfo = {
        resolvedAt: new Date().toISOString(),
        divergeAt: conflict.divergeAt,
        localHeight: conflict.localHeight,
        remoteHeight: conflict.remoteHeight,
        backupPath,
        replayedLetters
      };
      logger.warn('Chain conflict detected, replaced with remote copy', this.lastConflictInfo);
    }
    const result = await this.blockStore.syncFromRemote(remoteBlocks, { force: Boolean(conflict?.shouldReplace) });
    this.lastSyncTime = new Date().toISOString();
    return { relay: relay.onion, conflict: this.lastConflictInfo, ...result };
  }

  async ensureFreshChainBeforeWrite() {
    if (this._preWriteSyncPromise) {
      return this._preWriteSyncPromise;
    }
    const runSync = (async () => {
      const cfg = await this.config.get();
      if (!cfg.directoryUrl) {
        logger.warn('Pre-write sync skipped: no directory configured');
        return { skipped: true, reason: 'No directory configured' };
      }
      try {
        const result = await this.syncFromDirectory();
        this.lastPreWriteSync = { timestamp: new Date().toISOString(), result };
        if (result?.skipped && result.reason !== 'No alternate relay available') {
          const err = new Error(`写入前同步被阻止: ${result.reason || '未知原因'}`);
          err.statusCode = 503;
          throw err;
        }
        return result;
      } catch (error) {
        if (error?.statusCode === 503) {
          throw error;
        }
        const err = new Error('写入前无法同步链数据，请稍后重试');
        err.statusCode = 503;
        logger.warn('Pre-write sync failed', error.message);
        throw err;
      }
    })()
      .finally(() => {
        this._preWriteSyncPromise = null;
      });
    this._preWriteSyncPromise = runSync;
    return runSync;
  }

  async migrateLegacyChainIfNeeded() {
    const exists = await fs.pathExists(this.legacyBlocksPath);
    if (!exists) {
      return null;
    }
    try {
      const legacyData = await fs.readJson(this.legacyBlocksPath);
      const legacyGenesis = legacyData?.blocks?.[0]?.hash ?? null;
      if (!legacyGenesis) {
        logger.warn('Legacy chain missing genesis hash, keeping original file');
        return null;
      }
      const targetDir = path.join(this.chainRoot, legacyGenesis);
      await fs.ensureDir(targetDir);
      const targetPath = path.join(targetDir, BLOCKS_FILENAME);
      await fs.move(this.legacyBlocksPath, targetPath, { overwrite: true });
      logger.info('Migrated legacy blocks.json into isolated chain directory', { targetDir });
      const cfg = await this.config.get();
      if (!cfg.activeGenesisHash) {
        await this.config.update({ activeGenesisHash: legacyGenesis });
      }
      return legacyGenesis;
    } catch (error) {
      logger.error('Failed to migrate legacy chain file', error.message);
      return null;
    }
  }

  async ensureChainForGenesis(genesisHash, { allowRenameToActual = false } = {}) {
    if (genesisHash && this.currentGenesisHash === genesisHash && this.blockStore) {
      return this.currentGenesisHash;
    }

    let targetGenesis = genesisHash || (await this.selectExistingGenesis()) || `${FALLBACK_CHAIN_PREFIX}-${Date.now()}`;
    let chainDir = path.join(this.chainRoot, targetGenesis);
    await fs.ensureDir(chainDir);
    const filePath = path.join(chainDir, BLOCKS_FILENAME);
    this.blockStore = new BlockStore({ filePath });
    await this.blockStore.init();

    if (allowRenameToActual || !genesisHash) {
      const actualGenesis = await this.blockStore.getGenesisHash();
      if (actualGenesis && actualGenesis !== targetGenesis) {
        const normalizedDir = path.join(this.chainRoot, actualGenesis);
        await fs.ensureDir(normalizedDir);
        const normalizedPath = path.join(normalizedDir, BLOCKS_FILENAME);
        await fs.move(filePath, normalizedPath, { overwrite: true });
        await fs.remove(chainDir);
        this.blockStore = new BlockStore({ filePath: normalizedPath });
        await this.blockStore.init();
        targetGenesis = actualGenesis;
        chainDir = normalizedDir;
      }
    }

    this.currentGenesisHash = targetGenesis;
    await this.config.update({ activeGenesisHash: targetGenesis });
    logger.debug('Active chain updated', { chainDir, genesis: targetGenesis });
    return targetGenesis;
  }

  async selectExistingGenesis() {
    const entries = await fs.readdir(this.chainRoot).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(this.chainRoot, entry);
      try {
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          return entry;
        }
      } catch (error) {
        logger.debug('Skipping chain directory candidate due to error', { entry, error: error.message });
      }
    }
    return null;
  }
}
