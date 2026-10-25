import './components/code.mjs';
import './components/notice.mjs';
import './components/comfort-controls.mjs';
import { createCoursePreviewSession, previewAttemptBody } from './course-preview-session.mjs';
import {
  CONCEPT_STAGE_COUNT,
  evaluateConceptAnswer,
  normalizeConceptProgress,
  pendingConceptCheck
} from './project-concepts.mjs';
import { gpioInputState, gpioOutputState } from './gpio-concept-lab.mjs';
import {
  childLifecycleState,
  execState,
  forkCowState,
  monotonicDeadlineState,
  pipeEofState,
  pollReadyState,
  processGroupKillState,
  syscallState
} from './os-concept-lab.mjs';
import { chapterCodeReady, codeDeliveryMode, codeState, finalSourceModel, guidedCodeModel, snapshotCodeModel, starterProjectModel, matchingCodePackage } from './project-code-delivery.mjs';
import { createProjectStateZip, downloadProjectStateZip } from './project-code-zip.mjs';
import { answerKindOf, canResetAnswer, conceptResetTarget, resetActionLabel, resetNoticeText, RESET_BUTTON_HINT } from './step-answer.mjs';
import {
  $, $$, buildAIContext, copyText, esc, makeRequestId,
  playTone, rankBlueprint, requestJSON
} from './park-ui.mjs';

const params = new URLSearchParams(location.search);
const levelId = params.get('level') || '';
const masteryPractice = params.get('practice') === 'mastery';
const previewRequested = params.get('preview') === 'workshop';
const embeddedPreview = previewRequested && window.parent !== window;
let previewSession = null;
let previewRevision = 0;
const state = {
  phase: 'loading',
  mode: 'level',
  payload: null,
  level: null,
  progress: null,
  completedStepIds: [],
  activityCompleted: false,
  index: 0,
  answers: new Map(),
  orders: new Map(),
  variantAssignments: new Map(),
  hintLevels: new Map(),
  viewedFullAnswer: new Set(),
  revealedSolutions: new Map(),
  pendingRequests: new Map(),
  guidedProgress: new Map(),
  gpioConceptLabs: new Map(),
  osConceptLabs: new Map(),
  codePackage: null,
  codePackageStatus: 'idle',
  codePackageError: '',
  feedback: null,
  lastResult: null,
  submitting: false,
};

function postPreviewMessage(message) {
  if (embeddedPreview) window.parent.postMessage(message, location.origin);
}

function reportPreviewState() {
  if (!previewSession) return;
  postPreviewMessage({
    type: 'eggy-preview-state', activityId: state.level.id, mode: state.mode,
    index: state.index, title: state.level.title, submitting: state.submitting,
    steps: steps().map(step => ({ id: step.id, title: step.title || KIND_LABELS[stepType(step)] || step.id, type: stepType(step) }))
  });
}

function rememberPreviewAnswer() {
  const step = currentStep();
  if (step && (state.mode !== 'project' || $('#project-evidence'))) state.answers.set(step.id, readAnswer(step));
}

