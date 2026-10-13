import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  freshProgress,
  freshWeekCard,
  sanitizeCourse,
  sanitizeProgress,
  sanitizeWeekCard,
  submitAttempt,
  submitProjectCheckpoint,
  summary
} from '../shared/park-domain.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_COURSE = JSON.parse(await readFile(join(ROOT, 'data/course.json'), 'utf8'));
const LEVEL_DOCS = await Promise.all(
  (await readdir(join(ROOT, 'data/levels')))
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(async name => JSON.parse(await readFile(join(ROOT, 'data/levels', name), 'utf8')))
);
const COURSE = sanitizeCourse(RAW_COURSE, LEVEL_DOCS);
const INITIAL_PROGRESS = JSON.parse(await readFile(join(ROOT, 'data/progress.json'), 'utf8'));
const INITIAL_WEEK_CARD = JSON.parse(await readFile(join(ROOT, 'data/week-card.json'), 'utf8'));

function clone(value) { return structuredClone(value); }
function iso(minute) { return new Date(Date.UTC(2026, 9, 13, 1, minute)).toISOString(); }

function levelInput(levelId, requestId, overrides = {}) {
  const level = COURSE.levels.find(item => item.id === levelId);
  const step = level.content.steps.find(item => item.type === 'independent-variation') || level.content.steps[0];
  return {
    requestId,
    levelId,
    contentVersion: level.version,
    stepId: step.id,
    variantId: step.variants?.[0]?.id || '',
    action: 'submit',
    answer: 'learner answer',
    hintLevel: 0,
    viewedFullAnswer: false,
    passed: true,
    independent: true,
    ...overrides
  };
}

function bossInput(levelId, checkpointId, requestId, overrides = {}) {
  const level = COURSE.levels.find(item => item.id === levelId);
  return {
    requestId,
    levelId,
    contentVersion: level.version,
    stepId: checkpointId,
    variantId: '',
    action: 'submit',
    answer: 'checkpoint evidence',
    hintLevel: 0,
    viewedFullAnswer: false,
    passed: true,
    independent: true,
    ...overrides
  };
}

function projectInput(projectId, checkpointId, requestId, overrides = {}) {
  const project = COURSE.projects.find(item => item.id === projectId);
  return {
    requestId,
    projectId,
    contentVersion: project.version,
    checkpointId,
    action: 'submit',
    evidence: 'tests and an explanation of the observed behavior',
    hintLevel: 0,
    viewedFullAnswer: false,
    passed: true,
    independent: true,
    ...overrides
  };
}

function flow(initial = freshProgress(COURSE, 'learner-1')) {
  return {
    progress: initial,
    clock: 0,
    level(input) {
      const number = ++this.clock;
      const output = submitAttempt(COURSE, this.progress, input, { id: `attempt-${number}`, submittedAt: iso(number) });
      this.progress = output.progress;
      return output;
    },
    project(input) {
      const number = ++this.clock;
      const output = submitProjectCheckpoint(COURSE, this.progress, input, { id: `attempt-${number}`, submittedAt: iso(number) });
      this.progress = output.progress;
      return output;
    }
  };
}

function playToIndependentVariation(run, levelId, prefix = levelId) {
  const level = COURSE.levels.find(item => item.id === levelId);
  const variationIndex = level.content.steps.findIndex(item => item.type === 'independent-variation');
  for (const step of level.content.steps.slice(0, variationIndex)) {
    run.level(levelInput(levelId, `${prefix}-${step.id}`, {
      stepId: step.id,
      variantId: '',
      independent: false
    }));
  }
  return level.content.steps[variationIndex];
}

function completeLesson(run, levelId, prefix = levelId) {
  playToIndependentVariation(run, levelId, prefix);
  return run.level(levelInput(levelId, `${prefix}-independent-clear`));
}

