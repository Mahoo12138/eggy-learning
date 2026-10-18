// Keep the authored draft separate from the learner-shaped rendering copy.
export function createCoursePreviewSession(course, mode, activityId) {
  if (!course || typeof course !== 'object' || !['level', 'project'].includes(mode)) {
    throw new Error('没有收到可预览的课程草稿。');
  }
  const snapshot = structuredClone(course);
  const activity = (mode === 'project' ? snapshot.projects : snapshot.levels)?.find(item => item.id === activityId);
  if (!activity) throw new Error('当前草稿中没有找到这项课程，请返回课程工坊重新选择。');
  const level = mode === 'project' ? structuredClone(activity) : {
    ...structuredClone(activity),
    ...structuredClone(activity.content || {}),
    id: activity.id,
    title: activity.title,
    rankId: activity.rankId,
    version: activity.version
  };
  if (mode === 'level') {
    delete level.scene;
    for (const step of level.steps || level.checkpoints || []) {
      if (step.type !== 'independent-variation') continue;
      for (const variant of step.variants || []) {
        const solution = variant.fullSolution ?? variant.solution ?? step.fullSolution ?? step.fullAnswer;
        variant.fullSolutionAvailable = Boolean(typeof solution === 'string' ? solution : solution?.text);
        delete variant.fullSolution;
        delete variant.solution;
        delete variant.fullAnswer;
      }
      delete step.fullSolution;
      delete step.fullAnswer;
      delete step.solution;
    }
  }
  const rank = snapshot.ranks?.find(item => item.id === activity.rankId) || null;
  const locations = (snapshot.locations || []).filter(item => (activity.locationIds || [activity.locationId]).includes(item.id));
  return { course: snapshot, mode, activityId, level, payload: { rank, locations } };
}

export function previewAttemptBody(session, body, action = 'attempt') {
  return { ...body, attemptAction: body.action, action, course: session.course, mode: session.mode, activityId: session.activityId };
}
