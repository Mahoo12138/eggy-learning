import {
  $, $$, buildAIContext, copyText, esc, initComfortControls, makeRequestId,
  playTone, rankBlueprint, requestJSON
} from './park-ui.mjs';

const params = new URLSearchParams(location.search);
const levelId = params.get('level') || '';
const state = {
  phase: 'loading',
  mode: 'level',
  payload: null,
  level: null,
  progress: null,
  completedStepIds: [],
  index: 0,
  answers: new Map(),
  orders: new Map(),
  variantAssignments: new Map(),
  hintLevels: new Map(),
  viewedFullAnswer: new Set(),
  revealedSolutions: new Map(),
  pendingRequests: new Map(),
  feedback: null,
  lastResult: null,
  submitting: false,
  noticeTimer: null
};

initComfortControls();

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
  if (isIndependent(step) && !canReplaceRevealedVariant(step)) return '';
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
    return canReplaceRevealedVariant(step)
      && (Boolean(state.revealedSolutions.get(solutionKey(step, variant))) || variant?.fullSolutionAvailable === true);
  }
  return Boolean(fullSolution(step));
}

function fullSolutionLabel(step = currentStep()) {
  const variant = selectedVariant(step);
  return variant?.fullSolutionKind === 'grader' ? '查看完整校验条件' : '查看完整思路';
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
}

function setPhase(phase, message = '') {
  state.phase = phase;
  $('#play-loading').hidden = phase !== 'loading';
  $('#play-error').hidden = phase !== 'error';
  $('#play-empty').hidden = phase !== 'empty';
  $('#play-view').hidden = phase !== 'ready';
  if (message) $('#play-error-message').textContent = message;
}

function showNotice(message, kind = 'info') {
  const element = $('#play-notice');
  clearTimeout(state.noticeTimer);
  element.textContent = message;
  element.dataset.kind = kind;
  element.hidden = !message;
  if (message) state.noticeTimer = setTimeout(() => { element.hidden = true; }, 4800);
}

function rankInfo() {
  const supplied = state.payload?.rank || state.level?.rank;
  const fallback = rankBlueprint(state.level?.rankId);
  return {
    name: supplied?.title || supplied?.name || fallback?.name,
    building: state.payload?.location?.title || state.payload?.locations?.map(location => location.title || location.name).filter(Boolean).join(' · ') || state.payload?.building?.name || state.level?.scene?.locationTitle || fallback?.building
  };
}

