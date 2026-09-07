import test from 'node:test';
import assert from 'node:assert/strict';
import {markdown} from '../src/ui/markdown.ts';

test('教学 Markdown 保留层次、列表、公式代码和参考链接',()=>{
  const result=markdown('# 学习目标\n\n- **预测**\n- `y=x²`\n\n[参考](https://example.org/)');
  assert.match(result,/<h2>学习目标<\/h2>/);assert.match(result,/<li>/);assert.match(result,/<strong>预测/);assert.match(result,/<code>y=x²/);assert.match(result,/rel="noopener noreferrer"/);
});
test('课程正文不能注入 HTML、脚本地址或带凭据链接',()=>{
  const result=markdown('<img src=x onerror=alert(1)>\n\n[运行](javascript:alert%281%29) [引用](https://name:pass@example.org/)');
  assert.ok(!result.includes('<img'));assert.ok(!result.includes('href="javascript:'));assert.ok(!result.includes('href="https://name:pass@'));
});
