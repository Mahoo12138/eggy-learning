import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateCurriculum, freshUnit, patchUnit, appendRecord } from '../shared/study-domain.mjs';
import { freshSchedule, validateSchedule, previewSchedule, applySchedule, weekStartFor, shanghaiToday } from '../shared/schedule.mjs';
const source = JSON.parse(await readFile(new URL('./fixtures/curriculum.json', import.meta.url)));
const copy = v => structuredClone(v);
const today = '2026-10-12';
function setup() { const c = copy(source); c.units = c.units.slice(0, 2); const curriculum = validateCurriculum(c); return { curriculum, docs: curriculum.units.map(freshUnit), schedule: freshSchedule() }; }
function item(id = 'item-one', taskId = 'w01-s1', estimatedMinutes = 90, continuedFromItemId = '') { return { id, taskId, estimatedMinutes, goal: '补一个边界用例并复测', continuedFromItemId }; }
function slot(id = 'slot-one', date = '2026-10-12', minutes = 120, start = '18:00', bufferMinutes = 20) { return { id, date, start, minutes, bufferMinutes }; }
function preview(ctx, input, on = today) { return previewSchedule({ requestId: 'req-one', weekStart: weekStartFor(on), reason: '', slots: [slot()], items: [item()], ...input }, ctx.curriculum, ctx.docs, ctx.schedule, { today: on }); }
function save(ctx, p) { ctx.schedule = applySchedule(ctx.schedule, p, { requestId: p.request.requestId, payloadHash: createHash('sha256').update(JSON.stringify(p.request)).digest('hex'), savedAt: '2026-10-12T10:00:00.000Z' }); return ctx.schedule; }
let sequence = 0;
function training(ctx, taskId, override = {}) {
  const number = ++sequence, index = ctx.curriculum.units.findIndex(u => u.tasks.some(t => t.id === taskId)), unit = ctx.curriculum.units[index];
  ctx.docs[index] = appendRecord(ctx.docs[index], { requestId: `training-${number}`, taskId, assessmentVersion: unit.assessmentVersion, date: today, minutes: 120, outcome: 'passed', result: '实际结果', evidence: '边界复测文件', blocker: '', next: '', ai: 'none', aiCheck: '', answers: [], correctionOf: '', scheduleItemId: '', ...override }, ctx.curriculum, { id: `record-${number}`, savedAt: '2026-10-12T10:00:00.000Z', payloadHash: `training-hash-${number}` });
}

test('Shanghai natural week is independent of host timezone and handles year boundaries', () => {
  assert.equal(shanghaiToday(new Date('2026-12-31T16:00:00Z')), '2027-01-01');
  assert.equal(weekStartFor('2027-01-01'), '2026-12-28');
  assert.equal(weekStartFor('2027-01-03'), '2026-12-28');
  assert.equal(weekStartFor('2027-01-04'), '2027-01-04');
  assert.throws(() => weekStartFor('2026-02-30'), /日期/);
});

test('zero capacity creates a pause without fake slots, rates or changed training records', () => {
  const ctx = setup(); training(ctx, 'w01-s1', { outcome: 'practice', minutes: 70 }); const original = copy(ctx.docs);
  const p = preview(ctx, { slots: [], resumeDate: '' });
  assert.equal(p.capacityMinutes, 0); assert.equal(p.plannedMinutes, 0); assert.equal(p.plan.slots.length, 0); assert.equal(p.plan.unassigned.length, 1);
  save(ctx, p); assert.deepEqual(ctx.docs, original); assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum));
});

test('remaining estimate is newly entered work scope, never estimated minus elapsed time', () => {
  const ctx = setup(); training(ctx, 'w01-s1', { minutes: 300, outcome: 'practice' });
  const p = preview(ctx, { items: [item('remaining', 'w01-s1', 65)] });
  assert.equal(p.plannedMinutes, 65); assert.equal(p.plan.slots[0].items[0].estimatedMinutes, 65); assert.equal(ctx.docs[0].records[0].minutes, 300);
});

