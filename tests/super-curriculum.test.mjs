import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

import { startServer } from '../server.mjs';
import { sanitizeProjectCodePackage, materializeProjectState, learnerCodeStep } from '../lib/project-code-delivery.mjs';
import { freshProgress, freshWeekCard, sanitizeCourse } from '../shared/park-domain.mjs';
import { chapterCodeReady, finalSourceModel, guidedCodeModel, matchingCodePackage } from '../public/assets/project-code-delivery.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT_ID = 'super-arcade-data-center-project';
const execute = promisify(execFile);
const CHAPTER_IDS = [
  'network-model', 'message-framing', 'disconnect-timeout', 'multi-client', 'sql-model',
  'sqlite-cpp', 'transactions', 'durable-idempotency', 'query-recovery', 'end-to-end'
];

async function curriculum() {
  const index = JSON.parse(await readFile(join(ROOT, 'data/course.json'), 'utf8'));
  const definitions = [...index.levels, ...index.projects];
  const details = await Promise.all(definitions.map(async item => JSON.parse(await readFile(join(ROOT, 'data', item.file), 'utf8'))));
  const course = sanitizeCourse(index, details);
  const project = course.projects.find(item => item.id === PROJECT_ID);
  assert.ok(project?.codeDelivery, '超级凤凰蛋必须发布完整代码包');
  const bytes = await readFile(join(ROOT, 'data', project.codeDelivery.packageFile));
  const codePackage = sanitizeProjectCodePackage(JSON.parse(bytes), project);
  return { index, details, course, project, bytes, codePackage };
}

async function readTree(root, prefix = '') {
  const files = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, await readTree(root, path));
    else if (entry.isFile()) files[path] = await readFile(join(root, path), 'utf8');
    else assert.fail(`Unexpected non-regular file: ${path}`);
  }
  return files;
}

async function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

function frame(message) {
  const body = Buffer.from(message);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

async function exchange(port, chunks, { frames = 1, timeout = 3_000, interval = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let received = Buffer.alloc(0);
    const messages = [];
    let settled = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(messages);
    }
    const timer = setTimeout(() => finish(new Error('independent socket deadline exceeded')), timeout);
    socket.on('error', error => finish(frames === 0 && error.code === 'ECONNRESET' ? null : error));
    socket.on('close', () => finish(frames === 0 ? null : new Error(`connection closed after ${messages.length}/${frames} responses`)));
    socket.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      while (received.length >= 4) {
        const length = received.readUInt32BE(0);
        if (length < 1 || length > 4096) return finish(new Error(`invalid response length ${length}`));
        if (received.length < 4 + length) return;
        messages.push(received.subarray(4, 4 + length).toString());
        received = received.subarray(4 + length);
        if (messages.length === frames) return finish(null);
      }
    });
    socket.once('connect', async () => {
      try {
        for (const chunk of chunks) {
          if (settled) return;
          socket.write(chunk);
          if (interval) await delay(interval);
        }
      } catch (error) { finish(error); }
    });
  });
}

async function request(port, message, options) {
  return (await exchange(port, [frame(message)], options))[0];
}

async function launch(binary, args, { cwd, env = {}, readyPattern, timeout = 5_000 } = {}) {
  const child = spawn(binary, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 2_000);
    try { return await closed; } finally { clearTimeout(kill); }
  };
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`process did not become ready: ${output}\n${errors}`)), timeout);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', () => { clearTimeout(timer); reject(new Error(`process exited before readiness: ${output}\n${errors}`)); });
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        const match = output.match(readyPattern);
        if (match) { clearTimeout(timer); resolve(match); }
      });
      child.stderr.on('data', chunk => { errors += chunk.toString(); });
    });
    return { child, ready, stop, closed, output: () => output, errors: () => errors };
  } catch (error) { await stop(); throw error; }
}

function runTree(binary, args, { cwd, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch {}
    }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`${binary} ${timedOut ? 'timed out' : `exited ${code}/${signal}`}\n${stdout}\n${stderr}`), { stdout, stderr }));
    });
  });
}

