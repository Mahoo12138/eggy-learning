import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { C_RUNNER_LIMITS, runC } from '../lib/c-runner.mjs';

const CLANG = '/usr/bin/clang';
const SANDBOX = '/usr/bin/sandbox-exec';

async function isExecutable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const missingRuntimeTools = [];
if (process.platform !== 'darwin') missingRuntimeTools.push('macOS');
if (!(await isExecutable(CLANG))) missingRuntimeTools.push(CLANG);
if (!(await isExecutable(SANDBOX))) missingRuntimeTools.push(SANDBOX);
const runtimeSkip = missingRuntimeTools.length
  ? `需要可执行的 macOS clang 与 sandbox-exec；缺少：${missingRuntimeTools.join(', ')}`
  : false;

async function rejectsWithRunnerCode(promise, expectedCode) {
  await assert.rejects(promise, error => {
    assert.equal(error?.status, 400);
    assert.equal(error?.code, expectedCode);
    assert.ok(error.message);
    return true;
  });
}

test('编译并隔离运行 C17 程序，stdin 会按原样送入且 stdout 完整返回', { skip: runtimeSkip }, async () => {
  const source = `#include <stdio.h>
int main(void) {
  int price = 0;
  int count = 0;
  if (scanf("%d %d", &price, &count) != 2) {
    return 2;
  }
  printf("total=%d\\n", price * count);
  return 0;
}`;

  const result = await runC(source, '7 6\n');

  assert.deepEqual(result, {
    phase: 'run',
    passed: true,
    stdout: 'total=42\n',
    stderr: '',
    exitCode: 0,
    signal: null
  });
});

test('编译错误作为 compile 阶段结果返回，不会伪装成运行失败', { skip: runtimeSkip }, async () => {
  const result = await runC(`int main(void) {
  int answer = 42
  return answer;
}`);

  assert.equal(result.phase, 'compile');
  assert.equal(result.passed, false);
  assert.equal(result.stdout, '');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /error:/i);
  assert.match(result.stderr, /expected [';]|expected ';'/i);
});

test('无限循环到达运行时限后被终止并返回可解释的超时结果', { skip: runtimeSkip }, async () => {
  const source = `int main(void) {
  volatile unsigned long turns = 0;
  while (1) {
    turns++;
  }
  return 0;
}`;
  const startedAt = performance.now();

  const result = await runC(source);
  const elapsed = performance.now() - startedAt;

  assert.equal(result.phase, 'run');
  assert.equal(result.passed, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.match(result.stderr, /运行超时/);
  assert.ok(elapsed >= C_RUNNER_LIMITS.runTimeoutMs * 0.8, `不应在时限前终止：${elapsed.toFixed(0)}ms`);
  assert.ok(elapsed < C_RUNNER_LIMITS.runTimeoutMs + 5_000, `超时后应及时回收：${elapsed.toFixed(0)}ms`);
});

test('超过 64 KiB 的程序输出会触发上限并及时终止', { skip: runtimeSkip }, async () => {
  const source = `#include <stdio.h>
int main(void) {
  for (int line = 0; line < 1000000; line++) {
    puts("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  }
  return 0;
}`;

  const result = await runC(source);

  assert.equal(result.phase, 'run');
  assert.equal(result.passed, false);
  assert.equal(result.outputLimited, true);
  assert.equal(result.exitCode, null);
  assert.match(result.stderr, /输出超过 64 KiB/);
  assert.ok(Buffer.byteLength(result.stdout) <= C_RUNNER_LIMITS.maxOutputBytes);
});

test('拒绝 stdio.h 之外的 include 指令', async () => {
  await rejectsWithRunnerCode(
    runC(`#include <stdlib.h>
int main(void) { return 0; }`),
    'directive_not_allowed'
  );
});

test('即使没有危险头文件，也拒绝子进程和系统 API', async () => {
  await rejectsWithRunnerCode(
    runC(`int main(void) {
  system("echo escaped");
  return 0;
}`),
    'api_not_allowed'
  );
});

test('反斜杠续行不能拆开危险 API 标识符以绕过源码检查', async () => {
  await rejectsWithRunnerCode(runC(`extern int exec\\
ve(const char *, char *const[], char *const[]);
int main(void) {
  char *args[] = { "/bin/echo", "escaped", 0 };
  return exec\\
ve("/bin/echo", args, 0);
}`), 'api_not_allowed');
});

test('拒绝可替代井号的 digraph 与 trigraph 预处理 token', async () => {
  for (const directive of ['%:include "/etc/hosts"', '??=include "/etc/hosts"']) {
    await rejectsWithRunnerCode(runC(`${directive}\nint main(void) { return 0; }`), 'directive_not_allowed');
  }
});

test('危险 asm 标识符即使不是函数调用形式也会被拒绝', async () => {
  await rejectsWithRunnerCode(
    runC(`int main(void) {
  __asm__ volatile ("nop");
  return 0;
}`),
    'api_not_allowed'
  );
});

test('编译器也在沙箱中运行，不能读取系统配置或写入临时目录之外', { skip: runtimeSkip }, async () => {
  const fixtureFolder = await mkdtemp(join(tmpdir(), 'eggy-fake-clang-'));
  const fakeClang = join(fixtureFolder, 'clang');
  const outsideMarker = join(fixtureFolder, 'escaped');
  try {
    await writeFile(fakeClang, `#!/bin/sh
cat /etc/hosts >&2
printf escaped > ${JSON.stringify(outsideMarker)}
exit 77
`);
    await chmod(fakeClang, 0o700);

    const result = await runC('int main(void) { return 0; }', '', { clang: fakeClang, sandbox: SANDBOX });

    assert.equal(result.phase, 'compile');
    assert.equal(result.passed, false);
    assert.equal(result.exitCode, 77);
    assert.doesNotMatch(result.stderr, /localhost/);
    await assert.rejects(access(outsideMarker), error => error?.code === 'ENOENT');
  } finally {
    await rm(fixtureFolder, { recursive: true, force: true });
  }
});

test('按 UTF-8 字节数拒绝超过 8 KiB 的 stdin', async () => {
  const bytesPerCharacter = Buffer.byteLength('蛋');
  const oversizedStdin = '蛋'.repeat(Math.floor(C_RUNNER_LIMITS.maxStdinBytes / bytesPerCharacter) + 1);
  assert.ok(Buffer.byteLength(oversizedStdin) > C_RUNNER_LIMITS.maxStdinBytes);

  await rejectsWithRunnerCode(
    runC('int main(void) { return 0; }', oversizedStdin),
    'stdin_too_large'
  );
});

test('拒绝超过 32 KiB 的源代码，且在调用编译器前失败', async () => {
  const oversizedSource = `x${' '.repeat(C_RUNNER_LIMITS.maxSourceBytes)}`;
  assert.ok(Buffer.byteLength(oversizedSource) > C_RUNNER_LIMITS.maxSourceBytes);

  await rejectsWithRunnerCode(
    runC(oversizedSource, '', { clang: '/definitely/missing/clang', sandbox: '/definitely/missing/sandbox-exec' }),
    'source_too_large'
  );
});
