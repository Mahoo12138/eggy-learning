import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, stat, utimes, rename, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectCodeReader } from '../lib/project-code-reader.mjs';
import { PROJECT_CODE_MAX_PACKAGE_BYTES } from '../lib/project-code-delivery.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eggy-code-reader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'data/project-code/sample-project.json');
  await mkdir(join(root, 'data/project-code'), { recursive: true });
  const project = {
    id: 'sample-project', guidancePolicy: { codeDeliveryContractVersion: 1 },
    codeDelivery: { schemaVersion: 1, packageFile: 'project-code/sample-project.json', baselineStateId: 'empty', finalStateId: 'done' },
    chapters: [{ id: 'chapter-one', snapshotStateId: 'done', guidedSteps: [{ id: 'write', codeStepId: 'write-code', targetFiles: ['main.c'] }] }]
  };
  const codePackage = {
    schemaVersion: 1, projectId: project.id,
    states: [{ id: 'empty', files: {} }, { id: 'done', files: { 'main.c': 'int main(void) { return 0; }\n' } }],
    steps: [{
      id: 'write-code', chapterId: 'chapter-one', guidedStepId: 'write', fromStateId: 'empty', toStateId: 'done', copyFiles: ['main.c'],
      learnerChanges: [{ id: 'change-status', file: 'main.c', anchor: 'return 0;', instruction: '把退出码改为 1。', expectedFragment: 'return 1;' }],
      intentionalGaps: [], verification: { commands: ['cc main.c -o sample', './sample'], expected: ['exit 0'] }
    }],
    finalSource: { stateId: 'done', buildCommands: ['cc main.c -o sample'], runCommands: ['./sample'], expected: ['exit 0'] }
  };
  const bytes = JSON.stringify(codePackage);
  project.codeDelivery.packageSha256 = digest(bytes);
  await writeFile(path, bytes);
  // Exact whole seconds let the replacement tests preserve mtime without rounding ambiguity.
  await utimes(path, 1_700_000_000, 1_700_000_000);
  return { root, path, project, codePackage, bytes, reader: createProjectCodeReader(root) };
}

function invalid(status, message) {
  return error => {
    assert.equal(error.status, status);
    assert.equal(error.code, 'invalid_code_package');
    assert.match(error.message, message);
    return true;
  };
}

test('published packages reuse validated immutable snapshots while prose edits do not invalidate the contract', async t => {
  const f = await fixture(t);
  const first = await f.reader.readPublished(f.project);
  assert.deepEqual(first, f.codePackage);
  const prose = structuredClone(f.project);
  prose.title = 'new explanation';
  prose.chapters[0].title = 'new chapter title';
  assert.equal(await f.reader.readPublished(prose), first);
  assert.throws(() => { first.states[1].files['main.c'] = 'damaged'; }, TypeError);
  assert.deepEqual(await f.reader.readPublished(f.project), f.codePackage);
  assert.equal(await readFile(f.path, 'utf8'), f.bytes);
});

test('same digest and file still reject changed course references or a removed contract after a cache hit', async t => {
  const f = await fixture(t);
  const first = await f.reader.readPublished(f.project);
  for (const mutate of [
    project => { project.chapters[0].guidedSteps[0].targetFiles = ['missing.c']; },
    project => { project.chapters[0].snapshotStateId = 'empty'; },
    project => { project.chapters[0].guidedSteps[0].id = 'changed'; },
    project => { delete project.guidancePolicy.codeDeliveryContractVersion; }
  ]) {
    const changed = structuredClone(f.project); mutate(changed);
    await assert.rejects(f.reader.readPublished(changed), invalid(500, /校验失败/));
    assert.equal(await f.reader.readPublished(f.project), first, 'rejection must not evict a valid published snapshot');
  }
});

test('same-length in-place tampering with restored mtime cannot reuse the published cache', async t => {
  const f = await fixture(t);
  await f.reader.readPublished(f.project);
  const before = await stat(f.path, { bigint: true });
  await writeFile(f.path, f.bytes.replace('return 0;', 'return 9;'));
  await utimes(f.path, 1_700_000_000, 1_700_000_000);
  const after = await stat(f.path, { bigint: true });
  assert.equal(after.size, before.size);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.notEqual(after.ctimeNs, before.ctimeNs);
  await assert.rejects(f.reader.readPublished(f.project), invalid(500, /摘要不匹配/));
  await writeFile(f.path, f.bytes);
  assert.deepEqual(await f.reader.readPublished(f.project), f.codePackage);
});

