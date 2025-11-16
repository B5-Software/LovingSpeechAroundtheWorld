import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

let cachedMeta = null;

export function getAppMeta() {
  if (cachedMeta) {
    return cachedMeta;
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(__dirname, '../../package.json');
  let pkg = {};
  try {
    const raw = readFileSync(pkgPath, 'utf-8');
    pkg = JSON.parse(raw);
  } catch (error) {
    pkg = {};
  }
  cachedMeta = {
    name: pkg.name || 'Loving Speech Around the World',
    version: pkg.version || '0.0.0',
    author: pkg.author || 'B5-Software'
  };
  return cachedMeta;
}
