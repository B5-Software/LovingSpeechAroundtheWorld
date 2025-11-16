import path from 'node:path';
import { JsonStore } from './jsonStore.js';
import { modeDataPath } from './paths.js';

export class ModeConfig {
  constructor(mode, defaults = {}) {
    const filePath = path.join(modeDataPath(mode), 'config.json');
    this.store = new JsonStore(filePath, defaults);
  }

  async get() {
    return this.store.get();
  }

  async update(partial) {
    return this.store.update((data) => ({ ...data, ...partial }));
  }
}
