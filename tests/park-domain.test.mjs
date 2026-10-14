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
const EARLY_RANK_IDS = new Set(['quail', 'pigeon', 'chicken']);
const PARK_SCENE_TERMS = [
  '摩天轮', '盲盒', '烘焙', '奶茶', '游戏厅', '换新店', '形象店', '喷泉', '蛋仔公园', '足球', '商城', '钢琴',
  '咸鱼', '弹簧绳', '钩爪', '加速鞋', '炸弹', '地雷', '传送球', '缩小牛奶', '垫脚石', '弹板', '云雾弹', '墨汁炸弹', '弹力球'
];

function clone(value) { return structuredClone(value); }
function iso(minute) { return new Date(Date.UTC(2026, 9, 13, 1, minute)).toISOString(); }

function levelInput(levelId, requestId, overrides = {}, course = COURSE) {
  const level = course.levels.find(item => item.id === levelId);
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

function bossInput(levelId, checkpointId, requestId, overrides = {}, course = COURSE) {
  const level = course.levels.find(item => item.id === levelId);
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

function projectInput(projectId, checkpointId, requestId, overrides = {}, course = COURSE) {
  const project = course.projects.find(item => item.id === projectId);
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

function flow(initial = freshProgress(COURSE, 'learner-1'), course = COURSE) {
  return {
    progress: initial,
    clock: 0,
    level(input) {
      const number = ++this.clock;
      const output = submitAttempt(course, this.progress, input, { id: `attempt-${number}`, submittedAt: iso(number) });
      this.progress = output.progress;
      return output;
    },
    project(input) {
      const number = ++this.clock;
      const output = submitProjectCheckpoint(course, this.progress, input, { id: `attempt-${number}`, submittedAt: iso(number) });
      this.progress = output.progress;
      return output;
    }
  };
}

function playToIndependentVariation(run, levelId, prefix = levelId, course = COURSE) {
  const level = course.levels.find(item => item.id === levelId);
  const variationIndex = level.content.steps.findIndex(item => item.type === 'independent-variation');
  for (const step of level.content.steps.slice(0, variationIndex)) {
    run.level(levelInput(levelId, `${prefix}-${step.id}`, {
      stepId: step.id,
      variantId: '',
      independent: false
    }, course));
  }
  return level.content.steps[variationIndex];
}

function completeLesson(run, levelId, prefix = levelId, course = COURSE) {
  playToIndependentVariation(run, levelId, prefix, course);
  return run.level(levelInput(levelId, `${prefix}-independent-clear`, {}, course));
}

function completeOnlineRank(run, rankId, course = COURSE) {
  const rank = course.ranks.find(item => item.id === rankId);
  const boss = course.levels.find(item => item.id === rank.promotion.bossActivityId);
  for (const levelId of rank.activityIds.filter(item => item !== boss.id)) {
    completeLesson(run, levelId, `clear-${levelId}`, course);
  }
  for (const [index, checkpoint] of boss.content.checkpoints.entries()) {
    run.level(bossInput(boss.id, checkpoint.id, `clear-${boss.id}-${checkpoint.id}`, {
      independent: index === boss.content.checkpoints.length - 1
    }, course));
  }
}

function completeProjectRank(run, rankId, performancePoints = 0, course = COURSE) {
  const rank = course.ranks.find(item => item.id === rankId);
  const project = course.projects.find(item => item.id === rank.projectId);
  for (const chapter of project.chapters) {
    run.project(projectInput(project.id, chapter.id, `clear-${project.id}-${chapter.id}`, {}, course));
  }
  run.project(projectInput(project.id, project.boss.id, `clear-${project.id}-${project.boss.id}`, { performancePoints }, course));
}

test('the checked-in schema-v2 documents publish the V3 early curriculum and hydrate every indexed online level', () => {
  const indexOnly = sanitizeCourse(RAW_COURSE);
  assert.equal(indexOnly.publishedRevision, 3);
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

test('V3 binds the first two ranks to C17 and the third rank to the deterministic Linux terminal', () => {
  const expectedThemes = new Map([
    ['quail', ['C', '流程', '函数']],
    ['pigeon', ['C', '指针', '内存', '文件']],
    ['chicken', ['Linux', '目录', '权限', '进程']]
  ]);
  for (const [rankId, terms] of expectedThemes) {
    const rank = COURSE.ranks.find(item => item.id === rankId);
    assert.ok(rank, `缺少 ${rankId} 段位`);
    for (const term of terms) assert.match(rank.technologyTheme, new RegExp(term), `${rank.title} 技术主题应覆盖 ${term}`);
  }

  const onlineLessons = COURSE.levels.filter(level => level.kind === 'interactive-lesson');
  assert.equal(onlineLessons.length, 9);
  for (const level of onlineLessons) {
    assert.equal(level.version, 3, `${level.id} 应发布为 V3`);
    const executableSteps = level.content.steps.filter(step => step.runtimeId);
    assert.ok(executableSteps.length >= 3, `${level.id} 应保留可运行的观察、编辑和独立变式`);
    const expectedRuntime = level.rankId === 'chicken' ? 'linux-shell-sim' : 'c17-console';
    assert.ok(executableSteps.every(step => step.runtimeId === expectedRuntime), `${level.id} 运行时应为 ${expectedRuntime}`);
  }

  for (const boss of COURSE.levels.filter(level => level.kind === 'rank-boss' && EARLY_RANK_IDS.has(level.rankId))) {
    assert.equal(boss.version, 3, `${boss.id} 应发布为 V3`);
    const executableCheckpoints = boss.content.checkpoints.filter(checkpoint => checkpoint.runtimeId);
    const expectedRuntime = boss.rankId === 'chicken' ? 'linux-shell-sim' : 'c17-console';
    assert.ok(executableCheckpoints.every(checkpoint => checkpoint.runtimeId === expectedRuntime), `${boss.id} 运行时应为 ${expectedRuntime}`);
  }
});

test('V3 independent and Boss graders require implementation evidence beyond matching stdout', () => {
  const earlyLevels = COURSE.levels.filter(level => EARLY_RANK_IDS.has(level.rankId));
  let cVariants = 0;
  let linuxVariants = 0;
  let nonzeroExitCases = 0;
  let linuxFileStateGraders = 0;
  let linuxProcessStateGraders = 0;
  let linuxCommandEvidenceGraders = 0;

  for (const level of earlyLevels) {
    const executableItems = level.kind === 'rank-boss'
      ? level.content.checkpoints.filter(checkpoint => checkpoint.runtimeId)
      : level.content.steps.filter(step => step.type === 'independent-variation');
    for (const item of executableItems) {
      const graders = item.variants?.map(variant => variant.grader) || [item.grader];
      for (const grader of graders) {
        assert.ok(grader, `${level.id}/${item.id} 应声明评分器`);
        if (item.runtimeId === 'c17-console') {
          assert.ok(grader.requirements?.requiredIdentifiers?.length >= 3, `${level.id}/${item.id} 应要求关键 C 标识符`);
          if (item.variants) {
            assert.ok(grader.cases?.length >= 2, `${level.id}/${item.id} 的独立变式应使用多个输入防止固定输出蒙混`);
            cVariants++;
          }
          nonzeroExitCases += (grader.cases || []).filter(testCase => Number.isInteger(testCase.exitCode) && testCase.exitCode !== 0).length;
        } else {
          assert.ok(grader.requirements?.commands?.length > 0, `${level.id}/${item.id} 应要求实际执行 Linux 命令`);
          assert.ok(grader.requirements?.commandSequence?.length > 0, `${level.id}/${item.id} 应验证 Linux 命令顺序`);
          if (item.variants) linuxVariants++;
          const requirementSets = [grader.requirements, ...(grader.cases || []).map(testCase => testCase.requirements)].filter(Boolean);
          if (requirementSets.some(requirements => Object.keys(requirements.files || {}).length > 0)) linuxFileStateGraders++;
          if (requirementSets.some(requirements => (requirements.absentProcesses || []).length || (requirements.presentProcesses || []).length)) linuxProcessStateGraders++;
          if (requirementSets.some(requirements => (requirements.commandEvidence || []).length)) linuxCommandEvidenceGraders++;
        }
      }
    }
  }

  assert.equal(cVariants, 12);
  assert.equal(linuxVariants, 6);
  assert.equal(nonzeroExitCases, 2, '两个输入边界变式应验证非法输入的非零退出状态');
  assert.ok(linuxFileStateGraders >= 3, 'Linux 独立题和 Boss 应检查文件内容或权限状态');
  assert.ok(linuxProcessStateGraders >= 2, 'Linux 流程题和 Boss 应检查进程保留与终止状态');
  assert.ok(linuxCommandEvidenceGraders >= 7, '关键 Linux 独立题和 Boss 应验证参数、管道、重定向或可见输出来源');
});

test('the first three online ranks keep empty compatibility locations while every later project keeps real locations', () => {
  const earlyRanks = RAW_COURSE.ranks.filter(rank => EARLY_RANK_IDS.has(rank.id));
  assert.equal(earlyRanks.length, 3);
  for (const rank of earlyRanks) {
    assert.equal(Object.hasOwn(rank, 'locationIds'), true, `${rank.id} 应保留兼容字段`);
    assert.deepEqual(rank.locationIds, [], `${rank.id} 不应再绑定乐园建筑`);
    assert.equal(rank.projectId, null);
  }

  const earlyDetails = LEVEL_DOCS.filter(detail => EARLY_RANK_IDS.has(detail.rankId));
  assert.equal(earlyDetails.length, 12);
  const earlyLearnerCopy = JSON.stringify(earlyDetails.map(detail => {
    const visible = clone(detail);
    delete visible.scene;
    return visible;
  }));
  for (const term of PARK_SCENE_TERMS) {
    assert.equal(earlyLearnerCopy.includes(term), false, `前三段位学习正文不应出现乐园建筑或道具词“${term}”`);
  }

  const locations = new Set(RAW_COURSE.locations.map(location => location.id));
  const laterRanks = RAW_COURSE.ranks.filter(rank => rank.order >= 4);
  assert.equal(laterRanks.length, 6);
  for (const rank of laterRanks) {
    const project = RAW_COURSE.projects.find(item => item.id === rank.projectId);
    assert.ok(project, `${rank.id} 应绑定一个段位作品`);
    assert.ok(project.locationIds.length > 0, `${project.id} 应保留至少一个项目地点`);
    assert.ok(project.locationIds.every(locationId => locations.has(locationId)), `${project.id} 只能引用现有地点`);
  }
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

  const themedOnlineRank = clone(RAW_COURSE);
  themedOnlineRank.ranks[0].locationIds = [RAW_COURSE.locations[0].id];
  assert.throws(() => sanitizeCourse(themedOnlineRank), /在线互动段位，不能绑定作品场景/);

  const unknownBossRuntime = clone(LEVEL_DOCS);
  unknownBossRuntime.find(item => item.id === 'chicken-rules-boss').checkpoints[1].runtimeId = 'host-shell';
  assert.throws(() => sanitizeCourse(RAW_COURSE, unknownBossRuntime), /引用未知运行环境/);

  const locationlessProjectRank = clone(RAW_COURSE);
  locationlessProjectRank.ranks[3].locationIds = [];
  assert.throws(() => sanitizeCourse(locationlessProjectRank), /段位作品缺少场景/);
});

test('course validation rejects malformed runtime requirements and exit-code contracts before grading', () => {
  function invalidDetail(mutator, pattern) {
    const details = clone(LEVEL_DOCS);
    mutator(details);
    assert.throws(() => sanitizeCourse(RAW_COURSE, details), pattern);
  }

  invalidDetail(details => {
    const level = details.find(item => item.id === 'quail-fountain-sequence');
    level.steps.find(step => step.id === 'independent-variation').variants[0].grader.requirements.requiredIdentifiers = 'scanf';
  }, /C 标识符须为列表/);

  invalidDetail(details => {
    const level = details.find(item => item.id === 'quail-fountain-sequence');
    level.steps.find(step => step.id === 'independent-variation').variants[0].grader.cases[3].exitCode = -1;
  }, /退出状态须为 0–255 的整数/);

  invalidDetail(details => {
    const level = details.find(item => item.id === 'chicken-football-rounds');
    level.steps.find(step => step.id === 'independent-variation').variants[0].grader.cases[0].requirements.files = null;
  }, /文件状态须为普通对象/);

  invalidDetail(details => {
    const level = details.find(item => item.id === 'chicken-football-rounds');
    const requirements = level.steps.find(step => step.id === 'short-edit').grader.requirements;
    requirements.presentProcesses.push(requirements.absentProcesses[0]);
  }, /不能同时要求同一进程存在与消失/);

  invalidDetail(details => {
    const level = details.find(item => item.id === 'chicken-teleport-state');
    level.steps.find(step => step.id === 'independent-variation').variants[0].grader.requirements.requiredIdentifiers = ['printf'];
  }, /不适用于 Linux 练习终端/);

  invalidDetail(details => {
    const level = details.find(item => item.id === 'chicken-football-rounds');
    level.steps.find(step => step.id === 'short-edit').grader.requirements.commandEvidence[0].redirectPath = 'relative.txt';
  }, /重定向路径须为绝对路径/);

  invalidDetail(details => {
    const level = details.find(item => item.id === 'chicken-bomb-boundary');
    const requirements = level.steps.find(step => step.id === 'independent-variation').variants.find(variant => variant.grader.requirements.absentFiles).grader.requirements;
    requirements.absentFiles.push(Object.keys(requirements.files)[0]);
  }, /不能同时要求同一文件存在与不存在/);
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
  assert.equal(first.result.xpAwarded, 25);
  assert.equal(first.result.starAwarded, true);
  assert.equal(first.result.levelCompleted, true);
  assert.equal(run.progress.xp.total, 35);
  assert.equal(run.progress.current.activityId, 'quail-piano-output');
  assert.equal(run.progress.current.stepId, 'predict');

  const alternate = COURSE.levels.find(item => item.id === levelId).content.steps
    .find(item => item.type === 'independent-variation').variants[1].id;
  const repeated = run.level(levelInput(levelId, 'repeat-clear', { variantId: alternate }));
  assert.equal(repeated.result.xpAwarded, 0);
  assert.equal(repeated.result.starAwarded, false);
  assert.equal(repeated.result.levelCompleted, false);
  assert.equal(run.progress.xp.total, 35);
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
  assert.equal(recovered.result.xpAwarded, 25);
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

test('a V2 full-solution view cannot taint the same variant after the lesson is revised to V3', () => {
  const levelId = 'quail-fountain-sequence';
  const checkedInLevel = COURSE.levels.find(item => item.id === levelId);
  assert.equal(checkedInLevel.version, 3, '仓库内前三段位内容应已发布为 V3');
  const v2Draft = clone(COURSE);
  v2Draft.publishedRevision = 2;
  const v2DraftLevel = v2Draft.levels.find(item => item.id === levelId);
  v2DraftLevel.version = 2;
  v2DraftLevel.content.version = 2;
  const v2Course = sanitizeCourse(v2Draft);
  const v2Level = v2Course.levels.find(item => item.id === levelId);
  const completionStep = v2Level.content.steps.find(item => item.type === 'independent-variation');
  const variant = completionStep.variants[0];
  let progress = freshProgress(v2Course, 'learner-1');
  let clock = 1;

  const submit = (course, step, overrides = {}) => {
    const level = course.levels.find(item => item.id === levelId);
    const output = submitAttempt(course, progress, {
      requestId: `versioned-${level.version}-${clock}`,
      levelId,
      contentVersion: level.version,
      stepId: step.id,
      variantId: '',
      action: 'check',
      answer: 'versioned learner answer',
      hintLevel: 0,
      viewedFullAnswer: false,
      passed: true,
      independent: false,
      ...overrides
    }, { id: `versioned-attempt-${clock}`, submittedAt: iso(clock) });
    clock++;
    progress = output.progress;
    return output;
  };

  for (const step of v2Level.content.steps.filter(step => step.id !== completionStep.id)) submit(v2Course, step);
  submit(v2Course, completionStep, {
    variantId: variant.id,
    action: 'reveal',
    answer: '',
    hintLevel: 3,
    viewedFullAnswer: true,
    passed: false,
    independent: false
  });
  assert.equal(progress.attempts.at(-1).payload.contentVersion, 2);

  const v3Course = COURSE;
  const v3Level = v3Course.levels.find(item => item.id === levelId);
  progress = sanitizeProgress(v3Course, progress);

  assert.equal(progress.attempts.some(attempt => attempt.payload.contentVersion === 2 && attempt.payload.viewedFullAnswer), true, '历史尝试应作为不可变记录保留');
  for (const step of v3Level.content.steps.filter(step => step.id !== completionStep.id)) submit(v3Course, step);
  const cleared = submit(v3Course, v3Level.content.steps.find(step => step.id === completionStep.id), {
    variantId: variant.id,
    action: 'submit',
    independent: true
  });

  assert.equal(cleared.result.levelCompleted, true, 'V2 查看答案不应阻止 V3 的同名变式完成');
  assert.equal(cleared.result.starAwarded, true, '只有当前 contentVersion 的答案曝光才会影响星星');
});

test('a V2 Boss checkpoint cannot unlock the following checkpoint in Boss contentVersion 3', () => {
  const bossId = 'quail-opening-boss';
  const checkedInBoss = COURSE.levels.find(item => item.id === bossId);
  assert.equal(checkedInBoss.version, 3, '仓库内前三段位 Boss 应已发布为 V3');
  const v2Draft = clone(COURSE);
  v2Draft.publishedRevision = 2;
  for (const level of v2Draft.levels.filter(item => EARLY_RANK_IDS.has(item.rankId))) {
    level.version = 2;
    level.content.version = 2;
  }
  const v2Course = sanitizeCourse(v2Draft);
  const run = flow(freshProgress(v2Course, 'learner-1'), v2Course);
  for (const levelId of ['quail-fountain-sequence', 'quail-piano-output', 'quail-opening-broadcast']) {
    completeLesson(run, levelId, `boss-version-${levelId}`, v2Course);
  }
  const bossV2 = v2Course.levels.find(item => item.id === bossId);
  run.level(bossInput(bossV2.id, bossV2.content.checkpoints[0].id, 'boss-version-v2-first', { independent: false }, v2Course));

  const v3Course = COURSE;
  const bossV3 = v3Course.levels.find(item => item.id === bossId);
  const progress = sanitizeProgress(v3Course, run.progress);
  const second = bossV3.content.checkpoints[1];

  assert.throws(
    () => submitAttempt(v3Course, progress, {
      ...bossInput(bossV3.id, second.id, 'boss-version-v3-skip', { independent: false }, v3Course)
    }, { id: 'boss-version-v3-skip-attempt', submittedAt: iso(58) }),
    error => error.status === 409 && error.code === 'checkpoint_locked'
  );
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
