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
    this.blockStore = new BlockStore({ filePath: path.join(modeDataPath('client'), 'blocks.json') });
    this.config = new ModeConfig('client', {
      directoryUrl: 'http://localhost:4600',
      preferredRelay: 'http://localhost:4700'
    });
  }

  async init() {
    await this.blockStore.init();
    await this.config.get();
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
    const result = await this.blockStore.syncFromRemote(data.blocks);
    return { ...result, relayUrl };
  }

  async findLetters(user, keyId) {
    const key = await this.vault.findKey(user.id, this.decodeVaultKey(user.vaultKey), keyId);
    if (!key) throw new Error('Key not found');
    const fingerprint = fingerprintPublicKey(key.publicKey);
    const entries = await this.blockStore.findLettersByFingerprint(fingerprint);
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
