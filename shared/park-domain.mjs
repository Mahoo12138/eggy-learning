// Eggy Programming Park v2 domain rules. This module is intentionally pure and
// dependency-free so the server and browser can share the same validation.

const MAX_TEXT = 50_000;
const ID = /^[a-z0-9][a-z0-9_-]{0,159}$/;
const KEY = /^[a-z0-9][a-z0-9:_-]{0,299}$/;
const RANK_NAMES = ['鹌鹑蛋', '鸽子蛋', '鸡蛋', '鹅蛋', '鸵鸟蛋', '恐龙蛋', '巅峰凤凰蛋', '超级凤凰蛋', '无敌凤凰蛋'];
const clone = value => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function fail(message, status = 400, code = 'invalid_park_data') { throw Object.assign(new Error(message), { status, code }); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${name}须为普通对象`);
  return value;
}
function fields(value, expected, name) {
  object(value, name);
  if (Object.keys(value).length !== expected.length || expected.some(key => !own(value, key))) fail(`${name}字段缺失或包含未知字段`);
}
function text(value, name, required = false, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${name}须为${required ? '非空' : ''}文本，最多 ${max} 字符`);
  return value;
}
function id(value, name = '编号') {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${name}须为小写稳定编号`);
  return value;
}
function optionalId(value, name = '编号') { return value === '' ? '' : id(value, name); }
function key(value, name = '键') {
  if (typeof value !== 'string' || !KEY.test(value)) fail(`${name}格式无效`);
  return value;
}
function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${name}须为 ${min}–${max} 的整数`);
  return value;
}
function bool(value, name) { if (typeof value !== 'boolean') fail(`${name}须为布尔值`); return value; }
function oneOf(value, choices, name) { if (!choices.includes(value)) fail(`${name}无效`); return value; }
function list(value, name, max = 10_000) { if (!Array.isArray(value) || value.length > max) fail(`${name}须为列表且不超过 ${max} 项`); return value; }
function strings(value, name, max = 500) { return list(value, name, max).map(item => text(item, name, true)); }
function ids(value, name, max = 500) {
  const out = list(value, name, max).map(item => id(item, name));
  if (new Set(out).size !== out.length) fail(`${name}不能重复`);
  return out;
}
function timestamp(value, name = '时间', nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${name}须为带时区的有效 ISO 时间`);
  return new Date(value).toISOString();
}
function date(value, name = '日期') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${name}须为 YYYY-MM-DD 日期`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${name}无效`);
  return value;
}
function unique(items, selector, name) {
  const seen = new Set();
  for (const item of items) {
    const value = typeof selector === 'function' ? selector(item) : item[selector];
    if (seen.has(value)) fail(`${name}重复：${value}`);
    seen.add(value);
  }
}

function validateHints(value, name = '提示阶梯') {
  const hints = list(value, name, 3).map(item => {
    fields(item, ['tier', 'kind', 'text'], name);
    return { tier: integer(item.tier, '提示层级', 1, 3), kind: text(item.kind, '提示类型', true), text: text(item.text, '提示文本', true) };
  });
  unique(hints, 'tier', '提示层级');
  return hints;
}

function sanitizeLessonContent(raw) {
  const lessonFields = ['schemaVersion', 'id', 'version', 'activityType', 'rankId', 'subrankId', 'sequence', 'title', 'estimatedMinutes', 'prerequisiteLevelIds', 'scene', 'objectives', 'teachingLoop', 'steps', 'rewards', 'aiContext'];
  fields(raw, lessonFields, '在线关卡详情');
  if (raw.schemaVersion !== 2 || raw.activityType !== 'interactive-lesson') fail('在线关卡详情版本或类型无效');
  const content = clone(raw);
  id(content.id, '关卡编号'); id(content.rankId, '关卡段位编号'); id(content.subrankId, '小段位编号');
  integer(content.version, '关卡版本', 1); integer(content.sequence, '关卡顺序', 1); integer(content.estimatedMinutes, '预计分钟', 1, 600);
  text(content.title, '关卡标题', true); ids(content.prerequisiteLevelIds, '前置关卡');
  object(content.scene, '关卡场景'); strings(content.objectives, '学习目标'); strings(content.teachingLoop, '教学循环'); object(content.rewards, '关卡奖励'); object(content.aiContext, 'AI 上下文');
  const stepIds = new Set();
  for (const step of list(content.steps, '关卡步骤', 100)) {
    object(step, '关卡步骤');
    const stepFields = {
      prediction: ['id', 'type', 'prompt', 'interaction', 'evaluator', 'feedback'],
      'run-observe': ['id', 'type', 'runtimeId', 'prompt', 'starterFiles', 'stdin', 'evaluator', 'visualizer', 'observationPrompt'],
      explanation: ['id', 'type', 'prompt', 'referencePoints', 'answerPolicy'],
      'code-edit': ['id', 'type', 'prompt', 'runtimeId', 'starterFiles', 'grader', 'hints', 'fullSolution'],
      'independent-variation': ['id', 'type', 'prompt', 'runtimeId', 'variantSetId', 'variants', 'hints', 'fullSolutionPolicy', 'starPolicy']
    };
    if (!stepFields[step.type]) fail(`未知步骤类型：${step.type}`);
    fields(step, stepFields[step.type], '关卡步骤');
    const stepId = id(step.id, '步骤编号');
    if (stepIds.has(stepId)) fail(`步骤编号重复：${stepId}`); stepIds.add(stepId);
    text(step.type, '步骤类型', true); text(step.prompt, '步骤提示', true);
    if (own(step, 'hints')) validateHints(step.hints);
    if (step.type === 'independent-variation') {
      id(step.variantSetId, '变式集编号');
      const variants = list(step.variants, '等价变式', 100);
      if (variants.length < 2) fail('独立变式步骤至少需要两个等价变式');
      unique(variants, variant => {
        fields(variant, ['id', 'prompt', 'starterFiles', 'grader', 'fullSolution'], '变式');
        text(variant.prompt, '变式提示', true);
        object(variant.starterFiles, '变式初始文件');
        object(variant.grader, '变式评分器');
        text(variant.fullSolution, '变式完整解法', true);
        return id(variant.id, '变式编号');
      }, '变式编号');
      object(step.fullSolutionPolicy, '完整解法规则'); object(step.starPolicy, '星星规则');
      if (step.fullSolutionPolicy.revealedSolutionDisablesStarForCurrentVariant !== true || step.fullSolutionPolicy.assignUnusedEquivalentVariant !== true || step.starPolicy.firstIndependentClearOnly !== true || step.starPolicy.neverRevoke !== true) fail('独立变式必须保留完整解法后的等价新变式与永久星星规则');
    }
  }
  object(content.rewards.xp, '关卡经验规则'); object(content.rewards.star, '关卡星星规则');
  integer(content.rewards.xp.firstMeaningfulAttempt, '首次尝试经验', 0, 100_000);
  integer(content.rewards.xp.firstClear, '首次通关经验', 0, 100_000);
  integer(content.rewards.xp.repeatDailyCap, '重复经验上限', 0, 100_000);
  const sourceStep = id(content.rewards.star.sourceStepId, '星星来源步骤');
  if (!stepIds.has(sourceStep) || !content.steps.find(step => step.id === sourceStep && step.type === 'independent-variation')) fail('星星必须来自独立变式步骤');
  integer(content.rewards.star.amount, '星星数量', 1, 10);
  return content;
}

function sanitizeBossContent(raw) {
  fields(raw, ['schemaVersion', 'id', 'version', 'activityType', 'rankId', 'sequence', 'title', 'estimatedMinutes', 'prerequisiteLevelIds', 'scene', 'resumePolicy', 'checkpoints', 'completionRule', 'rewards', 'aiContext'], 'Boss 关卡详情');
  if (raw.schemaVersion !== 2 || raw.activityType !== 'rank-boss') fail('Boss 关卡详情版本或类型无效');
  const content = clone(raw);
  id(content.id, 'Boss 编号'); id(content.rankId, 'Boss 段位编号'); integer(content.version, 'Boss 版本', 1); integer(content.sequence, 'Boss 顺序', 1); integer(content.estimatedMinutes, 'Boss 预计分钟', 1, 600); text(content.title, 'Boss 标题', true);
  ids(content.prerequisiteLevelIds, 'Boss 前置关卡'); object(content.scene, 'Boss 场景'); object(content.resumePolicy, 'Boss 续玩规则'); object(content.completionRule, 'Boss 完成规则'); object(content.rewards, 'Boss 奖励'); object(content.aiContext, 'Boss AI 上下文');
  const checkpoints = list(content.checkpoints, 'Boss 检查点', 100);
  if (!checkpoints.length) fail('Boss 至少需要一个检查点');
  unique(checkpoints, checkpoint => {
    object(checkpoint, 'Boss 检查点');
    const checkpointFields = {
      prediction: ['id', 'kind', 'title', 'prompt', 'evaluator'],
      'code-repair': ['id', 'kind', 'title', 'runtimeId', 'starterFiles', 'grader', 'hints'],
      'independent-transfer': ['id', 'kind', 'title', 'prompt', 'runtimeId', 'grader', 'hints', 'fullSolutionPolicy']
    };
    if (!checkpointFields[checkpoint.kind]) fail(`未知 Boss 检查点类型：${checkpoint.kind}`);
    fields(checkpoint, checkpointFields[checkpoint.kind], 'Boss 检查点');
    text(checkpoint.kind, '检查点类型', true); text(checkpoint.title, '检查点标题', true);
    if (own(checkpoint, 'prompt')) text(checkpoint.prompt, '检查点提示', true);
    if (own(checkpoint, 'hints')) validateHints(checkpoint.hints, 'Boss 提示阶梯');
    return id(checkpoint.id, '检查点编号');
  }, 'Boss 检查点编号');
  if (content.completionRule.allCheckpointsRequired !== true || content.completionRule.finalCheckpointMustBeIndependent !== true || content.completionRule.managerApprovalRequired !== false) fail('Boss 必须全部检查点完成、最终独立完成且无需管理者审批');
  integer(content.rewards.xp, 'Boss 经验', 0, 100_000); if (content.rewards.rankPromotion !== true || content.rewards.neverRevoke !== true) fail('Boss 必须晋段且奖励永久保留');
  object(content.rewards.coreToken, 'Boss 核心信物'); id(content.rewards.coreToken.id, '核心信物编号'); text(content.rewards.coreToken.title, '核心信物名称', true); text(content.rewards.coreToken.wallCategory, '荣誉墙分类', true);
  return content;
}

function sanitizeProject(raw) {
  fields(raw, ['schemaVersion', 'id', 'version', 'activityType', 'rankId', 'title', 'technologyTheme', 'languages', 'locationIds', 'propIds', 'estimatedSessions', 'prerequisiteActivityIds', 'story', 'oneProjectRule', 'artifact', 'coreContract', 'chapterTeachingLoop', 'chapters', 'boss', 'rewards', 'aiContext', 'file'], '段位作品');
  if (raw.schemaVersion !== 2 || raw.activityType !== 'rank-project') fail('段位作品版本或类型无效');
  const project = clone(raw);
  id(project.id, '作品编号'); id(project.rankId, '作品段位编号'); integer(project.version, '作品版本', 1); text(project.title, '作品标题', true); text(project.technologyTheme, '作品技术主题', true); strings(project.languages, '作品语言'); ids(project.locationIds, '作品建筑'); ids(project.propIds, '作品道具'); ids(project.prerequisiteActivityIds, '作品前置活动'); text(project.story, '作品故事', true); text(project.file, '作品文件', true);
  fields(project.estimatedSessions, ['minimum', 'typical'], '作品预计场次'); integer(project.estimatedSessions.minimum, '最少场次', 1); integer(project.estimatedSessions.typical, '典型场次', project.estimatedSessions.minimum);
  fields(project.oneProjectRule, ['allChaptersModifySameArtifact', 'chapterExercisesAreNotSeparateProjects'], '一段一作品规则');
  if (project.oneProjectRule.allChaptersModifySameArtifact !== true || project.oneProjectRule.chapterExercisesAreNotSeparateProjects !== true) fail('项目必须遵守一段位一作品');
  object(project.artifact, '作品产物');
  const artifactRequired = ['kind', 'workingTitle', 'runTarget'];
  const artifactAllowed = [...artifactRequired, 'entryFile', 'persistentFiles', 'hardwareProfile', 'components', 'learnerMustName', 'requiredDeliverables'];
  if (artifactRequired.some(field => !own(project.artifact, field)) || Object.keys(project.artifact).some(field => !artifactAllowed.includes(field))) fail('作品产物字段缺失或包含未知字段');
  text(project.artifact.kind, '作品产物类型', true); if (project.artifact.workingTitle === null) { if (project.artifact.learnerMustName !== true) fail('未提供作品暂定名时必须由学习者命名'); } else text(project.artifact.workingTitle, '作品暂定名', true); text(project.artifact.runTarget, '作品运行目标', true);
  if (own(project.artifact, 'entryFile')) text(project.artifact.entryFile, '作品入口文件', true);
  if (own(project.artifact, 'persistentFiles')) strings(project.artifact.persistentFiles, '作品持久化文件');
  if (own(project.artifact, 'components')) { const components = list(project.artifact.components, '作品组件', 50); unique(components, component => { fields(component, ['id', 'language', 'entryFile'], '作品组件'); text(component.language, '组件语言', true); text(component.entryFile, '组件入口文件', true); return id(component.id, '组件编号'); }, '组件编号'); }
  if (own(project.artifact, 'requiredDeliverables')) strings(project.artifact.requiredDeliverables, '作品必交物');
  if (own(project.artifact, 'hardwareProfile')) { fields(project.artifact.hardwareProfile, ['strategy', 'requiredCapabilities', 'debugEvidence'], '硬件配置'); text(project.artifact.hardwareProfile.strategy, '硬件配置策略', true); strings(project.artifact.hardwareProfile.requiredCapabilities, '硬件必需能力'); strings(project.artifact.hardwareProfile.debugEvidence, '硬件调试证据'); }
  if (own(project.artifact, 'learnerMustName')) bool(project.artifact.learnerMustName, '学习者命名要求');
  strings(project.coreContract, '核心合同'); strings(project.chapterTeachingLoop, '章节教学循环'); fields(project.aiContext, ['copyFields', 'tutorInstruction'], '作品 AI 上下文'); strings(project.aiContext.copyFields, 'AI 复制字段'); text(project.aiContext.tutorInstruction, 'AI 导师说明', true);
  const chapters = list(project.chapters, '作品章节', 100);
  if (!chapters.length) fail('段位作品至少需要一个章节');
  unique(chapters, chapter => {
    fields(chapter, ['id', 'title', 'goal', 'concepts', 'guidedBuild', 'hintLadder', 'checkpoint', 'laterReencounter'], '作品章节'); id(chapter.id, '章节编号'); text(chapter.title, '章节标题', true); text(chapter.goal, '章节目标', true); strings(chapter.concepts, '章节概念'); text(chapter.guidedBuild, '引导构建', true); text(chapter.laterReencounter, '后续重遇', true); fields(chapter.checkpoint, ['kind', 'task', 'evidence', 'automatedChecks', 'selfChecks', 'awardsStar'], '章节检查点'); text(chapter.checkpoint.kind, '章节检查点类型', true); text(chapter.checkpoint.task, '章节检查点任务', true); text(chapter.checkpoint.evidence, '章节检查点证据', true); strings(chapter.checkpoint.automatedChecks, '自动检查'); strings(chapter.checkpoint.selfChecks, '自检');
    if (chapter.checkpoint.awardsStar !== true) fail('每个作品章节都须以独立检查点授星');
    validateHints(chapter.hintLadder);
    return chapter.id;
  }, '章节编号');
  object(project.boss, '作品 Boss');
  const bossRequired = ['id', 'title', 'story', 'phases', 'faultScenarios', 'resumableByPhase', 'managerApprovalRequired'];
  const bossAllowed = [...bossRequired, 'performancePoints', 'referenceIntegration'];
  if (bossRequired.some(field => !own(project.boss, field)) || Object.keys(project.boss).some(field => !bossAllowed.includes(field))) fail('作品 Boss 字段缺失或包含未知字段');
  id(project.boss.id, '作品 Boss 编号'); text(project.boss.title, '作品 Boss 标题', true); text(project.boss.story, '作品 Boss 故事', true); strings(project.boss.faultScenarios, '作品 Boss 故障场景'); bool(project.boss.resumableByPhase, 'Boss 分阶段续玩');
  const phases = list(project.boss.phases, '作品 Boss 阶段', 20); if (!phases.length) fail('作品 Boss 至少需要一个阶段'); unique(phases, phase => { fields(phase, ['id', 'title', 'successCriteria'], '作品 Boss 阶段'); text(phase.title, 'Boss 阶段标题', true); strings(phase.successCriteria, 'Boss 阶段成功条件'); return id(phase.id, 'Boss 阶段编号'); }, '作品 Boss 阶段编号');
  if (own(project.boss, 'performancePoints')) { fields(project.boss.performancePoints, ['maximum', 'pass', 'dimensions'], 'Boss 表现分'); integer(project.boss.performancePoints.maximum, 'Boss 最高表现分', 1, 100); integer(project.boss.performancePoints.pass, 'Boss 及格表现分', 1, project.boss.performancePoints.maximum); object(project.boss.performancePoints.dimensions, 'Boss 表现分维度'); const total = Object.values(project.boss.performancePoints.dimensions).reduce((sum, amount) => sum + integer(amount, 'Boss 表现分维度', 1, 100), 0); if (total !== project.boss.performancePoints.maximum) fail('Boss 表现分维度总和须等于最高分'); }
  if (own(project.boss, 'referenceIntegration')) { fields(project.boss.referenceIntegration, ['unlockAfter', 'title', 'guidanceOnly', 'suggestedConnections'], '参考整合'); text(project.boss.referenceIntegration.unlockAfter, '参考整合解锁条件', true); text(project.boss.referenceIntegration.title, '参考整合标题', true); if (project.boss.referenceIntegration.guidanceOnly !== true) fail('最终项目参考整合只能提供建议'); strings(project.boss.referenceIntegration.suggestedConnections, '参考整合建议'); }
  if (project.boss.managerApprovalRequired !== false) fail('作品 Boss 不得依赖管理者审批');
  fields(project.rewards, ['chapterXp', 'independentCheckpointStar', 'bossXp', 'trophy', 'neverRevoke'], '作品奖励');
  integer(project.rewards.chapterXp, '章节经验', 0, 100_000); integer(project.rewards.independentCheckpointStar, '章节星星', 1, 10); integer(project.rewards.bossXp, '作品 Boss 经验', 0, 100_000); object(project.rewards.trophy, '作品战利品'); id(project.rewards.trophy.id, '战利品编号'); text(project.rewards.trophy.title, '战利品名称', true); text(project.rewards.trophy.wallCategory, '战利品分类', true);
  if (project.rewards.neverRevoke !== true) fail('作品奖励必须永久保留');
  return project;
}

function detailedDocs(levelDocs) {
  if (levelDocs === undefined || levelDocs === null) return [];
  if (Array.isArray(levelDocs)) return levelDocs;
  object(levelDocs, '关卡详情集合');
  return Object.values(levelDocs);
}

/** Validate the rich course index; optionally hydrate level summaries with `content`. */
export function sanitizeCourse(value, levelDocs) {
  fields(value, ['schemaVersion', 'courseId', 'publishedRevision', 'title', 'subtitle', 'terminology', 'audience', 'learningPolicy', 'runtimeProfiles', 'locations', 'props', 'ranks', 'levels', 'projects', 'rewardCatalog', 'achievements', 'legalNotice'], '课程');
  if (value.schemaVersion !== 2) fail('课程版本须为 2');
  const course = clone(value);
  course.courseId = id(course.courseId, '课程编号'); course.publishedRevision = integer(course.publishedRevision, '课程发布版本', 1); text(course.title, '课程标题', true); text(course.subtitle, '课程副标题'); text(course.legalNotice, '版权说明', true);
  fields(course.terminology, ['platform', 'home', 'domain', 'level', 'admin', 'continuationAction'], '课程术语'); for (const item of Object.values(course.terminology)) text(item, '课程术语', true);
  fields(course.audience, ['learnerCount', 'managerCount', 'authentication', 'publicUse'], '使用范围');
  if (course.audience.learnerCount !== 1 || course.audience.managerCount !== 1 || course.audience.publicUse !== false) fail('当前课程须保持一位学习者、一位管理者且不公开使用');
  text(course.audience.authentication, '访问方式', true);
  fields(course.learningPolicy, ['lessonMinutes', 'loop', 'noPenalty', 'noDemotion', 'xpPurpose', 'starPurpose', 'bossPurpose', 'fullSolutionRule', 'aiHelpRule', 'managerApprovalRequired'], '学习规则');
  fields(course.learningPolicy.lessonMinutes, ['minimum', 'typical', 'maximum'], '关卡时长');
  const lessonMinutes = course.learningPolicy.lessonMinutes; integer(lessonMinutes.minimum, '最短关卡分钟', 1); integer(lessonMinutes.typical, '典型关卡分钟', lessonMinutes.minimum); integer(lessonMinutes.maximum, '最长关卡分钟', lessonMinutes.typical);
  strings(course.learningPolicy.loop, '学习循环');
  bool(course.learningPolicy.noPenalty, '无惩罚规则'); bool(course.learningPolicy.noDemotion, '不掉段规则'); bool(course.learningPolicy.managerApprovalRequired, '管理者审批规则');
  if (!course.learningPolicy.noPenalty || !course.learningPolicy.noDemotion || course.learningPolicy.managerApprovalRequired) fail('课程必须无惩罚、不掉段且不要求管理者审批');
  for (const key of ['xpPurpose', 'starPurpose', 'bossPurpose', 'fullSolutionRule', 'aiHelpRule']) text(course.learningPolicy[key], key, true);
  course.runtimeProfiles = list(course.runtimeProfiles, '运行环境', 100).map(raw => { fields(raw, ['id', 'language', 'standard', 'execution'], '运行环境'); return { id: id(raw.id, '运行环境编号'), language: text(raw.language, '语言', true), standard: text(raw.standard, '标准', true), execution: text(raw.execution, '执行方式', true) }; });
  course.locations = list(course.locations, '建筑', 100).map(raw => { fields(raw, ['id', 'title', 'role'], '建筑'); return { id: id(raw.id, '建筑编号'), title: text(raw.title, '建筑名称', true), role: text(raw.role, '建筑作用', true) }; });
  course.props = list(course.props, '道具', 100).map(raw => { fields(raw, ['id', 'title', 'semanticRole'], '道具'); return { id: id(raw.id, '道具编号'), title: text(raw.title, '道具名称', true), semanticRole: text(raw.semanticRole, '道具程序含义', true) }; });
  unique(course.runtimeProfiles, 'id', '运行环境编号'); unique(course.locations, 'id', '建筑编号'); unique(course.props, 'id', '道具编号');
  const locationIds = new Set(course.locations.map(item => item.id)), propIds = new Set(course.props.map(item => item.id));

  course.ranks = list(course.ranks, '段位', 9).map(raw => {
    fields(raw, ['id', 'order', 'title', 'technologyTheme', 'languageIds', 'locationIds', 'activityIds', 'projectId', 'subdivisions', 'promotion'], '段位');
    const rank = { id: id(raw.id, '段位编号'), order: integer(raw.order, '段位顺序', 1, 9), title: text(raw.title, '段位名称', true), technologyTheme: text(raw.technologyTheme, '技术主题', true), languageIds: strings(raw.languageIds, '语言编号'), locationIds: ids(raw.locationIds, '段位建筑'), activityIds: ids(raw.activityIds, '段位活动'), projectId: raw.projectId === null ? null : id(raw.projectId, '段位作品编号'), subdivisions: clone(list(raw.subdivisions, '小段位', 20)), promotion: clone(raw.promotion) };
    if (rank.projectId === null && rank.locationIds.length) fail(`${rank.title}是在线互动段位，不能绑定作品场景`);
    if (rank.projectId !== null && !rank.locationIds.length) fail(`${rank.title}的段位作品缺少场景`);
    for (const subdivision of rank.subdivisions) { object(subdivision, '小段位'); if (!['id', 'title', 'requiredStars'].filter(key => own(subdivision, key)).every(key => own(subdivision, key)) || Object.keys(subdivision).some(key => !['id', 'title', 'requiredStars'].includes(key))) fail('小段位字段无效'); id(subdivision.id, '小段位编号'); text(subdivision.title, '小段位名称', true); if (own(subdivision, 'requiredStars')) integer(subdivision.requiredStars, '小段位星星', 0, 100); }
    object(rank.promotion, '晋段规则'); oneOf(rank.promotion.metric, ['stars', 'performance-points', 'capstone'], '晋段指标'); text(rank.promotion.bossActivityId, 'Boss 活动编号', true); if (!(rank.promotion.promotesTo === null || ID.test(rank.promotion.promotesTo))) fail('下一段位编号无效');
    if (rank.promotion.metric === 'stars') { fields(rank.promotion, ['metric', 'requiredStars', 'bossActivityId', 'promotesTo'], '星星晋段规则'); integer(rank.promotion.requiredStars, '晋段星星', 0, 100); }
    if (rank.promotion.metric === 'performance-points') { fields(rank.promotion, ['metric', 'minimumPoints', 'bossActivityId', 'promotesTo'], '表现分晋段规则'); integer(rank.promotion.minimumPoints, '最低表现分', 1, 100); }
    if (rank.promotion.metric === 'capstone') fields(rank.promotion, ['metric', 'bossActivityId', 'promotesTo'], '最终晋段规则');
    return rank;
  });
  if (course.ranks.length !== 9) fail('课程必须保留九阶蛋位'); unique(course.ranks, 'id', '段位编号'); course.ranks.sort((a, b) => a.order - b.order);
  for (let index = 0; index < course.ranks.length; index++) {
    const rank = course.ranks[index];
    if (rank.order !== index + 1 || rank.title !== RANK_NAMES[index]) fail(`第 ${index + 1} 阶须为${RANK_NAMES[index]}`);
    if (rank.locationIds.some(value => !locationIds.has(value))) fail(`${rank.title}引用未知建筑`);
    if (index < 3 && rank.projectId !== null) fail('前三段只能使用在线互动关卡');
    if (index >= 3 && !rank.projectId) fail('鹅蛋及以后必须一段位绑定一个作品');
    if (rank.promotion.promotesTo !== (course.ranks[index + 1]?.id || null)) fail(`${rank.title}的下一段位不连续`);
  }
  const rankMap = new Map(course.ranks.map(rank => [rank.id, rank]));

  const summaries = list(course.levels, '关卡索引', 1000).map(raw => {
    const expected = ['id', 'rankId', 'subrankId', 'sequence', 'title', 'kind', 'version', 'file', 'estimatedMinutes', 'locationId', 'propIds', 'prerequisiteLevelIds'];
    const hasContent = own(raw, 'content'); fields(raw, hasContent ? [...expected, 'content'] : expected, '关卡索引');
    const summary = { id: id(raw.id, '关卡编号'), rankId: id(raw.rankId, '关卡段位编号'), subrankId: raw.subrankId === null ? null : id(raw.subrankId, '小段位编号'), sequence: integer(raw.sequence, '关卡顺序', 1), title: text(raw.title, '关卡标题', true), kind: oneOf(raw.kind, ['interactive-lesson', 'rank-boss'], '关卡类型'), version: integer(raw.version, '关卡版本', 1), file: text(raw.file, '关卡文件', true), estimatedMinutes: integer(raw.estimatedMinutes, '预计分钟', 1, 600), locationId: id(raw.locationId, '关卡建筑'), propIds: ids(raw.propIds, '关卡道具'), prerequisiteLevelIds: ids(raw.prerequisiteLevelIds, '前置关卡') };
    if (hasContent) summary.content = raw.kind === 'interactive-lesson' ? sanitizeLessonContent(raw.content) : sanitizeBossContent(raw.content);
    return summary;
  });
  unique(summaries, 'id', '关卡编号'); unique(summaries, 'file', '关卡文件'); unique(summaries, item => `${item.rankId}:${item.sequence}`, '段位内关卡顺序');
  course.projects = list(course.projects, '段位作品', 100).map(sanitizeProject); unique(course.projects, 'id', '作品编号');
  const projects = new Map(course.projects.map(project => [project.id, project]));
  const summaryMap = new Map(summaries.map(level => [level.id, level]));

  const supplied = detailedDocs(levelDocs);
  if (supplied.length) {
    const docs = new Map(), mirroredProjects = new Set();
    for (const raw of supplied) {
      object(raw, '关卡详情');
      if (raw.activityType === 'rank-project') { const mirror = sanitizeProject(raw); const inline = projects.get(mirror.id); if (mirroredProjects.has(mirror.id)) fail(`作品镜像重复：${mirror.id}`); mirroredProjects.add(mirror.id); if (!inline || !same(mirror, inline)) fail(`作品镜像与课程索引不一致：${mirror.id}`); continue; }
      const content = raw.activityType === 'interactive-lesson' ? sanitizeLessonContent(raw) : sanitizeBossContent(raw);
      if (docs.has(content.id)) fail(`关卡详情重复：${content.id}`); docs.set(content.id, content);
    }
    for (const summary of summaries) {
      const content = docs.get(summary.id);
      if (!content) fail(`缺少关卡详情：${summary.id}`);
      if (content.rankId !== summary.rankId || content.version !== summary.version || content.activityType !== summary.kind || content.title !== summary.title || content.estimatedMinutes !== summary.estimatedMinutes || !same(content.prerequisiteLevelIds, summary.prerequisiteLevelIds)) fail(`关卡详情与索引不一致：${summary.id}`);
      summary.content = content;
    }
  }
  course.levels = summaries;
  for (const level of course.levels) {
    const rank = rankMap.get(level.rankId);
    if (!rank || !rank.activityIds.includes(level.id) || !locationIds.has(level.locationId) || level.propIds.some(value => !propIds.has(value))) fail(`关卡 ${level.id} 的段位、建筑或道具引用无效`);
    if (level.subrankId && !rank.subdivisions.some(item => item.id === level.subrankId)) fail(`关卡 ${level.id} 引用未知小段位`);
    for (const prerequisite of level.prerequisiteLevelIds) {
      const prerequisiteLevel = summaryMap.get(prerequisite);
      const prerequisiteRank = prerequisiteLevel && rankMap.get(prerequisiteLevel.rankId);
      const prerequisiteIsEarlier = prerequisiteRank && (
        prerequisiteRank.order < rank.order ||
        (prerequisiteRank.order === rank.order && prerequisiteLevel.sequence < level.sequence)
      );
      if (!prerequisiteIsEarlier) fail(`关卡 ${level.id} 的前置关卡 ${prerequisite} 必须指向严格更早的关卡`);
    }
    if (level.content) {
      const content = level.content;
      if (content.id !== level.id || content.rankId !== level.rankId || (level.kind === 'interactive-lesson' && content.subrankId !== level.subrankId) || content.sequence !== level.sequence || content.version !== level.version || content.activityType !== level.kind || content.title !== level.title || content.estimatedMinutes !== level.estimatedMinutes || !same(content.prerequisiteLevelIds, level.prerequisiteLevelIds)) fail(`关卡详情与索引不一致：${level.id}`);
      const scene = level.content.scene;
      if (scene.locationId !== level.locationId || !same(scene.propIds || [], level.propIds)) fail(`关卡 ${level.id} 的场景索引与详情不一致`);
      if (level.kind === 'interactive-lesson' && !same(content.teachingLoop, content.steps.map(step => step.id))) fail(`关卡 ${level.id} 的教学循环与步骤不一致`);
      for (const step of content.steps || []) if (own(step, 'runtimeId') && !course.runtimeProfiles.some(profile => profile.id === step.runtimeId)) fail(`关卡 ${level.id} 引用未知运行环境`);
    }
  }
  for (const project of course.projects) {
    const rank = rankMap.get(project.rankId);
    if (!rank || rank.projectId !== project.id || !rank.activityIds.includes(project.id) || project.locationIds.some(value => !locationIds.has(value)) || project.propIds.some(value => !propIds.has(value))) fail(`作品 ${project.id} 的段位、建筑或道具引用无效`);
  }
  for (const rank of course.ranks) for (const activityId of rank.activityIds) if (!summaryMap.has(activityId) && !projects.has(activityId)) fail(`${rank.title}引用未知活动：${activityId}`);

  course.rewardCatalog = list(course.rewardCatalog, '奖励目录', 100).map(raw => { fields(raw, ['id', 'title', 'kind', 'sourceRankId'], '奖励'); return { id: id(raw.id, '奖励编号'), title: text(raw.title, '奖励名称', true), kind: oneOf(raw.kind, ['ability-token', 'project-trophy', 'final-trophy'], '奖励类型'), sourceRankId: id(raw.sourceRankId, '奖励段位编号') }; });
  unique(course.rewardCatalog, 'id', '奖励编号'); unique(course.rewardCatalog, 'sourceRankId', '段位核心奖励');
  for (const reward of course.rewardCatalog) if (!rankMap.has(reward.sourceRankId)) fail('奖励引用未知段位');
  if (course.rewardCatalog.length !== course.ranks.length) fail('每个段位必须且只能配置一个核心奖励');
  for (const rank of course.ranks) {
    const reward = course.rewardCatalog.find(item => item.sourceRankId === rank.id);
    if (!rank.projectId) {
      const boss = course.levels.find(item => item.id === rank.promotion.bossActivityId);
      if (!boss || boss.rankId !== rank.id || boss.kind !== 'rank-boss') fail(`${rank.title}的晋段 Boss 无效`);
      if (boss.content && (boss.content.rewards.coreToken.id !== reward.id || boss.content.rewards.coreToken.title !== reward.title || boss.content.rewards.coreToken.wallCategory !== reward.kind)) fail(`${rank.title}的 Boss 奖励与奖励目录不一致`);
    } else {
      const project = projects.get(rank.projectId);
      if (!project || rank.promotion.bossActivityId !== `${project.id}#${project.boss.id}` || project.rewards.trophy.id !== reward.id || project.rewards.trophy.title !== reward.title || project.rewards.trophy.wallCategory !== reward.kind) fail(`${rank.title}的作品 Boss 或奖励目录不一致`);
    }
  }
  course.achievements = list(course.achievements, '成就', 500).map(raw => { fields(raw, ['id', 'title', 'hidden', 'trigger', 'description'], '成就'); object(raw.trigger, '成就条件'); text(raw.trigger.event, '成就事件', true); return { id: id(raw.id, '成就编号'), title: text(raw.title, '成就名称', true), hidden: bool(raw.hidden, '隐藏成就'), trigger: clone(raw.trigger), description: text(raw.description, '成就说明', true) }; });
  unique(course.achievements, 'id', '成就编号');
  return course;
}