function selectPreviewStep(index) {
  if (!previewSession || !Number.isInteger(index) || index < 0 || index >= steps().length) return;
  rememberPreviewAnswer();
  previewRevision += 1;
  state.submitting = false;
  state.lastResult = null;
  state.index = index;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  renderStep();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function loadPreview(message) {
  // Invalidate the old session even when the new draft cannot be constructed.
  // Its pending code-package request must never overwrite the new error view.
  previewRevision += 1;
  previewSession = null;
  const session = createCoursePreviewSession(message.course, message.mode, message.activityId);
  previewSession = session;
  state.mode = session.mode;
  state.payload = session.payload;
  state.level = session.level;
  state.progress = {};
  state.completedStepIds = [];
  state.activityCompleted = false;
  state.codePackage = null;
  state.codePackageStatus = session.level?.codeDelivery ? 'loading' : 'idle';
  state.codePackageError = '';
  state.index = 0;
  for (const name of ['answers', 'orders', 'variantAssignments', 'hintLevels', 'viewedFullAnswer', 'revealedSolutions', 'pendingRequests', 'guidedProgress']) state[name].clear();
  state.feedback = null;
  state.lastResult = null;
  state.submitting = false;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  if (!steps().length) {
    setPhase('empty');
    reportPreviewState();
    return;
  }
  restoreState();
  // Preview always opens at the first authored step, independently of learner progress.
  state.index = 0;
  setPhase('ready');
  renderStep();
  if (session.level?.codeDelivery) void loadPreviewCodePackage(session);
}

async function loadPreviewCodePackage(session) {
  try {
    const response = await requestJSON(`/api/play/projects/${encodeURIComponent(session.activityId)}/code-package`);
    if (previewSession !== session) return;
    state.codePackage = matchingCodePackage(session.level, response.data);
    state.codePackageStatus = 'ready';
  } catch (error) {
    if (previewSession !== session) return;
    state.codePackageStatus = 'error';
    state.codePackageError = error.message;
  }
  rememberPreviewAnswer();
  renderStep();
}


const KIND_LABELS = {
  scene: '观察示例',
  experience: '观察示例',
  prediction: '先做预测',
  predict: '先做预测',
  'run-observe': '运行与观察',
  run: '运行与观察',
  observe: '观察结果',
  explanation: '说清原因',
  explain: '说清原因',
  'code-edit': '引导修改',
  'guided-edit': '引导修改',
  'code-repair': '故障修复',
  'independent-variation': '独立变式',
  'independent-transfer': '独立迁移',
  variation: '独立变式',
  boss: 'Boss 综合挑战',
  'project-chapter': '作品章节',
  'project-boss': 'Boss 综合挑战'
};

function steps() {
  if (state.mode === 'project') return [...(state.level?.chapters || []), ...(state.level?.boss ? [state.level.boss] : [])];
  return state.level?.steps || state.level?.checkpoints || [];
}
function currentStep() { return steps()[state.index] || null; }
function progressCurrent() { return state.progress?.current || {}; }
function attempts() { return state.progress?.attempts || state.payload?.attempts || []; }

function isProjectBoss(step) { return state.mode === 'project' && step?.id === state.level?.boss?.id; }
function stepType(step) { return isProjectBoss(step) ? 'project-boss' : state.mode === 'project' ? 'project-chapter' : step?.type || step?.kind || step?.interaction?.kind || 'scene'; }
function isCodeStep(step) { return ['run-observe', 'run', 'code-edit', 'guided-edit', 'code-repair', 'independent-variation', 'independent-transfer', 'variation', 'boss'].includes(stepType(step)) || !!step?.runtimeId; }
function isTerminalStep(step) { return step?.runtimeId === 'linux-shell-sim'; }
function isIndependent(step) { return ['independent-variation', 'independent-transfer', 'variation'].includes(stepType(step)); }

function levelAttemptPayloads(step) {
  return attempts().map(attempt => attempt.payload || attempt).filter(payload => payload.levelId === state.level?.id
    && payload.contentVersion === state.level?.version
    && payload.stepId === step?.id);
}

function exposedVariantIds(step) {
  return new Set(levelAttemptPayloads(step).filter(payload => payload.viewedFullAnswer === true).map(payload => payload.variantId).filter(Boolean));
}

function selectedVariant(step = currentStep()) {
  if (!step) return null;
  const variants = step.variants || state.level?.variations || [];
  const assignedId = state.variantAssignments.get(step.id) || progressCurrent().variantId || state.progress?.assignedVariantId || state.payload?.variantId;
  if (assignedId) return variants.find(variant => variant.id === assignedId) || variants[0] || null;
  if (stepType(step) === 'independent-variation') {
    const exposed = exposedVariantIds(step);
    return variants.find(variant => !exposed.has(variant.id)) || variants.at(-1) || null;
  }
  return variants[0] || null;
}

function starterCode(step = currentStep()) {
  const variant = selectedVariant(step);
  const files = variant?.starterFiles || step?.starterFiles || step?.files || {};
  return files['main.c'] ?? files['main.cpp'] ?? Object.values(files)[0] ?? step?.starterCode ?? '';
}

function hintEntries(step = currentStep()) {
  return (step?.hints || step?.hintLadder || []).map((hint, index) => typeof hint === 'string' ? { tier: index + 1, text: hint } : { tier: hint.tier || index + 1, text: hint.text || hint.prompt || '' });
}

function canReplaceRevealedVariant(step = currentStep()) {
  const variants = step?.variants || [];
  const current = selectedVariant(step);
  const exposed = exposedVariantIds(step);
  return stepType(step) === 'independent-variation'
    && variants.length >= 2
    && current
    && variants.some(variant => variant.id !== current.id && !exposed.has(variant.id));
}

function solutionKey(step = currentStep(), variant = selectedVariant(step)) {
  return `${step?.id || ''}:${variant?.id || ''}`;
}

function fullSolution(step = currentStep()) {
  const variant = selectedVariant(step);
  const revealed = state.revealedSolutions.get(solutionKey(step, variant));
  if (revealed) return revealed;
  if (isIndependent(step)) return '';
  const value = variant?.fullSolution || variant?.solution || step?.fullSolution || step?.fullAnswer;
  const authored = typeof value === 'string' ? value : value?.text || '';
  if (authored) return authored;
  if (!variant || !step?.fullSolutionPolicy || !canReplaceRevealedVariant(step)) return '';
  const grader = variant.grader || step.grader;
  if (grader?.kind === 'stdout-exact') return `完整校验条件：输出需要与下面内容完全一致（包括顺序与换行）：\n${grader.expected}`;
  if (grader?.kind === 'stdin-stdout-cases') return `完整校验条件：\n${grader.cases.map((testCase, index) => `用例 ${index + 1}\n输入：\n${testCase.stdin || '（无）'}\n目标输出：\n${testCase.stdout}`).join('\n\n')}`;
  return '';
}

function hasFullSolution(step = currentStep()) {
  const variant = selectedVariant(step);
  if (isIndependent(step)) {
    return Boolean(state.revealedSolutions.get(solutionKey(step, variant))) || variant?.fullSolutionAvailable === true;
  }
  return Boolean(fullSolution(step));
}

function fullSolutionLabel(step = currentStep()) {
  const variant = selectedVariant(step);
  return variant?.fullSolutionKind === 'grader' ? '查看完整校验条件' : isCodeStep(step) ? '查看完整代码' : '查看完整思路';
}

function priorAttempt(stepId, variantId = '') {
  const matching = attempts().filter(attempt => {
    const payload = attempt.payload || attempt;
    if (payload.contentVersion !== state.level?.version) return false;
    return state.mode === 'project'
      ? payload.projectId === state.level?.id && payload.checkpointId === stepId
      : payload.levelId === state.level?.id && payload.stepId === stepId && (!variantId || payload.variantId === variantId);
  }).at(-1);
  return matching ? { ...matching, ...(matching.payload || {}) } : null;
}

function restoreState() {
  for (const step of steps()) {
    const variant = selectedVariant(step);
    if (variant && stepType(step) === 'independent-variation') state.variantAssignments.set(step.id, variant.id);
    const prior = priorAttempt(step.id, variant?.id || '');
    const saved = state.mode === 'project' && prior ? { evidence: prior.evidence || '', passed: prior.passed === true, independent: prior.independent === true, performancePoints: prior.performancePoints || 0 } : prior?.answer;
    if (saved !== undefined) {
      let answer = saved;
      if (((step.interaction?.kind || step.interaction?.type) === 'reorder' || step.evaluator?.kind === 'exact-order') && typeof answer === 'string') {
        try { answer = JSON.parse(answer); } catch {}
      }
      state.answers.set(step.id, answer);
    }
    if (prior?.hintLevel) state.hintLevels.set(step.id, prior.hintLevel);
    if (prior?.viewedFullAnswer) state.viewedFullAnswer.add(step.id);
  }
  const hasCurrentVersionAttempt = attempts().some(attempt => {
    const payload = attempt.payload || attempt;
    return (payload.levelId === state.level?.id || payload.projectId === state.level?.id)
      && payload.contentVersion === state.level?.version;
  });
  const currentMatches = progressCurrent().activityId === state.level?.id
    && (state.mode === 'project' || hasCurrentVersionAttempt);
  const id = currentMatches ? (progressCurrent().stepId || state.progress?.currentStepId || state.progress?.stepId) : '';
  const index = steps().findIndex(step => step.id === id);
  const artifact = state.mode === 'project' ? (state.progress?.projectArtifacts || []).find(item => item.projectId === state.level?.id) : null;
  const completedCount = state.mode === 'project'
    ? (artifact?.completedChapterIds?.length || 0) + (artifact?.bossCompletedAt ? 1 : 0)
    : state.completedStepIds.length;
  state.index = index >= 0 ? index : Math.min(completedCount, Math.max(steps().length - 1, 0));
  if (masteryPractice && state.mode === 'level') {
    const independentIndex = steps().findIndex(step => step.type === 'independent-variation');
    if (independentIndex >= 0) state.index = independentIndex;
  }
}

function setPhase(phase, message = '') {
  state.phase = phase;
  $('#play-loading').hidden = phase !== 'loading';
  $('#play-error').hidden = phase !== 'error';
  $('#play-empty').hidden = phase !== 'empty';
  $('#play-view').hidden = phase !== 'ready';
  if (message) $('#play-error-message').textContent = message;
}

function showNotice(message, kind = 'info') { $('#play-notice').show(message, { kind }); }

function rankInfo() {
  const supplied = state.payload?.rank || state.level?.rank;
  const fallback = rankBlueprint(state.level?.rankId);
  return {
    name: supplied?.title || supplied?.name || fallback?.name,
    building: state.payload?.location?.title || state.payload?.locations?.map(location => location.title || location.name).filter(Boolean).join(' · ') || state.payload?.building?.name || state.level?.scene?.locationTitle || fallback?.building
  };
}

function sceneArtwork() {
  if (state.level?.rankId === 'invincible-phoenix') {
    return { src: '/assets/park/views/island-overhead.png', position: '50% 50%' };
  }
  const location = state.level?.scene?.locationId || state.level?.locationId || state.level?.locationIds?.[0];
  const scenes = {
    'central-fountain': ['island-plaza-to-wheel.png', '50% 48%'],
    'ferris-wheel': ['island-plaza-to-wheel.png', '50% 22%'],
    'snow-bakery': ['island-front-right.png', '47% 70%'],
    'milk-tea-shop': ['island-front-right.png', '70% 43%'],
    'blind-box-store': ['island-front-right.png', '65% 35%'],
    'makeover-shop': ['island-front-right.png', '70% 43%'],
    arcade: ['island-front-left.png', '30% 38%'],
    mall: ['island-front-left.png', '30% 38%'],
    'eggy-park': ['island-overhead.png', '42% 52%'],
    'football-field': ['island-overhead.png', '50% 50%'],
    'piano-carpet': ['island-overhead.png', '50% 50%']
  };
  const [file, position] = scenes[location] || ['island-overhead.png', '50% 50%'];
  return { src: `/assets/park/views/${file}`, position };
}

function renderChrome() {
  const total = steps().length;
  const progress = total ? (state.index + 1) / total * 100 : 0;
  $('#top-level-title').textContent = state.level?.title || '未命名关卡';
  $('#top-step-count').textContent = `第 ${Math.min(state.index + 1, total)} 步 / 共 ${total} 步`;
  $('#play-progress-bar').style.width = `${progress}%`;
  document.title = `${state.level?.title || '游玩关卡'} · 蛋仔编程乐园`;
}

function renderReorder(step) {
  const expected = step.evaluator?.kind === 'exact-order' ? step.evaluator.expected || [] : [];
  const items = step.interaction?.items || step.items || (expected.length > 1 ? [...expected.slice(1), expected[0]] : expected);
  if (!state.orders.has(step.id)) {
    const previous = state.answers.get(step.id);
    state.orders.set(step.id, Array.isArray(previous) ? [...previous] : [...items]);
  }
  const order = state.orders.get(step.id);
  $('#interaction-root').innerHTML = `<div class="reorder-list" aria-label="调整顺序">${order.map((item, index) => `<div class="reorder-item"><span>${index + 1}</span><code>${esc(typeof item === 'string' ? item : item.label || item.text || item.id)}</code><div class="reorder-tools"><button type="button" data-move="-1" data-index="${index}" aria-label="向上移动"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" data-move="1" data-index="${index}" aria-label="向下移动"${index === order.length - 1 ? ' disabled' : ''}>↓</button></div></div>`).join('')}</div>`;
}

function renderChoice(step) {
  const options = step.interaction?.options || step.options || [];
  const previous = state.answers.get(step.id);
  $('#interaction-root').innerHTML = `<div class="choice-list">${options.map((option, index) => {
    const value = String(index);
    const label = typeof option === 'string' ? option : option.label ?? option.text ?? option.value ?? option.id ?? value;
    return `<label class="choice-option"><input type="radio" name="step-choice" value="${value}"${String(previous) === value ? ' checked' : ''}><span>${esc(label)}</span></label>`;
  }).join('')}</div>`;
}

function renderNumber(step) {
  const interaction = step.interaction || {};
  const previous = state.answers.get(step.id);
  $('#interaction-root').innerHTML = `<label class="number-answer" for="number-answer"><span>你的数值</span><input id="number-answer" type="number" inputmode="numeric"${Number.isFinite(interaction.min) ? ` min="${interaction.min}"` : ''}${Number.isFinite(interaction.max) ? ` max="${interaction.max}"` : ''} step="1" value="${esc(previous ?? '')}"></label>`;
}

function renderStructured(step) {
  const expected = step.evaluator?.expected || {};
  const kind = step.evaluator?.kind;
  let previous = state.answers.get(step.id) || {};
  if (typeof previous === 'string') { try { previous = JSON.parse(previous); } catch { previous = {}; } }
  $('#interaction-root').innerHTML = `<div class="structured-answer" data-answer-kind="${esc(kind)}">${Object.keys(expected).map(key => `<label><span>${kind === 'mapping-exact' ? `输入 ${esc(key)}` : esc(key)}</span><input data-answer-key="${esc(key)}" ${kind === 'object-exact' ? 'type="number" inputmode="numeric"' : 'type="text"'} value="${esc(previous?.[key] ?? '')}"></label>`).join('')}</div>`;
}

function renderCode(step) {
  const previous = state.answers.get(step.id);
  const previousCode = typeof previous === 'string' ? previous : previous?.files ? Object.values(previous.files)[0] : '';
  const observeOnly = stepType(step) === 'run-observe';
  const code = observeOnly ? starterCode(step) : previous !== undefined ? previousCode : starterCode(step);
  const terminal = isTerminalStep(step);
  const language = terminal ? 'bash' : step.starterFiles?.['main.cpp'] !== undefined || selectedVariant(step)?.starterFiles?.['main.cpp'] !== undefined ? 'cpp' : 'c';
  const label = terminal ? (observeOnly ? '固定示例命令，本步只观察' : '当前命令') : (observeOnly ? '固定示例代码，本步只观察' : '当前代码');
  const note = terminal
    ? '这里运行的是隔离的虚拟 Linux 终端，只改变练习文件系统，不会执行本机命令。'
    : '这一步运行固定示例，先观察结果；可编辑练习会在后面的步骤出现。';
  $('#interaction-root').innerHTML = `<label for="code-answer" class="visually-hidden">${label}</label><eggy-code language="${language}"><textarea id="code-answer" class="code-editor" data-language="${language}" spellcheck="false" autocapitalize="off" autocomplete="off"${observeOnly ? ' readonly aria-readonly="true"' : ''}>${esc(code)}</textarea></eggy-code>${observeOnly || terminal ? `<p class="observe-note">${esc(note)}</p>` : ''}`;
}

function renderText(step) {
  const previous = state.answers.get(step.id);
  const value = typeof previous === 'string' ? previous : previous?.text || '';
  const minimum = step.answerPolicy?.minimumCharacters;
  $('#interaction-root').innerHTML = `<label for="text-answer" class="visually-hidden">你的解释</label><textarea id="text-answer" class="step-textarea"${minimum ? ` minlength="${minimum}"` : ''} placeholder="先用自己的话解释，不用追求标准句式。">${esc(value)}</textarea>`;
}

function renderExperience(step) {
  $('#interaction-root').innerHTML = `<div class="experience-action"><span aria-hidden="true">▶</span><p>${esc(step.actionText || '运行示例后，先记录实际输出和变量变化，再解释原因。')}</p></div>`;
}

function projectProgressState() {
  const artifact = (state.progress?.projectArtifacts || []).find(item => item.projectId === state.level?.id) || {};
  const completed = new Set(artifact.completedChapterIds || []);
  const starred = new Set((state.progress?.awardLedger || []).filter(item => item.kind === 'star' && item.activityId === state.level?.id).map(item => item.sourceId));
  return { artifact, completed, starred };
}

function projectNavigation(step) {
  const { artifact, completed, starred } = projectProgressState();
  const chapters = state.level.chapters || [];
  const missingStars = chapters.filter(chapter => completed.has(chapter.id) && !starred.has(chapter.id));
  const allChaptersComplete = chapters.every(chapter => completed.has(chapter.id));
  const allChapterStars = chapters.every(chapter => starred.has(chapter.id));
  const promotion = state.payload?.rank?.promotion || {};
  const rankStars = (state.progress?.awardLedger || []).filter(item => item.kind === 'star' && item.rankId === state.level?.rankId).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const starRequirementMet = promotion.metric !== 'stars'
    || (Number.isFinite(promotion.requiredStars) ? rankStars >= promotion.requiredStars : allChapterStars);
  const entries = [...chapters, state.level.boss].filter(Boolean);
  return `<nav class="project-step-nav" aria-label="作品章节导航"><div class="project-step-nav-head"><strong>作品进度</strong><span>${completed.size} / ${chapters.length} 章已自检</span></div><div class="project-step-tabs">${entries.map((entry, index) => {
    const boss = entry.id === state.level.boss?.id;
    const priorComplete = chapters.slice(0, index).every(chapter => completed.has(chapter.id));
    const unlocked = previewSession || (boss ? allChaptersComplete && starRequirementMet : priorComplete || completed.has(entry.id));
    const status = previewSession ? '可预览' : boss ? artifact.bossCompletedAt ? '已通关' : unlocked ? '已解锁' : '待解锁' : starred.has(entry.id) ? '已获星' : completed.has(entry.id) ? '可补星' : unlocked ? '可进入' : '待解锁';
    return `<button type="button" data-project-index="${index}" data-status="${esc(status)}"${unlocked ? '' : ' disabled'}${entry.id === step.id ? ' aria-current="step"' : ''}><span>${boss ? 'B' : index + 1}</span><strong>${esc(entry.title)}</strong><small>${esc(status)}</small></button>`;
  }).join('')}</div>${missingStars.length ? `<p class="project-revisit-note">已完成但尚未获星：${missingStars.map(chapter => esc(chapter.title)).join('、')}。可直接回访这些章节，独立复查后补星。</p>` : ''}</nav>`;
}

function selectProjectStep(index) {
  if (state.mode !== 'project' || !Number.isInteger(index) || index < 0 || index >= steps().length || index === state.index) return;
  if (previewSession) { selectPreviewStep(index); return; }
  const target = $(`[data-project-index="${index}"]`, $('#interaction-root'));
  if (!target || target.disabled) return;
  const active = currentStep();
  if (active) state.answers.set(active.id, readAnswer(active));
  state.index = index;
  state.lastResult = null;
  renderStep();
  window.scrollTo({ top: 0, behavior: document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth' });
}

function guidedProgressKey(step) {
  return `eggy-guided:${state.level?.id || ''}:${state.level?.version || 1}:${step.id}`;
}

function projectGuidedProgress(step) {
  const lastIndex = Math.max((step.guidedSteps?.length || 1) - 1, 0);
  const serverCompleted = projectProgressState().completed.has(step.id);
  const conceptChecks = step.conceptModule?.checks || [];
  const serverConceptAttempts = (state.progress?.conceptAttempts || state.payload?.conceptAttempts || []).filter(attempt => attempt.payload?.projectId === state.level?.id
    && attempt.payload?.contentVersion === state.level?.version
    && attempt.payload?.chapterId === step.id);
  const serverPassedIds = [...new Set(serverConceptAttempts.filter(attempt => attempt.result?.passed).map(attempt => attempt.payload.checkId))];
  const serverAnswers = Object.fromEntries(serverConceptAttempts.map(attempt => [attempt.payload.checkId, attempt.payload.selectedOptionId]));
  const allConceptChecksPassed = conceptChecks.length > 0 && conceptChecks.every(check => serverPassedIds.includes(check.id));
  const key = guidedProgressKey(step);
  if (!state.guidedProgress.has(key)) {
    let stored = {};
    if (!previewSession) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
      } catch {}
    }
    const index = Math.min(Math.max(Number.isInteger(stored.index) ? stored.index : 0, 0), lastIndex);
    const reached = Math.min(Math.max(Number.isInteger(stored.reached) ? stored.reached : index, index), lastIndex);
    const concept = normalizeConceptProgress(stored, {
      hasConcept: Boolean(step.conceptModule),
      checks: conceptChecks,
      forceComplete: serverCompleted || allConceptChecksPassed,
      legacyGuidedStarted: !Object.hasOwn(stored, 'conceptCompleted') && (stored.completed === true || reached > 0)
    });
    concept.conceptPassedIds = [...new Set([...concept.conceptPassedIds, ...serverPassedIds])];
    concept.conceptAnswers = { ...concept.conceptAnswers, ...serverAnswers };
    state.guidedProgress.set(key, {
      index: serverCompleted ? lastIndex : index,
      reached: previewSession || serverCompleted ? lastIndex : reached,
      completed: serverCompleted || stored.completed === true,
      ...concept
    });
  }
  const progress = state.guidedProgress.get(key);
  if (serverCompleted) {
    progress.index = Math.min(progress.index, lastIndex);
    progress.reached = lastIndex;
    progress.completed = true;
    Object.assign(progress, normalizeConceptProgress(progress, {
      hasConcept: Boolean(step.conceptModule),
      checks: conceptChecks,
      forceComplete: true
    }));
  }
  return progress;
}

function saveGuidedProgress(step, progress) {
  const key = guidedProgressKey(step);
  state.guidedProgress.set(key, progress);
  if (!previewSession) {
    try { localStorage.setItem(key, JSON.stringify(progress)); } catch {}
  }
}

function projectScenePrompt(step) {
  if (isProjectBoss(step)) return '项目 Boss 已就绪，先按阶段留下可复现证据。';
  if (step?.guidedSteps?.length) {
    const progress = projectGuidedProgress(step);
    if (step.conceptModule && !progress.conceptCompleted) {
      const pending = pendingConceptCheck(step.conceptModule.checks, progress.conceptPassedIds);
      const feedbackCheck = step.conceptModule.checks.find(check => check.id === progress.conceptFeedbackCheckId);
      const activeCheck = progress.conceptAwaitingAdvance && feedbackCheck ? feedbackCheck : pending;
      return [
        step.conceptModule.phenomenon.question,
        step.conceptModule.mentalModel.summary,
        step.conceptModule.bridgeToCode,
        activeCheck?.question || '概念理解已经完成，可以进入代码引导。'
      ][progress.conceptStage] || step.conceptModule.learningGoal;
    }
    if (!progress.completed) return step.guidedSteps[progress.index]?.instruction || '完成当前代码引导，再进入下一步。';
  }
  return step?.checkpoint?.task || '项目已就绪，等待你的这次操作。';
}

function updateGuidedProgress(step, action, requestedIndex) {
  if (!step?.guidedSteps?.length) return;
  if (previewSession && state.submitting) return;
  if ($('#project-evidence')) state.answers.set(step.id, readAnswer(step));
  const progress = { ...projectGuidedProgress(step) };
  const lastIndex = step.guidedSteps.length - 1;
  const currentGuidedStep = step.guidedSteps[progress.index];
  const currentCodeReady = !currentGuidedStep?.codeStepId || (state.codePackageStatus === 'ready' && Boolean(guidedCodeModel(state.codePackage, currentGuidedStep)));
  if (['next', 'complete', 'preview-checkpoint'].includes(action) && !currentCodeReady) {
    showNotice('完整代码包尚未就绪，不能把这一步标记为完成。请先修复代码包后再继续。', 'error');
    return;
  }
  if (action === 'select' && Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex <= progress.reached) progress.index = requestedIndex;
  if (action === 'back') progress.index = Math.max(0, progress.index - 1);
  if (action === 'next' && progress.index < lastIndex) {
    progress.index += 1;
    progress.reached = Math.max(progress.reached, progress.index);
  }
  if (action === 'complete' && progress.index === lastIndex) progress.completed = true;
  if (previewSession && action === 'preview-checkpoint') progress.completed = true;
  if (previewSession && action === 'select') progress.completed = false;
  saveGuidedProgress(step, progress);
  state.lastResult = null;
  $('#scene-output p').textContent = projectScenePrompt(step);
  renderProjectInteraction(step);
  reportPreviewState();
  requestAnimationFrame(() => $('[data-guided-current="true"]', $('#interaction-root'))?.focus({ preventScroll: true }));
}

async function updateConceptProgress(step, action, requestedIndex) {
  if (!step?.conceptModule) return;
  if (state.submitting) return;
  const current = projectGuidedProgress(step);
  const progress = {
    ...current,
    conceptAnswers: { ...(current.conceptAnswers || {}) },
    conceptPassedIds: [...(current.conceptPassedIds || [])]
  };
  const lastStage = CONCEPT_STAGE_COUNT - 1;
  if (action === 'select' && Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex <= progress.conceptReached) {
    progress.conceptStage = requestedIndex;
    progress.conceptFeedback = '';
    progress.conceptFeedbackKind = '';
    progress.conceptFeedbackCheckId = '';
    progress.conceptAwaitingAdvance = false;
  }
  if (action === 'back') {
    progress.conceptStage = Math.max(0, progress.conceptStage - 1);
    progress.conceptFeedback = '';
    progress.conceptFeedbackKind = '';
    progress.conceptFeedbackCheckId = '';
    progress.conceptAwaitingAdvance = false;
  }
  if (action === 'next' && progress.conceptStage < lastStage) {
    progress.conceptStage += 1;
    progress.conceptReached = Math.max(progress.conceptReached, progress.conceptStage);
    progress.conceptFeedback = '';
    progress.conceptFeedbackKind = '';
    progress.conceptFeedbackCheckId = '';
    progress.conceptAwaitingAdvance = false;
  }
  if (action === 'check') {
    const check = pendingConceptCheck(step.conceptModule.checks, progress.conceptPassedIds);
    const selected = $('input[name="concept-choice"]:checked', $('#interaction-root'));
    const selectedOptionId = selected?.value || '';
    const localResult = evaluateConceptAnswer(step.conceptModule.checks, check?.id, selectedOptionId);
    if (!localResult.answered) {
      progress.conceptFeedback = '先选一个答案，再检查自己的理解。';
      progress.conceptFeedbackKind = 'error';
      progress.conceptFeedbackCheckId = check?.id || '';
    } else {
      let result = localResult;
      if (!previewSession) {
        state.submitting = true;
        renderProjectInteraction(step);
        try {
          const response = await requestJSON('/api/play/project-concept-attempts', {
            method: 'POST',
            body: JSON.stringify({
              requestId: makeRequestId('concept'),
              projectId: state.level.id,
              contentVersion: state.level.version,
              chapterId: step.id,
              checkId: check.id,
              selectedOptionId
            })
          });
          state.progress = response.data.progress;
          result = { answered: true, correct: response.data.result?.passed === true, explanation: response.data.feedback?.explanation || check.explanation };
        } catch (error) {
          progress.conceptFeedback = `这次答案没有保存：${error.message}`;
          progress.conceptFeedbackKind = 'error';
          progress.conceptFeedbackCheckId = check.id;
          showNotice(progress.conceptFeedback, 'error');
          result = null;
        } finally {
          state.submitting = false;
        }
      }
      if (result) {
        progress.conceptAnswers[check.id] = selectedOptionId;
        progress.conceptFeedback = result.explanation;
        progress.conceptFeedbackKind = result.correct ? 'success' : 'error';
        progress.conceptFeedbackCheckId = check.id;
        progress.conceptAwaitingAdvance = result.correct;
        if (result.correct && !progress.conceptPassedIds.includes(check.id)) progress.conceptPassedIds.push(check.id);
      }
    }
  }
  if (action === 'next-check') {
    progress.conceptFeedback = '';
    progress.conceptFeedbackKind = '';
    progress.conceptFeedbackCheckId = '';
    progress.conceptAwaitingAdvance = false;
  }
  if (action === 'finish-concept') {
    const pending = pendingConceptCheck(step.conceptModule.checks, progress.conceptPassedIds);
    if (!pending) {
      progress.conceptCompleted = true;
      progress.conceptFeedback = '';
      progress.conceptFeedbackKind = '';
      progress.conceptFeedbackCheckId = '';
      progress.conceptAwaitingAdvance = false;
    }
  }
  if (previewSession && action === 'preview-code') {
    progress.conceptStage = lastStage;
    progress.conceptReached = lastStage;
    progress.conceptCompleted = true;
    progress.conceptPassedIds = step.conceptModule.checks.map(check => check.id);
    progress.conceptFeedback = '';
    progress.conceptFeedbackKind = '';
    progress.conceptFeedbackCheckId = '';
    progress.conceptAwaitingAdvance = false;
  }
  saveGuidedProgress(step, progress);
  state.lastResult = null;
  $('#scene-output p').textContent = projectScenePrompt(step);
  renderProjectInteraction(step);
  reportPreviewState();
  requestAnimationFrame(() => $('[data-concept-current="true"], .project-guided-step', $('#interaction-root'))?.focus?.({ preventScroll: true }));
}

const CONCEPT_STAGE_LABELS = ['先观察', '建模型', '映射代码', '检查理解'];

function gpioConceptLab(step) {
  if (step.id === 'gpio-start') {
    const saved = state.gpioConceptLabs.get(step.id) || { level: 'high' };
    const result = gpioOutputState(saved.level);
    return `<section class="gpio-lab" data-gpio-lab="output" aria-label="GPIO 输出电平实验">
      <header><div><small>先动手，再记术语</small><strong>把引脚切成高或低，沿着电流路径看灯为什么变化</strong></div><p>固定接线：3.3V → 限流电阻 → LED → GPIO。这个实验中的 LED 是低电平有效。</p></header>
      <div class="gpio-lab-controls" role="group" aria-label="选择 GPIO 输出电平">
        <button type="button" data-gpio-lab-action="output-level" data-gpio-lab-value="high" aria-pressed="${result.level === 'high'}">输出高电平</button>
        <button type="button" data-gpio-lab-action="output-level" data-gpio-lab-value="low" aria-pressed="${result.level === 'low'}">输出低电平</button>
      </div>
      <div class="gpio-circuit" data-current="${result.ledOn ? 'flowing' : 'stopped'}" aria-label="3.3V 经过限流电阻和 LED 连接到 GPIO">
        <span class="gpio-rail">3.3V</span><i aria-hidden="true">→</i><span>限流电阻</span><i aria-hidden="true">→</i><span class="gpio-led">LED</span><i aria-hidden="true">→</i><span class="gpio-pin">GPIO<br><b>${esc(result.pinVoltage)}</b></span><i aria-hidden="true">→</i><span class="gpio-ground">GND</span>
      </div>
      <output class="gpio-lab-result" aria-live="polite"><span><b>引脚 raw</b>${result.raw}</span><span><b>LED</b>${result.ledOn ? '亮' : '灭'}</span><p>${esc(result.currentPath)}</p></output>
    </section>`;
  }
  if (step.id === 'gpio-input-pulls') {
    const saved = state.gpioConceptLabs.get(step.id) || { pull: 'none', pressed: false };
    const result = gpioInputState(saved);
    const rail = result.pull === 'down' ? 'GND' : result.pull === 'up' ? '3.3V' : '未连接';
    const buttonRail = result.pull === 'down' ? '3.3V' : 'GND';
    const raw = result.raw === null ? '不确定' : String(result.raw);
    const semantic = result.semanticPressed === null ? '无法判断' : result.semanticPressed ? 'true' : 'false';
    return `<section class="gpio-lab" data-gpio-lab="input" aria-label="GPIO 输入与上下拉实验">
      <header><div><small>先改变电路，再观察 raw</small><strong>按钮松开时，给输入脚一条到 3.3V 或 GND 的路径</strong></div><p>选择“无上下拉、上拉、下拉”，再切换按钮状态。注意：输入脚只观察电压，不会自动产生默认 0。</p></header>
      <div class="gpio-lab-controls gpio-pull-controls" role="group" aria-label="选择输入默认路径">
        <button type="button" data-gpio-lab-action="input-pull" data-gpio-lab-value="none" aria-pressed="${result.pull === 'none'}">无上下拉</button>
        <button type="button" data-gpio-lab-action="input-pull" data-gpio-lab-value="up" aria-pressed="${result.pull === 'up'}">上拉到 3.3V</button>
        <button type="button" data-gpio-lab-action="input-pull" data-gpio-lab-value="down" aria-pressed="${result.pull === 'down'}">下拉到 GND</button>
        <button type="button" data-gpio-lab-action="input-pressed" aria-pressed="${result.pressed}">${result.pressed ? '松开按钮' : '按下按钮'}</button>
      </div>
      <div class="gpio-circuit gpio-input-circuit" data-floating="${result.floating}" aria-label="${esc(rail)} 经过电阻连接 GPIO，GPIO 再经过按钮连接 ${esc(buttonRail)}">
        <span class="gpio-rail">${esc(rail)}</span><i aria-hidden="true">→</i><span>${result.pull === 'none' ? '没有默认路径' : result.pull === 'up' ? '上拉电阻' : '下拉电阻'}</span><i aria-hidden="true">→</i><span class="gpio-pin">GPIO<br><b>${esc(result.pinVoltage)}</b></span><i aria-hidden="true">→</i><span class="gpio-switch">按钮<br><b>${result.pressed ? '闭合' : '断开'}</b></span><i aria-hidden="true">→</i><span class="gpio-ground">${esc(buttonRail)}</span>
      </div>
      <output class="gpio-lab-result" aria-live="polite"><span><b>引脚 raw</b>${raw}</span><span><b>pressed</b>${semantic}</span><p>${esc(result.currentPath)}</p></output>
    </section>`;
  }
  return '';
}

function updateGpioConceptLab(step, action, value) {
  if (step.id === 'gpio-start' && action === 'output-level') {
    state.gpioConceptLabs.set(step.id, { level: value === 'low' ? 'low' : 'high' });
  }
  if (step.id === 'gpio-input-pulls') {
    const current = state.gpioConceptLabs.get(step.id) || { pull: 'none', pressed: false };
    if (action === 'input-pull') state.gpioConceptLabs.set(step.id, { ...current, pull: ['up', 'down'].includes(value) ? value : 'none' });
    if (action === 'input-pressed') state.gpioConceptLabs.set(step.id, { ...current, pressed: !current.pressed });
  }
  renderProjectInteraction(step);
}

function osLabShell(kind, eyebrow, title, description, controls, stage, result) {
  return `<section class="os-lab" data-os-lab="${esc(kind)}" aria-label="${esc(title)}">
    <header><div><small>${esc(eyebrow)}</small><strong>${esc(title)}</strong></div><p>${esc(description)}</p></header>
    <div class="os-lab-controls" role="group" aria-label="改变实验条件">${controls}</div>
    <div class="os-lab-stage">${stage}</div>
    <output class="os-lab-result" aria-live="polite">${result}</output>
  </section>`;
}

function osConceptLab(step) {
  if (step.id === 'syscall-boundary') {
    const saved = state.osConceptLabs.get(step.id) || { outcome: 'success' };
    const model = syscallState({ path: '/island/patrol.conf', outcome: saved.outcome, assignedFd: 3 });
    const controls = [
      ['success', '文件存在'], ['ENOENT', '路径不存在'], ['EACCES', '权限不足']
    ].map(([value, label]) => `<button type="button" data-os-lab-action="syscall-outcome" data-os-lab-value="${value}" aria-pressed="${model.outcome === value}">${label}</button>`).join('');
    const stage = `<div class="os-flow" data-status="${model.opened ? 'success' : 'failure'}">${[
      ['用户态', 'open(...)'], ['系统调用', '陷入内核'], ['内核态', '检查路径与权限'], ['用户态', model.opened ? '得到 fd 3' : `得到 -1 / ${model.errno}`]
    ].map(([title, detail], index) => `<div><span>${index + 1}</span><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>`).join('<i aria-hidden="true">→</i>')}</div>`;
    const result = `<span><b>返回值</b>${model.returnValue}</span><span><b>errno</b>${model.errno || '不读取'}</span><p>${model.opened ? '内核创建了打开文件对象，并把进程描述符表中的 3 号槽位指向它。' : '调用已经报告失败，此时才读取 errno；进程没有得到新的文件描述符。'}</p>`;
    return osLabShell('syscall', '用户态 ↔ 内核态', '同一行 open，在内核里会经历什么', '切换文件状态，观察返回值和 errno。系统调用失败并不等于程序崩溃。', controls, stage, result);
  }

  if (step.id === 'fork-model') {
    const saved = state.osConceptLabs.get(step.id) || { writeBy: 'none' };
    const model = forkCowState({ parentPid: 4100, childPid: 4101, initialValue: 7, writeBy: saved.writeBy, nextValue: 9 });
    const controls = [
      ['none', '都不写'], ['parent', '父进程写 9'], ['child', '子进程写 9']
    ].map(([value, label]) => `<button type="button" data-os-lab-action="fork-write" data-os-lab-value="${value}" aria-pressed="${model.writer === value}">${label}</button>`).join('');
    const stage = `<div class="os-process-grid"><article><small>父进程 · PID ${model.parentPid}</small><strong>value = ${model.parentValue}</strong><code>fork() → ${model.forkReturns.parent}</code></article><article><small>子进程 · PID ${model.childPid}</small><strong>value = ${model.childValue}</strong><code>fork() → ${model.forkReturns.child}</code></article></div><div class="os-memory-strip" data-copied="${model.copiedOnWrite}"><span>相同虚拟地址</span><b>${model.physicalPageCount} 个物理页</b><small>${model.copiedOnWrite ? '发生写入后，内核才复制被修改的页' : '尚未写入，父子可共享只读物理页'}</small></div>`;
    const result = `<span><b>父进程返回</b>${model.forkReturns.parent}</span><span><b>子进程返回</b>${model.forkReturns.child}</span><p>${model.copiedOnWrite ? '两个进程仍看到相同的虚拟地址，但修改只进入写入方的私有副本。' : 'fork 后不是两个函数返回两次，而是两个进程分别从同一位置继续。'}</p>`;
    return osLabShell('fork', '进程与虚拟内存', '写时复制不是“父子永远共享变量”', '选择由谁修改变量，观察 PID、fork 返回值和物理页怎样变化。', controls, stage, result);
  }

  if (step.id === 'exec-wait') {
    const saved = state.osConceptLabs.get(step.id) || { outcome: 'success' };
    const model = execState({ pid: 4101, beforeProgram: 'patrold-child', requestedProgram: 'patrol-worker', outcome: saved.outcome });
    const controls = [
      ['success', 'worker 存在'], ['ENOENT', 'worker 不存在'], ['EACCES', '没有执行权限']
    ].map(([value, label]) => `<button type="button" data-os-lab-action="exec-outcome" data-os-lab-value="${value}" aria-pressed="${model.outcome === value}">${label}</button>`).join('');
    const stage = `<div class="os-exec-line"><article><small>exec 前</small><strong>${esc(model.beforeProgram)}</strong><span>PID ${model.beforePid}</span></article><i aria-hidden="true">${model.returnedToOldProgram ? '↩' : '→'}</i><article data-active="${!model.returnedToOldProgram}"><small>${model.returnedToOldProgram ? 'exec 失败，仍在旧程序' : 'exec 成功，新映像开始'}</small><strong>${esc(model.afterProgram)}</strong><span>PID ${model.afterPid}</span></article></div>`;
    const result = `<span><b>PID 是否变化</b>${model.pidChanged ? '是' : '否'}</span><span><b>旧代码是否继续</b>${model.returnedToOldProgram ? '是' : '否'}</span><p>${model.returnedToOldProgram ? `exec 返回 -1，errno=${model.errno}；只有失败才会回到旧代码。` : 'exec 替换代码、栈和数据映像；成功后不会执行调用点的下一行。'}</p>`;
    return osLabShell('exec', '进程映像替换', 'exec 不会再创建一个进程', '切换可执行文件状态，观察同一 PID 在成功与失败时走向哪里。', controls, stage, result);
  }

  if (step.id === 'process-lifecycle') {
    const saved = state.osConceptLabs.get(step.id) || { state: 'running' };
    const model = childLifecycleState({ state: saved.state, event: 'none', exitStatus: 23 });
    const controls = `<button type="button" data-os-lab-action="child-exit"${model.state !== 'running' ? ' disabled' : ''}>子进程 exit(23)</button><button type="button" data-os-lab-action="child-wait"${model.state !== 'zombie' ? ' disabled' : ''}>父进程 waitpid</button><button type="button" data-os-lab-action="child-reset">重新开始</button>`;
    const lifecycle = ['running', 'zombie', 'reaped'];
    const labels = { running: '正在运行', zombie: '已退出，等待回收', reaped: '已回收' };
    const stage = `<div class="os-lifecycle">${lifecycle.map((name, index) => `<div data-current="${model.state === name}" data-past="${lifecycle.indexOf(model.state) > index}"><span>${index + 1}</span><strong>${labels[name]}</strong><small>${name === 'running' ? '拥有执行资源' : name === 'zombie' ? '只保留退出状态与身份' : '进程表项释放'}</small></div>`).join('<i aria-hidden="true">→</i>')}</div>`;
    const result = `<span><b>当前状态</b>${labels[model.state]}</span><span><b>占用进程表</b>${model.occupiesProcessTable ? '是' : '否'}</span><p>${model.state === 'zombie' ? '子进程已经不能执行，但父进程尚未取走退出状态，所以内核仍保留一条僵尸记录。' : model.state === 'reaped' ? 'waitpid 取走退出状态 23，内核现在可以释放这条进程表记录。' : '子进程仍可运行；退出事件发生后，它不会自动等同于“已经回收”。'}</p>`;
    return osLabShell('lifecycle', '退出与回收', 'exit、僵尸和 waitpid 是三个不同边界', '按顺序触发子进程退出与父进程回收，观察内核为什么暂时保留僵尸。', controls, stage, result);
  }

  if (step.id === 'pipe-reports') {
    const saved = state.osConceptLabs.get(step.id) || { writers: [
      { id: 'parent', open: true }, { id: 'worker', open: true }, { id: 'helper', open: false }
    ] };
    const model = pipeEofState(saved);
    const labels = { parent: '父进程写端', worker: 'worker 写端', helper: '孙进程副本' };
    const controls = model.writers.map(writer => `<button type="button" data-os-lab-action="pipe-writer" data-os-lab-value="${writer.id}" aria-pressed="${writer.open}">${labels[writer.id]}：${writer.open ? '打开' : '关闭'}</button>`).join('');
    const stage = `<div class="os-pipe"><div class="os-pipe-writers">${model.writers.map(writer => `<span data-open="${writer.open}"><b>${labels[writer.id]}</b><small>${writer.open ? '仍持有内核写端引用' : '已 close'}</small></span>`).join('')}</div><i aria-hidden="true">字节流 →</i><div class="os-pipe-reader" data-eof="${model.readerSeesEof}"><b>patrold 读端</b><small>${model.readerSeesEof ? 'read 返回 0：EOF' : '还不能得到 EOF'}</small></div></div>`;
    const result = `<span><b>仍打开写端</b>${model.openWriterIds.length}</span><span><b>读端看到 EOF</b>${model.readerSeesEof ? '是' : '否'}</span><p>${model.readerSeesEof ? '所有进程里的写端引用都已关闭，缓冲排空后 read 才返回 0。' : `仍有 ${model.openWriterIds.map(id => labels[id]).join('、')}，即使真正的 worker 已退出，读端也不能把“暂时没数据”判断为 EOF。`}</p>`;
    return osLabShell('pipe', '文件描述符所有权', '管道 EOF 取决于所有写端引用', '逐个关闭父进程、worker 和孙进程的写端，找到让 read 返回 0 的唯一条件。', controls, stage, result);
  }

  if (step.id === 'poll-event-loop') {
    const saved = state.osConceptLabs.get(step.id) || { descriptors: [
      { fd: 3, ready: true }, { fd: 4, ready: false }, { fd: 5, ready: true }
    ], cursor: 0, lastReady: [] };
    const model = pollReadyState({ descriptors: saved.descriptors, cursor: saved.cursor, maxEvents: 1 });
    const labels = new Map([[3, '摩天轮 worker'], [4, '游戏厅 worker'], [5, 'patrolctl']]);
    const controls = `${saved.descriptors.map(item => `<button type="button" data-os-lab-action="poll-toggle" data-os-lab-value="${item.fd}" aria-pressed="${item.ready}">${labels.get(item.fd)}：${item.ready ? '就绪' : '沉默'}</button>`).join('')}<button type="button" data-os-lab-action="poll-run">执行一轮 poll</button>`;
    const stage = `<div class="os-poll-sources">${saved.descriptors.map((item, index) => `<article data-ready="${item.ready}" data-cursor="${saved.cursor === index}"><small>fd ${item.fd}${saved.cursor === index ? ' · 本轮从这里扫描' : ''}</small><strong>${labels.get(item.fd)}</strong><span>${item.ready ? 'POLLIN' : '无事件'}</span></article>`).join('')}</div>`;
    const lastReady = saved.lastReady.length ? saved.lastReady.map(fd => labels.get(fd)).join('、') : '尚未执行';
    const result = `<span><b>上轮处理</b>${esc(lastReady)}</span><span><b>下轮候选</b>${model.readyFds.length ? esc(model.readyFds.map(fd => labels.get(fd)).join('、')) : '无'}</span><p>poll 只告诉事件循环哪些 fd 可能取得进展；每轮只处理有限事件并移动扫描起点，持续刷屏的低编号 fd 就不能饿死其他来源。</p>`;
    return osLabShell('poll', 'I/O 就绪与公平性', '一个线程也能同时照看多个来源', '切换不同来源的就绪状态，多执行几轮，观察扫描起点怎样轮转。', controls, stage, result);
  }

  if (step.id === 'deadline-control') {
    const saved = state.osConceptLabs.get(step.id) || { nowMs: 1000, wallClockShiftMs: 0, groupKilled: false };
    const clock = monotonicDeadlineState({ startedAtMs: 1000, nowMs: saved.nowMs, timeoutMs: 5000, wallClockShiftMs: saved.wallClockShiftMs });
    const groupInput = { targetPgid: 4101, processes: [
      { pid: 4000, pgid: 4000, alive: true },
      { pid: 4101, pgid: 4101, alive: true },
      { pid: 4102, pgid: 4101, alive: true }
    ] };
    const group = saved.groupKilled
      ? processGroupKillState(groupInput)
      : { ...groupInput, killedPids: [], survivingPids: groupInput.processes.map(process => process.pid) };
    const controls = `<button type="button" data-os-lab-action="clock-advance">单调时间 +1 秒</button><button type="button" data-os-lab-action="wall-jump" data-os-lab-value="forward">墙上时钟 +24 小时</button><button type="button" data-os-lab-action="wall-jump" data-os-lab-value="backward">墙上时钟 -24 小时</button><button type="button" data-os-lab-action="kill-group"${saved.groupKilled ? ' disabled' : ''}>向 PGID 4101 发 SIGKILL</button><button type="button" data-os-lab-action="deadline-reset">重置</button>`;
    const stage = `<div class="os-deadline"><div><small>CLOCK_MONOTONIC</small><strong>${(clock.nowMs / 1000).toFixed(1)} s</strong><span>deadline 6.0 s · 剩余 ${(clock.remainingMs / 1000).toFixed(1)} s</span></div><div><small>墙上时钟调整</small><strong>${clock.wallClockShiftMs >= 0 ? '+' : ''}${clock.wallClockShiftMs / 3600000} h</strong><span>不参与 deadline 计算</span></div></div><div class="os-process-group">${group.processes.map(process => `<span data-alive="${process.alive}" data-target="${process.pgid === 4101}"><b>PID ${process.pid}</b><small>PGID ${process.pgid} · ${process.alive ? '存活' : '已终止'}</small></span>`).join('')}</div>`;
    const result = `<span><b>任务期限</b>${clock.expired ? '已到期' : '未到期'}</span><span><b>同组剩余进程</b>${group.survivingPids.filter(pid => pid !== 4000).length}</span><p>${saved.groupKilled ? '按进程组发信号同时覆盖 worker 和它派生的 helper；patrold 位于另一组，不受影响。' : clock.expired ? '单调 deadline 已到期，应先发 SIGTERM，宽限期结束后再对整个进程组升级 SIGKILL。' : '无论墙上时间怎样跳变，任务剩余时间只由单调时间决定。'}</p>`;
    return osLabShell('deadline', '时钟与进程边界', '超时要同时回答“何时到期”和“终止谁”', '推进两种时钟并终止目标进程组，观察 deadline 与进程树边界。', controls, stage, result);
  }

  return '';
}

function updateOsConceptLab(step, action, value) {
  const current = state.osConceptLabs.get(step.id);
  if (step.id === 'syscall-boundary' && action === 'syscall-outcome') {
    state.osConceptLabs.set(step.id, { outcome: ['success', 'ENOENT', 'EACCES'].includes(value) ? value : 'success' });
  }
  if (step.id === 'fork-model' && action === 'fork-write') {
    state.osConceptLabs.set(step.id, { writeBy: ['none', 'parent', 'child'].includes(value) ? value : 'none' });
  }
  if (step.id === 'exec-wait' && action === 'exec-outcome') {
    state.osConceptLabs.set(step.id, { outcome: ['success', 'ENOENT', 'EACCES'].includes(value) ? value : 'success' });
  }
  if (step.id === 'process-lifecycle') {
    const lifecycle = current || { state: 'running' };
    if (action === 'child-exit' && lifecycle.state === 'running') state.osConceptLabs.set(step.id, { state: childLifecycleState({ state: 'running', event: 'exit', exitStatus: 23 }).state });
    if (action === 'child-wait' && lifecycle.state === 'zombie') state.osConceptLabs.set(step.id, { state: childLifecycleState({ state: 'zombie', event: 'wait', exitStatus: 23 }).state });
    if (action === 'child-reset') state.osConceptLabs.set(step.id, { state: 'running' });
  }
  if (step.id === 'pipe-reports' && action === 'pipe-writer') {
    const pipe = current || { writers: [{ id: 'parent', open: true }, { id: 'worker', open: true }, { id: 'helper', open: false }] };
    state.osConceptLabs.set(step.id, { writers: pipe.writers.map(writer => writer.id === value ? { ...writer, open: !writer.open } : writer) });
  }
  if (step.id === 'poll-event-loop') {
    const poll = current || { descriptors: [{ fd: 3, ready: true }, { fd: 4, ready: false }, { fd: 5, ready: true }], cursor: 0, lastReady: [] };
    if (action === 'poll-toggle') {
      const fd = Number(value);
      state.osConceptLabs.set(step.id, { ...poll, descriptors: poll.descriptors.map(item => item.fd === fd ? { ...item, ready: !item.ready } : item) });
    }
    if (action === 'poll-run') {
      const result = pollReadyState({ descriptors: poll.descriptors, cursor: poll.cursor, maxEvents: 1 });
      state.osConceptLabs.set(step.id, { ...poll, cursor: result.nextCursor, lastReady: result.readyFds });
    }
  }
  if (step.id === 'deadline-control') {
    const deadline = current || { nowMs: 1000, wallClockShiftMs: 0, groupKilled: false };
    if (action === 'clock-advance') state.osConceptLabs.set(step.id, { ...deadline, nowMs: Math.min(deadline.nowMs + 1000, 8000) });
    if (action === 'wall-jump') state.osConceptLabs.set(step.id, { ...deadline, wallClockShiftMs: value === 'backward' ? -86400000 : 86400000 });
    if (action === 'kill-group') state.osConceptLabs.set(step.id, { ...deadline, groupKilled: true });
    if (action === 'deadline-reset') state.osConceptLabs.set(step.id, { nowMs: 1000, wallClockShiftMs: 0, groupKilled: false });
  }
  renderProjectInteraction(step);
}

function projectConceptModule(step, progress) {
  const module = step.conceptModule;
  if (!module) return '';
  const conceptLab = gpioConceptLab(step) || osConceptLab(step);
  if (progress.conceptCompleted) {
    return `<details class="project-concept-review"><summary><span aria-hidden="true">✓</span><div><small>概念理解已通过 · 可展开完整复习</small><strong>${esc(module.title)}</strong></div></summary><div class="project-concept-review-body"><p>${esc(module.learningGoal)}</p>${conceptLab}<section><strong>心智模型</strong><p>${esc(module.mentalModel.summary)}</p><div class="concept-flow">${module.mentalModel.flow.map((item, index) => `<div><span>${index + 1}</span><strong>${esc(item.title)}</strong><small>${esc(item.explanation)}</small></div>`).join('')}</div></section><section><strong>术语与代码</strong><div class="concept-term-grid">${module.terms.map(item => `<section><strong>${esc(item.term)}</strong><p>${esc(item.plainMeaning)}</p><small><b>在代码里</b>${esc(item.codeMapping)}</small></section>`).join('')}</div></section><section class="concept-worked-example"><strong>${esc(module.workedExample.title)}</strong><ol>${module.workedExample.steps.map(item => `<li>${esc(item)}</li>`).join('')}</ol><p>${esc(module.workedExample.takeaway)}</p></section><div class="concept-misconceptions">${module.misconceptions.map(item => `<p><s>${esc(item.claim)}</s><span>${esc(item.correction)}</span></p>`).join('')}</div><p class="concept-bridge"><b>进入代码：</b>${esc(module.bridgeToCode)}</p></div></details>`;
  }
  const stage = progress.conceptStage;
  const pending = pendingConceptCheck(module.checks, progress.conceptPassedIds);
  const feedbackCheck = module.checks.find(check => check.id === progress.conceptFeedbackCheckId);
  const activeCheck = progress.conceptAwaitingAdvance && feedbackCheck ? feedbackCheck : pending;
  const stageBody = [
    `<article class="concept-observation"><p class="section-label">先看见问题</p><h3>${esc(module.phenomenon.title)}</h3><p>${esc(module.phenomenon.observation)}</p><blockquote>${esc(module.phenomenon.question)}</blockquote>${conceptLab}</article>`,
    `<article class="concept-model"><p>${esc(module.mentalModel.summary)}</p><div class="concept-flow">${module.mentalModel.flow.map((item, index) => `<div><span>${index + 1}</span><strong>${esc(item.title)}</strong><small>${esc(item.explanation)}</small></div>`).join('')}</div></article>`,
    `<article class="concept-code-map"><div class="concept-term-grid">${module.terms.map(item => `<section><strong>${esc(item.term)}</strong><p>${esc(item.plainMeaning)}</p><small><b>在代码里</b>${esc(item.codeMapping)}</small></section>`).join('')}</div><div class="concept-worked-example"><strong>${esc(module.workedExample.title)}</strong><ol>${module.workedExample.steps.map(item => `<li>${esc(item)}</li>`).join('')}</ol><p>${esc(module.workedExample.takeaway)}</p></div><div class="concept-misconceptions">${module.misconceptions.map(item => `<p><s>${esc(item.claim)}</s><span>${esc(item.correction)}</span></p>`).join('')}</div><p class="concept-bridge"><b>接下来写代码：</b>${esc(module.bridgeToCode)}</p></article>`,
    activeCheck
      ? `<article class="concept-check"><div class="concept-check-heading"><span>理解题 ${Math.min(progress.conceptPassedIds.length + (progress.conceptAwaitingAdvance ? 0 : 1), module.checks.length)} / ${module.checks.length}</span><strong>${esc(activeCheck.question)}</strong></div><fieldset class="concept-options"><legend class="visually-hidden">${esc(activeCheck.question)}</legend>${activeCheck.options.map((option, index) => `<label><input type="radio" name="concept-choice" value="${esc(option.id)}"${progress.conceptAnswers?.[activeCheck.id] === option.id ? ' checked' : ''}${progress.conceptAwaitingAdvance ? ' disabled' : ''}><span><b>${String.fromCharCode(65 + index)}</b>${esc(option.text)}</span></label>`).join('')}</fieldset>${progress.conceptFeedback ? `<p class="concept-feedback" data-kind="${esc(progress.conceptFeedbackKind)}" role="status" aria-live="polite">${esc(progress.conceptFeedback)}</p>` : ''}</article>`
      : '<article class="concept-check"><p class="concept-feedback" data-kind="success">概念理解已经通过，可以进入代码引导。</p></article>'
  ][stage];
  const checkAction = progress.conceptAwaitingAdvance
    ? pending ? '<button class="park-button primary" type="button" data-concept-action="next-check">继续下一题</button>' : '<button class="park-button primary" type="button" data-concept-action="finish-concept">进入代码引导</button>'
    : `<button class="park-button primary" type="button" data-concept-action="check"${state.submitting ? ' disabled' : ''}>${state.submitting ? '正在保存…' : '检查这一题'}</button>`;
  return `<section class="project-concept"><div class="project-concept-heading"><div><small>概念理解 ${stage + 1} / ${CONCEPT_STAGE_COUNT}</small><strong>${esc(module.title)}</strong></div><p>${esc(module.learningGoal)}</p></div><nav class="concept-stage-nav" aria-label="概念理解进度">${CONCEPT_STAGE_LABELS.map((label, index) => `<button type="button" data-concept-action="select" data-concept-index="${index}"${index > progress.conceptReached ? ' disabled' : ''}${index === stage ? ' aria-current="step" data-concept-current="true"' : ''}><span>${index + 1}</span>${label}</button>`).join('')}</nav><div class="project-concept-body">${stageBody}</div><div class="project-concept-controls"><button class="park-button secondary" type="button" data-concept-action="back"${stage === 0 || state.submitting ? ' disabled' : ''}>上一步</button>${stage < CONCEPT_STAGE_COUNT - 1 ? '<button class="park-button primary" type="button" data-concept-action="next">我理解了，继续</button>' : checkAction}${previewSession ? '<button class="park-button secondary concept-preview-skip" type="button" data-concept-action="preview-code">预览代码引导</button>' : ''}</div></section>`;
}

function projectCodeStatus(message, kind = 'loading') {
  return `<section class="project-code-status" data-kind="${esc(kind)}"><strong>${kind === 'error' ? '完整代码包暂时不可用' : '正在准备完整代码包'}</strong><p>${esc(message)}</p></section>`;
}

function projectSourceFiles(stateId, files, label) {
  if (!files?.length) return '';
  return `<div class="project-code-files" aria-label="${esc(label)}">${files.map(file => `<details class="project-code-file"><summary><code>${esc(file.path)}</code><button type="button" data-code-copy data-code-state-id="${esc(stateId)}" data-code-path="${esc(file.path)}">复制完整文件</button></summary><eggy-code language="${esc(file.language)}" aria-label="${esc(file.path)} 完整源码">${esc(file.content)}</eggy-code></details>`).join('')}</div>`;
}

function projectArchiveDownload(stateId, label) {
  return `<div class="project-code-download"><button class="park-button secondary" type="button" data-code-download data-code-state-id="${esc(stateId)}">${esc(label)}</button><small>ZIP 可直接解压；保留工程目录与脚本执行权限</small></div>`;
}

function projectGuidedCodeDelivery(guidedStep) {
  if (!guidedStep?.codeStepId) return '';
  if (state.codePackageStatus === 'loading') return projectCodeStatus('正在读取这一代码步骤对应的完整文件、学习者改动和补全记录。');
  if (state.codePackageStatus === 'error') return projectCodeStatus(state.codePackageError || '代码包加载失败，请稍后重试。', 'error');
  const model = guidedCodeModel(state.codePackage, guidedStep);
  if (!model) return projectCodeStatus('课程引用的代码步骤在代码包中不存在，请联系管理者修复课程版本。', 'error');
  const scaffoldMode = codeDeliveryMode(state.codePackage, state.level?.codeDelivery?.baselineStateId) === 'scaffold';
  const gaps = model.intentionalGaps.length
    ? `<section class="project-code-gaps"><strong>这一版刻意保留 ${model.intentionalGaps.length} 处缺口</strong>${model.intentionalGaps.map(gap => `<article><code>${esc(gap.marker)}</code><p>${esc(gap.reason)}</p><small>将在代码步骤 <b>${esc(gap.resolvedInStepId)}</b> 补全</small></article>`).join('')}</section>`
    : '<p class="project-code-no-gaps"><b>完整性检查</b>本步没有隐含省略；上方每个目标文件都提供了可直接复制的完整内容。</p>';
  const experimentNotice = scaffoldMode
    ? '<p class="project-code-experiment"><b>这是一次概念实验</b>先复制本步提供的标准参考文件，再按要求做小改动并观察结果。记录结果后，如果改动会影响后续步骤，请重新复制本步的标准参考文件恢复课程版本，再继续学习。</p>'
    : '';
  return `<section class="project-code-delivery"><header><div><small>完整代码包 · ${esc(model.fromStateId)} → ${esc(model.toStateId)}</small><strong>${scaffoldMode ? '复制标准参考文件，再完成本步实验' : '先复制完整文件，再做一个小改动'}</strong></div><span>${model.files.length} 个文件</span></header>${experimentNotice}${projectSourceFiles(model.toStateId, model.files, '本步完整代码')}<section class="project-learner-changes"><strong>${scaffoldMode ? '由你完成的实验改动' : '由你完成的小改动'}</strong><ol>${model.learnerChanges.map(change => `<li><code>${esc(change.file)}</code><p>${esc(change.instruction)}</p><small>定位：${esc(change.anchor)}</small><small>改完应出现：${esc(change.expectedFragment)}</small></li>`).join('')}</ol></section>${gaps}<section class="project-code-verification"><div><strong>课程给出的检查命令</strong>${model.verification.commands.map(command => `<code>${esc(command)}</code>`).join('')}</div><div><strong>实际运行后核对</strong><ul>${model.verification.expected.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div></section></section>`;
}

function projectStarterSource(currentIndex) {
  if (currentIndex !== 0 || state.codePackageStatus !== 'ready') return '';
  const model = starterProjectModel(state.codePackage, state.level?.codeDelivery?.baselineStateId);
  if (!model) return '';
  return `<details class="project-starter-source"><summary><span><small>首次学习先完成这一步</small><strong>建立课程起始工程 · ${model.files.length} 个完整文件</strong></span><b>展开并获取</b></summary><div class="project-starter-note"><strong>先取得完整起始工程</strong><p>这是课程发布的起始参考工程。可一键下载后解压，也可以逐个文件复制。这里展示源码本身不代表已经在你的电脑或开发板上验证。已经在前面建立过工程时，可以跳过。</p></div>${projectArchiveDownload(model.id, '下载起始工程 ZIP')}${projectSourceFiles(model.id, model.files, '课程起始参考工程')}</details>`;
}

function projectChapterSnapshot(step, unlocked) {
  if (!step?.snapshotStateId) return '';
  if (!unlocked) return `<section class="project-snapshot-locked"><strong>章末完整快照尚未展开</strong><p>完成全部代码步骤后，可在这里核对本章结束时的完整工程，避免把省略代码带到下一章。</p></section>`;
  const model = snapshotCodeModel(state.codePackage, step.snapshotStateId);
  if (!model) return projectCodeStatus('章末快照没有出现在当前代码包中。', 'error');
  return `<details class="project-snapshot"><summary><span><small>章末完整参考快照</small><strong>${esc(model.id)} · ${model.files.length} 个完整文件</strong></span><b>展开获取</b></summary>${projectArchiveDownload(model.id, '下载本章快照 ZIP')}${projectSourceFiles(model.id, model.files, '章末完整工程快照')}</details>`;
}

function projectFinalSource() {
  if (!state.level?.codeDelivery) return '';
  if (state.codePackageStatus === 'loading') return projectCodeStatus('正在读取最终完整工程。');
  if (state.codePackageStatus === 'error') return projectCodeStatus(state.codePackageError || '最终工程加载失败。', 'error');
  const model = finalSourceModel(state.codePackage);
  if (!model) return projectCodeStatus('最终工程快照缺失，请联系管理者修复课程版本。', 'error');
  return `<details class="project-final-source"><summary><span><small>最终完整参考工程</small><strong>${model.files.length} 个完整文件 · 课程发布参考</strong></span><b>展开获取</b></summary><p class="project-final-evidence-note"><b>验证说明</b>下面是课程随代码包发布的命令和预期结果，不代表已在你的电脑或开发板上执行。请实际运行，并以终端输出或硬件现象作为完成证据。</p>${projectArchiveDownload(model.stateId, '下载最终工程 ZIP')}<div class="project-final-runbook"><div><strong>课程发布的编译命令</strong>${model.buildCommands.map(command => `<code>${esc(command)}</code>`).join('')}</div><div><strong>课程发布的运行命令</strong>${model.runCommands.map(command => `<code>${esc(command)}</code>`).join('')}</div><div><strong>课程描述的预期结果</strong><ul>${model.expected.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div></div>${projectSourceFiles(model.stateId, model.files, '最终完整参考工程')}</details>`;
}

function projectChapterGuide(step) {
  const policy = state.level?.guidancePolicy;
  const environment = state.level?.environment;
  const progress = projectGuidedProgress(step);
  const currentIndex = Math.min(progress.index, Math.max((step.guidedSteps?.length || 1) - 1, 0));
  const currentGuidedStep = step.guidedSteps?.[currentIndex];
  const currentCodeReady = !currentGuidedStep?.codeStepId || (state.codePackageStatus === 'ready' && Boolean(guidedCodeModel(state.codePackage, currentGuidedStep)));
  const allCodeReady = chapterCodeReady(state.codePackage, step, state.codePackageStatus);
  const conceptReady = progress.conceptCompleted || !step.conceptModule;
  const meta = [
    step.phase ? ['当前阶段', step.phase] : null,
    Number.isInteger(step.estimatedSessions) ? ['预计课时', `${step.estimatedSessions} 课时`] : null,
    step.milestone ? ['本章里程碑', step.milestone] : null
  ].filter(Boolean);
  const environmentItems = environment ? [
    ['平台', environment.platform],
    ['语言', environment.languageStandard],
    ['工具链', environment.toolchain],
    ['构建', environment.buildSystem],
    ['输出', environment.outputBackend],
    ['输入', environment.inputBackend]
  ].filter(([, value]) => value) : [];
  const policyCopy = policy
    ? `<section class="project-guidance-policy"><strong>本章先理解概念，再做 ${esc(policy.guidedLessonsPerChapter)} 个代码步骤</strong><p>概念理解题通过后解锁代码；完成全部代码引导后，才进入独立检查。${policy.cumulativeArtifact ? '所有章节持续修改同一份作品。' : ''}</p></section>`
    : '';
  const environmentCopy = conceptReady && environmentItems.length
    ? `<details class="project-environment"><summary>开发环境与完整解法说明</summary><div class="project-environment-grid">${environmentItems.map(([label, value]) => `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('')}</div>${environment.requirements?.length ? `<p><span>环境要求</span>${environment.requirements.map(item => `<code>${esc(item)}</code>`).join('')}</p>` : ''}${environment.supportedHosts?.length ? `<p><span>支持主机</span>${environment.supportedHosts.map(item => `<code>${esc(item)}</code>`).join('')}</p>` : ''}${policy ? `<p class="project-solution-scope"><span>完整解法</span>${esc(policy.fullSolutionScope)}</p><p class="project-solution-scope"><span>自主边界</span>${esc(policy.learnerFreedomBoundary)}</p>` : ''}</details>`
    : '';
  const files = conceptReady && step.filesTouched?.length
    ? `<details class="project-files"><summary>本章会修改 ${step.filesTouched.length} 个文件</summary><div>${step.filesTouched.map(file => `<code>${esc(file)}</code>`).join('')}</div></details>`
    : '';
  const guidedSteps = conceptReady && currentGuidedStep
    ? `<section class="project-guided"><div class="project-guided-heading"><span>代码引导 ${currentIndex + 1} / ${step.guidedSteps.length}</span><strong>${progress.completed && allCodeReady ? '引导已完成，可继续复习' : '当前只完成这一步'}</strong></div><div class="project-guided-progress" aria-label="章内引导进度">${step.guidedSteps.map((item, index) => `<button type="button" data-guided-action="select" data-guided-index="${index}"${index > progress.reached ? ' disabled' : ''}${index === currentIndex ? ' aria-current="step" data-guided-current="true"' : ''}><span>${index + 1}</span><small>${esc(item.title)}</small></button>`).join('')}</div>${projectStarterSource(currentIndex)}<article class="project-guided-step" tabindex="-1"><div class="project-guided-step-number">${currentIndex + 1}</div><div><strong>${esc(currentGuidedStep.title)}</strong><div class="project-target-files">${currentGuidedStep.targetFiles.map(file => `<code>${esc(file)}</code>`).join('')}</div><p>${esc(currentGuidedStep.instruction)}</p><small><b>完成标志</b>${esc(currentGuidedStep.verify)}</small></div></article>${projectGuidedCodeDelivery(currentGuidedStep)}<div class="project-guided-controls"><button class="park-button secondary" type="button" data-guided-action="back"${currentIndex === 0 ? ' disabled' : ''}>上一步</button>${currentIndex < step.guidedSteps.length - 1 ? `<button class="park-button primary" type="button" data-guided-action="next"${currentCodeReady ? '' : ' disabled'}>${currentCodeReady ? '本步完成，进入下一步' : '等待完整代码包'}</button>` : progress.completed && allCodeReady ? `<span class="project-guided-done">${step.guidedSteps.length} 个引导步骤已经完成</span>` : `<button class="park-button primary" type="button" data-guided-action="complete"${currentCodeReady && allCodeReady ? '' : ' disabled'}>${currentCodeReady && allCodeReady ? '完成引导，进入独立检查' : '等待完整代码包'}</button>`}</div></section>`
    : '';
  const runbookGroups = step.runbook ? [
    ['编译', step.runbook.buildCommands, true],
    ['运行', step.runbook.runActions, false],
    ['预期', step.runbook.expectedResults, false]
  ].filter(([, items]) => items?.length) : [];
  const runbook = conceptReady && runbookGroups.length
    ? `<details class="project-runbook" aria-label="本章运行手册"><summary>现在编译、运行并核对结果</summary><div class="project-runbook-grid">${runbookGroups.map(([label, items, command]) => `<div><strong>${esc(label)}</strong><ol>${items.map(item => `<li>${command ? `<code>${esc(item)}</code>` : esc(item)}</li>`).join('')}</ol></div>`).join('')}</div></details>`
    : '';
  const conceptModule = projectConceptModule(step, progress);
  if (!meta.length && !policyCopy && !environmentCopy && !files && !conceptModule && !guidedSteps && !runbook) return { html: '', complete: true, conceptComplete: true };
  return { complete: conceptReady && progress.completed && allCodeReady, conceptComplete: conceptReady, html: `<div class="project-course-guide">
    ${meta.length ? `<section class="project-chapter-meta">${meta.map(([label, value]) => `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('')}</section>` : ''}
    ${policyCopy}${conceptModule}${environmentCopy}${files}${guidedSteps}${projectChapterSnapshot(step, conceptReady && progress.completed && allCodeReady)}${previewSession && conceptReady && step.guidedSteps?.length ? `<div class="project-guided-controls"><button class="park-button secondary" type="button" data-guided-action="preview-checkpoint"${currentCodeReady ? '' : ' disabled'}>直接查看独立检查</button></div>` : ''}${runbook}
  </div>` };
}