test('two-day capacity leaves work queued, never adds a third day or squeezes buffer', () => {
  const ctx = setup(), p = preview(ctx, { slots: [slot('mon'), slot('wed', '2026-10-14')], items: [item('first'), item('second', 'w01-s2'), item('third', 'w01-s3')] });
  assert.equal(p.plan.slots.length, 2); assert.equal(p.plannedMinutes, 180); assert.equal(p.bufferMinutes, 40); assert.equal(p.plan.unassigned.length, 1);
  assert.equal(p.plan.slots.reduce((n, s) => n + s.minutes, 0), 240);
});

test('overlapping and cross-midnight slots are rejected; exact boundaries are valid', () => {
  const ctx = setup();
  assert.throws(() => preview(ctx, { slots: [slot('a'), slot('b', today, 120, '19:00')] }), /重叠/);
  assert.throws(() => preview(ctx, { slots: [slot('a', today, 120, '23:00')] }), /午夜/);
  const p = preview(ctx, { slots: [slot('a', today, 120, '20:00'), slot('b', today, 120, '22:00')] });
  assert.equal(p.plan.slots.length, 2);
});

test('independent acceptance removes repetition and advances to next unit without four attendance records', () => {
  const ctx = setup(), unit = ctx.curriculum.units[0]; training(ctx, unit.acceptanceTaskId);
  ctx.docs[0] = patchUnit(ctx.docs[0], { assessment: { version: unit.assessmentVersion, checks: Object.fromEntries(unit.criteria.map(c => [c.id, true])) } }, ctx.curriculum);
  const p = preview(ctx, { items: undefined, slots: [slot('large', today, 240)] });
  assert.ok(p.request.items.length); assert.ok(p.request.items.every(i => i.taskId.startsWith('w02-')));
  assert.equal(ctx.docs[0].records.length, 1);
});

test('new curriculum version schedules independent revalidation instead of skipping old passes', () => {
  const ctx = setup(); for (const task of ctx.curriculum.units[0].tasks) training(ctx, task.id);
  const changed = copy(ctx.curriculum); changed.units[0].criteria[0].text += ' 新的边界';
  ctx.curriculum = validateCurriculum(changed, ctx.curriculum, ctx.docs);
  const p = preview(ctx, { items: undefined, slots: [slot('large', today, 240)] });
  assert.ok(p.request.items.some(i => i.taskId === ctx.curriculum.units[0].acceptanceTaskId), '旧版独立验收不能被当成新版已完成');
});

test('auto proposal prioritizes an existing blocker before untouched tasks', () => {
  const ctx = setup(); training(ctx, 'w01-s3', { outcome: 'blocked', blocker: '输入错误后循环卡死', next: '复现输入失败并定位' });
  const p = preview(ctx, { items: undefined, slots: [slot('large', today, 240)] });
  assert.equal(p.request.items[0].taskId, 'w01-s3');
});

test('review cannot invent completion without records or reuse a different task as evidence', () => {
  const ctx = setup(); save(ctx, preview(ctx, {}));
  const review = { weekStart: today, revisionId: 'req-one-plan', note: '', items: [{ itemId: 'item-one', outcome: 'done', next: '', recordIds: [] }] };
  assert.throws(() => preview(ctx, { requestId: 'next', review }), /关联训练记录/);
  training(ctx, 'w01-s2'); review.items[0].recordIds = [ctx.docs[0].records[0].id];
  assert.throws(() => preview(ctx, { requestId: 'next', review }), /同一任务/);
  review.items[0] = { itemId: 'item-one', outcome: 'unknown', next: '', recordIds: [] };
  assert.equal(preview(ctx, { requestId: 'next', review }).request.review.items[0].outcome, 'unknown');
});

test('review of an older revision conflicts rather than rewriting current plan', () => {
  const ctx = setup(); save(ctx, preview(ctx, {})); save(ctx, preview(ctx, { requestId: 'second', slots: [] }));
  assert.throws(() => preview(ctx, { requestId: 'third', review: { weekStart: today, revisionId: 'req-one-plan', note: '', items: [] } }), error => error.status === 409);
});

test('one source cannot be continued twice within a new revision', () => {
  const ctx = setup(); save(ctx, preview(ctx, {}));
  assert.throws(() => preview(ctx, { requestId: 'next', items: [item('c1', 'w01-s1', 30, 'item-one'), item('c2', 'w01-s1', 30, 'item-one')] }), /不重复|重复/);
});

