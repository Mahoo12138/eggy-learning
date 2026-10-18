import test from 'node:test';
import assert from 'node:assert/strict';

import {
  learnerCodeStep,
  materializeProjectState,
  sanitizeProjectCodePackage
} from '../lib/project-code-delivery.mjs';
import {
  chapterCodeReady,
  codeDeliveryMode,
  codeLanguage,
  finalSourceModel,
  guidedCodeModel,
  matchingCodePackage,
  snapshotCodeModel,
  starterProjectModel
} from '../public/assets/project-code-delivery.mjs';

function fixture() {
  const project = {
    id: 'sample-project',
    guidancePolicy: { codeDeliveryContractVersion: 1 },
    codeDelivery: {
      schemaVersion: 1,
      packageFile: 'project-code/sample-project.json',
      packageSha256: 'a'.repeat(64),
      baselineStateId: 'empty-project',
      finalStateId: 'chapter-one-done'
    },
    chapters: [{
      id: 'chapter-one',
      snapshotStateId: 'chapter-one-done',
      guidedSteps: [{ id: 'write-main', codeStepId: 'write-main-code', targetFiles: ['CMakeLists.txt', 'src/main.c'] }]
    }]
  };
  const codePackage = {
    schemaVersion: 1,
    projectId: project.id,
    states: [
      { id: 'empty-project', files: {} },
      {
        id: 'chapter-one-done',
        files: {
          'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.20)\nproject(sample C)\nadd_executable(sample src/main.c)\n',
          'src/main.c': '#include <stdio.h>\n\nint main(void) {\n  puts("ready");\n  return 0;\n}\n'
        }
      }
    ],
    steps: [{
      id: 'write-main-code',
      chapterId: 'chapter-one',
      guidedStepId: 'write-main',
      fromStateId: 'empty-project',
      toStateId: 'chapter-one-done',
      copyFiles: ['CMakeLists.txt', 'src/main.c'],
      learnerChanges: [{
        id: 'change-ready-message',
        file: 'src/main.c',
        anchor: 'puts("ready")',
        instruction: '把 ready 改成自己的启动提示。',
        expectedFragment: 'puts("my project is ready")'
      }],
      intentionalGaps: [],
      verification: {
        commands: ['cmake -S . -B build', 'cmake --build build', './build/sample'],
        expected: ['构建成功', '终端打印启动提示']
      }
    }],
    finalSource: {
      stateId: 'chapter-one-done',
      buildCommands: ['cmake -S . -B build', 'cmake --build build'],
      runCommands: ['./build/sample'],
      expected: ['进程退出码为 0']
    }
  };
  return { project, codePackage };
}

function fixtureWithResolvedGap() {
  const { project, codePackage } = fixture();
  project.chapters[0].guidedSteps.push({ id: 'finish-loop', codeStepId: 'finish-loop-code', targetFiles: ['src/main.c'] });
  project.chapters[0].snapshotStateId = 'chapter-one-finished';
  project.codeDelivery.finalStateId = 'chapter-one-finished';
  codePackage.states[1].files['src/main.c'] += '// TODO(LOOP): the next step adds the loop\n';
  codePackage.steps[0].intentionalGaps = [{
    id: 'loop-gap', file: 'src/main.c', marker: 'TODO(LOOP)',
    reason: '先看清单次执行，再在下一步加入循环。', resolvedInStepId: 'finish-loop-code'
  }];
  codePackage.states.push({
    id: 'chapter-one-finished',
    files: {
      ...codePackage.states[1].files,
      'src/main.c': '#include <stdio.h>\n\nint main(void) {\n  for (int i = 0; i < 2; ++i) puts("ready");\n  return 0;\n}\n'
    }
  });
  codePackage.steps.push({
    id: 'finish-loop-code', chapterId: 'chapter-one', guidedStepId: 'finish-loop',
    fromStateId: 'chapter-one-done', toStateId: 'chapter-one-finished', copyFiles: ['src/main.c'],
    learnerChanges: [{
      id: 'change-loop-count', file: 'src/main.c', anchor: 'i < 2',
      instruction: '把循环次数改成 3。', expectedFragment: 'i < 3'
    }],
    intentionalGaps: [],
    verification: { commands: ['cmake --build build', './build/sample'], expected: ['打印三次启动提示'] }
  });
  codePackage.finalSource.stateId = 'chapter-one-finished';
  return { project, codePackage };
}

