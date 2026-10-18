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
  submitProjectConceptCheck,
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

function richProjectCourse() {
  const course = clone(RAW_COURSE);
  const project = course.projects.find(item => item.id === 'goose-food-street-project');
  assert.ok(project, '测试基线须包含蛋仔食堂项目');
  project.guidancePolicy = {
    mode: 'fully-guided-until-final-capstone',
    conceptLessonsPerChapter: 1,
    guidedLessonsPerChapter: 4,
    independentCheckpointPerChapter: true,
    cumulativeArtifact: true,
    chapterSnapshotRequired: true,
    fullSolutionScope: 'every-guided-step',
    learnerFreedomBoundary: 'final-capstone-only'
  };
  project.environment = {
    platform: 'Windows 11',
    languageStandard: 'C17',
    toolchain: 'MSVC or clang-cl',
    buildSystem: 'CMake',
    outputBackend: 'VT sequences',
    inputBackend: 'ReadConsoleInputW',
    requirements: ['Windows SDK', 'UTF-8 source files'],
    supportedHosts: ['Windows Terminal', 'conhost']
  };
  Object.assign(project.chapters[0], {
    phase: 'recommendation-core',
    estimatedSessions: 2,
    milestone: '一键推荐能够在固定种子下稳定运行',
    filesTouched: ['src/recommend.c', 'src/recommend.h', 'tests/test_recommend.c'],
    guidedSteps: [
      {
        id: 'define-query',
        title: '定义推荐查询',
        targetFiles: ['src/recommend.h'],
        instruction: '声明筛选条件和推荐结果，并保持接口不依赖终端层。',
        verify: '编译测试目标并确认推荐头文件可独立包含。'
      },
      {
        id: 'select-candidate',
        title: '选择候选菜品',
        targetFiles: ['src/recommend.c', 'tests/test_recommend.c'],
        instruction: '遍历菜品构建候选集，再通过注入的随机源选择一个结果。',
        verify: '固定随机序列下，空集合和单元素集合测试均通过。'
      }
    ],
    runbook: {
      buildCommands: ['cmake -S . -B build', 'cmake --build build'],
      runActions: ['ctest --test-dir build -R recommend', 'build\\eggy-canteen.exe'],
      expectedResults: ['推荐单元测试全部通过', '终端显示一个合法候选菜品']
    }
  });
  return { course, project, chapter: project.chapters[0] };
}

function guidedCompleteProjectCourse() {
  const course = clone(RAW_COURSE);
  const project = course.projects.find(item => item.id === 'goose-food-street-project');
  assert.equal(project?.guidancePolicy?.mode, 'guided-complete-build', '测试基线须包含完整引导的蛋仔食堂项目');
  return { course, project };
}

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

