import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCurriculum, freshUnit, validateUnit, patchUnit, appendRecord, effectiveRecords, unitStatus, summarize } from '../shared/study-domain.mjs';
const source = JSON.parse(await readFile(new URL('./fixtures/curriculum.json', import.meta.url)));
const copy = v => structuredClone(v);
function course() { const c = copy(source); c.units = c.units.slice(0, 2); return validateCurriculum(c); }
let count = 0;
function record(c, doc, override = {}, metaOverride = {}) {
  const unit = c.units.find(u => u.id === doc.unitId), num = ++count;
  return appendRecord(doc, { requestId: `request-${num}`, taskId: unit.acceptanceTaskId, assessmentVersion: unit.assessmentVersion, date: '2026-10-13', minutes: 80, outcome: 'passed', result: '独立实现并运行边界用例', evidence: '代码 abc / 用例表', blocker: '', next: '', ai: 'none', aiCheck: '', answers: [], correctionOf: '', scheduleItemId: '', ...override }, c, { id: `record-${num}`, savedAt: '2026-10-13T10:00:00.000Z', payloadHash: `hash-${num}`, ...metaOverride });
}
function checked(c, doc) { const u = c.units.find(u => u.id === doc.unitId); return patchUnit(doc, { assessment: { version: u.assessmentVersion, checks: Object.fromEntries(u.criteria.map(k => [k.id, true])) } }, c); }
function addQuestion(c, linked = true) {
  const next = copy(c), unit = next.units[0];
  unit.tasks.at(-1).questions.push({ id: 'q-boundary', kind: 'reflection', prompt: '为什么先检查边界？', hints: ['先列空输入'], referencePoints: ['避免无效状态'], version: 1, archived: false, criterionId: linked ? unit.criteria[0].id : '' });
  return validateCurriculum(next, c);
}
function answerFor(c) { const q = c.units[0].tasks.at(-1).questions[0]; return { questionId: q.id, questionVersion: q.version, text: '先检验数量，才能计算均值', evidence: 'zero-input.txt' }; }
function expect409(fn) { assert.throws(fn, e => e.status === 409); }

test('the editable repository curriculum conforms to the same dynamic schema', async () => {
  const live = JSON.parse(await readFile(new URL('../data/curriculum.json', import.meta.url)));
  const c = validateCurriculum(live), summary = summarize(c);
  assert.equal(summary.total, c.units.filter(u => !u.archived).length);
  assert.equal(summary.records, 0);
});

test('strict schemas reject unknown, duplicated and cross-unit references', () => {
  const c = course();
  assert.throws(() => validateCurriculum({ ...c, surprise: true }), /未知/);
  const dup = copy(c); dup.units[1].tasks[0].id = dup.units[0].tasks[0].id;
  assert.throws(() => validateCurriculum(dup), /重复/);
  const cross = copy(c); cross.units[0].acceptanceTaskId = cross.units[1].tasks[0].id;
  assert.throws(() => validateCurriculum(cross), /独立验收/);
  const bad = addQuestion(c); bad.units[0].tasks.at(-1).questions[0].criterionId = c.units[1].criteria[0].id;
  assert.throws(() => validateCurriculum(bad), /本单元/);
});

test('independent acceptance permits skipping repetitions without fake attendance', () => {
  const c = course(); let d = record(c, freshUnit(c.units[0]));
  assert.equal(unitStatus(d, c.units[0]), 'review'); d = checked(c, d);
  assert.equal(unitStatus(d, c.units[0]), 'accepted');
  assert.equal(d.records.length, 1); assert.equal(summarize(c, [d]).minutes, 80);
});