async function sqliteProbe(directory) {
  const source = join(directory, 'sqlite-probe.cpp');
  const binary = join(directory, 'sqlite-probe');
  await writeFile(source, `#include <sqlite3.h>
#include <iostream>
#include <string>
int main(int argc, char** argv) {
  if (argc != 3) return 2;
  const bool lock = std::string(argv[2]) == "--lock";
  sqlite3* db = nullptr;
  if (sqlite3_open_v2(argv[1], &db, lock ? SQLITE_OPEN_READWRITE : SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK) return 3;
  sqlite3_busy_timeout(db, 1000);
  if (lock) {
    if (sqlite3_exec(db, "BEGIN IMMEDIATE", nullptr, nullptr, nullptr) != SQLITE_OK) return 4;
    std::cout << "LOCK_READY" << std::endl;
    std::string line; std::getline(std::cin, line);
    const int result = sqlite3_exec(db, "COMMIT", nullptr, nullptr, nullptr);
    sqlite3_close(db); return result == SQLITE_OK ? 0 : 5;
  }
  sqlite3_stmt* query = nullptr;
  if (sqlite3_prepare_v2(db, argv[2], -1, &query, nullptr) != SQLITE_OK) {
    std::cerr << sqlite3_errmsg(db); sqlite3_close(db); return 6;
  }
  int result;
  while ((result = sqlite3_step(query)) == SQLITE_ROW) {
    for (int i = 0; i < sqlite3_column_count(query); ++i) {
      if (i) std::cout << '\\t';
      const auto* value = sqlite3_column_text(query, i);
      std::cout << (value ? reinterpret_cast<const char*>(value) : "NULL");
    }
    std::cout << '\\n';
  }
  sqlite3_finalize(query); sqlite3_close(db);
  return result == SQLITE_DONE ? 0 : 7;
}
`);
  await execute('c++', ['-std=c++20', source, '-lsqlite3', '-o', binary], { timeout: 30_000 });
  return async (database, sql) => {
    const { stdout } = await execute(binary, [database, sql], { timeout: 5_000 });
    return stdout.trim() ? stdout.trim().split('\n').map(line => line.split('\t')) : [];
  };
}

test('超级凤凰蛋保留联机积分中心和旧章节身份，并为十节课程提供概念、完整代码和独立验证', async () => {
  const { index, details, project, bytes, codePackage } = await curriculum();
  const detail = details.find(item => item.id === PROJECT_ID);
  assert.deepEqual(index.projects.find(item => item.id === PROJECT_ID), detail, '索引与详情必须指向同一份课程');
  assert.equal(project.rankId, 'super-phoenix');
  assert.equal(project.boss.id, 'super-arcade-data-center-boss');
  assert.equal(project.version, 2);
  assert.match(project.title, /联机积分中心/);
  assert.deepEqual(project.languages, ['c', 'cpp', 'sql']);
  assert.deepEqual(project.chapters.map(chapter => chapter.id), CHAPTER_IDS);
  assert.equal(project.guidancePolicy.codeDeliveryContractVersion, 1);
  assert.equal(project.guidancePolicy.guidedLessonsPerChapter, 3);
  assert.equal(project.codeDelivery.packageFile, `project-code/${PROJECT_ID}.json`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), project.codeDelivery.packageSha256);
  assert.equal(codePackage.steps.length, 30);
  assert.equal(codePackage.states.length, 31);

  for (const chapter of project.chapters) {
    assert.equal(chapter.guidedSteps.length, 3);
    assert.ok(chapter.conceptModule.checks.length >= 3, `${chapter.id}: 概念需要可检验的理解题`);
    for (const concept of chapter.concepts) {
      assert.ok(chapter.conceptModule.terms.some(term => term.term === concept), `${chapter.id}: 缺少 ${concept} 的解释`);
    }
    // C++ is executed in the local toolchain; the web checkpoint records the learner's evidence.
    assert.ok(chapter.checkpoint.selfChecks.length >= 3);
    assert.ok(chapter.runbook.buildCommands.includes('make test'));
    assert.equal(chapterCodeReady(codePackage, chapter, 'ready'), true);
    for (const step of chapter.guidedSteps) {
      const model = guidedCodeModel(codePackage, step);
      assert.ok(model, `${chapter.id}/${step.id}: 必须能展示完整文件`);
      assert.deepEqual(model.files.map(file => file.path).sort(), [...step.targetFiles].sort());
      assert.ok(model.files.every(file => file.content.trim()), `${step.id}: 不可提供空文件冒充代码`);
    }
  }
  assert.equal(finalSourceModel(codePackage).stateId, project.codeDelivery.finalStateId);
});

