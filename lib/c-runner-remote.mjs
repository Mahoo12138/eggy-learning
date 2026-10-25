import { runnerError } from './c-runner-errors.mjs';

export const REMOTE_DEFAULT_URLS = Object.freeze({
  wandbox: 'https://wandbox.org/api/compile.json',
  judge0: 'https://ce.judge0.com',
  piston: 'https://emkc.org/api/v2/piston'
});

export const REMOTE_KINDS = Object.freeze(Object.keys(REMOTE_DEFAULT_URLS));

// 这些串来自运行服务自身故障，不是学习者代码的问题：
// 遇到时应重试或回落到本机，而不是把原文抛给学习者。
const PROVIDER_BREAKAGE = [
  /OCI runtime error/i,
  /Resource temporarily unavailable/i,
  /internal error/i,
  /service unavailable/i,
  /too many requests/i,
  /rate.?limit/i,
  /whitelist/i,
  /authorize/i
];

function remoteFault(message, details = '') {
  return runnerError(message, 'runner_remote_fault', details);
}

function looksLikeBreakage(...values) {
  return values.some(value => typeof value === 'string' && PROVIDER_BREAKAGE.some(pattern => pattern.test(value)));
}

function clip(text, limit) {
  const value = typeof text === 'string' ? text : '';
  if (Buffer.byteLength(value) <= limit) return value;
  return Buffer.from(value, 'utf8').subarray(0, limit).toString('utf8');
}

async function postJson(url, body, { headers = {}, timeoutMs }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    if (timedOut) return { timedOut: true };
    if (!response.ok) {
      if (looksLikeBreakage(text)) throw remoteFault('在线运行器暂时不可用。', `HTTP ${response.status}`);
      throw remoteFault(`在线运行器返回 HTTP ${response.status}。`, clip(text, 400));
    }
    try {
      return { payload: JSON.parse(text) };
    } catch {
      throw remoteFault('在线运行器返回的内容无法解析。', clip(text, 400));
    }
  } catch (error) {
    if (timedOut) return { timedOut: true };
    if (error?.code === 'runner_remote_fault') throw error;
    throw remoteFault('无法连接在线运行器，请检查网络。', String(error?.message || error));
  } finally {
    clearTimeout(timer);
  }
}

function fromWandbox(payload) {
  const compilerError = String(payload?.compiler_error ?? '');
  const programError = String(payload?.program_error ?? '');
  if (looksLikeBreakage(compilerError, programError, String(payload?.compiler_message ?? ''))) {
    throw remoteFault('在线运行器暂时不可用，请稍后重试。', clip(compilerError || programError, 200));
  }
  const status = String(payload?.status ?? '').trim();
  const exitCode = status === '' ? null : Number(status);
  return {
    compileFailed: compilerError.trim() !== '',
    compileMessage: compilerError,
    stdout: String(payload?.program_output ?? ''),
    stderr: programError,
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    signal: String(payload?.signal ?? '') || null
  };
}

function fromJudge0(payload) {
  const statusId = Number(payload?.status?.id);
  const decode = value => (value ? Buffer.from(String(value), 'base64').toString('utf8') : '');
  const stderr = decode(payload?.stderr);
  const compileMessage = decode(payload?.compile_output) || decode(payload?.message);
  if (statusId === 13 || statusId === 14) {
    throw remoteFault('在线运行器内部出错，请稍后重试。', clip(compileMessage, 200));
  }
  if (statusId === 1 || statusId === 2) throw remoteFault('在线运行器正忙，请稍后重试。');
  if (looksLikeBreakage(stderr, compileMessage)) throw remoteFault('在线运行器暂时不可用，请稍后重试。', clip(compileMessage, 200));
  if (statusId === 6) return { compileFailed: true, compileMessage, stdout: '', stderr: '', exitCode: 1, signal: null };
  if (statusId === 5) return { timedOut: true };
  const exitCode = Number.isInteger(payload?.exit_code)
    ? payload.exit_code
    : statusId === 3 ? 0 : statusId === 4 ? 1 : null;
  return { compileFailed: false, compileMessage: '', stdout: decode(payload?.stdout), stderr, exitCode, signal: null };
}

function fromPiston(payload) {
  const compile = payload?.compile || {};
  const compileMessage = [compile.stdout, compile.stderr].filter(Boolean).join('');
  if (looksLikeBreakage(compileMessage, payload?.run?.stderr)) {
    throw remoteFault('在线运行器暂时不可用，请稍后重试。', clip(compileMessage, 200));
  }
  if (payload?.message && !payload?.compile) throw remoteFault('在线运行器拒绝了这次请求。', clip(String(payload.message), 200));
  if (Number(compile.code) !== 0) {
    return { compileFailed: true, compileMessage, stdout: '', stderr: '', exitCode: Number.isFinite(Number(compile.code)) ? Number(compile.code) : 1, signal: null };
  }
  const run = payload?.run || {};
  const exitCode = Number.isFinite(Number(run.code)) ? Number(run.code) : null;
  return {
    compileFailed: false,
    compileMessage: '',
    stdout: String(run.stdout ?? ''),
    stderr: String(run.stderr ?? ''),
    exitCode,
    signal: run.signal ? String(run.signal) : null
  };
}

