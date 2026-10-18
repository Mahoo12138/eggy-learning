# 蛋仔岛夜班巡检台

这是“恐龙蛋”课程的完整可运行参考工程。它不是普通的 CRUD 练习：`patrold` 会真正创建和监管多个进程，`patrol-worker` 会在受限资源中执行巡检，`patrolctl` 通过命名管道给常驻总控进程发送命令。

工程刻意把操作系统机制放在业务行为里：

- `fork + exec`：总控进程创建子进程，再用真正的巡检程序替换子进程映像；
- `waitpid(WNOHANG)`：回收退出状态，避免僵尸进程；
- 匿名管道 + 长度前缀帧：巡检员向总控台报告结果，能够处理半包和粘包；
- `poll`：一个线程同时监听信号桥、控制 FIFO 和所有报告管道；
- self-pipe：信号处理函数只写一个字节，完整清理回到普通控制流执行；
- `CLOCK_MONOTONIC` + 进程组：按绝对截止时间处理超时，先向整个进程组发 `SIGTERM`，宽限期后再发 `SIGKILL`；
- `setrlimit`：限制巡检进程的 CPU 时间、地址空间和文件描述符数量；
- 追加事件日志 + 原子状态快照：事件保留发生顺序，`state.json` 通过“临时文件写完后替换”发布完整版本。

## 构建和验证

需要 Linux、CMake 3.16 以上版本和支持 C17 的编译器：

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

也可以直接在 Linux Docker 容器中完成配置、编译、15 项测试和一次独立冒烟运行：

```sh
./verify-docker.sh
```

`verify.sh` 使用独立构建目录运行同一套检查：

```sh
./verify.sh /tmp/patrol-build
```

## 第一次运行

一次性启动三个巡检员：一个通过、一个主动报告失败、一个卡住并由总控台超时终止。

```sh
runtime=$(mktemp -d)
./build/patrold \
  --runtime "$runtime" \
  --worker ./build/patrol-worker \
  --timeout-ms 500 \
  --once \
  --spawn north:ok \
  --spawn south:fail \
  --spawn stuck:hang

cat "$runtime/state.json"
cat "$runtime/events.log"
```

`patrold` 的返回值表示总控台本身是否正常完成。单个巡检员报告失败会记录在状态和日志里，但不会让总控台崩溃。

## 常驻模式与控制命令

终端 A：

```sh
runtime=/tmp/eggy-patrol
rm -rf "$runtime"
./build/patrold --runtime "$runtime" --worker ./build/patrol-worker --timeout-ms 3000
```

终端 B：

```sh
./build/patrolctl --runtime /tmp/eggy-patrol run gate ok
./build/patrolctl --runtime /tmp/eggy-patrol status
./build/patrolctl --runtime /tmp/eggy-patrol run stuck hang
./build/patrolctl --runtime /tmp/eggy-patrol stop
```

支持的巡检模式：

| 模式 | 行为 | 观察重点 |
| --- | --- | --- |
| `ok` | 写入成功报告并以 0 退出 | 报告帧、正常回收 |
| `fail` | 写入失败报告并以 2 退出 | 业务失败与总控故障的区别 |
| `hang` | 一直等待信号 | 单调时钟超时、进程组终止 |
| `cpu` | 持续占用 CPU | `RLIMIT_CPU` 与异常退出 |

## 进程与数据流

```text
patrolctl ──命名管道命令──> patrold
                              │
                              ├─ fork/exec ─> patrol-worker (north)
                              │                    │
                              ├─ fork/exec ─> patrol-worker (south)
                              │                    │
                              └─ poll <────匿名管道报告帧
                                   │
                                   ├─ events.log   追加事件
                                   └─ state.json   原子快照
```

报告协议是二进制长度前缀帧。4 字节网络字节序长度之后依次放状态、名称长度、消息长度和两段文本。`PatrolFrameReader` 保存没有收完整的字节，因此一次 `read` 只拿到半帧或同时拿到多帧时都不会错位。

## 目录与课程章节的对应关系

| 目录 | 责任 | 主要系统概念 |
| --- | --- | --- |
| `src/common` | I/O、协议、时钟、文件和错误封装 | 文件描述符、短读写、单调时钟、原子替换 |
| `src/supervisor/spawn*` | 创建和替换巡检进程 | `fork`、`exec`、进程组、`rlimit` |
| `src/supervisor/reaper*` | 收集退出状态 | `SIGCHLD`、`waitpid`、僵尸进程 |
| `src/supervisor/signal_bridge*` | 把异步信号带回事件循环 | async-signal-safe、self-pipe |
| `src/supervisor/event_loop*` | 统一调度全部事件 | `poll`、状态机、截止时间 |
| `src/supervisor/journal*`、`state*` | 保存可追查状态 | 事件日志、快照、故障恢复证据 |
| `src/worker` | 执行隔离后的巡检任务 | 进程映像、退出码、资源边界 |
| `tools/patrolctl.c` | 向总控台发送命令 | FIFO、进程间通信 |
| `tests` | 单元与端到端故障验证 | 半包、失败、卡死、信号、清理 |

## 运行时文件

- `control.fifo`：控制命令入口；总控退出时删除。
- `events.log`：制表符分隔的追加日志，字段为单调时间、事件、巡检 ID、名称和详情。
- `state.json`：当前完整快照，可直接由其他程序读取。写盘过程不会暴露半份 JSON。

完整参考工程没有空函数、伪代码或待补占位。课程中的每一步可以从该目录抽取当步的完整文件快照；学习者完成指定的小修改后，应立即重新构建并运行当步验证。

## 为什么第一步就有完整脚手架

代码包有意把这份可运行工程作为课程的 supplied scaffold。每个阶段都能配置、编译和测试，学习者不会因为尚未讲到的模块缺失而被链接错误卡住；页面在当前步骤只展示该步的目标文件，不会一次性把 61 个文件全堆到视口。学习动作固定为“复制本步完整文件 → 做一个会改变运行行为或测试输入的有界修改 → 运行本章测试 → 保存章末快照”。这些小改动不预先写进参考快照，避免下一步替学习者完成；最终源码下载仍对应经过 15 项测试的统一参考版本。