function projectConceptInput(projectId, chapterId, checkId, selectedOptionId, requestId, overrides = {}, course = COURSE) {
  const project = course.projects.find(item => item.id === projectId);
  return {
    requestId,
    projectId,
    contentVersion: project.version,
    chapterId,
    checkId,
    selectedOptionId,
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
    },
    concept(input) {
      const number = ++this.clock;
      const output = submitProjectConceptCheck(course, this.progress, input, { id: `concept-attempt-${number}`, submittedAt: iso(number) });
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
  assert.equal(indexOnly.publishedRevision, 5);
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

test('三层提示与完整答案分别保存，第四层占位提示不能进入课程数据', () => {
  const lesson = COURSE.levels.find(level => level.id === 'quail-fountain-sequence').content;
  const independent = lesson.steps.find(step => step.type === 'independent-variation');
  assert.deepEqual(independent.hints.map(hint => hint.tier), [1, 2, 3]);
  assert.equal(independent.fullSolutionPolicy.availableAfterTier, 3);
  for (const variant of independent.variants) {
    assert.match(variant.fullSolution, /int main\(void\)/);
  }

  const malformed = clone(LEVEL_DOCS);
  const step = malformed.find(level => level.id === lesson.id).steps.find(step => step.id === independent.id);
  step.hints.push({ tier: 4, kind: 'full-code', text: '第四层将显示当前变式的完整 C 代码。' });
  assert.throws(() => sanitizeCourse(RAW_COURSE, malformed), /提示阶梯须为列表且不超过 3 项/);
  step.hints.pop();
  assert.doesNotThrow(() => sanitizeCourse(RAW_COURSE, malformed));
});

test('project validation accepts a complete guided curriculum while preserving legacy project documents', () => {
  const { course: richDraft, project: richInput, chapter: richChapterInput } = richProjectCourse();
  const richCourse = sanitizeCourse(richDraft);
  const richProject = richCourse.projects.find(item => item.id === richInput.id);
  const richChapter = richProject.chapters.find(item => item.id === richChapterInput.id);

  assert.deepEqual(richProject.guidancePolicy, richInput.guidancePolicy);
  assert.deepEqual(richProject.environment, richInput.environment);
  assert.equal(richChapter.phase, 'recommendation-core');
  assert.equal(richChapter.estimatedSessions, 2);
  assert.equal(richChapter.milestone, '一键推荐能够在固定种子下稳定运行');
  assert.deepEqual(richChapter.filesTouched, ['src/recommend.c', 'src/recommend.h', 'tests/test_recommend.c']);
  assert.deepEqual(richChapter.guidedSteps, richChapterInput.guidedSteps);
  assert.deepEqual(richChapter.runbook, richChapterInput.runbook);

  const legacyDraft = clone(richDraft);
  const legacyProject = legacyDraft.projects.find(item => item.id === richInput.id);
  delete legacyProject.guidancePolicy;
  delete legacyProject.environment;
  for (const chapter of legacyProject.chapters) {
    delete chapter.phase;
    delete chapter.estimatedSessions;
    delete chapter.milestone;
    delete chapter.filesTouched;
    delete chapter.guidedSteps;
    delete chapter.runbook;
  }
  const legacyCourse = sanitizeCourse(legacyDraft);
  const sanitizedLegacy = legacyCourse.projects.find(item => item.id === richInput.id);
  assert.equal(Object.hasOwn(sanitizedLegacy, 'guidancePolicy'), false);
  assert.equal(Object.hasOwn(sanitizedLegacy, 'environment'), false);
  assert.equal(Object.hasOwn(sanitizedLegacy.chapters[0], 'guidedSteps'), false);
  assert.equal(Object.hasOwn(sanitizedLegacy.chapters[0], 'runbook'), false);
});

test('project validation rejects incomplete policies, malformed guided steps, and invalid runbooks', () => {
  function invalid(mutator, pattern) {
    const fixture = richProjectCourse();
    mutator(fixture);
    assert.throws(() => sanitizeCourse(fixture.course), pattern);
  }

  invalid(({ project }) => {
    delete project.guidancePolicy.learnerFreedomBoundary;
  }, /字段缺失或包含未知字段/);

  invalid(({ project }) => {
    project.environment.unknown = true;
  }, /字段缺失或包含未知字段/);

  invalid(({ chapter }) => {
    chapter.guidedSteps[0].instruction = '   ';
  }, /须为非空文本/);

  invalid(({ chapter }) => {
    chapter.guidedSteps[0].targetFiles = 'src/recommend.h';
  }, /须为列表/);

  invalid(({ chapter }) => {
    chapter.guidedSteps[1].id = chapter.guidedSteps[0].id;
  }, /重复/);

  invalid(({ chapter }) => {
    delete chapter.guidedSteps[0].verify;
  }, /字段缺失或包含未知字段/);

  invalid(({ chapter }) => {
    chapter.runbook.buildCommands = [];
  }, /不能为空/);

  invalid(({ chapter }) => {
    chapter.runbook.runActions = ['   '];
  }, /须为非空文本/);

  invalid(({ chapter }) => {
    chapter.runbook.extra = [];
  }, /字段缺失或包含未知字段/);
});

test('guided complete-build projects keep lesson counts and session totals consistent', () => {
  function invalid(mutator, pattern) {
    const fixture = guidedCompleteProjectCourse();
    mutator(fixture.project);
    assert.throws(() => sanitizeCourse(fixture.course), pattern);
  }

  invalid(project => {
    project.chapters[0].guidedSteps.pop();
  }, /引导步骤数与课程策略不一致/);

  invalid(project => {
    project.chapters[0].estimatedSessions = project.guidancePolicy.guidedLessonsPerChapter;
  }, /未给概念理解和独立检查预留课时/);

  invalid(project => {
    project.estimatedSessions.minimum += 1;
  }, /预计场次必须覆盖全部章节场次/);
});

test('code delivery contract is opt-in and requires every chapter and guided step to reference an external snapshot package', () => {
  function contractedFixture() {
    const fixture = guidedCompleteProjectCourse();
    fixture.project.guidancePolicy.codeDeliveryContractVersion = 1;
    fixture.project.codeDelivery = {
      schemaVersion: 1,
      packageFile: `${'project-code'}/${fixture.project.id}.json`,
      packageSha256: 'a'.repeat(64),
      baselineStateId: 'project-start',
      finalStateId: 'project-final'
    };
    for (const [chapterIndex, chapter] of fixture.project.chapters.entries()) {
      chapter.snapshotStateId = `chapter-${chapterIndex + 1}-snapshot`;
      for (const [stepIndex, step] of chapter.guidedSteps.entries()) step.codeStepId = `code-${chapterIndex + 1}-${stepIndex + 1}`;
    }
    return fixture;
  }

  const accepted = contractedFixture();
  const sanitized = sanitizeCourse(accepted.course).projects.find(project => project.id === accepted.project.id);
  assert.equal(sanitized.guidancePolicy.codeDeliveryContractVersion, 1);
  assert.equal(sanitized.chapters[0].guidedSteps[0].codeStepId, 'code-1-1');
  assert.equal(sanitized.chapters[0].snapshotStateId, 'chapter-1-snapshot');

  const legacy = guidedCompleteProjectCourse();
  assert.doesNotThrow(() => sanitizeCourse(legacy.course), '未迁移的旧作品仍须可读取');

  for (const keepReference of ['snapshotStateId', 'codeStepId']) {
    const orphanedReferences = contractedFixture();
    delete orphanedReferences.project.codeDelivery;
    delete orphanedReferences.project.guidancePolicy.codeDeliveryContractVersion;
    if (keepReference === 'snapshotStateId') {
      for (const chapter of orphanedReferences.project.chapters) {
        for (const step of chapter.guidedSteps) delete step.codeStepId;
      }
    } else {
      for (const chapter of orphanedReferences.project.chapters) delete chapter.snapshotStateId;
    }
    assert.throws(
      () => sanitizeCourse(orphanedReferences.course),
      /代码快照或代码步骤引用时必须显式启用代码交付合同版本/,
      `${keepReference} 单独存在时也不能脱离代码交付合同`
    );
  }

  const uncontractedPackage = contractedFixture();
  delete uncontractedPackage.project.guidancePolicy.codeDeliveryContractVersion;
  for (const chapter of uncontractedPackage.project.chapters) {
    delete chapter.snapshotStateId;
    for (const step of chapter.guidedSteps) delete step.codeStepId;
  }
  assert.throws(
    () => sanitizeCourse(uncontractedPackage.course),
    /作品提供代码包时必须显式启用代码交付合同版本/
  );

  for (const [mutator, pattern] of [
    [fixture => delete fixture.project.codeDelivery, /必须提供外置代码包/],
    [fixture => delete fixture.project.chapters[0].snapshotStateId, /缺少章末完整快照编号/],
    [fixture => delete fixture.project.chapters[0].guidedSteps[0].codeStepId, /缺少代码包步骤编号/],
    [fixture => { fixture.project.codeDelivery.packageFile = 'levels/source.json'; }, /必须位于 data\/project-code/],
    [fixture => { fixture.project.codeDelivery.packageSha256 = 'not-a-digest'; }, /小写 SHA-256/],
    [fixture => { fixture.project.guidancePolicy.codeDeliveryContractVersion = 2; }, /合同版本无效/]
  ]) {
    const fixture = contractedFixture();
    mutator(fixture);
    assert.throws(() => sanitizeCourse(fixture.course), pattern);
  }
});

test('蛋仔食堂的 15 章都先解释概念，再进入三个代码步骤和独立检查', () => {
  const project = COURSE.projects.find(item => item.id === 'goose-food-street-project');
  assert.equal(project.version, 3);
  assert.deepEqual(project.estimatedSessions, { minimum: 75, typical: 79 });
  assert.equal(project.guidancePolicy.conceptLessonsPerChapter, 1);
  assert.equal(project.guidancePolicy.guidedLessonsPerChapter, 3);
  assert.equal(project.chapters.length, 15);

  for (const chapter of project.chapters) {
    assert.equal(chapter.estimatedSessions, 5, `${chapter.id} 应有概念、三段代码和独立检查共 5 课时`);
    assert.ok(chapter.conceptModule, `${chapter.id} 应有概念理解模块`);
    assert.equal(chapter.conceptModule.checks.length >= 2, true, `${chapter.id} 至少应有两道理解题`);
    assert.equal(chapter.guidedSteps.length, 3, `${chapter.id} 应有三个代码引导步骤`);
    const explained = new Set(chapter.conceptModule.terms.map(item => item.term));
    assert.equal(chapter.concepts.every(term => explained.has(term)), true, `${chapter.id} 的概念标签都应有白话解释`);
  }

  const frameChapter = project.chapters.find(item => item.id === 'frame-buffer');
  for (const term of ['Frame', 'Cell', 'VT 帧编码']) {
    const explanation = frameChapter.conceptModule.terms.find(item => item.term === term);
    assert.ok(explanation, `Frame 章节应解释 ${term}`);
    assert.ok(explanation.plainMeaning.trim());
    assert.ok(explanation.codeMapping.trim());
  }
});



test('完整引导课程拒绝缺失、未覆盖或不可判定的概念模块', () => {
  function invalid(mutator, pattern) {
    const fixture = guidedCompleteProjectCourse();
    mutator(fixture.project.chapters[0]);
    assert.throws(() => sanitizeCourse(fixture.course), pattern);
  }

  invalid(chapter => {
    delete chapter.conceptModule;
  }, /缺少代码教学字段/);

  invalid(chapter => {
    const requiredTerm = chapter.concepts[0];
    chapter.conceptModule.terms = chapter.conceptModule.terms.filter(item => item.term !== requiredTerm);
  }, /概念缺少白话解释/);

  invalid(chapter => {
    chapter.conceptModule.checks[0].correctOptionId = 'missing-option';
  }, /正确选项不存在/);

  invalid(chapter => {
    chapter.conceptModule.checks[0].options[1].id = chapter.conceptModule.checks[0].options[0].id;
  }, /概念理解题选项编号重复/);
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

  const conceptMirror = clone(LEVEL_DOCS);
  conceptMirror.find(item => item.id === 'goose-food-street-project').chapters[0].conceptModule.checks[0].question = 'changed question';
  assert.throws(() => sanitizeCourse(RAW_COURSE, conceptMirror), /作品镜像与课程索引不一致/);

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
    variantId: firstVariant.id, action: 'reveal', answer: '', hintLevel: 3, viewedFullAnswer: true, passed: false, independent: false
  }));
  assert.equal(run.progress.current.activityId, levelId);
  assert.equal(run.progress.current.stepId, variationStep.id);
  assert.equal(run.progress.attempts.at(-1).result.levelCompleted, false);
  assert.equal(run.progress.xp.total, 10);

  const exposed = run.level(levelInput(levelId, 'clear-exposed', { variantId: firstVariant.id }));
  assert.equal(exposed.result.levelCompleted, true);
  assert.equal(exposed.result.starAwarded, false);
  assert.equal(exposed.result.xpAwarded, 25);
  assert.equal(run.progress.current.activityId, 'quail-piano-output');
  assert.equal(run.progress.current.stepId, 'predict');
  assert.equal(run.progress.awardLedger.some(item => item.kind === 'star'), false);

  const recovered = run.level(levelInput(levelId, 'clear-replacement', { variantId: replacement.id }));
  assert.equal(recovered.result.levelCompleted, false, '已完成章节的独立复验只补星，不重复完成');
  assert.equal(recovered.result.starAwarded, true);
  assert.equal(recovered.result.xpAwarded, 0);
  assert.equal(run.progress.current.activityId, 'quail-piano-output');
  assert.equal(run.progress.awardLedger.find(item => item.kind === 'star').sourceId, replacement.id);
});