function scenePosition() {
  return {
    'central-fountain': '52% 48%',
    'piano-carpet': '74% 78%',
    'blind-box-store': '41% 30%',
    'makeover-shop': '88% 34%',
    'snow-bakery': '13% 49%',
    'milk-tea-shop': '55% 27%',
    arcade: '69% 29%',
    'eggy-park': '29% 68%',
    'football-field': '84% 55%',
    mall: '63% 69%',
    'ferris-wheel': '19% 25%'
  }[state.level?.scene?.locationId || state.level?.locationId || state.level?.locationIds?.[0]] || '50% 50%';
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
  const code = observeOnly ? starterCode(step) : previousCode || starterCode(step);
  $('#interaction-root').innerHTML = `<label for="code-answer" class="visually-hidden">${observeOnly ? '固定示例代码，本步只观察' : '当前代码'}</label><textarea id="code-answer" class="code-editor" spellcheck="false" autocapitalize="off" autocomplete="off"${observeOnly ? ' readonly aria-readonly="true"' : ''}>${esc(code)}</textarea>${observeOnly ? '<p class="observe-note">这一步运行固定示例，先观察结果；可编辑练习会在后面的步骤出现。</p>' : ''}`;
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
    const unlocked = boss ? allChaptersComplete && starRequirementMet : priorComplete || completed.has(entry.id);
    const status = boss ? artifact.bossCompletedAt ? '已通关' : unlocked ? '已解锁' : '待解锁' : starred.has(entry.id) ? '已获星' : completed.has(entry.id) ? '可补星' : unlocked ? '可进入' : '待解锁';
    return `<button type="button" data-project-index="${index}" data-status="${esc(status)}"${unlocked ? '' : ' disabled'}${entry.id === step.id ? ' aria-current="step"' : ''}><span>${boss ? 'B' : index + 1}</span><strong>${esc(entry.title)}</strong><small>${esc(status)}</small></button>`;
  }).join('')}</div>${missingStars.length ? `<p class="project-revisit-note">已完成但尚未获星：${missingStars.map(chapter => esc(chapter.title)).join('、')}。可直接回访这些章节，独立复查后补星。</p>` : ''}</nav>`;
}

function selectProjectStep(index) {
  if (state.mode !== 'project' || !Number.isInteger(index) || index < 0 || index >= steps().length || index === state.index) return;
  const target = $(`[data-project-index="${index}"]`, $('#interaction-root'));
  if (!target || target.disabled) return;
  const active = currentStep();
  if (active) state.answers.set(active.id, readAnswer(active));
  state.index = index;
  state.lastResult = null;
  renderStep();
  window.scrollTo({ top: 0, behavior: document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth' });
}

function renderProjectInteraction(step) {
  const boss = isProjectBoss(step);
  const previous = state.answers.get(step.id) || {};
  const checkpoint = step.checkpoint || {};
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
    ${concepts.length ? `<div class="concept-chips" aria-label="本章概念">${concepts.map(concept => `<span>${esc(concept)}</span>`).join('')}</div>` : ''}
    <section class="project-brief"><p class="section-label">${boss ? 'Boss 故障场景' : '逐步构建'}</p><p>${esc(boss ? step.story : step.guidedBuild)}</p></section>
    ${boss ? `<div class="fault-chips" aria-label="需要覆盖的故障">${(step.faultScenarios || []).map(item => `<span>${esc(item)}</span>`).join('')}</div>` : `<section class="checkpoint-task"><strong>这次独立检查</strong><p>${esc(checkpoint.task || '')}</p><small>建议证据：${esc(checkpoint.evidence || '可复现的输出或记录')}</small></section>`}
    ${checks.length ? `<div class="project-checklist">${checks.map((item, index) => `<div><span>${index + 1}</span><p><small>${esc(item.group)}</small>${esc(item.text)}</p></div>`).join('')}</div>` : ''}
    <label class="evidence-field" for="project-evidence"><span>证据与本次结果</span><textarea id="project-evidence" rows="5" placeholder="记录文件路径、运行命令、关键输出和尚未解决的问题。">${esc(previous.evidence || '')}</textarea></label>
    ${points ? `<label class="performance-field" for="performance-points"><span>本次表现分 <small>达到 ${points.pass} / ${points.maximum} 可通过本段 Boss</small></span><input id="performance-points" type="number" inputmode="numeric" min="0" max="${points.maximum}" value="${esc(previous.performancePoints ?? 0)}"></label>` : ''}
    <div class="project-confirmations">
      <label><input id="project-passed" type="checkbox"${previous.passed ? ' checked' : ''}><span><strong>我已按上面清单完成自检</strong><small>这是学习者自检记录，管理者可在后台查看。</small></span></label>
      <label><input id="project-independent" type="checkbox"${boss || previous.independent ? ' checked' : ''}${boss ? ' disabled' : ''}><span><strong>${boss ? 'Boss 必须独立完成' : '这一步由我独立完成'}</strong><small>${boss ? '可以查阅自己的旧记录，不由他人代做。' : '勾选后通过才会授予本章星星。'}</small></span></label>
    </div>
  </div>`;
}

function renderInteraction(step) {
  if (state.mode === 'project') { renderProjectInteraction(step); return; }
  const interaction = step.interaction?.kind || step.interaction?.type;
  const evaluator = step.evaluator?.kind;
  if (interaction === 'reorder' || evaluator === 'exact-order') renderReorder(step);
  else if (interaction === 'choice' || interaction === 'single-choice' || evaluator === 'choice') renderChoice(step);
  else if (interaction === 'number' || evaluator === 'number-exact') renderNumber(step);
  else if (['object-exact', 'mapping-exact'].includes(evaluator)) renderStructured(step);
  else if (isCodeStep(step)) renderCode(step);
  else if (['explanation', 'explain', 'text', 'reflection'].includes(stepType(step)) || step.answerPolicy) renderText(step);
  else renderExperience(step);
}

function actionLabel(step) {
  if (state.mode === 'project') return isProjectBoss(step) ? '提交 Boss 自检' : '保存本章自检';
  if (isIndependent(step)) return '独立运行这个变式';
  if (isCodeStep(step)) return '运行并看结果';
  if ((step.interaction?.kind || step.interaction?.type) === 'reorder') return '保留预测并继续';
  if (['explanation', 'explain'].includes(stepType(step))) return '检查我的解释';
  return '我观察好了';
}

