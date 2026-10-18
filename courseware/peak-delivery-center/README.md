# 第七章 C++ 配送中心课程包

- `project/`：最终完整作品，`make test && make run && make benchmark`。
- `states/`：30 个逐节累积的独立可运行项目，每个状态均包含全部所需文件。
- `manifest.json`：每一步完整文件、相对上一步的 `copyFiles`、运行命令与可选实验。
- `generate.py`：课程代码唯一生成源，修改后运行 `python3 generate.py` 同步所有快照。

页面每小节只需要按 `copyFiles` 新增或覆盖文件；最后得到的文件应与 `project/` 完全一致。
