import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  crc32,
  createProjectStateZip,
  downloadProjectStateZip,
  projectArchiveNames
} from '../public/assets/project-code-zip.mjs';

const decoder = new TextDecoder();

function parseZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.length - 22;
  assert.equal(view.getUint32(endOffset, true), 0x06054b50, 'end-of-central-directory signature');
  const count = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  assert.equal(centralOffset + centralSize, endOffset);
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, 'central-directory signature');
    const madeBy = view.getUint16(offset + 4, true);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const dosTime = view.getUint16(offset + 12, true);
    const dosDate = view.getUint16(offset + 14, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const external = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    assert.equal(view.getUint32(localOffset, true), 0x04034b50, 'local-file signature');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const contentStart = localOffset + 30 + localNameLength + localExtraLength;
    const content = bytes.subarray(contentStart, contentStart + compressedSize);
    entries.push({
      name, madeBy, flags, method, dosTime, dosDate, expectedCrc,
      compressedSize, uncompressedSize, mode: external >>> 16,
      content
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, endOffset);
  return entries;
}

test('deterministic ZIP stores complete UTF-8 project tree with signatures and Unix modes', () => {
  const files = {
    'README.md': '# 课程工程\n',
    'scripts/verify.sh': '#!/bin/sh\necho 已通过\n',
    'src/main.c': '#include <stdio.h>\nint main(void) { puts("你好"); }\n',
    '文档/接线说明.txt': '传感器 → PA1\n'
  };
  const options = { projectId: 'wheel-control', stateId: 'chapter-one' };
  const first = createProjectStateZip(files, options);
  const second = createProjectStateZip(files, options);
  assert.deepEqual(first.bytes, second.bytes, 'same state must create byte-for-byte identical ZIP');
  assert.equal(new DataView(first.bytes.buffer).getUint32(0, true), 0x04034b50);
  assert.equal(first.fileName, 'eggy-wheel-control-chapter-one.zip');

  const entries = parseZip(first.bytes);
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  assert.deepEqual([...byName.keys()], [...byName.keys()].sort());
  assert.ok(byName.has(`${first.rootName}/`));
  assert.ok(byName.has(`${first.rootName}/scripts/`));
  assert.ok(byName.has(`${first.rootName}/文档/接线说明.txt`));
  assert.equal(decoder.decode(byName.get(`${first.rootName}/文档/接线说明.txt`).content), '传感器 → PA1\n');

  for (const entry of entries) {
    assert.equal(entry.madeBy >>> 8, 3, 'archive creator OS is Unix');
    assert.equal(entry.flags & 0x0800, 0x0800, 'UTF-8 filename flag');
    assert.equal(entry.method, 0, 'stored without compression');
    assert.equal(entry.dosTime, 0);
    assert.equal(entry.dosDate, 33);
    assert.equal(entry.compressedSize, entry.uncompressedSize);
    assert.equal(crc32(entry.content), entry.expectedCrc);
  }
  assert.equal(byName.get(`${first.rootName}/`).mode, 0o040755);
  assert.equal(byName.get(`${first.rootName}/scripts/`).mode, 0o040755);
  assert.equal(byName.get(`${first.rootName}/scripts/verify.sh`).mode, 0o100755);
  assert.equal(byName.get(`${first.rootName}/src/main.c`).mode, 0o100644);
});

test('download uses DOM properties, sanitizes the filename and revokes its object URL', () => {
  const names = projectArchiveNames('\"><img src=x onerror=alert(1)>', '../../final<script>');
  assert.equal(/[<>"'\\/]/.test(names.fileName), false);
  const archive = createProjectStateZip({ 'src/main.c': 'int main(void) { return 0; }\n' }, {
    projectId: '\"><img src=x onerror=alert(1)>', stateId: '../../final<script>'
  });
  let appended = false;
  let clicked = false;
  let removed = false;
  let scheduled;
  const link = {
    href: '', download: '', hidden: false,
    set innerHTML(_value) { throw new Error('download must never construct HTML'); },
    click() { clicked = true; },
    remove() { removed = true; }
  };
  const documentObject = {
    createElement(tag) { assert.equal(tag, 'a'); return link; },
    body: { append(node) { assert.equal(node, link); appended = true; } }
  };
  const revoked = [];
  const urlObject = {
    createObjectURL(blob) { assert.equal(blob.type, 'application/zip'); return 'blob:project-zip'; },
    revokeObjectURL(url) { revoked.push(url); }
  };
  downloadProjectStateZip(archive, {
    documentObject, urlObject, BlobClass: Blob,
    schedule(callback) { scheduled = callback; }
  });
  assert.equal(appended, true);
  assert.equal(clicked, true);
  assert.equal(removed, true);
  assert.equal(link.href, 'blob:project-zip');
  assert.equal(link.download, archive.fileName);
  assert.equal(/[<>"']/.test(link.download), false);
  assert.deepEqual(revoked, []);
  scheduled();
  assert.deepEqual(revoked, ['blob:project-zip']);
});

test('archive rejects unsafe relative paths and still revokes a URL when DOM setup fails', () => {
  for (const unsafe of ['../secret.txt', '/absolute.txt', 'src\\main.c', 'src//main.c']) {
    assert.throws(() => createProjectStateZip({ [unsafe]: 'hidden' }), /路径不安全/);
  }
  const archive = createProjectStateZip({ 'main.c': 'int main(void) { return 0; }\n' });
  let scheduled;
  const revoked = [];
  assert.throws(() => downloadProjectStateZip(archive, {
    documentObject: { createElement() { throw new Error('DOM unavailable'); } },
    urlObject: {
      createObjectURL() { return 'blob:must-revoke'; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    BlobClass: Blob,
    schedule(callback) { scheduled = callback; }
  }), /DOM unavailable/);
  assert.deepEqual(revoked, []);
  scheduled();
  assert.deepEqual(revoked, ['blob:must-revoke']);
});

test('archive rejects paths that collide on macOS or Windows extraction', () => {
  for (const files of [
    { src: 'file\n', 'src/main.c': 'child\n' },
    { 'Src/main.c': 'one\n', 'src/MAIN.c': 'two\n' },
    { 'src/café.c': 'one\n', 'src/cafe\u0301.c': 'two\n' },
    { 'src/Ｆｏｏ.c': 'one\n', 'src/foo.c': 'two\n' }
  ]) {
    assert.throws(() => createProjectStateZip(files), /目录|大小写或 Unicode 归一化后冲突/);
  }
});

test('common unzip preserves executable shell scripts and ordinary file permissions', async t => {
  const available = spawnSync('unzip', ['-v'], { stdio: 'ignore' });
  if (available.error || available.status !== 0) return t.skip('unzip is not available on this host');
  const archive = createProjectStateZip({
    'README.md': '# Run\n',
    'verify.sh': '#!/bin/sh\nexit 0\n',
    'tools/check.sh': '#!/bin/sh\nexit 0\n',
    'src/main.c': 'int main(void) { return 0; }\n',
    'src2/main.c': 'int second(void) { return 2; }\n',
    'docs/café.txt': '安全的 Unicode 路径\n'
  }, { projectId: 'permissions', stateId: 'final' });
  const directory = await mkdtemp(path.join(tmpdir(), 'eggy-code-zip-'));
  try {
    const archivePath = path.join(directory, archive.fileName);
    const outputPath = path.join(directory, 'output');
    await writeFile(archivePath, archive.bytes);
    const result = spawnSync('unzip', ['-q', archivePath, '-d', outputPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const root = path.join(outputPath, archive.rootName);
    assert.equal((await stat(root)).mode & 0o777, 0o755);
    assert.equal((await stat(path.join(root, 'verify.sh'))).mode & 0o777, 0o755);
    assert.equal((await stat(path.join(root, 'tools/check.sh'))).mode & 0o777, 0o755);
    assert.equal((await stat(path.join(root, 'README.md'))).mode & 0o777, 0o644);
    assert.equal(await readFile(path.join(root, 'src/main.c'), 'utf8'), 'int main(void) { return 0; }\n');
    assert.equal(await readFile(path.join(root, 'src2/main.c'), 'utf8'), 'int second(void) { return 2; }\n');
    assert.equal(await readFile(path.join(root, 'docs/café.txt'), 'utf8'), '安全的 Unicode 路径\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
