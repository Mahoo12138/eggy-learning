import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const MAX_SOURCE_BYTES = 32 * 1024;
const MAX_STDIN_BYTES = 8 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_DATA_KIB = 128 * 1024;
const COMPILE_TIMEOUT_MS = 8_000;
// sandbox-exec startup can briefly exceed 1.5 s on a loaded development Mac.
// Keep the learner-facing limit short while leaving enough wall-clock headroom
// that a trivial program is not mistaken for an infinite loop.
const RUN_TIMEOUT_MS = 3_000;

function runnerError(message, code = 'runner_error', details = '') {
  return Object.assign(new Error(message), { status: 400, code, details });
}

function maskCommentsAndLiterals(source) {
  let state = 'code';
  let escaped = false;
  let masked = '';
  for (let index = 0; index < source.length; index++) {
    const value = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (value === '/' && next === '/') { state = 'line-comment'; masked += '  '; index++; continue; }
      if (value === '/' && next === '*') { state = 'block-comment'; masked += '  '; index++; continue; }
      if (value === '"') { state = 'string'; escaped = false; masked += ' '; continue; }
      if (value === "'") { state = 'character'; escaped = false; masked += ' '; continue; }
      masked += value;
      continue;
    }
    if (state === 'line-comment') {
      if (value === '\n') { state = 'code'; masked += '\n'; } else masked += ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (value === '*' && next === '/') { state = 'code'; masked += '  '; index++; }
      else masked += value === '\n' ? '\n' : ' ';
      continue;
    }
    masked += value === '\n' ? '\n' : ' ';
    if (escaped) { escaped = false; continue; }
    if (value === '\\') { escaped = true; continue; }
    if ((state === 'string' && value === '"') || (state === 'character' && value === "'")) state = 'code';
  }
  return masked;
}