test('从起始目录逐步只复制课程指定文件，就能精确组成所有三十个快照且没有隐藏缺口', async () => {
  const { project, codePackage } = await curriculum();
  let files = materializeProjectState(codePackage, project.codeDelivery.baselineStateId);
  assert.deepEqual(files, {}, '本课程从空目录开始，不依赖未逐节交付的初始工程');
  let previousState = project.codeDelivery.baselineStateId;
  for (const step of codePackage.steps) {
    assert.equal(step.fromStateId, previousState);
    const delivered = learnerCodeStep(codePackage, step.id);
    files = { ...files, ...delivered.files };
    assert.deepEqual(files, materializeProjectState(codePackage, step.toStateId), `${step.id}: 本节没有交付产生下个快照所需的全部文件`);
    assert.deepEqual(step.intentionalGaps, [], `${step.id}: 每一步都应是可运行的完整参考版本`);
    assert.ok(step.learnerChanges.length >= 1, `${step.id}: 复制后还需有可定位的小改动`);
    for (const [path, content] of Object.entries(files)) {
      assert.doesNotMatch(content, /TODO(?:\([^\n)]*\))?|<待补全>|\/\*\s*省略[^*]*\*\/|^\s*\.\.\.\s*$/m, `${step.id}/${path}: 快照有未补全代码`);
    }
    previousState = step.toStateId;
  }
  assert.equal(previousState, project.codeDelivery.finalStateId);
});

