import test from 'node:test';
import assert from 'node:assert/strict';

import {
  childLifecycleState,
  execState,
  forkCowState,
  monotonicDeadlineState,
  pipeEofState,
  pollReadyState,
  processGroupKillState,
  syscallState
} from '../public/assets/os-concept-lab.mjs';

test('系统调用实验区分成功、文件不存在和权限拒绝', () => {
  const success = syscallState({ path: '/island/report.log', outcome: 'success', assignedFd: 7 });
  assert.deepEqual({ returnValue: success.returnValue, errno: success.errno, opened: success.opened }, {
    returnValue: 7,
    errno: null,
    opened: true
  });
  assert.deepEqual(success.transition, ['user-space', 'kernel-space', 'user-space']);

  for (const outcome of ['ENOENT', 'EACCES']) {
    const failure = syscallState({ path: '/island/report.log', outcome });
    assert.equal(failure.returnValue, -1);
    assert.equal(failure.errno, outcome);
    assert.equal(failure.opened, false);
    assert.equal(failure.assignedFd, null);
  }
});

test('fork 先共享只读物理页，任一方写入后才产生私有副本', () => {
  const shared = forkCowState({ parentPid: 10, childPid: 11, initialValue: 3, writeBy: 'none' });
  assert.deepEqual(shared.forkReturns, { parent: 11, child: 0 });
  assert.equal(shared.sameVirtualAddress, true);
  assert.equal(shared.physicalPageCount, 1);
  assert.deepEqual([shared.parentValue, shared.childValue], [3, 3]);

  const childWrites = forkCowState({ parentPid: 10, childPid: 11, initialValue: 3, writeBy: 'child', nextValue: 8 });
  assert.equal(childWrites.copiedOnWrite, true);
  assert.equal(childWrites.physicalPageCount, 2);
  assert.deepEqual([childWrites.parentValue, childWrites.childValue], [3, 8]);

  const parentWrites = forkCowState({ parentPid: 10, childPid: 11, initialValue: 3, writeBy: 'parent', nextValue: 5 });
  assert.deepEqual([parentWrites.parentValue, parentWrites.childValue], [5, 3]);
});

test('管道只有在所有进程的写端引用关闭后才向读端报告 EOF', () => {
  const leakedParentEnd = pipeEofState({ writers: [
    { id: 'parent', open: true },
    { id: 'child', open: false }
  ] });
  assert.equal(leakedParentEnd.readerSeesEof, false);
  assert.deepEqual(leakedParentEnd.openWriterIds, ['parent']);

  const closed = pipeEofState({ writers: [
    { id: 'parent', open: false },
    { id: 'child', open: false },
    { id: 'grandchild', open: false }
  ] });
  assert.equal(closed.readerSeesEof, true);
  assert.equal(closed.readerStillWaiting, false);
  assert.equal(pipeEofState({ writers: [] }).readerSeesEof, true);
});

test('poll 扫描游标轮转，持续就绪的低 FD 不会饿死其他 FD', () => {
  const descriptors = [
    { fd: 3, ready: true },
    { fd: 4, ready: true },
    { fd: 5, ready: false }
  ];
  const first = pollReadyState({ descriptors, cursor: 0, maxEvents: 1 });
  const second = pollReadyState({ descriptors, cursor: first.nextCursor, maxEvents: 1 });
  assert.deepEqual(first.readyFds, [3]);
  assert.deepEqual(second.readyFds, [4]);
  assert.equal(second.nextCursor, 2);

  const silent = pollReadyState({ descriptors: descriptors.map(item => ({ ...item, ready: false })), cursor: 2 });
  assert.equal(silent.noneReady, true);
  assert.equal(silent.nextCursor, 0);
});

