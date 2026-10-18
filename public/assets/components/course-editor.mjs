const stylesheet = new URL('./course-editor.css', import.meta.url).href;
if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === stylesheet)) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = stylesheet;
  document.head.append(link);
}

const clone = value => structuredClone(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const atPath = (root, path) => path.reduce((value, part) => value?.[part], root);
const writePath = (root, path, nextValue) => {
  const next = clone(root);
  let target = next;
  for (let index = 0; index < path.length - 1; index++) target = target[path[index]];
  if (!path.length) return clone(nextValue);
  target[path.at(-1)] = clone(nextValue);
  return next;
};
const assertObjectArray = (value, label) => {
  if (!Array.isArray(value) || value.some(item => !isObject(item))) throw new Error(`${label}必须是对象列表。`);
};
const validateEditorCandidate = (value, kind) => {
  if (kind === 'project') {
    if (value.activityType !== 'rank-project') throw new Error('段位作品必须保留 rank-project 内容类型。');
    assertObjectArray(value.chapters, '作品章节');
    value.chapters.forEach((chapter, index) => {
      if (chapter.conceptModule !== undefined) {
        if (!isObject(chapter.conceptModule)) throw new Error(`第 ${index + 1} 章的概念理解必须是对象。`);
        assertObjectArray(chapter.conceptModule.terms, `第 ${index + 1} 章的概念术语`);
        assertObjectArray(chapter.conceptModule.checks, `第 ${index + 1} 章的理解题`);
        chapter.conceptModule.checks.forEach((check, checkIndex) => assertObjectArray(check.options, `第 ${index + 1} 章第 ${checkIndex + 1} 道理解题的选项`));
      }
      if (chapter.guidedSteps !== undefined) assertObjectArray(chapter.guidedSteps, `第 ${index + 1} 章的引导步骤`);
      if (chapter.hintLadder !== undefined) assertObjectArray(chapter.hintLadder, `第 ${index + 1} 章的分层提示`);
    });
    if (value.boss !== undefined) {
      if (!isObject(value.boss)) throw new Error('作品 Boss 必须是对象。');
      assertObjectArray(value.boss.phases, '作品 Boss 阶段');
    }
    return;
  }
  if (!isObject(value.content)) throw new Error('在线关卡必须保留 content 详情对象。');
  if (value.content.steps !== undefined) assertObjectArray(value.content.steps, '学习步骤');
  if (value.content.checkpoints !== undefined) assertObjectArray(value.content.checkpoints, 'Boss 检查点');
};

const LABELS = {
  schemaVersion: '数据结构版本', id: '稳定编号', version: '内容版本', activityType: '内容类型', rankId: '所属段位', subrankId: '所属小段位', sequence: '段位内顺序', file: '详情文件',
  title: '名称', technologyTheme: '技术主题', languages: '使用语言', locationId: '场景', locationIds: '场景', propIds: '关联道具', estimatedMinutes: '预计分钟', estimatedSessions: '预计游玩次数', minimum: '最少', typical: '通常', maximum: '最高', prerequisiteLevelIds: '前置关卡', prerequisiteActivityIds: '前置活动',
  story: '故事与作品目标', phase: '阶段', goal: '学习目标', objectives: '学习目标', concepts: '核心概念', conceptModule: '概念理解', guidedBuild: '引导构建', milestone: '阶段成果', laterReencounter: '后续再次遇见', filesTouched: '涉及文件', targetFiles: '目标文件', instruction: '本步任务', verify: '完成标志',
  learningGoal: '理解目标', phenomenon: '先观察的现象', observation: '现象描述', question: '思考问题', mentalModel: '心智模型', summary: '模型说明', flow: '流转步骤', explanation: '解释', terms: '术语与代码映射', term: '术语', plainMeaning: '白话解释', codeMapping: '代码中的位置', workedExample: '完整例子', takeaway: '例子结论', misconceptions: '常见误解', claim: '错误理解', correction: '正确理解', checks: '理解题', options: '选项', correctOptionId: '正确选项编号', bridgeToCode: '进入代码的桥接',
  guidedSteps: '完整代码引导', runbook: '运行与验证', buildCommands: '构建命令', runActions: '运行操作', expectedResults: '预期结果', hintLadder: '分层提示', tier: '提示层级', text: '内容', checkpoint: '独立检查', task: '独立任务', evidence: '提交证据', automatedChecks: '自动检查', selfChecks: '自检清单', awardsStar: '完成后授予星星',
  environment: '运行环境', platform: '平台', languageStandard: '语言标准', toolchain: '工具链', buildSystem: '构建系统', outputBackend: '输出方式', inputBackend: '输入方式', requirements: '环境要求', supportedHosts: '支持终端', artifact: '最终作品', workingTitle: '作品名', entryFile: '入口文件', persistentFiles: '持久化文件', runTarget: '运行目标', hardwareProfile: '硬件档案', strategy: '配置策略', requiredCapabilities: '必需硬件能力', debugEvidence: '调试与验收证据', components: '组成模块', requiredDeliverables: '交付物',
  oneProjectRule: '单一作品规则', allChaptersModifySameArtifact: '所有章节持续修改同一作品', chapterExercisesAreNotSeparateProjects: '章节练习不是独立小项目', guidancePolicy: '引导策略', mode: '模式', conceptLessonsPerChapter: '每章概念理解课数', guidedLessonsPerChapter: '每章引导步骤数', independentCheckpointPerChapter: '每章包含独立检查', cumulativeArtifact: '作品持续累积', chapterSnapshotRequired: '保留章末快照', fullSolutionScope: '完整代码范围', learnerFreedomBoundary: '学习者自由发挥边界',
  coreContract: '作品核心合同', chapterTeachingLoop: '章节学习循环', chapters: '章节', boss: 'Boss', phases: 'Boss 阶段', successCriteria: '通过条件', faultScenarios: '故障场景', resumableByPhase: '可按阶段续玩', managerApprovalRequired: '需要管理者审批', performancePoints: '表现分', pass: '及格分', dimensions: '评分维度', referenceIntegration: '参考整合方案',
  rewards: '经验、星星与战利品', chapterXp: '每章经验', independentCheckpointStar: '独立检查星星', bossXp: 'Boss 经验', trophy: '作品战利品', wallCategory: '成就墙类别', neverRevoke: '永久保留', aiContext: 'AI 导师上下文', copyFields: '复制字段', tutorInstruction: '导师指令',
  scene: '学习场景', intro: '开始说明', success: '完成说明', teachingLoop: '学习步骤顺序', steps: '学习步骤', type: '步骤类型', kind: '类型', prompt: '题目或任务说明', interaction: '交互方式', items: '选项', evaluator: '判定规则', feedback: '即时反馈', correct: '答对反馈', incorrect: '继续尝试反馈', runtimeId: '运行环境', starterFiles: '初始代码文件', stdin: '标准输入', expected: '预期结果', visualizer: '观察方式', observationPrompt: '观察问题', referencePoints: '解释要点', answerPolicy: '作答规则', minimumCharacters: '最少字数', managerVisible: '管理者可见', grader: '自动判定', cases: '测试用例', stdout: '标准输出', exitCode: '退出状态', hints: '分层提示', fullSolution: '完整解法', availableAfterTier: '解锁提示层级', effect: '查看后的影响', variantSetId: '变式组编号', variants: '独立变式', fullSolutionPolicy: '完整解法规则', starPolicy: '星星规则', award: '星星数量', firstIndependentClearOnly: '仅首次独立完成获得',
  resumePolicy: '续玩规则', checkpointed: '按检查点保存', resumeAtLastIncompleteCheckpoint: '从未完成检查点继续', checkpoints: 'Boss 检查点', completionRule: '完成规则', allCheckpointsRequired: '需要完成全部检查点', finalCheckpointMustBeIndependent: '最终检查点必须独立完成', xp: '经验规则', rankPromotion: '完成后晋段', coreToken: '核心信物', sourceStepId: '星星来源步骤', amount: '数量',
  requiredIdentifiers: '必须出现的标识符', files: '文件', language: '语言', codeOrCommand: '代码或命令'
};

const IMMUTABLE_KEYS = new Set(['schemaVersion', 'id', 'version', 'activityType', 'rankId', 'subrankId', 'file', 'kind', 'type', 'sequence']);
const LONG_KEYS = /story|prompt|goal|instruction|verify|guidedBuild|milestone|laterReencounter|evidence|text|feedback|expected|actual|tutorInstruction|fullSolutionScope|learnerFreedomBoundary|intro|success|observation|question|summary|explanation|plainMeaning|codeMapping|takeaway|claim|correction|bridgeToCode|effect/i;
const CODE_KEYS = /(^|\.)(starterFiles|fullSolution|stdin|stdout|buildCommands|code|command)(\.|$)|\.(c|h|cpp|hpp|sql|json|cmake)$/i;
const labelFor = key => LABELS[key] || String(key).replace(/([a-z])([A-Z])/g, '$1 $2');
const nodeTitle = (value, fallback) => value?.title || value?.id || fallback;

function projectGroups(item) {
  const groups = [{ id: 'project-overview', label: '作品概览', note: '范围、环境与最终作品', nodes: [
    { id: 'project-main', label: '基本信息', path: [], omit: ['schemaVersion', 'id', 'version', 'activityType', 'rankId', 'file', 'chapters', 'boss', 'rewards', 'aiContext', 'environment', 'artifact', 'guidancePolicy', 'oneProjectRule', 'coreContract', 'chapterTeachingLoop'] },
    ...(item.coreContract ? [{ id: 'project-contract', label: '作品合同', path: [], only: ['coreContract'] }] : []),
    ...(item.chapterTeachingLoop ? [{ id: 'project-loop', label: '学习循环', path: [], only: ['chapterTeachingLoop'] }] : []),
    ...(item.guidancePolicy ? [{ id: 'project-guidance', label: '课程引导规则', path: ['guidancePolicy'] }] : []),
    ...(item.environment ? [{ id: 'project-environment', label: '运行环境', path: ['environment'] }] : []),
    ...(item.artifact ? [{ id: 'project-artifact', label: '作品交付', path: ['artifact'] }] : []),
    ...(item.oneProjectRule ? [{ id: 'project-rule', label: '单一作品规则', path: ['oneProjectRule'] }] : [])
  ] }];
  (item.chapters || []).forEach((chapter, chapterIndex) => {
    const nodes = [{ id: `chapter-${chapterIndex}-overview`, label: '章节说明', path: ['chapters', chapterIndex], omit: ['id', 'filesTouched', 'conceptModule', 'guidedSteps', 'runbook', 'hintLadder', 'checkpoint'] }];
    if (chapter.conceptModule) {
      nodes.push({ id: `chapter-${chapterIndex}-concept-model`, label: '概念 · 现象与模型', path: ['chapters', chapterIndex, 'conceptModule'], only: ['title', 'learningGoal', 'phenomenon', 'mentalModel'] });
      nodes.push({ id: `chapter-${chapterIndex}-concept-code`, label: '概念 · 代码映射', path: ['chapters', chapterIndex, 'conceptModule'], only: ['terms', 'workedExample', 'misconceptions', 'bridgeToCode'] });
      (chapter.conceptModule.checks || []).forEach((check, checkIndex) => nodes.push({ id: `chapter-${chapterIndex}-concept-check-${checkIndex}`, label: `理解题 ${checkIndex + 1}`, path: ['chapters', chapterIndex, 'conceptModule', 'checks', checkIndex], omit: ['id'] }));
    }
    if (chapter.filesTouched) nodes.push({ id: `chapter-${chapterIndex}-files`, label: '文件范围', path: ['chapters', chapterIndex], only: ['filesTouched'] });
    (chapter.guidedSteps || []).forEach((step, stepIndex) => nodes.push({ id: `chapter-${chapterIndex}-guide-${stepIndex}`, label: `引导 ${stepIndex + 1}`, path: ['chapters', chapterIndex, 'guidedSteps', stepIndex], omit: ['id'] }));
    if (chapter.runbook) nodes.push({ id: `chapter-${chapterIndex}-runbook`, label: '运行与验证', path: ['chapters', chapterIndex, 'runbook'] });
    if (chapter.hintLadder) nodes.push({ id: `chapter-${chapterIndex}-hints`, label: '分层提示', path: ['chapters', chapterIndex, 'hintLadder'] });
    if (chapter.checkpoint) nodes.push({ id: `chapter-${chapterIndex}-checkpoint`, label: '独立检查', path: ['chapters', chapterIndex, 'checkpoint'] });
    groups.push({ id: `chapter-${chapterIndex}`, label: `第 ${chapterIndex + 1} 章 · ${nodeTitle(chapter, '未命名章节')}`, note: chapter.phase || chapter.goal || '', nodes });
  });
  if (item.boss) {
    const nodes = [{ id: 'boss-overview', label: 'Boss 说明', path: ['boss'], omit: ['id', 'phases'] }];
    (item.boss.phases || []).forEach((phase, index) => nodes.push({ id: `boss-phase-${index}`, label: `阶段 ${index + 1}`, path: ['boss', 'phases', index], omit: ['id'] }));
    groups.push({ id: 'boss', label: `Boss · ${nodeTitle(item.boss, '综合挑战')}`, note: '综合验收与故障场景', nodes });
  }
  const releaseNodes = [];
  if (item.rewards) releaseNodes.push({ id: 'project-rewards', label: '奖励与战利品', path: ['rewards'] });
  if (item.aiContext) releaseNodes.push({ id: 'project-ai', label: 'AI 导师上下文', path: ['aiContext'] });
  if (releaseNodes.length) groups.push({ id: 'project-release', label: '奖励与 AI', note: '保存后的反馈与辅助信息', nodes: releaseNodes });
  return groups;
}

function levelGroups(item) {
  const detail = item.content || {};
  const groups = [{ id: 'level-overview', label: '关卡概览', note: '名称、时长、前置与学习目标', nodes: [
    { id: 'level-summary', label: '索引与安排', path: [], omit: ['id', 'rankId', 'subrankId', 'sequence', 'kind', 'version', 'file', 'content'] },
    { id: 'level-learning', label: '学习目标', path: ['content'], omit: ['schemaVersion', 'id', 'version', 'activityType', 'rankId', 'subrankId', 'sequence', 'title', 'estimatedMinutes', 'prerequisiteLevelIds', 'scene', 'steps', 'checkpoints', 'rewards', 'aiContext', 'teachingLoop'] },
    ...(detail.scene ? [{ id: 'level-scene', label: '开始与完成说明', path: ['content', 'scene'], omit: ['locationId', 'propIds'] }] : [])
  ] }];
  const entries = detail.steps || detail.checkpoints || [];
  groups.push({ id: 'level-flow', label: detail.activityType === 'rank-boss' ? 'Boss 检查点' : '学习步骤', note: `${entries.length} 个逐步内容`, nodes: entries.map((entry, index) => ({ id: `level-step-${index}`, label: `${index + 1}. ${nodeTitle(entry, entry.type || entry.kind || '步骤')}`, path: ['content', detail.steps ? 'steps' : 'checkpoints', index], omit: ['id', 'type', 'kind'] })) });
  const releaseNodes = [];
  if (detail.completionRule) releaseNodes.push({ id: 'level-completion', label: '完成规则', path: ['content', 'completionRule'] });
  if (detail.resumePolicy) releaseNodes.push({ id: 'level-resume', label: '续玩规则', path: ['content', 'resumePolicy'] });
  if (detail.rewards) releaseNodes.push({ id: 'level-rewards', label: '经验、星星与信物', path: ['content', 'rewards'] });
  if (detail.aiContext) releaseNodes.push({ id: 'level-ai', label: 'AI 导师上下文', path: ['content', 'aiContext'] });
  if (releaseNodes.length) groups.push({ id: 'level-release', label: '完成与奖励', note: '晋段、奖励和 AI 辅助', nodes: releaseNodes });
  return groups.filter(group => group.nodes.length);
}

export class EggyCourseEditor extends HTMLElement {
  #content;
  #course;
  #kind = '';
  #groupId = '';
  #nodeId = '';
  #mode = 'visual';
  #rawDirty = false;
  #fields = new Map();
  #listeners;
  #fieldCounter = 0;

  connectedCallback() {
    this.#listeners?.abort();
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;
    this.addEventListener('click', event => this.#click(event), { signal });
    this.addEventListener('change', event => this.#change(event), { signal });
    this.addEventListener('input', event => this.#input(event), { signal });
    this.#render();
  }

  disconnectedCallback() { this.#listeners?.abort(); }

  set model(value) {
    const nextId = value?.item?.id || '';
    const changed = nextId !== this.#content?.id || value?.kind !== this.#kind;
    this.#kind = value?.kind || '';
    this.#course = value?.course || null;
    this.#content = value?.item ? clone(value.item) : null;
    if (changed) { this.#groupId = ''; this.#nodeId = ''; this.#mode = 'visual'; this.#rawDirty = false; }
    this.#render();
  }

  get value() { return this.#content ? clone(this.#content) : null; }

  commit() {
    if (this.#mode !== 'json' || !this.#rawDirty) return { ok: true, value: this.value };
    const textarea = this.querySelector('#content-json');
    try {
      const parsed = JSON.parse(textarea?.value || '');
      if (!isObject(parsed) || parsed.id !== this.#content.id) throw new Error('内容必须是对象，并保留当前稳定编号。');
      validateEditorCandidate(parsed, this.#kind);
      this.#content = parsed;
      this.#rawDirty = false;
      this.#error('');
      this.#emitChange('json');
      return { ok: true, value: this.value };
    } catch (error) {
      this.#error(`JSON 未采用：${error.message}`);
      return { ok: false, error };
    }
  }

  #groups() { return this.#kind === 'project' ? projectGroups(this.#content) : levelGroups(this.#content); }

  #selection() {
    const groups = this.#groups();
    let group = groups.find(candidate => candidate.id === this.#groupId) || groups[0];
    this.#groupId = group?.id || '';
    let node = group?.nodes.find(candidate => candidate.id === this.#nodeId) || group?.nodes[0];
    this.#nodeId = node?.id || '';
    return { groups, group, node };
  }

  #render() {
    if (!this.isConnected) return;
    if (!this.#content) { this.innerHTML = '<p class="course-editor-empty">请选择一个关卡或作品开始编辑。</p>'; return; }
    this.#fields.clear(); this.#fieldCounter = 0;
    const { groups, group, node } = this.#selection();
    const kindLabel = this.#kind === 'project' ? '段位作品' : this.#content.content?.activityType === 'rank-boss' ? '晋段 Boss' : '互动关卡';
    const itemTitle = this.#content.title || this.#content.name || this.#content.id;
    const nodeValue = node ? atPath(this.#content, node.path) : null;
    const nodePosition = Math.max(0, group?.nodes.indexOf(node));
    const modeButtons = `<div class="course-editor-mode" aria-label="编辑模式"><button type="button" data-editor-mode="visual" aria-pressed="${this.#mode === 'visual'}">可视化编辑</button><button type="button" data-editor-mode="json" aria-pressed="${this.#mode === 'json'}">高级 JSON</button></div>`;
    const groupOptions = groups.map(candidate => `<option value="${esc(candidate.id)}" ${candidate.id === group?.id ? 'selected' : ''}>${esc(candidate.label)}</option>`).join('');
    const nodeButtons = (group?.nodes || []).map((candidate, index) => `<button type="button" data-editor-node="${esc(candidate.id)}" aria-current="${candidate.id === node?.id ? 'step' : 'false'}"><span>${index + 1}</span>${esc(candidate.label)}</button>`).join('');
    const stable = `<dl class="course-editor-meta"><div><dt>类型</dt><dd>${esc(kindLabel)}</dd></div><div><dt>稳定编号</dt><dd><code>${esc(this.#content.id)}</code></dd></div><div><dt>版本</dt><dd>${esc(this.#content.version || this.#content.content?.version || 1)} · 保存变更后自动递增</dd></div></dl>`;
    const visual = `<div class="course-editor-visual"><div class="course-editor-route"><label for="course-editor-section">当前章节或区域</label><select id="course-editor-section">${groupOptions}</select><small>${esc(group?.note || '')}</small></div><nav class="course-editor-steps" aria-label="当前区域内容">${nodeButtons}</nav><div class="course-editor-focus"><div class="course-editor-focus-heading"><div><p>${esc(group?.label || '')} · ${nodePosition + 1}/${group?.nodes.length || 0}</p><h4 id="course-editor-focus-title" tabindex="-1">${esc(node?.label || '内容')}</h4></div><span>${esc(nodeTitle(nodeValue, labelFor(node?.path.at(-1) || '内容')))}</span></div><div class="course-editor-form">${this.#renderValue(nodeValue, node?.path || [], { omit: new Set(node?.omit || []), only: node?.only ? new Set(node.only) : null, root: true })}</div><div class="course-editor-pager"><button class="button quiet" type="button" data-editor-page="previous" ${nodePosition <= 0 ? 'disabled' : ''}>上一步</button><p>每次只编辑一个层级；修改会先留在本页草稿中。</p><button class="button quiet" type="button" data-editor-page="next" ${nodePosition >= (group?.nodes.length || 1) - 1 ? 'disabled' : ''}>下一步</button></div></div></div>`;
    const raw = `<div class="course-editor-raw"><div class="course-editor-raw-note"><strong>高级结构编辑</strong><p>用于新增、删除或重排数组。修改后点击“应用到可视化草稿”；无效 JSON 不会污染当前草稿。</p></div><label class="json-label" for="content-json">当前关卡或作品 JSON</label><textarea id="content-json" class="json-editor" spellcheck="false" rows="28">${esc(JSON.stringify(this.#content, null, 2))}</textarea><div class="course-editor-raw-actions"><p id="json-error" class="inline-error" role="alert"></p><button class="button" type="button" data-apply-json>应用到可视化草稿</button></div></div>`;
    this.innerHTML = `<header class="course-editor-header"><div><p class="course-editor-breadcrumb">${esc(itemTitle)} / ${esc(group?.label || '')} / ${esc(node?.label || '')}</p><h3 id="content-editor-title">${esc(itemTitle)}</h3></div>${modeButtons}</header>${stable}<p class="course-editor-help">结构字段和版本由课程历史维护，已经锁定。当前层级可直接编辑；课程整体在页面顶部统一保存。</p>${this.#mode === 'visual' ? visual : raw}`;
  }

  #renderValue(value, path, options = {}) {
    const key = path.at(-1) ?? '';
    const label = labelFor(key || '内容');
    if (Array.isArray(value)) {
      const objects = value.some(item => isObject(item) || Array.isArray(item));
      if (!objects) return this.#leaf(value, path, label, 'list');
      if (!value.length) return `<div class="course-editor-empty-field"><strong>${esc(label)}</strong><p>当前列表为空。需要新增结构时请使用高级 JSON。</p></div>`;
      return `<fieldset class="course-editor-group"><legend>${esc(label)} <span>${value.length} 项</span></legend><div class="course-editor-object-list">${value.map((item, index) => `<details ${index === 0 && value.length <= 3 ? 'open' : ''}><summary>${esc(nodeTitle(item, `${label} ${index + 1}`))}</summary><div>${this.#renderValue(item, [...path, index], { root: true })}</div></details>`).join('')}</div></fieldset>`;
    }
    if (isObject(value)) {
      const entries = Object.entries(value).filter(([entryKey]) => !options.omit?.has(entryKey) && (!options.only || options.only.has(entryKey)));
      if (!entries.length) return '<p class="course-editor-empty-field">此处没有可编辑字段。</p>';
      const body = entries.map(([entryKey, entryValue]) => this.#renderValue(entryValue, [...path, entryKey])).join('');
      if (options.root) return body;
      return `<fieldset class="course-editor-group"><legend>${esc(label)}</legend>${body}</fieldset>`;
    }
    if (typeof value === 'boolean') return this.#leaf(value, path, label, 'boolean');
    if (typeof value === 'number') return this.#leaf(value, path, label, 'number');
    return this.#leaf(value, path, label, value === null ? 'nullable' : 'string');
  }

  #leaf(value, path, label, type) {
    const key = String(path.at(-1) ?? '');
    const id = `course-field-${++this.#fieldCounter}`;
    const fieldPath = esc(path.join('.'));
    const immutable = IMMUTABLE_KEYS.has(key);
    this.#fields.set(id, { path, type, immutable });
    if (type === 'boolean') return `<label class="course-editor-check" for="${id}"><input id="${id}" data-course-field="${id}" data-course-path="${fieldPath}" type="checkbox" ${value ? 'checked' : ''} ${immutable ? 'disabled' : ''}><span><strong>${esc(label)}</strong><small data-course-boolean-status>${value ? '已开启' : '已关闭'}${immutable ? ' · 课程规则锁定' : ''}</small></span></label>`;
    if (type === 'list') {
      const rows = Math.min(8, Math.max(3, value.length + 1));
      return `<label class="course-editor-field wide" for="${id}"><span>${esc(label)}<small>${immutable ? '课程结构锁定' : '每行一项'}</small></span><textarea id="${id}" data-course-field="${id}" data-course-path="${fieldPath}" rows="${rows}" ${immutable ? 'readonly' : ''}>${esc(value.join('\n'))}</textarea></label>`;
    }
    if (type === 'number') return `<label class="course-editor-field" for="${id}"><span>${esc(label)}${immutable ? '<small>自动维护</small>' : ''}</span><input id="${id}" data-course-field="${id}" data-course-path="${fieldPath}" type="number" step="1" value="${esc(value)}" ${immutable ? 'readonly' : ''}></label>`;
    const stringValue = value == null ? '' : String(value);
    const select = this.#referenceSelect(id, key, label, stringValue, immutable);
    if (select) return select;
    const multiline = LONG_KEYS.test(key) || CODE_KEYS.test(path.join('.')) || stringValue.includes('\n') || stringValue.length > 100;
    const help = immutable ? '<small>稳定结构，不能在可视化模式修改</small>' : value === null ? '<small>留空时保持未命名</small>' : '';
    if (multiline) return `<label class="course-editor-field wide ${CODE_KEYS.test(path.join('.')) ? 'code-field' : ''}" for="${id}"><span>${esc(label)}${help}</span><textarea id="${id}" data-course-field="${id}" data-course-path="${fieldPath}" rows="${Math.min(14, Math.max(4, stringValue.split('\n').length + 1))}" ${immutable ? 'readonly' : ''}>${esc(stringValue)}</textarea></label>`;
    return `<label class="course-editor-field" for="${id}"><span>${esc(label)}${help}</span><input id="${id}" data-course-field="${id}" data-course-path="${fieldPath}" value="${esc(stringValue)}" ${immutable ? 'readonly' : ''}></label>`;
  }

  #referenceSelect(id, key, label, value, immutable) {
    let options;
    if (key === 'runtimeId') options = (this.#course?.runtimeProfiles || []).map(item => ({ value: item.id, label: `${item.language} · ${item.standard}` }));
    if (key === 'locationId') options = (this.#course?.locations || []).map(item => ({ value: item.id, label: item.title || item.id }));
    if (!options?.length) return '';
    if (value && !options.some(option => option.value === value)) options.unshift({ value, label: `已不可用 · ${value}` });
    const fieldPath = esc(this.#fields.get(id)?.path.join('.') || '');
    return `<label class="course-editor-field" for="${id}"><span>${esc(label)}</span><select id="${id}" data-course-field="${id}" data-course-path="${fieldPath}" ${immutable ? 'disabled' : ''}>${options.map(option => `<option value="${esc(option.value)}" ${option.value === value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select></label>`;
  }

  #input(event) {
    if (event.target.id === 'content-json') {
      this.#rawDirty = true;
      this.#error('');
      this.dispatchEvent(new CustomEvent('course-editor-dirty', { bubbles: true }));
      return;
    }
    const descriptor = this.#fields.get(event.target.dataset.courseField);
    if (!descriptor || descriptor.immutable) return;
    if (['string', 'nullable'].includes(descriptor.type)) this.#update(descriptor, event.target.value);
    else if (descriptor.type === 'list') this.#update(descriptor, event.target.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean));
    else if (descriptor.type === 'number') {
      if (!event.target.value.trim()) this.dispatchEvent(new CustomEvent('course-editor-dirty', { bubbles: true }));
      else if (Number.isFinite(Number(event.target.value))) this.#update(descriptor, Number(event.target.value));
    }
  }

  #change(event) {
    if (event.target.id === 'course-editor-section') {
      if (!this.commit().ok) return;
      this.#groupId = event.target.value;
      this.#nodeId = '';
      this.#render();
      this.#focusAfterRender('#course-editor-focus-title');
      return;
    }
    const descriptor = this.#fields.get(event.target.dataset.courseField);
    if (!descriptor || descriptor.immutable) return;
    let value;
    if (descriptor.type === 'boolean') value = event.target.checked;
    else if (descriptor.type === 'number') {
      value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
    } else if (descriptor.type === 'list') value = event.target.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    else if (descriptor.type === 'nullable') value = event.target.value === '' ? null : event.target.value;
    else value = event.target.value;
    this.#update(descriptor, value);
    if (descriptor.type === 'boolean') {
      const status = event.target.closest('.course-editor-check')?.querySelector('[data-course-boolean-status]');
      if (status) status.textContent = value ? '已开启' : '已关闭';
    }
  }

  #click(event) {
    const mode = event.target.closest('[data-editor-mode]');
    if (mode) {
      const nextMode = mode.dataset.editorMode;
      if (nextMode === this.#mode) return;
      if (this.#mode === 'json' && !this.commit().ok) return;
      this.#mode = nextMode;
      this.#rawDirty = false;
      this.#render();
      this.#focusAfterRender(nextMode === 'json' ? '#content-json' : '#course-editor-focus-title');
      return;
    }
    const node = event.target.closest('[data-editor-node]');
    if (node) {
      if (!this.commit().ok) return;
      this.#nodeId = node.dataset.editorNode;
      this.#render();
      this.#focusAfterRender('#course-editor-focus-title');
      return;
    }
    const page = event.target.closest('[data-editor-page]');
    if (page) {
      const { group, node: current } = this.#selection();
      const currentIndex = group.nodes.indexOf(current);
      const nextIndex = page.dataset.editorPage === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (group.nodes[nextIndex]) { this.#nodeId = group.nodes[nextIndex].id; this.#render(); this.#focusAfterRender('#course-editor-focus-title'); }
      return;
    }
    if (event.target.closest('[data-apply-json]')) {
      const result = this.commit();
      if (result.ok) { this.#mode = 'visual'; this.#groupId = ''; this.#nodeId = ''; this.#render(); this.#focusAfterRender('#course-editor-focus-title'); }
    }
  }

  #focusAfterRender(selector) {
    queueMicrotask(() => {
      this.querySelector(selector)?.focus();
      this.querySelector('[data-editor-node][aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  #update(descriptor, value) {
    this.#content = writePath(this.#content, descriptor.path, value);
    if (this.#kind !== 'project' && this.#content.content) {
      const detail = this.#content.content;
      for (const field of ['id', 'rankId', 'sequence', 'title', 'version', 'estimatedMinutes', 'prerequisiteLevelIds']) detail[field] = clone(this.#content[field]);
      if (detail.activityType === 'interactive-lesson') detail.subrankId = this.#content.subrankId;
      detail.scene ||= {};
      detail.scene.locationId = this.#content.locationId;
      detail.scene.propIds = clone(this.#content.propIds || []);
      if (Array.isArray(detail.steps)) detail.teachingLoop = detail.steps.map(step => step.id);
    }
    const raw = this.querySelector('#content-json');
    if (raw) raw.value = JSON.stringify(this.#content, null, 2);
    this.#emitChange('visual');
  }

  #emitChange(source) {
    this.dispatchEvent(new CustomEvent('course-content-change', { bubbles: true, detail: { source, value: this.value } }));
  }

  #error(message) {
    const node = this.querySelector('#json-error');
    if (node) node.textContent = message;
  }
}

if (!customElements.get('eggy-course-editor')) customElements.define('eggy-course-editor', EggyCourseEditor);