function renderProjectInteraction(step) {
  const boss = isProjectBoss(step);
  const previous = state.answers.get(step.id) || {};
  const checkpoint = step.checkpoint || {};
  const bossCodeReady = !state.level?.codeDelivery || (state.codePackageStatus === 'ready' && Boolean(finalSourceModel(state.codePackage)));
  const guide = boss ? { html: projectFinalSource(), complete: bossCodeReady, conceptComplete: true } : projectChapterGuide(step);
  const concepts = boss ? [] : step.concepts || [];
  const checks = boss
    ? (step.phases || []).flatMap(phase => (phase.successCriteria || []).map(text => ({ group: phase.title, text })))
    : [
        ...(checkpoint.automatedChecks || []).map(text => ({ group: '建议本地检查', text })),
        ...(checkpoint.selfChecks || []).map(text => ({ group: '人工自检', text }))
      ];
  const points = boss ? step.performancePoints : null;
  $('#interaction-root').innerHTML = `<div class="project-work">
    ${projectNavigation(step)}
    ${concepts.length && !step.conceptModule ? `<div class="concept-chips" aria-label="本章概念">${concepts.map(concept => `<span>${esc(concept)}</span>`).join('')}</div>` : ''}
    <section class="project-brief"><p class="section-label">${boss ? 'Boss 故障场景' : '逐步构建'}</p><p>${esc(boss ? step.story : step.guidedBuild)}</p></section>
    ${guide.html}
    ${boss ? `<div class="fault-chips" aria-label="需要覆盖的故障">${(step.faultScenarios || []).map(item => `<span>${esc(item)}</span>`).join('')}</div>` : guide.complete ? `<section class="checkpoint-task"><strong>这次独立检查</strong><p>${esc(checkpoint.task || '')}</p><small>建议证据：${esc(checkpoint.evidence || '可复现的输出或记录')}</small></section>` : `<section class="checkpoint-locked"><strong>${guide.conceptComplete ? '独立检查尚未展开' : '代码引导尚未解锁'}</strong><p>${guide.conceptComplete ? '依次完成上面的三个代码引导步骤后，这里会出现本章独立变式。' : '先完成概念理解与全部理解题，再开始本章代码。'}</p></section>`}
    ${guide.complete && checks.length ? `<div class="project-checklist">${checks.map((item, index) => `<div><span>${index + 1}</span><p><small>${esc(item.group)}</small>${esc(item.text)}</p></div>`).join('')}</div>` : ''}
    ${guide.complete ? `
    <label class="evidence-field" for="project-evidence"><span>证据与本次结果</span><textarea id="project-evidence" rows="5" placeholder="记录文件路径、运行命令、关键输出和尚未解决的问题。">${esc(previous.evidence || '')}</textarea></label>
    ${points ? `<label class="performance-field" for="performance-points"><span>本次表现分 <small>达到 ${points.pass} / ${points.maximum} 可通过本段 Boss</small></span><input id="performance-points" type="number" inputmode="numeric" min="0" max="${points.maximum}" value="${esc(previous.performancePoints ?? 0)}"></label>` : ''}
    <div class="project-confirmations">
      <label><input id="project-passed" type="checkbox"${previous.passed ? ' checked' : ''}><span><strong>我已按上面清单完成自检</strong><small>这是学习者自检记录，管理者可在后台查看。</small></span></label>
      <label><input id="project-independent" type="checkbox"${boss || previous.independent ? ' checked' : ''}${boss ? ' disabled' : ''}><span><strong>${boss ? 'Boss 必须独立完成' : '这一步由我独立完成'}</strong><small>${boss ? '可以查阅自己的旧记录，不由他人代做。' : '勾选后通过才会授予本章星星。'}</small></span></label>
    </div>` : ''}
  </div>`;
  $('#check-step').disabled = !guide.complete;
  updateResetControl(step);
}

