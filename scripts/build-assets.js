import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

const webShared = path.resolve('web/shared');
const distShared = path.resolve('dist/web/shared');

async function ensureAssets() {
  if (!existsSync(webShared)) {
    await fs.mkdir(distShared, { recursive: true });
    await fs.writeFile(
      path.join(distShared, 'placeholder.txt'),
      'Web shared assets will be generated once the UI sources are available.\n'
    );
    console.log('Created dist/web/shared placeholder.');
    return;
  }

  await fs.rm(distShared, { recursive: true, force: true });
  await fs.cp(webShared, distShared, { recursive: true });
  console.log('Copied shared web assets.');
}

ensureAssets().catch((err) => {
  console.error('Asset build failed', err);
  process.exitCode = 1;
});