function normalizeLevelInput(value) {
  fields(value, ['requestId', 'levelId', 'contentVersion', 'stepId', 'variantId', 'action', 'answer', 'hintLevel', 'viewedFullAnswer', 'passed', 'independent'], '关卡提交');
  const input = { requestId: id(value.requestId, '提交编号'), levelId: id(value.levelId, '关卡编号'), contentVersion: integer(value.contentVersion, '内容版本', 1), stepId: id(value.stepId, '步骤编号'), variantId: optionalId(value.variantId, '变式编号'), action: oneOf(value.action, ['run', 'check', 'submit', 'reveal'], '提交动作'), answer: text(value.answer, '答案'), hintLevel: integer(value.hintLevel, '提示层级', 0, 3), viewedFullAnswer: bool(value.viewedFullAnswer, '完整答案状态'), passed: bool(value.passed, '通过状态'), independent: bool(value.independent, '独立完成状态') };
  if (input.viewedFullAnswer && input.hintLevel !== 3) fail('查看完整答案时提示层级须为 3');
  if (input.viewedFullAnswer && input.independent) fail('查看完整答案的同一次提交不能标为独立完成');
  if (input.action === 'reveal' && (!input.viewedFullAnswer || input.passed || input.independent || !input.variantId)) fail('完整答案事件必须记录变式、三层提示与非独立未通过状态');
  return input;
}
function normalizeProjectInput(value) {
  const expected = ['requestId', 'projectId', 'contentVersion', 'checkpointId', 'action', 'evidence', 'hintLevel', 'viewedFullAnswer', 'passed', 'independent'];
  const hasPoints = own(value, 'performancePoints'); fields(value, hasPoints ? [...expected, 'performancePoints'] : expected, '作品提交');
  const input = { requestId: id(value.requestId, '提交编号'), projectId: id(value.projectId, '作品编号'), contentVersion: integer(value.contentVersion, '作品版本', 1), checkpointId: id(value.checkpointId, '检查点编号'), action: oneOf(value.action, ['check', 'submit'], '作品提交动作'), evidence: text(value.evidence, '作品证据'), hintLevel: integer(value.hintLevel, '提示层级', 0, 3), viewedFullAnswer: bool(value.viewedFullAnswer, '完整答案状态'), passed: bool(value.passed, '通过状态'), independent: bool(value.independent, '独立完成状态'), performancePoints: hasPoints ? integer(value.performancePoints, '表现分', 0, 100) : 0 };
  if (input.passed && !input.evidence.trim()) fail('通过作品检查点需要证据');
  if (input.viewedFullAnswer && input.hintLevel !== 3) fail('查看完整答案时提示层级须为 3');
  if (input.viewedFullAnswer && input.independent) fail('查看完整答案的同一次提交不能标为独立完成');
  return input;
}
function normalizeResult(value) {
  fields(value, ['xpAwarded', 'starAwarded', 'levelCompleted', 'checkpointCompleted', 'bossUnlocked', 'rankPromoted', 'tokenAwarded', 'currentRankId', 'courseCompleted'], '提交结果');
  return { xpAwarded: integer(value.xpAwarded, '获得经验', 0), starAwarded: bool(value.starAwarded, '获得星星'), levelCompleted: bool(value.levelCompleted, '完成活动'), checkpointCompleted: bool(value.checkpointCompleted, '完成检查点'), bossUnlocked: bool(value.bossUnlocked, 'Boss 解锁'), rankPromoted: optionalId(value.rankPromoted, '晋升段位'), tokenAwarded: optionalId(value.tokenAwarded, '奖励编号'), currentRankId: id(value.currentRankId, '当前段位'), courseCompleted: bool(value.courseCompleted, '课程完成状态') };
}
function normalizeMeta(value) { fields(value, ['id', 'submittedAt'], '提交元信息'); return { id: id(value.id, '尝试编号'), submittedAt: timestamp(value.submittedAt, '提交时间') }; }

