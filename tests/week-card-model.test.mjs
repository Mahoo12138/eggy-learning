import test from 'node:test';
import assert from 'node:assert/strict';
import { weekChoices, parseGoal, goalValue, weekPayload } from '../public/assets/components/week-card-model.mjs';

const course = {
  courseId: 'park',
  levels: [{ id: 'q', rankId: 'quail', title: 'Q' }, { id: 'b', rankId: 'quail', kind: 'rank-boss' }, { id: 'old', rankId: 'quail', archived: true }, { id: 'p', rankId: 'pigeon', title: 'P' }],
  projects: [{ id: 'project', rankId: 'goose', title: '作品', chapters: [{ id: 'chapter', title: '章节' }], boss: { id: 'boss' } }]
};

test('周卡两条 adapter 保留课程范围、归档与作品 Boss 差异', () => {
  assert.deepEqual(weekChoices(course, { scope: 'current-rank', rankId: 'quail' }).goals.map(item => item.value), ['level:q', 'level:b']);
  assert.deepEqual(weekChoices(course, { scope: 'current-rank', rankId: 'goose' }).goals.map(item => item.value), ['project-checkpoint:project:chapter', 'project-checkpoint:project:boss']);
  const all = weekChoices(course);
  assert.equal(all.goals.some(item => item.value === 'level:old'), true);
  assert.equal(all.goals.some(item => item.value === 'project-checkpoint:project:boss'), false);
  assert.equal(all.short.some(item => item.value === 'b'), false);
});

test('目标往返保持稳定编号，拒绝不完整或含歧义的编码', () => {
  for (const goal of [{ kind: 'level', id: 'q' }, { kind: 'project-checkpoint', projectId: 'project', id: 'chapter' }]) assert.deepEqual(parseGoal(goalValue(goal)), goal);
  for (const value of ['', 'level:', 'level:q:extra', 'project-checkpoint:project', 'other:q']) assert.throws(() => parseGoal(value), TypeError);
});

test('休息周清空目标、次数与短关卡但保留备注和版本，不修改草稿', () => {
  const model = { course, week: { weekStart: '2026-10-12', revision: 8, learnerId: 'learner' } };
  const draft = { mode: 'rest', playDays: 3, mainGoal: 'level:q', shortLevelId: 'p', note: '休息' };
  const payload = weekPayload(model, draft);
  assert.equal(payload.mainGoal, null); assert.equal(payload.playDays, 0); assert.equal(payload.shortLevelId, '');
  assert.equal(payload.note, '休息'); assert.equal(payload.revision, 8); assert.equal(draft.mainGoal, 'level:q');
  assert.equal(weekPayload(model, { ...draft, mode: 'active' }).mainGoal.id, 'q');
  for (const playDays of [0, 8, 1.5, 'x']) assert.throws(() => weekPayload(model, { ...draft, mode: 'active', playDays }));
});
