# 蛋仔摩天轮安全中控站：完整参考工程

这是鸵鸟蛋课程的最终代码快照。默认目标是可在 macOS 或 Linux 主机直接构建的 C17 仿真程序；相同的控制逻辑通过 `BoardIo` 和 `DoorBus` 接口与 STM32 HAL 隔离。工程没有用空函数或省略号代替业务实现。

## 课程怎样使用这份工程

第一步先取得这一整棵完整脚手架并运行下面的主机校验。后续 33 个引导步骤不会让学习者凭空补大段代码，也不会用残缺工程假装“循序渐进”：每一步都重新给出本步涉及文件的完整版本，再安排一个可观察、可撤销的小实验。实验完成后可以直接恢复该文件的参考版本，因此章末快照和最终工程始终保持可构建、可运行。`.ioc`、HAL 适配层和接线文档固定到 STM32F103C8T6；没有开发板时先完成主机模拟与 HAL stub 验证，上板结论必须等 CubeMX 生成、ARM 构建、下载和实物测量后再填写。

## 先运行完整工程

```sh
make clean all
make test
make demo
```

也可以执行一次完整校验：

```sh
./scripts/verify.sh
```

集成演示会依次经过：

```text
BOOT → SELF_TEST → READY → RUNNING → PARKING → READY → RUNNING → FAULT
```

最后一次故障由仿真的过载输入触发。验收条件是进入 `FAULT` 后 PWM 为 0，程序输出 `DEMO PASS`。十二个测试可执行文件还会覆盖按钮抖动与长按、毫秒计数回绕、PWM 钳位和斜坡、事件饱和、UART 分段与溢出、ADC 标定和滞回、I²C 错误分类、故障优先级及所有状态下的急停，并用受控 HAL stub 编译和执行 STM32F1 适配层与完整目标端应用循环。

## 代码结构

```text
Core/Inc/                  硬件无关接口与状态模型
Core/Src/                  完整实现、主机演示与 STM32F1 HAL 适配层
tests/                     可重复的失败场景和 fake DoorBus
docs/                      CubeMX 接入、接线、时序、标定、传感器协议、故障矩阵
FerrisControl.ioc          STM32F103C8T6 参考 CubeMX 配置
manifest.json              交付范围与验证边界
Makefile                   主机严格编译、测试、演示入口
scripts/verify.sh          一键完整性校验
```

每个模块都只负责一类问题：

- `board_io` 表达“按钮是否按下、灯是否点亮、驱动命令是多少”，不让业务层看引脚与有效电平。
- `button` 以候选态、稳定态和持续时间生成一次性的 PRESS/RELEASE 事件。
- `app_time` 只用无符号时间差，跨 `uint32_t` 回绕仍成立。
- `drive_output` 对 0–1000 千分比命令钳位，并且每轮只移动一个斜坡步长。
- `app_events` 在 ISR 一侧做饱和计数和位图累积，在主循环用短临界区取快照。
- `uart_rx` 的 ISR 只收字节，主循环处理固定长度的 `status / stop / reset` 行命令。
- `analog_sensor` 完成整数标定、定长滑动平均与双阈值滞回。
- `door_sensor_i2c` 验证总线结果、长度、设备 ID、状态位和数据年龄。
- `fault_supervisor` 统一故障优先级并锁存首次原因。
- `ferris_controller` 把所有输入收束到七态安全状态机。
- `ferris_app` 把 CubeMX 句柄、定时中断、UART、传感器、状态机、安全输出和看门狗刷新接成完整目标端运行循环。

## STM32F103C8T6 参考配置

`FerrisControl.ioc` 固定为 STM32F103C8T6、片内 HSI 8 MHz，并配置：

- PA6：TIM3_CH1，1 kHz PWM；
- PA1：ADC1_IN1；
- PA9 / PA10：USART1，115200 8-N-1；
- PB6 / PB7：I2C1，100 kHz；
- PB12：内部上拉按钮，低电平按下；
- PC13：低电平点亮的参考状态灯；
- PB13：高电平运行使能，复位默认低；
- TIM2：100 Hz 周期中断；
- IWDG：约 1 秒监督窗口；
- PA13 / PA14：SWD。

详细电流路径和限制见 `docs/wiring.md`。`board_stm32f1.c` 是完整 HAL 适配层，`ferris_app.c` 则是完整目标端应用循环。主机的普通 demo 不依赖 STM32 SDK；`test_board_stm32f1` 和 `test_ferris_app` 会用受控 HAL stub 编译目标端代码。