test('引导修改查看思路不需要变式编号，但独立变式的答案记录仍须编号', () => {
  const run = flow();
  const levelId = 'quail-fountain-sequence';
  const steps = COURSE.levels.find(level => level.id === levelId).content.steps;
  for (const step of steps.slice(0, 3)) {
    run.level(levelInput(levelId, `guided-prior-${step.id}`, { stepId: step.id, variantId: '', independent: false }));
  }
  const input = levelInput(levelId, 'guided-after-solution', {
    stepId: 'short-edit', variantId: '', hintLevel: 3, viewedFullAnswer: true, independent: false
  });
  const result = run.level(input);
  assert.equal(result.progress.current.stepId, 'independent-variation');
  assert.equal(result.progress.attempts.at(-1).payload.viewedFullAnswer, true);
  assert.equal(result.result.starAwarded, false);
  assert.doesNotThrow(() => sanitizeProgress(COURSE, clone(result.progress)));
  assert.throws(() => run.level({ ...input, requestId: 'independent-missing-variant', stepId: 'independent-variation' }), /须记录变式编号/);
});

test('全部变式看过答案后，练习通过仍推进章节，重放和刷新不刷经验或星星', () => {
  const levelId = 'quail-fountain-sequence';
  const step = COURSE.levels.find(level => level.id === levelId).content.steps.find(step => step.type === 'independent-variation');
  const run = flow();
  playToIndependentVariation(run, levelId, 'assisted-progress');
  for (const variant of step.variants) {
    const reveal = run.level(levelInput(levelId, `reveal-${variant.id}`, {
      action: 'reveal', variantId: variant.id, answer: '', hintLevel: 3,
      viewedFullAnswer: true, passed: false, independent: false
    }));
    assert.equal(reveal.result.levelCompleted, false);
  }
  const payload = levelInput(levelId, 'assisted-clear', {
    variantId: step.variants.at(-1).id, hintLevel: 3, viewedFullAnswer: true, independent: false
  });
  const failed = run.level({ ...payload, requestId: 'assisted-failed', passed: false });
  assert.equal(failed.result.levelCompleted, false);
  const passed = run.level(payload);
  assert.equal(passed.result.levelCompleted, true);
  assert.equal(passed.result.starAwarded, false);
  assert.equal(passed.result.xpAwarded, 25);
  assert.equal(run.progress.current.activityId, 'quail-piano-output');
  assert.equal(run.progress.rankStates.find(rank => rank.rankId === 'quail').bossStatus, 'not-started');
  const reloaded = flow(sanitizeProgress(COURSE, clone(run.progress)));
  const replay = reloaded.level(payload);
  assert.equal(replay.result.replayed, true);
  const repeated = submitAttempt(COURSE, reloaded.progress, { ...payload, requestId: 'assisted-repeated' }, {
    id: 'assisted-repeat-after-reload', submittedAt: iso(30)
  });
  assert.equal(repeated.result.levelCompleted, false);
  assert.equal(repeated.result.xpAwarded, 0);
  assert.equal(repeated.result.starAwarded, false);
  assert.equal(reloaded.progress.current.activityId, 'quail-piano-output');
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
  assert.equal(run.progress.rankStates.find(item => item.rankId === 'goose').earnedStars, project.chapters.length);
  assert.equal(run.progress.current.stepId, project.boss.id);

  const assistedBoss = run.project(projectInput(project.id, project.boss.id, 'assisted-project-boss', { independent: false }));
  assert.equal(assistedBoss.result.checkpointCompleted, false);
  assert.equal(run.progress.current.rankId, 'goose');

  const promoted = run.project(projectInput(project.id, project.boss.id, 'independent-project-boss'));
  assert.equal(promoted.result.rankPromoted, 'ostrich');
  assert.equal(promoted.result.tokenAwarded, 'trophy-food-street-sign');
  assert.equal(run.progress.current.rankId, 'ostrich');
});