function completeOnlineRank(run, rankId) {
  const rank = COURSE.ranks.find(item => item.id === rankId);
  const boss = COURSE.levels.find(item => item.id === rank.promotion.bossActivityId);
  for (const levelId of rank.activityIds.filter(item => item !== boss.id)) {
    completeLesson(run, levelId, `clear-${levelId}`);
  }
  for (const [index, checkpoint] of boss.content.checkpoints.entries()) {
    run.level(bossInput(boss.id, checkpoint.id, `clear-${boss.id}-${checkpoint.id}`, {
      independent: index === boss.content.checkpoints.length - 1
    }));
  }
}

function completeProjectRank(run, rankId, performancePoints = 0) {
  const rank = COURSE.ranks.find(item => item.id === rankId);
  const project = COURSE.projects.find(item => item.id === rank.projectId);
  for (const chapter of project.chapters) {
    run.project(projectInput(project.id, chapter.id, `clear-${project.id}-${chapter.id}`));
  }
  run.project(projectInput(project.id, project.boss.id, `clear-${project.id}-${project.boss.id}`, { performancePoints }));
}

test('the checked-in rich v2 documents validate and hydrate every indexed online level', () => {
  const indexOnly = sanitizeCourse(RAW_COURSE);
  assert.equal(indexOnly.ranks.length, 9);
  assert.equal(indexOnly.levels.length, 12);
  assert.equal(indexOnly.levels.some(level => 'content' in level), false);

  assert.equal(COURSE.levels.every(level => level.content?.id === level.id), true);
  assert.equal(COURSE.projects.length, 6);
  assert.equal(COURSE.ranks[0].title, '鹌鹑蛋');
  assert.equal(COURSE.ranks[8].title, '无敌凤凰蛋');
  assert.doesNotThrow(() => sanitizeProgress(indexOnly, INITIAL_PROGRESS));
  assert.doesNotThrow(() => sanitizeWeekCard(indexOnly, INITIAL_WEEK_CARD));
});

test('course validation rejects incomplete hydration, index/detail drift, mirror drift, and unknown fields', () => {
  const missing = LEVEL_DOCS.filter(item => item.id !== 'quail-fountain-sequence');
  assert.throws(() => sanitizeCourse(RAW_COURSE, missing), /缺少关卡详情/);

  const drifted = clone(LEVEL_DOCS);
  drifted.find(item => item.id === 'quail-fountain-sequence').title = 'changed title';
  assert.throws(() => sanitizeCourse(RAW_COURSE, drifted), /索引不一致/);

  const mirror = clone(LEVEL_DOCS);
  mirror.find(item => item.id === 'goose-food-street-project').story = 'changed story';
  assert.throws(() => sanitizeCourse(RAW_COURSE, mirror), /作品镜像与课程索引不一致/);

  const topUnknown = clone(RAW_COURSE);
  topUnknown.unknown = true;
  assert.throws(() => sanitizeCourse(topUnknown), /字段缺失或包含未知字段/);

  const nestedUnknown = clone(LEVEL_DOCS);
  nestedUnknown.find(item => item.id === 'quail-fountain-sequence').steps[0].unknown = true;
  assert.throws(() => sanitizeCourse(RAW_COURSE, nestedUnknown), /字段缺失或包含未知字段/);

  const uppercaseId = clone(RAW_COURSE);
  uppercaseId.courseId = 'Eggy-programming-park';
  assert.throws(() => sanitizeCourse(uppercaseId), /小写稳定编号/);
});

test('independent variants require a non-empty full solution', () => {
  const missingSolution = clone(LEVEL_DOCS);
  const missingVariant = missingSolution
    .find(item => item.id === 'quail-fountain-sequence')
    .steps.find(item => item.type === 'independent-variation')
    .variants[0];
  delete missingVariant.fullSolution;
  assert.throws(() => sanitizeCourse(RAW_COURSE, missingSolution), /字段缺失或包含未知字段/);

  const emptySolution = clone(LEVEL_DOCS);
  emptySolution
    .find(item => item.id === 'quail-fountain-sequence')
    .steps.find(item => item.type === 'independent-variation')
    .variants[0].fullSolution = '   ';
  assert.throws(() => sanitizeCourse(RAW_COURSE, emptySolution), /变式完整解法须为非空文本/);
});

