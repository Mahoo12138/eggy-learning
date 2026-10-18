// Publish the Linux night-patrol reference project as a sequence of complete,
// runnable course snapshots. The complete reference tree is supplied as the
// baseline scaffold; each lesson card only exposes that lesson's target files.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishProjectCode } from '../lib/project-code-publisher.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check')) throw new Error('仅支持 --check');
const root = fileURLToPath(new URL('..', import.meta.url));
const projectId = 'dinosaur-night-patrol-project';
const sourceRoot = join(root, 'courseware/dinosaur-night-patrol/final');

const chapterTests = new Map([
  ['syscall-boundary', 'test_os_error'],
  ['fd-basics', 'test_io'],
  ['filesystem-state', 'test_fs'],
  ['fork-model', 'test_fork_model'],
  ['exec-wait', 'test_spawn'],
  ['process-lifecycle', 'test_reaper'],
  ['pipe-reports', 'test_protocol'],
  ['poll-event-loop', 'test_event_loop'],
  ['signals', 'test_signal_bridge'],
  ['deadline-control', 'test_deadline'],
  ['resource-isolation', 'test_isolation'],
  ['supervisor', 'test_supervisor']
]);

async function readTree(directory, prefix = '') {
  const result = {};
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await readTree(directory, path));
    else if (entry.isFile()) result[path] = await readFile(join(directory, path), 'utf8');
  }
  return result;
}

