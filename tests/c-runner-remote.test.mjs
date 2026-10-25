import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { cIdentifiers, clearRunnerCache, describeRunner, resolveRunnerConfig, runC } from '../lib/c-runner.mjs';

// 这些测试只验证"在线执行"这条链路的协议解析与回落策略：
// 用本地 mock 服务扮演 Wandbox / Judge0 / Piston，不访问真实网络。
process.env.C_RUNNER_PROVIDER = 'remote';

async function withMockServer(handler, run) {
  const seen = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ url: request.url, body });
      handler({ url: request.url, body, index: seen.length - 1 }, response);
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  try {
    return await run({ url: `http://127.0.0.1:${port}`, seen });
  } finally {
    await new Promise(done => server.close(done));
  }
}

function sendJSON(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function wandboxReply(overrides = {}) {
  return { status: '0', signal: '', compiler_output: '', compiler_error: '', compiler_message: '', program_output: '', program_error: '', program_message: '', ...overrides };
}

const SOURCE = 'int main(void) { return 0; }';

test.beforeEach(() => clearRunnerCache());

test('在线运行成功时返回与本地一致的执行结果形状', async () => {
  await withMockServer(
    (_, response) => sendJSON(response, 200, wandboxReply({ program_output: 'total=42\n' })),
    async ({ url, seen }) => {
      const result = await runC(SOURCE, '7 6\n', { provider: 'remote', kind: 'wandbox', url });
      assert.deepEqual(result, { phase: 'run', passed: true, stdout: 'total=42\n', stderr: '', exitCode: 0, signal: null, runner: 'remote' });
      assert.equal(seen[0].body.stdin, '7 6\n');
      assert.match(seen[0].body.code, /int main\(void\)/);
      assert.match(seen[0].body.code, /eggy_fopen/, '安全文件包装层必须随源码一起送到远端');
    }
  );
});

test('在线编译失败被归入 compile 阶段，而不是运行失败', async () => {
  await withMockServer(
    (_, response) => sendJSON(response, 200, wandboxReply({ status: '1', compiler_error: "prog.c:2:5: error: expected ';'\n" })),
    async ({ url }) => {
      const result = await runC(SOURCE, '', { provider: 'remote', kind: 'wandbox', url });
      assert.equal(result.phase, 'compile');
      assert.equal(result.passed, false);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /error:/);
    }
  );
});

test('程序以非零状态结束时保留精确退出码（课程用 return 1 表示输入非法）', async () => {
  await withMockServer(
    (_, response) => sendJSON(response, 200, wandboxReply({ status: '1', program_output: '' })),
    async ({ url }) => {
      const result = await runC(SOURCE, '1 60 0\n', { provider: 'remote', kind: 'wandbox', url });
      assert.equal(result.phase, 'run');
      assert.equal(result.exitCode, 1);
      assert.equal(result.passed, false);
      assert.equal(result.stdout, '');
    }
  );
});

test('在线服务自身故障会重试，重试仍失败时抛出可回落的故障码', async () => {
  await withMockServer(
    (_, response) => sendJSON(response, 200, wandboxReply({ status: '126', compiler_error: 'Error: OCI runtime error: crun: clone: Resource temporarily unavailable\n' })),
    async ({ url, seen }) => {
      await assert.rejects(
        runC(SOURCE, '', { provider: 'remote', kind: 'wandbox', url, retries: 1 }),
        error => error?.code === 'runner_remote_fault' && error.status === 400
      );
      assert.equal(seen.length, 2, '首次失败后应重试一次');
    }
  );
});

test('服务故障会记录在运行器状态里，便于页面解释当前走的是哪条路径', async () => {
  await withMockServer(
    (_, response) => sendJSON(response, 200, wandboxReply({ status: '126', compiler_error: 'Error: OCI runtime error\n' })),
    async ({ url }) => {
      await assert.rejects(runC(SOURCE, '', { provider: 'remote', kind: 'wandbox', url, retries: 0 }));
      assert.match(describeRunner({ provider: 'remote', kind: 'wandbox', url }).remote.lastFault, /不可用/);
    }
  );
});

test('auto：本机没有编译工具时自动改用在线服务', async () => {
  await withMockServer(
    (_, response) => sendJSON(response, 200, wandboxReply({ program_output: 'from-cloud\n' })),
    async ({ url, seen }) => {
      const result = await runC(SOURCE, '', {
        provider: 'auto',
        kind: 'wandbox',
        url,
        clang: '/definitely/missing/clang',
        sandbox: '/definitely/missing/sandbox-exec'
      });
      assert.equal(result.stdout, 'from-cloud\n');
      assert.equal(result.passed, true);
      assert.equal(seen.length, 1);
    }
  );
});

test('auto：本机与在线都不可用时合并成一条可解释的错误', async () => {
  await withMockServer(
    (_, response) => sendJSON(response, 503, { error: 'service unavailable' }),
    async ({ url }) => {
      await assert.rejects(
        runC(SOURCE, '', {
          provider: 'auto',
          kind: 'wandbox',
          url,
          retries: 0,
          clang: '/definitely/missing/clang',
          sandbox: '/definitely/missing/sandbox-exec'
        }),
        error => error?.code === 'runner_unavailable' && /本机与在线运行都不可用/.test(error.message)
      );
    }
  );
});

test('在线输出超过 64 KiB 时判定为输出超限', async () => {
  const flood = 'x'.repeat(70 * 1024);
  await withMockServer(
    (_, response) => sendJSON(response, 200, wandboxReply({ program_output: flood })),
    async ({ url }) => {
      const result = await runC(SOURCE, '', { provider: 'remote', kind: 'wandbox', url });
      assert.equal(result.outputLimited, true);
      assert.equal(result.exitCode, null);
      assert.match(result.stderr, /输出超过 64 KiB/);
      assert.ok(Buffer.byteLength(result.stdout) <= 64 * 1024);
    }
  );
});

