const SYSCALL_OUTCOMES = new Set(['success', 'ENOENT', 'EACCES']);
const COW_WRITERS = new Set(['none', 'parent', 'child']);
const CHILD_STATES = new Set(['running', 'zombie', 'reaped']);
const CHILD_EVENTS = new Set(['none', 'exit', 'wait']);

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function fields(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${name} contains unknown field ${key}`);
  }
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be non-empty text`);
  return value;
}

function bool(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  return value;
}

function integer(value, name, minimum = Number.MIN_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  return value;
}

function choice(value, choices, name) {
  if (!choices.has(value)) throw new TypeError(`${name} has an unsupported value`);
  return value;
}

function items(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function unique(values, key, name) {
  const seen = new Set();
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) throw new TypeError(`${name} contains duplicate ${id}`);
    seen.add(id);
  }
}

/** Model one open-like system call crossing into the kernel and returning to user space. */
export function syscallState(raw = {}) {
  record(raw, 'syscall input');
  fields(raw, ['path', 'outcome', 'assignedFd'], 'syscall input');
  const path = text(raw.path ?? '/island/report.log', 'syscall path');
  const outcome = choice(raw.outcome ?? 'success', SYSCALL_OUTCOMES, 'syscall outcome');
  const assignedFd = integer(raw.assignedFd ?? 3, 'assigned file descriptor', 0);
  const success = outcome === 'success';
  const explanations = {
    success: `The kernel opened ${path} and returned file descriptor ${assignedFd}.`,
    ENOENT: `The kernel could not find ${path}; no file descriptor was created.`,
    EACCES: `The kernel denied access to ${path}; no file descriptor was created.`
  };

  return {
    call: 'open',
    path,
    transition: ['user-space', 'kernel-space', 'user-space'],
    outcome,
    returnValue: success ? assignedFd : -1,
    errno: success ? null : outcome,
    opened: success,
    assignedFd: success ? assignedFd : null,
    explanation: explanations[outcome]
  };
}

/** Model fork followed by at most one write to a copy-on-write page. */
export function forkCowState(raw = {}) {
  record(raw, 'fork/COW input');
  fields(raw, ['parentPid', 'childPid', 'initialValue', 'writeBy', 'nextValue'], 'fork/COW input');
  const parentPid = integer(raw.parentPid ?? 4100, 'parent PID', 1);
  const childPid = integer(raw.childPid ?? 4101, 'child PID', 1);
  if (parentPid === childPid) throw new TypeError('parent PID and child PID must differ');
  const initialValue = integer(raw.initialValue ?? 7, 'initial value');
  const writeBy = choice(raw.writeBy ?? 'none', COW_WRITERS, 'COW writer');
  const nextValue = integer(raw.nextValue ?? 9, 'next value');
  const copied = writeBy !== 'none';

  return {
    parentPid,
    childPid,
    forkReturns: { parent: childPid, child: 0 },
    sameVirtualAddress: true,
    parentValue: writeBy === 'parent' ? nextValue : initialValue,
    childValue: writeBy === 'child' ? nextValue : initialValue,
    pageState: copied ? 'private-copies' : 'shared-read-only',
    physicalPageCount: copied ? 2 : 1,
    copiedOnWrite: copied,
    writer: writeBy
  };
}

/** EOF is visible only after every write-end reference in every process is closed. */
export function pipeEofState(raw = {}) {
  record(raw, 'pipe input');
  fields(raw, ['writers'], 'pipe input');
  const writers = items(raw.writers ?? [
    { id: 'parent-write-end', open: true },
    { id: 'child-write-end', open: true }
  ], 'pipe writers').map((item, index) => {
    record(item, `pipe writer ${index}`);
    fields(item, ['id', 'open'], `pipe writer ${index}`);
    return { id: text(item.id, `pipe writer ${index} id`), open: bool(item.open, `pipe writer ${index} open`) };
  });
  unique(writers, item => item.id, 'pipe writers');
  const openWriterIds = writers.filter(item => item.open).map(item => item.id);

  return {
    writers,
    openWriterIds,
    readerSeesEof: openWriterIds.length === 0,
    readerStillWaiting: openWriterIds.length > 0
  };
}

/** Select ready descriptors by rotating the scan cursor so a busy low FD cannot always win. */
export function pollReadyState(raw = {}) {
  record(raw, 'poll input');
  fields(raw, ['descriptors', 'cursor', 'maxEvents'], 'poll input');
  const descriptors = items(raw.descriptors ?? [
    { fd: 3, ready: true },
    { fd: 4, ready: false }
  ], 'poll descriptors').map((item, index) => {
    record(item, `poll descriptor ${index}`);
    fields(item, ['fd', 'ready'], `poll descriptor ${index}`);
    return { fd: integer(item.fd, `poll descriptor ${index} fd`, 0), ready: bool(item.ready, `poll descriptor ${index} ready`) };
  });
  if (!descriptors.length) throw new TypeError('poll descriptors must not be empty');
  unique(descriptors, item => item.fd, 'poll descriptors');
  const cursor = integer(raw.cursor ?? 0, 'poll cursor', 0);
  if (cursor >= descriptors.length) throw new TypeError('poll cursor must identify a descriptor');
  const maxEvents = integer(raw.maxEvents ?? 1, 'poll maxEvents', 1);
  if (maxEvents > descriptors.length) throw new TypeError('poll maxEvents cannot exceed descriptor count');

  const scanned = [];
  const selected = [];
  let lastSelectedIndex = -1;
  for (let offset = 0; offset < descriptors.length; offset += 1) {
    const index = (cursor + offset) % descriptors.length;
    const descriptor = descriptors[index];
    scanned.push(descriptor.fd);
    if (descriptor.ready && selected.length < maxEvents) {
      selected.push(descriptor.fd);
      lastSelectedIndex = index;
    }
  }
  const nextCursor = lastSelectedIndex >= 0
    ? (lastSelectedIndex + 1) % descriptors.length
    : (cursor + 1) % descriptors.length;

  return {
    readyFds: selected,
    scannedFds: scanned,
    nextCursor,
    noneReady: selected.length === 0
  };
}

