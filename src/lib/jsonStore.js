import fs from 'fs-extra';
import path from 'node:path';

export class JsonStore {
  constructor(filePath, defaults = {}) {
    this.filePath = path.resolve(filePath);
    this.defaults = defaults;
    this._data = null;
  }

  async load() {
    if (this._data) return this._data;
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this._data = JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this._data = this.defaults;
        await this.save();
      } else {
        throw err;
      }
    }
    return this._data;
  }

  async save() {
    if (!this._data) {
      this._data = this.defaults;
    }
    await fs.ensureDir(path.dirname(this.filePath));
    await fs.writeFile(this.filePath, JSON.stringify(this._data, null, 2), 'utf8');
    return this._data;
  }

  async update(mutator) {
    await this.load();
    const draft = structuredClone(this._data);
    const result = await mutator(draft);
    this._data = result === undefined ? draft : result;
    await this.save();
    return this._data;
  }

  async get() {
    return this.load();
  }
}
