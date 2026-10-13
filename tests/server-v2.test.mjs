import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { access, cp, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gradeLevel, startServer } from '../server.mjs';
import { sanitizeCourse } from '../shared/park-domain.mjs';

const PROJECT = fileURLToPath(new URL('..', import.meta.url));

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
    contentVersion: 1,
    stepId: 'run-observe',
    action: 'run',
    answer: '',
    hintLevel: 0,
    viewedFullAnswer: false,
    ...overrides
  };
}

test('大厅、关卡和岛务状态来自同一份 v2 数据；岛屿图片以正确 MIME 静态提供', async t => {
  const { app } = await fixture(t);

  const home = expect(await request(app, '/api/play/home'), 200);
  assert.equal(home.body.course.schemaVersion, 2);
  assert.equal(home.body.course.ranks.length, 9);
  assert.equal(home.body.progress.revision, 0);
  assert.equal(home.body.summary.currentActivityId, 'quail-fountain-sequence');
  assert.equal(home.body.currentLevel.id, 'quail-fountain-sequence');
  assert.ok(home.etag);
  assert.ok(home.body.course.levels.every(level => !Object.hasOwn(level, 'content')), '大厅不应一次下发所有关卡正文');
  const homeIndependent = home.body.currentLevel.steps.find(step => step.id === 'independent-variation');
  assert.ok(homeIndependent.variants.every(variant => !Object.hasOwn(variant, 'fullSolution')), '大厅当前关卡不应下发独立变式答案');

  const level = expect(await request(app, '/api/play/levels/quail-fountain-sequence'), 200);
  assert.equal(level.body.level.id, 'quail-fountain-sequence');
  assert.equal(level.body.level.activityType, 'interactive-lesson');
  assert.equal(level.body.level.steps[0].id, 'predict');
  assert.equal(level.body.location.id, 'central-fountain');
  const independent = level.body.level.steps.find(step => step.id === 'independent-variation');
  assert.ok(independent.variants.every(variant => variant.fullSolutionAvailable === true));
  assert.ok(independent.variants.every(variant => !Object.hasOwn(variant, 'fullSolution')));

  const admin = expect(await request(app, '/api/admin/state'), 200);
  assert.equal(admin.body.course.courseId, home.body.course.courseId);
  assert.equal(admin.body.progress.learner.id, home.body.learner.id);
  assert.equal(admin.body.course.levels.find(item => item.id === level.body.level.id).content.id, level.body.level.id);
  assert.equal(typeof admin.body.course.levels.find(item => item.id === level.body.level.id).content.steps.find(step => step.id === 'independent-variation').variants[0].fullSolution, 'string');
  assert.equal(typeof admin.body.versions.course, 'string');

  const image = expect(await request(app, '/assets/park/island-hero.png'), 200);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.match(image.headers['cache-control'], /max-age=3600/);
  assert.deepEqual([...image.buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const head = expect(await request(app, '/assets/park/island-hero.png', { method: 'HEAD' }), 200);
  assert.equal(head.buffer.length, 0);
  assert.equal(Number(head.headers['content-length']), image.buffer.length);
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

test('Boss 的对象值与映射关系按完整结构判定，不会误落入文本长度规则', async () => {
  const course = await checkedInCourse();
  const objectBase = {
    requestId: 'boss-object-1', levelId: 'pigeon-data-boss', contentVersion: 1,
    stepId: 'predict-values', action: 'check', hintLevel: 0, viewedFullAnswer: false
  };
  const objectCorrect = await gradeLevel(course, { ...objectBase, answer: JSON.stringify({ total: 8, left: 7 }) });
  assert.equal(objectCorrect.input.passed, true);
  const objectExtra = await gradeLevel(course, { ...objectBase, requestId: 'boss-object-2', answer: JSON.stringify({ total: 8, left: 7, guessed: true }) });
  assert.equal(objectExtra.input.passed, false);

  const mappingBase = {
    requestId: 'boss-mapping-1', levelId: 'chicken-rules-boss', contentVersion: 1,
    stepId: 'predict-paths', action: 'check', hintLevel: 0, viewedFullAnswer: false
  };
  const mappingCorrect = await gradeLevel(course, { ...mappingBase, answer: JSON.stringify({ 0: '放置', 1: '传送', 2: '错误' }) });
  assert.equal(mappingCorrect.input.passed, true);
  const mappingWrong = await gradeLevel(course, { ...mappingBase, requestId: 'boss-mapping-2', answer: JSON.stringify({ 0: '传送', 1: '放置', 2: '错误' }) });
  assert.equal(mappingWrong.input.passed, false);
});

test('仓库内 18 份独立变式完整解法都能通过各自真实 C 评分用例', { skip: cRuntimeSkip }, async () => {
  const course = await checkedInCourse();
  let checked = 0;
  for (const level of course.levels.filter(item => item.kind === 'interactive-lesson')) {
    for (const step of level.content.steps.filter(item => item.type === 'independent-variation')) {
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
        checked++;
      }
    }
  }
  assert.equal(checked, 18);
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
      answer: JSON.stringify(['蓝色喷泉', '黄色喷泉', '粉色喷泉'])
    })
  }), 200);
  assert.equal(prediction.body.feedback.passed, true);
  assert.equal(prediction.body.result.xpAwarded, 10);

  const first = expect(await request(app, '/api/play/attempts', { method: 'POST', data: input }), 200);
  assert.equal(first.body.feedback.kind, 'program');
  assert.equal(first.body.feedback.actualOutput, '蓝\n黄\n粉\n', JSON.stringify(first.body.feedback));
  assert.equal(first.body.feedback.cases[0].expected, '蓝\n黄\n粉\n');
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
      answer: '程序会按从上到下的顺序逐条执行输出语句。'
    })
  }), 200);
  assert.equal(explanation.body.feedback.passed, true);

  const wrongSource = '#include <stdio.h>\nint main(void) {\n  puts("蓝");\n  return 0;\n}\n';
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
  assert.equal(wrong.body.feedback.actualOutput, '蓝\n');
  assert.equal(wrong.body.feedback.expectedOutput, '粉\n蓝\n黄\n');
  assert.equal(wrong.body.feedback.cases[0].phase, 'run');
  assert.equal(wrong.body.feedback.cases[0].passed, false);
  assert.equal(wrong.body.result.levelCompleted, false);
  assert.equal(wrong.body.result.xpAwarded, 0);
  assert.equal(wrong.body.progress.xp.total, first.body.progress.xp.total);
  assert.equal(wrong.body.progress.attempts.at(-1).payload.passed, false);
});

