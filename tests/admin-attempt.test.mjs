import assert from 'node:assert/strict';
import test from 'node:test';
import { attemptPassed, attemptView, completedActivityCount, mergeAttempts } from '../public/assets/admin-attempt.mjs';

const course = {
  projects: [{
    id: 'canteen', title: '蛋仔食堂', boss: { id: 'canteen-boss' }, chapters: [{
      id: 'terminal-session', title: '借用终端', conceptModule: { checks: [{
        id: 'identify-vt', question: 'VT 序列是什么？',
        options: [{ id: 'terminal-command-text', text: '终端控制字符序列' }, { id: 'bitmap', text: '屏幕位图' }],
        correctOptionId: 'terminal-command-text', explanation: 'VT 仍是输出字符，由终端解释成控制命令。'
      }] }
    }]
  }]
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

test('concept attempts resolve project, chapter, question, selected option and explanation', () => {
  const base = {
    id: 'concept-1', kind: 'project-concept', submittedAt: '2026-10-15T02:03:04.000Z',
    payload: { projectId: 'canteen', chapterId: 'terminal-session', checkId: 'identify-vt', selectedOptionId: 'terminal-command-text' },
    result: { passed: true }
  };
  const passed = attemptView(base, course);
  assert.equal(passed.title, '蛋仔食堂');
  assert.equal(passed.step, '借用终端 · VT 序列是什么？');
  assert.equal(passed.answer, '终端控制字符序列');
  assert.equal(passed.feedback, 'VT 仍是输出字符，由终端解释成控制命令。');
  assert.equal(passed.statusLabel, '理解通过');

  const failed = attemptView({ ...base, result: { passed: false } }, course);
  assert.equal(failed.statusLabel, '需要重看');
});

test('concept attempts merge chronologically without becoming completed activities', () => {
  const progress = {
    attempts: [{ id: 'level-1', kind: 'level', submittedAt: '2026-10-15T02:00:00.000Z', payload: { levelId: 'lesson-1' }, result: { levelCompleted: true } }],
    conceptAttempts: [
      { id: 'concept-2', submittedAt: '2026-10-15T02:02:00.000Z', payload: { projectId: 'canteen' }, result: { passed: true } },
      { id: 'concept-1', submittedAt: '2026-10-15T02:01:00.000Z', payload: { projectId: 'canteen' }, result: { passed: false } }
    ]
  };
  const records = mergeAttempts(progress);
  assert.deepEqual(records.map(item => item.id), ['level-1', 'concept-1', 'concept-2']);
  assert.deepEqual(records.map(item => item.kind), ['level', 'project-concept', 'project-concept']);
  assert.equal(completedActivityCount(records), 1);
});
