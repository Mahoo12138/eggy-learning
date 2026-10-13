import { effectiveRecords, unitStatus, freshUnit } from './study-domain.mjs';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const copy = value => structuredClone(value);
const idOK = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
const text = (value, name, max = 20000) => { if (typeof value !== 'string' || value.length > max) fail(`${name}须为文本且不超过 ${max} 字符`); return value; };
const integer = (value, min, max, name) => { if (!Number.isInteger(value) || value < min || value > max) fail(`${name}须为 ${min}–${max} 的整数`); return value; };
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('日期须为 YYYY-MM-DD');
  const time = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+time) || time.toISOString().slice(0, 10) !== value) fail('日历日期无效');
  return time;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail('安排时间须为有效 UTC ISO 时间');
  date(value.slice(0, 10));
}
export function weekStartFor(value) {
  const d = date(value);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function shanghaiToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export const freshSchedule = () => ({ schemaVersion: 1, revision: 0, timezone: 'Asia/Shanghai', weeks: [], receipts: [] });
function maps(curriculum) {
  const units = new Map(curriculum.units.map(u => [u.id, u]));
  const tasks = new Map(curriculum.units.flatMap(u => u.tasks.map(t => [t.id, { unit: u, task: t }])));
  return { units, tasks };
}
function checkItem(item, taskMap, historical = false) {
  if (!item || !idOK(item.id) || !idOK(item.taskId)) fail('安排片段编号无效');
  const entry = taskMap.get(item.taskId);
  if (!entry || (item.unitId && entry.unit.id !== item.unitId)) fail('安排引用了不存在的任务或单元');
  if (!historical && (entry.unit.archived || entry.task.archived)) fail('不能安排已归档任务');
  text(item.goal, '本次目标');
  if (!item.goal.trim()) fail('请为安排填写具体下一步目标');
  integer(item.estimatedMinutes, 1, 10080, '预计分钟');
  const kind = item.kind === undefined ? 'work' : item.kind;
  if (!['work', 'recovery-check'].includes(kind)) fail('片段类型须为正式工作或恢复自测');
  if (item.continuedFromItemId && !idOK(item.continuedFromItemId)) fail('接续片段编号无效');
  return { id: item.id, unitId: entry.unit.id, taskId: item.taskId, kind, goal: item.goal, estimatedMinutes: item.estimatedMinutes, continuedFromItemId: item.continuedFromItemId || '' };
}
function checkSlots(slots, weekStart, taskMap, historical = false) {
  if (!Array.isArray(slots) || slots.length > 28) fail('每周时段须为列表，最多 28 项');
  const ids = new Set();
  const itemIds = new Set();
  const result = slots.map(slot => {
    if (!slot || !idOK(slot.id) || ids.has(slot.id)) fail('时段编号无效或重复');
    ids.add(slot.id);
    if (weekStartFor(slot.date) !== weekStart) fail('所有时段必须位于所选自然周内');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start)) fail('开始时间须为 HH:mm');
    integer(slot.minutes, 1, 720, '时段分钟');
    integer(slot.bufferMinutes, 0, slot.minutes, '缓冲分钟');
    const start = Number(slot.start.slice(0, 2)) * 60 + Number(slot.start.slice(3));
    if (start + slot.minutes > 1440) fail('学习时段不能跨过午夜，请拆成两天安排');
    if (!Array.isArray(slot.items)) fail('时段必须有 items 列表');
    const items = slot.items.map(x => {
      const item = checkItem(x, taskMap, historical);
      if (itemIds.has(item.id)) fail('同一片段不能同时安排在两个时段');
      itemIds.add(item.id);
      return item;
    });
    if (items.reduce((n, x) => n + x.estimatedMinutes, 0) + slot.bufferMinutes > slot.minutes) fail('任务和缓冲超过了时段容量');
    return { id: slot.id, date: slot.date, start: slot.start, minutes: slot.minutes, bufferMinutes: slot.bufferMinutes, items };
  }).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  for (let i = 1; i < result.length; i++) {
    const a = result[i - 1], b = result[i];
    const time = x => Number(x.start.slice(0, 2)) * 60 + Number(x.start.slice(3));
    if (a.date === b.date && time(a) + a.minutes > time(b)) fail('同一天的学习时段不能重叠');
  }
  return result;
}
function historicalItems(schedule) {
  return new Map(schedule.weeks.flatMap(w => w.revisions.flatMap(r => [...r.slots.flatMap(s => s.items), ...r.unassigned])).map(i => [i.id, i]));
}
function reviewInput(review, schedule, docs) {
  if (review == null) return null;
  const week = schedule.weeks.find(w => w.weekStart === review.weekStart);
  const revision = week?.revisions.find(r => r.id === review.revisionId);
  if (!revision) fail('核对必须引用已有周安排的版本');
  if (week.revisions.at(-1).id !== revision.id) throw Object.assign(new Error('本周安排已更新，请按最新安排重新核对。'), { status: 409 });
  const items = new Map([...revision.slots.flatMap(s => s.items), ...revision.unassigned].map(i => [i.id, i]));
  const records = new Map(docs.flatMap(d => effectiveRecords(d)).map(r => [r.id, r]));
  if (!Array.isArray(review.items) || review.items.length > items.size) fail('周核对条目无效');
  const seen = new Set();
  const normalized = review.items.map(row => {
    const item = items.get(row.itemId);
    if (!item || seen.has(row.itemId)) fail('核对引用了未知或重复片段');
    seen.add(row.itemId);
    if (!['done', 'partial', 'not-started', 'unknown'].includes(row.outcome)) fail('核对结果无效');
    if (!Array.isArray(row.recordIds) || row.recordIds.some(id => records.get(id)?.taskId !== item.taskId)) fail('核对证据须来自同一任务的有效记录');
    if (row.outcome === 'done' && !row.recordIds.length) fail('标记安排已做时请关联训练记录；没有记录可先保留“待核对”');
    return { itemId: row.itemId, outcome: row.outcome, next: text(row.next || '', '下一步'), recordIds: [...new Set(row.recordIds)] };
  });
  return { weekStart: week.weekStart, revisionId: revision.id, note: text(review.note || '', '核对说明'), items: normalized };
}
export function validateSchedule(value, curriculum, docs) {
  if (!value || value.schemaVersion !== 1 || value.timezone !== 'Asia/Shanghai' || !Array.isArray(value.weeks) || !Array.isArray(value.receipts)) fail('周安排文件格式无效');
  integer(value.revision, 0, Number.MAX_SAFE_INTEGER, '周安排版本');
  const { tasks } = maps(curriculum);
  const seen = new Set(), revisions = new Set(), receipts = new Set(), latestItems = new Set(), reviewIds = new Set();
  const allItems = new Map();
  const records = docs ? new Map(docs.flatMap(d => d.records).map(r => [r.id, r])) : null;
  for (const receipt of value.receipts) {
    if (!receipt || !idOK(receipt.requestId) || receipts.has(receipt.requestId) || !/^[a-f0-9]{64}$/.test(receipt.payloadHash)) fail('安排回执格式无效或重复');
    receipts.add(receipt.requestId); timestamp(receipt.savedAt);
  }
  for (const week of value.weeks) {
    if (!week || typeof week !== 'object') fail('自然周格式无效');
    if (weekStartFor(week.weekStart) !== week.weekStart || seen.has(week.weekStart)) fail('自然周须为不重复的周一日期');
    seen.add(week.weekStart);
    if (!Array.isArray(week.revisions) || !week.revisions.length || !Array.isArray(week.reviews)) fail('自然周缺少安排版本或核对列表');
    for (const rev of week.revisions) {
      if (!rev || !idOK(rev.id) || !idOK(rev.requestId) || revisions.has(rev.id)) fail('周安排修订编号无效或重复');
      revisions.add(rev.id);
      timestamp(rev.createdAt); text(rev.reason, '调整原因');
      const slots = checkSlots(rev.slots, week.weekStart, tasks, true);
      if (!Array.isArray(rev.unassigned)) fail('待排事项须为列表');
      const ids = new Set(slots.flatMap(s => s.items.map(i => i.id)));
      for (const item of rev.unassigned) {
        checkItem(item, tasks, true);
        if (ids.has(item.id)) fail('片段不能同时已安排和待安排');
        ids.add(item.id);
      }
      for (const item of [...slots.flatMap(s => s.items), ...rev.unassigned]) {
        if (allItems.has(item.id) && (allItems.get(item.id).taskId !== item.taskId || allItems.get(item.id).continuedFromItemId !== item.continuedFromItemId || (allItems.get(item.id).kind || 'work') !== (item.kind || 'work'))) fail('历史片段编号不能被其他任务、类型或接续来源复用');
        allItems.set(item.id, item);
      }
      if (rev.resumeDate) date(rev.resumeDate);
    }
    for (const review of week.reviews) {
      if (!review || !idOK(review.id) || reviewIds.has(review.id)) fail('周核对编号无效或重复');
      reviewIds.add(review.id); timestamp(review.createdAt); text(review.note, '核对说明');
      const rev = week.revisions.find(r => r.id === review.revisionId);
      if (!rev || !Array.isArray(review.items)) fail('周核对引用缺失的安排');
      const items = new Map([...rev.slots.flatMap(s => s.items), ...rev.unassigned].map(i => [i.id, i]));
      const ids = new Set();
      for (const row of review.items) {
        if (!row || !items.has(row.itemId) || ids.has(row.itemId) || !['done', 'partial', 'not-started', 'unknown'].includes(row.outcome)) fail('周核对条目无效');
        ids.add(row.itemId); text(row.next, '核对下一步');
        if (!Array.isArray(row.recordIds) || row.recordIds.some(id => !idOK(id)) || new Set(row.recordIds).size !== row.recordIds.length) fail('周核对证据编号无效');
        if (row.outcome === 'done' && !row.recordIds.length) fail('已做的周核对须有关联训练证据');
        if (records && row.recordIds.some(id => records.get(id)?.taskId !== items.get(row.itemId).taskId)) fail('周核对的训练证据不存在或不属于该任务');
      }
    }
    for (const item of [...week.revisions.at(-1).slots.flatMap(s => s.items), ...week.revisions.at(-1).unassigned]) {
      if (latestItems.has(item.id)) fail('同一片段不能同时存在于多个自然周的当前安排中');
      latestItems.add(item.id);
    }
  }
  for (const item of allItems.values()) {
    let current = item;
    const ancestry = new Set([item.id]);
    while (current.continuedFromItemId) {
      const source = allItems.get(current.continuedFromItemId);
      if (!source || source.taskId !== current.taskId || ancestry.has(source.id)) fail('接续来源不存在、任务不符或形成循环');
      ancestry.add(source.id); current = source;
    }
  }
  return copy(value);
}

