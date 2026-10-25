import { createHash } from 'node:crypto';

import { runnerError } from './c-runner-errors.mjs';
import { LOCAL_DEFAULTS, runLocally } from './c-runner-local.mjs';
import { REMOTE_DEFAULT_URLS, REMOTE_KINDS, runRemotely } from './c-runner-remote.mjs';

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
// 公共在线实例一次往返实测 4–7 s，排队时会明显更久。
// 时限太短会把"服务繁忙"误报成"程序死循环"，因此给足余量。
const REMOTE_TIMEOUT_MS = 12_000;
const REMOTE_RETRIES = 1;
const CACHE_TTL_MS = 60_000;
const CACHE_LIMIT = 200;

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

function readInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 运行配置：
 *   C_RUNNER_PROVIDER=auto|local|remote   auto：先在线，在线故障时回落本机
 *   C_RUNNER_REMOTE_KIND=wandbox|judge0|piston
 *   C_RUNNER_REMOTE_URL / _TOKEN / _COMPILER / _LANGUAGE_ID / _TIMEOUT_MS / _RETRIES
 *   C_RUNNER_CLANG / C_RUNNER_SANDBOX / C_RUNNER_RUN_TIMEOUT_MS
 *   C_RUNNER_CACHE_TTL_MS
 */
export function resolveRunnerConfig(overrides = {}) {
  const env = process.env;
  const requested = String(overrides.provider || env.C_RUNNER_PROVIDER || 'auto').toLowerCase();
  let provider = ['auto', 'local', 'remote'].includes(requested) ? requested : 'auto';
  // 显式给出本机编译或隔离工具时，调用方要的是本机语义（测试即属于此列）。
  if (!overrides.provider && (overrides.clang || overrides.sandbox)) provider = 'local';

  const kind = String(overrides.kind || env.C_RUNNER_REMOTE_KIND || 'wandbox').toLowerCase();
  const runTimeoutMs = readInt(env.C_RUNNER_RUN_TIMEOUT_MS, RUN_TIMEOUT_MS);
  return {
    provider,
    cacheTtlMs: readInt(overrides.cacheTtlMs, readInt(env.C_RUNNER_CACHE_TTL_MS, CACHE_TTL_MS)),
    local: {
      clang: overrides.clang || env.C_RUNNER_CLANG || LOCAL_DEFAULTS.clang,
      sandbox: overrides.sandbox || env.C_RUNNER_SANDBOX || LOCAL_DEFAULTS.sandbox,
      compileTimeoutMs: readInt(env.C_RUNNER_COMPILE_TIMEOUT_MS, COMPILE_TIMEOUT_MS),
      runTimeoutMs,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxFileBytes: MAX_FILE_BYTES
    },
    remote: {
      kind: REMOTE_KINDS.includes(kind) ? kind : 'wandbox',
      url: overrides.url || env.C_RUNNER_REMOTE_URL || REMOTE_DEFAULT_URLS[kind] || REMOTE_DEFAULT_URLS.wandbox,
      token: overrides.token || env.C_RUNNER_REMOTE_TOKEN || '',
      compiler: overrides.compiler || env.C_RUNNER_REMOTE_COMPILER || 'gcc-head-c',
      languageId: readInt(env.C_RUNNER_REMOTE_LANGUAGE_ID, 50),
      timeoutMs: readInt(overrides.timeoutMs, readInt(env.C_RUNNER_REMOTE_TIMEOUT_MS, REMOTE_TIMEOUT_MS)),
      retries: readInt(overrides.retries, readInt(env.C_RUNNER_REMOTE_RETRIES, REMOTE_RETRIES)),
      compileTimeoutMs: readInt(env.C_RUNNER_COMPILE_TIMEOUT_MS, COMPILE_TIMEOUT_MS),
      runTimeoutMs,
      maxOutputBytes: MAX_OUTPUT_BYTES
    }
  };
}

// ── 远程结果缓存 ───────────────────────────────────────────────
// 同一份源码与输入在一次学习里会被反复运行（换输入、点重试、刷新页面）。
// 在线执行的往返成本远高于本机，因此在短 TTL 内复用结果。
const resultCache = new Map();

