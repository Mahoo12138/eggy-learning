import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { access, cp, mkdtemp, readFile, readdir, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gradeLevel, startServer } from '../server.mjs';
import { PROJECT_CODE_MAX_PACKAGE_BYTES } from '../lib/project-code-delivery.mjs';
import { freshProgress, sanitizeCourse, submitAttempt } from '../shared/park-domain.mjs';
import { withMasteryChallenges } from '../lib/mastery-challenges.mjs';

const PROJECT = fileURLToPath(new URL('..', import.meta.url));
const V3_CONTENT_VERSION = 3;
const EARLY_RANK_IDS = new Set(['quail', 'pigeon', 'chicken']);
const PARK_SCENE_TERMS = [
  '摩天轮', '盲盒', '烘焙', '奶茶', '游戏厅', '换新店', '形象店', '喷泉', '蛋仔公园', '足球', '商城', '钢琴',
  '咸鱼', '弹簧绳', '钩爪', '加速鞋', '炸弹', '地雷', '传送球', '缩小牛奶', '垫脚石', '弹板', '云雾弹', '墨汁炸弹', '弹力球'
];

function assertNoSceneBindings(value, label) {
  const queue = [{ value, path: label }];
  while (queue.length) {
    const current = queue.pop();
    if (!current.value || typeof current.value !== 'object') continue;
    for (const [key, child] of Object.entries(current.value)) {
      assert.equal(['locationId', 'locationIds', 'propIds'].includes(key), false, `${current.path}.${key} 不应暴露前三段位场景绑定`);
      if (child && typeof child === 'object') queue.push({ value: child, path: `${current.path}.${key}` });
    }
  }
  const copy = JSON.stringify(value);
  for (const term of PARK_SCENE_TERMS) assert.equal(copy.includes(term), false, `${label} 不应出现乐园建筑或道具词“${term}”`);
}

async function checkedInCourse() {
  const index = JSON.parse(await readFile(join(PROJECT, 'data/course.json'), 'utf8'));
  const names = await readdir(join(PROJECT, 'data/levels'));
  const details = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(PROJECT, 'data/levels', name), 'utf8'))));
  return sanitizeCourse(index, details);
}

async function executable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const missingCRuntime = [];
if (process.platform !== 'darwin') missingCRuntime.push('macOS');
if (!(await executable('/usr/bin/clang'))) missingCRuntime.push('/usr/bin/clang');
if (!(await executable('/usr/bin/sandbox-exec'))) missingCRuntime.push('/usr/bin/sandbox-exec');
const cRuntimeSkip = missingCRuntime.length
  ? `需要真实的 macOS clang 与 sandbox-exec；缺少：${missingCRuntime.join(', ')}`
  : false;

