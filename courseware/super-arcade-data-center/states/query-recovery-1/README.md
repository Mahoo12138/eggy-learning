# 超级凤凰蛋：蛋仔游戏厅联机积分中心

作品由 C17 客户端 `client/main.c` → C17 网关 `gateway/main.c` → C++20 服务 `service/main.cpp` → SQLite `db/schema.sql` 组成。前几节逐步建立网络基础，第六章才接入 C++ 数据服务。

要求：macOS/Linux，C17/C++20 编译器、make、Python3、SQLite3 开发头和链接库。只使用系统 POSIX/pthread/SQLite 与 Python 标准库。

```sh
make all
make test
make run
```

每份状态包含全部源码，可复制到空目录独立构建。课程包 `states/` 有30个状态；`manifest.json` 的 `copyFiles` 指定相对前节完整新增/覆盖文件，也包含该节可选实验文件。可选实验结束后恢复原值，再继续后续快照。

最终交互（在项目目录运行，每条命令单独开终端）：

```sh
./build/service arcade.db 9101
./build/gateway 9100 9101
./build/client 9100 'ADD|event_001|alice|10' 1
./build/client 9100 'REDEEM|event_002|alice|3' 1
./build/client 9100 'BALANCE|alice'
./build/client 9100 'TOP|5'
./build/client 9100 'HISTORY|alice'
```

服务端和网关的监听端口可设0，stdout分别打印 `SERVICE_READY=端口` 和 `GATEWAY_READY=端口`。只监听127.0.0.1；没有身份认证、TLS或公网攻击防护。SIGTERM/SIGINT停止接受新连接，取消排队连接并等待在途处理结束。进程重新启动后使用同一个数据库路径即可查询已提交状态。

协议是4字节网络序无符号长度后跟1..4096字节正文；不接受正文NUL。一个连接最多16帧。玩家和事件ID为1..32位ASCII字母、数字、下划线或连字符。金额1..1000000，余额0..1000000。可用请求为PING|player、ADD|event|player|amount、REDEEM|event|player|amount、BALANCE|player、TOP|1..10、HISTORY|player。HISTORY返回最早20条流水；此教学版本不提供分页。

网络使用固定4个worker和容量8的接收队列，队满关闭新连接。每条TCP连接从accept起共享1000ms绝对deadline，包含排队和同连接的所有帧；网关转发使用该连接剩余预算。C++服务自身从accept计时，所以这不是整个业务链路的统一事务期限。所有worker都被慢连接占用时不保证快请求立即完成；deadline会释放占用。SQLite busy等待最多300ms，它与网络deadline是不同边界；数据库业务开始后不因客户端断开强杀事务。客户端最多重试2次（共3次尝试），每次新建连接并保留完全相同的正文与事件ID。

Store用一个连接和mutex保护完整业务操作；网络可以并发接入，但SQLite仍是单写者。BEGIN IMMEDIATE拿不到写锁返回ERR|BUSY，调用者可在状态明确后有限重试。Transaction在提交成功后才放弃回滚责任；失败的COMMIT仍由析构回滚。每个服务进程都启用foreign_keys与有界busy等待。

最终事件记录、余额和流水在同一事务提交。相同事件ID和规范化内容重提返回第一次保存的响应；金额0005与5视为相同数值。相同ID改变玩家、类型或金额返回ERR|CONFLICT。余额不足/余额上限等确定业务拒绝也保存第一次结果；数据库临时错误不保存为事件结果。响应中的余额是第一次执行后的快照，当前余额通过BALANCE查询。保证已提交事件的业务效果不重复，不宣称TCP恰好一次投递。requests记录不会自动清理，需要真实产品另行设计容量与保留期。

逐节测试使用独立临时数据库。最终持久数据库应从最终schema创建；本课程未实现旧版数据库升级迁移，不能把第六、七章产生的重复流水直接当作已兼容升级数据。WAL是日志模式，不能作为备份策略；不要只复制正在使用的.db文件并假定备份完整。

显式故障注入仅供测试，正常运行不设置：`ARCADE_TEST_DROP_ACK_ONCE=事件ID`在该事件新提交成功后第一次关闭连接而不发送ACK；回放历史响应不会再次触发。`ARCADE_TEST_FAIL_AFTER_DEBIT=事件ID`在更新余额后、插入流水前抛错，验证事务全部回滚。

测试使用真实socket分片/合帧、超长长度、慢连接、断线、有限重试、回滚、持久重提、重启查询，以及两个独立服务进程共享数据库的兑换竞争。`make run`只使用临时数据库，不会修改你手动启动的持久数据。
