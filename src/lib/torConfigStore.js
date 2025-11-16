import path from 'node:path';
import { JsonStore } from './jsonStore.js';
import { modeDataPath } from './paths.js';

export class TorConfigStore {
  constructor(mode) {
    if (!mode) throw new Error('mode is required for TorConfigStore');
    const filePath = path.join(modeDataPath(mode), 'tor-config.json');
    this.store = new JsonStore(filePath, {
      torPath: 'tor',
      socksPort: 9150,
      controlPort: 9151,
      bridges: [],
      entryNodes: '',
      exitNodes: ''
    });
  }

  async getConfig() {
    return this.store.get();
  }

  async updateConfig(partial) {
    return this.store.update((current) => ({ ...current, ...partial }));
  }
}
