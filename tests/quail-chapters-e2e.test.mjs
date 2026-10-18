// 前三章（鹌鹑蛋三段互动关卡）端到端验证。
// 以学习者视角走完整流程：打开章节 → 逐步提交课程答案 →
// 断言每一步「题目与答案相符」（错答不通过、课程答案通过）→
// 三章各自独立通过后拿满三颗星，解锁 C 综合 Boss。
// 全部判定经过真实 HTTP 接口与真实 C17 编译运行，使用隔离临时数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from '../server.mjs';
import { freshProgress, sanitizeCourse } from '../shared/park-domain.mjs';

const PROJECT = fileURLToPath(new URL('..', import.meta.url));
const CHAPTER_IDS = ['quail-fountain-sequence', 'quail-piano-output', 'quail-opening-broadcast'];
const RANK_BOSS_ID = 'quail-opening-boss';
const ERROR_EXPLAINER_ACHIEVEMENT = 'achievement-error-explainer';

// 三段引导修改的修复版源码：分别按课程 fullSolution 的描述
// （除以 3.0、i < count、越界返回 0/100）写出，用于验证题目可解且答案相符。
const FIXED_SHORT_EDIT = {
  'quail-fountain-sequence': `#include <stdio.h>
int main(void) {
  int a, b, c;
  if (scanf("%d %d %d", &a, &b, &c) != 3) return 1;
  double average = (a + b + c) / 3.0;
  printf("average=%.2f\\n", average);
  return 0;
}
`,
  'quail-piano-output': `#include <stdio.h>
int main(void) {
  int count;
  if (scanf("%d", &count) != 1 || count < 0 || count > 8) return 1;
  int sum = 0;
  for (int i = 0; i < count; i++) {
    int value;
    if (scanf("%d", &value) != 1) return 1;
    sum += value;
  }
  printf("sum=%d\\n", sum);
  return 0;
}
`,
  'quail-opening-broadcast': `#include <stdio.h>
int normalize(int value) {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
int main(void) {
  int value;
  if (scanf("%d", &value) != 1) return 1;
  printf("normalized=%d\\n", normalize(value));
  return 0;
}
`
};

// 三段独立变式的错误程序：能编译运行但在第一组用例上给出错误结果，
// 用于证明星星只授予真正独立通过的提交。
const WRONG_INDEPENDENT = {
  'quail-fountain-sequence': `#include <stdio.h>
int main(void) {
  int hours, minutes, seconds;
  if (scanf("%d %d %d", &hours, &minutes, &seconds) != 3) return 1;
  if (hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return 1;
  int total = hours * 60 + minutes * 60 + seconds;
  printf("total_seconds=%d,clock=%02d:%02d:%02d\\n", total, hours, minutes, seconds);
  return 0;
}
`,
  'quail-piano-output': `#include <stdio.h>
int main(void) {
  int n;
  if (scanf("%d", &n) != 1 || n < 0 || n > 8) return 1;
  int pass = 0, sum = 0;
  for (int i = 0; i < n; i++) {
    int score;
    if (scanf("%d", &score) != 1) return 1;
    sum += score;
    if (score > 60) pass++;
  }
  printf("pass=%d,sum=%d\\n", pass, sum);
  return 0;
}
`,
  'quail-opening-broadcast': `#include <stdio.h>
int clamp(int value, int low, int high) {
  if (value < low) return low;
  return high;
}
int main(void) {
  int value, low, high;
  if (scanf("%d %d %d", &value, &low, &high) != 3 || low > high) return 1;
  printf("result=%d\\n", clamp(value, low, high));
  return 0;
}
`
};

async function checkedInCourse() {
  const index = JSON.parse(await readFile(join(PROJECT, 'data/course.json'), 'utf8'));
  const names = await readdir(join(PROJECT, 'data/levels'));
  const details = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(PROJECT, 'data/levels', name), 'utf8'))));
  return sanitizeCourse(index, details);
}

async function executable(path) {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}

