import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishProjectCode, prepareSnapshotProject } from '../lib/project-code-publisher.mjs';
import { PROJECT_CODE_MAX_PACKAGE_BYTES, sanitizeProjectCodePackage } from '../lib/project-code-delivery.mjs';
import { Store, acquireLock, encode } from '../lib/store.mjs';
import { sanitizeCourse, sanitizeProgress, sanitizeWeekCard, freshProgress, freshWeekCard } from '../shared/park-domain.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PROJECT_ID = 'peak-delivery-center-project';
const PACKAGE_PATH = `data/project-code/${PROJECT_ID}.json`;
const DETAIL_PATH = `data/levels/${PROJECT_ID}.json`;
const exec = promisify(execFile);
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const sourcePackage = await readJSON(join(REPO, PACKAGE_PATH));
const sourceManifest = await readJSON(join(REPO, 'courseware/peak-delivery-center/manifest.json'));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eggy-source-publisher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(REPO, 'data'), join(root, 'data'), { recursive: true });
  // Opaque learner files must survive publication byte for byte, not be regenerated.
  await writeFile(join(root, 'data/publisher-preserve.txt'), 'learner state is not a publishing input\n');
  const build = ({ project }) => ({ project, codePackage: structuredClone(sourcePackage) });
  return { root, build, publish: options => publishProjectCode({ root, projectId: PROJECT_ID, build, ...options }) };
}

async function treeHashes(directory) {
  const files = {};
  async function visit(relative = '') {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path);
      else files[path] = digest(await readFile(join(directory, path)));
    }
  }
  await visit();
  return files;
}

async function assertValidPublication(root, projectId = PROJECT_ID) {
  const course = await readJSON(join(root, 'data/course.json'));
  const details = await Promise.all([...course.levels, ...course.projects].map(item => readJSON(join(root, 'data', item.file))));
  sanitizeCourse(course, details);
  const project = course.projects.find(item => item.id === projectId);
  assert.deepEqual(project, await readJSON(join(root, `data/${project.file}`)));
  const bytes = await readFile(join(root, `data/${project.codeDelivery.packageFile}`));
  assert.equal(digest(bytes), project.codeDelivery.packageSha256);
  sanitizeProjectCodePackage(JSON.parse(bytes), project);
  return { course, project };
}

async function assertNoSwapArtifacts(root) {
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.data-')), []);
  assert.equal((await readdir(join(root, '.local'))).includes('server.lock'), false);
}

test('publication saves source, detail and index together, preserves learner files and is an exact no-op on repeat', async t => {
  const { root, publish } = await fixture(t);
  const before = await treeHashes(join(root, 'data'));
  const courseBefore = await readJSON(join(root, 'data/course.json'));
  const nextPackage = structuredClone(sourcePackage);
  nextPackage.finalSource.expected.push('发布器回归验证：保留学习记录。');
  const build = ({ project }) => ({ project, codePackage: nextPackage });
  const first = await publish({ build });
  assert.equal(first.written, true);
  assert.equal(first.publishedRevision, courseBefore.publishedRevision + 1);
  const { course, project } = await assertValidPublication(root);
  assert.notEqual(project.codeDelivery.packageSha256, courseBefore.projects.find(item => item.id === PROJECT_ID).codeDelivery.packageSha256);
  // No implicit editorial synchronization between rank and project themes.
  assert.deepEqual(course.ranks, courseBefore.ranks);
  const after = await treeHashes(join(root, 'data'));
  for (const [path, hash] of Object.entries(before)) {
    if (!['course.json', DETAIL_PATH.slice(5), PACKAGE_PATH.slice(5)].includes(path)) assert.equal(after[path], hash, path);
  }
  const directoryBefore = await stat(join(root, 'data'));
  const again = await publish({ build });
  assert.equal(again.written, false);
  assert.equal(again.changed, false);
  assert.equal(again.publishedRevision, first.publishedRevision);
  assert.deepEqual(await treeHashes(join(root, 'data')), after);
  const directoryAfter = await stat(join(root, 'data'));
  assert.equal(directoryAfter.ino, directoryBefore.ino);
  assert.equal(directoryAfter.mtimeMs, directoryBefore.mtimeMs);
  await assertNoSwapArtifacts(root);
});

