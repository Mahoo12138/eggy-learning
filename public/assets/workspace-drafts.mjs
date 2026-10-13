// Re-rendering current questions must not erase an answer whose question was
// archived while another person was writing it.
export function mergeDraftAnswers(previous = [], visible = []) {
  const visibleIds = new Set(visible.map(answer => answer.questionId));
  return [...previous.filter(answer => !visibleIds.has(answer.questionId)), ...visible];
}

// Keep only locally edited fields over fresh server rows. Untouched fields use
// the server version; removed rows are returned separately for an explicit backup.
export function mergeReviewEdits(remote, local, baseline) {
  const fields = ['outcome', 'next', 'remainingMinutes', 'recordIds'];
  const before = new Map(baseline.map(row => [row.itemId, row]));
  const edits = new Map(local.map(row => [row.itemId, Object.fromEntries(
    fields.filter(key => JSON.stringify(row[key]) !== JSON.stringify(before.get(row.itemId)?.[key]))
      .map(key => [key, row[key]])
  )]));
  const ids = new Set(remote.map(row => row.itemId));
  return {
    rows: remote.map(row => ({...row, ...edits.get(row.itemId)})),
    removed: local.filter(row => !ids.has(row.itemId) && Object.keys(edits.get(row.itemId)).length)
  };
}
