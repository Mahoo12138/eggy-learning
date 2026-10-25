// Single source of truth for how a play step collects an answer.
// `renderInteraction` dispatches on these kinds, and the reset control decides
// whether a step can go back to its initial state from the same classification.
import { CONCEPT_STAGE_COUNT, pendingConceptCheck } from './project-concepts.mjs';

const CODE_STEP_TYPES = ['run-observe', 'run', 'code-edit', 'guided-edit', 'code-repair', 'independent-variation', 'independent-transfer', 'variation', 'boss'];
const TEXT_STEP_TYPES = ['explanation', 'explain', 'text', 'reflection'];

const RESETTABLE_KINDS = new Set(['reorder', 'choice', 'number', 'structured', 'code', 'text']);

const ACTION_LABELS = {
  reorder: '恢复初始顺序',
  choice: '清除选择',
  number: '清除数值',
  structured: '清空填写',
  code: '恢复初始代码',
  text: '清空重填',
  'concept-choice': '清除选择'
};

const DONE_NOTICES = {
  reorder: '顺序已回到初始位置，可以重新排列。',
  choice: '已清除选择，可以重新作答。',
  number: '已清除预测的数值。',
  structured: '已清空填写的内容。',
  code: '代码已恢复为初始版本。',
  text: '已清空写下的内容。',
  'concept-choice': '已清除这一题的选择，可以重新作答。'
};

export const RESET_BUTTON_HINT = '清除这一步的作答并回到初始状态，服务端已保存的检查记录不会改变。';

export function stepTypeOf(step) {
  return step?.type || step?.kind || step?.interaction?.kind || 'scene';
}

export function isCodeStep(step) {
  return CODE_STEP_TYPES.includes(stepTypeOf(step)) || Boolean(step?.runtimeId);
}

/**
 * Classify a step the same way the renderer does.
 * `observe` and `experience` render fixed content, so neither holds an editable answer.
 */
export function answerKindOf(step, mode = 'level') {
  if (mode === 'project') return 'project';
  if (!step) return null;
  const interaction = step.interaction?.kind || step.interaction?.type;
  const evaluator = step.evaluator?.kind;
  if (interaction === 'reorder' || evaluator === 'exact-order') return 'reorder';
  if (interaction === 'choice' || interaction === 'single-choice' || evaluator === 'choice') return 'choice';
  if (interaction === 'number' || evaluator === 'number-exact') return 'number';
  if (evaluator === 'object-exact' || evaluator === 'mapping-exact') return 'structured';
  if (isCodeStep(step)) return stepTypeOf(step) === 'run-observe' ? 'observe' : 'code';
  if (TEXT_STEP_TYPES.includes(stepTypeOf(step)) || step.answerPolicy) return 'text';
  return 'experience';
}

export function canResetAnswer(kind) {
  return RESETTABLE_KINDS.has(kind);
}

/**
 * 作品项目的概念理解题：只在最后一级出现，答对后等着看下一题或进入代码。
 * 这两种状态下屏幕上没有“已提交但想改”的选择，因此不提供重置。
 */
export function conceptResetTarget(module, progress) {
  if (!module?.checks?.length || !progress || progress.conceptCompleted) return null;
  if (progress.conceptStage !== CONCEPT_STAGE_COUNT - 1) return null;
  if (progress.conceptAwaitingAdvance) return null;
  const check = pendingConceptCheck(module.checks, progress.conceptPassedIds || []);
  if (!check) return null;
  return { checkId: check.id, answered: Boolean(progress.conceptAnswers?.[check.id]) };
}

export function resetActionLabel(kind) {
  return ACTION_LABELS[kind] || '重置本题';
}

export function resetNoticeText(kind) {
  return DONE_NOTICES[kind] || '这一步已回到初始状态。';
}
