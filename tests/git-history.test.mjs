import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getGitHistory } from '../lib/git-history.mjs';

const run = promisify(execFile);
const learner = 'student@example.com', manager = 'manager@example.com';
const isolatedEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
let gitAvailable = true;
try { await run('git', ['--version'], { timeout: 5000 }); } catch (_) { gitAvailable = false; }
async function temp(t) { const root = await mkdtemp(join(tmpdir(), 'study-git-history-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
async function command(root, args, env = {}) { return (await run('git', args, { cwd: root, env: { ...isolatedEnv, ...env }, timeout: 10000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim(); }
async function repo(t) { const root = await temp(t); await command(root, ['init', '--initial-branch=main']); return root; }
async function commit(root, subject, { author = learner, committer = manager, date = '2026-10-12T12:00:00+08:00', authorDate = date } = {}) {
  const env = { GIT_AUTHOR_NAME: 'Learner', GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_NAME: 'Maintainer', GIT_COMMITTER_EMAIL: committer, GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: date };
  await command(root, ['-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', subject], env);
  return command(root, ['rev-parse', 'HEAD']);
}
function query(root, extra = {}) { return getGitHistory({ root, learnerEmail: learner, ...extra }); }
function assertEmpty(result, status) { assert.equal(result.status, status, result.message); assert.ok(result.message); assert.deepEqual(result.items, []); assert.equal(result.hasMore, false); assert.equal(result.nextOffset, null); }

test('作者与提交者身份相反时仍按原始 Author 分类，mailmap 不改分类，读取不写配置或仓库', { skip: !gitAvailable }, async t => {
  const root = await repo(t);
  const maintenance = await commit(root, '维护 <script>标题只是数据</script>', { author: manager, committer: learner, date: '2026-10-01T12:00:00+08:00' });
  const learning = await commit(root, '保留学习者 Author 的提交', { author: 'STUDENT@example.com', committer: manager, date: '2026-10-02T12:00:00+08:00' });
  await writeFile(join(root, '.mailmap'), 'Mapped Manager <manager@example.com> Learner <STUDENT@example.com>\n');
  assert.equal(await command(root, ['log', '-1', '--format=%aE', learning]), manager);
  const configBefore = await readFile(join(root, '.git/config'), 'utf8');
  const statusBefore = await command(root, ['status', '--porcelain']);
  const result = await query(root, { learnerEmail: '  StUdEnT@Example.COM \n' });
  assert.equal(result.status, 'ok', result.message); assert.equal(result.learnerEmail, learner);
  assert.equal(result.head, learning); assert.equal(result.branch, 'main'); assert.equal(result.shallow, false);
  assert.equal(result.scope, '当前 HEAD 可达的本地提交');
  assert.equal(result.items.find(item => item.hash === learning).kind, 'learning');
  assert.equal(result.items.find(item => item.hash === learning).authorEmail, 'STUDENT@example.com');
  assert.equal(result.items.find(item => item.hash === maintenance).kind, 'maintenance');
  assert.equal(result.items.find(item => item.hash === maintenance).committerEmail, learner);
  assert.match(result.items.find(item => item.hash === maintenance).subject, /<script>/);
  assert.equal(await readFile(join(root, '.git/config'), 'utf8'), configBefore);
  assert.equal(await command(root, ['status', '--porcelain']), statusBefore);
});

test('当前 HEAD 包含合并分支原始提交与合并标记，不包含未合入分支，SHA 唯一', { skip: !gitAvailable }, async t => {
  const root = await repo(t);
  await commit(root, 'base', { author: manager, date: '2026-10-01T10:00:00Z' });
  await command(root, ['switch', '-c', 'feature']);
  const feature = await commit(root, 'branch learning', { date: '2026-10-03T10:00:00Z' });
  await command(root, ['switch', 'main']);
  await commit(root, 'main maintenance', { author: manager, date: '2026-10-02T10:00:00Z' });
  await command(root, ['-c', 'commit.gpgSign=false', 'merge', '--no-ff', 'feature', '-m', 'merge feature'], { GIT_AUTHOR_NAME: 'Manager', GIT_AUTHOR_EMAIL: manager, GIT_COMMITTER_NAME: 'Manager', GIT_COMMITTER_EMAIL: manager, GIT_AUTHOR_DATE: '2026-10-04T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-04T10:00:00Z' });
  const merge = await command(root, ['rev-parse', 'HEAD']);
  await command(root, ['switch', '-c', 'unmerged']);
  const unmerged = await commit(root, 'not reachable', { date: '2026-10-05T10:00:00Z' });
  await command(root, ['switch', 'main']);
  const result = await query(root);
  assert.equal(result.status, 'ok', result.message); assert.equal(result.items.length, 4);
  assert.ok(result.items.some(item => item.hash === feature && item.kind === 'learning'));
  assert.ok(result.items.some(item => item.hash === merge && item.merge && item.kind === 'maintenance'));
  assert.ok(!result.items.some(item => item.hash === unmerged));
  assert.equal(new Set(result.items.map(item => item.hash)).size, result.items.length);
});

test('先分类再分页，跨多页完整覆盖且准确报告结束；列表按 Committer 日期而非 Author 日期排序', { skip: !gitAvailable }, async t => {
  const root = await repo(t);
  for (let index = 0; index < 17; index++) await commit(root, 'commit ' + index, { author: index % 3 === 0 ? learner : manager, date: `2026-10-${String(17 - index).padStart(2, '0')}T10:00:00Z`, authorDate: `2025-09-${String(index + 1).padStart(2, '0')}T10:00:00Z` });
  const all = await query(root, { limit: 100 });
  assert.equal(all.status, 'ok', all.message); assert.equal(all.items[0].subject, 'commit 0');
  assert.equal(all.items.at(-1).subject, 'commit 16');
  for (const kind of ['all', 'learning', 'maintenance']) {
    let offset = 0, collected = [];
    for (let page = 0; page < 10; page++) {
      const result = await query(root, { kind, offset, limit: 3 });
      assert.equal(result.status, 'ok', result.message); collected.push(...result.items);
      if (!result.hasMore) { assert.equal(result.nextOffset, null); break; }
      assert.equal(result.nextOffset, offset + result.items.length); offset = result.nextOffset;
    }
    const expected = kind === 'all' ? all.items : all.items.filter(item => item.kind === kind);
    assert.deepEqual(collected.map(item => item.hash), expected.map(item => item.hash));
    assert.equal(new Set(collected.map(item => item.hash)).size, expected.length);
    const end = await query(root, { kind, offset: expected.length, limit: 3 });
    assert.equal(end.status, 'ok'); assert.deepEqual(end.items, []); assert.equal(end.hasMore, false);
  }
});

test('空库、非库、嵌套非库、无 Git、无效配置及分页参数分别有清楚状态', async t => {
  const root = await temp(t);
  assertEmpty(await query(root, { gitBin: join(root, 'missing-git') }), 'unavailable');
  for (const learnerEmail of ['', 'no-at-sign', 'a@@b.com', 'a b@example.com', '.a@example.com', 'a@-example.com', 'a@example..com', null]) assertEmpty(await query(root, { learnerEmail }), 'unconfigured');
  for (const extra of [{ kind: 'author' }, { kind: '--all' }, { offset: -1 }, { offset: '1' }, { offset: 1.5 }, { limit: 0 }, { limit: 101 }, { limit: '20' }, { gitBin: '' }]) assertEmpty(await query(root, extra), 'error');
  assertEmpty(await query('relative/path'), 'error'); assertEmpty(await getGitHistory(null), 'error');
  if (!gitAvailable) return;
  assertEmpty(await query(root), 'not-repository');
  await command(root, ['init', '--initial-branch=main']);
  const empty = await query(root); assertEmpty(empty, 'empty'); assert.equal(empty.branch, 'main'); assert.equal(empty.head, null);
  await commit(root, 'one'); await mkdir(join(root, 'nested-folder'));
  assertEmpty(await query(join(root, 'nested-folder')), 'not-repository');
});

test('每次调用读取当前邮箱环境配置，重新分类而不修改提交；detached HEAD 可读取', { skip: !gitAvailable }, async t => {
  const root = await repo(t); const head = await commit(root, 'one');
  const previous = process.env.LEARNER_GIT_EMAIL;
  try {
    process.env.LEARNER_GIT_EMAIL = learner; assert.equal((await getGitHistory({ root })).items[0].kind, 'learning');
    process.env.LEARNER_GIT_EMAIL = manager; assert.equal((await getGitHistory({ root })).items[0].kind, 'maintenance');
    delete process.env.LEARNER_GIT_EMAIL; assertEmpty(await getGitHistory({ root }), 'unconfigured');
  } finally { if (previous === undefined) delete process.env.LEARNER_GIT_EMAIL; else process.env.LEARNER_GIT_EMAIL = previous; }
  await command(root, ['switch', '--detach', head]);
  const result = await query(root); assert.equal(result.status, 'ok'); assert.equal(result.branch, null); assert.equal(result.head, head);
});

test('浅克隆明确标注不完整；修改后的 HEAD 重新读取，不保留旧 SHA', { skip: !gitAvailable }, async t => {
  const source = await repo(t); await commit(source, 'old'); const second = await commit(source, 'current');
  const destination = await temp(t); const clone = join(destination, 'clone');
  await command(destination, ['clone', '--depth=1', pathToFileURL(source).href, clone]);
  const shallow = await query(clone); assert.equal(shallow.status, 'ok', shallow.message); assert.equal(shallow.shallow, true); assert.match(shallow.message, /历史不完整/); assert.equal(shallow.items.length, 1);
  await command(source, ['-c', 'commit.gpgSign=false', 'commit', '--amend', '--allow-empty', '--no-edit'], { GIT_AUTHOR_NAME: 'Learner', GIT_AUTHOR_EMAIL: learner, GIT_COMMITTER_NAME: 'Manager', GIT_COMMITTER_EMAIL: manager, GIT_COMMITTER_DATE: '2026-10-13T10:00:00Z' });
  const result = await query(source); assert.notEqual(result.head, second); assert.ok(!result.items.some(item => item.hash === second));
});

test('继承其他命令的 GIT_DIR 不会误读别的仓库', { skip: !gitAvailable }, async t => {
  const first = await repo(t), second = await repo(t); const expected = await commit(first, 'correct repository'); await commit(second, 'wrong repository');
  const previous = process.env.GIT_DIR;
  try { process.env.GIT_DIR = join(second, '.git'); const result = await query(first); assert.equal(result.status, 'ok'); assert.equal(result.head, expected); }
  finally { if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous; }
});

async function fakeGit(t, action) {
  const root = await temp(t), binary = join(root, 'fake-git');
  await writeFile(binary, `#!${process.execPath}\nconst args=process.argv.slice(2);\nif(args.includes('--git-dir'))process.stdout.write('.git\\n');\nelse if(args.includes('symbolic-ref'))process.stdout.write('refs/heads/main\\n');\nelse if(args.includes('--is-shallow-repository'))process.stdout.write('false\\n');\nelse if(args.includes('HEAD^{commit}'))process.stdout.write('a'.repeat(40)+'\\n');\nelse if(args.includes('log')){${action}}\n`);
  await chmod(binary, 0o755); return { root, gitBin: binary };
}
test('输出超限或损坏时明确失败，不把部分读取当作分页结束', { skip: process.platform === 'win32' }, async t => {
  for (const action of ["process.stdout.write('x'.repeat(9*1024*1024));", "process.stdout.write('malformed\\0');"]) {
    const fixture = await fakeGit(t, action); const result = await query(fixture.root, { gitBin: fixture.gitBin }); assertEmpty(result, 'error');
    assert.match(result.message, /上限|不完整/);
  }
  const capped = await fakeGit(t, "let output='';for(let i=0;i<20001;i++)output+=[i.toString(16).padStart(40,'0'),'subject','author','student@example.com','manager@example.com','2026-10-12T00:00:00Z','2026-10-12T00:00:00Z',''].join('\\0')+'\\0';process.stdout.write(output);");
  const result = await query(capped.root, { gitBin: capped.gitBin }); assertEmpty(result, 'error'); assert.match(result.message, /20,000/);
});

test('Git 超时受到限制，返回错误而不挂起或误报空库', { skip: process.platform === 'win32', timeout: 9000 }, async t => {
  const fixture = await fakeGit(t, 'setTimeout(()=>{},20000);'); const started = Date.now();
  const result = await query(fixture.root, { gitBin: fixture.gitBin });
  assertEmpty(result, 'error'); assert.match(result.message, /超时/); assert.ok(Date.now() - started < 8000);
});