function renderStep() {
  const step = currentStep();
  if (!step) { setPhase('empty'); return; }
  state.feedback = null;
  renderChrome();
  const variant = selectedVariant(step);
  const prompt = variant?.prompt || step.prompt || step.goal || step.story || '按照当前目标完成这一步。';
  $('#play-view').dataset.mode = state.mode;
  if (state.mode === 'project') {
    const rank = rankInfo();
    $('#scene-panel').style.setProperty('--scene-position', scenePosition());
    $('#scene-rank').textContent = rank.name || state.level.rankId;
    $('#scene-building').textContent = rank.building || state.level.locationIds?.[0] || '当前项目';
    $('#scene-caption').textContent = state.level.story || '把这一段技术逐步做成可运行的作品。';
    $('#scene-output').dataset.state = 'ready';
    $('#scene-output p').textContent = step.checkpoint?.task || (isProjectBoss(step) ? '项目 Boss 已就绪，先按阶段留下可复现证据。' : '项目已就绪，等待你的这次操作。');
  }
  $('#step-kind').textContent = KIND_LABELS[stepType(step)] || '当前步骤';
  $('#step-title').textContent = step.title || (variant ? variant.title : '') || KIND_LABELS[stepType(step)] || '继续游玩';
  $('#step-prompt').textContent = prompt;
  $('#check-step').textContent = actionLabel(step);
  $('#show-hint').hidden = hintEntries(step).length === 0 && !hasFullSolution(step);
  $('#feedback-panel').hidden = true;
  $('#step-form').hidden = false;
  $('#step-error').textContent = '';
  $('#step-form').querySelectorAll('input,textarea,button').forEach(control => { control.disabled = false; });
  renderInteraction(step);
  requestAnimationFrame(() => $('#step-title').focus?.({ preventScroll: true }));
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
    const filename = step.starterFiles?.['main.cpp'] !== undefined || selectedVariant(step)?.starterFiles?.['main.cpp'] !== undefined ? 'main.cpp' : 'main.c';
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
  if (isCodeStep(step) && !Object.values(answer.files || {}).some(code => code.trim())) return '代码区还是空的。';
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
    completed: result.completed === true || result.levelCompleted === true || data.levelCompleted === true || next.completed === true || next.kind === 'level-complete' || data.progress?.levelCompleted === true,
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
  if (result.passed) $('#check-step').textContent = '本步已通过';
  if (result.passed) $('#step-form').querySelectorAll('input,textarea,button').forEach(control => { control.disabled = true; });
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
  state.submitting = true;
  state.lastResult = null;
  $('#step-error').textContent = '';
  $('#check-step').disabled = true;
  $('#check-step').textContent = state.mode === 'project' ? '正在保存…' : isCodeStep(step) ? '正在运行…' : '正在检查…';
  try {
    const projectMode = state.mode === 'project';
    const path = projectMode ? '/api/play/project-attempts' : '/api/play/attempts';
    const payload = projectMode ? projectAttemptBody(step, answer) : attemptBody(submitAction(step), step, answer);
    const response = await requestJSON(path, { method: 'POST', body: JSON.stringify(payload) });
    state.pendingRequests.delete(pendingRequestKey(projectMode, step));
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
    result.selfCheck = projectMode;
    if (result.progress) state.progress = result.progress;
    if (result.replacementVariant && canReplaceRevealedVariant(step)) {
      const replacement = result.replacementVariant;
      step.variants = [...(step.variants || []).filter(variant => variant.id !== replacement.id), replacement];
      state.variantAssignments.set(step.id, replacement.id);
      state.answers.delete(step.id);
      state.hintLevels.set(step.id, 0);
      state.viewedFullAnswer.delete(step.id);
      state.lastResult = null;
      renderStep();
      showNotice('已换成等价新变式。独立完成后仍可获得星星。', 'success');
      return;
    }
    renderFeedback(result);
  } catch (error) {
    $('#step-error').textContent = `${error.message}你的当前输入仍保留在页面上。`;
  } finally {
    state.submitting = false;
    if (!state.lastResult) {
      $('#check-step').disabled = false;
      $('#check-step').textContent = actionLabel(step);
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
    : isIndependent(currentStep()) ? '你已经把理解带到了新变式中。这次的经验和星星会永久保留。' : '这一关的完成状态已经记录，下次会从新位置继续。';
  if (result.nextLevelId) {
    $('#continue-next-level').href = `/play.html?level=${encodeURIComponent(result.nextLevelId)}`;
    $('#continue-next-level').textContent = '继续下一关';
  }
  playTone('reward');
  const dialog = $('#complete-dialog');
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
}

function advanceStep() {
  const result = state.lastResult;
  if (!result?.passed) {
    state.lastResult = null;
    renderStep();
    ($('#code-answer') || $('#text-answer') || $('input[name="step-choice"]'))?.focus();
    return;
  }
  if (result.completed) { showCompletion(result); return; }
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
    showCompletion(result);
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
  $('#hint-content').innerHTML = hints.slice(0, level).map(hint => `<div class="hint-step"><span>${hint.tier}</span><p>${esc(hint.text)}</p></div>`).join('') || '<p>点击下方按钮，只展开当前需要的一层提示。</p>';
  $('#next-hint').hidden = level >= hints.length;
  $('#next-hint').textContent = level ? '再给一层提示' : '给我第一层提示';
  $('#reveal-answer').hidden = !(level >= hints.length && hasFullSolution(step) && !state.viewedFullAnswer.has(step.id));
  $('#reveal-answer').textContent = fullSolutionLabel(step);
  if (state.viewedFullAnswer.has(step.id)) {
    const heading = fullSolutionLabel(step).replace(/^查看/, '');
    $('#hint-content').insertAdjacentHTML('beforeend', `<div class="full-answer" tabindex="-1" role="region" aria-label="${esc(heading)}"><strong>${esc(heading)}</strong><pre><code>${esc(fullSolution(step))}</code></pre></div>`);
  }
}

function openHints() {
  renderHints();
  const dialog = $('#hint-dialog');
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
}

function nextHint() {
  const step = currentStep();
  const next = Math.min(hintEntries(step).length, (state.hintLevels.get(step.id) || 0) + 1);
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
    showNotice('完整思路已展开，已有奖励不受影响。');
    return;
  }

  const button = $('#reveal-answer');
  const originalLabel = button.textContent;
  state.hintLevels.set(step.id, 3);
  state.viewedFullAnswer.add(step.id);
  state.submitting = true;
  button.disabled = true;
  button.textContent = '正在记录…';
  try {
    const payload = attemptBody('reveal', step, '');
    const response = await requestJSON('/api/play/attempts', { method: 'POST', body: JSON.stringify(payload) });
    if (response.data.progress) state.progress = response.data.progress;
    const revealed = response.data.reveal;
    if (!revealed || revealed.variantId !== selectedVariant(step)?.id || !revealed.fullSolution) throw new Error('服务端没有返回当前变式的完整思路。');
    state.pendingRequests.delete(pendingRequestKey(false, step));
    state.revealedSolutions.set(solutionKey(step), revealed.fullSolution);
    renderHints();
    $('#hint-content .full-answer')?.focus();
    showNotice('完整思路已记录。当前变式可继续练习；刷新或提交后会换成等价新变式，独立完成仍可获得星星。');
  } catch (error) {
    state.viewedFullAnswer.delete(step.id);
    renderHints();
    showNotice(`${error.message} 完整思路尚未展开，请重试。`, 'error');
  } finally {
    state.submitting = false;
    button.disabled = false;
    if (!state.viewedFullAnswer.has(step.id)) button.textContent = originalLabel;
  }
}

async function copyAIContext() {
  const button = $('#copy-ai-context');
  const original = button.textContent;
  try {
    const context = buildAIContext({
      level: state.level,
      step: currentStep(),
      answer: typeof readAnswer() === 'string' ? readAnswer() : JSON.stringify(readAnswer(), null, 2),
      feedback: state.lastResult,
      hintLevel: state.hintLevels.get(currentStep().id) || 0
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
  if (!levelId) {
    setPhase('error', '网址中缺少关卡编号。请从乐园地图重新进入。');
    return;
  }
  setPhase('loading');
  try {
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
    if (!state.level || !steps().length) {
      setPhase('empty');
      return;
    }
    restoreState();
    setPhase('ready');
    renderStep();
  } catch (error) {
    setPhase('error', error.message);
  }
}

$('#retry-level').addEventListener('click', loadLevel);
$('#step-form').addEventListener('submit', submitStep);
$('#next-step').addEventListener('click', advanceStep);
$('#show-hint').addEventListener('click', openHints);
$('#next-hint').addEventListener('click', nextHint);
$('#reveal-answer').addEventListener('click', revealAnswer);
$('#copy-ai-context').addEventListener('click', copyAIContext);
$('#interaction-root').addEventListener('click', event => {
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

loadLevel();