/** exec replaces the program image; it does not allocate a new PID. */
export function execState(raw = {}) {
  record(raw, 'exec input');
  fields(raw, ['pid', 'beforeProgram', 'requestedProgram', 'outcome'], 'exec input');
  const pid = integer(raw.pid ?? 4101, 'exec PID', 1);
  const beforeProgram = text(raw.beforeProgram ?? 'patrol-launcher', 'current program');
  const requestedProgram = text(raw.requestedProgram ?? 'ferris-worker', 'requested program');
  const outcome = choice(raw.outcome ?? 'success', SYSCALL_OUTCOMES, 'exec outcome');
  const success = outcome === 'success';

  return {
    beforePid: pid,
    afterPid: pid,
    pidChanged: false,
    beforeProgram,
    afterProgram: success ? requestedProgram : beforeProgram,
    requestedProgram,
    outcome,
    returnedToOldProgram: !success,
    errno: success ? null : outcome
  };
}

/** Apply one explicit child-lifecycle event. wait is only valid for a zombie child. */
export function childLifecycleState(raw = {}) {
  record(raw, 'child lifecycle input');
  fields(raw, ['state', 'event', 'exitStatus'], 'child lifecycle input');
  const state = choice(raw.state ?? 'running', CHILD_STATES, 'child state');
  const event = choice(raw.event ?? 'none', CHILD_EVENTS, 'child event');
  const exitStatus = integer(raw.exitStatus ?? 0, 'child exit status', 0);
  if (exitStatus > 255) throw new TypeError('child exit status must be <= 255');

  let nextState = state;
  let waitResult = null;
  if (event === 'exit') {
    if (state !== 'running') throw new TypeError('only a running child can exit');
    nextState = 'zombie';
  } else if (event === 'wait') {
    if (state !== 'zombie') throw new TypeError('wait can reap only a zombie child in this model');
    nextState = 'reaped';
    waitResult = exitStatus;
  }

  return {
    previousState: state,
    event,
    state: nextState,
    executable: nextState === 'running',
    occupiesProcessTable: nextState !== 'reaped',
    resourcesMostlyReleased: nextState === 'zombie' || nextState === 'reaped',
    waitResult
  };
}

/** Compute a deadline only from monotonic timestamps; wall-clock jumps are display-only. */
export function monotonicDeadlineState(raw = {}) {
  record(raw, 'deadline input');
  fields(raw, ['startedAtMs', 'nowMs', 'timeoutMs', 'wallClockShiftMs'], 'deadline input');
  const startedAtMs = integer(raw.startedAtMs ?? 1_000, 'deadline start', 0);
  const nowMs = integer(raw.nowMs ?? startedAtMs, 'monotonic now', 0);
  if (nowMs < startedAtMs) throw new TypeError('monotonic now cannot move backwards');
  const timeoutMs = integer(raw.timeoutMs ?? 5_000, 'deadline timeout', 0);
  const wallClockShiftMs = integer(raw.wallClockShiftMs ?? 0, 'wall-clock shift');
  const deadlineMs = startedAtMs + timeoutMs;
  if (!Number.isSafeInteger(deadlineMs)) throw new TypeError('deadline exceeds safe integer range');
  const remainingMs = Math.max(0, deadlineMs - nowMs);

  return {
    startedAtMs,
    nowMs,
    deadlineMs,
    elapsedMs: nowMs - startedAtMs,
    remainingMs,
    expired: nowMs >= deadlineMs,
    wallClockShiftMs,
    wallClockShiftIgnored: true
  };
}

/** Model an uncatchable group kill: every live member of the target PGID is terminated. */
export function processGroupKillState(raw = {}) {
  record(raw, 'process-group input');
  fields(raw, ['processes', 'targetPgid'], 'process-group input');
  const processes = items(raw.processes ?? [
    { pid: 4101, pgid: 4101, alive: true },
    { pid: 4102, pgid: 4101, alive: true }
  ], 'process list').map((item, index) => {
    record(item, `process ${index}`);
    fields(item, ['pid', 'pgid', 'alive'], `process ${index}`);
    return {
      pid: integer(item.pid, `process ${index} PID`, 1),
      pgid: integer(item.pgid, `process ${index} PGID`, 1),
      alive: bool(item.alive, `process ${index} alive`)
    };
  });
  unique(processes, item => item.pid, 'process list');
  const targetPgid = integer(raw.targetPgid ?? 4101, 'target PGID', 1);
  const killedPids = [];
  const nextProcesses = processes.map(process => {
    if (process.alive && process.pgid === targetPgid) {
      killedPids.push(process.pid);
      return { ...process, alive: false };
    }
    return { ...process };
  });

  return {
    targetPgid,
    signal: 'SIGKILL',
    killedPids,
    survivingPids: nextProcesses.filter(process => process.alive).map(process => process.pid),
    processes: nextProcesses
  };
}
