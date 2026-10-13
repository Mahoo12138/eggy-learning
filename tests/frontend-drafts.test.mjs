import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeDraftAnswers, mergeReviewEdits} from '../public/assets/workspace-drafts.mjs';

test('an archived answer survives repeated captures while current answers change or clear', () => {
  const old = {questionId:'archived', questionVersion:1, text:'unfinished explanation', evidence:'repro.c'};
  const active = {questionId:'current', questionVersion:2, text:'new explanation', evidence:''};
  let answers = mergeDraftAnswers([old, {...active, text:'previous'}], [active]);
  answers = mergeDraftAnswers(answers, [{...active, text:''}]);
  assert.deepEqual(answers, [old, {...active, text:''}]);
  assert.deepEqual(mergeDraftAnswers(answers, []), answers);
});

test('review reload merges local edits with remote evidence without retaining stale defaults', () => {
  const base = [{itemId:'a', outcome:'unknown', next:'old', remainingMinutes:120, recordIds:[]}];
  const local = [{...base[0], next:'my next step', remainingMinutes:45}];
  const remote = [{...base[0], goal:'updated target', outcome:'partial', recordIds:['new-record']}];
  assert.deepEqual(mergeReviewEdits(remote, local, base), {rows:[{...remote[0], next:'my next step', remainingMinutes:45}], removed:[]});
  assert.deepEqual(base[0].recordIds, []);
});

test('removed edited review rows are kept for backup, while untouched removed rows are not', () => {
  const base = ['a','b'].map(itemId => ({itemId, outcome:'unknown', next:'work', remainingMinutes:120, recordIds:[]}));
  const local = [{...base[0], outcome:'done', recordIds:['evidence']}, base[1]];
  const result = mergeReviewEdits([{itemId:'new', next:'replacement'}], local, base);
  assert.deepEqual(result.rows, [{itemId:'new', next:'replacement'}]);
  assert.deepEqual(result.removed, [local[0]]);
});