test('level prerequisites must point strictly backward and reject mutual dependency cycles', () => {
  const selfDependency = clone(RAW_COURSE);
  selfDependency.levels[0].prerequisiteLevelIds = [selfDependency.levels[0].id];
  assert.throws(() => sanitizeCourse(selfDependency), /必须指向严格更早的关卡/);

  const forwardDependency = clone(RAW_COURSE);
  forwardDependency.levels[0].prerequisiteLevelIds = [forwardDependency.levels[1].id];
  assert.throws(() => sanitizeCourse(forwardDependency), /必须指向严格更早的关卡/);

  const cycle = clone(RAW_COURSE);
  cycle.levels[0].prerequisiteLevelIds = [cycle.levels[1].id];
  cycle.levels[1].prerequisiteLevelIds = [cycle.levels[0].id];
  assert.throws(() => sanitizeCourse(cycle), /必须指向严格更早的关卡/);
});

test('fresh progress uses the hydrated first step and request IDs are exactly idempotent', () => {
  const run = flow();
  assert.deepEqual(run.progress.current, {
    rankId: 'quail', subrankId: 'quail-iii', activityId: 'quail-fountain-sequence', stepId: 'predict'
  });

  const input = levelInput('quail-fountain-sequence', 'request-one', {
    stepId: 'predict', variantId: '', passed: false, independent: false
  });
  const first = run.level(input);
  assert.equal(first.result.xpAwarded, 10);
  assert.equal(first.progress.xp.total, 10);
  assert.equal(first.progress.revision, 1);
  assert.equal(first.progress.current.stepId, 'predict');

  const replay = submitAttempt(COURSE, run.progress, input, { id: 'ignored-meta', submittedAt: iso(50) });
  assert.equal(replay.result.replayed, true);
  assert.equal(replay.progress.revision, 1);
  assert.equal(replay.progress.xp.total, 10);
  assert.throws(
    () => submitAttempt(COURSE, run.progress, { ...input, answer: 'different payload' }, { id: 'conflict-attempt', submittedAt: iso(51) }),
    error => error.status === 409 && error.code === 'request_id_conflict'
  );

  const passedPrediction = run.level({ ...input, requestId: 'request-two', passed: true });
  assert.equal(passedPrediction.progress.current.stepId, 'run-observe');
  assert.equal(passedPrediction.result.xpAwarded, 0);
  const replayedPassedStep = run.level({ ...input, requestId: 'request-three', passed: false });
  assert.equal(replayedPassedStep.progress.current.stepId, 'run-observe');
});

test('XP cannot be farmed and the first independent clear awards exactly one permanent star', () => {
  const run = flow();
  const levelId = 'quail-fountain-sequence';

  assert.throws(
    () => submitAttempt(COURSE, run.progress, levelInput(levelId, 'skip-to-independent'), { id: 'skip-independent-attempt', submittedAt: iso(1) }),
    error => error.status === 409 && error.code === 'step_locked'
  );
  playToIndependentVariation(run, levelId, 'first-clear');
  const first = run.level(levelInput(levelId, 'first-clear'));
  assert.equal(first.result.xpAwarded, 20);
  assert.equal(first.result.starAwarded, true);
  assert.equal(first.result.levelCompleted, true);
  assert.equal(run.progress.xp.total, 30);
  assert.equal(run.progress.current.activityId, 'quail-piano-output');
  assert.equal(run.progress.current.stepId, 'predict');

  const alternate = COURSE.levels.find(item => item.id === levelId).content.steps
    .find(item => item.type === 'independent-variation').variants[1].id;
  const repeated = run.level(levelInput(levelId, 'repeat-clear', { variantId: alternate }));
  assert.equal(repeated.result.xpAwarded, 0);
  assert.equal(repeated.result.starAwarded, false);
  assert.equal(repeated.result.levelCompleted, false);
  assert.equal(run.progress.xp.total, 30);
  assert.equal(run.progress.awardLedger.filter(item => item.kind === 'star').length, 1);
  assert.equal(run.progress.current.activityId, 'quail-piano-output');
});

