import { sanitizeLessonContent, sanitizeBossContent, sanitizeProject } from '../shared/park-domain.mjs';
import { httpError, safeId } from './store.mjs';

function invalid(message, code = 'invalid_preview') { throw httpError(400, message, code); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name}须为对象。`);
  return value;
}
function selected(items, activityId) {
  if (!Array.isArray(items)) invalid('课程草稿缺少活动列表。');
  const matches = items.filter(item => item?.id === activityId);
  if (!matches.length) throw httpError(404, '课程草稿中没有这个活动。', 'activity_not_found');
  if (matches.length !== 1) invalid('课程草稿中的活动编号重复。');
  return object(matches[0], '预览活动');
}

function inputFor(raw, activity, projectMode) {
  const field = projectMode ? 'projectId' : 'levelId';
  const stepField = projectMode ? 'checkpointId' : 'stepId';
  if (!safeId(raw.requestId) || !safeId(raw[stepField])) invalid('提交或步骤编号无效。');
  if (raw[field] !== activity.id) invalid('提交活动与正在预览的活动不一致。');
  if (raw.contentVersion !== activity.version) throw httpError(409, '模拟内容已经更新，请重新打开预览。', 'content_version_conflict');
  if (!Number.isInteger(raw.hintLevel) || raw.hintLevel < 0 || raw.hintLevel > 3 || typeof raw.viewedFullAnswer !== 'boolean') invalid('提示层级或完整答案状态无效。');
  if (raw.viewedFullAnswer && raw.hintLevel !== 3) invalid('查看完整答案时提示层级须为 3。');
  const action = raw.action === 'reveal' ? 'reveal' : raw.attemptAction;
  const actions = projectMode ? ['check', 'submit'] : raw.action === 'reveal' ? ['reveal'] : ['run', 'check', 'submit'];
  if (!actions.includes(action)) invalid('模拟提交动作无效。');
  return { ...raw, action };
}

function response(activity, stepId, feedback, extra = {}) {
  return {
    preview: true,
    result: {
      passed: feedback.passed, xpAwarded: 0, starAwarded: false,
      levelCompleted: false, checkpointCompleted: false, bossUnlocked: false,
      rankPromoted: '', tokenAwarded: '', currentRankId: activity.rankId, courseCompleted: false
    },
    feedback, achievements: [],
    next: { activityId: activity.id, stepId, levelTitle: activity.title, replacementVariant: null },
    ...extra
  };
}

// Only the selected activity is validated. An unfinished edit elsewhere in the
// workshop must not prevent inspecting this draft. This function has no store
// access and deliberately never enters the learner progression/award pipeline.
export async function evaluateCoursePreview(raw, gradeLevel) {
  object(raw, '模拟提交'); object(raw.course, '课程草稿');
  if (!['level', 'project'].includes(raw.mode) || !['attempt', 'reveal'].includes(raw.action) || !safeId(raw.activityId)) invalid('模拟模式、动作或活动编号无效。');

  if (raw.mode === 'level') {
    const target = selected(raw.course.levels, raw.activityId);
    if (!['interactive-lesson', 'rank-boss'].includes(target.kind)) invalid('模拟关卡类型无效。');
    const content = target.kind === 'rank-boss' ? sanitizeBossContent(target.content) : sanitizeLessonContent(target.content);
    if (content.id !== target.id || content.version !== target.version || content.rankId !== target.rankId) invalid('关卡详情与索引的编号或版本不一致。');
    const level = { ...target, content };
    const input = inputFor(raw, level, false);
    if (!Object.hasOwn(raw, 'answer') || typeof raw.answer !== 'string' || raw.answer.length > 50_000) invalid('模拟答案须为最多 50000 字符的文本。');
    const steps = content.steps || content.checkpoints;
    const step = steps.find(item => item.id === input.stepId);
    if (!step) throw httpError(404, '步骤不存在。', 'step_not_found');
    if (step.runtimeId && !['c17-console', 'linux-shell-sim'].includes(step.runtimeId)) invalid(`当前在线关卡不支持运行环境 ${step.runtimeId}。`, 'unsupported_runtime');
    if (step.type === 'independent-variation' && !step.variants.some(variant => variant.id === raw.variantId)) invalid('请选择当前独立步骤中的有效变式。');
    const graded = await gradeLevel({ levels: [level] }, input);
    const reveal = input.action === 'reveal'
      ? { variantId: graded.variant.id, fullSolution: graded.variant.fullSolution }
      : null;
    const feedback = {
      ...graded.feedback,
      ...(reveal ? { message: '完整思路已展开；模拟学习不会记录查看状态。' }
        : graded.feedback.kind === 'explanation' && graded.feedback.passed ? { message: '模拟检查通过。下一步可用新的代码变化检验这个理解。' } : {})
    };
    return response(level, step.id, feedback, reveal ? { reveal } : {});
  }

  const project = sanitizeProject(selected(raw.course.projects, raw.activityId));
  const input = inputFor(raw, project, true);
  const chapter = project.chapters.find(item => item.id === input.checkpointId);
  const isBoss = input.checkpointId === project.boss.id;
  if (!chapter && !isBoss) throw httpError(404, '作品检查点不存在。', 'checkpoint_not_found');
  if (typeof input.passed !== 'boolean' || typeof input.independent !== 'boolean') invalid('作品自检状态须为布尔值。');
  if (typeof input.evidence !== 'string' || input.evidence.length > 50_000 || (input.passed && !input.evidence.trim())) invalid('通过作品检查点需要填写有效证据。');
  if (input.viewedFullAnswer && input.independent) invalid('查看完整答案的同一次自检不能标为独立完成。');
  const points = input.performancePoints ?? 0;
  if (!Number.isInteger(points) || points < 0 || points > 100) invalid('表现分须为 0–100 的整数。');
  let passed = input.passed;
  if (isBoss) {
    const rank = selected(raw.course.ranks, project.rankId);
    const promotion = object(rank.promotion, '段位晋升规则');
    if (!['stars', 'performance-points', 'capstone'].includes(promotion.metric)) invalid('段位晋升规则无效。');
    if (promotion.metric === 'performance-points' && (!Number.isInteger(promotion.minimumPoints) || promotion.minimumPoints < 0 || promotion.minimumPoints > 100)) invalid('段位要求的表现分无效。');
    passed = passed && input.independent && !input.viewedFullAnswer && (promotion.metric !== 'performance-points' || points >= promotion.minimumPoints);
  }
  return response(project, input.checkpointId, {
    kind: 'self-check', passed,
    message: passed ? '模拟自检通过；本次预览不保存学习记录。' : input.passed ? '模拟自检尚未满足 Boss 的独立完成或表现分条件。' : '模拟自检尚未通过，可以继续调整作品。',
    actualOutput: input.evidence, expectedOutput: ''
  });
}