test('repeated apply does not append duplicate revisions or reviews; changed payload conflicts', () => {
  const ctx = setup(), p = preview(ctx, {}); save(ctx, p); const saved = copy(ctx.schedule);
  save(ctx, p); assert.deepEqual(ctx.schedule, saved);
  assert.throws(() => applySchedule(ctx.schedule, p, { requestId: p.request.requestId, payloadHash: 'different', savedAt: '2026-10-13T00:00:00Z' }), error => error.status === 409);
});

test('archival retains schedule history, but cannot make new arrangements for archived work', () => {
  const ctx = setup(); save(ctx, preview(ctx, {}));
  const c = copy(ctx.curriculum); c.units[0].tasks[0].archived = true; ctx.curriculum = validateCurriculum(c, ctx.curriculum, ctx.docs, ctx.schedule);
  assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum));
  assert.throws(() => preview(ctx, { requestId: 'next' }), /归档/);
});

test('revising this week preserves elapsed slots and original revision', () => {
  const ctx = setup(); save(ctx, preview(ctx, {}));
  const p = preview(ctx, { requestId: 'tuesday', slots: [slot('tue', '2026-10-13')], items: [item('next-item', 'w01-s2')] }, '2026-10-13');
  assert.equal(p.plan.slots[0].date, today); assert.equal(p.plan.slots[0].items[0].id, 'item-one');
  save(ctx, p); assert.equal(ctx.schedule.weeks[0].revisions.length, 2); assert.equal(ctx.schedule.weeks[0].revisions[0].slots.length, 1);
});

test('restoring after zero-capacity week suggests a check inside available capacity', () => {
  const ctx = setup(); save(ctx, preview(ctx, { slots: [], items: [] }));
  const p = preview(ctx, { requestId: 'restart', weekStart: '2026-10-19', slots: [slot('next-mon', '2026-10-19')] }, '2026-10-19');
  assert.ok(p.reminders.some(x => x.includes('短自测'))); assert.equal(p.capacityMinutes, 120);
});

test('cross-week carryover moves an existing future fragment once and preserves original plan', () => {
  const ctx = setup();
  const first = preview(ctx, { weekStart: '2026-10-19', slots: [slot('next-week', '2026-10-19')] }); save(ctx, first);
  const moved = preview(ctx, { requestId: 'move', weekStart: '2026-10-26', slots: [slot('later', '2026-10-26')], items: [item('continued', 'w01-s1', 60, 'item-one')] });
  assert.equal(moved.moves[0].weekStart, '2026-10-19'); save(ctx, moved);
  const oldWeek = ctx.schedule.weeks.find(w => w.weekStart === '2026-10-19');
  assert.equal(oldWeek.revisions[0].slots[0].items.length, 1);
  assert.equal(oldWeek.revisions.at(-1).slots[0].items.length, 0);
  assert.equal(ctx.schedule.weeks.find(w => w.weekStart === '2026-10-26').revisions.at(-1).slots[0].items[0].continuedFromItemId, 'item-one');
  assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum));
});

test('cross-week second continuation from an already scheduled source conflicts', () => {
  const ctx = setup(); save(ctx, preview(ctx, { weekStart: '2026-10-19', slots: [slot('next-week', '2026-10-19')] }));
  save(ctx, preview(ctx, { requestId: 'move', weekStart: '2026-10-26', slots: [slot('later', '2026-10-26')], items: [item('continued', 'w01-s1', 60, 'item-one')] }));
  assert.throws(() => preview(ctx, { requestId: 'duplicate', weekStart: '2026-11-02', slots: [slot('again', '2026-11-02')], items: [item('duplicate-item', 'w01-s1', 60, 'item-one')] }), /重复续做/);
});

test('new unit with no file still has a usable default schedule proposal', () => {
  const ctx = setup(); ctx.docs = [];
  const p = preview(ctx, { items: undefined });
  assert.ok(p.request.items.length);
});

