import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleCandidates } from '../public/assets/schedule-candidates.mjs';

const unit = {
  id: 'unit-one', assessmentVersion: 2,
  tasks: [{ id: 'task-one', title: '文件保存', output: '保存并恢复餐食', estimatedMinutes: 150, archived: false }]
};
let sequence = 0;
const makeId = () => `candidate-${++sequence}`;
const source = (itemId, outcome, next, remainingMinutes) => ({
  itemId, taskId: 'task-one', outcome, next, remainingMinutes
});
const build = (items, previous = [], records = []) => buildScheduleCandidates(unit, records, items, makeId, previous);

test('completed warm-up never deselects unfinished work on the same task', () => {
  const candidates = build([
    source('warmup', 'done', '恢复自测已完成', 15),
    source('main-work', 'partial', '补损坏文件错误处理', 75)
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].continuedFromItemId, 'main-work');
  assert.equal(candidates[0].goal, '补损坏文件错误处理');
  assert.equal(candidates[0].estimatedMinutes, 75);
  assert.equal(candidates[0].selected, true);
});

test('several unfinished scopes keep separate identity, goals and remaining estimates', () => {
  const candidates = build([
    source('file-errors', 'partial', '修复损坏文件分支', 60),
    source('exit-cleanup', 'not-started', '验证退出清理', 40),
    source('unknown-scope', 'unknown', '核对写入失败的处理', 30)
  ]);
  assert.deepEqual(candidates.map(c => [c.continuedFromItemId,c.goal,c.estimatedMinutes,c.selected]), [
    ['file-errors','修复损坏文件分支',60,true],
    ['exit-cleanup','验证退出清理',40,true],
    ['unknown-scope','核对写入失败的处理',30,true]
  ]);
  assert.equal(new Set(candidates.map(c => c.id)).size, 3);
});

test('changing one review scope does not overwrite another manually adjusted candidate', () => {
  const items = [source('file-errors','partial','修复损坏文件分支',60),source('exit-cleanup','partial','验证退出清理',40)];
  const first = build(items);
  first[1].goal = '只复测失败退出';
  first[1].estimatedMinutes = 25;
  first[1].selected = false;
  items[0].next = '先补错误输入样例';
  items[0].remainingMinutes = 35;
  const next = build(items, first);
  assert.deepEqual(next.map(c => c.id), first.map(c => c.id), 'candidate IDs stay stable during edits');
  assert.deepEqual([next[0].goal,next[0].estimatedMinutes], ['先补错误输入样例',35]);
  assert.deepEqual([next[1].goal,next[1].estimatedMinutes,next[1].selected], ['只复测失败退出',25,false]);
  assert.deepEqual(next.map(c => c.continuedFromItemId), ['file-errors','exit-cleanup']);
});

test('marking one of several scopes done removes only that scope', () => {
  const items = [source('first','partial','目标一',60),source('second','partial','目标二',40)];
  const before = build(items);
  items[0].outcome = 'done';
  const next = build(items, before);
  assert.equal(next.length, 1);
  assert.equal(next[0].id, before[1].id);
  assert.equal(next[0].continuedFromItemId, 'second');
  assert.equal(next[0].selected, true);
});

test('calendar completion alone is not task completion; current evidence can suppress repetition', () => {
  const items = [source('warmup','done','恢复检查完成',15)];
  const noEvidence = build(items);
  assert.equal(noEvidence[0].selected, true);
  assert.equal(noEvidence[0].continuedFromItemId, '', 'do not continue a completed scope');
  const oldPass = build(items, [], [{taskId:'task-one',outcome:'passed',assessmentVersion:1}]);
  assert.equal(oldPass[0].selected, true, 'old requirement version still needs revalidation');
  const currentPass = build(items, [], [{taskId:'task-one',outcome:'passed',assessmentVersion:2}]);
  assert.equal(currentPass[0].selected, false);
});

test('explicit unfinished review remains visible even when another attempt passed', () => {
  const candidates = build([source('remaining','partial','还需补一个边界',30)], [], [
    {taskId:'task-one',outcome:'passed',assessmentVersion:2}
  ]);
  assert.equal(candidates[0].selected, true);
  assert.equal(candidates[0].continuedFromItemId, 'remaining');
});

test('continuing recovery and work scopes preserves their distinct kind', () => {
  const recovery = { ...source('recall','partial','解释还未完成',10), kind:'recovery-check' };
  const work = { ...source('main','partial','补边界检查',35), kind:'work' };
  const next = build([recovery,work]);
  assert.deepEqual(next.map(c => c.kind), ['recovery-check','work']);
  assert.deepEqual(next.map(c => c.continuedFromItemId), ['recall','main']);
});