function renderInteraction(step) {
  switch (answerKindOf(step, state.mode)) {
    case 'project': renderProjectInteraction(step); break;
    case 'reorder': renderReorder(step); break;
    case 'choice': renderChoice(step); break;
    case 'number': renderNumber(step); break;
    case 'structured': renderStructured(step); break;
    case 'code':
    case 'observe': renderCode(step); break;
    case 'text': renderText(step); break;
    default: renderExperience(step);
  }
}

function actionLabel(step) {
  if (state.mode === 'project') return previewSession
    ? isProjectBoss(step) ? '模拟 Boss 自检' : '模拟本章自检'
    : isProjectBoss(step) ? '提交 Boss 自检' : '保存本章自检';
  if (isIndependent(step)) return isTerminalStep(step) ? '独立运行这组命令' : '独立运行这个变式';
  if (isCodeStep(step)) return isTerminalStep(step) ? '运行命令并看结果' : '运行并看结果';
  if ((step.interaction?.kind || step.interaction?.type) === 'reorder') return '保留预测并继续';
  if (['explanation', 'explain'].includes(stepType(step))) return '检查我的解释';
  return '我观察好了';
}

function renderStep() {
  try {
    renderStepContent();
    reportPreviewState();
  } catch (error) {
    if (!previewRequested) throw error;
    setPhase('error', `课程草稿暂时无法展示：${error.message}`);
    postPreviewMessage({ type: 'eggy-preview-error', message: `课程草稿暂时无法展示：${error.message}` });
  }
}

