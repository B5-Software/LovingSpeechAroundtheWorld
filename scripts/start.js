#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const SERVICES = {
  directory: {
    tag: 'Directory',
    label: 'Directory Authority',
    script: path.join(rootDir, 'modes/directory/server.js'),
    defaultPort: 4600
  },
  relay: {
    tag: 'Relay',
    label: 'Relay Node',
    script: path.join(rootDir, 'modes/relay/server.js'),
    defaultPort: 4700
  },
  client: {
    tag: 'Client',
    label: 'Client Studio',
    script: path.join(rootDir, 'modes/client/server.js'),
    defaultPort: 4800
  }
};

const MODES = [
  {
    id: 'directory',
    label: 'Directory Authority',
    description: 'Run the authoritative onion directory and relay registry.',
    services: ['directory']
  },
  {
    id: 'relay',
    label: 'Relay Only Node',
    description: 'Run only the relay service for forwarding encrypted letters.',
    services: ['relay']
  },
  {
    id: 'relay-client',
    label: 'Relay + Client Duo',
    description: 'Launch a relay node alongside the love-letter client UI.',
    services: ['relay', 'client']
  },
  {
    id: 'directory-relay-client',
    label: 'Directory + Relay + Client',
    description: 'Spin up the full mesh: directory authority plus relay and client nodes.',
    services: ['directory', 'relay', 'client']
  },
  {
    id: 'client',
    label: 'Client Only Studio',
    description: 'Launch just the guided client experience for composing and syncing letters.',
    services: ['client']
  }
];

function spawnService(tag, scriptPath, port) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(port ? { PORT: String(port) } : {})
    }
  });
  child.on('exit', (code) => {
    console.log(`\n[${tag}] exited with code ${code}`);
  });
  return child;
}

function startServices(serviceIds, ports) {
  return serviceIds.map((id) => {
    const service = SERVICES[id];
    if (!service) {
      throw new Error(`Unknown service: ${id}`);
    }
    const port = ports?.[id] ?? service.defaultPort;
    return spawnService(service.tag, service.script, port);
  });
}

function parseModeFromArgs() {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  if (!modeArg) return null;
  return modeArg.split('=')[1];
}

function parseModeFromEnv() {
  return process.env.APP_MODE || process.env.MODE || null;
}

function sanitizePort(value) {
  const num = Number.parseInt(value, 10);
  if (Number.isInteger(num) && num > 0 && num < 65536) {
    return num;
  }
  return null;
}

function getPortOverrideFromArgs(serviceId) {
  const prefix = `--${serviceId}-port=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  if (!arg) return null;
  return sanitizePort(arg.split('=')[1]);
}

function getPortOverrideFromEnv(serviceId) {
  const key = `${serviceId.toUpperCase()}_PORT`;
  if (!process.env[key]) return null;
  return sanitizePort(process.env[key]);
}

function getPreconfiguredPorts(serviceIds) {
  const overrides = {};
  (serviceIds || []).forEach((id) => {
    const argPort = getPortOverrideFromArgs(id);
    const envPort = getPortOverrideFromEnv(id);
    const resolved = argPort ?? envPort;
    if (resolved) {
      overrides[id] = resolved;
    }
  });
  return overrides;
}

async function promptMode() {
  const rl = readline.createInterface({ input, output });
  console.log('\n请选择要启动的模式:\n');
  MODES.forEach((mode, index) => {
    console.log(` ${index + 1}. ${mode.label}\n    ${mode.description}\n`);
  });
  let selection;
  while (!selection) {
    const answer = await rl.question('输入序号回车开始 (Ctrl+C 退出)： ');
    const index = Number.parseInt(answer, 10) - 1;
    if (MODES[index]) {
      selection = MODES[index];
    } else {
      console.log('未知选择，请再次输入。');
    }
  }
  rl.close();
  return selection.id;
}

async function promptPorts(serviceIds, preset = {}) {
  const pendingIds = (serviceIds || []).filter((id) => preset[id] == null);
  if (!pendingIds.length) {
    return {};
  }
  const rl = readline.createInterface({ input, output });
  const ports = {};
  for (const id of pendingIds) {
    const service = SERVICES[id];
    if (!service) continue;
    let port;
    while (!port) {
      const answer = await rl.question(`请输入 ${service.label} 端口 (默认 ${service.defaultPort})： `);
      const trimmed = answer.trim();
      if (!trimmed) {
        port = service.defaultPort;
        break;
      }
      const parsed = sanitizePort(trimmed);
      if (parsed) {
        port = parsed;
      } else {
        console.log('端口无效，请输入 1-65535 之间的数字。');
      }
    }
    ports[id] = port;
  }
  rl.close();
  return ports;
}

(async () => {
  let modeId = parseModeFromArgs() ?? parseModeFromEnv();
  if (!modeId) {
    modeId = await promptMode();
  }
  const mode = MODES.find((item) => item.id === modeId);
  if (!mode) {
    console.error(`无效模式：${modeId}`);
    process.exitCode = 1;
    return;
  }
  const presetPorts = getPreconfiguredPorts(mode.services);
  const promptedPorts = await promptPorts(mode.services, presetPorts);
  const ports = { ...presetPorts, ...promptedPorts };
  console.log(`\n启动 ${mode.label} ...\n`);
  const processes = startServices(mode.services, ports);

  const shutdown = () => {
    console.log('\n收到退出信号，正在停止服务...');
    processes.forEach((child) => {
      if (child && !child.killed) {
        child.kill('SIGINT');
      }
    });
    setTimeout(() => process.exit(), 200);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
