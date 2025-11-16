import path from 'node:path';
import { JsonStore } from './jsonStore.js';
import { buildBlockHash, hashPayload } from './crypto.js';

function createGenesisBlock() {
  const block = {
    index: 0,
    timestamp: new Date().toISOString(),
    previousHash: null,
    letters: [],
    relayMetrics: {},
    summary: 'Genesis block',
    hash: ''
  };
  block.hash = buildBlockHash(block);
  return block;
}

export class BlockStore {
  constructor(options) {
    const { filePath } = options;
    if (!filePath) throw new Error('filePath is required for BlockStore');
    this.filePath = path.resolve(filePath);
    this.store = new JsonStore(this.filePath, { blocks: [] });
  }

  async init() {
    const data = await this.store.get();
    if (!data.blocks || data.blocks.length === 0) {
      await this.store.update(() => ({ blocks: [createGenesisBlock()] }));
    }
    return this;
  }

  async getBlocks() {
    const data = await this.store.get();
    return data.blocks;
  }

  async getLatestBlock() {
    const blocks = await this.getBlocks();
    return blocks[blocks.length - 1];
  }

  async appendLetterBlock(letterPayload, ownerFingerprint, relayMetrics = {}) {
    const blocks = await this.getBlocks();
    const previousBlock = blocks[blocks.length - 1];
    const block = {
      index: previousBlock.index + 1,
      timestamp: new Date().toISOString(),
      previousHash: previousBlock.hash,
      letters: [
        {
          ownerFingerprint,
          payload: letterPayload
        }
      ],
      relayMetrics,
      summary: `Love letter for ${ownerFingerprint.slice(0, 8)}`,
      hash: ''
    };
    block.hash = buildBlockHash(block);
    await this.store.update(() => ({ blocks: [...blocks, block] }));
    return block;
  }

  static validateChain(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return { ok: false, reason: 'Empty chain' };
    }
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      const { hash, ...rest } = block;
      const computedHash = buildBlockHash({ ...rest });
      if (computedHash !== hash) {
        return { ok: false, reason: `Hash mismatch at index ${block.index}` };
      }
      if (i > 0 && block.previousHash !== blocks[i - 1].hash) {
        return { ok: false, reason: `Broken link at index ${block.index}` };
      }
    }
    return { ok: true };
  }

  async getManifest() {
    const blocks = await this.getBlocks();
    return blocks.map((block) => ({ index: block.index, hash: block.hash, timestamp: block.timestamp }));
  }

  async getGenesisHash() {
    const blocks = await this.getBlocks();
    return blocks?.[0]?.hash ?? null;
  }

  async computeChecksum() {
    const manifest = await this.getManifest();
    return hashPayload(manifest);
  }

  async getChainSummary() {
    const blocks = await this.getBlocks();
    const hashes = blocks.map((block) => block.hash);
    return {
      length: blocks.length,
      hashes,
      latestHash: hashes[hashes.length - 1] ?? null,
      checksum: await this.computeChecksum()
    };
  }

  async syncFromRemote(remoteBlocks, options = {}) {
    const { force = false } = options;
    const validation = BlockStore.validateChain(remoteBlocks);
    if (!validation.ok) {
      throw new Error(`Remote chain invalid: ${validation.reason}`);
    }
    const localBlocks = await this.getBlocks();
    if (!force && remoteBlocks.length <= localBlocks.length) {
      return { updated: false, message: 'Remote chain not longer than local' };
    }
    await this.store.update(() => ({ blocks: remoteBlocks }));
    return {
      updated: true,
      message: force ? 'Chain replaced with remote copy (forced)' : 'Chain replaced with remote copy'
    };
  }

  async findLettersByFingerprint(fingerprint) {
    const blocks = await this.getBlocks();
    return blocks
      .flatMap((block) => block.letters.map((letter) => ({ block, letter })))
      .filter((entry) => entry.letter.ownerFingerprint === fingerprint);
  }
}