function renderStepContent() {
  const step = currentStep();
  if (!step) { setPhase('empty'); return; }
  state.feedback = null;
  renderChrome();
  const variant = selectedVariant(step);
  const prompt = variant?.prompt || step.prompt || step.goal || step.story || '按照当前目标完成这一步。';
  $('#play-view').dataset.mode = state.mode;
  if (state.mode === 'project') {
    const rank = rankInfo();
    const artwork = sceneArtwork();
    $('#scene-backdrop').src = artwork.src;
    $('#scene-panel').style.setProperty('--scene-position', artwork.position);
    $('#scene-rank').textContent = rank.name || state.level.rankId;
    $('#scene-building').textContent = rank.building || state.level.locationIds?.[0] || '当前项目';
    $('#scene-caption').textContent = state.level.story || '把这一段技术逐步做成可运行的作品。';
    $('#scene-output').dataset.state = 'ready';
    $('#scene-output p').textContent = projectScenePrompt(step);
  }
  $('#step-kind').textContent = KIND_LABELS[stepType(step)] || '当前步骤';
  $('#step-title').textContent = step.title || (variant ? variant.title : '') || KIND_LABELS[stepType(step)] || '继续游玩';
  $('#step-prompt').textContent = prompt;
  $('#check-step').hidden = false;
  $('#check-step').textContent = actionLabel(step);
  $('#show-hint').hidden = hintEntries(step).length === 0 && !hasFullSolution(step);
  $('#feedback-panel').hidden = true;
  $('#step-form').hidden = false;
  $('#step-error').textContent = '';
  $('#step-form').querySelectorAll('input,textarea,button').forEach(control => { control.disabled = false; });
  renderInteraction(step);
  updateResetControl(step);
  const conceptPending = state.mode === 'project' && !isProjectBoss(step) && step.conceptModule && !projectGuidedProgress(step).conceptCompleted;
  if (conceptPending) {
    $('#check-step').hidden = true;
    $('#show-hint').hidden = true;
    $('#reset-step').hidden = true;
  }
  requestAnimationFrame(() => $('#step-title').focus?.({ preventScroll: true }));
}