test('corrupt receipt, missing slots item list and dangling continuation fail startup validation', () => {
  const ctx = setup(); save(ctx, preview(ctx, {}));
  assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum, ctx.docs));
  for (const mutate of [
    bad => { bad.receipts = [null]; },
    bad => { delete bad.weeks[0].revisions[0].slots[0].items; },
    bad => { bad.weeks[0].revisions[0].slots[0].items[0].continuedFromItemId = 'never-existed'; },
    bad => { delete bad.weeks[0].revisions[0].createdAt; },
    bad => { bad.receipts.push(copy(bad.receipts[0])); }
  ]) {
    const bad = copy(ctx.schedule); mutate(bad);
    assert.throws(() => validateSchedule(bad, ctx.curriculum, ctx.docs));
  }
});

test('stored review cannot silently refer to missing or different-task training records', () => {
  const ctx = setup(); save(ctx, preview(ctx, {})); training(ctx, 'w01-s2');
  assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum, ctx.docs));
  const bad = copy(ctx.schedule);
  bad.weeks[0].reviews.push({ id: 'review-corrupt', createdAt: '2026-10-13T00:00:00Z', revisionId: 'req-one-plan', note: '', items: [{ itemId: 'item-one', outcome: 'done', next: '', recordIds: ['record-never-existed'] }] });
  assert.throws(() => validateSchedule(bad, ctx.curriculum, ctx.docs));
  bad.weeks[0].reviews[0].items[0].recordIds = [ctx.docs[0].records[0].id];
  assert.throws(() => validateSchedule(bad, ctx.curriculum, ctx.docs));
});

test('a past fragment cannot reuse its identity for a later week; new continuation identity is allowed', () => {
  const ctx = setup(); save(ctx, preview(ctx, {}));
  const future = { requestId: 'later', weekStart: '2026-10-19', slots: [slot('next-week', '2026-10-19')], items: [item()] };
  assert.throws(() => preview(ctx, future, '2026-10-13'), /过去|编号|来源|片段/);
  const next = preview(ctx, { ...future, items: [item('new-fragment', 'w01-s1', 60, 'item-one')] }, '2026-10-13');
  save(ctx, next);
  assert.equal(ctx.schedule.weeks[0].revisions.at(-1).slots[0].items[0].id, 'item-one');
  assert.equal(ctx.schedule.weeks[1].revisions.at(-1).slots[0].items[0].continuedFromItemId, 'item-one');
});

test('capacity-limited unassigned items can be reviewed and carried into the next plan', () => {
  const ctx = setup(); save(ctx, preview(ctx, { items: [item('too-large', 'w01-s1', 180)] }));
  assert.equal(ctx.schedule.weeks[0].revisions[0].unassigned[0].id, 'too-large');
  const next = preview(ctx, { requestId: 'continue-unassigned', weekStart: '2026-10-19', slots: [slot('next-week', '2026-10-19')], items: [item('smaller-scope', 'w01-s1', 70, 'too-large')], review: { weekStart: today, revisionId: 'req-one-plan', note: '重新拆小范围', items: [{ itemId: 'too-large', outcome: 'not-started', next: '先完成错误输入分支', recordIds: [] }] } });
  assert.equal(next.request.review.items[0].itemId, 'too-large');
  save(ctx, next); assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum, ctx.docs));
});

test('a continuation may not point to its own stable fragment identity', () => {
  const ctx = setup(); save(ctx, preview(ctx, {}));
  assert.throws(() => preview(ctx, { requestId: 'self-cycle', items: [item('item-one', 'w01-s1', 70, 'item-one')] }), /接续|来源|片段|自身/);
});

test('a historical review remains readable after its linked training is corrected', () => {
  const ctx = setup(); save(ctx, preview(ctx, {})); training(ctx, 'w01-s1');
  const original = ctx.docs[0].records[0];
  const checked = preview(ctx, { requestId: 'checked', slots: [], items: [], review: { weekStart: today, revisionId: 'req-one-plan', note: '按实际记录核对', items: [{ itemId: 'item-one', outcome: 'done', next: '', recordIds: [original.id] }] } });
  save(ctx, checked);
  assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum, ctx.docs));
  training(ctx, 'w01-s1', { correctionOf: original.id, minutes: 70, result: '更正实际时长，原证据保留' });
  assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum, ctx.docs));
  assert.equal(ctx.schedule.weeks[0].reviews[0].items[0].recordIds[0], original.id);
});

