import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { modeDataPath } from './paths.js';
import { generateRsaKeyPair, fingerprintPublicKey } from './crypto.js';

const VAULT_FILENAME = 'keys.enc';

function toBuffer(keyLike) {
  if (!keyLike) {
    throw new Error('Missing vault key');
  }
  if (Buffer.isBuffer(keyLike)) {
    return keyLike;
  }
  return Buffer.from(keyLike, 'base64');
}

function encryptPayload(key, data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64')
  };
}

function decryptPayload(key, payload) {
  if (!payload) return null;
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

export class SecureKeyVault {
  constructor(mode = 'client') {
    this.usersDir = path.join(modeDataPath(mode), 'users');
  }

  async ensureUserDir(userId) {
    const dir = path.join(this.usersDir, userId);
    await fs.ensureDir(dir);
    return dir;
  }

  async initializeVault(userId, vaultKey) {
    const dir = await this.ensureUserDir(userId);
    const filePath = path.join(dir, VAULT_FILENAME);
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      await fs.writeJson(filePath, encryptPayload(toBuffer(vaultKey), { keys: [] }), { spaces: 2 });
    }
  }

  async readKeys(userId, vaultKey) {
    const dir = await this.ensureUserDir(userId);
    const filePath = path.join(dir, VAULT_FILENAME);
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      return [];
    }
    const payload = await fs.readJson(filePath);
    const data = decryptPayload(toBuffer(vaultKey), payload);
    if (!data || !Array.isArray(data.keys)) {
      throw new Error('密钥库损坏或密码不匹配');
    }
    return data.keys;
  }

  async writeKeys(userId, vaultKey, keys) {
    const dir = await this.ensureUserDir(userId);
    const filePath = path.join(dir, VAULT_FILENAME);
    const payload = encryptPayload(toBuffer(vaultKey), { keys });
    await fs.writeJson(filePath, payload, { spaces: 2 });
    return keys;
  }

  async listKeys(userId, vaultKey) {
    return this.readKeys(userId, vaultKey);
  }

  async findKey(userId, vaultKey, keyId) {
    const keys = await this.readKeys(userId, vaultKey);
    return keys.find((key) => key.id === keyId);
  }

  async createKey(userId, vaultKey, label) {
    const keys = await this.readKeys(userId, vaultKey);
    const keyPair = generateRsaKeyPair();
    const fingerprint = fingerprintPublicKey(keyPair.publicKey);
    const entry = {
      id: fingerprint,
      label: label || `key-${fingerprint.slice(0, 6)}`,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      createdAt: new Date().toISOString()
    };
    keys.push(entry);
    await this.writeKeys(userId, vaultKey, keys);
    return entry;
  }

  async importKey(userId, vaultKey, { label, publicKey, privateKey }) {
    const keys = await this.readKeys(userId, vaultKey);
    const fingerprint = fingerprintPublicKey(publicKey);
    const entry = {
      id: fingerprint,
      label: label || `key-${fingerprint.slice(0, 6)}`,
      publicKey,
      privateKey,
      createdAt: new Date().toISOString()
    };
    const filtered = keys.filter((key) => key.id !== fingerprint);
    filtered.push(entry);
    await this.writeKeys(userId, vaultKey, filtered);
    return entry;
  }

  async rotateKey(userId, oldVaultKey, newVaultKey) {
    const keys = await this.readKeys(userId, oldVaultKey);
    await this.writeKeys(userId, newVaultKey, keys);
  }
}