function conceptResetItem(step = currentStep()) {
  if (state.mode !== 'project') return null;
  return conceptResetTarget(step?.conceptModule, projectGuidedProgress(step));
}

function updateResetControl(step = currentStep()) {
  const button = $('#reset-step');
  if (!button) return;
  const concept = conceptResetItem(step);
  const label = concept ? 'concept-choice' : answerKindOf(step, state.mode);
  button.hidden = concept ? !concept.answered : !canResetAnswer(label);
  if (button.hidden) return;
  button.textContent = resetActionLabel(label);
  button.title = RESET_BUTTON_HINT;
  button.disabled = state.submitting;
}

// 重置只清掉本地作答：服务端已写入的尝试记录无法撤销，也不应被抹掉。
function resetStepAnswer() {
  const step = currentStep();
  if (!step || state.submitting) return;
  const concept = conceptResetItem(step);
  if (concept) {
    if (!concept.answered) return;
    const progress = projectGuidedProgress(step);
    const conceptAnswers = { ...(progress.conceptAnswers || {}) };
    delete conceptAnswers[concept.checkId];
    saveGuidedProgress(step, {
      ...progress,
      conceptAnswers,
      conceptFeedback: '',
      conceptFeedbackKind: '',
      conceptFeedbackCheckId: '',
      conceptAwaitingAdvance: false
    });
    state.lastResult = null;
    $('#scene-output p').textContent = projectScenePrompt(step);
    renderProjectInteraction(step);
    reportPreviewState();
    showNotice(resetNoticeText('concept-choice'), 'success');
    requestAnimationFrame(() => $('input[name="concept-choice"]', $('#interaction-root'))?.focus({ preventScroll: true }));
    return;
  }
  const kind = answerKindOf(step, state.mode);
  if (!canResetAnswer(kind)) return;
  state.answers.delete(step.id);
  state.orders.delete(step.id);
  state.pendingRequests.delete(pendingRequestKey(false, step));
  state.lastResult = null;
  state.feedback = null;
  renderStep();
  showNotice(resetNoticeText(kind), 'success');
  requestAnimationFrame(() => ($('#code-answer') || $('#text-answer') || $('#number-answer') || $('[data-answer-key]') || $('input[name="step-choice"]'))?.focus({ preventScroll: true }));
}

function readAnswer(step = currentStep()) {
  if (state.mode === 'project') return {
    evidence: $('#project-evidence')?.value.trim() || '',
    passed: $('#project-passed')?.checked === true,
    independent: isProjectBoss(step) || $('#project-independent')?.checked === true,
    performancePoints: $('#performance-points') ? Number($('#performance-points').value) : undefined
  };
  const interaction = step.interaction?.kind || step.interaction?.type;
  if (interaction === 'reorder' || step.evaluator?.kind === 'exact-order') return [...(state.orders.get(step.id) || [])];
  if (interaction === 'choice' || interaction === 'single-choice') return $('input[name="step-choice"]:checked')?.value ?? '';
  if ($('#number-answer')) return $('#number-answer').value;
  if ($('.structured-answer')) {
    const numeric = step.evaluator?.kind === 'object-exact';
    return Object.fromEntries($$('[data-answer-key]', $('#interaction-root')).map(input => [input.dataset.answerKey, numeric && input.value !== '' ? Number(input.value) : input.value]));
  }
  if (isCodeStep(step)) {
    const filename = isTerminalStep(step)
      ? 'session.sh'
      : step.starterFiles?.['main.cpp'] !== undefined || selectedVariant(step)?.starterFiles?.['main.cpp'] !== undefined ? 'main.cpp' : 'main.c';
    return { files: { [filename]: $('#code-answer')?.value || '' }, stdin: step.stdin || selectedVariant(step)?.stdin || '' };
  }
  if ($('#text-answer')) return $('#text-answer').value;
  return { acknowledged: true };
}

function validateAnswer(step, answer) {
  if (state.mode === 'project') {
    if (!answer.evidence) return '先记下这次的文件、运行结果或尚未完成的问题。';
    const maximum = isProjectBoss(step) ? step.performancePoints?.maximum : undefined;
    if (maximum && (!Number.isInteger(answer.performancePoints) || answer.performancePoints < 0 || answer.performancePoints > maximum)) return `表现分需要是 0–${maximum} 的整数。`;
    return '';
  }
  if (['choice', 'single-choice'].includes(step.interaction?.kind || step.interaction?.type) && !answer) return '先选一个答案，再看检查结果。';
  if ($('#text-answer')) {
    const minimum = Number(step.answerPolicy?.minimumCharacters || 1);
    if (String(answer).trim().length < minimum) return minimum > 1 ? `先用至少 ${minimum} 个字说出你的解释。` : '先写下自己的解释。';
  }
  if ($('#number-answer') && answer === '') return '先写下你预测的数值。';
  if ($('.structured-answer') && Object.values(answer).some(value => value === '' || Number.isNaN(value))) return '先完成每一项预测。';
  if (isCodeStep(step) && !Object.values(answer.files || {}).some(code => code.trim())) return isTerminalStep(step) ? '命令区还是空的。' : '代码区还是空的。';
  return '';
}

function serializeAnswer(answer) {
  if (answer === null || answer === undefined) return '';
  if (typeof answer === 'string') return answer;
  if (answer?.files && typeof answer.files === 'object') return String(Object.values(answer.files)[0] || '');
  return JSON.stringify(answer);
}

function submitAction(step) {
  if (isIndependent(step) || stepType(step) === 'boss') return 'submit';
  if (isCodeStep(step)) return 'run';
  return 'check';
}

function pendingRequestKey(projectMode, step) {
  return `${projectMode ? 'project' : 'level'}:${state.level.id}:${step.id}`;
}

function requestIdFor(projectMode, step, draft) {
  const key = pendingRequestKey(projectMode, step);
  const signature = JSON.stringify(draft);
  const pending = state.pendingRequests.get(key);
  if (pending?.signature === signature) return pending.requestId;
  const requestId = makeRequestId(projectMode ? 'project' : draft.action);
  state.pendingRequests.set(key, { signature, requestId });
  return requestId;
}