test('super native snapshots: 三十节累计源码均可干净构建、执行专项测试和运行演示', { timeout: 600_000 }, async t => {
  for (const [tool, args] of [['make', ['--version']], ['c++', ['--version']], ['python3', ['--version']]]) {
    try { await execute(tool, args, { timeout: 10_000 }); }
    catch (error) {
      if (error.code === 'ENOENT') return t.skip(`需要本地工具链：${tool}`);
      throw error;
    }
  }
  const { project, codePackage } = await curriculum();
  const root = await mkdtemp(join(tmpdir(), 'eggy-super-build-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  await writeFiles(root, materializeProjectState(codePackage, project.codeDelivery.baselineStateId));
  for (const [index, step] of codePackage.steps.entries()) {
    console.log(`super snapshot ${index + 1}/30 START ${step.id}`);
    await writeFiles(root, learnerCodeStep(codePackage, step.id).files);
    await rm(join(root, 'build'), { recursive: true, force: true });
    assert.deepEqual(await readTree(root), materializeProjectState(codePackage, step.toStateId), `${step.id}: 复制清单遗漏源码或依赖额外文件`);
    try {
      await runTree('make', ['-j2', 'all'], { cwd: root, timeout: 45_000 });
      const checked = await runTree('make', ['test'], { cwd: root, timeout: 30_000 });
      const demo = await runTree('make', ['run'], { cwd: root, timeout: 30_000 });
      assert.ok(checked.stdout.trim(), `${step.id}: 本地测试必须输出实际检查结果`);
      assert.ok(demo.stdout.trim(), `${step.id}: 演示必须输出运行结果`);
    } catch (error) { assert.fail(`${step.id}: ${error.message}`); }
    console.log(`super snapshot ${index + 1}/30 PASS ${step.id}`);
  }
  await rm(join(root, 'build'), { recursive: true, force: true });
  const finalFiles = materializeProjectState(codePackage, project.codeDelivery.finalStateId);
  assert.deepEqual(await readTree(root), finalFiles);
  const checkedIn = await readTree(join(ROOT, 'courseware/super-arcade-data-center/project'));
  for (const [path, content] of Object.entries(finalFiles)) assert.equal(checkedIn[path], content, `${path}: 课程最终快照与源码工程不同`);
  assert.deepEqual(Object.keys(checkedIn).filter(path => !path.startsWith('build/')).sort(), Object.keys(finalFiles).sort());
});

test('工坊的文字草稿可以预览当前源码，变更摘要、文件或快照引用后必须拒绝混用旧包', async () => {
  const { project, codePackage } = await curriculum();
  const payload = { codePackage, packageSha256: project.codeDelivery.packageSha256 };
  const draft = structuredClone(project);
  draft.chapters[0].title = '尚未发布的文字改进';
  assert.deepEqual(matchingCodePackage(draft, payload), codePackage);
  const mutations = [
    value => { value.codeDelivery.packageSha256 = '0'.repeat(64); },
    value => { value.chapters[0].guidedSteps[0].codeStepId = 'missing-code-step'; },
    value => { value.chapters[0].guidedSteps[0].targetFiles.push('src/unpublished.hpp'); },
    value => { value.chapters[0].snapshotStateId = project.codeDelivery.finalStateId; },
    value => { value.codeDelivery.finalStateId = project.codeDelivery.baselineStateId; }
  ];
  for (const mutate of mutations) {
    const incompatible = structuredClone(draft);
    mutate(incompatible);
    assert.throws(() => matchingCodePackage(incompatible, payload), /代码包不一致/);
  }
});

test('代码包 HTTP 接口返回课程指定版本，重复读取与摘要错误都不改动学习数据', async t => {
  const { course, project, codePackage } = await curriculum();
  const root = await mkdtemp(join(tmpdir(), 'eggy-super-http-'));
  let app;
  t.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }); });
  await cp(join(ROOT, 'data'), join(root, 'data'), { recursive: true });
  await writeFile(join(root, 'data/progress.json'), JSON.stringify(freshProgress(course)));
  await writeFile(join(root, 'data/week-card.json'), JSON.stringify(freshWeekCard(course)));
  app = await startServer({ root, assetRoot: ROOT, port: 0 });
  const before = await readTree(join(root, 'data'));
  const url = `${app.url}/api/play/projects/${PROJECT_ID}/code-package`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('etag'));
    const body = await response.json();
    assert.equal(body.packageSha256, project.codeDelivery.packageSha256);
    assert.deepEqual(body.codePackage, codePackage);
  }
  assert.deepEqual(await readTree(join(root, 'data')), before, '查看或重复加载代码不得写进度、课程和周卡');

  // Only the isolated fixture is damaged; a previously cached good package must not hide the mismatch.
  const packagePath = join(root, 'data', project.codeDelivery.packageFile);
  await writeFile(packagePath, `${await readFile(packagePath, 'utf8')}\n`);
  const damaged = await readTree(join(root, 'data'));
  const response = await fetch(url);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'invalid_code_package');
  assert.deepEqual(await readTree(join(root, 'data')), damaged, '摘要校验失败也不能覆盖任何课程或学习记录');
});