function buildRequest(kind, wrappedSource, stdin, config) {
  const compilerOptions = config.compilerOptions || '-std=c17 -O0 -Wall -Wextra';
  if (kind === 'wandbox') {
    return {
      url: config.url,
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
      body: {
        compiler: config.compiler,
        code: wrappedSource,
        stdin,
        options: 'warning',
        'runtime-option-raw': ''
      }
    };
  }
  if (kind === 'judge0') {
    const base = config.url.replace(/\/+$/, '');
    const encode = value => Buffer.from(String(value ?? ''), 'utf8').toString('base64');
    return {
      url: `${base}/submissions?base64_encoded=true&wait=true&fields=stdout,stderr,compile_output,message,status,exit_code,time,memory`,
      headers: config.token ? { 'X-RapidAPI-Key': config.token } : {},
      body: {
        source_code: encode(wrappedSource),
        language_id: config.languageId,
        stdin: encode(stdin),
        compiler_options: compilerOptions,
        cpu_time_limit: Math.max(1, Math.ceil(config.runTimeoutMs / 1000)),
        wall_time_limit: Math.max(2, Math.ceil(config.timeoutMs / 1000))
      }
    };
  }
  const base = config.url.replace(/\/+$/, '');
  return {
    url: `${base}/execute`,
    headers: config.token ? { Authorization: config.token } : {},
    body: {
      language: config.language || 'c',
      version: config.version || '*',
      files: [{ name: 'main.c', content: wrappedSource }],
      stdin,
      compile_timeout: config.compileTimeoutMs,
      run_timeout: config.runTimeoutMs
    }
  };
}

const REMOTE_TIMEOUT_STDERR = '程序没有在限定时间内返回。请先确认循环能够结束；如果代码本身没问题，也可能是在线运行器繁忙，可以稍后重试或改用本机运行。';

function finalize(raw, maxOutputBytes) {
  if (raw.timedOut) {
    return { phase: 'run', passed: false, stdout: '', stderr: REMOTE_TIMEOUT_STDERR, exitCode: null, timedOut: true, runner: 'remote' };
  }
  if (raw.compileFailed) {
    return { phase: 'compile', passed: false, stdout: '', stderr: clip(raw.compileMessage, maxOutputBytes), exitCode: raw.exitCode ?? 1, runner: 'remote' };
  }
  const stdout = raw.stdout ?? '';
  const stderr = raw.stderr ?? '';
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxOutputBytes) {
    return { phase: 'run', passed: false, stdout: clip(stdout, maxOutputBytes), stderr: '程序输出超过 64 KiB，已停止运行。', exitCode: null, outputLimited: true, runner: 'remote' };
  }
  return { phase: 'run', passed: raw.exitCode === 0, stdout, stderr, exitCode: raw.exitCode, signal: raw.signal ?? null, runner: 'remote' };
}

/**
 * 在线执行：把已校验并包装过的源码发给远端编译运行服务。
 * 远端只负责容器内的编译与运行；文件与内存边界仍由注入的 eggy_* 包装层约束。
 * 服务自身故障（5xx、容器启动失败、限流）会重试；重试仍失败则抛出 runner_remote_fault，
 * 由调用方决定是否回落到本机。学习者程序的超时不算故障，直接作为运行结果返回。
 */
export async function runRemotely(wrappedSource, stdin, config) {
  const kind = config.kind || 'wandbox';
  const parser = { wandbox: fromWandbox, judge0: fromJudge0, piston: fromPiston }[kind];
  if (!parser) throw remoteFault(`不支持的在线运行服务：${kind}`);
  const request = buildRequest(kind, wrappedSource, stdin, config);
  const attempts = Math.max(0, config.retries) + 1;
  let lastError = remoteFault('在线运行器没有返回结果。');
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await postJson(request.url, request.body, { headers: request.headers, timeoutMs: config.timeoutMs });
    } catch (error) {
      if (error?.code !== 'runner_remote_fault') throw error;
      lastError = error;
      continue;
    }
    if (response.timedOut) {
      return { phase: 'run', passed: false, stdout: '', stderr: REMOTE_TIMEOUT_STDERR, exitCode: null, timedOut: true, runner: 'remote' };
    }
    try {
      return finalize(parser(response.payload), config.maxOutputBytes);
    } catch (error) {
      if (error?.code !== 'runner_remote_fault') throw error;
      lastError = error;
    }
  }
  throw lastError;
}