function defaultPolicy() { return { sourceOfTruth: 'sessions, attempts, projectArtifacts and immutable awardLedger entries in this file', neverDemote: true, neverRevokeEarnedAwards: true, duplicateAwardKey: 'reject' }; }
function award(value) {
  fields(value, ['key', 'kind', 'rankId', 'activityId', 'sourceId', 'amount', 'title', 'attemptId', 'earnedAt'], '奖励账本条目');
  return { key: key(value.key, '奖励键'), kind: oneOf(value.kind, ['xp', 'star', 'ability-token', 'project-trophy', 'final-trophy', 'achievement'], '奖励类型'), rankId: id(value.rankId, '奖励段位'), activityId: id(value.activityId, '奖励活动'), sourceId: id(value.sourceId, '奖励来源'), amount: integer(value.amount, '奖励数量', 0), title: text(value.title, '奖励名称'), attemptId: id(value.attemptId, '奖励尝试'), earnedAt: timestamp(value.earnedAt, '奖励时间') };
}

/** Validate persisted rich progress. */
export function sanitizeProgress(rawCourse, value) {
  const course = sanitizeCourse(rawCourse);
  fields(value, ['schemaVersion', 'courseId', 'courseRevision', 'revision', 'learner', 'preferences', 'current', 'xp', 'rankStates', 'sessions', 'attempts', 'projectArtifacts', 'awardLedger', 'achievementWall', 'derivedStatePolicy', 'updatedAt'], '学习进度');
  if (value.schemaVersion !== 2 || value.courseId !== course.courseId) fail('学习进度版本或课程编号不匹配');
  const progress = clone(value);
  progress.courseRevision = integer(progress.courseRevision, '课程版本', 1, course.publishedRevision); progress.revision = integer(progress.revision, '进度版本', 0);
  fields(progress.learner, ['id', 'displayName', 'avatar'], '学习者'); progress.learner.id = id(progress.learner.id, '学习者编号'); text(progress.learner.displayName, '学习者名称', true); fields(progress.learner.avatar, ['bodyColor', 'face', 'accessories'], '蛋仔形象'); text(progress.learner.avatar.bodyColor, '蛋仔颜色', true); text(progress.learner.avatar.face, '蛋仔表情', true); strings(progress.learner.avatar.accessories, '蛋仔配饰');
  fields(progress.preferences, ['sound', 'reducedMotion', 'codeFontSize'], '学习偏好'); bool(progress.preferences.sound, '声音偏好'); oneOf(progress.preferences.reducedMotion, ['system', 'reduce', 'full'], '动效偏好'); integer(progress.preferences.codeFontSize, '代码字号', 10, 32);
  fields(progress.current, ['rankId', 'subrankId', 'activityId', 'stepId'], '当前位置'); id(progress.current.rankId, '当前段位'); progress.current.subrankId = optionalId(progress.current.subrankId, '当前小段位'); progress.current.activityId = optionalId(progress.current.activityId, '当前活动'); progress.current.stepId = optionalId(progress.current.stepId, '当前步骤');
  fields(progress.xp, ['total', 'level', 'currentLevelXp', 'nextLevelXp'], '经验状态'); integer(progress.xp.total, '总经验', 0); integer(progress.xp.level, '经验等级', 1); integer(progress.xp.currentLevelXp, '当前等级经验', 0, 99); integer(progress.xp.nextLevelXp, '升级所需经验', 1, 100);
  progress.rankStates = list(progress.rankStates, '段位状态', 9).map(raw => { fields(raw, ['rankId', 'status', 'earnedStars', 'performancePoints', 'bossStatus', 'promotedAt'], '段位状态'); return { rankId: id(raw.rankId, '状态段位'), status: oneOf(raw.status, ['locked', 'available', 'completed'], '段位状态'), earnedStars: integer(raw.earnedStars, '段位星星', 0), performancePoints: integer(raw.performancePoints, '表现分', 0, 100), bossStatus: oneOf(raw.bossStatus, ['not-started', 'unlocked', 'in-progress', 'completed'], 'Boss 状态'), promotedAt: timestamp(raw.promotedAt, '晋段时间', true) }; });
  unique(progress.rankStates, 'rankId', '段位状态'); if (progress.rankStates.length !== course.ranks.length || course.ranks.some(rank => !progress.rankStates.some(state => state.rankId === rank.id))) fail('段位状态必须覆盖九阶蛋位');
  progress.sessions = list(progress.sessions, '游玩会话', 100_000).map(raw => { fields(raw, ['id', 'activityId', 'startedAt', 'endedAt', 'minutes'], '游玩会话'); return { id: id(raw.id, '会话编号'), activityId: id(raw.activityId, '会话活动'), startedAt: timestamp(raw.startedAt, '开始时间'), endedAt: timestamp(raw.endedAt, '结束时间'), minutes: integer(raw.minutes, '游玩分钟', 0, 1440) }; }); unique(progress.sessions, 'id', '会话编号');
  progress.attempts = list(progress.attempts, '尝试记录', 100_000).map(raw => { fields(raw, ['id', 'kind', 'submittedAt', 'payload', 'result'], '尝试记录'); const kind = oneOf(raw.kind, ['level', 'project'], '尝试类型'); return { id: id(raw.id, '尝试编号'), kind, submittedAt: timestamp(raw.submittedAt, '尝试时间'), payload: kind === 'level' ? normalizeLevelInput(raw.payload) : normalizeProjectInput(raw.payload), result: normalizeResult(raw.result) }; });
  unique(progress.attempts, 'id', '尝试编号'); unique(progress.attempts, attempt => attempt.payload.requestId, '提交编号');
  progress.projectArtifacts = list(progress.projectArtifacts, '作品进度', 100).map(raw => { fields(raw, ['projectId', 'rankId', 'contentVersion', 'completedChapterIds', 'bossCompletedAt', 'bossAttemptId'], '作品进度'); return { projectId: id(raw.projectId, '作品编号'), rankId: id(raw.rankId, '作品段位'), contentVersion: integer(raw.contentVersion, '作品版本', 1), completedChapterIds: ids(raw.completedChapterIds, '已完成章节'), bossCompletedAt: timestamp(raw.bossCompletedAt, '作品 Boss 完成时间', true), bossAttemptId: optionalId(raw.bossAttemptId, '作品 Boss 尝试') }; }); unique(progress.projectArtifacts, 'projectId', '作品进度');
  progress.awardLedger = list(progress.awardLedger, '奖励账本', 100_000).map(award); unique(progress.awardLedger, 'key', '奖励键');
  fields(progress.achievementWall, ['earned', 'visibleLockedIds', 'hiddenCount'], '成就墙'); progress.achievementWall.earned = list(progress.achievementWall.earned, '已获成就', 1000).map(raw => { fields(raw, ['achievementId', 'earnedAt', 'attemptId'], '已获成就'); return { achievementId: id(raw.achievementId, '成就编号'), earnedAt: timestamp(raw.earnedAt, '成就时间'), attemptId: id(raw.attemptId, '成就尝试') }; }); unique(progress.achievementWall.earned, 'achievementId', '已获成就'); progress.achievementWall.visibleLockedIds = ids(progress.achievementWall.visibleLockedIds, '可见未获成就'); integer(progress.achievementWall.hiddenCount, '隐藏成就数量', 0);
  fields(progress.derivedStatePolicy, ['sourceOfTruth', 'neverDemote', 'neverRevokeEarnedAwards', 'duplicateAwardKey'], '派生状态规则'); if (progress.derivedStatePolicy.neverDemote !== true || progress.derivedStatePolicy.neverRevokeEarnedAwards !== true || progress.derivedStatePolicy.duplicateAwardKey !== 'reject') fail('进度必须保证不掉段、不撤销奖励并拒绝重复奖励键'); text(progress.derivedStatePolicy.sourceOfTruth, '事实来源', true); progress.updatedAt = timestamp(progress.updatedAt, '更新时间', true);
  const rankMap = new Map(course.ranks.map(rank => [rank.id, rank]));
  const activityMap = new Map([...course.levels, ...course.projects].map(activity => [activity.id, activity]));
  const attemptIds = new Set(progress.attempts.map(item => item.id));
  const attemptsById = new Map(progress.attempts.map(item => [item.id, item]));
  for (const session of progress.sessions) {
    if (!activityMap.has(session.activityId) || Date.parse(session.endedAt) < Date.parse(session.startedAt)) fail('游玩会话的活动或时间范围无效');
  }
  for (const attempt of progress.attempts) {
    const activityId = attempt.kind === 'level' ? attempt.payload.levelId : attempt.payload.projectId;
    const activity = activityMap.get(activityId);
    const expectedType = attempt.kind === 'level' ? ['interactive-lesson', 'rank-boss'] : ['rank-project'];
    if (!activity || !expectedType.includes(activity.activityType || activity.kind) || attempt.payload.contentVersion > activity.version || !rankMap.has(attempt.result.currentRankId)) fail('尝试记录与课程不一致');
    if (attempt.payload.contentVersion === activity.version) {
      const sourceIds = attempt.kind === 'level'
        ? [...(activity.content?.steps || []), ...(activity.content?.checkpoints || [])].map(item => item.id)
        : [...activity.chapters.map(item => item.id), activity.boss.id];
      if (sourceIds.length && !sourceIds.includes(attempt.kind === 'level' ? attempt.payload.stepId : attempt.payload.checkpointId)) fail('尝试步骤与当前内容版本不一致');
    }
  }
  for (const item of progress.awardLedger) if (!attemptIds.has(item.attemptId)) fail('奖励引用未知尝试');
  for (const item of progress.awardLedger) {
    const attempt = attemptsById.get(item.attemptId);
    const activityId = attempt.kind === 'level' ? attempt.payload.levelId : attempt.payload.projectId;
    const activity = activityMap.get(activityId);
    if (!rankMap.has(item.rankId) || item.activityId !== activityId || item.rankId !== activity.rankId || item.earnedAt !== attempt.submittedAt) fail('奖励与产生它的尝试不一致');
  }
  for (const attempt of progress.attempts) {
    const entries = progress.awardLedger.filter(item => item.attemptId === attempt.id);
    const xpAwarded = entries.filter(item => item.kind === 'xp').reduce((sum, item) => sum + item.amount, 0);
    const starAwarded = entries.some(item => item.kind === 'star');
    const core = entries.filter(item => isRankReward(item.kind));
    if (xpAwarded !== attempt.result.xpAwarded || starAwarded !== attempt.result.starAwarded || core.length > 1 || Boolean(core.length) !== Boolean(attempt.result.tokenAwarded)) fail('尝试结果与不可变奖励账本不一致');
    if (core.length) {
      const catalog = course.rewardCatalog.find(item => item.id === attempt.result.tokenAwarded);
      if (!catalog || catalog.sourceRankId !== core[0].rankId || catalog.kind !== core[0].kind || core[0].key !== `rank:${core[0].rankId}:core`) fail('核心奖励与课程目录不一致');
    }
  }
  for (const item of progress.achievementWall.earned) if (!attemptIds.has(item.attemptId)) fail('成就引用未知尝试');
  for (const artifact of progress.projectArtifacts) {
    const project = course.projects.find(item => item.id === artifact.projectId);
    if (!project || project.rankId !== artifact.rankId || artifact.contentVersion > project.version || artifact.completedChapterIds.some(chapterId => !project.chapters.some(chapter => chapter.id === chapterId))) fail('作品进度与课程不一致');
    for (const chapterId of artifact.completedChapterIds) {
      const evidence = progress.attempts.some(attempt => attempt.kind === 'project' && attempt.payload.projectId === project.id && attempt.payload.checkpointId === chapterId && attempt.result.checkpointCompleted);
      if (!evidence) fail('作品章节完成状态缺少尝试证据');
    }
    if (Boolean(artifact.bossCompletedAt) !== Boolean(artifact.bossAttemptId)) fail('作品 Boss 完成状态不完整');
    if (artifact.bossAttemptId) {
      const attempt = attemptsById.get(artifact.bossAttemptId);
      if (!attempt || attempt.kind !== 'project' || attempt.payload.projectId !== project.id || attempt.payload.checkpointId !== project.boss.id || !attempt.result.levelCompleted || artifact.bossCompletedAt !== attempt.submittedAt) fail('作品 Boss 引用未知或不匹配的尝试');
    }
  }
  const totalXp = progress.awardLedger.filter(item => item.kind === 'xp').reduce((sum, item) => sum + item.amount, 0);
  if (progress.xp.total !== totalXp || progress.xp.level !== Math.floor(totalXp / 100) + 1 || progress.xp.currentLevelXp !== totalXp % 100 || progress.xp.nextLevelXp !== 100 - (totalXp % 100)) fail('经验状态与不可重复奖励账本不一致');
  if (!rankMap.has(progress.current.rankId)) fail('当前位置引用未知段位');
  const currentRank = rankMap.get(progress.current.rankId);
  const currentOrder = currentRank.order;
  for (const rank of course.ranks) {
    const state = progress.rankStates.find(item => item.rankId === rank.id);
    const stars = progress.awardLedger.filter(item => item.kind === 'star' && item.rankId === rank.id).reduce((sum, item) => sum + item.amount, 0);
    const points = Math.max(0, ...progress.attempts.filter(item => item.kind === 'project' && course.projects.find(project => project.id === item.payload.projectId)?.rankId === rank.id).map(item => item.payload.performancePoints));
    if (state.earnedStars !== stars || state.performancePoints !== points) fail(`${rank.title}状态与尝试或奖励账本不一致`);
    const core = progress.awardLedger.filter(item => isRankReward(item.kind) && item.rankId === rank.id);
    if (core.length > 1) fail(`${rank.title}存在重复核心奖励`);
    const expectedStatus = core.length ? 'completed' : rank.order === currentOrder ? 'available' : rank.order > currentOrder ? 'locked' : '';
    if (!expectedStatus || state.status !== expectedStatus || (core.length && (state.bossStatus !== 'completed' || state.promotedAt !== core[0].earnedAt)) || (!core.length && state.promotedAt !== null)) fail(`${rank.title}的段位状态与永久奖励不一致`);
  }
  if (progress.current.activityId && !currentRank.activityIds.includes(progress.current.activityId)) fail('当前位置活动不属于当前段位');
  if (progress.current.subrankId && !currentRank.subdivisions.some(item => item.id === progress.current.subrankId)) fail('当前位置小段位不属于当前段位');
  if (progress.revision < progress.attempts.length) fail('进度版本不能小于唯一提交数量');
  return progress;
}

