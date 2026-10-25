import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { runnerError } from './c-runner-errors.mjs';

export const LOCAL_DEFAULTS = Object.freeze({
  clang: '/usr/bin/clang',
  sandbox: '/usr/bin/sandbox-exec',
  compileTimeoutMs: 8_000,
  runTimeoutMs: 3_000,
  maxOutputBytes: 64 * 1024,
  maxFileBytes: 128 * 1024
});

function collect(command, args, { cwd, input = '', timeout, maxOutput, env = {}, fileLimitBlocks = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const executable = fileLimitBlocks ? '/bin/sh' : command;
    const executableArgs = fileLimitBlocks
      ? ['-c', `ulimit -c 0; ulimit -f ${fileLimitBlocks}; ulimit -n 32; exec "$@"`, 'eggy-c-runner', command, ...args]
      : args;
    const child = spawn(executable, executableArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', ...env }
    });
    const stdout = [], stderr = [];
    let size = 0, killedForOutput = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    const append = target => chunk => {
      size += chunk.length;
      if (size > maxOutput) { killedForOutput = true; child.kill('SIGKILL'); return; }
      target.push(chunk);
    };
    child.stdout.on('data', append(stdout));
    child.stderr.on('data', append(stderr));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, timedOut, outputLimited: killedForOutput, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
    child.stdin.end(input);
  });
}

function compileSandboxProfile(folder) {
  return `(version 1)
(allow default)
(deny network*)
(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/etc") (subpath "/etc"))
(deny file-write*)
(allow file-write* (subpath ${JSON.stringify(folder)}))`;
}

function sandboxProfile(binary, folder) {
  return `(version 1)
(allow default)
(deny process-fork)
(deny process-exec)
(allow process-exec (literal ${JSON.stringify(binary)}))
(deny file-write*)
(allow file-write* (subpath ${JSON.stringify(folder)}))
(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/etc"))
(deny network*)`;
}

/**
 * 本机执行：clang 编译 + sandbox-exec 隔离运行。
 * 只接受已经过 validateSource 校验并用 wrapSafeFileApi 包装过的完整源码。
 */
export async function runLocally(wrappedSource, stdin, options = {}) {
  const clang = options.clang || LOCAL_DEFAULTS.clang;
  const sandbox = options.sandbox || LOCAL_DEFAULTS.sandbox;
  const compileTimeoutMs = options.compileTimeoutMs || LOCAL_DEFAULTS.compileTimeoutMs;
  const runTimeoutMs = options.runTimeoutMs || LOCAL_DEFAULTS.runTimeoutMs;
  const maxOutputBytes = options.maxOutputBytes || LOCAL_DEFAULTS.maxOutputBytes;
  const maxFileBytes = options.maxFileBytes || LOCAL_DEFAULTS.maxFileBytes;

  const folder = await realpath(await mkdtemp(join(tmpdir(), 'eggy-c-')));
  const sourcePath = join(folder, 'main.c');
  const binaryPath = join(folder, 'program');
  try {
    const [compilerPath, sandboxPath] = await Promise.all([realpath(clang), realpath(sandbox)]);
    await writeFile(sourcePath, wrappedSource, { encoding: 'utf8', mode: 0o600 });
    const compiled = await collect(
      sandboxPath,
      ['-p', compileSandboxProfile(folder), compilerPath, '-std=c17', '-O0', '-Wall', '-Wextra', '-fno-common', sourcePath, '-o', binaryPath],
      { cwd: folder, timeout: compileTimeoutMs, maxOutput: maxOutputBytes, env: { HOME: folder, TMPDIR: folder } }
    );
    if (compiled.timedOut) throw runnerError('编译超时，请检查代码结构。', 'compile_timeout');
    if (compiled.outputLimited) throw runnerError('编译信息过长，请先处理最前面的错误。', 'compile_output_limit');
    if (compiled.exitCode !== 0) return { phase: 'compile', passed: false, stdout: '', stderr: compiled.stderr.slice(0, maxOutputBytes), exitCode: compiled.exitCode, runner: 'local' };

    const execution = await collect(sandboxPath, ['-p', sandboxProfile(binaryPath, folder), binaryPath], {
      cwd: folder,
      input: stdin,
      timeout: runTimeoutMs,
      maxOutput: maxOutputBytes,
      env: { HOME: folder, TMPDIR: folder },
      fileLimitBlocks: maxFileBytes / 512
    });
    if (execution.timedOut) return { phase: 'run', passed: false, stdout: execution.stdout, stderr: '程序运行超时；请检查循环是否能够结束。', exitCode: null, timedOut: true, runner: 'local' };
    if (execution.outputLimited) return { phase: 'run', passed: false, stdout: execution.stdout.slice(0, maxOutputBytes), stderr: '程序输出超过 64 KiB，已停止运行。', exitCode: null, outputLimited: true, runner: 'local' };
    return { phase: 'run', passed: execution.exitCode === 0, stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, signal: execution.signal, runner: 'local' };
  } catch (error) {
    if (error.code === 'ENOENT') throw runnerError('本机缺少 C 编译或隔离运行工具。', 'runner_unavailable', `${clang} 或 ${sandbox} 不存在`);
    throw error;
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}
