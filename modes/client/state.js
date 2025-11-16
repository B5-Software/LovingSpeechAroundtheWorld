import path from 'node:path';
import { encryptLetter, fingerprintPublicKey, decryptLetter } from '../../src/lib/crypto.js';
import { BlockStore } from '../../src/lib/blockchain.js';
import { modeDataPath } from '../../src/lib/paths.js';
import { ModeConfig } from '../../src/lib/modeConfig.js';
import { fetchJson, safeFetch } from '../../src/lib/network.js';
import { chooseRelay } from '../../src/lib/sync.js';
import { createLogger } from '../../src/lib/logger.js';
import { SecureKeyVault } from '../../src/lib/secureKeyVault.js';

const logger = createLogger('client-state');

export class ClientState {
  constructor() {
    this.vault = new SecureKeyVault('client');
    this.blockStore = null; // 延迟初始化，根据 directoryUrl 确定路径
    this.config = new ModeConfig('client', {
      directoryUrl: 'http://localhost:4600',
      preferredRelay: 'http://localhost:4700'
    });
  }

  // 从 URL 提取域名作为目录名
  getDirectoryDomain(directoryUrl) {
    if (!directoryUrl) return 'default';
    try {
      const url = new URL(directoryUrl);
      // 移除端口号，只保留域名，例如 example.com:4600 -> example.com
      return url.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    } catch {
      // 如果解析失败，使用默认
      return 'default';
    }
  }

  // 获取或创建对应目录的 BlockStore
  async getBlockStore() {
    const cfg = await this.config.get();
    const domain = this.getDirectoryDomain(cfg.directoryUrl);
    const blocksDir = path.join(modeDataPath('client'), 'blocks', domain);
    const blockFilePath = path.join(blocksDir, 'blocks.json');
    
    // 如果已有 BlockStore 且路径匹配，直接返回
    if (this.blockStore && this.blockStore.filePath === blockFilePath) {
      return this.blockStore;
    }
    
    // 创建新的 BlockStore
    logger.info(`初始化区块存储: ${blockFilePath}`);
    this.blockStore = new BlockStore({ filePath: blockFilePath });
    await this.blockStore.init();
    return this.blockStore;
  }

  async init() {
    await this.config.get();
    await this.getBlockStore(); // 初始化 BlockStore
  }

  decodeVaultKey(rawKey) {
    if (!rawKey) {
      throw new Error('缺少密钥凭证');
    }
    return Buffer.isBuffer(rawKey) ? rawKey : Buffer.from(rawKey, 'base64');
  }

  async listKeys(user) {
    return this.vault.listKeys(user.id, this.decodeVaultKey(user.vaultKey));
  }

  async createKey(user, label) {
    return this.vault.createKey(user.id, this.decodeVaultKey(user.vaultKey), label);
  }

  async importKey(user, label, publicKey, privateKey) {
    return this.vault.importKey(user.id, this.decodeVaultKey(user.vaultKey), {
      label,
      publicKey,
      privateKey
    });
  }

  async composeLetter(user, { keyId, text, metadata = {}, relayUrl }) {
    const key = await this.vault.findKey(user.id, this.decodeVaultKey(user.vaultKey), keyId);
    if (!key) throw new Error('Key not found');
    const payload = encryptLetter(key.publicKey, text, metadata);
    const ownerFingerprint = fingerprintPublicKey(key.publicKey);
    
    // 优先使用参数指定的 relayUrl，其次使用配置的 preferredRelay，最后从目录自动选择
    const cfg = await this.config.get();
    let targetRelay = relayUrl || cfg.preferredRelay;
    
    if (!targetRelay && cfg.directoryUrl) {
      const relay = await chooseRelay(cfg.directoryUrl);
      targetRelay = relay?.publicAccessUrl || relay?.publicUrl || relay?.onion;
    }
    
    if (!targetRelay) throw new Error('No relay URL configured');
    
    const endpoint = `${targetRelay.replace(/\/$/, '')}/api/letters`;
    await fetchJson(endpoint, {
      method: 'POST',
      body: {
        payload,
        ownerFingerprint,
        relayMetrics: metadata.metrics ?? {}
      }
    });
    return { ownerFingerprint, relay: targetRelay };
  }

  async syncBlocks() {
    const cfg = await this.config.get();
    let relayUrl = cfg.preferredRelay;
    if (!relayUrl && cfg.directoryUrl) {
      const relay = await chooseRelay(cfg.directoryUrl);
      relayUrl = relay?.publicAccessUrl || relay?.publicUrl || relay?.onion;
    }
    if (!relayUrl) {
      return { updated: false, reason: 'No relay to sync from' };
    }
    const endpoint = `${relayUrl.replace(/\/$/, '')}/api/blocks/full`;
    const data = await safeFetch(endpoint);
    if (!data?.blocks) {
      return { updated: false, reason: 'Relay did not provide blocks' };
    }
    const blockStore = await this.getBlockStore();
    const result = await blockStore.syncFromRemote(data.blocks);
    return { ...result, relayUrl };
  }

  async findLetters(user, keyId) {
    const key = await this.vault.findKey(user.id, this.decodeVaultKey(user.vaultKey), keyId);
    if (!key) throw new Error('Key not found');
    const fingerprint = fingerprintPublicKey(key.publicKey);
    const blockStore = await this.getBlockStore();
    const entries = await blockStore.findLettersByFingerprint(fingerprint);
    return entries.map(({ block, letter }) => {
      try {
        const data = decryptLetter(key.privateKey, letter.payload);
        return {
          blockIndex: block.index,
          timestamp: block.timestamp,
          plaintext: data.plaintext,
          metadata: data.metadata
        };
      } catch (err) {
        logger.warn('Failed to decrypt letter', err.message);
        return {
          blockIndex: block.index,
          timestamp: block.timestamp,
          plaintext: '[decryption failed]',
          metadata: {}
        };
      }
    });
  }

  async updateConfig(partial) {
    return this.config.update(partial);
  }
}