function firstStep(course, activityId) {
  const level = course.levels.find(item => item.id === activityId);
  if (level?.content?.steps?.length) return level.content.steps[0].id;
  if (level?.content?.checkpoints?.length) return level.content.checkpoints[0].id;
  const project = course.projects.find(item => item.id === activityId);
  return project?.chapters?.[0]?.id || '';
}

/** Create a clean rich learner progress document. */
export function freshProgress(rawCourse, learnerId = 'learner-1') {
  const course = sanitizeCourse(rawCourse);
  const first = course.ranks[0];
  return sanitizeProgress(course, {
    schemaVersion: 2, courseId: course.courseId, courseRevision: course.publishedRevision, revision: 0,
    learner: { id: id(learnerId, '学习者编号'), displayName: '学习者', avatar: { bodyColor: 'yellow', face: 'default', accessories: [] } },
    preferences: { sound: true, reducedMotion: 'system', codeFontSize: 15 },
    current: { rankId: first.id, subrankId: first.subdivisions[0]?.id || '', activityId: first.activityIds[0] || '', stepId: firstStep(course, first.activityIds[0]) },
    xp: { total: 0, level: 1, currentLevelXp: 0, nextLevelXp: 100 },
    rankStates: course.ranks.map(rank => ({ rankId: rank.id, status: rank.order === 1 ? 'available' : 'locked', earnedStars: 0, performancePoints: 0, bossStatus: 'not-started', promotedAt: null })),
    sessions: [], attempts: [], projectArtifacts: [], awardLedger: [],
    achievementWall: { earned: [], visibleLockedIds: course.achievements.filter(item => !item.hidden).map(item => item.id), hiddenCount: course.achievements.filter(item => item.hidden).length },
    derivedStatePolicy: defaultPolicy(), updatedAt: null
  });
}