test('an unchanged contract repairs a missing or corrupt target package without increasing content revision', async t => {
  const { root, publish } = await fixture(t);
  const initial = await publish();
  const expected = await readFile(join(root, PACKAGE_PATH));
  for (const fault of ['missing', 'corrupt']) {
    if (fault === 'missing') await rm(join(root, PACKAGE_PATH));
    else await writeFile(join(root, PACKAGE_PATH), '{broken');
    const result = await publish();
    assert.equal(result.written, true);
    assert.equal(result.publishedRevision, initial.publishedRevision);
    assert.deepEqual(await readFile(join(root, PACKAGE_PATH)), expected);
    await assertValidPublication(root);
  }
});

test('check validates candidates without writing or taking the live server lock', async t => {
  const { root, publish } = await fixture(t);
  const before = await treeHashes(root);
  const checked = await publish({ check: true });
  assert.equal(checked.written, false);
  assert.deepEqual(await treeHashes(root), before); // No .local/ or lock file created.
  assert.equal((await readdir(root)).includes('.local'), false);
  const release = await acquireLock(root);
  try {
    const locked = await treeHashes(root);
    const build = ({ project }) => {
      project.story += '\n只在候选中出现。';
      return { project, codePackage: structuredClone(sourcePackage) };
    };
    const check = await publish({ check: true, build });
    assert.equal(check.changed, true);
    assert.equal(check.written, false);
    assert.deepEqual(await treeHashes(root), locked);
    await assert.rejects(publish({ build }), /已有运行进程/);
    assert.deepEqual(await treeHashes(root), locked);
  } finally { await release(); }
});

test('invalid identity, mirror, whole-course reference and code contracts cannot partially publish', async t => {
  const { root, publish } = await fixture(t);
  const original = await treeHashes(join(root, 'data'));
  for (const mutate of [
    project => { project.id = 'other-project'; },
    project => { project.rankId = 'other-rank'; },
    project => { project.file = 'levels/other-project.json'; },
    project => { project.codeDelivery.packageFile = 'project-code/other-project.json'; },
    project => { project.locationIds = ['missing-location']; }
  ]) {
    await assert.rejects(publish({ build: ({ project }) => {
      mutate(project);
      return { project, codePackage: structuredClone(sourcePackage) };
    } }), /身份|引用无效/);
    assert.deepEqual(await treeHashes(join(root, 'data')), original);
  }
  await assert.rejects(publish({ build: ({ project }) => {
    const codePackage = structuredClone(sourcePackage);
    codePackage.steps[0].copyFiles.pop();
    return { project, codePackage };
  } }), /完整内容|目标文件/);
  assert.deepEqual(await treeHashes(join(root, 'data')), original);
  // An unrelated detail must not be silently normalized or hidden by replacing the target.
  const course = await readJSON(join(root, 'data/course.json'));
  const other = course.projects.find(project => project.id !== PROJECT_ID);
  const path = join(root, 'data', other.file);
  const bytes = await readFile(path);
  const wrongMirror = JSON.parse(bytes);
  wrongMirror.title += ' drift';
  await writeFile(path, encode(wrongMirror));
  const drifted = await treeHashes(join(root, 'data'));
  await assert.rejects(publish(), /镜像与课程索引不一致/);
  assert.deepEqual(await treeHashes(join(root, 'data')), drifted);
  wrongMirror.id = PROJECT_ID;
  await writeFile(path, encode(wrongMirror));
  await assert.rejects(publish(), /镜像身份不一致/);
  await writeFile(path, bytes);
  await assertNoSwapArtifacts(root);
});

