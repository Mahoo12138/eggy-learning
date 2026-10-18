import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { startServer } from '../server.mjs';
import { sanitizeProjectCodePackage, materializeProjectState, learnerCodeStep } from '../lib/project-code-delivery.mjs';
import { freshProgress, freshWeekCard, sanitizeCourse } from '../shared/park-domain.mjs';
import { chapterCodeReady, finalSourceModel, guidedCodeModel, matchingCodePackage } from '../public/assets/project-code-delivery.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT_ID = 'peak-delivery-center-project';
const execute = promisify(execFile);
const CHAPTER_IDS = [
  'cpp-domain-model', 'raii-ownership', 'compute-baseline', 'data-locality',
  'worker-threads', 'blocking-queue', 'task-pool', 'inventory-race',
  'deadlock-cancel', 'graceful-shutdown'
];

async function curriculum() {
  const index = JSON.parse(await readFile(join(ROOT, 'data/course.json'), 'utf8'));
  const definitions = [...index.levels, ...index.projects];
  const details = await Promise.all(definitions.map(async item => JSON.parse(await readFile(join(ROOT, 'data', item.file), 'utf8'))));
  const course = sanitizeCourse(index, details);
  const project = course.projects.find(item => item.id === PROJECT_ID);
  assert.ok(project?.codeDelivery, '巅峰凤凰蛋必须发布完整代码包');
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

test('巅峰凤凰蛋保留配送中心和旧章节身份，并为十节课程提供概念、完整代码和独立验证', async () => {
  const { index, details, project, bytes, codePackage } = await curriculum();
  const detail = details.find(item => item.id === PROJECT_ID);
  assert.deepEqual(index.projects.find(item => item.id === PROJECT_ID), detail, '索引与详情必须指向同一份课程');
  assert.equal(project.rankId, 'peak-phoenix');
  assert.equal(project.boss.id, 'peak-delivery-center-boss');
  assert.equal(project.version, 2);
  assert.match(project.title, /配送中心/);
  assert.deepEqual(project.languages, ['cpp']);
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

test('三十节完整源码从空目录累计后均可真实编译、测试并运行，最终目录与交付工程一致', { timeout: 360_000 }, async t => {
  try {
    await execute('make', ['--version'], { timeout: 10_000 });
    await execute('c++', ['--version'], { timeout: 10_000 });
  } catch (error) {
    if (error.code === 'ENOENT') return t.skip('需要 make 与支持 C++20 的本地 C++ 编译器');
    throw error;
  }
  const { project, codePackage } = await curriculum();
  const root = await mkdtemp(join(tmpdir(), 'eggy-peak-build-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  await writeFiles(root, materializeProjectState(codePackage, project.codeDelivery.baselineStateId));
  for (const step of codePackage.steps) {
    await writeFiles(root, learnerCodeStep(codePackage, step.id).files);
    await rm(join(root, 'build'), { recursive: true, force: true });
    assert.deepEqual(await readTree(root), materializeProjectState(codePackage, step.toStateId), `${step.id}: 磁盘工程含额外或缺失源码`);
    try {
      await execute('make', ['-j2', 'all'], { cwd: root, timeout: 45_000, maxBuffer: 4 * 1024 * 1024 });
      // Invoke binaries directly so timeout kills every worker thread, even if a regression deadlocks.
      const tests = await execute(join(root, 'build/tests'), [], { cwd: root, timeout: 15_000 });
      const demo = await execute(join(root, 'build/phoenix'), [], { cwd: root, timeout: 15_000 });
      assert.match(tests.stdout, /ALL TESTS PASSED \(\d+ groups\)/);
      assert.match(demo.stdout, /DEMO OK/);
    } catch (error) {
      assert.fail(`${step.id} 编译/运行失败或超时:\n${error.stdout || ''}\n${error.stderr || ''}\n${error.message}`);
    }
  }
  // Repeat real concurrent tests, varying schedules without relying on a speedup threshold.
  for (let repeat = 0; repeat < 20; repeat++) {
    const { stdout } = await execute(join(root, 'build/tests'), [], { cwd: root, timeout: 15_000 });
    assert.match(stdout, /ALL TESTS PASSED \(10 groups\)/);
  }
  const { stdout: benchmark } = await execute(join(root, 'build/phoenix'), ['--benchmark'], { cwd: root, timeout: 30_000 });
  const rounds = benchmark.trim().split('\n');
  assert.equal(rounds.length, 3, benchmark);
  const checksums = new Set();
  for (const [index, line] of rounds.entries()) {
    assert.ok(line.startsWith(`benchmark round=${index + 1} `), line);
    assert.match(line, /equivalent=yes/);
    for (const field of ['sequential_ms', 'packed_ms', 'parallel_ms', 'packing_ms', 'speedup']) {
      const match = line.match(new RegExp(`${field}=([0-9.]+)`));
      assert.ok(match && Number.isFinite(Number(match[1])) && Number(match[1]) >= 0, line);
    }
    checksums.add(line.match(/checksum=(\d+)/)?.[1]);
  }
  assert.equal(checksums.size, 1, '相同工作负载的三轮校验和必须相同');
  assert.equal(checksums.has(undefined), false);
  await rm(join(root, 'build'), { recursive: true, force: true });
  const finalFiles = materializeProjectState(codePackage, project.codeDelivery.finalStateId);
  assert.deepEqual(await readTree(root), finalFiles);
  const checkedIn = await readTree(join(ROOT, 'courseware/peak-delivery-center/project'));
  for (const [path, content] of Object.entries(finalFiles)) assert.equal(checkedIn[path], content, `最终可交付工程的 ${path} 与课程最终快照不同`);
  assert.deepEqual(Object.keys(checkedIn).filter(path => !path.startsWith('build/')).sort(), Object.keys(finalFiles).sort(), '独立工程不能依赖未在课程中交付的文件');
});

test('代码包 HTTP 接口返回课程指定版本，重复读取与摘要错误都不改动学习数据', async t => {
  const { course, project, codePackage } = await curriculum();
  const root = await mkdtemp(join(tmpdir(), 'eggy-peak-http-'));
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