test('complete-code package keeps a linear runnable snapshot chain and exposes copyable files', () => {
  const { project, codePackage } = fixture();
  const sanitized = sanitizeProjectCodePackage(codePackage, project);
  assert.deepEqual(materializeProjectState(sanitized, 'chapter-one-done'), codePackage.states[1].files);
  assert.deepEqual(learnerCodeStep(sanitized, 'write-main-code').files, codePackage.states[1].files);

  const guided = guidedCodeModel(sanitized, project.chapters[0].guidedSteps[0]);
  assert.deepEqual(guided.files.map(file => file.path), ['CMakeLists.txt', 'src/main.c']);
  assert.equal(guided.files[1].language, 'c');
  assert.equal(snapshotCodeModel(sanitized, 'chapter-one-done').files.length, 2);
  assert.equal(finalSourceModel(sanitized).runCommands[0], './build/sample');
  assert.equal(codeLanguage('src/controller.cpp'), 'cpp');
  assert.equal(codeLanguage('db/schema.sql'), 'sql');
  assert.equal(codeLanguage('CMakeLists.txt'), 'cmake');
  assert.equal(chapterCodeReady(sanitized, project.chapters[0], 'ready'), true);
  assert.equal(chapterCodeReady(sanitized, project.chapters[0], 'loading'), false);
  assert.equal(chapterCodeReady(null, project.chapters[0], 'error'), false);
});

test('starter-project model distinguishes a nonempty scaffold from an incremental empty baseline', () => {
  const { project, codePackage } = fixture();
  assert.equal(starterProjectModel(codePackage, project.codeDelivery.baselineStateId), null);
  assert.equal(codeDeliveryMode(codePackage, project.codeDelivery.baselineStateId), 'incremental');

  codePackage.states[0].files = structuredClone(codePackage.states[1].files);
  const starter = starterProjectModel(codePackage, project.codeDelivery.baselineStateId);
  assert.equal(codeDeliveryMode(codePackage, project.codeDelivery.baselineStateId), 'scaffold');
  assert.equal(starter.id, 'empty-project');
  assert.deepEqual(starter.files.map(file => file.path), ['CMakeLists.txt', 'src/main.c']);
  starter.files[0].content = 'changed';
  assert.match(codePackage.states[0].files['CMakeLists.txt'], /project\(sample C\)/);

  codePackage.states[1].files['src/main.c'] = codePackage.states[1].files['src/main.c'].replace('ready', 'next step');
  assert.ok(starterProjectModel(codePackage, project.codeDelivery.baselineStateId));
  assert.equal(codeDeliveryMode(codePackage, project.codeDelivery.baselineStateId), 'incremental');
});

test('complete-code package rejects hidden omissions, missing target files and broken snapshot continuity', () => {
  function invalid(mutator, pattern) {
    const { project, codePackage } = fixture();
    mutator(codePackage, project);
    assert.throws(() => sanitizeProjectCodePackage(codePackage, project), pattern);
  }

  invalid(codePackage => { codePackage.steps[0].copyFiles.pop(); }, /每个目标文件提供完整内容/);
  invalid(codePackage => { codePackage.steps[0].learnerChanges = []; }, /须包含 1/);
  invalid(codePackage => { codePackage.steps[0].fromStateId = 'chapter-one-done'; }, /前后快照不能相同|上一完整快照/);
  invalid(codePackage => { codePackage.states[1].files['src/main.c'] += '\n// TODO(PROJECT): finish later\n'; }, /未登记的省略标记|省略代码或 TODO/);
  invalid(codePackage => {
    codePackage.steps[0].intentionalGaps = [{
      id: 'missing-loop', file: 'src/main.c', marker: 'TODO(LOOP)', reason: '下一步讲循环', resolvedInStepId: 'write-main-code'
    }];
  }, /标记未出现在结果快照/);
});