test('publication refuses version rollback and same-version answer drift while accepting a compatible newer course', async t => {
  const { root, publish } = await fixture(t);
  const course = await readJSON(join(root, 'data/course.json'));
  const current = course.projects.find(project => project.id === PROJECT_ID);
  const progress = freshProgress(course);
  progress.projectArtifacts.push({
    projectId: PROJECT_ID, rankId: current.rankId, contentVersion: current.version,
    completedChapterIds: [], bossCompletedAt: null, bossAttemptId: ''
  });
  const chapter = current.chapters[0];
  const check = chapter.conceptModule.checks[0];
  progress.conceptAttempts.push({
    id: 'saved-concept-attempt', submittedAt: '2026-10-18T00:00:00Z',
    payload: { requestId: 'saved-concept-request', projectId: PROJECT_ID, contentVersion: current.version,
      chapterId: chapter.id, checkId: check.id, selectedOptionId: check.correctOptionId },
    result: { passed: true }
  });
  progress.revision++;
  sanitizeProgress(course, progress);
  await writeFile(join(root, 'data/progress.json'), encode(progress));
  const before = await treeHashes(join(root, 'data'));
  await assert.rejects(publish({ build: ({ project }) => {
    project.version--;
    return { project, codePackage: structuredClone(sourcePackage) };
  } }), /版本不能回退/);
  const changedAnswer = ({ project }) => {
    const nextCheck = project.chapters[0].conceptModule.checks[0];
    nextCheck.correctOptionId = nextCheck.options.find(option => option.id !== nextCheck.correctOptionId).id;
    return { project, codePackage: structuredClone(sourcePackage) };
  };
  await assert.rejects(publish({ build: changedAnswer }), /概念理解尝试题目、选项或判定/);
  assert.deepEqual(await treeHashes(join(root, 'data')), before);
  const result = await publish({ build: input => {
    const candidate = changedAnswer(input);
    candidate.project.version++;
    return candidate;
  } });
  assert.equal(result.written, true);
  assert.equal((await treeHashes(join(root, 'data')))['progress.json'], before['progress.json']);
  const nextCourse = (await assertValidPublication(root)).course;
  sanitizeProgress(nextCourse, await readJSON(join(root, 'data/progress.json')));
});

test('a new source contract cannot orphan the saved weekly project checkpoint', async t => {
  const { root, publish } = await fixture(t);
  const course = await readJSON(join(root, 'data/course.json'));
  const chapterId = course.projects.find(project => project.id === PROJECT_ID).chapters[0].id;
  const card = freshWeekCard(course);
  card.weeks.push({ weekStart: '2026-10-19', mode: 'active', playDays: 3,
    mainGoal: { kind: 'project-checkpoint', projectId: PROJECT_ID, id: chapterId },
    shortLevelId: '', note: '', updatedAt: '2026-10-18T00:00:00Z' });
  sanitizeWeekCard(course, card);
  await writeFile(join(root, 'data/week-card.json'), encode(card));
  const before = await treeHashes(join(root, 'data'));
  await assert.rejects(publish({ build: ({ project }) => {
    project.version++;
    project.chapters[0].id = 'renamed-chapter';
    const codePackage = structuredClone(sourcePackage);
    for (const step of codePackage.steps) if (step.chapterId === chapterId) step.chapterId = 'renamed-chapter';
    return { project, codePackage };
  } }), /主目标引用未知作品检查点/);
  assert.deepEqual(await treeHashes(join(root, 'data')), before);
});