function attemptBody(action, step = currentStep(), answer = null) {
  const draft = {
    levelId: state.level.id,
    contentVersion: state.level.version || state.level.contentVersion || 1,
    stepId: step.id,
    variantId: selectedVariant(step)?.id || '',
    action,
    answer: serializeAnswer(answer),
    hintLevel: state.hintLevels.get(step.id) || 0,
    viewedFullAnswer: state.viewedFullAnswer.has(step.id)
  };
  return { requestId: requestIdFor(false, step, draft), ...draft };
}

function projectAttemptBody(step, answer) {
  const draft = {
    projectId: state.level.id,
    contentVersion: state.level.version || 1,
    checkpointId: step.id,
    action: answer.passed ? 'submit' : 'check',
    evidence: answer.evidence,
    hintLevel: state.hintLevels.get(step.id) || 0,
    viewedFullAnswer: state.viewedFullAnswer.has(step.id),
    passed: answer.passed,
    independent: answer.independent
  };
  if (answer.performancePoints !== undefined) draft.performancePoints = answer.performancePoints;
  return { requestId: requestIdFor(true, step, draft), ...draft };
}

function normalizeAttemptResult(data) {
  const result = typeof data.result === 'object' && data.result ? data.result : data.attempt || data;
  const feedback = typeof data.feedback === 'object' && data.feedback ? data.feedback : result.feedback || {};
  const next = typeof data.next === 'object' && data.next ? data.next : {};
  const earned = [];
  if (Number(result.xpAwarded) > 0) earned.push({ kind: 'xp', amount: result.xpAwarded });
  if (result.starAwarded === true) earned.push({ kind: 'star', amount: 1 });
  if (result.tokenAwarded) earned.push({ kind: 'token', title: '新的段位信物' });
  if (result.rankPromoted) earned.push({ kind: 'rank', title: `晋升 ${rankBlueprint(result.rankPromoted)?.name || result.rankPromoted}` });
  for (const achievement of data.achievements || []) earned.push({ kind: 'achievement', title: achievement.title || '新成就' });
  const nextActivityId = next.activityId || next.levelId || next.nextLevelId || result.nextLevelId || data.nextLevelId || '';
  return {
    passed: feedback.passed === true || data.passed === true || result.passed === true || result.status === 'passed' || result.correct === true,
    completed: result.completed === true || result.levelCompleted === true || data.levelCompleted === true || next.completed === true || next.kind === 'level-complete' || data.progress?.levelCompleted === true || (state.activityCompleted && state.index === steps().length - 1 && feedback.passed === true && (!masteryPractice || result.starAwarded === true)),
    starAwarded: result.starAwarded === true,
    message: feedback.message || (typeof result.feedback === 'string' ? result.feedback : '') || result.message || (result.passed ? '这一步已经通过。' : '先对照实际结果，再调整一次。'),
    output: feedback.actualOutput ?? feedback.output ?? feedback.stdout ?? result.actualOutput ?? result.output ?? result.runtime?.stdout ?? '',
    nextStepId: nextActivityId && nextActivityId !== state.level?.id ? '' : next.stepId || next.nextStepId || result.nextStepId || '',
    rewards: result.rewards || data.rewards || earned,
    replacementVariant: next.replacementVariant || result.replacementVariant || data.replacementVariant || null,
    progress: data.progress || result.progress || null,
    nextLevelId: nextActivityId && nextActivityId !== state.level?.id ? nextActivityId : ''
  };
}