test('every snapshot rejects portable path aliases and file-directory prefix conflicts', () => {
  function invalid(paths, pattern) {
    const { project, codePackage } = fixture();
    Object.assign(codePackage.states[1].files, paths);
    assert.throws(() => sanitizeProjectCodePackage(codePackage, project), pattern);
  }

  invalid({ src: 'a file cannot also be a directory\n' }, /作为文件.*目录/);
  invalid({ 'SRC/MAIN.C': 'portable duplicate\n' }, /大小写或 Unicode 归一化后冲突/);
  invalid({ 'src/café.c': 'one\n', 'src/cafe\u0301.c': 'two\n' }, /大小写或 Unicode 归一化后冲突/);
  invalid({ 'src/Ｆｏｏ.c': 'one\n', 'src/foo.c': 'two\n' }, /大小写或 Unicode 归一化后冲突/);

  const safe = fixture();
  for (const state of safe.codePackage.states) {
    state.files['src2/main.c'] = 'int separate_tree(void) { return 2; }\n';
    state.files['src-main.c'] = 'int separate_file(void) { return 1; }\n';
  }
  assert.doesNotThrow(() => sanitizeProjectCodePackage(safe.codePackage, safe.project));
});

test('source omissions are rejected while prose and validator searches are not mistaken for gaps', () => {
  for (const marker of [
    '// FIXME: connect the real implementation',
    '// TBD',
    'return NOT_IMPLEMENTED;',
    '// implementation omitted',
    '// 省略实现',
    '#error finish_this_driver'
  ]) {
    const { project, codePackage } = fixture();
    codePackage.states[1].files['src/main.c'] += `\n${marker}\n`;
    assert.throws(() => sanitizeProjectCodePackage(codePackage, project), /未登记的省略标记|未完成标记/);
  }

  const baseline = fixture();
  for (const state of baseline.codePackage.states) state.files['src/bootstrap.c'] = '// FIXME: complete startup\n';
  assert.throws(
    () => sanitizeProjectCodePackage(baseline.codePackage, baseline.project),
    /起始快照 src\/bootstrap\.c 包含未登记的省略标记/
  );

  const intermediate = fixtureWithResolvedGap();
  intermediate.codePackage.states[1].files['src/main.c'] += '// TBD\n';
  assert.throws(
    () => sanitizeProjectCodePackage(intermediate.codePackage, intermediate.project),
    /代码快照 chapter-one-done.*TBD/
  );

  const { project, codePackage } = fixture();
  const prose = '# 校验器说明\n会拒绝 FIXME、TBD、NOT_IMPLEMENTED、implementation omitted、省略实现和 #error。\n';
  const validator = "#!/bin/sh\nif grep -REn 'FIXME|TBD|NOT_IMPLEMENTED|implementation omitted|省略实现|#error' src; then exit 1; fi\n";
  const validatorRegex = 'const omissionPattern = /\\b(?:FIXME|TBD|NOT_IMPLEMENTED)\\b/g;\n';
  for (const state of codePackage.states) {
    state.files['docs/completeness.md'] = prose;
    state.files['scripts/verify.sh'] = validator;
    state.files['tools/validate-omissions.mjs'] = validatorRegex;
  }
  assert.doesNotThrow(() => sanitizeProjectCodePackage(codePackage, project));
});

