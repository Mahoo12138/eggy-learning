import test from 'node:test';
import assert from 'node:assert/strict';

import { LINUX_SHELL_LIMITS, runLinuxShell } from '../lib/linux-shell-sim.mjs';

test('虚拟 Linux 终端能导航固定目录树，且不会读取宿主机', () => {
  const result = runLinuxShell('pwd\nls /\ncd /var/log\npwd\ncat app.log');

  assert.equal(result.passed, true);
  assert.equal(result.cwd, '/var/log');
  assert.equal(result.stdout, '/home/learner\ndev\netc\nhome\nproc\ntmp\nusr\nvar\n/var/log\nINFO boot\nERROR sensor\nINFO retry\nERROR timeout\n');
  assert.deepEqual(result.trace, ['pwd', 'ls', 'cd', 'pwd', 'cat']);
});

test('重定向和管道只改变虚拟文件系统，并可处理不同 stdin', () => {
  const script = 'cat > input.txt\ncat input.txt | grep ERROR > errors.txt\nwc -l errors.txt\ncat errors.txt';
  const first = runLinuxShell(script, 'INFO boot\nERROR sensor\nERROR timeout\n');
  const second = runLinuxShell(script, 'INFO only\n');

  assert.equal(first.passed, true);
  assert.equal(first.stdout, '2\nERROR sensor\nERROR timeout\n');
  assert.equal(second.passed, true);
  assert.equal(second.stdout, '0\n');
});

test('每次运行从独立的虚拟文件系统开始，错误路径不会泄漏宿主信息', () => {
  const first = runLinuxShell('cd /tmp\ntouch session-only.txt\nls');
  const second = runLinuxShell('cd /tmp\nls');
  const missing = runLinuxShell('cd /definitely-missing\npwd');

  assert.equal(first.passed, true);
  assert.equal(first.stdout, 'session-only.txt\n');
  assert.equal(second.passed, true);
  assert.equal(second.stdout, '');
  assert.equal(missing.passed, false);
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /definitely-missing/);
  assert.doesNotMatch(missing.stderr, /Users|home\/[^l]/);
});

test('权限和进程练习具有可观察状态变化', () => {
  const result = runLinuxShell('touch report.txt\nchmod 640 report.txt\nstat -c %a report.txt\nps | grep logger\nkill 318\nps | grep logger');

  assert.equal(result.passed, false, '最后一次 grep 无匹配时，脚本最终状态应为 1');
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '640\n318 logger\n');
});

test('退出状态遵循最后一条命令，并记录真实的 $? 展开而非固定文本', () => {
  const failure = runLinuxShell('false');
  const observed = runLinuxShell('false\necho $?');
  const doubleQuoted = runLinuxShell('false\necho "$?"');
  const singleQuoted = runLinuxShell("false\necho '$?'");
  const escaped = runLinuxShell('false\necho \\$?');
  const grepMiss = runLinuxShell('grep MISSING /var/log/app.log');

  assert.equal(failure.passed, false);
  assert.equal(failure.exitCode, 1);
  assert.equal(observed.passed, true);
  assert.equal(observed.exitCode, 0);
  assert.equal(observed.stdout, '1\n');
  assert.equal(observed.events.at(-1).exitStatusExpanded, true);
  assert.deepEqual(observed.events.at(-1).rawArgs, ['$?']);
  assert.equal(doubleQuoted.stdout, '1\n');
  assert.equal(doubleQuoted.events.at(-1).exitStatusExpanded, true);
  assert.equal(singleQuoted.stdout, '$?\n');
  assert.equal(singleQuoted.events.at(-1).exitStatusExpanded, false);
  assert.equal(escaped.stdout, '$?\n');
  assert.equal(escaped.events.at(-1).exitStatusExpanded, false);
  assert.equal(grepMiss.passed, false);
  assert.equal(grepMiss.exitCode, 1);
});

test('重定向在命令读取前截断目标文件，并保留可验证的管道与路径事件', () => {
  const selfOverwrite = runLinuxShell('cat /var/log/app.log > /var/log/app.log\ncat /var/log/app.log');
  const pipeline = runLinuxShell('cat /var/log/app.log | grep ERROR > /tmp/errors.txt');
  const decoyPaths = runLinuxShell('echo ./ ../ ~');

  assert.equal(selfOverwrite.passed, true);
  assert.equal(selfOverwrite.stdout, '');
  assert.equal(selfOverwrite.state.files['/var/log/app.log'].content, '');
  assert.deepEqual(pipeline.events.map(event => ({ command: event.command, pipedFrom: event.pipedFrom, pipedTo: event.pipedTo, redirect: event.redirect, redirectPath: event.redirectPath })), [
    { command: 'cat', pipedFrom: '', pipedTo: 'grep', redirect: '', redirectPath: '' },
    { command: 'grep', pipedFrom: 'cat', pipedTo: '', redirect: '>', redirectPath: '/tmp/errors.txt' }
  ]);
  assert.equal(pipeline.state.files['/tmp/errors.txt'].content, 'ERROR sensor\nERROR timeout\n');
  assert.deepEqual(decoyPaths.pathEvents, [], 'echo 参数中的路径字样不能冒充真实文件或目录操作');
});

test('终端拒绝宿主 shell 语法和未建模命令', () => {
  const chained = runLinuxShell('pwd; cat /etc/passwd');
  const commandSubstitution = runLinuxShell('echo $(whoami)');
  const unsupported = runLinuxShell('bash -c whoami');
  const statefulPipeline = runLinuxShell('cd /var | pwd');

  assert.equal(chained.passed, false);
  assert.match(chained.stderr, /不支持命令替换|命令连接符/);
  assert.equal(commandSubstitution.passed, false);
  assert.match(commandSubstitution.stderr, /不支持命令替换/);
  assert.equal(unsupported.passed, false);
  assert.equal(unsupported.exitCode, 127);
  assert.equal(statefulPipeline.passed, false);
  assert.match(statefulPipeline.stderr, /不能放进.*管道/);
});

test('终端限制脚本、输入和命令数量', () => {
  assert.equal(runLinuxShell(`echo ${'x'.repeat(LINUX_SHELL_LIMITS.maxScriptBytes)}`).passed, false);
  assert.equal(runLinuxShell('cat', 'x'.repeat(LINUX_SHELL_LIMITS.maxStdinBytes + 1)).passed, false);
  assert.equal(runLinuxShell(Array.from({ length: LINUX_SHELL_LIMITS.maxCommands + 1 }, () => 'pwd').join('\n')).passed, false);
});
