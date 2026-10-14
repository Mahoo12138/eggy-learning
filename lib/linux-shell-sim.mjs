import { posix } from 'node:path';

const MAX_SCRIPT_BYTES = 8 * 1024;
const MAX_STDIN_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_COMMANDS = 64;
const EXIT_STATUS_PLACEHOLDER = '\u0000eggy-exit-status\u0000';

function resultError(message, stdout = '', exitCode = 1) {
  return { phase: 'run', passed: false, stdout, stderr: message, exitCode, signal: null };
}

function initialState() {
  const directories = new Set([
    '/', '/dev', '/etc', '/home', '/home/learner', '/home/learner/work',
    '/proc', '/tmp', '/usr', '/usr/bin', '/var', '/var/log'
  ]);
  const files = new Map([
    ['/etc/hostname', { content: 'eggy-lab\n', mode: '644' }],
    ['/home/learner/tasks.txt', { content: 'learn C\nlearn Linux\n', mode: '644' }],
    ['/home/learner/work/notes.txt', { content: 'build\nrun\ndebug\n', mode: '644' }],
    ['/var/log/app.log', { content: 'INFO boot\nERROR sensor\nINFO retry\nERROR timeout\n', mode: '644' }]
  ]);
  const processes = new Map([[101, 'init'], [205, 'editor'], [318, 'logger']]);
  return { cwd: '/home/learner', directories, files, processes, trace: [], invocations: [], events: [], pathEvents: [], lastExitCode: 0, currentCommand: '' };
}

function shellPath(state, raw = '.', record = true) {
  let value = String(raw || '.');
  if (record) {
    const form = value === '~' || value.startsWith('~/')
      ? 'home'
      : value === '..' || value.startsWith('../') || value.includes('/../')
        ? 'dotdot'
        : value === '.' || value.startsWith('./')
          ? 'dot'
          : value.startsWith('/') ? 'absolute' : 'relative';
    state.pathEvents.push({ command: state.currentCommand, raw: value, form });
  }
  if (value === '~' || value.startsWith('~/')) value = `/home/learner${value.slice(1)}`;
  return posix.resolve(state.cwd, value);
}

function requireDirectory(state, raw) {
  const path = shellPath(state, raw);
  if (!state.directories.has(path)) throw new Error(`${raw}: 不是可用目录`);
  return path;
}

function requireFile(state, raw) {
  const path = shellPath(state, raw);
  const file = state.files.get(path);
  if (!file) throw new Error(`${raw}: 没有这个文件`);
  return { path, file };
}

function parentExists(state, path) {
  return state.directories.has(posix.dirname(path));
}

