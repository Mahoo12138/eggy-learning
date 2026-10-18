import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

test('实际导出的章节概览保留协议正文且不增加 Markdown 表格列', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'eggy-export-plan-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = join(directory, 'plan.md');
  await execute(process.execPath, [join(root, 'scripts/export-plan.mjs')], {
    cwd: root,
    env: { ...process.env, EGGY_PLAN_EXPORT_DESTINATION: destination }
  });
  const markdown = await readFile(destination, 'utf8');
  const rows = [];
  let inOverview = false;
  for (const line of markdown.split('\n')) {
    if (line === '| 章节 | 阶段 | 场次 | 可运行里程碑 | 独立检查 |') {
      inOverview = true;
      continue;
    }
    if (!inOverview) continue;
    if (!line.startsWith('|')) {
      inOverview = false;
      continue;
    }
    if (!line.startsWith('|---')) rows.push(line);
  }

  assert.ok(rows.length > 0, '实际文档应包含章节概览');
  assert.ok(rows.some(row => row.includes('PING\\|second_player') && row.includes('OK\\|PONG\\|second_player')), '请求与响应的分隔符仍应显示在单元格内');
  assert.ok(rows.some(row => row.includes('ERR\\|INSUFFICIENT')), '错误响应的分隔符仍应显示在单元格内');
  for (const row of rows) {
    assert.equal((row.match(/(?<!\\)\|/g) || []).length, 6, `章节概览必须保持 5 列：${row}`);
  }
});
