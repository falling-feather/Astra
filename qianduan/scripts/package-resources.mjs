import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extensions = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.wasm',
  '.mp3',
  '.mp4',
  '.ogg',
  '.glb',
  '.gltf',
  '.bin',
  '.pdf',
  '.map',
]);
const oldRolePages = new Set(['admin', 'student', 'teacher']);

// The build admits public assets only. Source code, databases, logs and credentials never enter dist.
export async function packageResources(demo = false) {
  const output = path.join(project, 'qianduan', demo ? 'dist-demo' : 'dist');
  const labs = path.join(output, 'labs');
  await fs.access(path.join(output, 'index.html'));
  await fs.mkdir(labs, { recursive: true });
  for (const directory of ['shared', 'pages', 'UI', 'codevis']) {
    const source = path.join(project, directory);
    await fs.cp(source, path.join(labs, directory), {
      recursive: true,
      filter: async (filename) => {
        const stat = await fs.lstat(filename);
        if (stat.isSymbolicLink()) throw new Error(`Public resource must not be a symlink: ${filename}`);
        const relative = path.relative(source, filename).split(path.sep);
        if (directory === 'pages' && oldRolePages.has(relative[0])) return false;
        if (
          relative.some(
            (part) => part.startsWith('.') || ['node_modules', 'tests', 'test-screenshots'].includes(part),
          )
        )
          return false;
        return (
          stat.isDirectory() ||
          extensions.has(path.extname(filename).toLowerCase()) ||
          /^(LICENSE(?:\.md)?|SOURCE\.md|THIRD_PARTY_NOTICES\.md)$/.test(path.basename(filename))
        );
      },
    });
  }
  const publicMarker = '<meta name="astra-resource-explorer" content="public">';
  let entry = await fs.readFile(path.join(project, 'index.html'), 'utf8');
  entry = entry.replace(
    '</head>',
    `${publicMarker}<link rel="stylesheet" href="resource-explorer.css"></head>`,
  );
  entry = entry.replace(/<script\b[^>]*src="shared\/js\/(?:auth-ui|app-session)\.js[^>]*><\/script>/g, '');
  entry = entry.replace(
    '<script src="shared/js/main.js',
    '<script src="shared/js/resource-explorer.js"></script><script src="shared/js/main.js',
  );
  entry = entry.replace(/<link\b[^>]*href="shared\/css\/(?:auth-ui|app-session)\.css[^>]*>/g, '');
  await fs.writeFile(path.join(labs, 'index.html'), entry);
  let code = await fs.readFile(path.join(labs, 'codevis/index.html'), 'utf8');
  code = code
    .replace('</head>', `${publicMarker}</head>`)
    .replace(/<script\b[^>]*src="shared\/js\/student-context\.js[^>]*><\/script>/g, '');
  await fs.writeFile(path.join(labs, 'codevis/index.html'), code);
  await fs.copyFile(
    path.join(project, 'qianduan/public/resource-explorer.css'),
    path.join(labs, 'resource-explorer.css'),
  );
  await fs.copyFile(path.join(project, 'LICENSE.md'), path.join(output, 'LICENSE.md'));
  await fs.copyFile(path.join(project, 'UI/favicon.ico'), path.join(output, 'favicon.ico'));
  await fs.writeFile(path.join(output, '.nojekyll'), '');
  const git = (args) =>
    execFileSync('git', args, { cwd: project, encoding: 'utf8', windowsHide: true }).trim();
  const index = await fs.readFile(path.join(output, 'index.html'), 'utf8');
  const asset = index.match(/src="([^"]*)assets\//);
  await fs.writeFile(
    path.join(output, 'build-info.json'),
    JSON.stringify(
      {
        mode: demo ? 'demo' : 'api',
        source_commit: git(['rev-parse', 'HEAD']),
        source_dirty: Boolean(
          git(['status', '--porcelain', '--', 'qianduan', 'shared', 'pages', 'codevis', 'UI']),
        ),
        base_path: asset?.[1] || '/',
        activity_count: 127,
      },
      null,
      2,
    ) + '\n',
  );
  await fs.writeFile(
    path.join(output, 'sw.js'),
    await fs.readFile(path.join(project, 'qianduan/public/sw.js')),
  );
  console.log('Packaged the three public learning spaces under /labs.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await packageResources(process.argv.includes('--demo'));
