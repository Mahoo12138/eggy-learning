import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import {
  RESET_BUTTON_HINT,
  answerKindOf,
  canResetAnswer,
  conceptResetTarget,
  resetActionLabel,
  resetNoticeText
} from '../public/assets/step-answer.mjs';

const choiceStep = {
  id: 'predict',
  type: 'prediction',
  interaction: {
    kind: 'single-choice',
    options: [{ label: '先检查返回值' }, { label: '直接计算' }]
  },
  evaluator: { kind: 'choice', correctOptionId: '0' }
};

const codeStep = {
  id: 'edit',
  type: 'code-edit',
  runtimeId: 'c17-console',
  starterFiles: { 'main.c': '#include <stdio.h>\nint main(void){return 0;}\n' }
};

test('选择题按单选/多选都会判定为可重置的选择题', () => {
  assert.equal(answerKindOf(choiceStep), 'choice');
  assert.equal(answerKindOf({ type: 'prediction', evaluator: { kind: 'choice' } }), 'choice');
  assert.equal(canResetAnswer('choice'), true);
  assert.equal(resetActionLabel('choice'), '清除选择');
});

test('代码题可恢复初始代码，纯观察步骤不可重置', () => {
  assert.equal(answerKindOf(codeStep), 'code');
  assert.equal(canResetAnswer('code'), true);
  assert.equal(resetActionLabel('code'), '恢复初始代码');

  const observeStep = { id: 'run-observe', type: 'run-observe', runtimeId: 'c17-console' };
  assert.equal(answerKindOf(observeStep), 'observe');
  assert.equal(canResetAnswer(answerKindOf(observeStep)), false);
});

test('排序、数值、结构化填写和文字解释都可重置', () => {
  assert.equal(answerKindOf({ type: 'prediction', interaction: { kind: 'reorder' } }), 'reorder');
  assert.equal(answerKindOf({ interaction: { kind: 'number' } }), 'number');
  assert.equal(answerKindOf({ evaluator: { kind: 'object-exact' } }), 'structured');
  assert.equal(answerKindOf({ evaluator: { kind: 'mapping-exact' } }), 'structured');
  assert.equal(answerKindOf({ type: 'explanation' }), 'text');
  assert.equal(answerKindOf({ type: 'prediction', answerPolicy: { minimumCharacters: 12 } }), 'text');
  for (const kind of ['reorder', 'number', 'structured', 'text']) assert.equal(canResetAnswer(kind), true);
});

test('概念理解题只在已作答（通常是答错）后开放清除选择', () => {
  const module = { checks: [{ id: 'c1', options: [] }, { id: 'c2', options: [] }] };
  const base = { conceptStage: 3, conceptCompleted: false, conceptAnswers: {}, conceptPassedIds: [] };
  // 未作答时仍返回当前题，但 answered 为 false，由调用方决定是否显示按钮。
  assert.deepEqual(conceptResetTarget(module, base), { checkId: 'c1', answered: false });
  assert.deepEqual(conceptResetTarget(module, { ...base, conceptAnswers: { c1: 'a' } }), { checkId: 'c1', answered: true });
  assert.equal(conceptResetTarget(module, { ...base, conceptStage: 1, conceptAnswers: { c1: 'a' } }), null, '理解题只在最后一级出现');
  assert.equal(conceptResetTarget(module, { ...base, conceptCompleted: true, conceptAnswers: { c1: 'a' } }), null);
  assert.equal(conceptResetTarget(module, { ...base, conceptAwaitingAdvance: true, conceptAnswers: { c1: 'a' } }), null, '答对后应等待进入下一题');
  assert.equal(conceptResetTarget(module, { ...base, conceptAnswers: { c1: 'a', c2: 'b' }, conceptPassedIds: ['c1', 'c2'] }), null);
  assert.equal(resetActionLabel('concept-choice'), '清除选择');
  assert.equal(canResetAnswer('concept-choice'), false, '概念题不参与关卡答题的通用判定');
  assert.equal(conceptResetTarget(null, base), null);
});

test('体验步骤、缺失步骤与作品章节本身不提供重置', () => {
  assert.equal(answerKindOf({ id: 'watch', type: 'scene' }), 'experience');
  assert.equal(canResetAnswer('experience'), false);
  assert.equal(answerKindOf(undefined), null);
  assert.equal(canResetAnswer(answerKindOf(undefined)), false);
  assert.equal(answerKindOf(codeStep, 'project'), 'project');
  assert.equal(canResetAnswer(answerKindOf(codeStep, 'project')), false);
});

test('每种可重置题型都有对应的按钮文案与完成提示', () => {
  assert.match(RESET_BUTTON_HINT, /检查记录不会改变/);
  for (const kind of ['reorder', 'choice', 'number', 'structured', 'code', 'text']) {
    assert.notEqual(resetActionLabel(kind), '重置本题', `${kind} 应有专属文案`);
    assert.ok(resetNoticeText(kind).length >= 6);
  }
  assert.equal(resetActionLabel('unknown'), '重置本题');
  assert.equal(canResetAnswer('unknown'), false);
});

test('课程数据中的每一步都能被归类，且写代码步骤全部可重置', async () => {
  const files = [];
  for await (const path of glob('data/levels/*.json')) files.push(path);
  assert.ok(files.length > 0, '应当能读到关卡数据');
  let codeSteps = 0;
  for (const path of files) {
    const level = JSON.parse(await readFile(path, 'utf8'));
    for (const step of level.steps || []) {
      const kind = answerKindOf(step, level.activityType === 'project' ? 'project' : 'level');
      assert.ok(kind, `${path} 的 ${step.id} 无法归类`);
      // 纯观察步骤只读，命令练习区可写；两者都由 stepType 区分而不是 runtimeId。
      if (step.runtimeId === 'linux-shell-sim') {
        assert.equal(kind, step.type === 'run-observe' ? 'observe' : 'code', `${step.id} 的命令区类型应与 stepType 一致`);
        assert.equal(canResetAnswer(kind), step.type !== 'run-observe');
      }
      if (step.starterFiles && step.type !== 'run-observe') {
        assert.equal(kind, 'code', `${step.id} 带有起始代码，应判定为代码题`);
        codeSteps += 1;
      }
    }
  }
  assert.ok(codeSteps > 0, '题库中应存在可编辑的代码步骤');
});