test('super external: 独立TCP客户端与SQLite进程验证重试、回滚、跨实例竞争和重启持久性', { timeout: 120_000 }, async t => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'courseware/super-arcade-data-center/manifest.json'), 'utf8'));
  const workspace = await mkdtemp(join(tmpdir(), 'eggy-super-external-'));
  const projectRoot = join(workspace, 'project');
  const processes = [];
  t.after(async () => {
    for (const process of processes.reverse()) await process.stop();
    await rm(workspace, { recursive: true, force: true });
  });
  await writeFiles(projectRoot, manifest.chapters.at(-1).steps.at(-1).files);
  await runTree('make', ['-j2', 'all'], { cwd: projectRoot, timeout: 45_000 });
  const query = await sqliteProbe(workspace);
  const database = join(workspace, 'independent.sqlite');
  async function service(env = {}) {
    const process = await launch(join(projectRoot, 'build/service'), [database, '0', join(projectRoot, 'db/schema.sql')], {
      cwd: projectRoot, env, readyPattern: /SERVICE_READY=(\d+)/
    });
    processes.push(process);
    return { ...process, port: Number(process.ready[1]) };
  }
  const first = await service({ ARCADE_TEST_DROP_ACK_ONCE: 'lost-ack', ARCADE_TEST_FAIL_AFTER_DEBIT: 'rollback' });
  const second = await service();
  const gateway = await launch(join(projectRoot, 'build/gateway'), ['0', String(first.port)], {
    cwd: projectRoot, readyPattern: /GATEWAY_READY=(\d+)/
  });
  processes.push(gateway);
  const gatewayPort = Number(gateway.ready[1]);

  console.log('super external: fragmented/coalesced TCP frames and stable duplicate responses');
  const fragmented = frame('ADD|seed|alice|100');
  assert.deepEqual(await exchange(gatewayPort, [fragmented.subarray(0, 1), fragmented.subarray(1, 3), fragmented.subarray(3, 7), fragmented.subarray(7)], { interval: 10 }), ['OK|ADD|seed|100']);
  assert.deepEqual(await exchange(first.port, [Buffer.concat([frame('ADD|bob-seed|bob|20'), frame('BALANCE|bob')])], { frames: 2 }), ['OK|ADD|bob-seed|20', 'OK|BALANCE|bob|20']);
  assert.equal(await request(first.port, 'REDEEM|buy|alice|30'), 'OK|REDEEM|buy|70');
  assert.equal(await request(second.port, 'REDEEM|buy|alice|30'), 'OK|REDEEM|buy|70');
  assert.match(await request(first.port, 'ADD|buy|alice|30'), /^ERR\|CONFLICT/);
  assert.equal(await request(second.port, 'BALANCE|alice'), 'OK|BALANCE|alice|70');
  assert.equal(await request(first.port, 'ADD|canonical|canonical|0005'), 'OK|ADD|canonical|5');
  assert.equal(await request(second.port, 'ADD|canonical|canonical|5'), 'OK|ADD|canonical|5');
  assert.equal(await request(first.port, 'REDEEM|denied|limited|10'), 'ERR|INSUFFICIENT');
  assert.equal(await request(second.port, 'ADD|fund-limited|limited|20'), 'OK|ADD|fund-limited|20');
  assert.equal(await request(first.port, 'REDEEM|denied|limited|10'), 'ERR|INSUFFICIENT', '失败业务响应也必须按首次事件回放，后续充值不能让相同请求偷偷变成扣款');
  assert.equal(await request(first.port, 'BALANCE|limited'), 'OK|BALANCE|limited|20');
  assert.equal(await request(first.port, 'ADD|limit-seed|maximum|1000000'), 'OK|ADD|limit-seed|1000000');
  assert.equal(await request(second.port, 'ADD|limit-excess|maximum|1'), 'ERR|LIMIT');
  for (const amount of ['0', '-1', '1000001', '2147483648', '1x']) {
    assert.equal(await request(first.port, `ADD|invalid-number|alice|${amount}`), 'ERR|BAD_REQUEST');
  }
  assert.equal(await request(second.port, 'BALANCE|alice'), 'OK|BALANCE|alice|70');

  const retriedPayloads = [];
  const silentPeer = net.createServer(socket => {
    let received = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', bytes => {
      received = Buffer.concat([received, bytes]);
      if (received.length >= 4 && received.length >= 4 + received.readUInt32BE(0)) {
        retriedPayloads.push(received.subarray(4, 4 + received.readUInt32BE(0)).toString());
        socket.destroy();
      }
    });
  });
  await new Promise(resolve => silentPeer.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(execute(join(projectRoot, 'build/client'), [String(silentPeer.address().port), 'ADD|never-ack|alice|1', '2'], { cwd: projectRoot, timeout: 5_000 }), error => typeof error.code === 'number' && error.code !== 0);
    assert.equal(retriedPayloads.length, 3, '两次重试应恰好发送三次，随后明确失败');
    assert.ok(retriedPayloads.every(payload => payload === 'ADD|never-ack|alice|1'), '传输重试必须保留同一个事件ID与业务参数');
  } finally { await new Promise(resolve => silentPeer.close(resolve)); }

  const lost = await execute(join(projectRoot, 'build/client'), [String(gatewayPort), 'ADD|lost-ack|bob|5', '2'], { cwd: projectRoot, timeout: 8_000 });
  assert.ok(lost.stdout.includes('OK|ADD|lost-ack|25'), lost.stdout);
  assert.equal(await request(second.port, 'ADD|lost-ack|bob|5'), 'OK|ADD|lost-ack|25');
  assert.deepEqual(await query(database, "SELECT COUNT(*) FROM ledger WHERE event_id='lost-ack'"), [['1']]);

  assert.match(await request(first.port, 'REDEEM|rollback|alice|10'), /^ERR\|/);
  assert.equal(await request(second.port, 'BALANCE|alice'), 'OK|BALANCE|alice|70');
  assert.deepEqual(await query(database, "SELECT COUNT(*) FROM ledger WHERE event_id='rollback'"), [['0']]);
  assert.deepEqual(await query(database, "SELECT COUNT(*) FROM requests WHERE event_id='rollback'"), [['0']]);

  console.log('super external: cross-process SQLite redemption, duplicate and conflict races');
  await request(first.port, 'ADD|bank-seed|bank|100');
  const redemptions = await Promise.all(Array.from({ length: 14 }, (_, index) => request(index % 2 ? first.port : second.port, `REDEEM|purchase-${index}|bank|10`)));
  assert.equal(redemptions.filter(reply => reply.startsWith('OK|REDEEM|')).length, 10, redemptions.join('\n'));
  assert.equal(redemptions.filter(reply => reply.startsWith('ERR|INSUFFICIENT')).length, 4, redemptions.join('\n'));
  assert.equal(await request(first.port, 'BALANCE|bank'), 'OK|BALANCE|bank|0');
  const duplicates = await Promise.all(Array.from({ length: 12 }, (_, index) => request(index % 2 ? first.port : second.port, 'ADD|duplicate|dupe|7')));
  assert.ok(duplicates.every(reply => reply === 'OK|ADD|duplicate|7'), duplicates.join('\n'));
  assert.deepEqual(await query(database, "SELECT COUNT(*) FROM ledger WHERE event_id='duplicate'"), [['1']]);
  const conflicting = await Promise.all([request(first.port, 'ADD|conflict|contended|1'), request(second.port, 'ADD|conflict|contended|2')]);
  assert.equal(conflicting.filter(reply => reply.startsWith('OK|ADD|')).length, 1);
  assert.equal(conflicting.filter(reply => reply.startsWith('ERR|CONFLICT')).length, 1);
  assert.deepEqual(await query(database, "SELECT COUNT(*) FROM ledger WHERE event_id='conflict'"), [['1']]);

  // This lock belongs to a third process and bypasses both service instances' C++ mutexes.
  console.log('super external: independent SQLite writer lock and recovery');
  const locker = await launch(join(workspace, 'sqlite-probe'), [database, '--lock'], { cwd: workspace, readyPattern: /LOCK_READY/ });
  processes.push(locker);
  const busyStart = Date.now();
  const blocked = await request(first.port, 'ADD|busy-write|busy|3').catch(error => `CLOSED:${error.message}`);
  assert.ok(!blocked.startsWith('OK|'), blocked);
  assert.ok(Date.now() - busyStart < 2_500, '外部SQLite写锁不能让网络请求无限等待');
  locker.child.stdin.end('\n');
  assert.equal((await locker.closed).code, 0);
  assert.equal(await request(first.port, 'ADD|busy-write|busy|3'), 'OK|ADD|busy-write|3');
  assert.deepEqual(await query(database, "SELECT COUNT(*) FROM ledger WHERE event_id='busy-write'"), [['1']]);

  console.log('super external: malformed frames, embedded NUL and slow-client deadlines');
  for (const [port, event] of [[first.port, 'bad-direct'], [gatewayPort, 'bad-gateway']]) {
    const invalid = await request(port, `ADD|${event}|alice|1\0trailing`).catch(() => 'CLOSED');
    assert.ok(invalid === 'CLOSED' || invalid.startsWith('ERR|'), invalid);
    assert.deepEqual(await query(database, `SELECT COUNT(*) FROM ledger WHERE event_id='${event}'`), [['0']]);
  }
  const oversized = Buffer.alloc(4); oversized.writeUInt32BE(4097);
  const malformedStart = Date.now();
  await exchange(first.port, [oversized], { frames: 0 });
  assert.ok(Date.now() - malformedStart < 2_500);
  const slowStart = Date.now();
  await Promise.all(Array.from({ length: 12 }, () => exchange(first.port, [Buffer.from([0])], { frames: 0 })));
  assert.ok(Date.now() - slowStart < 3_000, '排队时间必须计入连接截止时间，慢客户端不能串行耗尽工作线程');
  assert.equal(await request(first.port, 'BALANCE|alice'), 'OK|BALANCE|alice|70');

  console.log('super external: graceful process restart, durable replay and database invariants');
  for (const process of [gateway, first, second]) {
    const closed = await process.stop();
    assert.equal(closed.code, 0, `服务应优雅退出：${JSON.stringify(closed)}\n${process.errors()}`);
  }
  const restarted = await service();
  assert.equal(await request(restarted.port, 'BALANCE|alice'), 'OK|BALANCE|alice|70');
  assert.equal(await request(restarted.port, 'BALANCE|bob'), 'OK|BALANCE|bob|25');
  assert.equal(await request(restarted.port, 'ADD|seed|alice|100'), 'OK|ADD|seed|100', '重启后应回放首次响应，不能重复入账或改成当前余额');
  assert.equal(await request(restarted.port, 'REDEEM|rollback|alice|10'), 'OK|REDEEM|rollback|60', '失败事务未留下请求占位，恢复后同ID可正常提交');
  assert.match(await request(restarted.port, 'TOP|2'), /^OK\|TOP\|maximum:1000000,alice:60/);
  assert.equal(await request(restarted.port, 'REDEEM|denied|limited|10'), 'ERR|INSUFFICIENT');
  const history = await request(restarted.port, 'HISTORY|alice');
  for (const event of ['seed', 'buy', 'rollback']) assert.ok(history.includes(event), history);
  for (const [player, coins, delta] of await query(database, 'SELECT p.player,p.coins,COALESCE(SUM(l.delta),0) FROM players p LEFT JOIN ledger l ON l.player=p.player GROUP BY p.player ORDER BY p.player')) {
    assert.equal(coins, delta, `${player}: 持久余额与真实流水不守恒`);
  }
  assert.deepEqual(await query(database, 'PRAGMA integrity_check'), [['ok']]);
  assert.deepEqual(await query(database, 'PRAGMA foreign_key_check'), []);
  const historyPlan = await query(database, "EXPLAIN QUERY PLAN SELECT event_id,kind,amount FROM ledger WHERE player='alice' ORDER BY seq ASC LIMIT 20");
  assert.ok(historyPlan.some(row => /SEARCH.*ledger.*INDEX/i.test(row.at(-1))), JSON.stringify(historyPlan));
  assert.equal(await request(restarted.port, 'ADD|crash-kept|crash|9'), 'OK|ADD|crash-kept|9');
  restarted.child.kill('SIGKILL');
  assert.equal((await restarted.closed).signal, 'SIGKILL');
  const recovered = await service();
  assert.equal(await request(recovered.port, 'BALANCE|crash'), 'OK|BALANCE|crash|9', '已确认提交的数据在进程异常结束后仍应可查询');
  assert.equal(await request(recovered.port, 'ADD|crash-kept|crash|9'), 'OK|ADD|crash-kept|9');
  assert.deepEqual(await query(database, "SELECT COUNT(*) FROM ledger WHERE event_id='crash-kept'"), [['1']]);
});