test('查看独立变式完整答案后由服务端分配未曝光变式，同一变式不能完成关卡', { skip: cRuntimeSkip }, async t => {
  const { app } = await fixture(t);
  const submit = overrides => request(app, '/api/play/attempts', { method: 'POST', data: levelAttempt(overrides) });
  const course = await checkedInCourse();
  const sourceStep = course.levels.find(item => item.id === 'quail-fountain-sequence').content.steps.find(step => step.id === 'independent-variation');
  const exposedVariant = sourceStep.variants.find(variant => variant.id === 'greenless-yellow-pink-blue');

  expect(await submit({ requestId: 'replacement-predict', stepId: 'predict', action: 'check', answer: JSON.stringify(['蓝色喷泉', '黄色喷泉', '粉色喷泉']) }), 200);
  expect(await submit({ requestId: 'replacement-run', stepId: 'run-observe', action: 'run' }), 200);
  expect(await submit({ requestId: 'replacement-explain', stepId: 'explain', action: 'check', answer: '每条输出语句依次执行，所以喷泉不会在同一时刻一起启动。' }), 200);
  expect(await submit({ requestId: 'replacement-edit', stepId: 'short-edit', action: 'run', answer: '#include <stdio.h>\nint main(void){puts("粉");puts("蓝");puts("黄");return 0;}\n' }), 200);

  const exposedSource = '#include <stdio.h>\nint main(void){puts("黄");puts("粉");puts("蓝");return 0;}\n';
  const exposed = expect(await submit({
    requestId: 'replacement-exposed', stepId: 'independent-variation', action: 'reveal',
    variantId: 'greenless-yellow-pink-blue', answer: '', hintLevel: 3, viewedFullAnswer: true
  }), 200);
  assert.equal(exposed.body.feedback.kind, 'reveal');
  assert.equal(exposed.body.feedback.passed, false);
  assert.equal(exposed.body.result.levelCompleted, false);
  assert.equal(exposed.body.result.starAwarded, false);
  assert.equal(exposed.body.next.stepId, 'independent-variation');
  assert.equal(exposed.body.reveal.variantId, 'greenless-yellow-pink-blue');
  assert.equal(exposed.body.reveal.fullSolution, exposedVariant.fullSolution);
  assert.equal(exposed.body.next.replacementVariant.id, 'blue-pink-yellow');
  assert.equal(exposed.body.next.replacementVariant.fullSolutionAvailable, true);
  assert.equal(Object.hasOwn(exposed.body.next.replacementVariant, 'fullSolution'), false);

  const revealReplay = expect(await submit({
    requestId: 'replacement-exposed', stepId: 'independent-variation', action: 'reveal',
    variantId: 'greenless-yellow-pink-blue', answer: '', hintLevel: 3, viewedFullAnswer: true
  }), 200);
  assert.equal(revealReplay.body.result.replayed, true);
  assert.equal(revealReplay.body.reveal.fullSolution, exposedVariant.fullSolution, '重试同一 reveal 仍应拿回当前变式答案');
  assert.equal(revealReplay.body.progress.attempts.length, exposed.body.progress.attempts.length);
  assert.equal(Object.hasOwn(revealReplay.body.next.replacementVariant, 'fullSolution'), false);

  const sameVariant = expect(await submit({
    requestId: 'replacement-same', stepId: 'independent-variation', action: 'submit',
    variantId: 'greenless-yellow-pink-blue', answer: exposedSource
  }), 200);
  assert.equal(sameVariant.body.result.levelCompleted, false);
  assert.equal(sameVariant.body.result.starAwarded, false);
  assert.equal(sameVariant.body.next.replacementVariant.id, 'blue-pink-yellow');
  assert.equal(Object.hasOwn(sameVariant.body.next.replacementVariant, 'fullSolution'), false);

  const freshSource = '#include <stdio.h>\nint main(void){puts("蓝");puts("粉");puts("黄");return 0;}\n';
  const recovered = expect(await submit({
    requestId: 'replacement-fresh', stepId: 'independent-variation', action: 'submit',
    variantId: 'blue-pink-yellow', answer: freshSource
  }), 200);
  assert.equal(recovered.body.result.levelCompleted, true);
  assert.equal(recovered.body.result.starAwarded, true);
  assert.equal(recovered.body.progress.awardLedger.filter(item => item.kind === 'star').length, 1);
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