function findReplay(progress, kind, payload) {
  const attempt = progress.attempts.find(item => item.payload.requestId === payload.requestId);
  if (!attempt) return null;
  if (attempt.kind !== kind || !same(attempt.payload, payload)) fail('同一提交编号不能用于不同内容', 409, 'request_id_conflict');
  return attempt;
}
function completedLevelIds(progress, pendingLevelId = '') {
  const completed = new Set(progress.attempts.filter(item => item.kind === 'level' && item.result.levelCompleted).map(item => item.payload.levelId));
  if (pendingLevelId) completed.add(pendingLevelId);
  return completed;
}
function completedBossSteps(progress, levelId, contentVersion) { return new Set(progress.attempts.filter(item => item.kind === 'level'
  && item.payload.levelId === levelId
  && item.payload.contentVersion === contentVersion
  && item.result.checkpointCompleted).map(item => item.payload.stepId)); }
function rankState(progress, rankId) { return progress.rankStates.find(item => item.rankId === rankId); }
function addAward(progress, entry) { if (progress.awardLedger.some(item => item.key === entry.key)) return false; progress.awardLedger.push(entry); return true; }
function recomputeXp(progress) { const total = progress.awardLedger.filter(item => item.kind === 'xp').reduce((sum, item) => sum + item.amount, 0); progress.xp = { total, level: Math.floor(total / 100) + 1, currentLevelXp: total % 100, nextLevelXp: 100 - (total % 100) }; }
function isRankReward(kind) { return ['ability-token', 'project-trophy', 'final-trophy'].includes(kind); }
function hasRankReward(progress, rankId) { return progress.awardLedger.some(item => isRankReward(item.kind) && item.rankId === rankId); }
function courseCompleted(course, progress) { return course.ranks.every(rank => hasRankReward(progress, rank.id)); }

