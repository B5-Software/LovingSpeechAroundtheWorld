import path from 'node:path';
import { JsonStore } from './jsonStore.js';
import { generateRsaKeyPair, fingerprintPublicKey } from './crypto.js';
import { modeDataPath } from './paths.js';

export class KeyManager {
  constructor(mode = 'client') {
    const filePath = path.join(modeDataPath(mode), 'keys.json');
    this.store = new JsonStore(filePath, { keys: [] });
  }

  async init() {
    await this.store.get();
    return this;
  }

  async list() {
    const data = await this.store.get();
    return data.keys;
  }

  async create(label) {
    const keyPair = generateRsaKeyPair();
    const fingerprint = fingerprintPublicKey(keyPair.publicKey);
    const entry = {
      id: fingerprint,
      label: label || `key-${fingerprint.slice(0, 6)}`,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      createdAt: new Date().toISOString()
    };
    await this.store.update((data) => ({ keys: [...data.keys, entry] }));
    return entry;
  }

  async findById(id) {
    const keys = await this.list();
    return keys.find((key) => key.id === id);
  }

  async importKey(label, publicKey, privateKey) {
    const fingerprint = fingerprintPublicKey(publicKey);
    const entry = {
      id: fingerprint,
      label: label || `key-${fingerprint.slice(0, 6)}`,
      publicKey,
      privateKey,
      createdAt: new Date().toISOString()
    };
    await this.store.update((data) => ({
      keys: [...data.keys.filter((key) => key.id !== fingerprint), entry]
    }));
    return entry;
  }
}