test('viewing a complete answer requires an unused equivalent variation before a star', () => {
  const run = flow();
  const levelId = 'quail-fountain-sequence';
  const variationStep = COURSE.levels.find(item => item.id === levelId).content.steps.find(item => item.type === 'independent-variation');
  const [firstVariant, replacement] = variationStep.variants;

  playToIndependentVariation(run, levelId, 'solution-path');

  run.level(levelInput(levelId, 'view-solution', {
    variantId: firstVariant.id, answer: 'copied complete answer', hintLevel: 3, viewedFullAnswer: true, passed: true, independent: false
  }));
  assert.equal(run.progress.current.activityId, levelId);
  assert.equal(run.progress.current.stepId, variationStep.id);
  assert.equal(run.progress.attempts.at(-1).result.levelCompleted, false);
  assert.equal(run.progress.xp.total, 10);

  const exposed = run.level(levelInput(levelId, 'clear-exposed', { variantId: firstVariant.id }));
  assert.equal(exposed.result.levelCompleted, false);
  assert.equal(exposed.result.starAwarded, false);
  assert.equal(exposed.result.xpAwarded, 0);
  assert.equal(run.progress.current.activityId, levelId);
  assert.equal(run.progress.current.stepId, variationStep.id);
  assert.equal(run.progress.awardLedger.some(item => item.kind === 'star'), false);

  const recovered = run.level(levelInput(levelId, 'clear-replacement', { variantId: replacement.id }));
  assert.equal(recovered.result.levelCompleted, true);
  assert.equal(recovered.result.starAwarded, true);
  assert.equal(recovered.result.xpAwarded, 20);
  assert.equal(run.progress.current.activityId, 'quail-piano-output');
  assert.equal(run.progress.awardLedger.find(item => item.kind === 'star').sourceId, replacement.id);
});

test('the last lesson unlocks and advances to the online Boss, whose checkpoints resume in order', () => {
  const run = flow();
  const boss = COURSE.levels.find(item => item.id === 'quail-opening-boss');
  assert.throws(
    () => submitAttempt(COURSE, run.progress, bossInput(boss.id, boss.content.checkpoints[0].id, 'early-boss'), { id: 'early-attempt', submittedAt: iso(1) }),
    error => error.status === 409 && error.code === 'boss_locked'
  );

  for (const levelId of ['quail-fountain-sequence', 'quail-piano-output']) {
    completeLesson(run, levelId, `clear-${levelId}`);
  }
  const lastLesson = completeLesson(run, 'quail-opening-broadcast', 'clear-quail-opening-broadcast');
  assert.equal(lastLesson.result.bossUnlocked, true);
  assert.equal(run.progress.current.activityId, boss.id);
  assert.equal(run.progress.current.stepId, boss.content.checkpoints[0].id);
  assert.equal(run.progress.rankStates.find(item => item.rankId === 'quail').bossStatus, 'unlocked');

  const firstCheckpoint = boss.content.checkpoints[0];
  const secondCheckpoint = boss.content.checkpoints[1];
  const firstBossResult = run.level(bossInput(boss.id, firstCheckpoint.id, 'boss-one', { independent: false }));
  assert.equal(firstBossResult.result.checkpointCompleted, true);
  assert.equal(run.progress.current.stepId, secondCheckpoint.id);
  assert.equal(run.progress.rankStates.find(item => item.rankId === 'quail').bossStatus, 'in-progress');
  assert.throws(
    () => submitAttempt(COURSE, run.progress, bossInput(boss.id, boss.content.checkpoints[2].id, 'skip-boss-two'), { id: 'skip-attempt', submittedAt: iso(20) }),
    error => error.status === 409 && error.code === 'checkpoint_locked'
  );

  run.level(bossInput(boss.id, secondCheckpoint.id, 'boss-two', { independent: false }));
  const assistedFinal = run.level(bossInput(boss.id, boss.content.checkpoints[2].id, 'boss-final-assisted', { independent: false }));
  assert.equal(assistedFinal.result.checkpointCompleted, false);
  assert.equal(run.progress.current.rankId, 'quail');

  const promoted = run.level(bossInput(boss.id, boss.content.checkpoints[2].id, 'boss-final-independent'));
  assert.equal(promoted.result.levelCompleted, true);
  assert.equal(promoted.result.rankPromoted, 'pigeon');
  assert.equal(promoted.result.tokenAwarded, 'token-square-start-key');
  assert.equal(run.progress.current.rankId, 'pigeon');
  assert.equal(run.progress.awardLedger.filter(item => item.kind === 'ability-token').length, 1);

  const oldPractice = run.level(levelInput('quail-fountain-sequence', 'old-rank-practice'));
  assert.equal(oldPractice.progress.current.rankId, 'pigeon');
  assert.equal(oldPractice.result.xpAwarded, 0);
});

