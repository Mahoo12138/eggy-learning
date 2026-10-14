export function attemptPassed(attempt, course) {
  const payload = attempt?.payload || attempt || {};
  const result = attempt?.result || attempt?.feedback || {};
  const project = payload.projectId ? course?.projects?.find(item => item.id === payload.projectId) : null;
  const projectBoss = Boolean(project && project.boss?.id === payload.checkpointId);
  if (projectBoss) return result.levelCompleted === true;
  return payload.passed === true || result.levelCompleted === true || result.checkpointCompleted === true || result.passed === true;
}
