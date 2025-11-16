import path from 'node:path';
import fs from 'fs-extra';

const dataRoot = path.resolve('data');
const torTmpRoot = path.resolve('.tor-tmp');

function ensureDir(dirPath) {
  fs.ensureDirSync(dirPath);
  return dirPath;
}

export function getDataPath(...segments) {
  return ensureDir(path.join(dataRoot, ...segments));
}

export function getTorTmpPath(...segments) {
  return ensureDir(path.join(torTmpRoot, ...segments));
}

export function modeDataPath(mode) {
  if (!mode) throw new Error('mode is required for modeDataPath');
  return getDataPath(mode);
}

export function resolveFileWithinMode(mode, filename) {
  return path.join(modeDataPath(mode), filename);
}