function projectArtifact(progress, project) {
  let artifact = progress.projectArtifacts.find(item => item.projectId === project.id);
  if (!artifact) { artifact = { projectId: project.id, rankId: project.rankId, contentVersion: project.version, completedChapterIds: [], bossCompletedAt: null, bossAttemptId: '' }; progress.projectArtifacts.push(artifact); }
  return artifact;
}
function bossUnlocked(course, progress, rank, completed = completedLevelIds(progress)) {
  const earnedStars = progress.awardLedger.filter(item => item.kind === 'star' && item.rankId === rank.id).reduce((sum, item) => sum + item.amount, 0);
  if (rank.promotion.metric === 'stars' && earnedStars < rank.promotion.requiredStars) return false;
  if (!rank.projectId) {
    const bossId = rank.promotion.bossActivityId;
    const boss = course.levels.find(item => item.id === bossId);
    return !!boss && boss.prerequisiteLevelIds.every(value => completed.has(value));
  }
  const project = course.projects.find(item => item.id === rank.projectId), artifact = progress.projectArtifacts.find(item => item.projectId === project.id);
  return !!artifact && project.chapters.every(chapter => artifact.completedChapterIds.includes(chapter.id));
}
function moveToNextLevel(course, progress, rank, completed, afterActivityId) {
  if (progress.current.rankId !== rank.id) return;
  const start = Math.max(0, rank.activityIds.indexOf(afterActivityId) + 1);
  for (const activityId of rank.activityIds.slice(start)) {
    const candidate = course.levels.find(item => item.id === activityId);
    if (!candidate || completed.has(candidate.id) || !candidate.prerequisiteLevelIds.every(value => completed.has(value))) continue;
    if (candidate.kind === 'rank-boss' && !bossUnlocked(course, progress, rank, completed)) continue;
    progress.current = { rankId: rank.id, subrankId: candidate.subrankId || '', activityId: candidate.id, stepId: firstStep(course, candidate.id) };
    return;
  }
}
function moveToNextProjectCheckpoint(course, progress, rank, project, artifact, afterCheckpointId) {
  if (progress.current.rankId !== rank.id) return;
  const index = project.chapters.findIndex(item => item.id === afterCheckpointId);
  const nextChapter = project.chapters.slice(Math.max(0, index + 1)).find(item => !artifact.completedChapterIds.includes(item.id));
  if (nextChapter) {
    progress.current = { rankId: rank.id, subrankId: '', activityId: project.id, stepId: nextChapter.id };
  } else if (bossUnlocked(course, progress, rank)) {
    progress.current = { rankId: rank.id, subrankId: '', activityId: project.id, stepId: project.boss.id };
  }
}
function baseResult(progress, course) { return { xpAwarded: 0, starAwarded: false, levelCompleted: false, checkpointCompleted: false, bossUnlocked: false, rankPromoted: '', tokenAwarded: '', currentRankId: progress.current.rankId, courseCompleted: courseCompleted(course, progress) }; }
function awardXp(progress, rankId, activityId, sourceId, amount, attemptId, earnedAt, grantKey) {
  if (!addAward(progress, { key: grantKey, kind: 'xp', rankId, activityId, sourceId, amount, title: '', attemptId, earnedAt })) return 0;
  return amount;
}
function promote(course, progress, rank, activityId, sourceId, meta) {
  if (hasRankReward(progress, rank.id) || progress.current.rankId !== rank.id) return { tokenAwarded: '', rankPromoted: '' };
  const reward = course.rewardCatalog.find(item => item.sourceRankId === rank.id);
  if (!reward) fail(`${rank.title}缺少核心奖励`, 500, 'course_corrupt');
  addAward(progress, { key: `rank:${rank.id}:core`, kind: reward.kind, rankId: rank.id, activityId, sourceId, amount: 1, title: reward.title, attemptId: meta.id, earnedAt: meta.submittedAt });
  const state = rankState(progress, rank.id); state.status = 'completed'; state.bossStatus = 'completed'; state.promotedAt = meta.submittedAt;
  const next = course.ranks.find(item => item.order === rank.order + 1);
  if (next) {
    const nextState = rankState(progress, next.id); nextState.status = 'available';
    progress.current = { rankId: next.id, subrankId: next.subdivisions[0]?.id || '', activityId: next.activityIds[0] || '', stepId: firstStep(course, next.activityIds[0]) };
  }
  return { tokenAwarded: reward.id, rankPromoted: next?.id || '' };
}
function finish(course, progress, kind, payload, meta, result) {
  recomputeXp(progress);
  const completed = completedLevelIds(progress, kind === 'level' && result.levelCompleted ? payload.levelId : '');
  for (const rank of course.ranks) {
    const state = rankState(progress, rank.id);
    state.earnedStars = progress.awardLedger.filter(item => item.kind === 'star' && item.rankId === rank.id).reduce((sum, item) => sum + item.amount, 0);
    state.performancePoints = Math.max(0, ...progress.attempts.filter(item => item.kind === 'project' && course.projects.find(project => project.id === item.payload.projectId)?.rankId === rank.id).map(item => item.payload.performancePoints), kind === 'project' && course.projects.find(project => project.id === payload.projectId)?.rankId === rank.id ? payload.performancePoints : 0);
    if (!hasRankReward(progress, rank.id) && state.status === 'available') state.bossStatus = state.bossStatus === 'in-progress' ? 'in-progress' : bossUnlocked(course, progress, rank, completed) ? 'unlocked' : 'not-started';
  }
  result.currentRankId = progress.current.rankId; result.courseCompleted = courseCompleted(course, progress);
  progress.attempts.push({ id: meta.id, kind, submittedAt: meta.submittedAt, payload: clone(payload), result: clone(result) });
  progress.revision++; progress.courseRevision = course.publishedRevision; progress.updatedAt = meta.submittedAt;
  const validated = sanitizeProgress(course, progress);
  return { progress: validated, result: { ...clone(result), replayed: false } };
}

