// The two actual adapters retain their existing candidate scopes.
export function weekChoices(course, { scope = 'all', rankId = '' } = {}) {
  const inScope = item => scope === 'all' || !rankId || item.rankId === rankId;
  const levels = (course.levels || []).filter(level => inScope(level) && (scope === 'all' || !level.archived));
  const goals = levels.map(level => ({ value: `level:${level.id}`, label: `${level.kind === 'rank-boss' ? 'Boss' : '关卡'} · ${level.title || level.name || level.id}` }));
  for (const project of (course.projects || []).filter(inScope)) {
    const chapters = scope === 'all' ? (project.checkpoints || project.chapters || []).filter(item => item.kind !== 'boss') : project.chapters || [];
    for (const chapter of chapters) goals.push({ value: `project-checkpoint:${project.id}:${chapter.id}`, label: `${project.title || project.id} · ${chapter.title || chapter.id}` });
    if (scope !== 'all' && project.boss) goals.push({ value: `project-checkpoint:${project.id}:${project.boss.id}`, label: `${project.title || project.id} · Boss` });
  }
  const short = levels.filter(level => level.kind !== 'rank-boss' && (scope === 'all' || level.activityType !== 'rank-project')).map(level => ({ value: level.id, label: `${level.title || level.name || level.id}${scope === 'all' ? '' : ` · ${level.estimatedMinutes || 20} 分钟`}` }));
  return { goals, short };
}

export function goalValue(goal) {
  if (!goal) return '';
  return goal.kind === 'project-checkpoint' ? `project-checkpoint:${goal.projectId}:${goal.id}` : `level:${goal.id}`;
}

export function parseGoal(value) {
  const parts = String(value).split(':');
  if (parts[0] === 'level' && parts.length === 2 && parts[1]) return { kind: 'level', id: parts[1] };
  if (parts[0] === 'project-checkpoint' && parts.length === 3 && parts[1] && parts[2]) return { kind: 'project-checkpoint', projectId: parts[1], id: parts[2] };
  throw new TypeError('请选择有效的本周主目标。');
}

export function weekPayload(model, draft) {
  const { course, week, learnerId } = model;
  const rest = draft.mode === 'rest';
  const days = Number(draft.playDays);
  if (!rest && (!Number.isInteger(days) || days < 1 || days > 7)) throw new TypeError('游玩次数须为 1–7 次。');
  return {
    schemaVersion: 2, courseId: course.courseId || course.id, learnerId: learnerId || week.learnerId,
    weekStart: week.weekStart, revision: Number(week.revision ?? 0), mode: rest ? 'rest' : 'active',
    playDays: rest ? 0 : days, mainGoal: rest ? null : parseGoal(draft.mainGoal),
    shortLevelId: rest ? '' : draft.shortLevelId, note: draft.note
  };
}
