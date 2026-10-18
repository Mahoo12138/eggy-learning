export function attemptPassed(attempt, course) {
  const payload = attempt?.payload || attempt || {};
  const result = attempt?.result || attempt?.feedback || {};
  const project = payload.projectId ? course?.projects?.find(item => item.id === payload.projectId) : null;
  const projectBoss = Boolean(project && project.boss?.id === payload.checkpointId);
  if (projectBoss) return result.levelCompleted === true;
  return payload.passed === true || result.levelCompleted === true || result.checkpointCompleted === true || result.passed === true;
}

function timeValue(attempt) {
  const value = attempt?.submittedAt || attempt?.createdAt || attempt?.payload?.submittedAt;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mergeAttempts(progress = {}) {
  const ordinary = Array.isArray(progress.attempts) ? progress.attempts : [];
  const concepts = Array.isArray(progress.conceptAttempts)
    ? progress.conceptAttempts.map(attempt => ({ ...attempt, kind: 'project-concept' }))
    : [];
  return [...ordinary, ...concepts]
    .map((attempt, index) => ({ attempt, index }))
    .sort((left, right) => timeValue(left.attempt) - timeValue(right.attempt) || left.index - right.index)
    .map(item => item.attempt);
}

export function completedActivityCount(records = []) {
  return new Set(records
    .filter(attempt => attempt?.result?.levelCompleted === true)
    .map(attempt => attempt?.payload?.levelId || attempt?.payload?.projectId)
    .filter(Boolean)).size;
}

export function attemptView(attempt, course = {}) {
  const payload = attempt?.payload || attempt || {};
  const result = attempt?.result || attempt?.feedback || {};
  const kind = attempt?.kind || (payload.checkId ? 'project-concept' : payload.projectId ? 'project' : 'level');
  const passed = attemptPassed(attempt, course);

  if (kind === 'project-concept') {
    const project = course.projects?.find(item => item.id === payload.projectId);
    const chapter = project?.chapters?.find(item => item.id === payload.chapterId);
    const check = chapter?.conceptModule?.checks?.find(item => item.id === payload.checkId);
    const option = check?.options?.find(item => item.id === payload.selectedOptionId);
    return {
      id: attempt?.id || payload.requestId || '',
      when: attempt?.submittedAt || attempt?.createdAt || payload.submittedAt || '',
      kind,
      title: project?.title || payload.projectId || '未知作品',
      step: [chapter?.title || payload.chapterId, check?.question || payload.checkId].filter(Boolean).join(' · '),
      answer: option?.text || payload.selectedOptionId || '（未记录选项）',
      feedback: check?.explanation || '',
      hint: 0,
      full: false,
      independent: false,
      passed,
      statusLabel: passed ? '理解通过' : '需要重看',
      result
    };
  }

  return {
    id: attempt?.id || payload.requestId || '',
    when: attempt?.submittedAt || attempt?.createdAt || payload.submittedAt || '',
    kind,
    title: payload.levelId || payload.projectId || attempt?.levelTitle || '未知内容',
    step: payload.stepId || payload.checkpointId || attempt?.stepTitle || '',
    answer: payload.answer || payload.code || payload.evidence || attempt?.answer || '',
    feedback: '',
    hint: Number(payload.hintLevel ?? attempt?.hintLevel ?? 0),
    full: payload.viewedFullAnswer === true || attempt?.viewedFullAnswer === true,
    independent: payload.independent === true || attempt?.independent === true,
    passed,
    statusLabel: passed ? '通过' : '继续尝试',
    result
  };
}