/** Save a trusted, graded interactive lesson or online Boss attempt. */
export function submitAttempt(rawCourse, rawProgress, rawInput, rawMeta) {
  const course = sanitizeCourse(rawCourse);
  const progress = sanitizeProgress(course, rawProgress);
  const input = normalizeLevelInput(rawInput), meta = normalizeMeta(rawMeta);
  const replay = findReplay(progress, 'level', input); if (replay) return { progress, result: { ...clone(replay.result), replayed: true } };
  if (progress.attempts.some(item => item.id === meta.id)) fail('尝试编号已经存在', 409, 'attempt_id_conflict');
  const level = course.levels.find(item => item.id === input.levelId);
  if (!level) fail('关卡不存在', 404, 'level_not_found');
  if (!level.content) fail('关卡详情尚未注入', 500, 'level_content_missing');
  if (input.contentVersion !== level.version) fail('关卡内容已经更新', 409, 'content_version_conflict');
  const rank = course.ranks.find(item => item.id === level.rankId), current = course.ranks.find(item => item.id === progress.current.rankId);
  if (rank.order > current.order) fail('该段位尚未解锁', 409, 'rank_locked');
  const done = completedLevelIds(progress);
  const boss = level.kind === 'rank-boss';
  if (boss && !bossUnlocked(course, progress, rank)) fail('Boss 尚未解锁', 409, 'boss_locked');
  if (!done.has(level.id) && !level.prerequisiteLevelIds.every(value => done.has(value))) fail('前置关卡尚未完成', 409, 'level_locked');
  const steps = boss ? level.content.checkpoints : level.content.steps;
  const step = steps.find(item => item.id === input.stepId); if (!step) fail('步骤不存在', 404, 'step_not_found');
  const levelAlreadyCompleted = done.has(level.id);
  let passedSteps = new Set();
  if (!boss && !levelAlreadyCompleted) {
    const stepIndex = steps.indexOf(step);
    passedSteps = new Set(progress.attempts.filter(item => item.kind === 'level' && item.payload.levelId === level.id && item.payload.contentVersion === level.version && item.payload.passed).map(item => item.payload.stepId));
    if (steps.slice(0, stepIndex).some(previous => !passedSteps.has(previous.id))) fail('前一步骤尚未通过', 409, 'step_locked');
  }
  let variation = null;
  if (input.variantId) { variation = step.variants?.find(item => item.id === input.variantId); if (!variation) fail('变式不属于当前步骤'); }
  if (input.viewedFullAnswer && !input.variantId) fail('查看独立变式完整答案时须记录变式编号');
  const next = clone(progress), result = baseResult(next, course);
  const completedCursorMayAdvance = !boss && levelAlreadyCompleted && rank.id === current.id && progress.current.activityId === level.id;
  const controlsCurrent = rank.id === current.id && !levelAlreadyCompleted;
  if (controlsCurrent) next.current = { rankId: rank.id, subrankId: level.subrankId || '', activityId: level.id, stepId: step.id };
  if (!boss) {
    result.xpAwarded += awardXp(next, rank.id, level.id, step.id, level.content.rewards.xp.firstMeaningfulAttempt, meta.id, meta.submittedAt, `xp:${level.id}:attempt`);
    const completionStepId = level.content.rewards.star.sourceStepId;
    const priorViews = next.attempts.filter(item => item.kind === 'level'
      && item.payload.levelId === level.id
      && item.payload.contentVersion === level.version
      && item.payload.stepId === completionStepId
      && item.payload.viewedFullAnswer).map(item => item.payload.variantId);
    const unusedEquivalent = variation && !priorViews.includes(variation.id) && priorViews.some(previous => previous !== variation.id);
    const recoveredAfterSolution = !priorViews.length || (input.independent && unusedEquivalent);
    const completionPassed = input.stepId === completionStepId && input.passed && !input.viewedFullAnswer && recoveredAfterSolution;
    if (completionPassed) {
      result.xpAwarded += awardXp(next, rank.id, level.id, step.id, level.content.rewards.xp.firstClear, meta.id, meta.submittedAt, `xp:${level.id}:clear`);
      if (!done.has(level.id)) result.levelCompleted = true;
      const eligible = input.independent && !input.viewedFullAnswer && variation && !priorViews.includes(variation.id) && (!priorViews.length || priorViews.some(previous => previous !== variation.id));
      if (eligible && addAward(next, { key: `star:${level.id}`, kind: 'star', rankId: rank.id, activityId: level.id, sourceId: variation.id, amount: level.content.rewards.star.amount, title: level.title, attemptId: meta.id, earnedAt: meta.submittedAt })) result.starAwarded = true;
      const completed = completedLevelIds(next, level.id);
      if (controlsCurrent || completedCursorMayAdvance) moveToNextLevel(course, next, rank, completed, level.id);
    } else if (controlsCurrent) {
      const passedAfter = new Set(passedSteps);
      if (input.passed) passedAfter.add(step.id);
      const firstIncomplete = level.content.steps.find(item => !passedAfter.has(item.id));
      next.current.stepId = firstIncomplete?.id || step.id;
    }
  } else {
    const checkpointIds = level.content.checkpoints.map(item => item.id), prior = completedBossSteps(next, level.id, level.version), index = checkpointIds.indexOf(step.id);
    if (index > 0 && checkpointIds.slice(0, index).some(checkpointId => !prior.has(checkpointId))) fail('Boss 前一检查点尚未完成', 409, 'checkpoint_locked');
    const final = index === checkpointIds.length - 1, qualifying = input.passed && (!final || (input.independent && !input.viewedFullAnswer));
    if (qualifying && !prior.has(step.id)) result.checkpointCompleted = true;
    const after = new Set(prior); if (qualifying) after.add(step.id);
    if (qualifying && !final && rank.id === current.id) {
      const nextCheckpointId = checkpointIds.slice(index + 1).find(checkpointId => !after.has(checkpointId));
      if (nextCheckpointId) next.current.stepId = nextCheckpointId;
    }
    if (after.size === checkpointIds.length && final && qualifying) {
      result.levelCompleted = !done.has(level.id);
      result.xpAwarded += awardXp(next, rank.id, level.id, step.id, level.content.rewards.xp, meta.id, meta.submittedAt, `xp:${level.id}:boss-clear`);
      Object.assign(result, promote(course, next, rank, level.id, step.id, meta));
    } else rankState(next, rank.id).bossStatus = 'in-progress';
  }
  result.bossUnlocked = bossUnlocked(course, next, rank, completedLevelIds(next, result.levelCompleted ? level.id : ''));
  return finish(course, next, 'level', input, meta, result);
}