test('在线服务无响应时按运行超时返回，不会一直挂着', async () => {
  await withMockServer(
    () => { /* 故意不响应 */ },
    async ({ url }) => {
      const result = await runC(SOURCE, '', { provider: 'remote', kind: 'wandbox', url, timeoutMs: 250, retries: 0 });
      assert.equal(result.timedOut, true);
      assert.equal(result.exitCode, null);
      assert.match(result.stderr, /没有在限定时间内返回/);
    }
  );
});

test('同一份代码与输入在缓存有效期内只请求一次在线服务', async () => {
  await withMockServer(
    (_, response) => sendJSON(response, 200, wandboxReply({ program_output: 'ok\n' })),
    async ({ url, seen }) => {
      await runC(SOURCE, '', { provider: 'remote', kind: 'wandbox', url });
      await runC(SOURCE, '', { provider: 'remote', kind: 'wandbox', url });
      assert.equal(seen.length, 1);
      await runC(`${SOURCE}\n`, '', { provider: 'remote', kind: 'wandbox', url });
      assert.equal(seen.length, 2, '源码变化后必须重新执行');
    }
  );
});

test('Judge0 协议：base64 载荷与状态码能正确映射', async () => {
  const encode = value => Buffer.from(value, 'utf8').toString('base64');
  const replies = [
    { status: { id: 3, description: 'Accepted' }, stdout: encode('total=42\n'), stderr: null, compile_output: null, message: null },
    { status: { id: 6, description: 'Compilation Error' }, stdout: null, stderr: null, compile_output: encode('prog.c:1:1: error: bad\n'), message: null },
    { status: { id: 5, description: 'Time Limit Exceeded' }, stdout: null, stderr: null, compile_output: null, message: null }
  ];
  let cursor = 0;
  await withMockServer(
    (_, response) => sendJSON(response, 200, replies[cursor++]),
    async ({ url, seen }) => {
      const passed = await runC(SOURCE, '7 6\n', { provider: 'remote', kind: 'judge0', url });
      assert.equal(passed.stdout, 'total=42\n');
      assert.equal(passed.exitCode, 0);
      assert.equal(seen[0].url.startsWith('/submissions?'), true);
      assert.equal(seen[0].url.includes('base64_encoded=true'), true);
      assert.equal(Buffer.from(seen[0].body.stdin, 'base64').toString('utf8'), '7 6\n');

      const failed = await runC(`${SOURCE} `, '', { provider: 'remote', kind: 'judge0', url });
      assert.equal(failed.phase, 'compile');
      assert.match(failed.stderr, /error: bad/);

      const slow = await runC(`${SOURCE}  `, '', { provider: 'remote', kind: 'judge0', url });
      assert.equal(slow.timedOut, true);
    }
  );
});

test('Piston 协议：编译失败与运行退出码分开映射', async () => {
  await withMockServer(
    ({ body }, response) => {
      if (body.stdin === 'bad-compile') {
        return sendJSON(response, 200, { compile: { stdout: '', stderr: 'main.c:1:1: error: nope\n', code: 1 }, run: { stdout: '', stderr: '', code: 0 } });
      }
      return sendJSON(response, 200, { compile: { stdout: '', stderr: '', code: 0 }, run: { stdout: '', stderr: '', code: 3, signal: null } });
    },
    async ({ url }) => {
      const failed = await runC(SOURCE, 'bad-compile', { provider: 'remote', kind: 'piston', url });
      assert.equal(failed.phase, 'compile');
      assert.match(failed.stderr, /error: nope/);
      const exitThree = await runC(SOURCE, '', { provider: 'remote', kind: 'piston', url });
      assert.equal(exitThree.phase, 'run');
      assert.equal(exitThree.exitCode, 3);
      assert.equal(exitThree.passed, false);
    }
  );
});

test('切换到在线执行后，源码白名单仍然拦截危险 API 且不发出网络请求', async () => {
  await withMockServer(
    (_, response) => sendJSON(response, 200, wandboxReply()),
    async ({ url, seen }) => {
      await assert.rejects(
        runC('int main(void) { system("echo escaped"); return 0; }', '', { provider: 'remote', kind: 'wandbox', url }),
        error => error?.code === 'api_not_allowed'
      );
      await assert.rejects(
        runC('#include <unistd.h>\nint main(void) { return 0; }', '', { provider: 'remote', kind: 'wandbox', url }),
        error => error?.code === 'directive_not_allowed'
      );
      assert.equal(seen.length, 0);
    }
  );
});

test('配置解析：默认 auto，显式本机工具时强制 local，未知服务名被纠正', () => {
  assert.equal(resolveRunnerConfig({ provider: 'auto' }).provider, 'auto');
  assert.equal(resolveRunnerConfig({ clang: '/tmp/clang' }).provider, 'local');
  assert.equal(resolveRunnerConfig({ provider: 'remote', kind: 'unknown-service' }).remote.kind, 'wandbox');
  assert.equal(resolveRunnerConfig({ provider: 'remote', kind: 'judge0' }).remote.url, 'https://ce.judge0.com');
  assert.equal(resolveRunnerConfig({ provider: 'remote' }).remote.url, 'https://wandbox.org/api/compile.json');
});

test('标识符提取不受注释与字符串干扰（评分依赖它）', () => {
  const identifiers = cIdentifiers('// malloc\nint main(void) { printf("system"); return 0; }');
  assert.ok(identifiers.includes('printf'));
  assert.ok(!identifiers.includes('malloc'));
  assert.ok(!identifiers.includes('system'));
});