test('an assisted project checkpoint can later earn its star, and the Boss promotes only after all stars', () => {
  const run = flow();
  for (const rankId of ['quail', 'pigeon', 'chicken']) completeOnlineRank(run, rankId);
  assert.equal(run.progress.current.rankId, 'goose');

  const project = COURSE.projects.find(item => item.id === 'goose-food-street-project');
  assert.throws(
    () => submitProjectCheckpoint(COURSE, run.progress, projectInput(project.id, project.boss.id, 'early-project-boss'), { id: 'early-project-attempt', submittedAt: iso(55) }),
    error => error.status === 409 && error.code === 'boss_locked'
  );

  const firstChapter = project.chapters[0];
  const assisted = run.project(projectInput(project.id, firstChapter.id, 'assisted-chapter', { independent: false }));
  assert.equal(assisted.result.checkpointCompleted, true);
  assert.equal(assisted.result.starAwarded, false);
  assert.equal(run.progress.current.stepId, project.chapters[1].id);

  const reclaimed = run.project(projectInput(project.id, firstChapter.id, 'independent-retry'));
  assert.equal(reclaimed.result.checkpointCompleted, false);
  assert.equal(reclaimed.result.starAwarded, true);
  for (const chapter of project.chapters.slice(1)) run.project(projectInput(project.id, chapter.id, `chapter-${chapter.id}`));
  assert.equal(run.progress.rankStates.find(item => item.rankId === 'goose').earnedStars, 6);
  assert.equal(run.progress.current.stepId, project.boss.id);

  const assistedBoss = run.project(projectInput(project.id, project.boss.id, 'assisted-project-boss', { independent: false }));
  assert.equal(assistedBoss.result.checkpointCompleted, false);
  assert.equal(run.progress.current.rankId, 'goose');

  const promoted = run.project(projectInput(project.id, project.boss.id, 'independent-project-boss'));
  assert.equal(promoted.result.rankPromoted, 'ostrich');
  assert.equal(promoted.result.tokenAwarded, 'trophy-food-street-sign');
  assert.equal(run.progress.current.rankId, 'ostrich');
});

test('a full nine-rank playthrough reaches course completion without duplicated rewards', () => {
  const run = flow();
  for (const rankId of ['quail', 'pigeon', 'chicken']) completeOnlineRank(run, rankId);
  for (const rankId of ['goose', 'ostrich', 'dinosaur']) completeProjectRank(run, rankId);
  for (const rankId of ['peak-phoenix', 'super-phoenix']) completeProjectRank(run, rankId, 85);
  completeProjectRank(run, 'invincible-phoenix');

  const home = summary(COURSE, run.progress);
  assert.equal(home.courseCompleted, true);
  assert.equal(home.tokens.length, 9);
  assert.equal(new Set(home.tokens.map(item => item.key)).size, 9);
  assert.equal(home.ranks.every(item => item.status === 'completed'), true);
  assert.equal(home.currentRank.id, 'invincible-phoenix');
});