/** Save a graded chapter checkpoint or project Boss result. */
export function submitProjectCheckpoint(rawCourse, rawProgress, rawInput, rawMeta) {
  const course = sanitizeCourse(rawCourse), progress = sanitizeProgress(course, rawProgress), input = normalizeProjectInput(rawInput), meta = normalizeMeta(rawMeta);
  const replay = findReplay(progress, 'project', input); if (replay) return { progress, result: { ...clone(replay.result), replayed: true } };
  if (progress.attempts.some(item => item.id === meta.id)) fail('尝试编号已经存在', 409, 'attempt_id_conflict');
  const project = course.projects.find(item => item.id === input.projectId); if (!project) fail('作品不存在', 404, 'project_not_found');
  if (input.contentVersion !== project.version) fail('作品内容已经更新', 409, 'content_version_conflict');
  const rank = course.ranks.find(item => item.id === project.rankId), current = course.ranks.find(item => item.id === progress.current.rankId);
  if (rank.order > current.order) fail('该段位尚未解锁', 409, 'rank_locked');
  const chapter = project.chapters.find(item => item.id === input.checkpointId), isBoss = input.checkpointId === project.boss.id;
  if (!chapter && !isBoss) fail('作品检查点不存在', 404, 'checkpoint_not_found');
  const next = clone(progress), artifact = projectArtifact(next, project), result = baseResult(next, course);
  if (rank.id === current.id) next.current = { rankId: rank.id, subrankId: '', activityId: project.id, stepId: input.checkpointId };
  if (chapter) {
    const index = project.chapters.indexOf(chapter);
    if (project.chapters.slice(0, index).some(item => !artifact.completedChapterIds.includes(item.id))) fail('前一作品章节尚未完成', 409, 'checkpoint_locked');
    if (input.passed) {
      if (!artifact.completedChapterIds.includes(chapter.id)) {
        artifact.completedChapterIds.push(chapter.id); result.checkpointCompleted = true;
        result.xpAwarded += awardXp(next, rank.id, project.id, chapter.id, project.rewards.chapterXp, meta.id, meta.submittedAt, `xp:${project.id}:chapter:${chapter.id}`);
      }
      if (chapter.checkpoint.awardsStar && input.independent && !input.viewedFullAnswer && addAward(next, { key: `star:${project.id}:${chapter.id}`, kind: 'star', rankId: rank.id, activityId: project.id, sourceId: chapter.id, amount: project.rewards.independentCheckpointStar, title: chapter.title, attemptId: meta.id, earnedAt: meta.submittedAt })) result.starAwarded = true;
      moveToNextProjectCheckpoint(course, next, rank, project, artifact, chapter.id);
    }
  } else {
    if (!bossUnlocked(course, next, rank)) fail('作品 Boss 尚未解锁', 409, 'boss_locked');
    const pointsPass = rank.promotion.metric !== 'performance-points' || input.performancePoints >= rank.promotion.minimumPoints;
    const qualifying = input.passed && input.independent && !input.viewedFullAnswer && pointsPass;
    if (qualifying && !artifact.bossCompletedAt) {
      artifact.bossCompletedAt = meta.submittedAt; artifact.bossAttemptId = meta.id; result.checkpointCompleted = true; result.levelCompleted = true;
      result.xpAwarded += awardXp(next, rank.id, project.id, project.boss.id, project.rewards.bossXp, meta.id, meta.submittedAt, `xp:${project.id}:boss-clear`);
      Object.assign(result, promote(course, next, rank, project.id, project.boss.id, meta));
    } else rankState(next, rank.id).bossStatus = 'in-progress';
  }
  result.bossUnlocked = bossUnlocked(course, next, rank);
  return finish(course, next, 'project', input, meta, result);
}

function mainGoal(course, value) {
  if (value === null) return null;
  object(value, '本周主目标');
  if (value.kind === 'level') { fields(value, ['kind', 'id'], '本周主目标'); const activityId = id(value.id, '关卡编号'); if (!course.levels.some(item => item.id === activityId)) fail('主目标引用未知关卡'); return { kind: 'level', id: activityId }; }
  if (value.kind === 'project-checkpoint') { fields(value, ['kind', 'projectId', 'id'], '本周主目标'); const projectId = id(value.projectId, '作品编号'), checkpointId = id(value.id, '检查点编号'), project = course.projects.find(item => item.id === projectId); if (!project || (!project.chapters.some(item => item.id === checkpointId) && project.boss.id !== checkpointId)) fail('主目标引用未知作品检查点'); return { kind: 'project-checkpoint', projectId, id: checkpointId }; }
  fail('本周主目标类型无效');
}
function weekEntry(course, raw) {
  fields(raw, ['weekStart', 'mode', 'playDays', 'mainGoal', 'shortLevelId', 'note', 'updatedAt'], '周游玩安排');
  const weekStart = date(raw.weekStart, '自然周起始日'); if (new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) fail('周游玩安排须从周一开始');
  const entry = { weekStart, mode: oneOf(raw.mode, ['active', 'rest'], '游玩模式'), playDays: integer(raw.playDays, '计划游玩次数', 0, 7), mainGoal: mainGoal(course, raw.mainGoal), shortLevelId: optionalId(raw.shortLevelId, '短关卡编号'), note: text(raw.note, '周备注', false, 2_000), updatedAt: timestamp(raw.updatedAt, '周安排更新时间') };
  if (entry.shortLevelId && !course.levels.some(item => item.id === entry.shortLevelId && item.kind !== 'rank-boss')) fail('短关卡须为有效非 Boss 关卡');
  if (entry.mode === 'rest' && (entry.playDays || entry.mainGoal || entry.shortLevelId)) fail('休息周不能产生游玩目标或补课债务');
  if (entry.mode === 'active' && (!entry.playDays || !entry.mainGoal)) fail('游玩周须有游玩次数和一个主目标');
  return entry;
}

/** Validate the multi-week, no-debt weekly play-card document. */
export function sanitizeWeekCard(rawCourse, value) {
  const course = sanitizeCourse(rawCourse);
  fields(value, ['schemaVersion', 'learnerId', 'timezone', 'revision', 'preferences', 'suggestionPolicy', 'weeks', 'receipts'], '本周游玩卡');
  if (value.schemaVersion !== 2 || value.timezone !== 'Asia/Shanghai') fail('本周游玩卡版本或时区无效');
  const card = clone(value); card.learnerId = id(card.learnerId, '学习者编号'); card.revision = integer(card.revision, '游玩卡版本', 0);
  fields(card.preferences, ['normalPlayCount', 'shortLevelMaximumMinutes', 'allowRestWeek'], '游玩卡偏好'); integer(card.preferences.normalPlayCount, '常态游玩次数', 1, 7); integer(card.preferences.shortLevelMaximumMinutes, '短关卡分钟', 1, 120); if (card.preferences.allowRestWeek !== true) fail('游玩卡必须允许休息周');
  fields(card.suggestionPolicy, ['mainGoalCount', 'shortLevelCount', 'carryIncompleteForward', 'createOverdueDebt', 'requireMakeup', 'prioritize'], '游玩建议规则');
  if (card.suggestionPolicy.mainGoalCount !== 1 || card.suggestionPolicy.shortLevelCount !== 1 || card.suggestionPolicy.carryIncompleteForward !== true || card.suggestionPolicy.createOverdueDebt !== false || card.suggestionPolicy.requireMakeup !== false) fail('游玩卡须保持一个主目标、一个短关卡、可顺延且不产生欠账'); strings(card.suggestionPolicy.prioritize, '游玩建议优先级');
  card.weeks = list(card.weeks, '周安排', 1000).map(item => weekEntry(course, item)); unique(card.weeks, 'weekStart', '自然周');
  card.receipts = list(card.receipts, '周安排回执', 1000).map(raw => { fields(raw, ['requestId', 'payload', 'updatedAt'], '周安排回执'); return { requestId: id(raw.requestId, '回执提交编号'), payload: weekEntry(course, raw.payload), updatedAt: timestamp(raw.updatedAt, '回执时间') }; }); unique(card.receipts, 'requestId', '周安排回执');
  return card;
}

/** Create an empty play-card collection; optionally seed one explicit rest week. */
export function freshWeekCard(rawCourse, learnerId = 'learner-1', weekStart = '') {
  const course = sanitizeCourse(rawCourse), card = { schemaVersion: 2, learnerId: id(learnerId, '学习者编号'), timezone: 'Asia/Shanghai', revision: 0, preferences: { normalPlayCount: 3, shortLevelMaximumMinutes: 20, allowRestWeek: true }, suggestionPolicy: { mainGoalCount: 1, shortLevelCount: 1, carryIncompleteForward: true, createOverdueDebt: false, requireMakeup: false, prioritize: ['unfinished-current-activity', 'return-after-gap-check', 'next-unlocked-mainline', 'optional-short-level'] }, weeks: [], receipts: [] };
  if (weekStart) card.weeks.push({ weekStart, mode: 'rest', playDays: 0, mainGoal: null, shortLevelId: '', note: '', updatedAt: `${weekStart}T00:00:00+08:00` });
  return sanitizeWeekCard(course, card);
}

/** Derive the learner-facing home payload without changing persisted data. */
export function summary(rawCourse, rawProgress) {
  const course = sanitizeCourse(rawCourse), progress = sanitizeProgress(course, rawProgress);
  const currentRank = course.ranks.find(item => item.id === progress.current.rankId);
  const tokens = progress.awardLedger.filter(item => isRankReward(item.kind));
  const ranks = course.ranks.map(rank => {
    const state = rankState(progress, rank.id), reward = tokens.find(item => item.rankId === rank.id) || null;
    return { id: rank.id, order: rank.order, name: rank.title, technologyTheme: rank.technologyTheme, locationIds: clone(rank.locationIds), status: state.status, stars: state.earnedStars, performancePoints: state.performancePoints, bossStatus: state.bossStatus, bossUnlocked: state.status === 'available' ? bossUnlocked(course, progress, rank) : state.status === 'completed', token: reward ? clone(reward) : null };
  });
  return { learnerId: progress.learner.id, learner: clone(progress.learner), courseId: course.courseId, revision: progress.revision, xp: clone(progress.xp), currentRank: clone(ranks.find(item => item.id === currentRank.id)), ranks, starsTotal: progress.awardLedger.filter(item => item.kind === 'star').reduce((sum, item) => sum + item.amount, 0), tokens: clone(tokens), achievements: clone(progress.achievementWall), currentActivityId: progress.current.activityId, currentStepId: progress.current.stepId, projectArtifacts: clone(progress.projectArtifacts), courseCompleted: courseCompleted(course, progress) };
}

export const PARK_RANK_NAMES = Object.freeze([...RANK_NAMES]);
