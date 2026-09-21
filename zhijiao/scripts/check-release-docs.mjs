import { access, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot } from './lib/release-process.mjs';

// The application is a workspace within Astra; project documentation has one owner.
const repositoryRoot = resolve(projectRoot, '..');
export const documentPaths = [
  'README.md',
  'zhijiao/README.md',
  'doc/00-项目总纲.md',
  'doc/01-开发者手册.md',
  'doc/02-更新规划.md',
  'doc/03-发布历史.md',
  'doc/04-部署指南.md',
  'doc/05-UI规范模板.md',
  'doc/01-子文档/15-学科实验与内容开发指南.md',
];

function anchors(text) {
  const found = new Set();
  const counts = new Map();
  for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gmu)) {
    const slug = match[1].replace(/<[^>]+>/gu, '').toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/gu, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    found.add(count ? `${slug}-${count}` : slug);
  }
  for (const match of text.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/gu)) found.add(match[1]);
  return found;
}

export async function checkDocumentation(root = repositoryRoot, paths = documentPaths) {
  let linkCount = 0;
  for (const name of paths) {
    const file = resolve(root, name);
    const text = await readFile(file, 'utf8');
    if (!text.startsWith('# ')) throw new Error(`${name} 缺少一级标题`);
    // Examples inside code fences are not navigable Markdown links.
    const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gmu, '');
    for (const match of prose.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1].trim().replace(/^<|>$/gu, '');
      if (/^[a-z][a-z\d+.-]*:/iu.test(target)) continue;
      const [rawPath, rawAnchor] = target.split('#', 2);
      const path = rawPath ? resolve(dirname(file), decodeURIComponent(rawPath)) : file;
      try {
        await access(path);
      } catch (error) {
        throw new Error(`${name} 含失效本地链接：${target}`, { cause: error });
      }
      if (rawAnchor && (await stat(path)).isFile() && path.endsWith('.md')) {
        const content = path === file ? text : await readFile(path, 'utf8');
        if (!anchors(content).has(decodeURIComponent(rawAnchor))) {
          throw new Error(`${name} 含失效章节锚点：${target}`);
        }
      }
      linkCount += 1;
    }
  }
  return { documents: paths.length, localLinks: linkCount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await checkDocumentation();
  console.log(`Astra docs ok: ${result.documents} documents, ${result.localLinks} local links and anchors`);
}
