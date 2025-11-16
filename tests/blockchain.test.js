import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { BlockStore } from '../src/lib/blockchain.js';

async function createStore() {
  const tempFile = path.join(os.tmpdir(), `blockstore-${Date.now()}.json`);
  const store = new BlockStore({ filePath: tempFile });
  await store.init();
  return { store, tempFile };
}

test('block store appends and validates chain', async () => {
  const { store, tempFile } = await createStore();
  const block = await store.appendLetterBlock({ ciphertext: 'abc', iv: 'iv', authTag: 'tag', encryptedKey: 'key' }, 'finger', {});
  const blocks = await store.getBlocks();
  assert.equal(blocks.length, 2);
  const manifest = await store.getManifest();
  assert.equal(manifest.length, 2);
  const summary = await store.getChainSummary();
  assert.equal(summary.length, 2);
  assert.equal(summary.latestHash, blocks[1].hash);
  await fs.unlink(tempFile);
});