async function fixture(t, { start = true, storeOptions = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eggy-server-v2-'));
  const running = [];
  t.after(async () => {
    for (const app of running.reverse()) await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await cp(join(PROJECT, 'data'), join(root, 'data'), { recursive: true });
  const course = await checkedInCourse();
  await writeFile(join(root, 'data/progress.json'), `${JSON.stringify(freshProgress(course, 'learner-1'), null, 2)}\n`, 'utf8');

  const result = {
    root,
    app: null,
    async start(options = {}) {
      const app = await startServer({
        root,
        assetRoot: PROJECT,
        host: '127.0.0.1',
        port: 0,
        lock: true,
        storeOptions,
        ...options
      });
      running.push(app);
      result.app = app;
      return app;
    }
  };
  if (start) await result.start();
  return result;
}

function request(app, path, {
  method = 'GET',
  data,
  raw,
  origin = method === 'GET' || method === 'HEAD' ? undefined : app.url,
  host,
  contentType = 'application/json',
  etag
} = {}) {
  const target = new URL(app.url);
  const payload = raw === undefined
    ? (data === undefined ? undefined : JSON.stringify(data))
    : raw;
  const headers = {};
  if (origin !== undefined) headers.Origin = origin;
  if (host !== undefined) headers.Host = host;
  if (etag !== undefined) headers['If-Match'] = etag;
  if (payload !== undefined) {
    headers['Content-Type'] = contentType;
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      method,
      path,
      headers
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let body = text;
        if (/^application\/json\b/i.test(res.headers['content-type'] || '')) {
          try { body = JSON.parse(text); } catch { /* assertion below will expose invalid JSON */ }
        }
        resolve({ status: res.statusCode, headers: res.headers, etag: res.headers.etag, buffer, text, body });
      });
    });
    req.setTimeout(15_000, () => req.destroy(new Error('HTTP test timeout')));
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function expect(response, status) {
  assert.equal(response.status, status, response.text);
  return response;
}

function expectError(response, status, code) {
  expect(response, status);
  assert.equal(typeof response.body.error, 'string');
  assert.equal(response.body.code, code);
  return response;
}

function levelAttempt(overrides = {}) {
  return {
    requestId: 'attempt-run-observe-1',
    levelId: 'quail-fountain-sequence',
    contentVersion: V3_CONTENT_VERSION,
    stepId: 'run-observe',
    action: 'run',
    answer: '',
    hintLevel: 0,
    viewedFullAnswer: false,
    ...overrides
  };
}

function progressAtGoose(course) {
  let progress = freshProgress(course, 'learner-1');
  let sequence = 0;
  const submit = input => {
    sequence += 1;
    progress = submitAttempt(course, progress, input, {
      id: `goose-seed-attempt-${sequence}`,
      submittedAt: new Date(Date.UTC(2026, 9, 15, 0, sequence)).toISOString()
    }).progress;
  };

  for (const rankId of ['quail', 'pigeon', 'chicken']) {
    const rank = course.ranks.find(item => item.id === rankId);
    const boss = course.levels.find(item => item.id === rank.promotion.bossActivityId);
    for (const levelId of rank.activityIds.filter(item => item !== boss.id)) {
      const level = course.levels.find(item => item.id === levelId);
      for (const step of level.content.steps) {
        submit({
          requestId: `goose-seed-${sequence + 1}`,
          levelId,
          contentVersion: level.version,
          stepId: step.id,
          variantId: step.variants?.[0]?.id || '',
          action: 'submit',
          answer: 'fixture',
          hintLevel: 0,
          viewedFullAnswer: false,
          passed: true,
          independent: step.type === 'independent-variation'
        });
      }
    }
    for (const [index, checkpoint] of boss.content.checkpoints.entries()) {
      submit({
        requestId: `goose-seed-${sequence + 1}`,
        levelId: boss.id,
        contentVersion: boss.version,
        stepId: checkpoint.id,
        variantId: '',
        action: 'submit',
        answer: 'fixture',
        hintLevel: 0,
        viewedFullAnswer: false,
        passed: true,
        independent: index === boss.content.checkpoints.length - 1
      });
    }
  }
  assert.equal(progress.current.rankId, 'goose');
  return progress;
}

test('大厅、关卡和岛务状态来自 schema V2 的同一份 V3 课程；岛屿图片以正确 MIME 静态提供', async t => {
  const { app } = await fixture(t);

  const home = expect(await request(app, '/api/play/home'), 200);
  assert.equal(home.body.course.schemaVersion, 2);
  assert.equal(home.body.course.publishedRevision, 6);
  assert.equal(home.body.course.ranks.length, 9);
  assert.equal(home.body.progress.revision, 0);
  assert.equal(home.body.summary.currentActivityId, 'quail-fountain-sequence');
  assert.equal(home.body.currentLevel.id, 'quail-fountain-sequence');
  assert.ok(home.etag);
  assert.ok(home.body.course.levels.every(level => !Object.hasOwn(level, 'content')), '大厅不应一次下发所有关卡正文');
  assert.equal(Object.hasOwn(home.body.currentLevel, 'scene'), false, '前三段位当前关卡不应下发内部场景元数据');
  const homeIndependent = home.body.currentLevel.steps.find(step => step.id === 'independent-variation');
  assert.ok(homeIndependent.variants.every(variant => !Object.hasOwn(variant, 'fullSolution')), '大厅当前关卡不应下发独立变式答案');

  const level = expect(await request(app, '/api/play/levels/quail-fountain-sequence'), 200);
  assert.equal(level.body.level.id, 'quail-fountain-sequence');
  assert.equal(level.body.level.activityType, 'interactive-lesson');
  assert.equal(level.body.level.steps[0].id, 'predict');
  assert.equal(Object.hasOwn(level.body, 'location'), false);
  assert.equal(Object.hasOwn(level.body, 'props'), false);
  assert.equal(Object.hasOwn(level.body.level, 'scene'), false);
  const independent = level.body.level.steps.find(step => step.id === 'independent-variation');
  assert.ok(independent.variants.every(variant => variant.fullSolutionAvailable === true));
  assert.ok(independent.variants.every(variant => !Object.hasOwn(variant, 'fullSolution')));

  const admin = expect(await request(app, '/api/admin/state'), 200);
  assert.equal(admin.body.course.courseId, home.body.course.courseId);
  assert.equal(admin.body.progress.learner.id, home.body.learner.id);
  assert.equal(admin.body.course.levels.find(item => item.id === level.body.level.id).content.id, level.body.level.id);
  assert.equal(typeof admin.body.course.levels.find(item => item.id === level.body.level.id).content.steps.find(step => step.id === 'independent-variation').variants[0].fullSolution, 'string');
  assert.equal(typeof admin.body.versions.course, 'string');

  const image = expect(await request(app, '/assets/park/island-axis-hero.png'), 200);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.match(image.headers['cache-control'], /max-age=3600/);
  assert.deepEqual([...image.buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const head = expect(await request(app, '/assets/park/island-axis-hero.png', { method: 'HEAD' }), 200);
  assert.equal(head.buffer.length, 0);
  assert.equal(Number(head.headers['content-length']), image.buffer.length);
});

test('作品概念理解接口服务端判题、幂等留痕，并在管理端可见但不产生奖励', async t => {
  const course = await checkedInCourse();
  const seeded = progressAtGoose(course);
  const { root, start } = await fixture(t, { start: false });
  await writeFile(join(root, 'data/progress.json'), `${JSON.stringify(seeded, null, 2)}\n`, 'utf8');
  const app = await start();

  const project = course.projects.find(item => item.id === 'goose-food-street-project');
  const chapter = project.chapters[0];
  const check = chapter.conceptModule.checks[0];
  const wrongOption = check.options.find(item => item.id !== check.correctOptionId);
  const input = {
    requestId: 'server-concept-wrong',
    projectId: project.id,
    contentVersion: project.version,
    chapterId: chapter.id,
    checkId: check.id,
    selectedOptionId: wrongOption.id
  };

  const wrong = expect(await request(app, '/api/play/project-concept-attempts', { method: 'POST', data: input }), 200);
  assert.equal(wrong.body.result.passed, false);
  assert.equal(wrong.body.result.replayed, false);
  assert.equal(wrong.body.feedback.explanation, check.explanation);
  assert.equal(wrong.body.progress.conceptAttempts.length, 1);
  assert.equal(wrong.body.progress.xp.total, seeded.xp.total);
  assert.deepEqual(wrong.body.progress.projectArtifacts, seeded.projectArtifacts);
  assert.deepEqual(wrong.body.progress.awardLedger, seeded.awardLedger);

  const replay = expect(await request(app, '/api/play/project-concept-attempts', { method: 'POST', data: input }), 200);
  assert.equal(replay.body.result.replayed, true);
  assert.equal(replay.body.progress.revision, wrong.body.progress.revision);
  assert.equal(replay.body.progress.conceptAttempts.length, 1);

  const correct = expect(await request(app, '/api/play/project-concept-attempts', {
    method: 'POST',
    data: { ...input, requestId: 'server-concept-correct', selectedOptionId: check.correctOptionId }
  }), 200);
  assert.equal(correct.body.result.passed, true);
  assert.equal(correct.body.progress.conceptAttempts.length, 2);
  assert.equal(correct.body.progress.xp.total, seeded.xp.total);
  assert.deepEqual(correct.body.progress.projectArtifacts, seeded.projectArtifacts);
  assert.deepEqual(correct.body.progress.awardLedger, seeded.awardLedger);

  const invalid = expectError(await request(app, '/api/play/project-concept-attempts', {
    method: 'POST',
    data: { ...input, requestId: 'server-concept-invalid', selectedOptionId: 'missing-option' }
  }), 400, 'concept_option_not_found');
  assert.match(invalid.body.error, /选项不存在/);

  const restored = expect(await request(app, `/api/play/levels/${project.id}`), 200);
  assert.equal(restored.body.progress.conceptAttempts.length, 2);
  const admin = expect(await request(app, '/api/admin/state'), 200);
  assert.equal(admin.body.progress.conceptAttempts.length, 2);
  assert.deepEqual(admin.body.progress.conceptAttempts.map(item => item.result.passed), [false, true]);
});

test('前三段位的学习接口不暴露建筑或道具语汇，后六个段位作品仍保留地点上下文', async t => {
  const { app } = await fixture(t);
  const home = expect(await request(app, '/api/play/home'), 200).body;

  const earlyRanks = home.course.ranks.filter(rank => EARLY_RANK_IDS.has(rank.id));
  assert.equal(earlyRanks.length, 3);
  for (const rank of earlyRanks) {
    assert.equal(Object.hasOwn(rank, 'locationIds'), false, `${rank.id} 的学习者段位数据不应包含 locationIds`);
    assertNoSceneBindings(rank, `rank:${rank.id}`);
  }

  const earlyLevelIndexes = home.course.levels.filter(level => EARLY_RANK_IDS.has(level.rankId));
  assert.equal(earlyLevelIndexes.length, 12);
  for (const index of earlyLevelIndexes) {
    assertNoSceneBindings(index, `level-index:${index.id}`);
    const activity = expect(await request(app, `/api/play/levels/${index.id}`), 200).body;
    assert.equal(Object.hasOwn(activity, 'location'), false, `${index.id} 不应下发地点对象`);
    assert.equal(Object.hasOwn(activity, 'locations'), false, `${index.id} 不应下发地点列表`);
    assert.equal(Object.hasOwn(activity, 'props'), false, `${index.id} 不应下发道具列表`);
    assert.equal(Object.hasOwn(activity.level, 'scene'), false, `${index.id} 不应下发内部 scene`);
    assertNoSceneBindings({ rank: activity.rank, level: activity.level }, `activity:${index.id}`);
  }

  const locations = new Set(home.course.locations.map(location => location.id));
  const laterRanks = home.course.ranks.filter(rank => rank.order >= 4);
  assert.equal(laterRanks.length, 6);
  for (const rank of laterRanks) {
    const project = home.course.projects.find(item => item.id === rank.projectId);
    assert.ok(project, `${rank.id} 应有一个段位作品`);
    assert.ok(project.locationIds.length > 0, `${project.id} 应保留项目地点`);
    assert.ok(project.locationIds.every(locationId => locations.has(locationId)));

    const activity = expect(await request(app, `/api/play/levels/${project.id}`), 200).body;
    assert.deepEqual(activity.project.locationIds, project.locationIds);
    assert.deepEqual(new Set(activity.locations.map(location => location.id)), new Set(project.locationIds));
  }
});

test('升级到 contentVersion 3 后保留 V2 历史，但不会把旧步骤当作 V3 已完成', async t => {
  const courseV3 = await checkedInCourse();
  const checkedInLevel = courseV3.levels[0];
  assert.equal(checkedInLevel.version, 3, '仓库内前三段位内容应已发布为 V3');
  const v2Draft = structuredClone(courseV3);
  v2Draft.publishedRevision = 2;
  const v2DraftLevel = v2Draft.levels.find(level => level.id === checkedInLevel.id);
  v2DraftLevel.version = 2;
  v2DraftLevel.content.version = 2;
  const courseV2 = sanitizeCourse(v2Draft);
  const levelV2 = courseV2.levels.find(level => level.id === checkedInLevel.id);
  const firstStep = levelV2.content.steps[0];
  let progressV2 = freshProgress(courseV2, 'learner-1');
  progressV2 = submitAttempt(courseV2, progressV2, {
    requestId: 'version-two-first-step',
    levelId: levelV2.id,
    contentVersion: 2,
    stepId: firstStep.id,
    variantId: '',
    action: 'check',
    answer: 'v1 learner answer',
    hintLevel: 0,
    viewedFullAnswer: false,
    passed: true,
    independent: false
  }, {
    id: 'version-two-attempt',
    submittedAt: '2026-10-13T01:01:00.000Z'
  }).progress;

  const f = await fixture(t, { start: false });
  await writeFile(join(f.root, 'data/progress.json'), `${JSON.stringify(progressV2, null, 2)}\n`, 'utf8');

  const app = await f.start();
  const home = expect(await request(app, '/api/play/home'), 200).body;
  assert.equal(home.currentLevel.version, 3);
  assert.equal(home.progress.attempts.length, 1);
  assert.equal(home.progress.attempts[0].payload.contentVersion, 2);

  const activity = expect(await request(app, `/api/play/levels/${levelV2.id}`), 200).body;
  assert.equal(activity.level.version, 3);
  assert.deepEqual(activity.completedStepIds, [], 'V2 的通过记录不能推进 V3 的步骤游标');
  assert.equal(activity.progress.attempts[0].payload.stepId, firstStep.id, 'V2 历史仍应完整保留给管理端和学习记录');
});

test('拒绝伪造 Host、跨源写入、非 JSON 写入和静态目录穿越', async t => {
  const { app } = await fixture(t);
  const port = new URL(app.url).port;

  expectError(await request(app, '/api/play/home', { host: `evil.example:${port}` }), 403, 'invalid_request');
  expectError(await request(app, '/api/play/attempts', {
    method: 'POST',
    data: levelAttempt(),
    origin: 'https://evil.example'
  }), 403, 'origin_rejected');
  expectError(await request(app, '/api/play/attempts', {
    method: 'POST',
    raw: JSON.stringify(levelAttempt()),
    contentType: 'text/plain'
  }), 415, 'invalid_request');

  const traversal = expect(await request(app, '/%2e%2e%2fserver.mjs'), 404);
  assert.doesNotMatch(traversal.text, /export async function startServer/);
  assert.equal(traversal.headers['x-content-type-options'], 'nosniff');
  assert.equal(traversal.headers['x-frame-options'], 'DENY');
});

test('V3 的对象值、映射关系和顺序按完整结构判定', async () => {
  const course = await checkedInCourse();
  const objectBase = {
    requestId: 'boss-object-1', levelId: 'pigeon-data-boss', contentVersion: V3_CONTENT_VERSION,
    stepId: 'predict-values', action: 'check', hintLevel: 0, viewedFullAnswer: false
  };
  const objectCorrect = await gradeLevel(course, { ...objectBase, answer: JSON.stringify({ count: 3, sum: 250, best_index: 1 }) });
  assert.equal(objectCorrect.input.passed, true);
  const objectExtra = await gradeLevel(course, { ...objectBase, requestId: 'boss-object-2', answer: JSON.stringify({ count: 3, sum: 250, best_index: 1, guessed: true }) });
  assert.equal(objectExtra.input.passed, false);

  const orderBase = {
    requestId: 'boss-order-1', levelId: 'chicken-rules-boss', contentVersion: V3_CONTENT_VERSION,
    stepId: 'predict-paths', action: 'check', hintLevel: 0, viewedFullAnswer: false
  };
  const expectedOrder = course.levels.find(level => level.id === orderBase.levelId).content.checkpoints[0].evaluator.expected;
  const orderCorrect = await gradeLevel(course, { ...orderBase, answer: JSON.stringify(expectedOrder) });
  assert.equal(orderCorrect.input.passed, true);
  const orderWrong = await gradeLevel(course, { ...orderBase, requestId: 'boss-order-2', answer: JSON.stringify([...expectedOrder].reverse()) });
  assert.equal(orderWrong.input.passed, false);

  const mappingLevel = course.levels.find(level => level.id === 'quail-piano-output');
  const mappingStep = mappingLevel.content.steps.find(step => step.id === 'predict');
  const mappingCorrect = await gradeLevel(course, {
    requestId: 'lesson-mapping-1', levelId: mappingLevel.id, contentVersion: mappingLevel.version,
    stepId: mappingStep.id, action: 'check', hintLevel: 0, viewedFullAnswer: false,
    answer: JSON.stringify(mappingStep.evaluator.expected)
  });
  assert.equal(mappingCorrect.input.passed, true);
});

test('程序评分只分派已声明的 C 与 Linux 运行时，未知 runtimeId 会被明确拒绝', async () => {
  const course = structuredClone(await checkedInCourse());
  const level = course.levels.find(item => item.id === 'quail-fountain-sequence');
  const step = level.content.steps.find(item => item.id === 'short-edit');
  step.runtimeId = 'host-shell';

  await assert.rejects(
    gradeLevel(course, {
      requestId: 'unsupported-runtime-1',
      levelId: level.id,
      contentVersion: level.version,
      stepId: step.id,
      action: 'check',
      answer: step.starterFiles['main.c'],
      hintLevel: 0,
      viewedFullAnswer: false
    }),
    error => {
      assert.equal(error?.status, 400);
      assert.equal(error?.code, 'unsupported_runtime');
      assert.match(error.message, /host-shell/);
      return true;
    }
  );
});

test('C 评分不把注释或字符串里的标识符当作实现证据，即使硬编码 stdout 完全一致', { skip: cRuntimeSkip }, async () => {
  const course = structuredClone(await checkedInCourse());
  const level = course.levels.find(item => item.id === 'quail-fountain-sequence');
  const step = level.content.steps.find(item => item.id === 'independent-variation');
  const variant = step.variants.find(item => item.id === 'seconds-split');
  variant.grader.cases = [variant.grader.cases[0]];
  const hardcoded = `#include <stdio.h>
int main(void) {
  /* scanf if printf */
  const char *decoy = "scanf if printf";
  (void)decoy;
  puts("total_seconds=7509,clock=02:05:09");
  return 0;
}`;

  const graded = await gradeLevel(course, {
    requestId: 'hardcoded-c-output-1', levelId: level.id, contentVersion: level.version,
    stepId: step.id, variantId: variant.id, action: 'submit', answer: hardcoded,
    hintLevel: 0, viewedFullAnswer: false
  });

  assert.equal(graded.feedback.actualOutput, variant.grader.cases[0].stdout, '固定输出本身应与样例完全一致，确保回归确实由实现证据拦截');
  assert.equal(graded.input.passed, false);
  assert.deepEqual(graded.feedback.cases[0].requirementFailures, [
    '代码中需要实际使用 scanf',
    '代码中需要实际使用 if',
    '代码中需要实际使用 printf'
  ]);
  assert.match(graded.feedback.message, /实现证据还不完整/);
});

test('C 评分把预期非零退出码作为合同：正确的 status 1 通过，空输出但 status 0 仍失败', { skip: cRuntimeSkip }, async () => {
  const course = structuredClone(await checkedInCourse());
  const level = course.levels.find(item => item.id === 'quail-fountain-sequence');
  const step = level.content.steps.find(item => item.id === 'independent-variation');
  const variant = step.variants.find(item => item.id === 'seconds-split');
  const invalidCase = variant.grader.cases.find(testCase => testCase.exitCode === 1);
  variant.grader.cases = [invalidCase];

  const correct = await gradeLevel(course, {
    requestId: 'expected-exit-one-1', levelId: level.id, contentVersion: level.version,
    stepId: step.id, variantId: variant.id, action: 'submit', answer: variant.fullSolution,
    hintLevel: 0, viewedFullAnswer: false
  });
  assert.equal(correct.input.passed, true);
  assert.equal(correct.feedback.cases[0].exitCode, 1);
  assert.equal(correct.feedback.cases[0].expectedExitCode, 1);

  const wrongExit = await gradeLevel(course, {
    requestId: 'expected-exit-one-2', levelId: level.id, contentVersion: level.version,
    stepId: step.id, variantId: variant.id, action: 'submit',
    answer: `#include <stdio.h>
int main(void) {
  int hours, minutes, seconds;
  if (scanf("%d %d %d", &hours, &minutes, &seconds) != 3) return 1;
  printf("%s", "");
  return 0;
}`,
    hintLevel: 0, viewedFullAnswer: false
  });
  assert.equal(wrongExit.feedback.actualOutput, '');
  assert.deepEqual(wrongExit.feedback.cases[0].requirementFailures, []);
  assert.equal(wrongExit.feedback.cases[0].exitCode, 0);
  assert.equal(wrongExit.feedback.cases[0].expectedExitCode, 1);
  assert.equal(wrongExit.input.passed, false);
});

test('Linux 评分不接受伪造的相同 stdout，并分别核对命令、文件和进程最终状态', async () => {
  const course = structuredClone(await checkedInCourse());
  const level = course.levels.find(item => item.id === 'chicken-football-rounds');
  const variationStep = level.content.steps.find(item => item.id === 'independent-variation');
  const variant = variationStep.variants.find(item => item.id === 'filter-errors');
  variant.grader.cases = [variant.grader.cases[0]];

  const outputOnly = await gradeLevel(course, {
    requestId: 'linux-output-only-1', levelId: level.id, contentVersion: level.version,
    stepId: variationStep.id, variantId: variant.id, action: 'submit',
    answer: 'echo 640\necho 2\necho ERROR sensor\necho ERROR timeout',
    hintLevel: 0, viewedFullAnswer: false
  });
  assert.equal(outputOnly.feedback.actualOutput, variant.grader.cases[0].stdout);
  assert.equal(outputOnly.input.passed, false);
  assert.ok(outputOnly.feedback.cases[0].requirementFailures.some(message => /需要执行 cat/.test(message)));
  assert.ok(outputOnly.feedback.cases[0].requirementFailures.some(message => /需要生成文件 \/home\/learner\/errors\.txt/.test(message)));

  const wrongFileState = await gradeLevel(course, {
    requestId: 'linux-wrong-file-state-1', levelId: level.id, contentVersion: level.version,
    stepId: variationStep.id, variantId: variant.id, action: 'submit',
    answer: `cat > input.txt
cat input.txt | grep ERROR > errors.txt
chmod 640 errors.txt
stat -c %a errors.txt
wc -l errors.txt
cat errors.txt
echo INFO boot > errors.txt`,
    hintLevel: 0, viewedFullAnswer: false
  });
  assert.equal(wrongFileState.feedback.actualOutput, variant.grader.cases[0].stdout);
  assert.equal(wrongFileState.input.passed, false);
  assert.deepEqual(wrongFileState.feedback.cases[0].requirementFailures, ['/home/learner/errors.txt 的内容不符合任务要求']);

  const processStep = level.content.steps.find(item => item.id === 'short-edit');
  const wrongProcessState = await gradeLevel(course, {
    requestId: 'linux-wrong-process-state-1', levelId: level.id, contentVersion: level.version,
    stepId: processStep.id, action: 'submit',
    answer: `ps | grep logger
kill 318
ps | grep editor
kill 205`,
    hintLevel: 0, viewedFullAnswer: false
  });
  assert.equal(wrongProcessState.feedback.actualOutput, processStep.grader.expected);
  assert.equal(wrongProcessState.input.passed, false);
  assert.deepEqual(wrongProcessState.feedback.cases[0].requirementFailures, ['进程 205 不应被终止']);

  const pathLevel = course.levels.find(item => item.id === 'chicken-bomb-boundary');
  const pathStep = pathLevel.content.steps.find(item => item.id === 'independent-variation');
  const cleanupVariant = pathStep.variants.find(item => item.grader.requirements.absentFiles?.length);
  const wrongCommandEvidence = await gradeLevel(course, {
    requestId: 'linux-wrong-command-evidence-1', levelId: pathLevel.id, contentVersion: pathLevel.version,
    stepId: pathStep.id, variantId: cleanupVariant.id, action: 'submit',
    answer: `cd ~
mkdir /tmp/archive
cp ./work/notes.txt /tmp/archive/notes.txt
touch /tmp/dummy.txt
mv /tmp/dummy.txt /tmp/dummy-moved.txt
touch /tmp/scratch.txt
rm /tmp/scratch.txt
cd /tmp/archive
pwd
ls
cat ./notes.txt`,
    hintLevel: 0, viewedFullAnswer: false
  });
  assert.equal(wrongCommandEvidence.feedback.actualOutput, cleanupVariant.grader.expected);
  assert.equal(wrongCommandEvidence.input.passed, false);
  assert.deepEqual(wrongCommandEvidence.feedback.cases[0].requirementFailures, [
    '缺少可验证的命令步骤：cp',
    '缺少可验证的命令步骤：mv'
  ]);

  const recreatedTemporaryFiles = await gradeLevel(course, {
    requestId: 'linux-recreated-temporary-files-1', levelId: pathLevel.id, contentVersion: pathLevel.version,
    stepId: pathStep.id, variantId: cleanupVariant.id, action: 'submit',
    answer: `${cleanupVariant.fullSolution}\ntouch /tmp/staging.txt\ntouch /tmp/scratch.txt`,
    hintLevel: 0, viewedFullAnswer: false
  });
  assert.equal(recreatedTemporaryFiles.feedback.actualOutput, cleanupVariant.grader.expected);
  assert.equal(recreatedTemporaryFiles.input.passed, false);
  assert.deepEqual(recreatedTemporaryFiles.feedback.cases[0].requirementFailures, [
    '文件 /tmp/staging.txt 应已被移走或删除',
    '文件 /tmp/scratch.txt 应已被移走或删除'
  ]);
});

test('前两段 Boss 的四份修复与独立参考解法满足实现合同和全部真实用例', { skip: cRuntimeSkip }, async () => {
  const course = await checkedInCourse();
  const quailRepaired = `#include <stdio.h>
int accepted(int value) { return value > 0; }
int main(void) {
  int n;
  if (scanf("%d", &n) != 1 || n < 1 || n > 8) return 1;
  int count = 0, sum = 0;
  for (int i = 0; i < n; i++) {
    int value;
    if (scanf("%d", &value) != 1) return 1;
    if (accepted(value)) { count++; sum += value; }
  }
  printf("count=%d,sum=%d\\n", count, sum);
  return 0;
}`;
  const quailTransferred = `#include <stdio.h>
int accepted(int value) { return value >= -100 && value <= 100; }
int main(void) {
  int n;
  if (scanf("%d", &n) != 1 || n < 1 || n > 8) return 1;
  int valid = 0, sum = 0, min = 0, max = 0;
  for (int i = 0; i < n; i++) {
    int value;
    if (scanf("%d", &value) != 1) return 1;
    if (!accepted(value)) continue;
    if (valid == 0) min = max = value;
    else {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    valid++;
    sum += value;
  }
  if (valid == 0) printf("valid=0,sum=0\\n");
  else printf("valid=%d,sum=%d,min=%d,max=%d\\n", valid, sum, min, max);
  return 0;
}`;
  const pigeonRepaired = `#include <stdio.h>
typedef struct { int id; int score; } Record;
int main(void) {
  Record records[2] = {{12, 80}, {7, 95}};
  FILE *file = fopen("records.txt", "w+");
  if (!file) return 1;
  for (int i = 0; i < 2; i++) fprintf(file, "%d %d\\n", records[i].id, records[i].score);
  rewind(file);
  int id, score, total = 0;
  while (fscanf(file, "%d %d", &id, &score) == 2) total += score;
  fclose(file);
  printf("total=%d\\n", total);
  return 0;
}`;
  const pigeonTransferred = `#include <stdio.h>
#include <stdlib.h>
typedef struct { int id; int score; } Record;
int main(void) {
  int n;
  if (scanf("%d", &n) != 1 || n < 1 || n > 8) return 1;
  Record *records = malloc((size_t)n * sizeof *records);
  if (!records) return 1;
  for (int i = 0; i < n; i++) {
    if (scanf("%d %d", &records[i].id, &records[i].score) != 2) { free(records); return 1; }
  }
  FILE *file = fopen("records.txt", "w+");
  if (!file) { free(records); return 1; }
  for (int i = 0; i < n; i++) fprintf(file, "%d %d\\n", records[i].id, records[i].score);
  rewind(file);
  int id, score, count = 0, sum = 0, best_id = 0, best_score = 0;
  while (fscanf(file, "%d %d", &id, &score) == 2) {
    if (count == 0 || score > best_score) { best_id = id; best_score = score; }
    count++;
    sum += score;
  }
  fclose(file);
  free(records);
  printf("count=%d,sum=%d,best_id=%d,best_score=%d\\n", count, sum, best_id, best_score);
  return 0;
}`;

  const references = [
    ['quail-opening-boss', 'repair-broadcast', quailRepaired],
    ['quail-opening-boss', 'transfer-new-show', quailTransferred],
    ['pigeon-data-boss', 'repair-mixed-fields', pigeonRepaired],
    ['pigeon-data-boss', 'transfer-stock-panel', pigeonTransferred]
  ];
  for (const [levelId, stepId, answer] of references) {
    const level = course.levels.find(item => item.id === levelId);
    const graded = await gradeLevel(course, {
      requestId: `boss-reference-${levelId}-${stepId}`, levelId: level.id, contentVersion: level.version,
      stepId, action: 'submit', answer, hintLevel: 0, viewedFullAnswer: false
    });
    assert.equal(graded.input.passed, true, `${levelId}/${stepId} 参考解法应通过：${JSON.stringify(graded.feedback)}`);
    assert.ok(graded.feedback.cases.every(testCase => testCase.passed));
    assert.ok(graded.feedback.cases.every(testCase => testCase.requirementFailures.length === 0));
  }
  assert.equal(references.length, 4);
});

test('鸡蛋 Boss 的两份 Linux 修复与独立参考解法满足行为证据和最终状态', async () => {
  const course = await checkedInCourse();
  const level = course.levels.find(item => item.id === 'chicken-rules-boss');
  const references = [
    ['repair-loop-boundary', `cd /var/log
cat app.log | grep ERROR > /home/learner/errors.txt
chmod 640 /home/learner/errors.txt
ps | grep logger
kill 318
ps | grep editor
cat /home/learner/errors.txt`],
    ['transfer-item-judge', `cat > input.log
cat input.log | grep ERROR > errors.txt
chmod 640 errors.txt
echo checked > audit.txt
echo complete >> audit.txt
ps | grep logger
kill 318
stat -c %a errors.txt
wc -l errors.txt
cat errors.txt
cat audit.txt
ps | grep editor`]
  ];

  for (const [stepId, answer] of references) {
    const graded = await gradeLevel(course, {
      requestId: `boss-reference-${level.id}-${stepId}`, levelId: level.id, contentVersion: level.version,
      stepId, action: 'submit', answer, hintLevel: 0, viewedFullAnswer: false
    });
    assert.equal(graded.input.passed, true, `${level.id}/${stepId} 参考解法应通过：${JSON.stringify(graded.feedback)}`);
    assert.ok(graded.feedback.cases.every(testCase => testCase.passed));
    assert.ok(graded.feedback.cases.every(testCase => testCase.requirementFailures.length === 0));
  }
  assert.equal(references.length, 2);
});

test('前两段 12 份 C 独立变式都通过真实 C17 评分', { skip: cRuntimeSkip }, async () => {
  const course = await checkedInCourse();
  let checked = 0;
  for (const level of course.levels.filter(item => item.kind === 'interactive-lesson' && ['quail', 'pigeon'].includes(item.rankId))) {
    for (const step of level.content.steps.filter(item => item.type === 'independent-variation')) {
      assert.equal(step.runtimeId, 'c17-console');
      for (const variant of step.variants) {
        const graded = await gradeLevel(course, {
          requestId: `solution-${level.id}-${variant.id}`,
          levelId: level.id,
          contentVersion: level.version,
          stepId: step.id,
          variantId: variant.id,
          action: 'check',
          answer: variant.fullSolution,
          hintLevel: 3,
          viewedFullAnswer: true
        });
        assert.equal(graded.input.passed, true, `${level.id}/${variant.id} 的完整解法应通过评分：${JSON.stringify(graded.feedback)}`);
        assert.equal(graded.feedback.kind, 'program');
        checked++;
      }
    }
  }
  assert.equal(checked, 12);
});

test('第三段 6 份 Linux 独立变式都由虚拟终端评分，不会落入 C 运行器', async () => {
  const course = await checkedInCourse();
  let checked = 0;
  for (const level of course.levels.filter(item => item.kind === 'interactive-lesson' && item.rankId === 'chicken')) {
    for (const step of level.content.steps.filter(item => item.type === 'independent-variation')) {
      assert.equal(step.runtimeId, 'linux-shell-sim');
      for (const variant of step.variants) {
        const graded = await gradeLevel(course, {
          requestId: `linux-solution-${level.id}-${variant.id}`,
          levelId: level.id,
          contentVersion: level.version,
          stepId: step.id,
          variantId: variant.id,
          action: 'check',
          answer: variant.fullSolution,
          hintLevel: 3,
          viewedFullAnswer: true
        });
        assert.equal(graded.input.passed, true, `${level.id}/${variant.id} 的完整命令应通过评分：${JSON.stringify(graded.feedback)}`);
        assert.equal(graded.feedback.kind, 'terminal');
        checked++;
      }
    }
  }
  assert.equal(checked, 6);
});

test('真实 C 输出参与判定；requestId 幂等且重复请求或新请求都不能刷经验；错误输出不通过', { skip: cRuntimeSkip }, async t => {
  const { app } = await fixture(t);
  const input = levelAttempt();

  expectError(await request(app, '/api/play/attempts', { method: 'POST', data: input }), 409, 'step_locked');
  const prediction = expect(await request(app, '/api/play/attempts', {
    method: 'POST',
    data: levelAttempt({
      requestId: 'attempt-predict-1',
      stepId: 'predict',
      action: 'check',
      answer: JSON.stringify([
        '声明 count、price 与 total',
        '检查 scanf 是否成功读到两个值',
        '计算 total = count * price',
        '按两位小数输出 total'
      ])
    })
  }), 200);
  assert.equal(prediction.body.feedback.passed, true);
  assert.equal(prediction.body.result.xpAwarded, 10);

  const first = expect(await request(app, '/api/play/attempts', { method: 'POST', data: input }), 200);
  assert.equal(first.body.feedback.kind, 'program');
  assert.equal(first.body.feedback.actualOutput, 'count=3,total=37.50\n', JSON.stringify(first.body.feedback));
  assert.equal(first.body.feedback.cases[0].expected, 'count=3,total=37.50\n');
  assert.equal(first.body.feedback.cases[0].phase, 'run');
  assert.equal(first.body.feedback.cases[0].passed, true);
  assert.equal(first.body.result.replayed, false);
  assert.equal(first.body.result.xpAwarded, 0);
  assert.equal(first.body.progress.xp.total, 10);
  assert.equal(first.body.progress.attempts.length, 2);
  assert.equal(first.body.progress.attempts[1].payload.passed, true);

  const replay = expect(await request(app, '/api/play/attempts', { method: 'POST', data: input }), 200);
  assert.equal(replay.body.result.replayed, true);
  assert.equal(replay.body.progress.revision, first.body.progress.revision);
  assert.equal(replay.body.progress.xp.total, first.body.progress.xp.total);
  assert.equal(replay.body.progress.attempts.length, 2);

  const repeated = expect(await request(app, '/api/play/attempts', {
    method: 'POST',
    data: levelAttempt({ requestId: 'attempt-run-observe-2' })
  }), 200);
  assert.equal(repeated.body.result.replayed, false);
  assert.equal(repeated.body.result.xpAwarded, 0);
  assert.equal(repeated.body.progress.xp.total, first.body.progress.xp.total);
  assert.equal(repeated.body.progress.attempts.length, 3);

  const explanation = expect(await request(app, '/api/play/attempts', {
    method: 'POST',
    data: levelAttempt({
      requestId: 'attempt-explain-1',
      stepId: 'explain',
      action: 'check',
      answer: 'scanf 先确认整数和 double 都读入成功，随后才计算总价；无效输入会在计算前 return。'
    })
  }), 200);
  assert.equal(explanation.body.feedback.passed, true);

  const wrongSource = '#include <stdio.h>\nint main(void) {\n  puts("wrong");\n  return 0;\n}\n';
  const wrong = expect(await request(app, '/api/play/attempts', {
    method: 'POST',
    data: levelAttempt({
      requestId: 'attempt-wrong-output-1',
      stepId: 'short-edit',
      action: 'check',
      answer: wrongSource
    })
  }), 200);
  assert.equal(wrong.body.feedback.kind, 'program');
  assert.equal(wrong.body.feedback.actualOutput, 'wrong\n');
  assert.equal(wrong.body.feedback.expectedOutput, 'average=1.67\n');
  assert.equal(wrong.body.feedback.cases[0].phase, 'run');
  assert.equal(wrong.body.feedback.cases[0].passed, false);
  assert.equal(wrong.body.result.levelCompleted, false);
  assert.equal(wrong.body.result.xpAwarded, 0);
  assert.equal(wrong.body.progress.xp.total, first.body.progress.xp.total);
  assert.equal(wrong.body.progress.attempts.at(-1).payload.passed, false);
});

test('原题答案耗尽后可反复补题，三章独立补星解锁 Boss 且重放不刷星', { skip: cRuntimeSkip }, async t => {
  const { app, root } = await fixture(t);
  const course = await checkedInCourse();
  let progress = freshProgress(course, 'learner-1');
  let sequence = 0;
  for (const levelId of ['quail-fountain-sequence', 'quail-piano-output', 'quail-opening-broadcast']) {
    const level = course.levels.find(level => level.id === levelId);
    for (const step of level.content.steps) {
      const variants = step.variants || [null];
      for (const [index, variant] of variants.entries()) {
        sequence++;
        progress = submitAttempt(course, progress, {
          requestId: `mastery-seed-${sequence}`, levelId, contentVersion: level.version, stepId: step.id,
          variantId: variant?.id || '', action: index ? 'reveal' : 'submit', answer: 'fixture',
          hintLevel: variant ? 3 : 0, viewedFullAnswer: Boolean(variant), passed: !index, independent: false
        }, { id: `mastery-seed-attempt-${sequence}`, submittedAt: new Date(Date.UTC(2026, 9, 14, 3, sequence)).toISOString() }).progress;
      }
    }
  }
  await writeFile(join(root, 'data/progress.json'), JSON.stringify(progress));
  const canonical = JSON.stringify(course);
  const inputId = 'quail-fountain-sequence';
  const revealed = expect(await request(app, '/api/play/attempts', { method: 'POST', data: levelAttempt({
    requestId: 'mastery-reveal-1', levelId: inputId, stepId: 'independent-variation', variantId: 'mastery-1',
    action: 'reveal', answer: '', hintLevel: 3, viewedFullAnswer: true
  }) }), 200);
  assert.equal(revealed.body.next.replacementVariant.id, 'mastery-2');
  assert.equal(Object.hasOwn(revealed.body.next.replacementVariant, 'fullSolution'), false);
  const revealReplay = expect(await request(app, '/api/play/attempts', { method: 'POST', data: levelAttempt({
    requestId: 'mastery-reveal-1', levelId: inputId, stepId: 'independent-variation', variantId: 'mastery-1',
    action: 'reveal', answer: '', hintLevel: 3, viewedFullAnswer: true
  }) }), 200);
  assert.equal(revealReplay.body.result.replayed, true);
  assert.equal(revealReplay.body.reveal.fullSolution, revealed.body.reveal.fullSolution);
  for (const [index, levelId] of ['quail-piano-output', 'quail-opening-broadcast', inputId].entries()) {
    const activity = expect(await request(app, `/api/play/levels/${levelId}`), 200);
    const step = activity.body.level.steps.find(step => step.type === 'independent-variation');
    const variant = step.variants.find(variant => variant.id.startsWith('mastery-'));
    assert.ok(variant);
    assert.equal(Object.hasOwn(variant, 'fullSolution'), false);
    const dynamic = withMasteryChallenges(course, activity.body.progress);
    assert.doesNotThrow(() => sanitizeCourse(dynamic));
    const authored = dynamic.levels.find(level => level.id === levelId).content.steps.find(step => step.id === 'independent-variation').variants.find(item => item.id === variant.id);
    const requestPayload = levelAttempt({ requestId: `mastery-clear-${index}`, levelId, stepId: step.id,
      variantId: variant.id, action: 'submit', answer: authored.fullSolution, hintLevel: 0, viewedFullAnswer: false });
    const clear = expect(await request(app, '/api/play/attempts', { method: 'POST', data: requestPayload }), 200);
    assert.equal(clear.body.feedback.passed, true, clear.text);
    assert.equal(clear.body.result.starAwarded, true);
    assert.equal(clear.body.result.xpAwarded, 0, '补星不重复发完成经验');
    assert.equal(clear.body.progress.rankStates[0].earnedStars, index + 1);
    const replay = expect(await request(app, '/api/play/attempts', { method: 'POST', data: requestPayload }), 200);
    assert.equal(replay.body.result.replayed, true);
    assert.equal(replay.body.progress.attempts.length, clear.body.progress.attempts.length);
    if (index === 2) {
      assert.equal(clear.body.next.activityId, 'quail-opening-boss', '最后一颗星来自回访的第一章，也应推进到 Boss');
      assert.equal(clear.body.result.bossUnlocked, true);
    } else assert.equal(clear.body.result.bossUnlocked, false);
  }
  assert.equal(JSON.stringify(course), canonical, '补题不修改正式课程版本或原变式');
  const home = expect(await request(app, '/api/play/home'), 200);
  assert.equal(home.body.progress.current.activityId, 'quail-opening-boss');
  assert.equal(home.body.progress.awardLedger.filter(item => item.kind === 'star').length, 3);
});

test('段位末章完成但星星不足时，刷新接口保留已完成状态，不伪造星星或 Boss 解锁', async t => {
  const { app, root } = await fixture(t);
  const course = await checkedInCourse();
  let progress = freshProgress(course, 'learner-1');
  let sequence = 0;
  for (const levelId of ['quail-fountain-sequence', 'quail-piano-output', 'quail-opening-broadcast']) {
    const level = course.levels.find(level => level.id === levelId);
    for (const step of level.content.steps) {
      sequence++;
      const variantId = step.variants?.[0]?.id || '';
      progress = submitAttempt(course, progress, {
        requestId: `end-rank-seed-${sequence}`, levelId, contentVersion: level.version, stepId: step.id,
        variantId, action: 'submit', answer: 'fixture', hintLevel: variantId ? 3 : 0,
        viewedFullAnswer: Boolean(variantId), passed: true, independent: false
      }, { id: `end-rank-attempt-${sequence}`, submittedAt: new Date(Date.UTC(2026, 9, 14, 2, sequence)).toISOString() }).progress;
    }
  }
  await writeFile(join(root, 'data/progress.json'), JSON.stringify(progress));
  const activity = expect(await request(app, '/api/play/levels/quail-opening-broadcast'), 200);
  assert.equal(activity.body.activityCompleted, true);
  assert.equal(activity.body.completedStepIds.includes('independent-variation'), true);
  assert.equal(activity.body.progress.rankStates[0].earnedStars, 0);
  assert.equal(activity.body.progress.rankStates[0].bossStatus, 'not-started');
  const restored = expect(await request(app, '/api/play/levels/quail-opening-broadcast'), 200);
  assert.equal(restored.body.activityCompleted, true);
  assert.equal(restored.body.progress.attempts.length, progress.attempts.length);
});

test('引导修改查看思路后仍按真实代码评分，错误循环失败而修复后进入独立变式', { skip: cRuntimeSkip }, async t => {
  const { app, root } = await fixture(t);
  const course = await checkedInCourse();
  let progress = freshProgress(course, 'learner-1');
  let sequence = 0;
  for (const [levelId, limit] of [['quail-fountain-sequence', 5], ['quail-piano-output', 3]]) {
    const level = course.levels.find(level => level.id === levelId);
    for (const step of level.content.steps.slice(0, limit)) {
      sequence++;
      progress = submitAttempt(course, progress, {
        requestId: `guided-seed-${sequence}`, levelId, contentVersion: level.version, stepId: step.id,
        variantId: step.variants?.[0]?.id || '', action: 'submit', answer: 'fixture prerequisite',
        hintLevel: 0, viewedFullAnswer: false, passed: true, independent: step.type === 'independent-variation'
      }, { id: `guided-seed-attempt-${sequence}`, submittedAt: new Date(Date.UTC(2026, 9, 14, 0, sequence)).toISOString() }).progress;
    }
  }
  await writeFile(join(root, 'data/progress.json'), JSON.stringify(progress));
  const level = course.levels.find(level => level.id === 'quail-piano-output');
  const step = level.content.steps.find(step => step.id === 'short-edit');
  const payload = levelAttempt({
    requestId: 'guided-source-after-solution', levelId: level.id, stepId: step.id, variantId: '',
    answer: step.starterFiles['main.c'], hintLevel: 3, viewedFullAnswer: true
  });
  const broken = expect(await request(app, '/api/play/attempts', { method: 'POST', data: payload }), 200);
  assert.equal(broken.body.feedback.passed, false);
  assert.equal(broken.body.progress.current.stepId, step.id);
  const fixedPayload = { ...payload, requestId: 'guided-fixed-after-solution', answer: payload.answer.replace('i <= count', 'i < count') };
  const fixed = expect(await request(app, '/api/play/attempts', { method: 'POST', data: fixedPayload }), 200);
  assert.equal(fixed.body.feedback.passed, true);
  assert.equal(fixed.body.progress.attempts.at(-1).payload.viewedFullAnswer, true);
  assert.equal(fixed.body.progress.attempts.at(-1).payload.variantId, '');
  assert.equal(fixed.body.next.stepId, 'independent-variation');
  assert.equal(fixed.body.result.starAwarded, false);
  const replay = expect(await request(app, '/api/play/attempts', { method: 'POST', data: fixedPayload }), 200);
  assert.equal(replay.body.result.replayed, true);
  assert.equal(replay.body.progress.attempts.length, fixed.body.progress.attempts.length);
  const restored = expect(await request(app, `/api/play/levels/${level.id}`), 200);
  assert.equal(restored.body.progress.current.stepId, 'independent-variation');
});

test('看过答案的代码通过后可以继续下一章，独立星星仍须未曝光变式', { skip: cRuntimeSkip }, async t => {
  const { app } = await fixture(t);
  const submit = overrides => request(app, '/api/play/attempts', { method: 'POST', data: levelAttempt(overrides) });
  const course = await checkedInCourse();
  const level = course.levels.find(item => item.id === 'quail-fountain-sequence');
  const predictionOrder = level.content.steps.find(step => step.id === 'predict').evaluator.expected;
  const sourceStep = level.content.steps.find(step => step.id === 'independent-variation');
  const [exposedVariant, replacementVariant] = sourceStep.variants;

  expect(await submit({ requestId: 'replacement-predict', stepId: 'predict', action: 'check', answer: JSON.stringify(predictionOrder) }), 200);
  expect(await submit({ requestId: 'replacement-run', stepId: 'run-observe', action: 'run' }), 200);
  expect(await submit({ requestId: 'replacement-explain', stepId: 'explain', action: 'check', answer: 'scanf 先检查两个字段是否读入成功，成功后才计算总价；失败输入会提前返回。' }), 200);
  expect(await submit({ requestId: 'replacement-edit', stepId: 'short-edit', action: 'run', answer: '#include <stdio.h>\nint main(void){int a,b,c;if(scanf("%d %d %d",&a,&b,&c)!=3)return 1;printf("average=%.2f\\n",(a+b+c)/3.0);return 0;}\n' }), 200);

  const exposedSource = exposedVariant.fullSolution;
  const exposed = expect(await submit({
    requestId: 'replacement-exposed', stepId: 'independent-variation', action: 'reveal',
    variantId: exposedVariant.id, answer: '', hintLevel: 3, viewedFullAnswer: true
  }), 200);
  assert.equal(exposed.body.feedback.kind, 'reveal');
  assert.equal(exposed.body.feedback.passed, false);
  assert.equal(exposed.body.result.levelCompleted, false);
  assert.equal(exposed.body.result.starAwarded, false);
  assert.equal(exposed.body.next.stepId, 'independent-variation');
  assert.equal(exposed.body.reveal.variantId, exposedVariant.id);
  assert.equal(exposed.body.reveal.fullSolution, exposedVariant.fullSolution);
  assert.equal(exposed.body.next.replacementVariant.id, replacementVariant.id);
  assert.equal(exposed.body.next.replacementVariant.fullSolutionAvailable, true);
  assert.equal(Object.hasOwn(exposed.body.next.replacementVariant, 'fullSolution'), false);

  const revealReplay = expect(await submit({
    requestId: 'replacement-exposed', stepId: 'independent-variation', action: 'reveal',
    variantId: exposedVariant.id, answer: '', hintLevel: 3, viewedFullAnswer: true
  }), 200);
  assert.equal(revealReplay.body.result.replayed, true);
  assert.equal(revealReplay.body.reveal.fullSolution, exposedVariant.fullSolution, '重试同一 reveal 仍应拿回当前变式答案');
  assert.equal(revealReplay.body.progress.attempts.length, exposed.body.progress.attempts.length);
  assert.equal(Object.hasOwn(revealReplay.body.next.replacementVariant, 'fullSolution'), false);

  const sameVariant = expect(await submit({
    requestId: 'replacement-same', stepId: 'independent-variation', action: 'submit',
    variantId: exposedVariant.id, answer: exposedSource
  }), 200);
  assert.equal(sameVariant.body.result.levelCompleted, true);
  assert.equal(sameVariant.body.result.starAwarded, false);
  assert.equal(sameVariant.body.next.activityId, 'quail-piano-output');
  assert.equal(sameVariant.body.next.stepId, 'predict');
  assert.equal(sameVariant.body.next.replacementVariant.id, replacementVariant.id);
  assert.equal(Object.hasOwn(sameVariant.body.next.replacementVariant, 'fullSolution'), false);

  const freshSource = replacementVariant.fullSolution;
  const recovered = expect(await submit({
    requestId: 'replacement-fresh', stepId: 'independent-variation', action: 'submit',
    variantId: replacementVariant.id, answer: freshSource
  }), 200);
  assert.equal(recovered.body.result.levelCompleted, false);
  assert.equal(recovered.body.result.starAwarded, true);
  assert.equal(recovered.body.result.xpAwarded, 0);
  assert.equal(recovered.body.next.activityId, 'quail-piano-output');
  assert.equal(recovered.body.progress.awardLedger.filter(item => item.kind === 'star').length, 1);
  const lastRevealRequest = {
    requestId: 'replacement-last-reveal', stepId: 'independent-variation', action: 'reveal',
    variantId: replacementVariant.id, answer: '', hintLevel: 3, viewedFullAnswer: true
  };
  const lastReveal = expect(await submit(lastRevealRequest), 200);
  assert.equal(lastReveal.body.reveal.fullSolution, replacementVariant.fullSolution);
  assert.equal(lastReveal.body.next.replacementVariant, null, '已获得独立星星后不再自动生成补星题');
  assert.equal(lastReveal.body.result.starAwarded, false);
  assert.equal(lastReveal.body.progress.awardLedger.filter(item => item.kind === 'star').length, 1, '已有星星不受查看答案影响');
  const lastReplay = expect(await submit(lastRevealRequest), 200);
  assert.equal(lastReplay.body.result.replayed, true);
  assert.equal(lastReplay.body.reveal.fullSolution, replacementVariant.fullSolution);
  assert.equal(lastReplay.body.progress.attempts.length, lastReveal.body.progress.attempts.length);
});

test('休息周保存后不产生目标或补课债务，旧 revision 的不同修改被拒绝', async t => {
  const { app, root } = await fixture(t);
  const home = expect(await request(app, '/api/play/home'), 200);
  const current = home.body.weekCard;
  const rest = {
    schemaVersion: 2,
    courseId: home.body.course.courseId,
    learnerId: home.body.learner.id,
    revision: current.revision,
    weekStart: current.weekStart,
    mode: 'rest',
    playDays: 0,
    mainGoal: null,
    shortLevelId: '',
    note: '本周休息，不产生欠账。'
  };

  const saved = expect(await request(app, '/api/play/week-card', { method: 'PUT', data: rest }), 200);
  assert.equal(saved.body.replayed, false);
  assert.equal(saved.body.weekCard.revision, current.revision + 1);
  assert.equal(saved.body.weekCard.mode, 'rest');
  assert.equal(saved.body.weekCard.playDays, 0);
  assert.equal(saved.body.weekCard.mainGoal, null);
  assert.equal(saved.body.weekCard.shortLevelId, '');

  const refreshed = expect(await request(app, '/api/play/home'), 200);
  assert.equal(refreshed.body.weekCard.mode, 'rest');
  assert.equal(refreshed.body.weekCard.mainGoal, null);
  assert.equal(refreshed.body.weekCard.revision, current.revision + 1);

  const stale = await request(app, '/api/play/week-card', {
    method: 'PUT',
    data: { ...rest, note: '来自旧页面的另一份修改' }
  });
  expectError(stale, 412, 'version_conflict');

  const persisted = JSON.parse(await readFile(join(root, 'data/week-card.json'), 'utf8'));
  assert.equal(persisted.suggestionPolicy.createOverdueDebt, false);
  assert.equal(persisted.suggestionPolicy.requireMakeup, false);
});

test('损坏的核心 JSON 会拒绝启动，且不会覆盖原文件', async t => {
  const f = await fixture(t, { start: false });
  const path = join(f.root, 'data/progress.json');
  const broken = '{ "schemaVersion": 2, "attempts": [\n';
  await writeFile(path, broken, 'utf8');

  await assert.rejects(f.start(), error => {
    assert.equal(error.code, 'corrupt_data');
    assert.match(error.message, /data\/progress\.json/);
    return true;
  });
  assert.equal(await readFile(path, 'utf8'), broken);
});

test('同一课程 ETag 的并发保存只允许一个成功，并且发布版本只增加一次', async t => {
  const { app } = await fixture(t);
  const before = expect(await request(app, '/api/admin/course'), 200);
  const revision = before.body.publishedRevision;

  const responses = await Promise.all([
    request(app, '/api/admin/course', { method: 'PUT', data: before.body, etag: before.etag }),
    request(app, '/api/admin/course', { method: 'PUT', data: before.body, etag: before.etag })
  ]);
  assert.deepEqual(responses.map(response => response.status).sort((a, b) => a - b), [200, 412]);
  const winner = responses.find(response => response.status === 200);
  const loser = responses.find(response => response.status === 412);
  assert.equal(winner.body.course.publishedRevision, revision + 1);
  expectError(loser, 412, 'version_conflict');

  const after = expect(await request(app, '/api/admin/course'), 200);
  assert.equal(after.body.publishedRevision, revision + 1);
  assert.notEqual(after.etag, before.etag);
});





test('课程多文件发布在提交前失败时保持整套旧版本可读', async t => {
  const failure = new Error('injected course publish failure');
  const { app, root } = await fixture(t, {
    storeOptions: {
      beforeRename({ relative }) {
        if (relative === 'data/course.json') throw failure;
      }
    }
  });
  const coursePath = join(root, 'data/course.json');
  const detailPath = join(root, 'data/levels/quail-fountain-sequence.json');
  const originalCourse = await readFile(coursePath, 'utf8');
  const originalDetail = await readFile(detailPath, 'utf8');
  const before = expect(await request(app, '/api/admin/course'), 200);
  const changed = structuredClone(before.body);
  changed.levels.find(level => level.id === 'quail-fountain-sequence').content.scene.intro += ' 临时修改';

  const failed = await request(app, '/api/admin/course', {
    method: 'PUT', data: changed, etag: before.etag
  });
  expectError(failed, 500, 'storage_error');
  assert.equal(await readFile(coursePath, 'utf8'), originalCourse);
  assert.equal(await readFile(detailPath, 'utf8'), originalDetail);
  const after = expect(await request(app, '/api/admin/state'), 200);
  assert.equal(after.body.course.publishedRevision, before.body.publishedRevision);
  assert.equal(after.body.course.levels.find(level => level.id === 'quail-fountain-sequence').content.scene.intro, before.body.levels.find(level => level.id === 'quail-fountain-sequence').content.scene.intro);
  assert.deepEqual((await readdir(root)).filter(name => /^\.data-(?:stage|backup)-/.test(name)), []);
});

test('课程目录切换后的发布故障会在线回滚到完整旧版本', async t => {
  const { app, root } = await fixture(t, {
    storeOptions: {
      afterBackupRename() { throw new Error('injected failure after backup rename'); }
    }
  });
  const before = expect(await request(app, '/api/admin/course'), 200);
  const changed = structuredClone(before.body);
  changed.subtitle += ' 临时修改';

  expectError(await request(app, '/api/admin/course', {
    method: 'PUT', data: changed, etag: before.etag
  }), 500, 'storage_error');
  const after = expect(await request(app, '/api/admin/state'), 200);
  assert.equal(after.body.course.subtitle, before.body.subtitle);
  assert.equal(after.body.course.publishedRevision, before.body.publishedRevision);
  assert.deepEqual((await readdir(root)).filter(name => /^\.data-(?:stage|backup)-/.test(name)), []);
});

test('启动时会从唯一的完整备份恢复被中断的数据目录交换', async t => {
  const f = await fixture(t, { start: false });
  const backup = join(f.root, '.data-backup-interrupted');
  const stage = join(f.root, '.data-stage-interrupted');
  await cp(join(f.root, 'data'), stage, { recursive: true });
  await writeFile(join(stage, 'course.json'), '{ broken stage', 'utf8');
  await rename(join(f.root, 'data'), backup);

  const app = await f.start();
  const state = expect(await request(app, '/api/admin/state'), 200);
  assert.equal(state.body.course.courseId, 'eggy-programming-park');
  assert.deepEqual((await readdir(f.root)).filter(name => /^\.data-(?:stage|backup)-/.test(name)), []);
});

test('当前 data 损坏时先校验再回退到唯一有效备份', async t => {
  const f = await fixture(t, { start: false });
  await cp(join(f.root, 'data'), join(f.root, '.data-backup-valid'), { recursive: true });
  await writeFile(join(f.root, 'data/course.json'), '{ broken current data', 'utf8');

  const app = await f.start();
  const state = expect(await request(app, '/api/admin/state'), 200);
  assert.equal(state.body.course.courseId, 'eggy-programming-park');
  assert.doesNotMatch(await readFile(join(f.root, 'data/course.json'), 'utf8'), /broken current data/);
  assert.deepEqual((await readdir(f.root)).filter(name => /^\.data-(?:stage|backup)-/.test(name)), []);
  const rejected = (await readdir(f.root)).filter(name => name.startsWith('.data-rejected-current-'));
  assert.equal(rejected.length, 1, '损坏的当前数据应保留为取证副本');
  assert.match(await readFile(join(f.root, rejected[0], 'course.json'), 'utf8'), /broken current data/);
});

test('data 中的符号链接会在启动阶段被拒绝且不会改写外部目标', async t => {
  const f = await fixture(t, { start: false });
  const coursePath = join(f.root, 'data/course.json');
  const externalPath = join(f.root, 'external-course.json');
  const original = await readFile(coursePath, 'utf8');
  await writeFile(externalPath, original, 'utf8');
  await rm(coursePath);
  await symlink('../external-course.json', coursePath);

  await assert.rejects(f.start(), error => {
    assert.equal(error.code, 'storage_error');
    assert.match(error.message, /符号链接|不安全的文件类型/);
    return true;
  });
  assert.equal(await readFile(externalPath, 'utf8'), original);
});
