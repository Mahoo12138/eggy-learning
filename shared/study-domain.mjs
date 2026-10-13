// Shared by the HTTP server and browser. No environment-specific imports.
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const clone = v => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MAX_TEXT = 20000;
const RECORD_FIELDS = ['date', 'minutes', 'outcome', 'result', 'evidence', 'blocker', 'next', 'ai', 'aiCheck'];
const INPUT_FIELDS = ['requestId', 'taskId', 'assessmentVersion', ...RECORD_FIELDS, 'answers', 'correctionOf', 'scheduleItemId'];
const STORED_FIELDS = [...INPUT_FIELDS, 'id', 'savedAt', 'payloadHash', 'taskSnapshot', 'criteriaSnapshot'];
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function object(v, name) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail(`${name}须为普通对象`);
  return v;
}
function fields(v, expected, name) {
  object(v, name);
  if (Object.keys(v).length !== expected.length || expected.some(k => !own(v, k))) fail(`${name}字段缺失或包含未知字段`);
}
function text(v, name, required = false, max = MAX_TEXT) {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(`${name}须为${required ? '非空' : ''}文本，最多 ${max} 字符`);
  return v;
}
function id(v, name = '编号') {
  if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(v)) fail(`${name}须为字母、数字、下划线或短横线组成的稳定编号`);
  return v;
}
function optionalId(v, name) { return v === '' ? '' : id(v, name); }
function integer(v, name, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(v) || v < min || v > max) fail(`${name}须为 ${min}–${max} 的整数`);
  return v;
}
function bool(v, name) { if (typeof v !== 'boolean') fail(`${name}须为布尔值`); return v; }
function list(v, name, max = 10000) { if (!Array.isArray(v) || v.length > max) fail(`${name}须为列表且不超过 ${max} 项`); return v; }
function texts(v, name) { return list(v, name, 500).map(x => text(x, name, true)); }
function date(v, name, empty = false) {
  if (empty && v === '') return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(`${name}须为 YYYY-MM-DD 日期`);
  const d = new Date(`${v}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail(`${name}不是有效日期`);
  return v;
}
function timestamp(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) fail('保存时间须为带时区的有效 ISO 时间');
  date(v.slice(0, 10), '保存日期');
  return new Date(v).toISOString();
}
function unique(map, key, value, name) { if (map.has(key)) fail(`${name}重复：${key}`); map.set(key, value); }
function indices(c) {
  const units = new Map(), tasks = new Map(), questions = new Map(), criteria = new Map();
  for (const unit of c.units) {
    units.set(unit.id, unit);
    for (const criterion of unit.criteria) criteria.set(criterion.id, { unit, criterion });
    for (const task of unit.tasks) {
      tasks.set(task.id, { unit, task });
      for (const question of task.questions) questions.set(question.id, { unit, task, question });
    }
  }
  return { units, tasks, questions, criteria };
}
function question(v) {
  fields(v, ['id', 'kind', 'prompt', 'hints', 'referencePoints', 'version', 'archived', 'criterionId'], '题目');
  if (!['task-prompt', 'reflection'].includes(v.kind)) fail('题目类型无效');
  return { id: id(v.id), kind: v.kind, prompt: text(v.prompt, '题干', true), hints: texts(v.hints, '提示'), referencePoints: texts(v.referencePoints, '参考要点'), version: integer(v.version, '题目版本'), archived: bool(v.archived, '题目归档'), criterionId: optionalId(v.criterionId, '关联标准编号') };
}
function questionContent(q) { return { kind: q.kind, prompt: q.prompt, hints: q.hints, referencePoints: q.referencePoints, archived: q.archived, criterionId: q.criterionId }; }
function linkedContent(q) { return { id: q.id, prompt: q.prompt, referencePoints: q.referencePoints, criterionId: q.criterionId }; }
function assessmentContent(u) {
  return {
    tasks: u.tasks.filter(t => !t.archived).map(t => ({ id: t.id, steps: t.steps, output: t.output, verify: t.verify })).sort((a, b) => a.id.localeCompare(b.id)),
    criteria: [...u.criteria].sort((a, b) => a.id.localeCompare(b.id)),
    acceptanceTaskId: u.acceptanceTaskId,
    questions: u.tasks.filter(t => !t.archived).flatMap(t => t.questions.filter(q => !q.archived && q.criterionId).map(q => ({ taskId: t.id, ...linkedContent(q) }))).sort((a, b) => a.id.localeCompare(b.id))
  };
}
function referenced(docs, schedule) {
  const refs = { units: new Set(), tasks: new Set(), questions: new Set(), criteria: new Set() };
  function walk(v) {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    for (const [key, item] of Object.entries(v)) {
      const bucket = { unitId: 'units', taskId: 'tasks', questionId: 'questions', criterionId: 'criteria' }[key];
      if (bucket && typeof item === 'string' && item) refs[bucket].add(item);
      walk(item);
    }
  }
  for (const doc of docs) {
    const meaningful = doc.records?.length || Object.keys(doc.drafts || {}).length || doc.reflection || doc.nextAction || Object.values(doc.assessment?.checks || {}).some(Boolean);
    if (meaningful) refs.units.add(doc.unitId);
    for (const [taskId, draft] of Object.entries(doc.drafts || {})) { refs.tasks.add(taskId); walk(draft); }
    walk(doc.records || []);
    for (const record of doc.records || []) for (const criterion of record.criteriaSnapshot || []) refs.criteria.add(criterion.id);
    if (meaningful) for (const criterionId of Object.keys(doc.assessment?.checks || {})) refs.criteria.add(criterionId);
  }
  walk(schedule);
  return refs;
}

export function validateCurriculum(value, previous = null, unitDocs = [], schedule = null) {
  fields(value, ['schemaVersion', 'title', 'schedule', 'stages', 'projects', 'units'], '课程');
  if (value.schemaVersion !== 1) fail('不支持的课程版本');
  const stages = new Map(), unitIds = new Map(), taskIds = new Map(), questionIds = new Map(), criterionIds = new Map();
  const c = { schemaVersion: 1, title: text(value.title, '课程标题', true), schedule: text(value.schedule, '安排说明'), stages: [], projects: [], units: [] };
  c.stages = list(value.stages, '阶段', 200).map(s => {
    fields(s, ['id', 'title', 'description', 'archived'], '阶段');
    const n = { id: id(s.id), title: text(s.title, '阶段标题', true), description: text(s.description, '阶段说明'), archived: bool(s.archived, '阶段归档') };
    unique(stages, n.id, n, '阶段'); return n;
  });
  const projectIds = new Map();
  c.projects = list(value.projects, '项目', 200).map(p => {
    fields(p, ['id', 'title', 'period', 'pitch', 'source', 'skills', 'mvp', 'stretch', 'deliverables'].filter(k => k !== 'source' || own(p, 'source')), '项目');
    const n = { id: id(p.id), title: text(p.title, '项目标题', true), period: text(p.period, '项目周期'), pitch: text(p.pitch, '项目说明') };
    if (own(p, 'source')) n.source = text(p.source, '项目来源');
    for (const key of ['skills', 'mvp', 'stretch', 'deliverables']) n[key] = texts(p[key], '项目内容');
    unique(projectIds, n.id, n, '项目'); return n;
  });
  c.units = list(value.units, '单元', 2000).map(u => {
    fields(u, ['id', 'stageId', 'title', 'goal', 'prerequisite', 'concepts', 'deliverable', 'traps', 'tasks', 'criteria', 'acceptanceTaskId', 'assessmentVersion', 'archived'], '单元');
    const n = { id: id(u.id), stageId: id(u.stageId), title: text(u.title, '单元标题', true), goal: text(u.goal, '单元目标'), prerequisite: text(u.prerequisite, '前提'), concepts: texts(u.concepts, '概念'), deliverable: text(u.deliverable, '交付'), traps: texts(u.traps, '常见错误'), tasks: [], criteria: [], acceptanceTaskId: id(u.acceptanceTaskId), assessmentVersion: integer(u.assessmentVersion, '验收版本'), archived: bool(u.archived, '单元归档') };
    unique(unitIds, n.id, n, '单元');
    if (!stages.has(n.stageId)) fail(`单元引用未知阶段：${n.stageId}`);
    if (!n.archived && stages.get(n.stageId).archived) fail('归档阶段前请先归档或移出其中的有效单元');
    n.criteria = list(u.criteria, '验收标准', 200).map(v => {
      fields(v, ['id', 'text'], '验收标准');
      const k = { id: id(v.id), text: text(v.text, '验收标准', true) }; unique(criterionIds, k.id, n.id, '验收标准'); return k;
    });
    if (!n.criteria.length) fail('单元至少保留一条验收标准');
    n.tasks = list(u.tasks, '任务', 500).map(t => {
      fields(t, ['id', 'title', 'steps', 'output', 'verify', 'estimatedMinutes', 'questions', 'archived'], '任务');
      const k = { id: id(t.id), title: text(t.title, '任务标题', true), steps: texts(t.steps, '任务步骤'), output: text(t.output, '任务产物'), verify: text(t.verify, '验证方法'), estimatedMinutes: integer(t.estimatedMinutes, '预计用时', 1, 10080), questions: list(t.questions, '题目', 200).map(question), archived: bool(t.archived, '任务归档') };
      unique(taskIds, k.id, n.id, '任务');
      for (const q of k.questions) {
        unique(questionIds, q.id, k.id, '题目');
        if (q.criterionId && !n.criteria.some(x => x.id === q.criterionId)) fail('题目须关联本单元存在的验收标准');
      }
      return k;
    });
    if (!n.tasks.some(t => t.id === n.acceptanceTaskId && !t.archived)) fail('独立验收任务须为本单元未归档任务');
    return n;
  });
  if (previous) {
    const before = indices(previous), after = indices(c), refs = referenced(unitDocs, schedule);
    for (const type of ['units', 'tasks', 'questions']) {
      for (const ref of refs[type]) if (before[type].has(ref) && !after[type].has(ref)) fail(`已有历史引用的${type}不能删除：${ref}，请归档或保留原标准`, 409);
    }
    for (const u of c.units) {
      const old = before.units.get(u.id);
      u.assessmentVersion = old ? old.assessmentVersion + (same(assessmentContent(old), assessmentContent(u)) ? 0 : 1) : 1;
      for (const t of u.tasks) {
        const oldTask = before.tasks.get(t.id);
        if (oldTask && oldTask.unit.id !== u.id && (refs.tasks.has(t.id) || t.questions.some(q => refs.questions.has(q.id)))) fail('已有引用的任务不能跨单元搬移', 409);
        for (const q of t.questions) {
          const oldQ = before.questions.get(q.id);
          if (oldQ && oldQ.task.id !== t.id && refs.questions.has(q.id)) fail('已有作答或草稿的题目不能跨任务搬移', 409);
          q.version = oldQ ? oldQ.question.version + (same(questionContent(oldQ.question), questionContent(q)) ? 0 : 1) : 1;
        }
      }
      for (const k of u.criteria) if (before.criteria.has(k.id) && before.criteria.get(k.id).unit.id !== u.id && refs.criteria.has(k.id)) fail('已有引用的验收标准不能跨单元搬移', 409);
    }
  }
  return c;
}

export function freshUnit(unit) {
  return { schemaVersion: 1, unitId: unit.id, assessment: { version: unit.assessmentVersion, checks: Object.fromEntries(unit.criteria.map(c => [c.id, false])) }, reflection: '', nextAction: '', drafts: {}, records: [] };
}
function recordFields(v, draft = false) {
  const n = { date: date(v.date, '学习日期', draft), minutes: v.minutes, outcome: v.outcome, result: text(v.result, '实际结果', !draft), evidence: text(v.evidence, '证据'), blocker: text(v.blocker, '卡点'), next: text(v.next, '下一步'), ai: v.ai, aiCheck: text(v.aiCheck, 'AI 独立检查') };
  if (!(draft && v.minutes === '')) integer(v.minutes, '实际分钟数', draft ? 0 : 1, 1440);
  if (!['practice', 'blocked', 'passed'].includes(v.outcome) || !['none', 'hint', 'review', 'code'].includes(v.ai)) fail('训练结果或 AI 使用方式无效');
  if (!draft && v.outcome === 'passed' && (!v.evidence.trim() || (v.ai === 'code' && !v.aiCheck.trim()))) fail('通过记录需要证据；AI 生成代码还需独立检查结果');
  if (!draft && v.outcome === 'blocked' && (!v.blocker.trim() || !v.next.trim())) fail('卡点记录需要具体问题与下一步');
  return n;
}
function answer(v, task, historical = false, draft = false) {
  fields(v, historical ? ['questionId', 'questionVersion', 'text', 'evidence', 'snapshot'] : ['questionId', 'questionVersion', 'text', 'evidence'], '作答');
  const n = { questionId: id(v.questionId), questionVersion: integer(v.questionVersion, '作答题目版本'), text: text(v.text, '回答', !draft), evidence: text(v.evidence, '回答证据') };
  const q = task.questions.find(q => q.id === n.questionId);
  if (!q) fail('回答引用未知题目');
  if (historical) {
    n.snapshot = question(v.snapshot);
    if (n.snapshot.id !== n.questionId || n.snapshot.version !== n.questionVersion || n.questionVersion > q.version) fail('作答快照与题目版本不一致');
  } else if (!draft) {
    if (q.archived) fail('题目已归档，不能提交新答案', 409);
    if (n.questionVersion !== q.version) fail('题目已更新，请比较旧草稿后重新作答', 409);
    n.snapshot = clone(q);
  } else if (n.questionVersion > q.version) fail('草稿题目版本超出当前版本');
  return n;
}
function answers(v, task, historical, draft) {
  const seen = new Set();
  return list(v, '作答', 200).map(x => {
    const a = answer(x, task, historical, draft);
    if (seen.has(a.questionId)) fail('同一次记录中题目不能重复作答'); seen.add(a.questionId); return a;
  });
}
function draftValue(v, task, unit) {
  const optional = ['correctionOf', 'scheduleItemId'].filter(k => own(v, k));
  fields(v, ['assessmentVersion', ...RECORD_FIELDS, 'answers', ...optional], '草稿');
  const n = { assessmentVersion: integer(v.assessmentVersion, '草稿验收版本'), ...recordFields(v, true), answers: answers(v.answers, task, false, true) };
  if (n.assessmentVersion > unit.assessmentVersion) fail('草稿验收版本超出当前版本');
  for (const k of optional) n[k] = optionalId(v[k], k);
  return n;
}
function assessment(v, unit, current = false) {
  fields(v, ['version', 'checks'], '验收勾选');
  const version = integer(v.version, '勾选版本');
  if (version > unit.assessmentVersion || (current && version !== unit.assessmentVersion)) fail('验收标准已更新，请重新检查', 409);
  object(v.checks, '验收清单');
  const checks = Object.fromEntries(Object.entries(v.checks).map(([key, value]) => [id(key), bool(value, '标准勾选')]));
  if (version === unit.assessmentVersion && (Object.keys(checks).length !== unit.criteria.length || unit.criteria.some(c => !own(checks, c.id)))) fail('当前版本验收清单必须与全部标准匹配');
  return { version, checks };
}
function taskSnapshot(v, taskId) {
  fields(v, ['id', 'title', 'steps', 'output', 'verify'], '任务快照');
  if (v.id !== taskId) fail('任务快照编号不一致');
  return { id: id(v.id), title: text(v.title, '任务快照标题', true), steps: texts(v.steps, '任务快照步骤'), output: text(v.output, '任务快照产物'), verify: text(v.verify, '任务快照验证') };
}
export function validateUnit(doc, curriculum) {
  fields(doc, ['schemaVersion', 'unitId', 'assessment', 'reflection', 'nextAction', 'drafts', 'records'], '学习档案');
  if (doc.schemaVersion !== 1) fail('不支持的学习档案版本');
  const unit = curriculum.units.find(u => u.id === doc.unitId);
  if (!unit) fail('档案引用未知单元');
  const n = { schemaVersion: 1, unitId: unit.id, assessment: assessment(doc.assessment, unit), reflection: text(doc.reflection, '单元复盘'), nextAction: text(doc.nextAction, '下一步'), drafts: {}, records: [] };
  object(doc.drafts, '任务草稿');
  for (const [taskId, value] of Object.entries(doc.drafts)) {
    const task = unit.tasks.find(t => t.id === taskId); if (!task) fail('草稿引用未知任务');
    n.drafts[taskId] = draftValue(value, task, unit);
  }
  const ids = new Map(), requests = new Set(), replaced = new Set();
  n.records = list(doc.records, '训练记录', 100000).map(r => {
    fields(r, STORED_FIELDS, '训练记录');
    const task = unit.tasks.find(t => t.id === r.taskId); if (!task) fail('训练记录引用未知任务');
    const out = { requestId: id(r.requestId), taskId: id(r.taskId), assessmentVersion: integer(r.assessmentVersion, '记录验收版本'), ...recordFields(r), answers: answers(r.answers, task, true, false), correctionOf: optionalId(r.correctionOf, '更正目标'), scheduleItemId: optionalId(r.scheduleItemId, '日程条目'), id: id(r.id), savedAt: timestamp(r.savedAt), payloadHash: text(r.payloadHash, '请求指纹', true, 256), taskSnapshot: taskSnapshot(r.taskSnapshot, r.taskId), criteriaSnapshot: list(r.criteriaSnapshot, '标准快照', 200).map(k => { fields(k, ['id', 'text'], '标准快照'); return { id: id(k.id), text: text(k.text, '标准快照', true) }; }) };
    if (out.assessmentVersion > unit.assessmentVersion) fail('记录验收版本超出当前版本');
    if (ids.has(out.id) || requests.has(out.requestId)) fail('重复记录或请求编号');
    if (out.correctionOf) {
      const old = ids.get(out.correctionOf);
      if (!old || old.taskId !== out.taskId || replaced.has(out.correctionOf)) fail('更正须引用同一任务尚未被更正的先前记录');
      replaced.add(out.correctionOf);
    }
    ids.set(out.id, out); requests.add(out.requestId); return out;
  });
  return n;
}

export function patchUnit(doc, patch, curriculum) {
  const n = validateUnit(doc, curriculum), unit = curriculum.units.find(u => u.id === n.unitId);
  object(patch, '档案修改');
  if (Object.keys(patch).some(k => !['assessment', 'reflection', 'nextAction', 'drafts'].includes(k))) fail('档案修改包含未知字段');
  if (unit.archived) fail('归档单元不能继续修改', 409);
  if (own(patch, 'assessment')) n.assessment = assessment(patch.assessment, unit, true);
  for (const key of ['reflection', 'nextAction']) if (own(patch, key)) n[key] = text(patch[key], key);
  if (own(patch, 'drafts')) {
    object(patch.drafts, '草稿修改');
    for (const [taskId, value] of Object.entries(patch.drafts)) {
      const task = unit.tasks.find(t => t.id === taskId);
      if (!task) fail('草稿引用未知任务');
      if (value === null) { delete n.drafts[taskId]; continue; }
      if (task.archived) fail('归档任务不能继续保存草稿', 409);
      // Keep the old version explicit: saving text is allowed, silently promoting it is not.
      n.drafts[taskId] = draftValue(value, task, unit);
    }
  }
  return n;
}

export function appendRecord(doc, input, curriculum, meta) {
  const n = validateUnit(doc, curriculum), unit = curriculum.units.find(u => u.id === n.unitId);
  fields(input, INPUT_FIELDS, '记录输入'); fields(meta, ['id', 'savedAt', 'payloadHash'], '记录元信息');
  id(input.requestId); text(meta.payloadHash, '请求指纹', true, 256);
  const retry = n.records.find(r => r.requestId === input.requestId);
  if (retry) { if (retry.payloadHash !== meta.payloadHash) fail('相同请求编号不能用于不同内容', 409); return n; }
  const correctionOf = optionalId(input.correctionOf, '更正目标');
  const original = correctionOf ? n.records.find(r => r.id === correctionOf) : null;
  const task = unit.tasks.find(t => t.id === input.taskId);
  if (!task) fail('任务不存在', 409);
  if (correctionOf && (!original || original.taskId !== task.id || n.records.some(r => r.correctionOf === original.id))) fail('更正须指向同一任务当前有效的记录，不能分叉', 409);
  if (!original && (unit.archived || task.archived)) fail('单元或任务已归档，不能新增训练', 409);
  const expectedVersion = original ? original.assessmentVersion : unit.assessmentVersion;
  if (input.assessmentVersion !== expectedVersion) fail(original ? '更正须保留原验收版本；新版复测请新增训练记录' : '课程验收要求已更新，请先检查差异', 409);
  const details = recordFields(input);
  const savedAnswers = original ? list(input.answers, '更正作答', 200).map(v => {
    fields(v, ['questionId', 'questionVersion', 'text', 'evidence'], '更正作答');
    const old = original.answers.find(a => a.questionId === v.questionId);
    if (!old || v.questionVersion !== old.questionVersion) fail('更正作答须保留原题目版本；新题请另做一次训练', 409);
    return { questionId: old.questionId, questionVersion: old.questionVersion, text: text(v.text, '回答', true), evidence: text(v.evidence, '回答证据'), snapshot: clone(old.snapshot) };
  }) : answers(input.answers, task, false, false);
  const record = { requestId: input.requestId, taskId: task.id, assessmentVersion: expectedVersion, ...details, answers: savedAnswers, correctionOf, scheduleItemId: optionalId(input.scheduleItemId, '日程条目'), id: id(meta.id), savedAt: timestamp(meta.savedAt), payloadHash: meta.payloadHash, taskSnapshot: original ? clone(original.taskSnapshot) : { id: task.id, title: task.title, steps: clone(task.steps), output: task.output, verify: task.verify }, criteriaSnapshot: clone(original ? original.criteriaSnapshot : unit.criteria) };
  if (n.records.some(r => r.id === record.id)) fail('记录编号已存在', 409);
  n.records.push(record);
  if (!original) delete n.drafts[task.id];
  return validateUnit(n, curriculum);
}

// Replacements occupy the original attempt's position, so correcting an early
// blocked attempt cannot move it after a subsequent successful retest.
export function effectiveRecords(doc) {
  const replacement = new Map(doc.records.filter(r => r.correctionOf).map(r => [r.correctionOf, r]));
  return doc.records.filter(r => !r.correctionOf).map(r => {
    const visited = new Set();
    while (replacement.has(r.id)) { if (visited.has(r.id)) fail('更正记录存在循环'); visited.add(r.id); r = replacement.get(r.id); }
    return r;
  });
}
function openBlockers(doc, unit) {
  const active = new Set(unit.tasks.filter(t => !t.archived).map(t => t.id)), blocked = new Set();
  for (const r of effectiveRecords(doc)) if (active.has(r.taskId)) {
    if (r.outcome === 'blocked') blocked.add(r.taskId);
    if (r.outcome === 'passed') blocked.delete(r.taskId);
  }
  return [...blocked];
}
export function unitStatus(doc, unit) {
  if (openBlockers(doc, unit).length) return 'blocked';
  const records = effectiveRecords(doc), active = new Set(unit.tasks.filter(t => !t.archived).map(t => t.id));
  const relevant = records.filter(r => active.has(r.taskId));
  const current = relevant.filter(r => r.assessmentVersion === unit.assessmentVersion);
  const final = current.filter(r => r.taskId === unit.acceptanceTaskId).at(-1);
  const checks = doc.assessment.version === unit.assessmentVersion && unit.criteria.every(k => doc.assessment.checks[k.id] === true);
  const linked = unit.tasks.filter(t => !t.archived).flatMap(t => t.questions.filter(q => !q.archived && q.criterionId).map(q => ({ taskId: t.id, question: q })));
  const answerEvidence = linked.every(({ taskId, question }) => {
    const attempts = current.filter(r => r.taskId === taskId).flatMap(r => r.answers.filter(a => a.questionId === question.id));
    const a = attempts.at(-1);
    return a && a.text.trim() && a.evidence.trim() && same(linkedContent(a.snapshot), linkedContent(question));
  });
  if (final?.outcome === 'passed' && checks && answerEvidence) return 'accepted';
  if (final?.outcome === 'passed' || relevant.some(r => r.assessmentVersion < unit.assessmentVersion) || (doc.assessment.version < unit.assessmentVersion && Object.values(doc.assessment.checks).some(Boolean))) return 'review';
  if (relevant.length || Object.keys(doc.drafts).length || Object.values(doc.assessment.checks).some(Boolean) || doc.reflection.trim() || doc.nextAction.trim()) return 'active';
  return 'not-started';
}
export function summarize(curriculum, docs = []) {
  const byId = new Map(docs.map(d => [d.unitId, d]));
  const result = { total: 0, accepted: 0, review: 0, blocked: 0, active: 0, notStarted: 0, minutes: 0, records: 0, stages: [], units: [] };
  for (const doc of docs) {
    const records = effectiveRecords(doc);
    result.minutes += records.reduce((sum, r) => sum + r.minutes, 0);
    result.records += records.length;
  }
  const stages = new Map(curriculum.stages.filter(s => !s.archived).map(s => [s.id, { id: s.id, title: s.title, total: 0, accepted: 0, review: 0, blocked: 0, active: 0, notStarted: 0 }]));
  for (const unit of curriculum.units.filter(u => !u.archived && stages.has(u.stageId))) {
    const doc = byId.get(unit.id) || freshUnit(unit), records = effectiveRecords(doc), status = unitStatus(doc, unit), key = status === 'not-started' ? 'notStarted' : status;
    const minutes = records.reduce((sum, r) => sum + r.minutes, 0);
    result.total++; result[key]++;
    const stage = stages.get(unit.stageId); if (stage) { stage.total++; stage[key]++; }
    result.units.push({ id: unit.id, status, minutes, records: records.length, openBlockers: openBlockers(doc, unit) });
  }
  result.stages = [...stages.values()]; return result;
}