const learnerChanges = {
  'syscall-boundary-01': {
    file: 'src/supervisor/main.c', anchor: 'int timeout_ms = 1000;',
    instruction: '把默认巡检超时从 1000ms 改为 1500ms；不传 --timeout-ms 运行 hang 模式，用实际耗时确认默认值来自这里。',
    expectedFragment: 'int timeout_ms = 1500;'
  },
  'syscall-boundary-02': {
    file: 'src/common/os_error.c', anchor: 'const char *message = strerror(error_number);',
    instruction: '在 strerror 调用前增加一条 fprintf(stderr, ...) 诊断，输出被保存的 errno 数字；运行 test_os_error，确认格式化发生得再晚也没有丢失错误号。',
    expectedFragment: 'fprintf(stderr, "os_error_text: errno=%d\\n", error_number);'
  },
  'syscall-boundary-03': {
    file: 'tests/test_os_error.c', anchor: 'assert(buffer[0] != \'\\0\');',
    instruction: '在现有 ENOENT 检查后再格式化 EACCES，并断言结果仍非空；同一个错误对象测试因此覆盖两种真正不同的系统错误。',
    expectedFragment: 'assert(os_error_text(EACCES, buffer, sizeof(buffer)) == buffer);'
  },
  'fd-basics-01': {
    file: 'tests/test_io.c', anchor: 'const char text[] = "pipe handles bytes, not messages";',
    instruction: '把测试负载换成更长的字节串，保留 sizeof(text) 驱动的写入、缓冲区和比较；确认接口不依赖原字符串长度。',
    expectedFragment: 'const char text[] = "a longer byte stream can cross several read boundaries";'
  },
  'fd-basics-02': {
    file: 'tests/test_io.c', anchor: 'assert(pipe(descriptors) == 0);',
    instruction: '创建管道后加入零长度写入断言，确认 write_all 对空输入立即成功，不会错误地等待进展。',
    expectedFragment: 'assert(io_write_all(descriptors[1], "", 0) == 0);'
  },
  'fd-basics-03': {
    file: 'src/common/fd_log.c', anchor: 'fprintf(stderr, "open fds:");',
    instruction: '把 fd 诊断前缀改成带进程角色的 patrold open fds，再运行一次程序；确认日志后端仍只写 stderr。',
    expectedFragment: 'fprintf(stderr, "patrold open fds:");'
  },
  'filesystem-state-01': {
    file: 'src/supervisor/runtime.c', anchor: 'if (fs_mkdir_p(directory, 0755) != 0 ||',
    instruction: '把运行目录权限从 0755 收紧到 0700，启动后用 stat -c %a 检查；控制 FIFO 仍保持 0600。',
    expectedFragment: 'if (fs_mkdir_p(directory, 0700) != 0 ||'
  },
  'filesystem-state-02': {
    file: 'tests/test_fs.c', anchor: 'const char second[] = "second version";',
    instruction: '把第二版快照内容换成更长的字符串；读取长度和内容断言都继续引用 second，验证替换不是碰巧只适配短文本。',
    expectedFragment: 'const char second[] = "second complete snapshot after replacement";'
  },
  'filesystem-state-03': {
    file: 'tests/test_fs.c', anchor: 'assert(strcmp(output, second) == 0);',
    instruction: '在完整读取断言后，用容量为 1 的缓冲区再读一次，并断言返回 0 且第一个字节为 NUL；观察有界读取如何保持字符串可用。',
    expectedFragment: "assert(fs_read_text(file, output, 1) == 0 && output[0] == '\\0');"
  },
  'fork-model-01': {
    file: 'src/supervisor/worker.c', anchor: 'table->next_id = 1;',
    instruction: '把首个 Worker ID 改为 100，再运行一次性巡检并查看 state.json；确认父进程登记的业务 ID 与内核 PID 是两套不同标识。',
    expectedFragment: 'table->next_id = 100;'
  },
  'fork-model-02': {
    file: 'tests/test_fork_model.c', anchor: 'int value = 7;',
    instruction: '把 fork 前的 value 从 7 改为 11，并同步把父进程最后的断言改为 11；子进程仍改成 99，验证父值没有被子进程写回。',
    expectedFragment: 'int value = 11;'
  },
  'fork-model-03': {
    file: 'tests/test_fork_model.c', anchor: 'value = 99;',
    instruction: '把子进程写入值从 99 改为 123，并同步修改子分支退出条件；父分支的初值断言保持不变。',
    expectedFragment: 'value = 123;'
  },
  'exec-wait-01': {
    file: 'src/worker/main.c', anchor: 'fprintf(stderr, "usage: %s --name NAME --mode ok|fail|hang|cpu --report-fd FD\\n", program);',
    instruction: '把帮助文字前缀从 usage 改成 patrol-worker usage，故意传入非法参数观察 stderr 和退出码 64。',
    expectedFragment: 'fprintf(stderr, "patrol-worker usage: %s --name NAME --mode ok|fail|hang|cpu --report-fd FD\\n", program);'
  },
  'exec-wait-02': {
    file: 'tests/test_spawn.c', anchor: 'Worker *worker = worker_table_add(&table, "probe", "ok");',
    instruction: '把 worker 名称换成 gate-check；构建并运行测试，确认名称只是独立 argv 数据，不会被 shell 再拆分。',
    expectedFragment: 'Worker *worker = worker_table_add(&table, "gate-check", "ok");'
  },
  'exec-wait-03': {
    file: 'tests/test_spawn.c', anchor: 'assert(spawn_worker(worker, "/bin/true", 1000, &profile) == 0);',
    instruction: '把可执行文件从 /bin/true 换成 /bin/false，并在 waitpid 后断言 WEXITSTATUS(status) == 1；这会证明 exec 成功与业务成功是两件事。',
    expectedFragment: 'assert(spawn_worker(worker, "/bin/false", 1000, &profile) == 0);'
  },
  'process-lifecycle-01': {
    file: 'tests/test_reaper.c', anchor: 'Worker *worker = worker_table_add(&table, "short", "ok");',
    instruction: '把 worker 名称换成 quick-worker，运行测试并在调试器里观察名称贯穿 RUNNING 到 EXITED。',
    expectedFragment: 'Worker *worker = worker_table_add(&table, "quick-worker", "ok");'
  },
  'process-lifecycle-02': {
    file: 'tests/test_reaper.c', anchor: 'for (int attempt = 0; attempt < 100 && worker->phase != WORKER_EXITED; ++attempt) {',
    instruction: '把轮询上限从 100 次改为 200 次，但仍保持每轮 WNOHANG 回收；测试等待预算变大，单次调用依旧不能阻塞。',
    expectedFragment: 'for (int attempt = 0; attempt < 200 && worker->phase != WORKER_EXITED; ++attempt) {'
  },
  'process-lifecycle-03': {
    file: 'tests/test_reaper.c', anchor: 'if (pid == 0) _exit(7);',
    instruction: '把子进程退出码改为 23，并同步修改 worker->exit_code 断言；确认解码后得到的是业务退出码。',
    expectedFragment: 'if (pid == 0) _exit(23);'
  },
  'pipe-reports-01': {
    file: 'tests/test_protocol.c', anchor: 'PatrolReport input = {.status = 3};',
    instruction: '把报告状态从 3 改为 7；编码和解码仍通过 input/output 比较，确认状态字节不是被写死的。',
    expectedFragment: 'PatrolReport input = {.status = 7};'
  },
  'pipe-reports-02': {
    file: 'src/worker/main.c', anchor: '(void)snprintf(report.message, sizeof(report.message), "%s", check.message);',
    instruction: '在报告消息前加入当前模式，格式改为 [mode] message；运行 ok 与 fail 两种 worker，确认父进程收到的帧内容可区分来源模式。',
    expectedFragment: '(void)snprintf(report.message, sizeof(report.message), "[%s] %s", mode, check.message);'
  },
  'pipe-reports-03': {
    file: 'tests/test_protocol.c', anchor: 'assert(protocol_reader_feed(&reader, wire, 3) == 0);',
    instruction: '把第一次喂给解析器的切片从 3 字节缩为 1 字节，并同步把第二次的起点与长度从 3 改为 1；测试仍须重组出完整帧。',
    expectedFragment: 'assert(protocol_reader_feed(&reader, wire, 1) == 0);'
  },
  'poll-event-loop-01': {
    file: 'tests/test_event_loop.c', anchor: 'assert(control_parse_line("status", &command) == 1 && command.kind == CONTROL_STATUS);',
    instruction: '在 status 断言后加入 stop 命令解析断言，确认同一个事件源可以产生不同的有限事件类型。',
    expectedFragment: 'assert(control_parse_line("stop", &command) == 1 && command.kind == CONTROL_STOP);'
  },
  'poll-event-loop-02': {
    file: 'tests/test_event_loop.c', anchor: 'assert(control_parse_line("run gate ok", &command) == 1 && command.kind == CONTROL_RUN);',
    instruction: '把 run 命令中的 gate 改为 fountain，并同步修改下一行名称断言；确认每个事件携带自己的源数据。',
    expectedFragment: 'assert(control_parse_line("run fountain ok", &command) == 1 && command.kind == CONTROL_RUN);'
  },
  'poll-event-loop-03': {
    file: 'tools/patrolctl.c', anchor: 'struct timespec delay = {.tv_sec = 0, .tv_nsec = 100000000};',
    instruction: '把 status 命令读取快照前的等待从 100ms 调成 50ms；连续执行十次 status，观察客户端延迟与偶发读旧快照之间的取舍。',
    expectedFragment: 'struct timespec delay = {.tv_sec = 0, .tv_nsec = 50000000};'
  },
  'signals-01': {
    file: 'tests/test_signal_bridge.c', anchor: 'assert(raise(SIGTERM) == 0);',
    instruction: '把测试信号从 SIGTERM 换成 SIGINT；drain 后仍应得到 stop == 1，证明桥接层按意图归类而不是绑死单个编号。',
    expectedFragment: 'assert(raise(SIGINT) == 0);'
  },
  'signals-02': {
    file: 'tests/test_signal_bridge.c', anchor: 'assert(raise(SIGTERM) == 0);',
    instruction: '把 SIGTERM 换成 SIGCHLD，并把最终断言改成 child == 1 && stop == 0；这会单独验证回收通知通道。',
    expectedFragment: 'assert(raise(SIGCHLD) == 0);'
  },
  'signals-03': {
    file: 'tests/test_signal_bridge.c', anchor: 'assert(raise(SIGTERM) == 0);',
    instruction: '紧接现有 raise 再发送一次 SIGTERM；drain 的 stop 仍只是布尔意图，重复信号不会要求执行两套清理。',
    expectedFragment: 'assert(raise(SIGTERM) == 0);\n  assert(raise(SIGTERM) == 0);'
  },
  'deadline-control-01': {
    file: 'tests/test_deadline.c', anchor: 'first->deadline_ms = now + 80;',
    instruction: '把第一个 deadline 从 now+80 改成 now+60，并同步把最近超时断言改为 60；Fake 时间线应精确反映新边界。',
    expectedFragment: 'first->deadline_ms = now + 60;'
  },
  'deadline-control-02': {
    file: 'tests/test_deadline.c', anchor: 'first->phase = WORKER_RUNNING;',
    instruction: '在设置 RUNNING 后给 first->process_group 赋值 4321，并立刻断言该字段；把 PID 与 PGID 分开观察。',
    expectedFragment: 'first->process_group = 4321;\n  assert(first->process_group == 4321);'
  },
  'deadline-control-03': {
    file: 'tests/test_deadline.c', anchor: 'second->deadline_ms = now + 250;',
    instruction: '把第二个 worker 的截止时间改成 now+400；最近 deadline 仍来自 first，验证晚任务不会延后早任务。',
    expectedFragment: 'second->deadline_ms = now + 400;'
  },
  'resource-isolation-01': {
    file: 'tests/test_isolation.c', anchor: 'SpawnProfile profile = {.cpu_seconds = 1, .address_space_bytes = 64U * 1024U * 1024U, .open_files = 24};',
    instruction: '把测试 profile 的 open_files 从 24 收紧到 16，并同步 getrlimit 断言；限制只作用于 fork 出来的子进程。',
    expectedFragment: 'SpawnProfile profile = {.cpu_seconds = 1, .address_space_bytes = 64U * 1024U * 1024U, .open_files = 16};'
  },
  'resource-isolation-02': {
    file: 'src/supervisor/spawn_profile.c', anchor: '.open_files = 32,',
    instruction: '把默认文件描述符上限从 32 调到 48；运行 worker 并查看 /proc/<pid>/limits，确认限制发生在 exec 前的子进程。',
    expectedFragment: '.open_files = 48,'
  },
  'resource-isolation-03': {
    file: 'src/worker/checks.c', anchor: '(void)snprintf(result->message, sizeof(result->message), "巡检失败: 模拟传感器离线");',
    instruction: '把 fail 模式的消息改成“巡检失败: 南门传感器离线”，运行 fail 与 ok 两个 worker，确认故障内容只落在对应槽位。',
    expectedFragment: '(void)snprintf(result->message, sizeof(result->message), "巡检失败: 南门传感器离线");'
  },
  'supervisor-01': {
    file: 'tests/test_supervisor.c', anchor: 'Worker *worker = worker_table_add(&table, "gate-\\\"A", "ok");',
    instruction: '把名称改成 wheel-"B，并同步 JSON 转义断言；确认状态机保存的是原值，JSON 层只负责正确转义。',
    expectedFragment: 'Worker *worker = worker_table_add(&table, "wheel-\\\"B", "ok");'
  },
  'supervisor-02': {
    file: 'tests/test_supervisor.c', anchor: 'strcpy(worker->report_message, "line one\\nline two");',
    instruction: '把两行报告改成 sensor ok 与 motor stable，并同步 \\u000a 转义断言；原子快照应保存完整新版文本。',
    expectedFragment: 'strcpy(worker->report_message, "sensor ok\\nmotor stable");'
  },
  'supervisor-03': {
    file: 'tests/test_supervisor.c', anchor: 'worker->pid = 123;',
    instruction: '把示例 PID 改为 456，并在渲染后增加对 "pid":456 的断言；恢复证据因此同时核对身份与报告。',
    expectedFragment: 'worker->pid = 456;'
  }
};

