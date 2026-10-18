import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { withMasteryChallenges } from '../lib/mastery-challenges.mjs';
import { sanitizeCourse } from '../shared/park-domain.mjs';

const data = new URL('../data/', import.meta.url);
const index = JSON.parse(await readFile(new URL('course.json', data), 'utf8'));
const details = await Promise.all((await readdir(new URL('levels/', data))).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(new URL(`levels/${name}`, data), 'utf8'))));
const course = sanitizeCourse(index, details);
const ids = ['quail-fountain-sequence', 'quail-piano-output', 'quail-opening-broadcast'];

function exhausted() {
  const attempts = ids.flatMap(levelId => {
    const level = course.levels.find(level => level.id === levelId);
    const step = level.content.steps.find(step => step.type === 'independent-variation');
    return step.variants.map((variant, i) => ({ kind: 'level', payload: { levelId, contentVersion: level.version, stepId: step.id, variantId: variant.id, viewedFullAnswer: true }, result: { levelCompleted: i === 0 } }));
  });
  return { attempts, awardLedger: [] };
}

test('补题只在已完成章节且缺星、原题耗尽时出现，不改写课程和学习记录', () => {
  const progress = exhausted();
  const original = JSON.stringify({ course, progress });
  const supplemented = withMasteryChallenges(course, progress);
  assert.doesNotThrow(() => sanitizeCourse(supplemented));
  for (const levelId of ids) {
    const variants = supplemented.levels.find(level => level.id === levelId).content.steps.at(-1).variants;
    const challenge = variants.at(-1);
    assert.equal(challenge.id, 'mastery-1');
    assert.notEqual(challenge.starterFiles['main.c'], challenge.fullSolution);
    assert.ok(challenge.grader.cases.some(item => item.exitCode === 1));
  }
  assert.equal(JSON.stringify({ course, progress }), original);
  assert.deepEqual(withMasteryChallenges(course, structuredClone(progress)), supplemented);
  const notExhausted = exhausted(); notExhausted.attempts.pop();
  assert.equal(withMasteryChallenges(course, notExhausted).levels.find(level => level.id === ids[2]).content.steps.at(-1).variants.some(item => item.id.startsWith('mastery-')), false);
});

test('连续查看补题答案后继续生成，已获得星星后停止补题但旧请求可重放', () => {
  const progress = exhausted();
  const levelId = ids[0];
  for (let round = 1; round <= 100; round++) {
    const supplemented = withMasteryChallenges(course, progress);
    const step = supplemented.levels.find(level => level.id === levelId).content.steps.at(-1);
    assert.equal(step.variants.at(-1).id, `mastery-${round}`);
    assert.doesNotThrow(() => sanitizeCourse(supplemented));
    progress.attempts.push({ kind: 'level', payload: { levelId, contentVersion: 3, stepId: step.id, variantId: `mastery-${round}`, viewedFullAnswer: true }, result: { levelCompleted: false } });
  }
  const forged = withMasteryChallenges(course, progress, { levelId, stepId: 'independent-variation', variantId: 'mastery-99999' });
  assert.equal(forged.levels.find(level => level.id === levelId).content.steps.at(-1).variants.some(item => item.id === 'mastery-99999'), false);
  progress.awardLedger.push({ kind: 'star', activityId: levelId });
  const won = withMasteryChallenges(course, progress);
  assert.equal(won.levels.find(level => level.id === levelId).content.steps.at(-1).variants.some(item => item.id.startsWith('mastery-')), false);
  const replay = withMasteryChallenges(course, progress, { levelId, stepId: 'independent-variation', variantId: 'mastery-1' });
  assert.equal(replay.levels.find(level => level.id === levelId).content.steps.at(-1).variants.at(-1).id, 'mastery-1');
});
