import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes
} from 'node:crypto';

const SYM_ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

export function generateRsaKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return { publicKey, privateKey };
}

export function fingerprintPublicKey(publicKey) {
  return createHash('sha256').update(publicKey).digest('hex');
}

export function encryptLetter(publicKey, plaintext, metadata = {}) {
  const symmetricKey = randomBytes(32);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(SYM_ALGO, symmetricKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encryptedKey = publicEncrypt(publicKey, symmetricKey);

  return {
    encryptedKey: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    metadata,
    createdAt: new Date().toISOString()
  };
}

export function decryptLetter(privateKey, payload) {
  const symmetricKey = privateDecrypt(privateKey, Buffer.from(payload.encryptedKey, 'base64'));
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const decipher = createDecipheriv(SYM_ALGO, symmetricKey, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return { plaintext, metadata: payload.metadata, createdAt: payload.createdAt };
}

export function hashPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function buildBlockHash(block) {
  const copy = { ...block };
  delete copy.hash;
  return hashPayload(copy);
}
