import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONCEPT_STAGE_COUNT,
  evaluateConceptAnswer,
  normalizeConceptProgress,
  pendingConceptCheck
} from '../public/assets/project-concepts.mjs';

const checks = [
  { id: 'frame-owner', options: [{ id: 'terminal', text: '终端' }, { id: 'snapshot', text: '内存快照' }], correctOptionId: 'snapshot', explanation: 'Frame 是一次完整画面的内存快照。' },
  { id: 'frame-submit', options: [{ id: 'whole', text: '整帧提交' }, { id: 'cell', text: '逐格提交' }], correctOptionId: 'whole', explanation: '先在内存完成一帧，再整体提交。' }
];

test('概念进度只保留当前章节的合法答案和已通过题目', () => {
  const progress = normalizeConceptProgress({
    conceptStage: 9,
    conceptReached: -1,
    conceptAnswers: { 'frame-owner': 'snapshot', removed: 'unknown', 'frame-submit': 0 },
    conceptPassedIds: ['frame-owner', 'frame-owner', 'removed'],
    conceptFeedback: '继续想一想',
    conceptFeedbackKind: 'error'
  }, { checks });

  assert.equal(progress.conceptStage, CONCEPT_STAGE_COUNT - 1);
  assert.equal(progress.conceptReached, CONCEPT_STAGE_COUNT - 1);
  assert.deepEqual(progress.conceptAnswers, { 'frame-owner': 'snapshot' });
  assert.deepEqual(progress.conceptPassedIds, ['frame-owner']);
  assert.equal(progress.conceptCompleted, false);
});

test('服务端已完成章节与旧版已开始代码引导会补齐概念门槛', () => {
  const ids = checks.map(check => check.id);
  for (const options of [{ forceComplete: true }, { legacyGuidedStarted: true }, { hasConcept: false }]) {
    const progress = normalizeConceptProgress({}, { checks, checkIds: ids, ...options });
    assert.equal(progress.conceptCompleted, true);
    assert.equal(progress.conceptStage, CONCEPT_STAGE_COUNT - 1);
    assert.deepEqual(progress.conceptPassedIds, ids);
  }
});

test('理解题答错不会推进，全部答对后才没有待完成题', () => {
  assert.deepEqual(evaluateConceptAnswer(checks, 'frame-owner', 'terminal'), {
    answered: true,
    correct: false,
    explanation: checks[0].explanation
  });
  assert.equal(pendingConceptCheck(checks, []), checks[0]);
  assert.equal(pendingConceptCheck(checks, ['frame-owner']), checks[1]);
  assert.equal(evaluateConceptAnswer(checks, 'frame-submit', 'whole').correct, true);
  assert.equal(pendingConceptCheck(checks, checks.map(check => check.id)), null);
});