function learnerChange(step, files) {
  const source = learnerChanges[step.id];
  if (!source) throw new Error(`${step.id} 缺少有意义的学习者改动`);
  if (!step.targetFiles.includes(source.file)) throw new Error(`${step.id} 的改动文件不属于本步目标：${source.file}`);
  const content = files[source.file];
  if (typeof content !== 'string' || !content.includes(source.anchor)) throw new Error(`${step.id}/${source.file} 找不到改动锚点：${source.anchor}`);
  if (/LEARNER_CHECK|注释/.test(source.expectedFragment)) throw new Error(`${step.id} 不能用注释冒充代码改动`);
  return { id: `${step.id}-bounded-variant`, ...source };
}

function repairOpeningChapter(project) {
  const chapter = project.chapters.find(item => item.id === 'syscall-boundary');
  if (!chapter) throw new Error('缺少 syscall-boundary 章节');
  const [bootstrap, errors, trace] = chapter.guidedSteps;
  Object.assign(bootstrap, {
    title: '从完整脚手架启动第一个真实进程',
    instruction: '复制 CMakeLists.txt 与 main.c 的完整参考版本，先构建 patrold/patrol-worker，再以 --once、--spawn probe:ok 和独立 runtime 目录启动一次巡检。此时只观察 PID、进程退出和 state.json，不读取尚未讲解的配置文件。',
    verify: 'Debug 构建无警告；一次巡检返回 0，state.json 中 reportReceived 为 true，ps 观察到的 patrold PID 与运行进程一致。'
  });
  Object.assign(errors, {
    title: '保存 errno 再把错误说清楚',
    instruction: '实现 os_error_text：调用者在失败系统调用之后立刻保存 errno，再把 ENOENT、EINVAL 等错误号格式化为可读文本；main 继续只负责参数、启动和退出码，不提前引入配置解析。',
    verify: 'test_os_error 同时覆盖 ENOENT、EINVAL 和无效输出缓冲区；错误文本非空，测试与运行命令都不依赖 config/patrol.conf。'
  });
  Object.assign(trace, {
    title: '把一次巡检映射到系统调用',
    instruction: '用 strace -f -yy 跟踪 --once --spawn probe:ok 的完整运行，按进程标出 execve、openat、read、write、wait4 与 exit_group；程序本身不解析或伪造 trace。',
    verify: 'test_os_error 通过；trace.log 能区分 patrold 与 patrol-worker 的调用，并能把关键调用逐一对应到启动、报告、回收和退出阶段。'
  });
}