const missingCRuntime = [];
if (process.platform !== 'darwin') missingCRuntime.push('macOS');
if (!(await executable('/usr/bin/clang'))) missingCRuntime.push('/usr/bin/clang');
if (!(await executable('/usr/bin/sandbox-exec'))) missingCRuntime.push('/usr/bin/sandbox-exec');
const cRuntimeSkip = missingCRuntime.length
  ? `需要真实的 macOS clang 与 sandbox-exec；缺少：${missingCRuntime.join(', ')}`
  : false;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eggy-chapters-e2e-'));
  const running = [];
  t.after(async () => {
    for (const app of running.reverse()) await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await cp(join(PROJECT, 'data'), join(root, 'data'), { recursive: true });
  const course = await checkedInCourse();
  await writeFile(join(root, 'data/progress.json'), `${JSON.stringify(freshProgress(course, 'learner-1'), null, 2)}\n`, 'utf8');
  const app = await startServer({ root, assetRoot: PROJECT, host: '127.0.0.1', port: 0, lock: true });
  running.push(app);
  return { app, root };
}

function request(app, path, {
  method = 'GET',
  data,
  origin = method === 'GET' || method === 'HEAD' ? undefined : app.url
} = {}) {
  const target = new URL(app.url);
  const payload = data === undefined ? undefined : JSON.stringify(data);
  const headers = {};
  if (origin !== undefined) headers.Origin = origin;
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
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
        const text = Buffer.concat(chunks).toString('utf8');
        let body = text;
        if (/^application\/json\b/i.test(res.headers['content-type'] || '')) {
          try { body = JSON.parse(text); } catch { /* 断言会暴露非法 JSON */ }
        }
        resolve({ status: res.statusCode, text, body });
      });
    });
    req.setTimeout(20_000, () => req.destroy(new Error('HTTP test timeout')));
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function expect(response, status) {
  assert.equal(response.status, status, response.text);
  return response;
}

let submissionCounter = 0;
function attempt(levelId, contentVersion, stepId, { variantId = '', action, answer, hintLevel = 0, viewedFullAnswer = false }) {
  submissionCounter += 1;
  return {
    requestId: `e2e-${levelId}-${stepId}-${submissionCounter}`,
    levelId,
    contentVersion,
    stepId,
    variantId,
    action,
    answer,
    hintLevel,
    viewedFullAnswer
  };
}

function submit(app, payload) {
  return request(app, '/api/play/attempts', { method: 'POST', data: payload });
}

// 预测题的课程答案：顺序题取排列本身，映射题取对应关系本身。
function authoredPredictionAnswer(rule) {
  return JSON.stringify(rule.expected);
}

// 预测题的错答：顺序题反转，映射题循环错位（预期值互不相同才能构造）。
function wrongPredictionAnswer(rule) {
  if (rule.kind === 'exact-order') return JSON.stringify([...rule.expected].reverse());
  const keys = Object.keys(rule.expected);
  const values = Object.values(rule.expected);
  assert.ok(new Set(values).size > 1, '映射题预期值缺少可区分性，无法构造错答');
  return JSON.stringify(Object.fromEntries(keys.map((key, index) => [key, values[(index + 1) % values.length]])));
}

// 解释题的课程答案：覆盖全部参考要点，并超过最低字数要求。
function authoredExplanationAnswer(step) {
  return `${step.referencePoints.join('；')}。因此实际运行结果与题目描述一致，边界与非法输入也按同一条失败路径处理。`;
}

const normalizedOutput = value => String(value ?? '').replace(/\r\n?/g, '\n');

