import { TorConfigStore } from './torConfigStore.js';
import { startTorProcess } from './torController.js';
import { createLogger } from './logger.js';

const logger = createLogger('tor-service');

export class TorService {
  constructor(mode) {
    this.mode = mode;
    this.store = new TorConfigStore(mode);
    this.handle = null;
    this.logs = [];
    this.progress = 0;
  }

  async status() {
    return {
      running: Boolean(this.handle?.process && !this.handle.process.killed),
      progress: this.progress,
      logs: this.logs.slice(-200)
    };
  }

  async config() {
    return this.store.getConfig();
  }

  async updateConfig(partial) {
    return this.store.updateConfig(partial);
  }

  async start(overrides = {}) {
    if (this.handle?.process && !this.handle.process.killed) {
      return this.status();
    }
    const baseConfig = await this.config();
    const merged = { ...baseConfig, ...overrides };
    const handle = await startTorProcess(merged);
    this.handle = handle;
    if (!handle.process) {
      this.logs.push('Tor process failed to start. Check torPath value.');
      return this.status();
    }
    handle.emitter.on('log', (line) => {
      this.logs.push(line.trim());
      if (this.logs.length > 500) {
        this.logs.shift();
      }
    });
    handle.emitter.on('progress', (value) => {
      this.progress = value;
    });
    handle.emitter.on('error', (error) => {
      const message = error?.code === 'ENOENT'
        ? '无法找到 Tor 可执行文件，请在 Tor 设置中指定 torPath。'
        : `Tor 进程错误：${error?.message ?? error}`;
      this.logs.push(message);
      this.handle = null;
      this.progress = 0;
    });
    handle.emitter.on('exit', (code) => {
      this.logs.push(`Tor exited with code ${code}`);
      this.handle = null;
      this.progress = 0;
    });
    return this.status();
  }

  async stop() {
    if (!this.handle) return { stopped: true };
    await this.handle.stop?.();
    this.handle = null;
    this.progress = 0;
    this.logs.push('Tor stopped by user request.');
    return { stopped: true };
  }
}
