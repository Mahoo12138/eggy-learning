# 扩样：公开 BOSS 嵌入式候选清单（等待已登录浏览器核正文）

采集日：2026-10-12。用途：给主采集者提供新的详情入口。**本文件新增有效完整 JD 数为 0；下列候选不可直接加入技能频率分母。**

公开 BOSS 聚合页可以读取职位卡片并取得详情链接，但此次 26 个详情入口均转入安全验证页，未取得完整任职正文；没有尝试绕过验证。卡片片段只用于初筛，不能证明其后没有学历、届别、专业或经验限制，也不能确认职位仍在招聘。主任务已改由登录中的 Edge 核实正文。

## 读取方法与去重

- 通过 `web` 搜索定位 BOSS 官方聚合页，打开页面读取卡片，再点击卡片获取完整 `/job_detail/…html` URL。下列字段来自已打开的聚合页，不以搜索摘要充当完整要求。
- 以详情 URL 的职位 ID 去重，忽略 `www`/`m` 域名及查询参数。26 条均不在原始 `jd-skills-data.json` 的 18 个样本和三个原始 BOSS evidence 文件的 32 个链接中。
- 并行扩样中已有三处交叉：P14 已由 Edge 写为 JD28，P23 已由 Edge 写为 JD27；P20 也在 `expansion-public-cpp.md` 候选中。其余 **23 条是尚未在这些并行文件出现的新候选**（落盘时检查）。后续仍应按职位 ID 去重。
- 所有规模均是本次官方聚合卡片的显示区间，不是工商核验结果；“未取得”表示本次片段没有留下可核字段。公司名为页面展示名。
- 学历为卡片标签。除特别注明外，完整专业范围、毕业届别、实习出勤、任职要求和优先条件均**未取得**，不能标为“无要求”。

## 23 条优先核正文的新候选

先看 P21、P22、P24、P25、P26、P13、P12、P19、P07、P18：以实习或入门为主，企业层次不同。P17 明示 2027 届，只能作为 2028 毕业学生的跨届技能参照。