test('exec 成功替换程序映像但不改变 PID，失败则返回旧程序', () => {
  const success = execState({ pid: 42, beforeProgram: 'launcher', requestedProgram: 'worker', outcome: 'success' });
  assert.deepEqual({ beforePid: success.beforePid, afterPid: success.afterPid, afterProgram: success.afterProgram }, {
    beforePid: 42,
    afterPid: 42,
    afterProgram: 'worker'
  });
  assert.equal(success.returnedToOldProgram, false);

  const failure = execState({ pid: 42, beforeProgram: 'launcher', requestedProgram: 'missing', outcome: 'ENOENT' });
  assert.equal(failure.afterPid, 42);
  assert.equal(failure.afterProgram, 'launcher');
  assert.equal(failure.returnedToOldProgram, true);
  assert.equal(failure.errno, 'ENOENT');
});

test('退出的子进程先成为僵尸，wait 后才从进程表回收', () => {
  const zombie = childLifecycleState({ state: 'running', event: 'exit', exitStatus: 23 });
  assert.equal(zombie.state, 'zombie');
  assert.equal(zombie.executable, false);
  assert.equal(zombie.occupiesProcessTable, true);

  const reaped = childLifecycleState({ state: zombie.state, event: 'wait', exitStatus: 23 });
  assert.equal(reaped.state, 'reaped');
  assert.equal(reaped.occupiesProcessTable, false);
  assert.equal(reaped.waitResult, 23);
});

test('单调时钟期限不受墙上时钟前跳或后退影响', () => {
  const forward = monotonicDeadlineState({ startedAtMs: 1_000, nowMs: 3_000, timeoutMs: 5_000, wallClockShiftMs: 86_400_000 });
  const backward = monotonicDeadlineState({ startedAtMs: 1_000, nowMs: 3_000, timeoutMs: 5_000, wallClockShiftMs: -86_400_000 });
  assert.deepEqual(
    [forward.deadlineMs, forward.remainingMs, forward.expired],
    [backward.deadlineMs, backward.remainingMs, backward.expired]
  );
  assert.deepEqual([forward.deadlineMs, forward.remainingMs, forward.expired], [6_000, 3_000, false]);

  const expired = monotonicDeadlineState({ startedAtMs: 1_000, nowMs: 6_000, timeoutMs: 5_000 });
  assert.equal(expired.expired, true);
  assert.equal(expired.remainingMs, 0);
});

test('向进程组发送 SIGKILL 会清理同组子孙进程并保留其他组', () => {
  const input = {
    processes: [
      { pid: 100, pgid: 100, alive: true },
      { pid: 101, pgid: 100, alive: true },
      { pid: 200, pgid: 200, alive: true },
      { pid: 201, pgid: 200, alive: false }
    ],
    targetPgid: 100
  };
  const result = processGroupKillState(input);
  assert.deepEqual(result.killedPids, [100, 101]);
  assert.deepEqual(result.survivingPids, [200]);
  assert.deepEqual(result.processes.map(item => [item.pid, item.alive]), [
    [100, false],
    [101, false],
    [200, true],
    [201, false]
  ]);
  assert.equal(input.processes[0].alive, true, '纯函数不得修改调用方输入');
});

test('所有实验拒绝畸形、冲突或越界输入', () => {
  assert.throws(() => syscallState({ outcome: 'EPERM' }), /unsupported/);
  assert.throws(() => syscallState({ outcome: 'success', typo: true }), /unknown field/);
  assert.throws(() => forkCowState({ parentPid: 7, childPid: 7 }), /must differ/);
  assert.throws(() => pipeEofState({ writers: [{ id: 'same', open: true }, { id: 'same', open: false }] }), /duplicate/);
  assert.throws(() => pollReadyState({ descriptors: [], cursor: 0 }), /must not be empty/);
  assert.throws(() => pollReadyState({ descriptors: [{ fd: 3, ready: true }], cursor: 1 }), /identify/);
  assert.throws(() => execState({ pid: 0 }), /safe integer/);
  assert.throws(() => childLifecycleState({ state: 'running', event: 'wait' }), /only a zombie/);
  assert.throws(() => monotonicDeadlineState({ startedAtMs: 10, nowMs: 9 }), /cannot move backwards/);
  assert.throws(() => processGroupKillState({ processes: [{ pid: 1, pgid: 1, alive: 'yes' }] }), /boolean/);
});
