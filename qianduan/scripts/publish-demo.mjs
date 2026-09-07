import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPackage } from './verify-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const git = (args, options = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, ...options }).trim();
const source = git(['rev-parse', 'HEAD']);
const branch = git(['branch', '--show-current']);
if (branch !== 'main') throw new Error('Publish the reviewed main source only.');
const { directory, info } = await verifyPackage(true);
if (info.source_dirty || info.source_commit !== source)
  throw new Error('Commit the source and rebuild the demo before publishing.');
if (git(['status', '--porcelain', '--', 'qianduan', 'shared', 'pages', 'codevis', 'UI']))
  throw new Error('Frontend sources have uncommitted changes.');
if (git(['worktree', 'list', '--porcelain']).includes('branch refs/heads/qianduan'))
  throw new Error('qianduan is checked out elsewhere; finish that worktree first.');
const remoteMain = git(['ls-remote', '--heads', 'origin', 'main']).split(/\s+/)[0];
if (remoteMain !== source) throw new Error('Push the reviewed main commit before publishing its demo.');

// An isolated index admits only generated public files. The main worktree and index are untouched.
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'astra-pages-index-'));
try {
  const env = {
    ...process.env,
    GIT_DIR: git(['rev-parse', '--absolute-git-dir']),
    GIT_WORK_TREE: directory,
    GIT_INDEX_FILE: path.join(temporary, 'index'),
  };
  const artifactGit = (args) => git(args, { cwd: directory, env });
  artifactGit(['read-tree', '--empty']);
  artifactGit(['add', '--all', '--', '.']);
  const tree = artifactGit(['write-tree']);
  const remoteRefs = git(['ls-remote', '--heads', 'origin', 'qianduan']);
  let parent = '';
  if (remoteRefs) {
    git(['fetch', 'origin', 'qianduan']);
    parent = git(['rev-parse', 'FETCH_HEAD']);
  }
  const previous = git(['for-each-ref', '--format=%(objectname)', 'refs/heads/qianduan']);
  if (previous && parent && previous !== parent) git(['merge-base', '--is-ancestor', previous, parent]);
  if (previous && !parent && git(['rev-parse', `${previous}^{tree}`]) !== tree)
    throw new Error('An unpublished qianduan branch exists; review it before replacing the artifact.');
  const reusable = parent || previous;
  const commit =
    reusable && git(['rev-parse', `${reusable}^{tree}`]) === tree
      ? reusable
      : git([
          'commit-tree',
          tree,
          ...(parent ? ['-p', parent] : []),
          '-m',
          `deploy(frontend): 静态演示 ${source.slice(0, 7)}（REL-011）`,
        ]);
  git(['update-ref', 'refs/heads/qianduan', commit, previous || '0'.repeat(40)]);
  if (process.argv.includes('--push')) git(['push', '--set-upstream', 'origin', 'qianduan']);
  console.log(
    JSON.stringify({
      source_commit: source,
      deployment_commit: commit,
      branch: 'qianduan',
      pushed: process.argv.includes('--push'),
    }),
  );
} finally {
  const resolved = path.resolve(temporary);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('astra-pages-index-')
  )
    throw new Error('Unexpected temporary index location.');
  await fs.rm(resolved, { recursive: true });
}