function tokenize(line) {
  if (/[;&`]/.test(line) || line.includes('$(') || line.includes('${')) throw new Error('模拟终端不支持命令替换、后台执行或命令连接符');
  const tokens = [];
  let token = '', quote = '';
  const push = () => { if (token) tokens.push(token); token = ''; };
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    const next = line[index + 1];
    if (quote) {
      if (character === quote) quote = '';
      else if (character === '\\' && quote === '"' && index + 1 < line.length) token += line[++index];
      else if (character === '$' && next === '?' && quote !== "'") { token += EXIT_STATUS_PLACEHOLDER; index++; }
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (/\s/.test(character)) { push(); continue; }
    if (character === '|') { push(); tokens.push('|'); continue; }
    if (character === '>') {
      push();
      if (line[index + 1] === '>') { tokens.push('>>'); index++; }
      else tokens.push('>');
      continue;
    }
    if (character === '$' && line[index + 1] === '?') { token += EXIT_STATUS_PLACEHOLDER; index++; continue; }
    if (character === '\\' && index + 1 < line.length) token += line[++index];
    else token += character;
  }
  if (quote) throw new Error('引号没有闭合');
  push();
  return tokens;
}

function modeText(mode, directory = false) {
  const bits = [...mode].map(Number);
  const groups = bits.map(value => `${value & 4 ? 'r' : '-'}${value & 2 ? 'w' : '-'}${value & 1 ? 'x' : '-'}`).join('');
  return `${directory ? 'd' : '-'}${groups}`;
}

function listEntries(state, path, long) {
  if (state.files.has(path)) {
    const file = state.files.get(path);
    return `${long ? `${modeText(file.mode)} ` : ''}${posix.basename(path)}\n`;
  }
  if (!state.directories.has(path)) throw new Error(`${path}: 没有这个文件或目录`);
  const prefix = path === '/' ? '/' : `${path}/`;
  const entries = new Map();
  for (const directory of state.directories) {
    if (directory === path || !directory.startsWith(prefix)) continue;
    const rest = directory.slice(prefix.length);
    if (!rest || rest.includes('/')) continue;
    entries.set(rest, { directory: true, mode: '755' });
  }
  for (const [filePath, file] of state.files) {
    if (!filePath.startsWith(prefix)) continue;
    const rest = filePath.slice(prefix.length);
    if (!rest || rest.includes('/')) continue;
    entries.set(rest, { directory: false, mode: file.mode });
  }
  return [...entries.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entry]) => `${long ? `${modeText(entry.mode, entry.directory)} ` : ''}${name}`)
    .join('\n') + (entries.size ? '\n' : '');
}

function createDirectory(state, path, parents) {
  if (state.directories.has(path)) return;
  if (!parents && !parentExists(state, path)) throw new Error(`${path}: 上级目录不存在`);
  if (parents) {
    let current = '/';
    for (const part of path.split('/').filter(Boolean)) {
      current = posix.join(current, part);
      state.directories.add(current);
    }
  } else state.directories.add(path);
}

function commandOutput(state, tokens, input, previousStatus) {
  const [command, ...args] = tokens;
  state.commandExitCode = 0;
  if (command === 'pwd') {
    if (args.length) throw new Error('pwd: 不需要参数');
    return `${state.cwd}\n`;
  }
  if (command === 'whoami') return 'learner\n';
  if (command === 'cd') {
    if (args.length > 1) throw new Error('cd: 参数过多');
    state.cwd = requireDirectory(state, args[0] || '/home/learner');
    return '';
  }
  if (command === 'ls') {
    const long = args.includes('-l');
    const paths = args.filter(value => value !== '-l');
    if (paths.length > 1) throw new Error('ls: 模拟终端一次只列出一个路径');
    return listEntries(state, shellPath(state, paths[0] || '.', paths.length > 0), long);
  }
  if (command === 'cat') {
    if (!args.length) return input;
    return args.map(value => requireFile(state, value).file.content).join('');
  }
  if (command === 'echo') {
    const newline = args[0] !== '-n';
    const values = newline ? args : args.slice(1);
    return `${values.join(' ')}${newline ? '\n' : ''}`;
  }
  if (command === 'false') {
    if (args.length) throw new Error('false: 不需要参数');
    state.commandExitCode = 1;
    return '';
  }
  if (command === 'mkdir') {
    const parents = args[0] === '-p';
    const paths = parents ? args.slice(1) : args;
    if (!paths.length) throw new Error('mkdir: 缺少目录名');
    for (const raw of paths) createDirectory(state, shellPath(state, raw), parents);
    return '';
  }
  if (command === 'touch') {
    if (!args.length) throw new Error('touch: 缺少文件名');
    for (const raw of args) {
      const path = shellPath(state, raw);
      if (!parentExists(state, path)) throw new Error(`${raw}: 上级目录不存在`);
      if (!state.files.has(path)) state.files.set(path, { content: '', mode: '644' });
    }
    return '';
  }
  if (command === 'cp' || command === 'mv') {
    if (args.length !== 2) throw new Error(`${command}: 需要源文件和目标文件`);
    const source = requireFile(state, args[0]);
    let destination = shellPath(state, args[1]);
    if (state.directories.has(destination)) destination = posix.join(destination, posix.basename(source.path));
    if (!parentExists(state, destination)) throw new Error(`${args[1]}: 上级目录不存在`);
    state.files.set(destination, { ...source.file });
    if (command === 'mv') state.files.delete(source.path);
    return '';
  }
  if (command === 'rm') {
    if (!args.length) throw new Error('rm: 缺少文件名');
    for (const raw of args) {
      const { path } = requireFile(state, raw);
      state.files.delete(path);
    }
    return '';
  }
  if (command === 'chmod') {
    if (args.length !== 2 || !/^[0-7]{3}$/.test(args[0])) throw new Error('chmod: 使用三位八进制权限和一个文件名');
    requireFile(state, args[1]).file.mode = args[0];
    return '';
  }
  if (command === 'stat') {
    if (args.length !== 3 || args[0] !== '-c' || args[1] !== '%a') throw new Error('stat: 模拟终端仅支持 stat -c %a 文件');
    return `${requireFile(state, args[2]).file.mode}\n`;
  }
  if (command === 'grep') {
    const insensitive = args[0] === '-i';
    const values = insensitive ? args.slice(1) : args;
    if (!values.length || values.length > 2) throw new Error('grep: 需要模式，可选一个文件');
    const pattern = insensitive ? values[0].toLowerCase() : values[0];
    const source = values[1] ? requireFile(state, values[1]).file.content : input;
    const lines = source.split('\n').filter((line, index, all) => line || index < all.length - 1);
    const matches = lines.filter(line => (insensitive ? line.toLowerCase() : line).includes(pattern));
    state.commandExitCode = matches.length ? 0 : 1;
    return matches.length ? `${matches.join('\n')}\n` : '';
  }
  if (command === 'head') {
    let count = 10, file = '';
    if (args[0] === '-n') {
      count = Number(args[1]);
      file = args[2] || '';
      if (!Number.isInteger(count) || count < 0) throw new Error('head: -n 后需要非负整数');
    } else file = args[0] || '';
    const source = file ? requireFile(state, file).file.content : input;
    const lines = source.split('\n');
    if (lines.at(-1) === '') lines.pop();
    return lines.length ? `${lines.slice(0, count).join('\n')}\n` : '';
  }
  if (command === 'wc') {
    if (args[0] !== '-l' || args.length > 2) throw new Error('wc: 模拟终端仅支持 wc -l [文件]');
    const source = args[1] ? requireFile(state, args[1]).file.content : input;
    return `${(source.match(/\n/g) || []).length}\n`;
  }
  if (command === 'ps') {
    if (args.length) throw new Error('ps: 此练习只需使用 ps');
    return `PID COMMAND\n${[...state.processes].map(([pid, name]) => `${pid} ${name}`).join('\n')}\n`;
  }
  if (command === 'kill') {
    if (args.length !== 1 || !/^\d+$/.test(args[0])) throw new Error('kill: 需要一个进程 PID');
    const pid = Number(args[0]);
    if (!state.processes.delete(pid)) throw new Error(`kill: 没有 PID ${pid}`);
    return '';
  }
  if (command === 'help') {
    if (args.length !== 1) throw new Error('help: 需要一个命令名');
    return `${args[0]}: 这是练习终端中的受控命令；先看参数，再运行。\n`;
  }
  throw Object.assign(new Error(`${command}: 模拟终端暂不支持这个命令`), { exitCode: 127 });
}

function executeSegment(state, tokens, input, metadata) {
  const previousStatus = metadata.previousStatus;
  const exitStatusExpanded = tokens.some(token => token.includes(EXIT_STATUS_PLACEHOLDER));
  const expandedTokens = tokens.map(token => token.replaceAll(EXIT_STATUS_PLACEHOLDER, String(previousStatus)));
  const rawTokens = tokens.map(token => token.replaceAll(EXIT_STATUS_PLACEHOLDER, '$?'));
  const redirectIndex = expandedTokens.findIndex(token => token === '>' || token === '>>');
  let commandTokens = expandedTokens, rawCommandTokens = rawTokens, redirect = null;
  if (redirectIndex >= 0) {
    if (redirectIndex === 0 || redirectIndex !== expandedTokens.length - 2) throw new Error('重定向符号后需要且只能跟一个文件名');
    commandTokens = expandedTokens.slice(0, redirectIndex);
    rawCommandTokens = rawTokens.slice(0, redirectIndex);
  }
  state.currentCommand = commandTokens[0];
  if (redirectIndex >= 0) {
    const path = shellPath(state, expandedTokens[redirectIndex + 1]);
    if (!parentExists(state, path)) throw new Error(`${path}: 上级目录不存在`);
    const previous = state.files.get(path);
    redirect = { append: expandedTokens[redirectIndex] === '>>', operator: expandedTokens[redirectIndex], path, rawPath: rawTokens[redirectIndex + 1] };
    if (!redirect.append || !previous) state.files.set(path, { content: '', mode: previous?.mode || '644' });
  }
  const output = commandOutput(state, commandTokens, input, previousStatus);
  state.lastExitCode = state.commandExitCode;
  state.trace.push(commandTokens[0]);
  state.invocations.push([...commandTokens]);
  state.events.push({
    command: commandTokens[0], args: commandTokens.slice(1), rawArgs: rawCommandTokens.slice(1),
    pipelineId: metadata.pipelineId, segmentIndex: metadata.segmentIndex,
    pipedFrom: metadata.pipedFrom, pipedTo: metadata.pipedTo,
    redirect: redirect?.operator || '', redirectPath: redirect?.path || '',
    visibleOutput: !redirect && !metadata.pipedTo, exitStatusExpanded
  });
  if (!redirect) return output;
  const current = state.files.get(redirect.path);
  state.files.set(redirect.path, { content: redirect.append ? `${current?.content || ''}${output}` : output, mode: current?.mode || '644' });
  return '';
}

function executeLine(state, line, stdin) {
  const tokens = tokenize(line);
  if (!tokens.length) return '';
  const segments = [];
  let current = [];
  for (const token of tokens) {
    if (token === '|') {
      if (!current.length) throw new Error('管道符两侧都需要命令');
      segments.push(current); current = [];
    } else current.push(token);
  }
  if (!current.length) throw new Error('管道符两侧都需要命令');
  segments.push(current);
  const stateful = new Set(['cd', 'mkdir', 'touch', 'cp', 'mv', 'rm', 'chmod', 'kill']);
  if (segments.length > 1 && segments.some(segment => stateful.has(segment[0]))) {
    throw new Error('会改变状态的命令不能放进本练习的管道');
  }
  const pipelineId = state.events.length + 1;
  const previousStatus = state.lastExitCode;
  let output = stdin;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    output = executeSegment(state, segment, output, {
      pipelineId,
      segmentIndex: index,
      previousStatus,
      pipedFrom: index > 0 ? segments[index - 1][0] : '',
      pipedTo: index + 1 < segments.length ? segments[index + 1][0] : ''
    });
  }
  return output;
}

/** Run a deterministic Linux command model. It never invokes a real shell or touches host files. */
export function runLinuxShell(script, stdin = '') {
  if (typeof script !== 'string' || !script.trim()) return resultError('请先填写 Linux 命令。');
  if (Buffer.byteLength(script) > MAX_SCRIPT_BYTES) return resultError('命令脚本最多 8 KiB。');
  if (typeof stdin !== 'string' || Buffer.byteLength(stdin) > MAX_STDIN_BYTES) return resultError('练习输入最多 16 KiB。');
  const lines = script.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (lines.length > MAX_COMMANDS) return resultError(`一次最多运行 ${MAX_COMMANDS} 行命令。`);
  const state = initialState();
  let stdout = '';
  try {
    for (const line of lines) {
      stdout += executeLine(state, line, stdin);
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) return resultError('模拟终端输出超过 64 KiB。', stdout.slice(0, MAX_OUTPUT_BYTES));
    }
    return {
      phase: 'run', passed: state.lastExitCode === 0, stdout, stderr: '', exitCode: state.lastExitCode, signal: null,
      cwd: state.cwd,
      trace: [...state.trace],
      invocations: state.invocations.map(tokens => [...tokens]),
      events: state.events.map(event => ({ ...event, args: [...event.args], rawArgs: [...event.rawArgs] })),
      pathEvents: state.pathEvents.map(event => ({ ...event })),
      state: {
        files: Object.fromEntries([...state.files].map(([path, file]) => [path, { content: file.content, mode: file.mode }])),
        processes: [...state.processes].map(([pid, name]) => ({ pid, name }))
      }
    };
  } catch (error) {
    return resultError(error.message, stdout, error.exitCode || 1);
  }
}

export const LINUX_SHELL_LIMITS = Object.freeze({
  maxScriptBytes: MAX_SCRIPT_BYTES,
  maxStdinBytes: MAX_STDIN_BYTES,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  maxCommands: MAX_COMMANDS
});