test('a same-task passed retest alone closes a blocker, even across requirement updates', () => {
  let c = course(), d = record(c, freshUnit(c.units[0]), { taskId: 'w01-s1', outcome: 'blocked', evidence: '', blocker: '输入字母后死循环', next: '检查读取结果' });
  d = record(c, d, { taskId: 'w01-s1', outcome: 'practice' });
  d = checked(c, record(c, d));
  assert.equal(unitStatus(d, c.units[0]), 'blocked');
  const change = copy(c); change.units[0].tasks[0].steps.push('补错误分支'); c = validateCurriculum(change, c, [d]);
  assert.equal(unitStatus(d, c.units[0]), 'blocked');
  d = record(c, d, { taskId: 'w01-s1' });
  assert.equal(unitStatus(d, c.units[0]), 'review');
  d = checked(c, record(c, d)); assert.equal(unitStatus(d, c.units[0]), 'accepted');
});

test('rename, reorder, stage and estimates do not revoke acceptance; same-length changed criterion does', () => {
  let c = course(), d = checked(c, record(c, freshUnit(c.units[0])));
  const cosmetic = copy(c); cosmetic.units[0].title = '新标题'; cosmetic.units[0].tasks.reverse(); cosmetic.units[0].tasks[0].estimatedMinutes = 100;
  cosmetic.units[0].stageId = c.stages[1].id; cosmetic.units[0].criteria.reverse(); cosmetic.units[0].assessmentVersion = 999;
  const stable = validateCurriculum(cosmetic, c, [d]);
  assert.equal(stable.units[0].assessmentVersion, 1); assert.equal(unitStatus(d, stable.units[0]), 'accepted');
  const change = copy(stable); change.units[0].criteria[0].text = '增加一项新的错误边界';
  const next = validateCurriculum(change, stable, [d]);
  assert.equal(next.units[0].assessmentVersion, 2); assert.equal(unitStatus(d, next.units[0]), 'review');
  expect409(() => patchUnit(d, { assessment: d.assessment }, next));
  expect409(() => record(next, d, { assessmentVersion: 1 }));
});

test('removing a criterion preserves old snapshot and checks, but requires new acceptance', () => {
  const c = course(), d = checked(c, record(c, freshUnit(c.units[0]))), changed = copy(c);
  changed.units[0].criteria.pop();
  const next = validateCurriculum(changed, c, [d]);
  const old = validateUnit(d, next);
  assert.equal(old.records[0].criteriaSnapshot.length, 3); assert.equal(Object.keys(old.assessment.checks).length, 3);
  assert.equal(unitStatus(old, next.units[0]), 'review');
});

test('answered question hint change increments question version but preserves acceptance; semantic edit requires review', () => {
  const c = addQuestion(course()); let d = record(c, freshUnit(c.units[0]), { answers: [answerFor(c)] }); d = checked(c, d);
  assert.equal(unitStatus(d, c.units[0]), 'accepted');
  const hints = copy(c); hints.units[0].tasks.at(-1).questions[0].hints.push('观察输入失败');
  const next = validateCurriculum(hints, c, [d]);
  assert.equal(next.units[0].assessmentVersion, c.units[0].assessmentVersion);
  assert.equal(next.units[0].tasks.at(-1).questions[0].version, 2);
  assert.equal(unitStatus(d, next.units[0]), 'accepted');
  assert.equal(d.records[0].answers[0].snapshot.hints.length, 1);
  expect409(() => record(next, d, { answers: [answerFor(c)] }));
  const semantic = copy(next); semantic.units[0].tasks.at(-1).questions[0].referencePoints.push('检查返回值');
  const revised = validateCurriculum(semantic, next, [d]);
  assert.equal(revised.units[0].assessmentVersion, next.units[0].assessmentVersion + 1);
  assert.equal(unitStatus(d, revised.units[0]), 'review');
});