test('explicit recovery check precedes continuation and blockers while staying inside capacity', () => {
  const ctx = setup();
  save(ctx, preview(ctx, { items: [item('original', 'w01-s2', 60)] }));
  save(ctx, preview(ctx, { requestId: 'pause', weekStart: '2026-10-19', slots: [], items: [item('paused', 'w01-s2', 60, 'original')] }));
  training(ctx, 'w01-s3', { outcome: 'blocked', blocker: '输入卡死', next: '先复现错误输入' });
  const p = preview(ctx, { requestId: 'resume', weekStart: '2026-10-26', slots: [slot('return', '2026-10-26', 180)], items: [item('continued', 'w01-s2', 60, 'paused'), item('bug', 'w01-s3', 60), { ...item('short-check', 'w01-s2', 15), kind: 'recovery-check', goal: '独立解释最近的边界处理' }] });
  assert.deepEqual(p.plan.slots[0].items.map(i => i.id), ['short-check', 'bug', 'continued']);
  assert.equal(p.plannedMinutes, 135); assert.equal(p.bufferMinutes, 20);
  save(ctx, p); assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum, ctx.docs));
});

test('a recovery-looking title cannot change priority or silently change a stable fragment kind', () => {
  const ctx = setup(); training(ctx, 'w01-s2', { outcome: 'blocked', blocker: '卡点', next: '继续定位' });
  const p = preview(ctx, { slots: [slot('large', today, 240)], items: [{ ...item('normal', 'w01-s1'), goal: '恢复自测（仍然是普通工作片段）' }, item('blocked', 'w01-s2')] });
  assert.equal(p.request.items[0].id, 'blocked');
  save(ctx, p);
  assert.throws(() => preview(ctx, { requestId: 'change-kind', items: [{ ...item('normal', 'w01-s1'), kind: 'recovery-check' }] }), /类型/);
  assert.throws(() => preview(ctx, { requestId: 'bad-kind', items: [{ ...item('invalid'), kind: 'anything' }] }), /类型/);
});

test('a paused unassigned continuation cannot be forked from its old source in another week', () => {
  const ctx = setup(); save(ctx, preview(ctx, { items: [item('original')] }));
  save(ctx, preview(ctx, { requestId: 'pause', weekStart: '2026-10-19', slots: [], items: [item('paused', 'w01-s1', 60, 'original')] }));
  assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum, ctx.docs));
  const unchanged = copy(ctx.schedule);
  assert.throws(() => preview(ctx, { requestId: 'fork-unassigned', weekStart: '2026-10-26', slots: [slot('resume', '2026-10-26')], items: [item('fork', 'w01-s1', 60, 'original')] }), /重复续做/);
  assert.deepEqual(ctx.schedule, unchanged);
});

test('moving the existing paused fragment preserves its source and old revisions without duplication', () => {
  const ctx = setup(); save(ctx, preview(ctx, { items: [item('original')] }));
  save(ctx, preview(ctx, { requestId: 'pause', weekStart: '2026-10-19', slots: [], items: [item('paused', 'w01-s1', 60, 'original')] }));
  const moved = preview(ctx, { requestId: 'move-existing', weekStart: '2026-10-26', slots: [slot('resume', '2026-10-26')], items: [item('paused', 'w01-s1', 60, 'original')] });
  save(ctx, moved);
  const old = ctx.schedule.weeks.find(w => w.weekStart === '2026-10-19');
  assert.equal(old.revisions[0].unassigned[0].id, 'paused');
  assert.equal(old.revisions.at(-1).unassigned.length, 0);
  const latest = ctx.schedule.weeks.flatMap(w => [...w.revisions.at(-1).slots.flatMap(s => s.items), ...w.revisions.at(-1).unassigned]);
  assert.equal(latest.filter(i => i.id === 'paused').length, 1);
  assert.equal(latest.find(i => i.id === 'paused').continuedFromItemId, 'original');
  assert.doesNotThrow(() => validateSchedule(ctx.schedule, ctx.curriculum, ctx.docs));
});
