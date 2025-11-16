import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { getTorTmpPath } from './paths.js';
import { createLogger } from './logger.js';

const logger = createLogger('tor');

export function buildTorrc(config) {
  const lines = [
    `SOCKSPort ${config.socksPort ?? 9050}`,
    `ControlPort ${config.controlPort ?? 9051}`,
    `DataDirectory ${config.dataDirectory}`,
    `ClientOnionAuthDir ${config.clientOnionAuthDir}`,
    'UIBridgeSelection 1'
  ];

  if (config.bridges?.length) {
    lines.push('UseBridges 1');
    config.bridges.forEach((bridge) => lines.push(`Bridge ${bridge}`));
  }

  if (config.entryNodes) {
    lines.push(`EntryNodes ${config.entryNodes}`);
  }
  if (config.exitNodes) {
    lines.push(`ExitNodes ${config.exitNodes}`);
  }
  if (config.logFile) {
    lines.push(`Log notice file ${config.logFile}`);
  }

  return `${lines.join(os.EOL)}${os.EOL}`;
}

export async function startTorProcess(userConfig = {}) {
  const tmpRoot = getTorTmpPath('sessions');
  const sessionDir = await fsp.mkdtemp(path.join(tmpRoot, 'session-'));
  const torDataDir = path.join(sessionDir, 'data');
  const onionAuthDir = path.join(sessionDir, 'onion-auth');
  await fsp.mkdir(torDataDir, { recursive: true });
  await fsp.mkdir(onionAuthDir, { recursive: true });

  const config = {
    dataDirectory: torDataDir,
    clientOnionAuthDir: onionAuthDir,
    controlPort: userConfig.controlPort ?? 9151,
    socksPort: userConfig.socksPort ?? 9150,
    torPath: userConfig.torPath ?? 'tor',
    bridges: userConfig.bridges ?? [],
    entryNodes: userConfig.entryNodes,
    exitNodes: userConfig.exitNodes,
    logFile: path.join(sessionDir, 'tor.log')
  };

  const torrc = buildTorrc(config);
  const torrcPath = path.join(sessionDir, 'torrc');
  await fsp.writeFile(torrcPath, torrc, 'utf8');

  const emitter = new EventEmitter();
  let child;

  try {
    child = spawn(config.torPath, ['-f', torrcPath]);
  } catch (error) {
    logger.error('Failed to spawn tor', error.message);
    emitter.emit('error', error);
    return { emitter, sessionDir, torrcPath, process: null };
  }

  child.on('error', (error) => {
    logger.error('Tor process error', error.message);
    emitter.emit('error', error);
  });

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    emitter.emit('log', text);
    const match = text.match(/Bootstrapped (\d+)%/);
    if (match) {
      emitter.emit('progress', Number(match[1]));
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    emitter.emit('log', text);
  });

  child.on('exit', (code) => {
    emitter.emit('exit', code);
  });

  return {
    emitter,
    sessionDir,
    torrcPath,
    process: child,
    stop: () => stopTorProcess(child, sessionDir)
  };
}

export async function stopTorProcess(child, sessionDir) {
  if (child && !child.killed) {
    child.kill('SIGINT');
  }
  if (sessionDir) {
    try {
      await fsp.rm(sessionDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn('Failed to clean Tor session directory', err.message);
    }
  }
}