test('unlinked exercise changes do not revoke unit acceptance; linked answers need evidence', () => {
  let c = addQuestion(course(), false), d = checked(c, record(c, freshUnit(c.units[0])));
  const change = copy(c); change.units[0].tasks.at(-1).questions[0].prompt = '另一道练习题';
  c = validateCurriculum(change, c, [d]); assert.equal(unitStatus(d, c.units[0]), 'accepted');
  const linked = copy(c); linked.units[0].tasks.at(-1).questions[0].criterionId = c.units[0].criteria[0].id;
  c = validateCurriculum(linked, c, [d]); d = checked(c, record(c, d));
  assert.equal(unitStatus(d, c.units[0]), 'review');
  d = record(c, d, { answers: [{ ...answerFor(c), evidence: '' }] }); assert.equal(unitStatus(d, c.units[0]), 'review');
  d = record(c, d, { answers: [answerFor(c)] }); assert.equal(unitStatus(d, c.units[0]), 'accepted');
});

test('historical tasks and answered questions cannot be removed or relocated; archives stay readable', () => {
  const c = addQuestion(course()), d = record(c, freshUnit(c.units[0]), { answers: [answerFor(c)] });
  const removeQ = copy(c); removeQ.units[0].tasks.at(-1).questions = [];
  expect409(() => validateCurriculum(removeQ, c, [d]));
  const moveQ = copy(c), question = moveQ.units[0].tasks.at(-1).questions.pop(); moveQ.units[0].tasks[0].questions.push(question);
  expect409(() => validateCurriculum(moveQ, c, [d]));
  const moveTask = copy(c), task = moveTask.units[0].tasks.pop(); moveTask.units[0].acceptanceTaskId = moveTask.units[0].tasks.at(-1).id; task.questions = []; moveTask.units[1].tasks.push(task);
  expect409(() => validateCurriculum(moveTask, c, [d]));
  const archived = copy(c); archived.units[0].tasks.at(-1).questions[0].archived = true;
  const next = validateCurriculum(archived, c, [d]); assert.equal(validateUnit(d, next).records.length, 1);
  expect409(() => record(next, d, { answers: [answerFor(next)] }));
});

test('schedule references alone prevent task deletion; unreferenced new mistakes can be deleted', () => {
  const c = course(), next = copy(c); next.units[0].tasks.shift();
  expect409(() => validateCurriculum(next, c, [], { history: [{ items: [{ taskId: 'w01-s1', unitId: 'w01' }] }] }));
  assert.equal(validateCurriculum(next, c).units[0].tasks.length, 3);
});

test('request retry is idempotent and a reused key with changed payload conflicts', () => {
  const c = course(), d = record(c, freshUnit(c.units[0]), { requestId: 'fixed' }, { payloadHash: 'same' });
  const retry = record(c, d, { requestId: 'fixed' }, { payloadHash: 'same' });
  assert.equal(retry.records.length, 1);
  expect409(() => record(c, d, { requestId: 'fixed' }, { payloadHash: 'different' }));
});

test('corrections replace statistics, preserve chain/history and cannot branch', () => {
  const c = course(); let d = record(c, freshUnit(c.units[0]), { minutes: 90 }); const original = d.records[0];
  d = record(c, d, { minutes: 60, correctionOf: original.id, result: '更正：实际 60 分钟' });
  const correction = d.records.at(-1);
  assert.equal(effectiveRecords(d).length, 1); assert.equal(summarize(c, [d]).minutes, 60); assert.equal(d.records.length, 2);
  expect409(() => record(c, d, { correctionOf: original.id }));
  d = record(c, d, { correctionOf: correction.id, minutes: 70 });
  assert.equal(effectiveRecords(d)[0].minutes, 70); assert.equal(d.records.length, 3);
});

test('correcting an early blocked attempt does not reorder it after successful retest', () => {
  const c = course(); let d = record(c, freshUnit(c.units[0]), { outcome: 'blocked', blocker: '编译失败', next: '定位头文件' }); const failed = d.records[0];
  d = checked(c, record(c, d)); assert.equal(unitStatus(d, c.units[0]), 'accepted');
  d = record(c, d, { correctionOf: failed.id, outcome: 'blocked', blocker: '编译路径失败', next: '核对路径', minutes: 60 });
  assert.equal(unitStatus(d, c.units[0]), 'accepted'); assert.equal(effectiveRecords(d)[0].outcome, 'blocked');
});