test('前三章 e2e：题目与答案逐项相符，三章独立通过拿满三颗星并解锁 Boss', { skip: cRuntimeSkip }, async t => {
  const { app } = await fixture(t);
  const course = await checkedInCourse();

  for (const [chapterIndex, levelId] of CHAPTER_IDS.entries()) {
    const level = course.levels.find(item => item.id === levelId);
    const isLastChapter = chapterIndex === CHAPTER_IDS.length - 1;

    // 1) 学习者读取章节：与浏览器相同的接口，题目逐字一致，答案不下发。
    const activity = expect(await request(app, `/api/play/levels/${levelId}`), 200).body;
    assert.equal(activity.level.id, levelId);
    assert.equal(activity.level.version, level.version);
    assert.deepEqual(activity.level.steps.map(step => step.id), level.content.steps.map(step => step.id), '学习者的步骤序列应与课程一致');

    for (const step of level.content.steps) {
      const served = activity.level.steps.find(item => item.id === step.id);
      const payloadFor = options => attempt(levelId, level.version, step.id, options);

      if (step.type === 'prediction') {
        // 题目一致：交互材料与评分规则逐字相同。
        assert.deepEqual(served.interaction, step.interaction, `${levelId}/${step.id} 下发的交互材料应与课程一致`);
        assert.deepEqual(served.evaluator, step.evaluator, `${levelId}/${step.id} 下发的评分规则应与课程一致`);

        // 错答不通过。
        const wrong = expect(await submit(app, payloadFor({ action: 'check', answer: wrongPredictionAnswer(step.evaluator) })), 200).body;
        assert.equal(wrong.feedback.passed, false, `${levelId}/${step.id} 错答不应通过`);
        assert.equal(wrong.result.starAwarded, false);

        // 课程答案通过，且反馈中的目标与课程答案一致。
        const right = expect(await submit(app, payloadFor({ action: 'check', answer: authoredPredictionAnswer(step.evaluator) })), 200).body;
        assert.equal(right.feedback.passed, true, right.text);
        assert.equal(right.feedback.kind, 'answer');
        const expectedOutput = step.evaluator.kind === 'exact-order'
          ? step.evaluator.expected.join(' → ')
          : JSON.stringify(step.evaluator.expected, null, 2);
        assert.equal(right.feedback.expectedOutput, expectedOutput);
        if (chapterIndex === 0 && step.id === 'predict') assert.equal(right.result.xpAwarded, 0, '同一步骤的第二次提交不重复发首次尝试经验');
      } else if (step.type === 'run-observe') {
        // 题目一致：下发的起始程序与课程一致。
        assert.deepEqual(served.starterFiles, step.starterFiles, `${levelId}/${step.id} 下发的起始程序应与课程一致`);

        // 课程程序真实运行，输出与课程预期逐字相同。
        const run = expect(await submit(app, payloadFor({ action: 'run', answer: '' })), 200).body;
        assert.equal(run.feedback.passed, true, run.text);
        assert.equal(run.feedback.kind, 'program');
        const expectedStdout = normalizedOutput(step.evaluator.expected);
        assert.equal(run.feedback.cases.length, 1);
        assert.equal(run.feedback.cases[0].stdin, step.stdin);
        assert.equal(run.feedback.cases[0].expected, expectedStdout, '反馈中的目标输出应与课程预期一致');
        assert.equal(run.feedback.cases[0].actual, expectedStdout, '起始程序的实际输出应与课程预期一致');
        assert.equal(run.feedback.cases[0].passed, true);
        assert.equal(run.feedback.actualOutput, expectedStdout);
      } else if (step.type === 'explanation') {
        // 题目一致：参考要点与字数要求逐字相同。
        assert.deepEqual(served.referencePoints, step.referencePoints, `${levelId}/${step.id} 下发的参考要点应与课程一致`);
        assert.equal(served.answerPolicy.minimumCharacters, step.answerPolicy.minimumCharacters);

        // 过短解释不通过。
        const tooShort = expect(await submit(app, payloadFor({ action: 'check', answer: '太短' })), 200).body;
        assert.equal(tooShort.feedback.passed, false, `${levelId}/${step.id} 过短解释不应通过`);
        assert.equal(tooShort.feedback.kind, 'explanation');

        // 覆盖参考要点的解释通过。
        const answer = authoredExplanationAnswer(step);
        assert.ok([...answer].length >= step.answerPolicy.minimumCharacters, '课程答案应满足最低字数');
        const explained = expect(await submit(app, payloadFor({ action: 'check', answer })), 200).body;
        assert.equal(explained.feedback.passed, true, explained.text);
        assert.equal(explained.feedback.kind, 'explanation');
        if (chapterIndex === 0) {
          assert.deepEqual(explained.achievements.map(item => item.id), [ERROR_EXPLAINER_ACHIEVEMENT], '第一章的合格解释应解锁「讲清原因」成就');
        } else {
          assert.deepEqual(explained.achievements, [], '同一成就只解锁一次');
        }
      } else if (step.type === 'code-edit') {
        // 题目一致：起始程序与评分用例逐字相同。
        assert.deepEqual(served.starterFiles, step.starterFiles, `${levelId}/${step.id} 下发的起始程序应与课程一致`);
        assert.deepEqual(served.grader, step.grader, `${levelId}/${step.id} 下发的评分用例应与课程一致`);

        // 未修复的起始程序在自己的用例上失败，说明这是一道修复题。
        const broken = expect(await submit(app, payloadFor({ action: 'run', answer: step.starterFiles['main.c'] })), 200).body;
        assert.equal(broken.feedback.passed, false, `${levelId}/${step.id} 未修复的起始程序不应通过`);
        assert.equal(broken.feedback.kind, 'program');
        assert.notEqual(broken.feedback.cases[0].actual, broken.feedback.cases[0].expected, '失败用例应给出与目标不同的实际输出');

        // 修复版通过全部课程用例。
        const fixed = expect(await submit(app, payloadFor({ action: 'run', answer: FIXED_SHORT_EDIT[levelId] })), 200).body;
        assert.equal(fixed.feedback.passed, true, fixed.text);
        assert.equal(fixed.feedback.cases.length, step.grader.cases.length);
        fixed.feedback.cases.forEach((testCase, index) => {
          assert.equal(testCase.stdin, step.grader.cases[index].stdin);
          assert.equal(testCase.expected, normalizedOutput(step.grader.cases[index].stdout), '反馈中的目标输出应与课程用例一致');
          assert.equal(testCase.actual, normalizedOutput(step.grader.cases[index].stdout), '修复程序的实际输出应与课程用例一致');
          assert.equal(testCase.exitCode, step.grader.cases[index].exitCode ?? 0);
          assert.equal(testCase.passed, true);
        });
      } else if (step.type === 'independent-variation') {
        const variant = step.variants[0];

        // 题目一致：下发的变式与课程一致，且不泄露完整解法。
        const servedVariant = served.variants.find(item => item.id === variant.id);
        assert.ok(servedVariant, `${levelId}/${step.id} 应下发变式 ${variant.id}`);
        assert.deepEqual(servedVariant.prompt, variant.prompt, '下发的变式题干应与课程一致');
        assert.deepEqual(servedVariant.grader, variant.grader, '下发的变式评分规则应与课程一致');
        assert.equal(Object.hasOwn(servedVariant, 'fullSolution'), false, '学习接口不应下发完整解法');
        assert.equal(servedVariant.fullSolutionAvailable, true);

        // 错误程序不通过，也不授星。
        const wrong = expect(await submit(app, payloadFor({ action: 'submit', answer: WRONG_INDEPENDENT[levelId], variantId: variant.id })), 200).body;
        assert.equal(wrong.feedback.passed, false, `${levelId}/${step.id} 错误程序不应通过`);
        assert.equal(wrong.result.starAwarded, false, '错误程序不应获得星星');

        // 课程完整解法独立通过：拿到本章星星并完成本章。
        const cleared = expect(await submit(app, payloadFor({ action: 'submit', answer: variant.fullSolution, variantId: variant.id })), 200).body;
        assert.equal(cleared.feedback.passed, true, cleared.text);
        assert.equal(cleared.feedback.kind, 'program');
        assert.ok(cleared.feedback.cases.every(testCase => testCase.passed), '课程解法应通过变式全部用例');
        assert.equal(cleared.result.starAwarded, true, '首次独立通过应变式应授予星星');
        assert.equal(cleared.result.levelCompleted, true, '独立变式通过应完成本章');
        assert.equal(cleared.result.xpAwarded, 25, '本章首次完成应发完成经验');
        assert.equal(cleared.progress.rankStates[0].earnedStars, chapterIndex + 1, `第 ${chapterIndex + 1} 章完成后鹌鹑蛋应有 ${chapterIndex + 1} 颗星`);
        assert.equal(cleared.progress.current.activityId, isLastChapter ? RANK_BOSS_ID : CHAPTER_IDS[chapterIndex + 1], '完成后当前应推进到下一章或 Boss');
        assert.equal(cleared.next.activityId, isLastChapter ? RANK_BOSS_ID : CHAPTER_IDS[chapterIndex + 1]);
        if (isLastChapter) assert.equal(cleared.result.bossUnlocked, true, '三颗星应解锁 C 综合 Boss');
        else assert.equal(cleared.result.bossUnlocked, false, '星数不足时不应解锁 Boss');
      } else {
        assert.fail(`未覆盖的步骤类型 ${step.type}`);
      }
    }

    // 2) 章末复核：完成状态与已通过步骤在重新读取后保持一致。
    const reviewed = expect(await request(app, `/api/play/levels/${levelId}`), 200).body;
    assert.equal(reviewed.activityCompleted, true, `${levelId} 完成后应标记为已完成`);
    assert.deepEqual([...reviewed.completedStepIds].sort(), level.content.steps.map(step => step.id).sort(), `${levelId} 的全部步骤都应记录为已通过`);
  }

  // 3) 三章拿满三颗星：大厅与奖励账本一致，当前停留在已解锁的 Boss。
  const home = expect(await request(app, '/api/play/home'), 200).body;
  assert.equal(home.progress.current.activityId, RANK_BOSS_ID);
  assert.equal(home.progress.current.rankId, 'quail');
  assert.equal(home.summary.currentActivityId, RANK_BOSS_ID);
  const quailSummary = home.summary.ranks.find(rank => rank.id === 'quail');
  assert.equal(quailSummary.stars, 3, '鹌鹑蛋应拿满三颗星');
  assert.equal(quailSummary.bossUnlocked, true, '三颗星后 Boss 应显示为已解锁');
  const stars = home.progress.awardLedger.filter(item => item.kind === 'star');
  assert.equal(stars.length, 3, '奖励账本应恰好记录三颗星星');
  assert.deepEqual(stars.map(item => item.activityId).sort(), [...CHAPTER_IDS].sort(), '每章各贡献一颗星星');
  assert.ok(stars.every(item => item.amount === 1 && item.rankId === 'quail'), '每颗星都来自鹌鹑蛋章节');
  assert.equal(home.progress.xp.total, 105, '三章的首次尝试与首次完成经验合计 105');
  assert.equal(home.progress.xp.level, 2);
});