| ID | 公司／岗位（点击进入详情） | 深圳地点；卡片阶段 | 卡片学历；规模 | 初筛备注：仅片段，非完整要求 |
|---|---|---|---|---|
| P01 | 恒控／[初级嵌入式软件工程师（MCU）](https://www.zhipin.com/job_detail/34d551400c6a0b7803d439S0FlBY.html) | 宝安西乡；1–3 年 | 本科；20–99 人 | 片段提计算机等专业、1 年以上经历；维护产品软件。来源 A。 |
| P02 | 创必得／[初级嵌入式应用开发工程师](https://www.zhipin.com/job_detail/4b58833423fb84f71HN_39u6EFtV.html) | 宝安西乡；1–3 年 | 本科；100–499 人 | 片段为方案、固件及单元测试工作。来源 A。 |
| P03 | 迈进科技／[嵌入式 Linux 软件工程师（接受应届生）](https://m.zhipin.com/job_detail/c61eddea6fc18d711n1639i7FltZ.html) | 福田车公庙；标题接受应届、日薪卡片，具体用工阶段待核 | 本科；20–99 人 | 片段出现 C/C++、数据结构、Linux；多媒体方向。来源 C/G。 |
| P04 | 金九天视／[【初级】Linux 嵌入式软件工程师](https://www.zhipin.com/job_detail/022947368d1d915103N_2t60FlBR.html) | 龙岗坂田；1–3 年 | 本科；100–499 人 | 协议开发、调试验证。来源 B。 |
| P05 | 英汉思动力／[初级嵌入式工程师—预研项目](https://www.zhipin.com/job_detail/8f8cd2bb6972a61b0nN50ty0GVBU.html) | 南山科技园；1–3 年 | 本科；100–499 人 | 软件设计、调试与联调。来源 A。 |
| P06 | 松诺技术／[初级嵌入式软件工程师（zigbee 方向）](https://www.zhipin.com/job_detail/3787c5e8a443db1d03153t68E1tW.html) | 龙岗坂田；1–3 年 | 本科；500–999 人 | 智能家居 Zigbee 产品开发。来源 A。 |
| P07 | 烽航／[初级嵌入式软件工程师](https://www.zhipin.com/job_detail/a586faf7e5c243e41XB72NW5E1VU.html) | 宝安西乡；1 年以内 | 本科；20–99 人 | 片段含 C、OS/MCU；计算机相关专业在优先范围，全文待核。来源 A/B。 |
| P08 | 慧源创新／[嵌入式 Linux 开发工程师（GUI 方向）](https://m.zhipin.com/job_detail/db12a4c83117e7200nd43tS6GFJT.html) | 宝安新安；1–3 年 | 本科；规模未取得 | Linux、LVGL/Qt 设备 GUI；须确认岗位主体是嵌入式。来源 C。 |
| P09 | 人可时代科技有限公司／[嵌入式 Linux 开发工程师](https://m.zhipin.com/job_detail/61c3cd9bb7697d0f1Hx43Nu1EVdX.html) | 宝安西乡；1–3 年 | 本科；规模未取得 | 本次只取得卡片基础字段，正文优先核。来源 C。 |
| P10 | 深圳市华馥科技／[嵌入式软件开发](https://www.zhipin.com/job_detail/18ac6a48af0ed6731Hxy09W4EFBQ.html) | 宝安西乡；1–3 年 | 大专；0–20 人 | C/C++、STM32/复旦微 MCU 开发片段；本科适配仍需全文核。来源 B。 |
| P11 | 妙动科技／[相机软件实习生（Linux）—可转正](https://www.zhipin.com/job_detail/23351769af5d2a270nRy2Nu5FVNR.html) | 南山科技园；实习 | 本科；100–499 人 | 卡片片段要求至少 6 个月、尽快到岗；不把“可转正”视为承诺。来源 D。 |
| P12 | 智安信息／[Linux C 开发实习生](https://www.zhipin.com/job_detail/f66b2844e25043411XB509y9GFFZ.html) | 南山前海；实习 | 本科；20–99 人 | 网络安全产品模块与 MCU 驱动片段。以打开页面的“智安信息”为准，旧摘要曾错配公司。来源 D。 |
| P13 | 深圳曦华科技／[嵌入式软件实习生](https://www.zhipin.com/job_detail/aef99c491e33fd280nB52tu4FFFS.html) | 南山科技园；实习 | 本科；100–499 人 | MCU 传感器接口、调试测试片段。来源 F。 |
| P15 | seeed／[Linux 应用工程师（嵌入式 AI）](https://m.zhipin.com/job_detail/6b8432a01139e9c10nBy2d61EVVR.html) | 南山科技园；在校／应届 | 本科；100–499 人 | 仅凭标题不能编码 AI 任职条件；具体要求待核。来源 D/G。 |
| P16 | 质点能源／[嵌入式软件工程师（应届）](https://m.zhipin.com/job_detail/54502e97af665fd00nd62tm7GVdQ.html) | 宝安新安；在校／应届 | 本科；规模未取得 | 储能 Linux 与通信协议片段。来源 G。 |
| P17 | 佑驾创新／[27 届—嵌入式开发工程师（BSP）（MJ000929）](https://www.zhipin.com/job_detail/348f07de7dd4bcfb0nN50tq_GVpX.html) | 福田车公庙；2027 届校招 | 本科；1000–9999 人 | 明示跨届，2028 学生不能据此判断可投；驱动及可靠性职责片段。来源 E。 |
| P18 | 卓普数字／[嵌入式软件开发工程师](https://www.zhipin.com/job_detail/62269a81857a7f6f1Xd93N61GFJZ.html) | 宝安新安；在校／应届 | 本科；100–499 人 | 片段提统招本科计算机等专业；低功耗安防软件。来源 E。 |
| P19 | 经纬恒润／[Linux 软件实习生](https://www.zhipin.com/job_detail/cc51e526bc118acd03N429q0E1ZT.html) | 福田车公庙；实习 | 本科；1000–9999 人 | Linux 服务／应用与 BSP 协作片段。来源 D。 |
| P21 | 易兆微／[嵌入式软件实习生](https://www.zhipin.com/job_detail/f11a8e7d1fcaaeb31n1z2Ni4EVRR.html) | 宝安西乡；实习 | 本科；100–499 人 | 蓝牙/Wi-Fi 稳定性和兼容测试片段；须核是否主要测试岗位。来源 F。 |
| P22 | 深圳星域蔚蓝科技／[嵌入式软件实习生](https://www.zhipin.com/job_detail/c98f59fd04ba8e2d0nZ_0t-_FldU.html) | 南山科技园；实习 | 本科；20–99 人 | MCU 外设和 GUI 片段；不复述卡片中不严谨的芯片架构归类。来源 F。 |
| P24 | 元戎启行／[嵌入式软件开发实习生](https://www.zhipin.com/job_detail/5a3e1372b446d6ee0nF439i6FldR.html) | 福田保税区；实习 | 本科；1000–9999 人 | 传感器驱动及车辆执行器片段。来源 F。 |
| P25 | 自变量机器人／[嵌入式软件实习生（A185207）](https://www.zhipin.com/job_detail/cd2805aca18d57080nB42d-0E1FX.html) | 南山科技园；实习 | 本科；100–499 人 | 关节电机、ARM/RISC-V、RTOS 片段。来源 F。 |
| P26 | 迎凯／[嵌入式实习生（提供住宿）](https://www.zhipin.com/job_detail/14dde6865c1cf53e1HN52tm8FVFQ.html) | 光明；实习 | 本科；100–499 人 | 嵌入式软件设计开发片段。来源 F。 |

## 与并行采集交叉的 3 条（勿重复计数）

| ID | 公司／岗位及完整 URL | 官方聚合卡片字段 | 并行状态 |
|---|---|---|---|
| P14 | 魔力信息技术／[嵌入式软件（实习生）](https://www.zhipin.com/job_detail/53264a6ae3e804a103Fz2961FVJZ.html) | 深圳南山科技园；本科实习；20–99 人；软件模块开发片段。来源 F。 | 本文件公开读取失败；`expansion-edge-jd-evidence.md` 已有 JD28 完整正文，应以其为准。 |
| P20 | 天贝物联／[【实习】Linux 软件开发工程师](https://www.zhipin.com/job_detail/3f63e31fc1f96abd1Hx_2tS5EldV.html) | 深圳南山大学城；本科实习；20–99 人；路由器等设备片段。来源 D。 | 也列入 C++ 扩样候选，尚不能因两次发现重复计数。 |
| P23 | 零零科技／[嵌入式软件实习生](https://www.zhipin.com/job_detail/05893146d156fe470nJ529m6FVBY.html) | 深圳南山蛇口；本科实习；500–999 人；无人机 Linux 应用片段。来源 F。 | 本文件公开读取失败；`expansion-edge-jd-evidence.md` 已有 JD27 完整正文，应以其为准。 |

## 来源索引

- A：[BOSS 深圳初级嵌入式工程师聚合页](https://www.zhipin.com/zhaopin/ae5e08e4f586f12203V43t-7FQ~~/)
- B：[BOSS 深圳初级嵌入式软件聚合页](https://www.zhipin.com/zhaopin/5e528183f35c4ec203V43t-7Fw~~/)
- C：[BOSS 深圳嵌入式 Linux 聚合页](https://m.zhipin.com/zhaopin/5d0bb3645aecc8e91Hdy39u-Fw~~/)
- D：[BOSS 深圳 Linux 实习聚合页](https://www.zhipin.com/zhaopin/32e7934c7e696404031z3dq6FQ~~/)
- E：[BOSS 深圳嵌入式开发实习聚合页](https://www.zhipin.com/zhaopin/3d159fd6843f72e70nB50tq9FQ~~/)
- F：[BOSS 深圳嵌入式实习生聚合页](https://www.zhipin.com/zhaopin/e112bf1a0d43f55c1HF72ti9EA~~/)
- G：[BOSS 深圳嵌入式工程师实习生聚合页](https://m.zhipin.com/zhaopin/a8afc8861164410e0ndz2N61EA~~/)

聚合页面会随时间更换卡片，采集日期不是岗位发布日期。纳入统计前，须用完整详情重新核对公司、深圳地点、阶段、专业/学历/届别和正文要求，并分别记录任职、职责、优先；不要将本表的片段预编码为硬要求。