test('encoded package size, rather than compact JSON size, must fit the reader limit', async t => {
  const { root, publish } = await fixture(t);
  const codePackage = structuredClone(sourcePackage);
  // The padding is present from the baseline, so no step hides a file change.
  for (const state of codePackage.states) {
    state.files['padding-a.txt'] = '';
    state.files['padding-b.txt'] = '';
  }
  const compactOverhead = Buffer.byteLength(JSON.stringify(codePackage));
  const paddingSize = Math.floor((PROJECT_CODE_MAX_PACKAGE_BYTES - compactOverhead - 32) / (codePackage.states.length * 2));
  assert.ok(paddingSize < 500_000);
  for (const state of codePackage.states) {
    state.files['padding-a.txt'] = 'x'.repeat(paddingSize);
    state.files['padding-b.txt'] = 'y'.repeat(paddingSize);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(codePackage)) <= PROJECT_CODE_MAX_PACKAGE_BYTES);
  assert.ok(Buffer.byteLength(encode(codePackage)) > PROJECT_CODE_MAX_PACKAGE_BYTES);
  const before = await treeHashes(join(root, 'data'));
  await assert.rejects(publish({ build: ({ project }) => ({ project, codePackage }) }), /序列化后的代码包超过/);
  assert.deepEqual(await treeHashes(join(root, 'data')), before);
});

test('manual edits during assembly invalidate both write and check snapshots', async t => {
  const { root, publish } = await fixture(t);
  for (const check of [false, true]) {
    for (const relative of ['data/course.json', DETAIL_PATH, 'data/progress.json', 'data/week-card.json']) {
      const path = join(root, relative);
      const bytes = await readFile(path, 'utf8');
      const changedBytes = bytes + '\n';
      const originalPackage = await readFile(join(root, PACKAGE_PATH));
      await assert.rejects(publish({ check, build: async ({ project }) => {
        project.story += '\n不应覆盖外部编辑。';
        await writeFile(path, changedBytes);
        return { project, codePackage: structuredClone(sourcePackage) };
      } }), /校验期间发生变化/);
      assert.equal(await readFile(path, 'utf8'), changedBytes);
      assert.deepEqual(await readFile(join(root, PACKAGE_PATH)), originalPackage);
      await writeFile(path, bytes);
    }
  }
  await assertNoSwapArtifacts(root);
});