export function cIdentifiers(source) {
  const code = maskCommentsAndLiterals(String(source ?? ''));
  return [...new Set(code.match(/\b[A-Za-z_]\w*\b/g) || [])];
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
  if (directives.some(line => !/^#\s*include\s*<(?:stdio|stdlib|string)\.h>\s*$/.test(line))) {
    throw runnerError('在线 C 关卡只允许 #include <stdio.h>、<stdlib.h> 或 <string.h>。', 'directive_not_allowed');
  }
  const codeOnly = maskCommentsAndLiterals(logicalSource);
  const forbidden = /\b(?:eggy_(?:fopen|malloc|calloc|realloc|free)|system|popen|fork|vfork|exec(?:l|le|lp|lpe|v|ve|vp|vpe)?|socket|connect|listen|accept|freopen|fdopen|tmpfile|open|creat|unlink|remove|rename|link|symlink|readlink|chdir|opendir|dlopen|mmap|syscall|aligned_alloc|posix_memalign|valloc|alloca|sbrk|brk|__asm__?|asm)\b/;
  if (forbidden.test(codeOnly)) throw runnerError('在线关卡不允许网络、子进程、目录操作或底层系统调用。', 'api_not_allowed');
  return normalizedSource;
}

function wrapSafeFileApi(source) {
  return `#include <stdio.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
FILE *eggy_fopen(const char *path, const char *mode);
void *eggy_malloc(size_t size);
void *eggy_calloc(size_t count, size_t size);
void *eggy_realloc(void *pointer, size_t size);
void eggy_free(void *pointer);
#define fopen eggy_fopen
#define malloc eggy_malloc
#define calloc eggy_calloc
#define realloc eggy_realloc
#define free eggy_free
#line 1 "main.c"
${source}
#undef fopen
#undef malloc
#undef calloc
#undef realloc
#undef free
#line 1 "eggy-file-wrapper.c"
typedef union {
  size_t size;
  max_align_t alignment;
} EggyAllocationHeader;

static const size_t eggy_allocation_limit = ${(MAX_DATA_KIB * 1024).toString()};
static size_t eggy_allocated_bytes = 0;

void *eggy_malloc(size_t size) {
  if (size > eggy_allocation_limit - eggy_allocated_bytes) return NULL;
  if (size > (size_t)-1 - sizeof(EggyAllocationHeader)) return NULL;
  EggyAllocationHeader *header = malloc(sizeof *header + size);
  if (!header) return NULL;
  header->size = size;
  eggy_allocated_bytes += size;
  return header + 1;
}

void eggy_free(void *pointer) {
  if (!pointer) return;
  EggyAllocationHeader *header = (EggyAllocationHeader *)pointer - 1;
  eggy_allocated_bytes -= header->size;
  free(header);
}

void *eggy_calloc(size_t count, size_t size) {
  if (count && size > (size_t)-1 / count) return NULL;
  size_t total = count * size;
  void *pointer = eggy_malloc(total);
  if (pointer) memset(pointer, 0, total);
  return pointer;
}

void *eggy_realloc(void *pointer, size_t size) {
  if (!pointer) return eggy_malloc(size);
  if (!size) { eggy_free(pointer); return NULL; }
  EggyAllocationHeader *header = (EggyAllocationHeader *)pointer - 1;
  size_t previous = header->size;
  if (size > eggy_allocation_limit - (eggy_allocated_bytes - previous)) return NULL;
  if (size > (size_t)-1 - sizeof(EggyAllocationHeader)) return NULL;
  EggyAllocationHeader *resized = realloc(header, sizeof *header + size);
  if (!resized) return NULL;
  resized->size = size;
  eggy_allocated_bytes = eggy_allocated_bytes - previous + size;
  return resized + 1;
}

FILE *eggy_fopen(const char *path, const char *mode) {
  if (!path || !mode || !path[0] || path[0] == '.') return NULL;
  size_t length = strlen(path);
  if (length > 64) return NULL;
  for (size_t index = 0; index < length; index++) {
    char value = path[index];
    int safe = (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z')
      || (value >= '0' && value <= '9') || value == '_' || value == '-' || value == '.';
    if (!safe) return NULL;
  }
  if (strcmp(mode, "r") && strcmp(mode, "w") && strcmp(mode, "a")
      && strcmp(mode, "r+") && strcmp(mode, "w+") && strcmp(mode, "a+")
      && strcmp(mode, "rb") && strcmp(mode, "wb") && strcmp(mode, "ab")) return NULL;
  return fopen(path, mode);
}
`;
}

function collect(command, args, { cwd, input = '', timeout, maxOutput = MAX_OUTPUT_BYTES, env = {}, fileLimitBlocks = 0 } = {}) {
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

/** Compile and execute the sandboxed C17 subset used by the first two ranks. */
export async function runC(source, stdin = '', { clang = '/usr/bin/clang', sandbox = '/usr/bin/sandbox-exec' } = {}) {
  const safeSource = validateSource(source);
  if (typeof stdin !== 'string' || Buffer.byteLength(stdin) > MAX_STDIN_BYTES) throw runnerError('输入最多 8 KiB。', 'stdin_too_large');
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'eggy-c-')));
  const sourcePath = join(folder, 'main.c');
  const binaryPath = join(folder, 'program');
  try {
    const [compilerPath, sandboxPath] = await Promise.all([realpath(clang), realpath(sandbox)]);
    await writeFile(sourcePath, wrapSafeFileApi(safeSource), { encoding: 'utf8', mode: 0o600 });
    const compiled = await collect(
      sandboxPath,
      ['-p', compileSandboxProfile(folder), compilerPath, '-std=c17', '-O0', '-Wall', '-Wextra', '-fno-common', sourcePath, '-o', binaryPath],
      { cwd: folder, timeout: COMPILE_TIMEOUT_MS, env: { HOME: folder, TMPDIR: folder } }
    );
    if (compiled.timedOut) throw runnerError('编译超时，请检查代码结构。', 'compile_timeout');
    if (compiled.outputLimited) throw runnerError('编译信息过长，请先处理最前面的错误。', 'compile_output_limit');
    if (compiled.exitCode !== 0) return { phase: 'compile', passed: false, stdout: '', stderr: compiled.stderr.slice(0, MAX_OUTPUT_BYTES), exitCode: compiled.exitCode };

    const execution = await collect(sandboxPath, ['-p', sandboxProfile(binaryPath, folder), binaryPath], {
      cwd: folder,
      input: stdin,
      timeout: RUN_TIMEOUT_MS,
      env: { HOME: folder, TMPDIR: folder },
      fileLimitBlocks: MAX_FILE_BYTES / 512
    });
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

export const C_RUNNER_LIMITS = Object.freeze({ maxSourceBytes: MAX_SOURCE_BYTES, maxStdinBytes: MAX_STDIN_BYTES, maxOutputBytes: MAX_OUTPUT_BYTES, maxFileBytes: MAX_FILE_BYTES, maxDataBytes: MAX_DATA_KIB * 1024, runTimeoutMs: RUN_TIMEOUT_MS });
