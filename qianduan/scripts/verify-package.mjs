import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function verifyPackage(demo = false) {
  const directory = path.join(root, 'qianduan', demo ? 'dist-demo' : 'dist');
  const info = JSON.parse(await fs.readFile(path.join(directory, 'build-info.json'), 'utf8'));
  if (info.mode !== (demo ? 'demo' : 'api'))
    throw new Error('Artifact mode does not match the requested deployment.');
  const files = await fs.readdir(directory, { recursive: true, withFileTypes: true });
  if (files.some((file) => file.isFile() && /\.(?:py|pyc|db|sqlite3|pen)$|^\.env/.test(file.name)))
    throw new Error('Private or backend files found in frontend artifact.');
  const index = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
  for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^https?:/.test(match[1])) continue;
    let href = match[1];
    if (href.startsWith(info.base_path)) href = href.slice(info.base_path.length);
    href = href.replace(/^\//, '');
    const resolved = path.resolve(directory, href);
    if (!resolved.startsWith(directory + path.sep)) throw new Error('Entry asset escaped the package.');
    await fs.access(resolved);
  }
  const resourceHtml = await fs.readFile(path.join(directory, 'labs/index.html'), 'utf8');
  if (
    !resourceHtml.includes('resource-explorer.js') ||
    /src="shared\/js\/(?:app-session|auth-ui)\.js/.test(resourceHtml)
  )
    throw new Error('Resource shell retained the old account bootstrap.');
  for (const activity of loadCatalog(root)) {
    let filename = activity.href.split('#')[0];
    if (filename.endsWith('/')) filename += 'index.html';
    await fs.access(path.join(directory, filename));
  }
  return { directory, info, file_count: files.filter((file) => file.isFile()).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPackage(process.argv.includes('--demo'));
  console.log(
    JSON.stringify({
      mode: result.info.mode,
      files: result.file_count,
      activities: 127,
      source_commit: result.info.source_commit,
    }),
  );
}