test('概念理解由服务端判题并留痕，但不发奖励、不完成章节或越过章节顺序', () => {
  const run = flow();
  for (const rankId of ['quail', 'pigeon', 'chicken']) completeOnlineRank(run, rankId);
  assert.equal(run.progress.current.rankId, 'goose');

  const project = COURSE.projects.find(item => item.id === 'goose-food-street-project');
  const chapter = project.chapters[0];
  const check = chapter.conceptModule.checks[0];
  const wrongOption = check.options.find(item => item.id !== check.correctOptionId);
  const before = clone(run.progress);

  const wrongInput = projectConceptInput(project.id, chapter.id, check.id, wrongOption.id, 'concept-wrong');
  const wrong = run.concept(wrongInput);
  assert.equal(wrong.result.passed, false);
  assert.equal(wrong.feedback.explanation, check.explanation);
  assert.equal(run.progress.conceptAttempts.length, 1);
  assert.equal(run.progress.revision, before.revision + 1);
  assert.deepEqual(run.progress.xp, before.xp);
  assert.deepEqual(run.progress.awardLedger, before.awardLedger);
  assert.deepEqual(run.progress.projectArtifacts, before.projectArtifacts);
  assert.deepEqual(run.progress.current, before.current);

  const correctInput = projectConceptInput(project.id, chapter.id, check.id, check.correctOptionId, 'concept-correct');
  const correct = run.concept(correctInput);
  assert.equal(correct.result.passed, true);
  assert.equal(run.progress.conceptAttempts.length, 2);
  assert.deepEqual(run.progress.xp, before.xp);
  assert.deepEqual(run.progress.awardLedger, before.awardLedger);
  assert.deepEqual(run.progress.projectArtifacts, before.projectArtifacts);

  const replay = submitProjectConceptCheck(COURSE, run.progress, correctInput, {
    id: 'unused-on-idempotent-replay',
    submittedAt: iso(++run.clock)
  });
  assert.equal(replay.result.replayed, true);
  assert.equal(replay.progress.revision, run.progress.revision);
  assert.equal(replay.progress.conceptAttempts.length, 2);

  assert.throws(
    () => submitProjectConceptCheck(COURSE, run.progress, {
      ...correctInput,
      requestId: 'concept-unknown-option',
      selectedOptionId: 'unknown-option'
    }, { id: 'concept-unknown-option-attempt', submittedAt: iso(++run.clock) }),
    error => error.status === 400 && error.code === 'concept_option_not_found'
  );

  assert.throws(
    () => submitProjectConceptCheck(COURSE, run.progress, {
      ...correctInput,
      requestId: 'concept-wrong-version',
      contentVersion: project.version - 1
    }, { id: 'concept-wrong-version-attempt', submittedAt: iso(++run.clock) }),
    error => error.status === 409 && error.code === 'content_version_conflict'
  );

  const nextChapter = project.chapters[1];
  const nextCheck = nextChapter.conceptModule.checks[0];
  assert.throws(
    () => submitProjectConceptCheck(COURSE, run.progress, projectConceptInput(
      project.id,
      nextChapter.id,
      nextCheck.id,
      nextCheck.correctOptionId,
      'concept-next-chapter'
    ), { id: 'concept-next-chapter-attempt', submittedAt: iso(++run.clock) }),
    error => error.status === 409 && error.code === 'checkpoint_locked'
  );

  const forged = clone(run.progress);
  forged.conceptAttempts[0].result.passed = true;
  assert.throws(() => sanitizeProgress(COURSE, forged), /概念理解尝试题目、选项或判定/);
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