function renderFeedback(result) {
  state.lastResult = result;
  const panel = $('#feedback-panel');
  panel.hidden = false;
  panel.dataset.result = result.passed ? 'passed' : 'retry';
  $('#feedback-title').textContent = result.selfCheck ? (result.passed ? '自检已记录' : '本次记录已保存') : result.passed ? '实际结果和规则一致' : '先看实际结果';
  $('#feedback-message').textContent = result.message;
  $('#feedback-output').hidden = !result.output;
  $('#feedback-output').textContent = result.output;
  if (state.mode === 'project') {
    $('#scene-output').dataset.state = result.passed ? 'success' : 'error';
    $('#scene-output p').textContent = result.output || result.message;
  }
  $('#next-step').textContent = result.passed ? (state.index === steps().length - 1 || result.completed ? '收下这次成果' : '继续下一步') : result.selfCheck ? '继续完善作品' : '修改后再试';
  if (result.completed && !result.nextLevelId) $('#next-step').textContent = '查看下一步安排';
  if (result.completed && isIndependent(currentStep()) && !result.starAwarded) {
    $('#feedback-message').textContent = `${result.message} ${result.nextLevelId ? '可以进入下一章' : '请查看下一步安排'}；本次没有获得独立星星。`;
  }
  if (previewSession) {
    if (result.selfCheck) $('#feedback-title').textContent = result.passed ? '模拟自检通过' : '模拟自检结果';
    $('#next-step').textContent = result.passed ? state.index < steps().length - 1 ? '查看下一题' : '重新查看本题' : '修改后再试';
  }
  if (result.passed) $('#check-step').textContent = '本步已通过';
  if (result.passed) $('#step-form').querySelectorAll('input,textarea,button').forEach(control => { if (control.id !== 'reset-step') control.disabled = true; });
  $('#next-step').disabled = false;
  if (result.passed) playTone('success');
  panel.scrollIntoView({ behavior: document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth', block: 'nearest' });
}

async function submitStep(event) {
  event.preventDefault();
  if (state.submitting) return;
  const step = currentStep();
  const answer = readAnswer(step);
  const validation = validateAnswer(step, answer);
  if (validation) { $('#step-error').textContent = validation; return; }
  state.answers.set(step.id, answer);
  const revision = previewRevision;
  state.submitting = true;
  reportPreviewState();
  state.lastResult = null;
  $('#step-error').textContent = '';
  $('#check-step').disabled = true;
  $('#reset-step').disabled = true;
  $('#check-step').textContent = state.mode === 'project' ? previewSession ? '正在模拟自检…' : '正在保存…' : isCodeStep(step) ? '正在运行…' : '正在检查…';
  try {
    const projectMode = state.mode === 'project';
    const path = previewSession ? '/api/admin/preview/attempt' : projectMode ? '/api/play/project-attempts' : '/api/play/attempts';
    const draft = projectMode ? projectAttemptBody(step, answer) : attemptBody(submitAction(step), step, answer);
    const payload = previewSession ? previewAttemptBody(previewSession, draft) : draft;
    const response = await requestJSON(path, { method: 'POST', body: JSON.stringify(payload) });
    if (previewRequested && revision !== previewRevision) return;
    state.pendingRequests.delete(pendingRequestKey(projectMode, step));
    if (previewSession) {
      renderFeedback({ ...normalizeAttemptResult(response.data), completed: false, nextLevelId: '', rewards: [], selfCheck: projectMode });
      return;
    }
    const completedProjectBoss = projectMode && isProjectBoss(step) && (response.data.progress?.projectArtifacts || []).some(item => item.projectId === state.level.id && item.bossCompletedAt);
    const accepted = projectMode
      ? (isProjectBoss(step) ? response.data.result?.levelCompleted === true || completedProjectBoss : answer.passed)
      : undefined;
    const data = projectMode ? {
      ...response.data,
      feedback: {
        passed: accepted,
        message: accepted
          ? '自检完成，证据已保存，管理者可在后台查看记录。'
          : answer.passed ? '证据已保存，但 Boss 的通过条件尚未满足。' : '本次自检已保存，完善作品后可以再次提交。',
        actualOutput: answer.evidence
      },
      next: {
        activityId: response.data.progress?.current?.activityId || state.level.id,
        stepId: response.data.progress?.current?.stepId || step.id
      }
    } : response.data;
    const result = normalizeAttemptResult(data);
    if (!projectMode && response.data.result?.levelCompleted) state.activityCompleted = true;
    result.selfCheck = projectMode;
    if (result.progress) state.progress = result.progress;
    if (!result.completed && result.replacementVariant && isIndependent(step)) {
      const replacement = result.replacementVariant;
      step.variants = [...(step.variants || []).filter(variant => variant.id !== replacement.id), replacement];
      state.variantAssignments.set(step.id, replacement.id);
      state.answers.delete(step.id);
      state.hintLevels.set(step.id, 0);
      state.viewedFullAnswer.delete(step.id);
      state.lastResult = null;
      renderStep();
      showNotice('已换成未看答案的等价变式。独立完成后仍可获得星星。', 'success');
      return;
    }
    renderFeedback(result);
  } catch (error) {
    if (previewRequested && revision !== previewRevision) return;
    $('#step-error').textContent = `${error.message}你的当前输入仍保留在页面上。`;
  } finally {
    if (!previewRequested || revision === previewRevision) {
      state.submitting = false;
      reportPreviewState();
      $('#reset-step').disabled = false;
      if (!state.lastResult) {
        $('#check-step').disabled = false;
        $('#check-step').textContent = actionLabel(step);
      }
    }
  }
}

function rewardLabel(reward) {
  if (typeof reward === 'string') return reward;
  if (reward.title) return reward.title;
  if (reward.kind === 'xp' || reward.xp) return `+${reward.amount || reward.xp} XP`;
  if (reward.kind === 'star' || reward.stars) return `+${reward.amount || reward.stars} 星`;
  return reward.kind || '新成果';
}

function showCompletion(result) {
  const rewards = Array.isArray(result.rewards) ? result.rewards : Object.entries(result.rewards || {}).map(([kind, amount]) => ({ kind, amount }));
  $('#reward-list').innerHTML = rewards.length ? rewards.map(reward => `<span class="reward-chip">${esc(rewardLabel(reward))}</span>`).join('') : '<span class="reward-chip">关卡进度已保存</span>';
  $('#complete-copy').textContent = state.mode === 'project'
    ? '作品证据、独立完成状态和奖励已保存，管理者可在后台回看。'
    : isIndependent(currentStep())
      ? rewards.some(reward => reward.kind === 'star')
        ? '本章已完成，独立星星和经验已保存，可以继续下一章。'
        : '本章练习已完成，可以继续下一章。本次未获得独立星星；晋段仍需要满足独立完成条件。'
      : '这一关的完成状态已经记录，下次会从新位置继续。';
  $('#continue-next-level').href = '/learner.html#lobby';
  $('#continue-next-level').textContent = '回到大厅';
  if (result.nextLevelId) {
    $('#continue-next-level').href = `/play.html?level=${encodeURIComponent(result.nextLevelId)}`;
    $('#continue-next-level').textContent = '继续下一关';
    if (masteryPractice && result.starAwarded && result.nextLevelId !== state.payload?.rank?.promotion?.bossActivityId) {
      $('#continue-next-level').href = '/learner.html#map';
      $('#continue-next-level').textContent = '回到地图继续补星';
    }
  } else if (state.mode === 'level' && state.payload?.rank?.promotion?.metric === 'stars') {
    const earned = (state.progress?.awardLedger || []).filter(item => item.kind === 'star' && item.rankId === state.level.rankId).reduce((sum, item) => sum + item.amount, 0);
    const missing = Math.max(0, state.payload.rank.promotion.requiredStars - earned);
    if (missing) {
      $('#complete-copy').textContent = `本章练习已完成，无需重复提交。当前有 ${earned} 颗独立星星，还差 ${missing} 颗才能进入本段 Boss。回到段位地图选择“补星挑战”，可以直接练习未看答案的等价变式。`;
      $('#continue-next-level').href = '/learner.html#map';
      $('#continue-next-level').textContent = '回到地图查看独立星星';
    }
  }
  playTone('reward');
  const dialog = $('#complete-dialog');
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
}

function advanceStep() {
  const result = state.lastResult;
  if (previewSession) {
    selectPreviewStep(result?.passed && state.index < steps().length - 1 ? state.index + 1 : state.index);
    return;
  }
  if (!result?.passed) {
    state.lastResult = null;
    renderStep();
    ($('#code-answer') || $('#text-answer') || $('input[name="step-choice"]'))?.focus();
    return;
  }
  if (result.completed || result.nextLevelId) { showCompletion(result); return; }
  const nextIndex = result.nextStepId ? steps().findIndex(step => step.id === result.nextStepId) : -1;
  if (nextIndex >= 0) {
    if (nextIndex === state.index) {
      state.lastResult = null;
      renderStep();
      showNotice(state.mode === 'project' ? '本章自检已记录。要获得本章星星，请保持独立完成并再次检查；也可以从上方回访其他章节。' : '这一步的记录已保存，请按反馈再检查一次。');
      return;
    }
    state.index = nextIndex;
  } else if (state.index < steps().length - 1) {
    state.index += 1;
  } else {
    state.lastResult = null;
    renderStep();
    showNotice('运行结果已保存，但本章完成条件尚未满足，请核对反馈后继续练习。');
    return;
  }
  state.lastResult = null;
  renderStep();
  window.scrollTo({ top: 0, behavior: document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth' });
}

function renderHints() {
  const step = currentStep();
  const hints = hintEntries(step);
  const level = state.hintLevels.get(step.id) || 0;
  const visibleHints = hints.filter(hint => hint.tier <= Math.min(level, 3));
  const hintMarkup = visibleHints.map(hint => `<div class="hint-step"><span>${hint.tier}</span><p>${esc(hint.text)}</p></div>`).join('');
  $('#hint-content').innerHTML = hintMarkup || '<p>点击下方按钮，只展开当前需要的一层提示。</p>';
  $('#next-hint').hidden = level >= hints.length;
  $('#next-hint').textContent = level ? '再给一层提示' : '给我第一层提示';
  const source = fullSolution(step);
  const alreadyVisible = state.viewedFullAnswer.has(step.id) && Boolean(source);
  $('#reveal-answer').hidden = !(level >= hints.length && hasFullSolution(step) && !alreadyVisible);
  $('#reveal-answer').textContent = fullSolutionLabel(step);
  if (isIndependent(step) && !alreadyVisible && level >= hints.length && hasFullSolution(step)) {
    const explanation = previewSession
      ? '模拟查看完整思路只影响当前预览，不会产生学习记录或星星。'
      : state.payload?.masteryRenewable
      ? '查看后，这个变式用于练习。系统会提供另一道未看答案的等价题，独立通过才能获得星星。'
      : canReplaceRevealedVariant(step)
      ? '查看后，这个变式用于练习；独立星星需要通过另一道未看答案的等价变式。'
      : '这是最后一道未看答案的变式。查看后仍可练习，独立星星需要管理者补充新的等价变式。';
    $('#hint-content').insertAdjacentHTML('beforeend', `<p class="solution-policy">${esc(explanation)}</p>`);
  }
  if (alreadyVisible) {
    const heading = fullSolutionLabel(step).replace(/^查看/, '');
    $('#hint-content').insertAdjacentHTML('beforeend', `<div class="full-answer" tabindex="-1" role="region" aria-label="${esc(heading)}"><strong>${esc(heading)}</strong><eggy-code language="${isTerminalStep(step) ? 'bash' : step.starterFiles?.['main.cpp'] !== undefined || selectedVariant(step)?.starterFiles?.['main.cpp'] !== undefined ? 'cpp' : 'c'}">${esc(fullSolution(step))}</eggy-code></div>`);
  }
}

function openHints() {
  renderHints();
  const dialog = $('#hint-dialog');
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
}

function nextHint() {
  const step = currentStep();
  const maxLevel = hintEntries(step).length;
  const next = Math.min(maxLevel, (state.hintLevels.get(step.id) || 0) + 1);
  state.hintLevels.set(step.id, next);
  renderHints();
}

async function revealAnswer() {
  const step = currentStep();
  if (!hasFullSolution(step) || state.submitting) return;
  if (!isIndependent(step)) {
    state.viewedFullAnswer.add(step.id);
    renderHints();
    $('#hint-content .full-answer')?.focus();
    showNotice(previewSession ? '完整思路已展开，仅用于本次模拟学习。' : '完整思路已展开，已有奖励不受影响。');
    return;
  }

  const button = $('#reveal-answer');
  const originalLabel = button.textContent;
  const previouslyViewed = state.viewedFullAnswer.has(step.id);
  const revision = previewRevision;
  state.hintLevels.set(step.id, 3);
  state.viewedFullAnswer.add(step.id);
  state.submitting = true;
  reportPreviewState();
  button.disabled = true;
  button.textContent = previewSession ? '正在展开…' : '正在记录…';
  try {
    const draft = attemptBody('reveal', step, '');
    const payload = previewSession ? previewAttemptBody(previewSession, draft, 'reveal') : draft;
    const response = await requestJSON(previewSession ? '/api/admin/preview/attempt' : '/api/play/attempts', { method: 'POST', body: JSON.stringify(payload) });
    if (previewRequested && revision !== previewRevision) return;
    if (response.data.progress) state.progress = response.data.progress;
    const revealed = response.data.reveal;
    if (!revealed || revealed.variantId !== selectedVariant(step)?.id || !revealed.fullSolution) throw new Error('服务端没有返回当前变式的完整思路。');
    state.pendingRequests.delete(pendingRequestKey(false, step));
    state.revealedSolutions.set(solutionKey(step), revealed.fullSolution);
    renderHints();
    $('#hint-content .full-answer')?.focus();
    showNotice(previewSession ? '完整思路已展开，仅用于本次模拟学习。' : response.data.next?.replacementVariant
      ? '完整代码已展开。当前变式可继续练习；刷新或提交后会换成等价新变式，独立完成仍可获得星星。'
      : '完整代码已展开。当前变式可继续练习；独立星星需要管理者补充新的等价变式。');
  } catch (error) {
    if (previewRequested && revision !== previewRevision) return;
    if (!previouslyViewed) state.viewedFullAnswer.delete(step.id);
    renderHints();
    showNotice(`${error.message} 完整思路尚未展开，请重试。`, 'error');
  } finally {
    if (!previewRequested || revision === previewRevision) {
      state.submitting = false;
      reportPreviewState();
      button.disabled = false;
      if (!state.viewedFullAnswer.has(step.id)) button.textContent = originalLabel;
    }
  }
}

async function copyAIContext() {
  const button = $('#copy-ai-context');
  const original = button.textContent;
  try {
    const chapter = currentStep();
    const progress = state.mode === 'project' && chapter?.guidedSteps?.length ? projectGuidedProgress(chapter) : null;
    const guided = progress ? chapter.guidedSteps[progress.index] : null;
    const rawAnswer = readAnswer(chapter);
    const answer = typeof rawAnswer === 'string' ? rawAnswer : JSON.stringify(rawAnswer, null, 2);
    let contextStep = chapter;
    let contextAnswer = answer;
    if (state.mode === 'project') {
      const tutorInstruction = state.level.aiContext?.tutorInstruction ? `项目导师要求：${state.level.aiContext.tutorInstruction}\n` : '';
      if (isProjectBoss(chapter)) {
        const phases = (chapter.phases || []).map(phase => `${phase.title}：${(phase.successCriteria || []).join('；')}`).join('\n');
        contextAnswer = `${tutorInstruction}Boss 任务：${chapter.story || chapter.goal || chapter.title}\n验收阶段：\n${phases || '（未配置）'}\n故障范围：${(chapter.faultScenarios || []).join('、') || '（未配置）'}\n\n我的记录：\n${answer}`;
      } else if (chapter.conceptModule && !progress?.conceptCompleted) {
        const module = chapter.conceptModule;
        const check = module.checks.find(item => item.id === progress?.conceptFeedbackCheckId)
          || pendingConceptCheck(module.checks, progress?.conceptPassedIds);
        const selectedOptionId = check ? progress?.conceptAnswers?.[check.id] : '';
        const selectedOption = check?.options.find(option => option.id === selectedOptionId);
        contextStep = { ...chapter, title: `${chapter.title} · 概念理解` };
        contextAnswer = `${tutorInstruction}本章概念目标：${module.learningGoal}\n现象：${module.phenomenon.observation}\n观察问题：${module.phenomenon.question}\n心智模型：${module.mentalModel.summary}\n关键术语：${module.terms.map(item => `${item.term}（${item.plainMeaning}；代码中是 ${item.codeMapping}）`).join('；')}\n当前理解题：${check?.question || '尚未进入理解题'}\n我的选择：${selectedOption?.text || '尚未选择'}\n当前反馈：${progress?.conceptFeedback || '尚未检查'}\n\n请先用白话纠正我的心智模型，再用一个最小例子提问我；不要直接替我完成后面的代码。`;
      } else if (progress?.completed) {
        contextStep = { ...chapter, title: `${chapter.title} · 独立检查` };
        contextAnswer = `${tutorInstruction}本章里程碑：${chapter.milestone || chapter.goal}\n独立检查：${chapter.checkpoint?.task || '（未配置）'}\n建议证据：${chapter.checkpoint?.evidence || '（未配置）'}\n自动检查：${(chapter.checkpoint?.automatedChecks || []).join('；') || '（未配置）'}\n人工自检：${(chapter.checkpoint?.selfChecks || []).join('；') || '（未配置）'}\n当前回看的引导：${guided?.title || '无'}\n\n我的记录：\n${answer}`;
      } else if (guided) {
        contextStep = { ...chapter, title: `${chapter.title} · ${guided.title}` };
        contextAnswer = `${tutorInstruction}当前目标文件：${guided.targetFiles.join('、')}\n当前引导：${guided.instruction}\n完成标志：${guided.verify}\n\n我的记录：\n${answer}`;
      }
    }
    const context = buildAIContext({
      level: state.level,
      step: contextStep,
      answer: contextAnswer,
      feedback: state.lastResult,
      hintLevel: state.hintLevels.get(chapter.id) || 0
    });
    await copyText(context);
    button.textContent = '已复制，去询问 AI 导师';
    showNotice('已复制当前目标、代码、结果和提示记录。回来后请先用自己的话重新思考。', 'success');
  } catch (error) {
    showNotice(`复制失败：${error.message}`, 'error');
  } finally {
    setTimeout(() => { button.textContent = original; }, 2600);
  }
}

function moveOrder(index, direction) {
  const step = currentStep();
  const order = state.orders.get(step.id);
  const target = index + direction;
  if (!order || target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  renderReorder(step);
  $(`[data-index="${target}"][data-move="${direction}"]`)?.focus();
}

async function loadLevel() {
  if (previewRequested) {
    if (!embeddedPreview) {
      setPhase('error', '请从课程工坊打开模拟学习。');
      $('#retry-level').hidden = true;
    } else {
      setPhase('loading');
      postPreviewMessage({ type: 'eggy-preview-ready' });
    }
    return;
  }
  if (!levelId) {
    setPhase('error', '网址中缺少关卡编号。请从段位地图重新进入。');
    return;
  }
  setPhase('loading');
  try {
    state.codePackage = null;
    state.codePackageStatus = 'idle';
    state.codePackageError = '';
    const response = await requestJSON(`/api/play/levels/${encodeURIComponent(levelId)}`);
    state.payload = response.data;
    const project = response.data.project;
    const received = project || response.data.level || response.data.activity || response.data;
    state.mode = project ? 'project' : 'level';
    state.level = project ? project : received?.content
      ? { ...received, ...received.content, id: received.id, title: received.title, rankId: received.rankId, locationId: received.locationId, estimatedMinutes: received.estimatedMinutes, version: received.version }
      : received;
    state.progress = response.data.progress || {};
    state.completedStepIds = Array.isArray(response.data.completedStepIds) ? response.data.completedStepIds : [];
    state.activityCompleted = response.data.activityCompleted === true;
    if (project?.codeDelivery) {
      state.codePackageStatus = 'loading';
      try {
        const codeResponse = await requestJSON(`/api/play/projects/${encodeURIComponent(project.id)}/code-package`);
        state.codePackage = matchingCodePackage(project, codeResponse.data);
        state.codePackageStatus = 'ready';
      } catch (error) {
        state.codePackageStatus = 'error';
        state.codePackageError = error.message;
      }
    }
    if (!state.level || !steps().length) {
      setPhase('empty');
      return;
    }
    restoreState();
    setPhase('ready');
    renderStep();
    if (!masteryPractice && state.mode === 'level' && state.activityCompleted && state.index === steps().length - 1) {
      renderFeedback(normalizeAttemptResult({
        result: { levelCompleted: true }, feedback: { passed: true, message: '本章已完成，无需重复提交。' },
        progress: state.progress, next: { activityId: progressCurrent().activityId, stepId: progressCurrent().stepId }
      }));
    }
  } catch (error) {
    setPhase('error', error.message);
  }
}

$('#retry-level').addEventListener('click', loadLevel);
$('#step-form').addEventListener('submit', submitStep);
$('#reset-step').addEventListener('click', resetStepAnswer);
$('#next-step').addEventListener('click', advanceStep);
$('#show-hint').addEventListener('click', openHints);
$('#next-hint').addEventListener('click', nextHint);
$('#reveal-answer').addEventListener('click', revealAnswer);
$('#copy-ai-context').addEventListener('click', copyAIContext);
$('#interaction-root').addEventListener('click', event => {
  const downloadCodeButton = event.target.closest('[data-code-download]');
  if (downloadCodeButton) {
    event.preventDefault();
    event.stopPropagation();
    const sourceState = codeState(state.codePackage, downloadCodeButton.dataset.codeStateId);
    if (!sourceState || !Object.keys(sourceState.files || {}).length) {
      showNotice('这个工程快照为空或已经失效，请刷新后重试。', 'error');
      return;
    }
    const previous = downloadCodeButton.textContent;
    downloadCodeButton.disabled = true;
    downloadCodeButton.textContent = '正在生成 ZIP…';
    try {
      const archive = createProjectStateZip(sourceState.files, {
        projectId: state.level?.id,
        stateId: sourceState.id
      });
      downloadProjectStateZip(archive);
      downloadCodeButton.textContent = '已开始下载';
      showNotice(`已生成 ${archive.fileName}，解压后可直接打开完整工程。`, 'success');
    } catch (error) {
      downloadCodeButton.textContent = previous;
      showNotice(error.message || '生成工程 ZIP 失败，请逐个复制文件。', 'error');
    } finally {
      setTimeout(() => {
        if (!downloadCodeButton.isConnected) return;
        downloadCodeButton.disabled = false;
        downloadCodeButton.textContent = previous;
      }, 1800);
    }
    return;
  }
  const copyCodeButton = event.target.closest('[data-code-copy]');
  if (copyCodeButton) {
    event.preventDefault();
    event.stopPropagation();
    const sourceState = codeState(state.codePackage, copyCodeButton.dataset.codeStateId);
    const source = sourceState?.files?.[copyCodeButton.dataset.codePath];
    if (typeof source !== 'string') {
      showNotice('没有找到这个文件的完整源码，请刷新后重试。', 'error');
      return;
    }
    copyText(source).then(() => {
      const previous = copyCodeButton.textContent;
      copyCodeButton.textContent = '已复制完整文件';
      showNotice(`已复制 ${copyCodeButton.dataset.codePath} 的完整内容。`, 'success');
      setTimeout(() => { if (copyCodeButton.isConnected) copyCodeButton.textContent = previous; }, 1800);
    }).catch(error => showNotice(error.message || '复制失败，请展开代码后手动复制。', 'error'));
    return;
  }
  const osLabButton = event.target.closest('[data-os-lab-action]');
  if (osLabButton) {
    updateOsConceptLab(currentStep(), osLabButton.dataset.osLabAction, osLabButton.dataset.osLabValue);
    return;
  }
  const gpioLabButton = event.target.closest('[data-gpio-lab-action]');
  if (gpioLabButton) {
    updateGpioConceptLab(currentStep(), gpioLabButton.dataset.gpioLabAction, gpioLabButton.dataset.gpioLabValue);
    return;
  }
  const conceptButton = event.target.closest('[data-concept-action]');
  if (conceptButton) {
    updateConceptProgress(currentStep(), conceptButton.dataset.conceptAction, Number(conceptButton.dataset.conceptIndex));
    return;
  }
  const guidedButton = event.target.closest('[data-guided-action]');
  if (guidedButton) {
    updateGuidedProgress(currentStep(), guidedButton.dataset.guidedAction, Number(guidedButton.dataset.guidedIndex));
    return;
  }
  const projectButton = event.target.closest('[data-project-index]');
  if (projectButton) {
    selectProjectStep(Number(projectButton.dataset.projectIndex));
    return;
  }
  const moveButton = event.target.closest('[data-move]');
  if (moveButton) moveOrder(Number(moveButton.dataset.index), Number(moveButton.dataset.move));
});
$('#interaction-root').addEventListener('input', () => {
  $('#step-error').textContent = '';
  state.lastResult = null;
});

if (previewRequested) {
  document.body.dataset.preview = 'workshop';
  // The host owns navigation and settings while this document supplies the learner view.
  document.querySelectorAll('a[href]:not([href^="#"]), .play-tools').forEach(element => { element.hidden = true; });
  $('#play-loading-title').textContent = '正在准备模拟学习…';
  $('#play-loading p').textContent = '正在读取课程工坊中的当前草稿。';
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    // Source ZIPs use same-origin Blob URLs; downloading must not navigate the preview.
    const sourceDownload = link.hasAttribute('download') && href.startsWith(`blob:${location.origin}/`);
    if (!href.startsWith('#') && !sourceDownload) event.preventDefault();
  }, true);
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Escape' || event.isComposing || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    postPreviewMessage({ type: 'eggy-preview-close' });
  });
  window.addEventListener('message', event => {
    if (!embeddedPreview || event.source !== window.parent || event.origin !== location.origin) return;
    try {
      if (event.data?.type === 'eggy-preview-load') loadPreview(event.data);
      else if (event.data?.type === 'eggy-preview-step') selectPreviewStep(event.data.index);
    } catch (error) {
      previewRevision += 1;
      state.submitting = false;
      const message = `课程草稿暂时无法展示：${error.message}`;
      setPhase('error', message);
      postPreviewMessage({ type: 'eggy-preview-error', message });
    }
  });
}

loadLevel();
