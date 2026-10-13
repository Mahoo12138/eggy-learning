import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const MAX_SOURCE_BYTES = 32 * 1024;
const MAX_STDIN_BYTES = 8 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const COMPILE_TIMEOUT_MS = 8_000;
// sandbox-exec startup can briefly exceed 1.5 s on a loaded development Mac.
// Keep the learner-facing limit short while leaving enough wall-clock headroom
// that a trivial program is not mistaken for an infinite loop.
const RUN_TIMEOUT_MS = 3_000;

function runnerError(message, code = 'runner_error', details = '') {
  return Object.assign(new Error(message), { status: 400, code, details });
}

function validateSource(source) {
  if (typeof source !== 'string' || !source.trim()) throw runnerError('请先填写 C 代码。', 'source_required');
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw runnerError('代码最多 32 KiB。', 'source_too_large');
  const normalizedSource = source.replace(/\r\n?/g, '\n');
  const logicalSource = normalizedSource.replace(/\\\n/g, '');
  if (/(?:%:|\?\?[=/'()!<>-])/.test(logicalSource)) {
    throw runnerError('在线入门关卡不允许使用替代预处理符号或三字符序列。', 'directive_not_allowed');
  }
  const directives = logicalSource.split('\n').map(line => line.trim()).filter(line => line.startsWith('#'));
  if (directives.some(line => !/^#\s*include\s*<stdio\.h>\s*$/.test(line))) {
    throw runnerError('在线入门关卡只允许 #include <stdio.h>，请在后续本地项目中使用其他系统接口。', 'directive_not_allowed');
  }
  const forbidden = /\b(?:system|popen|fork|vfork|exec(?:l|le|lp|lpe|v|ve|vp|vpe)?|socket|connect|listen|accept|fopen|freopen|open|creat|unlink|remove|rename|dlopen|mmap|syscall|__asm__?|asm)\b/;
  if (forbidden.test(logicalSource)) throw runnerError('在线关卡不允许文件、网络、子进程或底层系统调用。', 'api_not_allowed');
  return normalizedSource;
}

function collect(command, args, { cwd, input = '', timeout, maxOutput = MAX_OUTPUT_BYTES, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

function sandboxProfile(binary) {
  return `(version 1)
(allow default)
(deny process-fork)
(deny process-exec)
(allow process-exec (literal ${JSON.stringify(binary)}))
(deny file-write*)
(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/etc"))
(deny network*)`;
}

/** Compile and execute the small C17 subset used by the first three ranks. */
export async function runC(source, stdin = '', { clang = '/usr/bin/clang', sandbox = '/usr/bin/sandbox-exec' } = {}) {
  const safeSource = validateSource(source);
  if (typeof stdin !== 'string' || Buffer.byteLength(stdin) > MAX_STDIN_BYTES) throw runnerError('输入最多 8 KiB。', 'stdin_too_large');
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'eggy-c-')));
  const sourcePath = join(folder, 'main.c');
  const binaryPath = join(folder, 'program');
  try {
    const [compilerPath, sandboxPath] = await Promise.all([realpath(clang), realpath(sandbox)]);
    await writeFile(sourcePath, safeSource, { encoding: 'utf8', mode: 0o600 });
    const compiled = await collect(
      sandboxPath,
      ['-p', compileSandboxProfile(folder), compilerPath, '-std=c17', '-O0', '-Wall', '-Wextra', '-fno-common', sourcePath, '-o', binaryPath],
      { cwd: folder, timeout: COMPILE_TIMEOUT_MS, env: { HOME: folder, TMPDIR: folder } }
    );
    if (compiled.timedOut) throw runnerError('编译超时，请检查代码结构。', 'compile_timeout');
    if (compiled.outputLimited) throw runnerError('编译信息过长，请先处理最前面的错误。', 'compile_output_limit');
    if (compiled.exitCode !== 0) return { phase: 'compile', passed: false, stdout: '', stderr: compiled.stderr.slice(0, MAX_OUTPUT_BYTES), exitCode: compiled.exitCode };

    const execution = await collect(sandboxPath, ['-p', sandboxProfile(binaryPath), binaryPath], { cwd: folder, input: stdin, timeout: RUN_TIMEOUT_MS });
    if (execution.timedOut) return { phase: 'run', passed: false, stdout: execution.stdout, stderr: '程序运行超时；请检查循环是否能够结束。', exitCode: null, timedOut: true };
    if (execution.outputLimited) return { phase: 'run', passed: false, stdout: execution.stdout.slice(0, MAX_OUTPUT_BYTES), stderr: '程序输出超过 64 KiB，已停止运行。', exitCode: null, outputLimited: true };
    return { phase: 'run', passed: execution.exitCode === 0, stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, signal: execution.signal };
  } catch (error) {
    if (error.code === 'ENOENT') throw runnerError('本机缺少 C 编译或隔离运行工具。', 'runner_unavailable');
    throw error;
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}

export const C_RUNNER_LIMITS = Object.freeze({ maxSourceBytes: MAX_SOURCE_BYTES, maxStdinBytes: MAX_STDIN_BYTES, maxOutputBytes: MAX_OUTPUT_BYTES, runTimeoutMs: RUN_TIMEOUT_MS });
