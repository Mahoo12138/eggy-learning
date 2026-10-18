# 第八段位：超级凤凰蛋完整课程代码包

- `project/`：最终 C 客户端 → C 网关 → C++ 服务 → SQLite 作品。
- `states/`：30 个累积、独立可构建的逐节完整工程。
- `manifest.json`：每节完整文件、copyFiles、命令和可选修改。
- `generate.py`：生成源；修改后运行 `python3 generate.py` 同步所有状态。

最终验证：`make -C project all test run`。每个状态都可 `make test` 和 `make run`。
详细协议、超时/并发边界、幂等及数据迁移限制见 `project/README.md`。