const result = await publishProjectCode({
  root, projectId, check: args.includes('--check'),
  build: async ({ project }) => {
    const files = await readTree(sourceRoot);
    if (!Object.keys(files).length) throw new Error(`参考工程为空：${relative(root, sourceRoot)}`);

    repairOpeningChapter(project);
    project.version = 3;
    project.guidancePolicy.codeDeliveryContractVersion = 1;

    const states = [{ id: 'dinosaur-reference-scaffold', files }];
    const steps = [];
    let previousStateId = states[0].id;
    for (const chapter of project.chapters) {
      const testName = chapterTests.get(chapter.id);
      if (!testName) throw new Error(`章节 ${chapter.id} 没有对应的独立测试`);
      for (const step of chapter.guidedSteps) {
        for (const path of step.targetFiles) {
          if (typeof files[path] !== 'string') throw new Error(`${step.id} 的完整参考工程缺少 ${path}`);
        }
        step.codeStepId = `${step.id}-code`;
        const toStateId = `${step.id}-ready`;
        states.push({ id: toStateId, files });
        steps.push({
          id: step.codeStepId,
          chapterId: chapter.id,
          guidedStepId: step.id,
          fromStateId: previousStateId,
          toStateId,
          copyFiles: [...step.targetFiles],
          learnerChanges: [learnerChange(step, files)],
          intentionalGaps: [],
          verification: {
            commands: [
              'cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON',
              'cmake --build build --parallel',
              `ctest --test-dir build -R '^${testName}$' --output-on-failure`
            ],
            expected: [
              '配置与编译成功，编译器没有警告或缺失符号。',
              `${testName} 通过；失败时先停在本步，不带着红灯进入下一步。`,
              step.verify
            ]
          }
        });
        previousStateId = toStateId;
      }
      chapter.snapshotStateId = previousStateId;
    }

    const codePackage = {
      schemaVersion: 1,
      projectId,
      states,
      steps,
      finalSource: {
        stateId: previousStateId,
        buildCommands: [
          'cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON',
          'cmake --build build --parallel'
        ],
        runCommands: [
          'ctest --test-dir build --output-on-failure',
          'runtime=$(mktemp -d); ./build/patrold --runtime "$runtime" --worker ./build/patrol-worker --timeout-ms 500 --once --spawn demo:ok; grep -q \'"reportReceived":true\' "$runtime/state.json"; rm -rf "$runtime"'
        ],
        expected: [
          '12 项单元测试和 3 项端到端测试全部通过。',
          '一次性巡检正常退出，state.json 记录完整报告，运行目录可安全删除。',
          '最终工程没有 TODO、伪代码、空函数或需要学习者猜测的省略段。'
        ]
      }
    };

    return { project, codePackage };
  }
});
console.log(`${result.check ? '校验通过，未写入' : result.written ? '已发布' : '内容未变，未写入'}：${result.chapters} 章、${result.steps} 步、${result.states} 个完整快照，课程版本 ${result.publishedRevision}。`);
console.log(`代码包 ${result.packageBytes} bytes，SHA-256 ${result.packageSha256}`);