function cacheKey(config, wrappedSource, stdin) {
  return createHash('sha256')
    .update([config.provider, config.remote.kind, config.remote.url, config.remote.compiler, wrappedSource, stdin].join('\u0000'))
    .digest('hex');
}

function readCache(key, ttlMs) {
  if (!ttlMs) return null;
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) { resultCache.delete(key); return null; }
  return { ...entry.value };
}

function writeCache(key, value, ttlMs) {
  if (!ttlMs) return;
  if (resultCache.size >= CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value);
  resultCache.set(key, { value: { ...value }, expires: Date.now() + ttlMs });
}

export function clearRunnerCache() {
  resultCache.clear();
}

// ── 在线故障记录 ───────────────────────────────────────────────
// 只用于状态查询与错误合并；是否回落由 provider 决定，不做时间窗冷却。
let remoteFaultMessage = '';

/**
 * 编译并运行 C17 子集。
 *   provider=local  只用本机 clang + sandbox-exec
 *   provider=remote 只用在线服务，不依赖本机工具链
 *   provider=auto   先本机；本机缺少编译或隔离工具时改用在线服务
 */
export async function runC(source, stdin = '', options = {}) {
  const safeSource = validateSource(source);
  if (typeof stdin !== 'string' || Buffer.byteLength(stdin) > MAX_STDIN_BYTES) throw runnerError('输入最多 8 KiB。', 'stdin_too_large');
  const config = resolveRunnerConfig(options);
  const wrapped = wrapSafeFileApi(safeSource);

  const runLocal = () => runLocally(wrapped, stdin, config.local);

  if (config.provider === 'local') return await runLocal();

  const key = cacheKey(config, wrapped, stdin);
  const cached = readCache(key, config.cacheTtlMs);
  if (cached) return cached;

  const runRemote = async () => {
    const result = await runRemotely(wrapped, stdin, config.remote);
    remoteFaultMessage = '';
    writeCache(key, result, config.cacheTtlMs);
    return result;
  };

  const remoteWithFaultNote = async () => {
    try {
      return await runRemote();
    } catch (error) {
      if (error?.code === 'runner_remote_fault') remoteFaultMessage = error.message;
      throw error;
    }
  };

  if (config.provider === 'remote') return await remoteWithFaultNote();

  // auto：本机是快路径（约 0.3 s），在线是"换一台机器也能跑"的兜底（约 4–7 s）。
  // 只有本机工具缺失才回落，学习者代码的问题不应触发网络往返。
  try {
    return await runLocal();
  } catch (localError) {
    if (localError?.code !== 'runner_unavailable') throw localError;
    try {
      return await remoteWithFaultNote();
    } catch (remoteError) {
      throw runnerError(`本机与在线运行都不可用：本机缺少 ${localError.details || '编译或隔离工具'}；在线：${remoteError.message}`, 'runner_unavailable');
    }
  }
}

/** 供状态接口说明当前实际会使用哪条执行路径。 */
export function describeRunner(overrides = {}) {
  const config = resolveRunnerConfig(overrides);
  return {
    provider: config.provider,
    local: { clang: config.local.clang, sandbox: config.local.sandbox, runTimeoutMs: config.local.runTimeoutMs },
    remote: {
      kind: config.remote.kind,
      url: config.remote.url,
      compiler: config.remote.kind === 'wandbox' ? config.remote.compiler : String(config.remote.languageId),
      timeoutMs: config.remote.timeoutMs,
      lastFault: remoteFaultMessage
    },
    cacheEntries: resultCache.size
  };
}

export const C_RUNNER_LIMITS = Object.freeze({ maxSourceBytes: MAX_SOURCE_BYTES, maxStdinBytes: MAX_STDIN_BYTES, maxOutputBytes: MAX_OUTPUT_BYTES, maxFileBytes: MAX_FILE_BYTES, maxDataBytes: MAX_DATA_KIB * 1024, runTimeoutMs: RUN_TIMEOUT_MS });
