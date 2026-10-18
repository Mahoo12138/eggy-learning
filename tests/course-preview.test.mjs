import test from 'node:test';
import assert from 'node:assert/strict';
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';
import { freshProgress, freshWeekCard, sanitizeCourse } from '../shared/park-domain.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENDPOINT = '/api/admin/preview/attempt';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eggy-course-preview-'));
  await cp(join(ROOT, 'data'), join(root, 'data'), { recursive: true });
  const index = JSON.parse(await readFile(join(root, 'data/course.json'), 'utf8'));
  const details = await Promise.all(index.levels.map(async level => JSON.parse(await readFile(join(root, 'data', level.file), 'utf8'))));
  const course = sanitizeCourse(index, details);
  await writeFile(join(root, 'data/progress.json'), JSON.stringify(freshProgress(course)));
  await writeFile(join(root, 'data/week-card.json'), JSON.stringify(freshWeekCard(course)));
  const app = await startServer({ root, assetRoot: ROOT, port: 0 });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  return { root, app, course };
}

async function dataSnapshot(root) {
  const files = (await readdir(join(root, 'data'), { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
  return Object.fromEntries(await Promise.all(files.map(async entry => {
    const path = join(entry.parentPath || entry.path, entry.name);
    return [path.slice(root.length), (await readFile(path)).toString('base64')];
  })));
}

async function post(app, body, { path = ENDPOINT, origin = app.url } = {}) {
  const response = await fetch(`${app.url}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

function previewBody(course, levelId = course.levels[0].id, stepId = 'predict', extra = {}) {
  const level = course.levels.find(item => item.id === levelId);
  return {
    course, mode: 'level', activityId: level.id, action: 'attempt', attemptAction: 'check',
    requestId: 'preview-repeat-request', levelId: level.id, contentVersion: level.version,
    stepId, variantId: '', answer: '', hintLevel: 0, viewedFullAnswer: false, ...extra
  };
}

function assertPreview(response, passed) {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.preview, true);
  assert.equal(response.body.feedback.passed, passed);
  assert.equal(response.body.result.passed, passed);
  assert.equal(response.body.result.xpAwarded, 0);
  assert.equal(response.body.result.starAwarded, false);
  assert.equal(response.body.result.levelCompleted, false);
  assert.equal(response.body.result.checkpointCompleted, false);
  assert.equal(response.body.result.rankPromoted, '');
  assert.deepEqual(response.body.achievements, []);
  assert.equal(Object.hasOwn(response.body, 'progress'), false);
}

test('preview grades the unsaved selected draft, ignores unrelated unfinished edits, and never persists successes, failures, repeats or reveals', async t => {
  const { root, app, course } = await fixture(t);
  const before = await dataSnapshot(root);
  const draft = structuredClone(course);
  const level = draft.levels[0];
  const predict = level.content.steps[0];
  const originalAnswer = JSON.stringify(predict.evaluator.expected);
  predict.evaluator.expected = ['unsaved', 'draft'];
  draft.levels[1].content = { unfinished: true };
  draft.title = '';
  const body = previewBody(draft, level.id, predict.id, { answer: originalAnswer, passed: true, independent: true });
  assertPreview(await post(app, body), false);
  body.answer = JSON.stringify(predict.evaluator.expected);
  const success = await post(app, body);
  assertPreview(success, true);
  assert.deepEqual(await post(app, body), success, 'duplicate preview requests have no persisted receipt or award');

  const independent = level.content.steps.find(step => step.type === 'independent-variation');
  const variant = independent.variants[1];
  const reveal = await post(app, previewBody(draft, level.id, independent.id, {
    action: 'reveal', variantId: variant.id, hintLevel: 3, viewedFullAnswer: true
  }));
  assertPreview(reveal, false);
  assert.deepEqual(reveal.body.reveal, { variantId: variant.id, fullSolution: variant.fullSolution });
  assert.deepEqual(await dataSnapshot(root), before, 'course details, learner progress and week cards remain byte-for-byte unchanged');

  const learnerView = await fetch(`${app.url}/api/play/levels/${level.id}`).then(response => response.json());
  assert.notDeepEqual(learnerView.level.steps[0].evaluator.expected, predict.evaluator.expected, 'unsaved preview does not publish draft changes');
  assert.equal(learnerView.level.steps.find(step => step.type === 'independent-variation').variants[1].fullSolution, undefined);
});

test('preview can inspect a locked Linux lesson while real submissions still enforce rank gates and command evidence', async t => {
  const { root, app, course } = await fixture(t);
  const before = await dataSnapshot(root);
  const level = course.levels.find(item => item.id === 'chicken-teleport-state');
  const step = level.content.steps.find(item => item.id === 'short-edit');
  step.grader = { kind: 'stdout-exact', expected: '/home/learner\n', requirements: { commands: ['pwd'] } };
  const body = previewBody(course, level.id, step.id, { attemptAction: 'run', answer: 'echo /home/learner' });
  const fakeOutput = await post(app, body);
  assertPreview(fakeOutput, false);
  assert.ok(fakeOutput.body.feedback.cases[0].requirementFailures.length);
  assertPreview(await post(app, { ...body, answer: 'pwd' }), true);
  assertPreview(await post(app, { ...body, answer: 'missing-command' }), false);

  const prediction = level.content.steps[0];
  const realInput = previewBody(course, level.id, prediction.id, { answer: JSON.stringify(prediction.evaluator.expected) });
  const { course: ignoredCourse, mode, activityId, attemptAction, ...normal } = realInput;
  const real = await post(app, { ...normal, action: attemptAction }, { path: '/api/play/attempts' });
  assert.equal(real.status, 409, JSON.stringify(real.body));
  assert.equal(real.body.code, 'rank_locked');
  assert.deepEqual(await dataSnapshot(root), before);
});

test('preview rejects invalid identity, stale versions, malformed grading rules, unsupported runtimes and cross-origin posts without persistence', async t => {
  const { root, app, course } = await fixture(t);
  const before = await dataSnapshot(root);
  const body = previewBody(course);
  const cases = [
    { body: null, status: 400 },
    { body: { ...body, mode: 'unknown' }, status: 400 },
    { body: { ...body, levelId: course.levels[1].id }, status: 400 },
    { body: { ...body, contentVersion: 999 }, status: 409 },
    { body: { ...body, stepId: 'unknown-step' }, status: 404 },
    { body: { ...body, attemptAction: 'erase' }, status: 400 },
    { body: { ...body, attemptAction: 'reveal' }, status: 400 },
    { body: { ...body, hintLevel: -1 }, status: 400 },
    { body: { ...body, viewedFullAnswer: true }, status: 400 },
    { body: { ...body, action: 'reveal' }, status: 400 },
    { body: { ...body, answer: { passed: true } }, status: 400 },
    { body: { ...body, course: { levels: [course.levels[0], course.levels[0]] } }, status: 400 }
  ];
  for (const item of cases) {
    const response = await post(app, item.body);
    assert.equal(response.status, item.status, JSON.stringify(response.body));
  }
  const malformed = structuredClone(course);
  malformed.levels[0].content.steps[0].evaluator = { kind: 'stdin-stdout-cases', cases: [] };
  assert.equal((await post(app, { ...body, course: malformed })).status, 400);
  const unsupported = structuredClone(course);
  unsupported.levels[0].content.steps[1].runtimeId = 'host-shell';
  assert.equal((await post(app, { ...body, course: unsupported, stepId: 'run-observe', attemptAction: 'run' })).body.code, 'unsupported_runtime');
  assert.equal((await post(app, body, { origin: 'https://external.example' })).status, 403);
  assert.deepEqual(await dataSnapshot(root), before);
});

test('project preview supports later checkpoints and Boss requirements without completing chapters or awarding progress', async t => {
  const { root, app, course } = await fixture(t);
  const before = await dataSnapshot(root);
  const project = course.projects.find(item => item.rankId === 'peak-phoenix');
  const body = {
    course, mode: 'project', action: 'attempt', attemptAction: 'submit', activityId: project.id,
    projectId: project.id, contentVersion: project.version, checkpointId: project.chapters.at(-1).id,
    requestId: 'preview-project', evidence: '已运行并检查边界情况', hintLevel: 0,
    viewedFullAnswer: false, passed: true, independent: true, performancePoints: 80
  };
  assertPreview(await post(app, body), true);
  body.checkpointId = project.boss.id;
  assertPreview(await post(app, { ...body, performancePoints: 79 }), false);
  assertPreview(await post(app, { ...body, independent: false }), false);
  assertPreview(await post(app, body), true);
  assert.equal((await post(app, { ...body, evidence: '' })).status, 400);
  assert.equal((await post(app, { ...body, action: 'reveal' })).status, 400);
  const invalidCourse = structuredClone(course);
  invalidCourse.ranks.find(item => item.id === project.rankId).promotion.metric = 'always-pass';
  assert.equal((await post(app, { ...body, course: invalidCourse })).status, 400);
  assert.deepEqual(await dataSnapshot(root), before);
});

test('only the workshop player permits same-origin framing', async t => {
  const { app } = await fixture(t);
  for (const [path, expectedFrame, expectedCSP] of [
    ['/play.html?preview=workshop', 'SAMEORIGIN', "frame-ancestors 'self'"],
    ['/play.html', 'DENY', "frame-ancestors 'none'"],
    ['/play.html?preview=other', 'DENY', "frame-ancestors 'none'"],
    ['/admin.html?preview=workshop', 'DENY', "frame-ancestors 'none'"]
  ]) {
    const response = await fetch(`${app.url}${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-frame-options'), expectedFrame);
    assert.ok(response.headers.get('content-security-policy').includes(expectedCSP));
    await response.arrayBuffer();
  }
});

let cRuntimeAvailable = process.platform === 'darwin';
try { await Promise.all(['/usr/bin/clang', '/usr/bin/sandbox-exec'].map(path => access(path, constants.X_OK))); }
catch { cRuntimeAvailable = false; }

test('C preview shares real multi-case grading and sandbox rejection without leaving learning records', { skip: !cRuntimeAvailable && 'requires macOS clang and sandbox-exec' }, async t => {
  const { root, app, course } = await fixture(t);
  const before = await dataSnapshot(root);
  const step = course.levels[0].content.steps.find(item => item.id === 'short-edit');
  step.grader = { kind: 'stdin-stdout-cases', cases: [{ stdin: '1', stdout: '2\n' }, { stdin: '2', stdout: '4\n' }] };
  const code = '#include <stdio.h>\nint main(void) { int value; scanf("%d", &value); printf("%d\\n", value * 2); return 0; }';
  const body = previewBody(course, course.levels[0].id, step.id, { attemptAction: 'run', answer: code });
  const partial = await post(app, { ...body, answer: code.replace('value * 2', 'value + 1') });
  assertPreview(partial, false);
  assert.deepEqual(partial.body.feedback.cases.map(item => item.passed), [true, false]);
  const success = await post(app, body);
  assertPreview(success, true);
  assert.equal(success.body.feedback.cases.length, 2);
  const unsafe = await post(app, { ...body, answer: '#include <stdlib.h>\nint main(void) { return system("pwd"); }' });
  assert.equal(unsafe.status, 400);
  assert.equal(unsafe.body.code, 'api_not_allowed');
  assert.deepEqual(await dataSnapshot(root), before);
});