export function previewSchedule(input, curriculum, docs, schedule, { today = shanghaiToday() } = {}) {
  if (!input || !idOK(input.requestId)) fail('本次安排需要稳定的提交编号');
  if (weekStartFor(input.weekStart) !== input.weekStart) fail('自然周须选择周一');
  const { tasks } = maps(curriculum);
  const byUnit = new Map(curriculum.units.map(u => [u.id, docs.find(d => d.unitId === u.id) || freshUnit(u)]));
  const units = curriculum.units.filter(u => !u.archived && !curriculum.stages.find(s => s.id === u.stageId)?.archived);
  const active = units.find(u => unitStatus(byUnit.get(u.id), u) !== 'accepted');
  let items = input.items;
  if (items === undefined) {
    items = (active?.tasks || []).filter(t => !t.archived).filter(t => {
      const logs = effectiveRecords(byUnit.get(active.id)).filter(r => r.taskId === t.id);
      return logs.at(-1)?.outcome !== 'passed' || logs.at(-1)?.assessmentVersion !== active.assessmentVersion;
    }).map((t, i) => ({ id: input.requestId + '-item-' + i, taskId: t.id, goal: t.output || t.title, estimatedMinutes: t.estimatedMinutes || 150, continuedFromItemId: '' }));
  }
  if (!Array.isArray(items) || items.length > 100) fail('待安排任务须为列表，最多 100 项');
  const originalItems = historicalItems(schedule);
  const pastIds = new Set(schedule.weeks.flatMap(w => w.revisions.at(-1).slots.filter(s => s.date < today).flatMap(s => s.items.map(i => i.id))));
  const ids = new Set(), continuations = new Set();
  const normalizedItems = items.map(item => {
    const normalized = checkItem(item, tasks);
    if (ids.has(item.id)) fail('同一片段不能重复安排');
    ids.add(item.id);
    if (pastIds.has(item.id)) fail('已经过去的片段不能复用编号；续做须使用新编号并关联原片段');
    const existing = originalItems.get(item.id);
    if (existing && (existing.taskId !== item.taskId || existing.continuedFromItemId !== normalized.continuedFromItemId || (existing.kind || 'work') !== normalized.kind)) fail('已有片段编号不能改为另一个任务、类型或接续来源');
    if (item.continuedFromItemId) {
      const old = originalItems.get(item.continuedFromItemId);
      if (!old || old.id === item.id || old.taskId !== item.taskId || continuations.has(old.id)) fail('接续来源须为同一任务的不重复已有片段，不能接续自身');
      continuations.add(old.id);
    }
    return normalized;
  });
  const requestSlots = (input.slots || []).map(s => ({ ...s, items: [] }));
  const slots = checkSlots(requestSlots, input.weekStart, tasks);
  if (slots.some(s => s.date < today)) fail('不能新排过去的学习时段；请在训练记录里补记实际发生的学习');
  const review = reviewInput(input.review, schedule, docs);
  const warnings = [], unassigned = [];
  const targetWeek = schedule.weeks.find(w => w.weekStart === input.weekStart);
  // Replacing a plan must keep its already elapsed slots and their identity intact.
  const pastSlots = (targetWeek?.revisions.at(-1)?.slots || []).filter(s => s.date < today);
  if (pastSlots.length) warnings.push('本周已过去的时段保留原安排；本次仅调整剩余时段。');
  const retained = pastSlots.flatMap(s => s.items.map(i => i.id));
  if (normalizedItems.some(i => retained.includes(i.id))) fail('已过去的片段不能改成未来新片段；续做请使用新片段 ID 并关联来源');
  const elsewhere = schedule.weeks.filter(w => w.weekStart !== input.weekStart).flatMap(w => {
    const latest = w.revisions.at(-1);
    return [...latest.slots.filter(s => s.date >= today).flatMap(s => s.items), ...latest.unassigned];
  });
  const otherSources = new Set(elsewhere.map(i => i.continuedFromItemId).filter(Boolean));
  const moving = new Set(normalizedItems.flatMap(i => [i.id, i.continuedFromItemId]).filter(Boolean));
  const moves = schedule.weeks.filter(w => w.weekStart !== input.weekStart).map(w => {
    const rev = w.revisions.at(-1);
    const candidates = [...rev.slots.filter(s => s.date >= today).flatMap(s => s.items), ...rev.unassigned];
    return { weekStart: w.weekStart, removeItemIds: candidates.filter(i => moving.has(i.id)).map(i => i.id) };
  }).filter(m => m.removeItemIds.length);
  if (moves.length) warnings.push('应用时会同时更新来源周的未来安排或待排列表，保留旧版本，避免跨周重复安排。');
  const priority = item => {
    if (item.kind === 'recovery-check') return -1;
    const entry = tasks.get(item.taskId);
    const logs = effectiveRecords(byUnit.get(entry.unit.id)).filter(r => r.taskId === item.taskId);
    let blocked = false;
    for (const log of logs) { if (log.outcome === 'blocked') blocked = true; if (log.outcome === 'passed') blocked = false; }
    return blocked ? 0 : item.continuedFromItemId || logs.length ? 1 : 2;
  };
  normalizedItems.sort((a, b) => priority(a) - priority(b));
  for (const item of normalizedItems) {
    if (item.continuedFromItemId && otherSources.has(item.continuedFromItemId) && !elsewhere.some(i => i.id === item.id && i.continuedFromItemId === item.continuedFromItemId)) fail('该接续工作已在其他未来周安排，请移动已有片段而非重复续做');
    const entry = tasks.get(item.taskId);
    const doc = byUnit.get(entry.unit.id);
    if (unitStatus(doc, entry.unit) === 'accepted') {
      warnings.push(`${entry.task.title}：单元已验收，无需为了凑次数重复训练，此项已从本次待排中移除。`); continue;
    }
    if (active && entry.unit.id !== active.id) {
      unassigned.push(item); warnings.push(`${entry.task.title}：先完成当前单元的验收，再安排后续单元。`); continue;
    }
    const slot = slots.find(s => s.minutes - s.bufferMinutes - s.items.reduce((n, i) => n + i.estimatedMinutes, 0) >= item.estimatedMinutes);
    if (slot) slot.items.push(item);
    else { unassigned.push(item); warnings.push(`${entry.task.title}：本周容量不足，请缩小本次目标或保留待排。`); }
  }
  const mergedSlots = [...pastSlots, ...slots].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const resumeDate = input.resumeDate || '';
  if (resumeDate) date(resumeDate);
  if (resumeDate && resumeDate < today) fail('预计恢复日期不能早于今天');
  const reason = text(input.reason || '', '调整原因');
  const reminders = [];
  const reviewed = schedule.weeks.filter(w => w.revisions.at(-1).slots.length && w.reviews.length)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 2);
  if (reviewed.length === 2 && reviewed.every(w => w.reviews.at(-1).items.some(i => ['partial', 'not-started'].includes(i.outcome)))) reminders.push('最近两次有安排的周核对仍有未完成：可以缩小目标、降低预计容量或针对卡点求助。这不是能力评分。');
  if (!slots.length) reminders.push('本次没有新的学习时段。允许暂停，不产生补课欠账；已有记录保持不变。');
  const previous = schedule.weeks.filter(w => w.weekStart < input.weekStart).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
  if (slots.length && previous && !previous.revisions.at(-1).slots.length) reminders.push('暂停后恢复：请把短自测作为第一个工作片段，计入本周容量。');
  return {
    request: { requestId: input.requestId, weekStart: input.weekStart, reason, slots: requestSlots.map(({items, ...slot}) => slot), items: normalizedItems, review, resumeDate },
    plan: { weekStart: input.weekStart, reason, slots: mergedSlots, unassigned, resumeDate },
    capacityMinutes: slots.reduce((n, s) => n + s.minutes, 0),
    plannedMinutes: slots.flatMap(s => s.items).reduce((n, i) => n + i.estimatedMinutes, 0),
    bufferMinutes: slots.reduce((n, s) => n + s.bufferMinutes, 0), warnings: [...new Set(warnings)], reminders, moves
  };
}

