import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkDocumentation } from './check-release-docs.mjs';

test('迁入后检查 Astra 的统一文档，不依赖原项目文档名称和发版号', async () => {
  assert.equal((await checkDocumentation()).documents, 9);
});

test('检查实际本地文件和章节；拒绝失效引用，代码示例不作为链接', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astra-doc-check-'));
  try {
    await writeFile(join(root, 'target.md'), '# 目标\n\n## 模块说明\n\n<a id="compatible"></a>\n');
    await writeFile(join(root, 'README.md'), '# 文档\n\n[模块](target.md#模块说明)\n[兼容](target.md#compatible)\n```md\n[示例](not-a-file.md)\n```\n');
    assert.deepEqual(await checkDocumentation(root, ['README.md']), { documents: 1, localLinks: 2 });
    await writeFile(join(root, 'README.md'), '# 文档\n[不存在](absent.md)\n');
    await assert.rejects(checkDocumentation(root, ['README.md']), /失效本地链接/u);
    await writeFile(join(root, 'README.md'), '# 文档\n[不存在](target.md#absent)\n');
    await assert.rejects(checkDocumentation(root, ['README.md']), /失效章节锚点/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