test('snapshot transitions reject hidden changes and deletions while allowing an unchanged complete scaffold', () => {
  function invalid(mutator, pattern) {
    const { project, codePackage } = fixture();
    mutator(codePackage, project);
    assert.throws(() => sanitizeProjectCodePackage(codePackage, project), pattern);
  }

  invalid(codePackage => { codePackage.states[1].files['README.md'] = '# hidden change\n'; }, /未列入完整复制文件/);
  invalid(codePackage => { codePackage.states[0].files['legacy.c'] = 'int legacy;\n'; }, /不能隐式删除文件/);
  invalid((codePackage, project) => {
    project.chapters[0].guidedSteps.push({ id: 'repeat-main', codeStepId: 'repeat-main-code', targetFiles: ['src/main.c'] });
    project.chapters[0].snapshotStateId = 'chapter-one-repeated';
    project.codeDelivery.finalStateId = 'chapter-one-repeated';
    codePackage.states.push({ id: 'chapter-one-repeated', files: structuredClone(codePackage.states[1].files) });
    codePackage.steps.push({
      id: 'repeat-main-code', chapterId: 'chapter-one', guidedStepId: 'repeat-main',
      fromStateId: 'chapter-one-done', toStateId: 'chapter-one-repeated', copyFiles: ['src/main.c'],
      learnerChanges: [{ id: 'change-repeat-message', file: 'src/main.c', anchor: 'puts("ready")', instruction: '换一条提示。', expectedFragment: 'puts("repeat")' }],
      intentionalGaps: [], verification: { commands: ['./build/sample'], expected: ['提示改变'] }
    });
    codePackage.finalSource.stateId = 'chapter-one-repeated';
  }, /必须实际改变代码快照/);

  invalid((codePackage, project) => {
    codePackage.states[0].files = structuredClone(codePackage.states[1].files);
    codePackage.states[0].files['src/main.c'] = codePackage.states[0].files['src/main.c'].replace('puts("ready")', 'puts("bootstrap")');
    project.chapters[0].guidedSteps.push({ id: 'repeat-main', codeStepId: 'repeat-main-code', targetFiles: ['src/main.c'] });
    project.chapters[0].snapshotStateId = 'chapter-one-repeated';
    project.codeDelivery.finalStateId = 'chapter-one-repeated';
    codePackage.states.push({ id: 'chapter-one-repeated', files: structuredClone(codePackage.states[1].files) });
    codePackage.steps.push({
      id: 'repeat-main-code', chapterId: 'chapter-one', guidedStepId: 'repeat-main',
      fromStateId: 'chapter-one-done', toStateId: 'chapter-one-repeated', copyFiles: ['src/main.c'],
      learnerChanges: [{ id: 'change-repeat-message', file: 'src/main.c', anchor: 'puts("ready")', instruction: '换一条提示。', expectedFragment: 'puts("repeat")' }],
      intentionalGaps: [], verification: { commands: ['./build/sample'], expected: ['提示改变'] }
    });
    codePackage.finalSource.stateId = 'chapter-one-repeated';
  }, /必须实际改变代码快照/);

  const scaffold = fixture();
  scaffold.codePackage.states[0].files = structuredClone(scaffold.codePackage.states[1].files);
  assert.doesNotThrow(() => sanitizeProjectCodePackage(scaffold.codePackage, scaffold.project));
});

test('learner experiment must add non-comment content that is absent from the delivered file', () => {
  for (const [expectedFragment, pattern] of [
    ['// learner will change this later', /不能只有注释/],
    ['puts("ready")', /已经存在于交付文件/]
  ]) {
    const { project, codePackage } = fixture();
    codePackage.steps[0].learnerChanges[0].expectedFragment = expectedFragment;
    assert.throws(() => sanitizeProjectCodePackage(codePackage, project), pattern);
  }
});

