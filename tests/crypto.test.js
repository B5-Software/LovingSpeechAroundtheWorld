import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRsaKeyPair, encryptLetter, decryptLetter, fingerprintPublicKey } from '../src/lib/crypto.js';

test('encrypt/decrypt roundtrip', () => {
  const { publicKey, privateKey } = generateRsaKeyPair();
  const payload = encryptLetter(publicKey, 'hello world', { title: 'test' });
  const result = decryptLetter(privateKey, payload);
  assert.equal(result.plaintext, 'hello world');
  assert.equal(result.metadata.title, 'test');
});

test('fingerprint is deterministic', () => {
  const { publicKey } = generateRsaKeyPair();
  const fingerprintA = fingerprintPublicKey(publicKey);
  const fingerprintB = fingerprintPublicKey(publicKey);
  assert.equal(fingerprintA, fingerprintB);
});
