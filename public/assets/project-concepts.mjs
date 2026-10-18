export const CONCEPT_STAGE_COUNT = 4;

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

export function normalizeConceptProgress(raw, {
  hasConcept = true,
  checks = [],
  checkIds = checks.map(check => check.id),
  forceComplete = false,
  legacyGuidedStarted = false
} = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const maximumStage = CONCEPT_STAGE_COUNT - 1;
  const stage = clamp(Number.isInteger(source.conceptStage) ? source.conceptStage : 0, 0, maximumStage);
  const reached = clamp(Number.isInteger(source.conceptReached) ? source.conceptReached : stage, stage, maximumStage);
  const validChecks = new Set(checkIds);
  const validOptions = new Map(checks.map(check => [check.id, new Set((check.options || []).map(option => option.id))]));
  const passed = Array.isArray(source.conceptPassedIds)
    ? [...new Set(source.conceptPassedIds.filter(id => validChecks.has(id)))]
    : [];
  const answers = source.conceptAnswers && typeof source.conceptAnswers === 'object' && !Array.isArray(source.conceptAnswers)
    ? Object.fromEntries(Object.entries(source.conceptAnswers).filter(([id, answer]) => validChecks.has(id) && typeof answer === 'string' && (!validOptions.has(id) || validOptions.get(id).has(answer))))
    : {};
  const completed = !hasConcept || forceComplete || source.conceptCompleted === true || legacyGuidedStarted;
  return {
    conceptStage: completed ? maximumStage : stage,
    conceptReached: completed ? maximumStage : reached,
    conceptCompleted: completed,
    conceptAnswers: answers,
    conceptPassedIds: completed ? [...checkIds] : passed,
    conceptFeedback: typeof source.conceptFeedback === 'string' ? source.conceptFeedback : '',
    conceptFeedbackKind: ['success', 'error'].includes(source.conceptFeedbackKind) ? source.conceptFeedbackKind : '',
    conceptFeedbackCheckId: validChecks.has(source.conceptFeedbackCheckId) ? source.conceptFeedbackCheckId : '',
    conceptAwaitingAdvance: source.conceptAwaitingAdvance === true
  };
}

export function pendingConceptCheck(checks, passedIds) {
  const passed = new Set(Array.isArray(passedIds) ? passedIds : []);
  return (Array.isArray(checks) ? checks : []).find(check => !passed.has(check.id)) || null;
}

export function evaluateConceptAnswer(checks, checkId, selectedOptionId) {
  const check = (Array.isArray(checks) ? checks : []).find(item => item.id === checkId);
  if (!check || typeof selectedOptionId !== 'string' || !check.options?.some(option => option.id === selectedOptionId)) {
    return { answered: false, correct: false, explanation: '' };
  }
  return {
    answered: true,
    correct: selectedOptionId === check.correctOptionId,
    explanation: check.explanation || ''
  };
}