test('earned XP, stars, and rank tokens survive a compatible course revision', () => {
  const run = flow();
  completeOnlineRank(run, 'quail');
  const before = summary(COURSE, run.progress);

  const revised = clone(COURSE);
  revised.publishedRevision += 1;
  const changed = revised.levels.find(item => item.id === 'quail-fountain-sequence');
  changed.version += 1;
  changed.content.version += 1;
  changed.content.rewards.xp.firstClear = 999;
  const validated = sanitizeProgress(sanitizeCourse(revised), run.progress);
  const after = summary(revised, validated);
  assert.equal(after.xp.total, before.xp.total);
  assert.equal(after.starsTotal, before.starsTotal);
  assert.deepEqual(after.tokens.map(item => item.key), before.tokens.map(item => item.key));
});

test('progress rejects forged aggregates, duplicate immutable awards, and dangling evidence', () => {
  const run = flow();
  completeLesson(run, 'quail-fountain-sequence', 'real-attempt');

  const forgedXp = clone(run.progress);
  forgedXp.xp.total += 10;
  assert.throws(() => sanitizeProgress(COURSE, forgedXp), /经验状态/);

  const duplicate = clone(run.progress);
  duplicate.awardLedger.push(clone(duplicate.awardLedger[0]));
  assert.throws(() => sanitizeProgress(COURSE, duplicate), /奖励键重复/);

  const dangling = clone(run.progress);
  dangling.awardLedger[0].attemptId = 'missing-attempt';
  assert.throws(() => sanitizeProgress(COURSE, dangling), /奖励引用未知尝试/);

  const forgedResult = clone(run.progress);
  forgedResult.attempts[0].result.xpAwarded += 1000;
  assert.throws(() => sanitizeProgress(COURSE, forgedResult), /尝试结果与不可变奖励账本不一致/);

  const skippedRank = clone(INITIAL_PROGRESS);
  skippedRank.current.rankId = 'pigeon';
  skippedRank.current.subrankId = 'pigeon-iii';
  skippedRank.current.activityId = 'pigeon-salty-fish-counter';
  skippedRank.current.stepId = 'predict';
  skippedRank.rankStates[0].status = 'completed';
  skippedRank.rankStates[1].status = 'available';
  assert.throws(() => sanitizeProgress(COURSE, skippedRank), /段位状态与永久奖励不一致/);

  const impossibleRevision = clone(run.progress);
  impossibleRevision.revision = 0;
  assert.throws(() => sanitizeProgress(COURSE, impossibleRevision), /进度版本不能小于/);
});

test('weekly play cards support active and true rest weeks without overdue debt', () => {
  const blank = freshWeekCard(COURSE, 'learner-1');
  assert.equal(blank.weeks.length, 0);
  const seededRest = freshWeekCard(COURSE, 'learner-1', '2026-10-12');
  assert.equal(seededRest.weeks[0].mode, 'rest');
  assert.equal(seededRest.weeks[0].playDays, 0);

  const activeEntry = {
    weekStart: '2026-10-12',
    mode: 'active',
    playDays: 3,
    mainGoal: { kind: 'level', id: 'quail-fountain-sequence' },
    shortLevelId: 'quail-piano-output',
    note: '先玩主线，再做一关短复习。',
    updatedAt: '2026-10-12T09:00:00+08:00'
  };
  const active = sanitizeWeekCard(COURSE, {
    ...blank,
    revision: 1,
    weeks: [activeEntry],
    receipts: [{ requestId: 'week-request-1', payload: activeEntry, updatedAt: activeEntry.updatedAt }]
  });
  assert.equal(active.weeks[0].mainGoal.id, 'quail-fountain-sequence');

  const tuesday = clone(active);
  tuesday.weeks[0].weekStart = '2026-10-13';
  assert.throws(() => sanitizeWeekCard(COURSE, tuesday), /周一/);

  const fakeRest = clone(active);
  fakeRest.weeks[0].mode = 'rest';
  assert.throws(() => sanitizeWeekCard(COURSE, fakeRest), /休息周/);

  const bossAsShortLevel = clone(active);
  bossAsShortLevel.weeks[0].shortLevelId = 'quail-opening-boss';
  assert.throws(() => sanitizeWeekCard(COURSE, bossAsShortLevel), /非 Boss/);
});