test('atomic replacement with identical size and mtime invalidates the old inode cache', async t => {
  const f = await fixture(t);
  await f.reader.readPublished(f.project);
  const before = await stat(f.path, { bigint: true });
  const replacement = `${f.path}.next`;
  await writeFile(replacement, f.bytes.replace('return 0;', 'return 9;'));
  await utimes(replacement, 1_700_000_000, 1_700_000_000);
  await rename(replacement, f.path);
  const after = await stat(f.path, { bigint: true });
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.notEqual(after.ino, before.ino);
  await assert.rejects(f.reader.readPublished(f.project), invalid(500, /摘要不匹配/));
});

test('candidate validation neither consumes nor overwrites a published cache entry', async t => {
  const f = await fixture(t);
  const beforePublication = await f.reader.validateCandidate(f.project);
  const first = await f.reader.readPublished(f.project);
  assert.notEqual(first, beforePublication, 'validating a candidate must not seed an empty published cache');
  const validated = await f.reader.validateCandidate(f.project);
  assert.deepEqual(validated, first);
  assert.notEqual(validated, first, 'candidate must actually read and validate rather than use the published cache');
  assert.equal(await f.reader.readPublished(f.project), first, 'candidate must not populate the published cache');
  const changed = structuredClone(f.project);
  changed.chapters[0].guidedSteps[0].targetFiles = ['missing.c'];
  await assert.rejects(f.reader.validateCandidate(changed), invalid(400, /校验失败/));
  assert.equal(await f.reader.readPublished(f.project), first);
  await writeFile(f.path, f.bytes.replace('return 0;', 'return 9;'));
  await utimes(f.path, 1_700_000_000, 1_700_000_000);
  await assert.rejects(f.reader.validateCandidate(f.project), invalid(400, /摘要不匹配/));
  await assert.rejects(f.reader.readPublished(f.project), invalid(500, /摘要不匹配/));
});

test('missing delivery and unsafe paths retain published and candidate error semantics', async t => {
  const f = await fixture(t);
  const noDelivery = structuredClone(f.project); delete noDelivery.codeDelivery;
  for (const [method, status] of [['readPublished', 404], ['validateCandidate', 400]]) {
    await assert.rejects(f.reader[method](noDelivery), error => error.status === status && error.code === 'code_package_not_found');
  }
  for (const path of ['../outside.json', '/tmp/outside.json', 'project-code/other-project.json', 'project-code\\sample-project.json']) {
    const project = structuredClone(f.project); project.codeDelivery.packageFile = path;
    await assert.rejects(f.reader.readPublished(project), invalid(500, /路径无效/));
    await assert.rejects(f.reader.validateCandidate(project), invalid(400, /路径无效/));
  }
});

test('invalid JSON, digest mismatch, oversized, missing and nonregular files are rejected without writes', async t => {
  for (const kind of ['json', 'digest', 'oversized', 'missing', 'directory', 'symlink']) {
    await t.test(kind, async t => {
      const f = await fixture(t);
      await f.reader.readPublished(f.project);
      if (kind === 'json') {
        await writeFile(f.path, '{not json'); f.project.codeDelivery.packageSha256 = digest('{not json');
      } else if (kind === 'digest') await writeFile(f.path, `${f.bytes}\n`);
      else if (kind === 'oversized') await truncate(f.path, PROJECT_CODE_MAX_PACKAGE_BYTES + 1);
      else {
        await rm(f.path);
        if (kind === 'directory') await mkdir(f.path);
        if (kind === 'symlink') {
          const target = join(f.root, 'external.json');
          await writeFile(target, f.bytes); await symlink(target, f.path);
        }
      }
      const pattern = { json: /不是有效 JSON/, digest: /摘要不匹配/, oversized: /超过 16 MB/, missing: /文件缺失/, directory: /必须是普通文件/, symlink: /无法读取/ }[kind];
      await assert.rejects(f.reader.readPublished(f.project), invalid(500, pattern));
      await assert.rejects(f.reader.validateCandidate(f.project), invalid(400, pattern));
      if (kind === 'symlink') assert.equal(await readFile(join(f.root, 'external.json'), 'utf8'), f.bytes);
    });
  }
});