test('two publishers cannot assemble and overwrite from the same old course concurrently', async t => {
  const { root, publish } = await fixture(t);
  let unblock, entered;
  const gate = new Promise(resolve => { unblock = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const first = publish({ build: async ({ project }) => {
    entered();
    await gate;
    project.story += '\n第一位发布者。';
    return { project, codePackage: structuredClone(sourcePackage) };
  } });
  await started;
  try {
    await assert.rejects(publish(), /已有运行进程/);
  } finally { unblock(); }
  assert.equal((await first).written, true);
  assert.match((await assertValidPublication(root)).project.story, /第一位发布者/);
  await assertNoSwapArtifacts(root);
});

test('real Store failures before staged writes finish and after backup rename roll back every file', async t => {
  const { root, publish } = await fixture(t);
  for (const fault of [
    { beforeRename({ relative }) { if (relative === DETAIL_PATH) throw new Error('injected staged mirror failure'); } },
    { afterBackupRename() { throw new Error('injected swap failure'); } }
  ]) {
    const before = await treeHashes(join(root, 'data'));
    await assert.rejects(publish({ store: new Store(root, fault), build: ({ project }) => {
      project.story += '\n必须回滚。';
      return { project, codePackage: structuredClone(sourcePackage) };
    } }), /injected/);
    assert.deepEqual(await treeHashes(join(root, 'data')), before);
    await assertNoSwapArtifacts(root);
    await assertValidPublication(root);
  }
  await assert.rejects(publish({ store: new Store(join(root, 'another-root')) }), /同一个数据目录/);
});

test('manifest assembly rejects chapter reordering, step identity drift and incomplete copy lists', async t => {
  const { root, publish } = await fixture(t);
  const before = await treeHashes(join(root, 'data'));
  for (const mutate of [
    manifest => { manifest.chapters.reverse(); },
    manifest => { manifest.chapters[0].steps[0].id += '-renamed'; },
    manifest => { manifest.chapters[0].steps[0].copyFiles.pop(); }
  ]) {
    const manifest = structuredClone(sourceManifest);
    mutate(manifest);
    await assert.rejects(publish({ build: ({ project }) => prepareSnapshotProject(project, manifest, {
      baselineStateId: 'peak-empty', finalSource: sourcePackage.finalSource
    }) }), /顺序不一致|身份不一致|不能还原快照/);
    assert.deepEqual(await treeHashes(join(root, 'data')), before);
  }
});

async function copyCLIInputs(root) {
  for (const path of [
    'lib/project-code-publisher.mjs', 'lib/project-code-delivery.mjs', 'lib/store.mjs', 'shared/park-domain.mjs',
    'courseware/peak-delivery-center/manifest.json', 'courseware/super-arcade-data-center/manifest.json',
    'courseware/super-curriculum-draft.json', 'courseware/dinosaur-night-patrol/final', 'courseware/ostrich-ferris-wheel/final',
    ...['dinosaur', 'ostrich', 'peak', 'super'].map(name => `scripts/sync-${name}-code-package.mjs`)
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await cp(join(REPO, path), join(root, path), { recursive: true });
  }
}

test('all four real CLIs check, reject unknown options, publish atomically and become no-ops in isolated repositories', { timeout: 30_000 }, async t => {
  const { root } = await fixture(t);
  await copyCLIInputs(root);
  const run = (name, args = []) => exec(process.execPath, [join(root, `scripts/sync-${name}-code-package.mjs`), ...args], {
    cwd: root, timeout: 10_000, maxBuffer: 1024 * 1024
  });
  for (const name of ['dinosaur', 'ostrich', 'peak', 'super']) {
    const before = await treeHashes(join(root, 'data'));
    const release = await acquireLock(root);
    try {
      const lockBytes = await readFile(join(root, '.local/server.lock'));
      assert.match((await run(name, ['--check'])).stdout, /校验通过，未写入/);
      await assert.rejects(run(name), /已有运行进程/);
      await assert.rejects(run(name, ['--unknown']), /仅支持/);
      if (name !== 'super') await assert.rejects(run(name, ['--with-draft']), /仅支持/);
      assert.deepEqual(await readFile(join(root, '.local/server.lock')), lockBytes);
      assert.deepEqual(await treeHashes(join(root, 'data')), before);
    } finally { await release(); }
    await run(name);
    const after = await treeHashes(join(root, 'data'));
    const metadata = await stat(join(root, 'data'));
    assert.match((await run(name)).stdout, /内容未变，未写入/);
    assert.deepEqual(await treeHashes(join(root, 'data')), after);
    assert.equal((await stat(join(root, 'data'))).ino, metadata.ino);
    const ids = { dinosaur: 'dinosaur-night-patrol-project', ostrich: 'ostrich-ferris-wheel-project', peak: PROJECT_ID, super: 'super-arcade-data-center-project' };
    await assertValidPublication(root, ids[name]);
    const packagePath = `project-code/${ids[name]}.json`;
    assert.equal(after[packagePath], before[packagePath], `${name} source bytes remain unchanged`);
  }
  // Only super can opt into the authored curriculum draft; it is still a check until requested.
  const draftPath = join(root, 'courseware/super-curriculum-draft.json');
  const draft = await readJSON(draftPath);
  draft.story += '\nCLI draft publishing regression.';
  draft.technologyTheme += '（临时验证）';
  await writeFile(draftPath, encode(draft));
  const before = await treeHashes(join(root, 'data'));
  await run('super', ['--with-draft', '--check']);
  assert.deepEqual(await treeHashes(join(root, 'data')), before);
  await run('super', ['--with-draft']);
  const course = await readJSON(join(root, 'data/course.json'));
  assert.equal(course.projects.find(item => item.id === draft.id).story, draft.story);
  assert.equal(course.ranks.find(item => item.id === draft.rankId).technologyTheme, draft.technologyTheme);
  const published = await treeHashes(join(root, 'data'));
  draft.rankId = 'peak-phoenix';
  await writeFile(draftPath, encode(draft));
  await assert.rejects(run('super', ['--with-draft']), /身份/);
  assert.deepEqual(await treeHashes(join(root, 'data')), published);
  await assertNoSwapArtifacts(root);
});
