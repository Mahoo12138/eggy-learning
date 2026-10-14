import assert from 'node:assert/strict';
import test from 'node:test';
import { attemptPassed } from '../public/assets/admin-attempt.mjs';

const course = {
  projects: [{ id: 'canteen', boss: { id: 'canteen-boss' } }]
};

test('a project Boss is passed only when the server completed it', () => {
  const failed = {
    payload: { projectId: 'canteen', checkpointId: 'canteen-boss', passed: true, performancePoints: 59 },
    result: { checkpointCompleted: false, levelCompleted: false }
  };
  const passed = {
    payload: { projectId: 'canteen', checkpointId: 'canteen-boss', passed: true, performancePoints: 85 },
    result: { checkpointCompleted: true, levelCompleted: true }
  };
  assert.equal(attemptPassed(failed, course), false);
  assert.equal(attemptPassed(passed, course), true);
});

test('ordinary level grades and project chapter self-checks keep their existing status', () => {
  assert.equal(attemptPassed({ payload: { levelId: 'lesson', passed: true }, result: {} }, course), true);
  assert.equal(attemptPassed({ payload: { projectId: 'canteen', checkpointId: 'chapter-1', passed: true }, result: {} }, course), true);
  assert.equal(attemptPassed({ payload: { projectId: 'canteen', checkpointId: 'chapter-1', passed: false }, result: { checkpointCompleted: true } }, course), true);
});