test('an intentional missing block must be visible, name a later completion step, and disappear from the final source', () => {
  const { project, codePackage } = fixture();
  project.chapters[0].guidedSteps.push({ id: 'finish-loop', codeStepId: 'finish-loop-code', targetFiles: ['src/main.c'] });
  project.chapters[0].snapshotStateId = 'chapter-one-finished';
  project.codeDelivery.finalStateId = 'chapter-one-finished';
  codePackage.states[1].files['src/main.c'] += '// TODO(LOOP): the next step adds the loop\n';
  codePackage.steps[0].intentionalGaps = [{
    id: 'loop-gap',
    file: 'src/main.c',
    marker: 'TODO(LOOP)',
    reason: '先看清单次执行，再在下一步加入循环。',
    resolvedInStepId: 'finish-loop-code'
  }];
  codePackage.states.push({
    id: 'chapter-one-finished',
    files: {
      ...codePackage.states[1].files,
      'src/main.c': '#include <stdio.h>\n\nint main(void) {\n  for (int i = 0; i < 2; ++i) puts("ready");\n  return 0;\n}\n'
    }
  });
  codePackage.steps.push({
    id: 'finish-loop-code',
    chapterId: 'chapter-one',
    guidedStepId: 'finish-loop',
    fromStateId: 'chapter-one-done',
    toStateId: 'chapter-one-finished',
    copyFiles: ['src/main.c'],
    learnerChanges: [{
      id: 'change-loop-count', file: 'src/main.c', anchor: 'i < 2',
      instruction: '把循环次数改成 3。', expectedFragment: 'i < 3'
    }],
    intentionalGaps: [],
    verification: { commands: ['cmake --build build', './build/sample'], expected: ['打印三次启动提示'] }
  });
  codePackage.finalSource.stateId = 'chapter-one-finished';
  assert.doesNotThrow(() => sanitizeProjectCodePackage(codePackage, project));
});

test('intentional gaps use globally unique exact markers with one active occurrence and no substring aliases', () => {
  function invalid(mutator, pattern) {
    const { project, codePackage } = fixtureWithResolvedGap();
    mutator(codePackage, project);
    assert.throws(() => sanitizeProjectCodePackage(codePackage, project), pattern);
  }

  invalid(codePackage => { codePackage.steps[0].intentionalGaps[0].marker = 'TODO'; }, /精确的 TODO\(ID\)/);
  invalid(codePackage => { codePackage.states[1].files['src/main.c'] += '// TODO(LOOP) duplicate\n'; }, /必须恰好出现一次/);
  invalid(codePackage => { codePackage.states[1].files['src/main.c'] += '// TODO(LOOP_EXTRA)\n'; }, /未登记的省略标记/);
  invalid(codePackage => {
    codePackage.steps[0].intentionalGaps.push({
      id: 'loop-gap-copy', file: 'src/main.c', marker: 'TODO(LOOP)',
      reason: '重复标记不应被接受。', resolvedInStepId: 'finish-loop-code'
    });
  }, /刻意缺口标记重复/);
  invalid(codePackage => { codePackage.states[0].files['src/main.c'] = '// TODO(LOOP) introduced too early\n'; }, /起始快照.*未登记/);
});

test('workshop source preview accepts prose edits but rejects stale digests and changed code references', () => {
  const { project, codePackage } = fixture();
  const payload = { codePackage, packageSha256: project.codeDelivery.packageSha256 };
  project.chapters[0].title = '未保存的讲解修改';
  assert.deepEqual(matchingCodePackage(project, payload), codePackage);
  const preview = matchingCodePackage(project, payload);
  preview.states[1].files['src/main.c'] = 'changed';
  assert.notEqual(preview.states[1].files['src/main.c'], codePackage.states[1].files['src/main.c']);
  for (const mutate of [
    draft => { draft.codeDelivery.packageSha256 = 'b'.repeat(64); },
    draft => { draft.chapters[0].guidedSteps[0].targetFiles = ['src/missing.cpp']; },
    draft => { draft.chapters[0].guidedSteps[0].codeStepId = 'unknown-step'; },
    draft => { draft.chapters[0].snapshotStateId = 'empty-project'; },
    draft => { draft.chapters[0].guidedSteps[0].id = 'changed-step'; },
    draft => { draft.codeDelivery.finalStateId = 'empty-project'; }
  ]) {
    const draft = structuredClone(project); mutate(draft);
    assert.throws(() => matchingCodePackage(draft, payload), /草稿与已发布代码包不一致/);
  }
});