test('correction of an old version never masquerades as new-version mastery', () => {
  const c = addQuestion(course()), d = checked(c, record(c, freshUnit(c.units[0]), { answers: [answerFor(c)] }));
  const changed = copy(c); changed.units[0].tasks.at(-1).questions[0].prompt = '新版问题';
  const next = validateCurriculum(changed, c, [d]);
  expect409(() => record(next, d, { correctionOf: d.records[0].id }));
  const corrected = record(next, d, { correctionOf: d.records[0].id, assessmentVersion: c.units[0].assessmentVersion, answers: [answerFor(c)], minutes: 65 });
  assert.equal(unitStatus(corrected, next.units[0]), 'review');
  assert.equal(effectiveRecords(corrected)[0].answers[0].snapshot.prompt, '为什么先检查边界？');
});

test('old drafts survive a question edit, but stale answers cannot be submitted as new answers', () => {
  const c = addQuestion(course()), unit = c.units[0], task = unit.tasks.at(-1);
  let d = patchUnit(freshUnit(unit), { drafts: { [task.id]: { assessmentVersion: unit.assessmentVersion, date: '', minutes: '', outcome: 'practice', result: '', evidence: '', blocker: '', next: '', ai: 'none', aiCheck: '', answers: [{ ...answerFor(c), text: '' }] } } }, c);
  const changed = copy(c); changed.units[0].tasks.at(-1).questions[0].hints.push('提示变化');
  const next = validateCurriculum(changed, c, [d]); d = validateUnit(d, next);
  assert.equal(d.drafts[task.id].answers[0].questionVersion, 1);
  expect409(() => record(next, d, { answers: [answerFor(c)] }));
  const saved = record(next, d, { answers: [answerFor(next)] }); assert.equal(Object.keys(saved.drafts).length, 0);
});

test('malformed dates, missing independent checks and missing blocker next steps fail', () => {
  const c = course(), d = freshUnit(c.units[0]);
  assert.throws(() => record(c, d, { date: '2026-02-30' }), /日期/);
  assert.throws(() => record(c, d, { outcome: 'passed', evidence: '' }), /证据/);
  assert.throws(() => record(c, d, { ai: 'code', aiCheck: '' }), /独立检查/);
  assert.throws(() => record(c, d, { outcome: 'blocked', blocker: '问题', next: '' }), /下一步/);
  assert.throws(() => patchUnit(d, { records: [] }, c), /未知/);
  assert.throws(() => patchUnit(d, { assessment: { version: 1, checks: {} } }, c), /全部标准/);
});

test('archive excludes curriculum denominators, retains real history time and refuses an active orphan stage', () => {
  const c = course(), d = record(c, freshUnit(c.units[0]));
  const bad = copy(c); bad.stages[0].archived = true;
  assert.throws(() => validateCurriculum(bad, c, [d]), /归档阶段/);
  const archived = copy(c); archived.units[0].archived = true;
  const next = validateCurriculum(archived, c, [d]), summary = summarize(next, [d]);
  assert.equal(summary.total, 1); assert.equal(summary.records, 1); assert.equal(summary.minutes, 80);
  assert.equal(summary.units.some(u => u.id === d.unitId), false);
});

test('correcting historical metadata does not erase a new task draft', () => {
  const c = course(); let d = record(c, freshUnit(c.units[0])); const old = d.records[0];
  const draft = { assessmentVersion: 1, date: '', minutes: '', outcome: 'practice', result: '新的训练尚未完成', evidence: '', blocker: '', next: '', ai: 'none', aiCheck: '', answers: [] };
  d = patchUnit(d, { drafts: { [old.taskId]: draft } }, c);
  d = record(c, d, { correctionOf: old.id, minutes: 50 });
  assert.equal(d.drafts[old.taskId].result, '新的训练尚未完成');
});