## 放进 CubeMX 生成工程的准确位置

完整的编译、排除和中断入口清单见 [`docs/cubemx-integration.md`](docs/cubemx-integration.md)。必须保留 CubeMX 生成的 `main.c` 和 `stm32f1xx_it.c`；课程的 `Core/Src/main.c` 是主机 demo，`board_sim.c` 是主机模拟板卡，两者都不加入目标构建。目标工程只加入清单列出的 15 个课程源文件，其中 `ferris_interrupts.c` 只定义 HAL 回调，不定义标准 IRQHandler，因此可以与生成的中断文件同时编译。

在 CubeMX `main.c` 的 `/* USER CODE BEGIN Includes */` 放入：

```c
#include "ferris_app.h"
```

在 `/* USER CODE BEGIN PV */` 放入：

```c
static FerrisApp ferris_app;
```

保留 CubeMX 生成的 `HAL_Init`、时钟和 `MX_GPIO_Init / MX_ADC1_Init / MX_I2C1_Init / MX_TIM2_Init / MX_TIM3_Init / MX_USART1_UART_Init / MX_IWDG_Init`。所有 `MX_*` 调用完成后，在 `/* USER CODE BEGIN 2 */` 放入：

```c
if (!ferris_app_init(&ferris_app,
                     &hadc1,
                     &htim3,
                     TIM_CHANNEL_1,
                     &htim2,
                     &hi2c1,
                     &huart1,
                     &hiwdg,
                     HAL_GetTick(),
                     "power-on")) {
    Error_Handler();
}
```

在 `while (1)` 的 `/* USER CODE BEGIN 3 */` 放入：

```c
ferris_app_poll(&ferris_app, HAL_GetTick());
```

`ferris_app_init` 会先应用安全输出，再启动 TIM3 PWM、TIM2 中断和 UART 中断接收。`ferris_app_poll` 只有收到 TIM2 节拍才执行一次协作式循环；取走 ISR 事件时会保存 PRIMASK、短暂关中断，再恢复调用前的中断状态。它只在按钮、事件、ADC 和控制器健康链完整时刷新 IWDG。初始化失败会保留 PWM=0 和 PB13=低，不会继续运行。

## 芯片与固件依据

- [STM32F103C8 产品页](https://www.st.com/en/microcontrollers-microprocessors/stm32f103c8.html)
- [RM0008 参考手册](https://www.st.com/resource/en/reference_manual/cd00171190-stm32f101-103-105-107-stm32f100-series-armbased-32bit-mcus-stmicroelectronics.pdf)
- [STM32CubeF1 固件包](https://www.st.com/en/embedded-software/stm32cubef1.html)

## 必须诚实保留的真机边界

当前机器没有 STM32CubeMX、STM32CubeIDE、STM32CubeF1 固件包、ST-LINK 和目标板，所以本次能够验证的是完整主机逻辑，不能声称已完成 CubeMX 重新生成、ARM 交叉编译、下载或真机电气验收。`.ioc` 与 HAL 适配层已经固定到用户确认的 STM32F103C8T6 和参考引脚，但第一次上板仍应完成以下证据：

1. 用本机安装的 CubeMX 打开 `FerrisControl.ioc`，确认没有迁移或引脚冲突，再生成 STM32CubeIDE 工程。
2. 按上面的 USER CODE 片段调用 `ferris_app_init` 和 `ferris_app_poll`；安全输出、TIM3 PWM、TIM2 中断、UART 接收和 IWDG 健康刷新均由完整应用层统一处理。
3. Clean/Build 两次，记录 Flash/RAM 占用；用 ST-LINK 证明复位后命中 `main`。
4. 按 `docs/wiring.md` 逐根核对 3.3 V、GND、上拉和限流，空载测量 PWM 与安全使能。
5. 当前没有指定真实 I²C 门锁模块。`docs/sensor-profile.md` 明确把地址与寄存器视为课程协议；选定实物后必须按数据手册替换 profile 并用逻辑分析仪验收。
6. 真实电机或模型只能经隔离驱动与独立急停链路连接，不能由 MCU 引脚直接驱动。

这些步骤是硬件验收，不是缺失的 C 逻辑。主机工程可以独立运行并复现所有软件失败场景；只有真实板卡、传感器和接线才能提供最后的物理证据。