export function applySchedule(schedule, preview, { requestId, payloadHash, savedAt, reviewOnly = false }) {
  const next = copy(schedule);
  const prior = next.receipts.find(r => r.requestId === requestId);
  if (prior) {
    if (prior.payloadHash !== payloadHash) throw Object.assign(new Error('同一提交编号不能用于不同安排'), { status: 409 });
    return next;
  }
  const review = preview.request.review;
  if (reviewOnly && !review) fail('仅保存核对时必须提供本周核对');
  if (!reviewOnly) {
    for (const move of preview.moves || []) {
      const source = next.weeks.find(w => w.weekStart === move.weekStart);
      const old = copy(source.revisions.at(-1));
      const removed = new Set(move.removeItemIds);
      source.revisions.push({ ...old, id: requestId + '-move-' + move.weekStart, requestId, createdAt: savedAt, reason: '移至 ' + preview.plan.weekStart + '；' + preview.plan.reason, slots: old.slots.map(s => ({ ...s, items: s.items.filter(i => !removed.has(i.id)) })), unassigned: old.unassigned.filter(i => !removed.has(i.id)) });
    }
    const plan = copy(preview.plan);
    let week = next.weeks.find(w => w.weekStart === plan.weekStart);
    if (!week) { week = { weekStart: plan.weekStart, revisions: [], reviews: [] }; next.weeks.push(week); }
    week.revisions.push({ id: requestId + '-plan', requestId, createdAt: savedAt, reason: plan.reason, slots: plan.slots, unassigned: plan.unassigned, resumeDate: plan.resumeDate });
  }
  if (review) {
    const week = next.weeks.find(w => w.weekStart === review.weekStart);
    week.reviews.push({ id: requestId + '-review', createdAt: savedAt, revisionId: review.revisionId, note: review.note, items: copy(review.items) });
  }
  next.revision++;
  next.weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  next.receipts.push({ requestId, payloadHash, savedAt });
  return next;
}
