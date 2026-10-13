// A task can contain several scheduled scopes. Review each scope by its stable
// source ID; a completed warm-up must not hide unfinished work on the same task.
export function buildScheduleCandidates(unit, records, sourceItems, makeId, previous = []) {
  const prior = new Map(previous.map(item => [
    `${item.taskId}\0${item.continuedFromItemId || ''}`, item
  ]));
  return unit.tasks.filter(task => !task.archived).flatMap(task => {
    const latest = records.filter(record => record.taskId === task.id).at(-1);
    const passed = latest?.outcome === 'passed' &&
      latest.assessmentVersion === unit.assessmentVersion;
    const unfinished = sourceItems.filter(item =>
      item.taskId === task.id && item.outcome !== 'done'
    );
    // When all scheduled scopes are done, the task still needs its own current
    // evidence. Do not infer task completion from a calendar review alone.
    return (unfinished.length ? unfinished : [null]).map(source => {
      const sourceId = source?.itemId || '';
      const old = prior.get(`${task.id}\0${sourceId}`);
      const sourceGoal = source ? source.next ?? source.goal : task.output || task.title;
      const sourceMinutes = source ? source.remainingMinutes ?? source.estimatedMinutes : task.estimatedMinutes;
      const sourceOutcome = source?.outcome || '';
      const unchanged = old && old._sourceOutcome === sourceOutcome && old.passed === passed;
      return {
        id: old?.id || makeId(),
        taskId: task.id,
        unitId: unit.id,
        title: task.title,
        goal: old && old._sourceGoal === sourceGoal ? old.goal : sourceGoal,
        estimatedMinutes: old && old._sourceMinutes === sourceMinutes ? old.estimatedMinutes : sourceMinutes,
        continuedFromItemId: sourceId,
        kind: source?.kind || 'work',
        selected: unchanged ? old.selected : Boolean(source) || !passed,
        passed,
        _sourceGoal: sourceGoal,
        _sourceMinutes: sourceMinutes,
        _sourceOutcome: sourceOutcome
      };
    });
  });
}
