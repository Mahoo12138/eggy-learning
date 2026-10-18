# CubeMX 目标工程接入清单

这份清单把“主机可运行工程”和“STM32 目标固件”分开。`Core/Src/main.c` 是主机演示入口，`board_sim.c` 是主机模拟板卡；两者都不能加入 CubeMX 目标。CubeMX 生成的 `Core/Src/main.c`、`Core/Src/stm32f1xx_it.c`、外设初始化文件和启动文件必须保留。

## 1. 由 CubeMX 生成并保留

- `Core/Src/main.c`
- `Core/Src/gpio.c`
- `Core/Src/adc.c`
- `Core/Src/i2c.c`
- `Core/Src/tim.c`
- `Core/Src/usart.c`
- `Core/Src/iwdg.c`
- `Core/Src/stm32f1xx_it.c`
- `Core/Src/stm32f1xx_hal_msp.c`
- 启动文件、链接脚本和 STM32CubeF1 HAL/CMSIS 文件

若 CubeMX 将外设初始化函数保留在生成的 `main.c` 中，而不是拆成独立文件，同样保留生成结果。

## 2. 从课程工程加入目标构建

把课程 `Core/Inc` 加入头文件搜索路径，并只把以下课程源文件加入 STM32CubeIDE 的 Debug 和 Release 构建：

```text
Core/Src/analog_sensor.c
Core/Src/app_events.c
Core/Src/app_time.c
Core/Src/board_config.c
Core/Src/board_io.c
Core/Src/board_stm32f1.c
Core/Src/button.c
Core/Src/diagnostics.c
Core/Src/door_sensor_i2c.c
Core/Src/drive_output.c
Core/Src/fault_supervisor.c
Core/Src/ferris_app.c
Core/Src/ferris_controller.c
Core/Src/ferris_interrupts.c
Core/Src/uart_rx.c
```

给 Debug 和 Release 都定义 `FERRIS_STM32_TARGET`。

`ferris_interrupts.c` 只实现项目自己的绑定逻辑和 HAL 回调，不定义 `TIM2_IRQHandler`、`USART1_IRQHandler`、`SysTick_Handler` 或故障 Handler，所以可以和 CubeMX 生成的 `stm32f1xx_it.c` 一起编译，不会产生重复符号。

## 3. 明确排除

以下文件只用于主机演示、主机测试或交付校验，不加入目标构建：

```text
Core/Src/main.c
Core/Src/board_sim.c
tests/**
scripts/**
```

也不要从课程工程复制启动文件、链接脚本、`main.h` 或另一个 `stm32f1xx_it.c` 覆盖 CubeMX 生成文件。

## 4. CubeMX main.c 的完整 USER CODE 内容

在 `/* USER CODE BEGIN Includes */` 与对应 END 之间加入：

```c
#include "ferris_app.h"
```

在 `/* USER CODE BEGIN PV */` 与对应 END 之间加入：

```c
static FerrisApp ferris_app;
```

保留 CubeMX 生成的 `HAL_Init()`、`SystemClock_Config()` 和全部 `MX_*_Init()` 调用。所有外设初始化完成后，在 `/* USER CODE BEGIN 2 */` 与对应 END 之间加入：

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

在 `while (1)` 内的 `/* USER CODE BEGIN 3 */` 与对应 END 之间加入：

```c
ferris_app_poll(&ferris_app, HAL_GetTick());
```

## 5. 核对生成的中断入口

在 CubeMX 中启用 TIM2 与 USART1 全局中断后，生成的 `Core/Src/stm32f1xx_it.c` 应保留下列有效调用。函数周围的 USER CODE 标记和其他生成内容以当前 CubeMX 版本为准：

```c
void TIM2_IRQHandler(void) {
    HAL_TIM_IRQHandler(&htim2);
}

void USART1_IRQHandler(void) {
    HAL_UART_IRQHandler(&huart1);
}
```

`HAL_TIM_IRQHandler` 会调用课程的 `HAL_TIM_PeriodElapsedCallback`，`HAL_UART_IRQHandler` 会调用课程的接收或错误回调。不要再定义第二份同名 IRQHandler。`SysTick_Handler` 继续使用 CubeMX 生成版本，课程不覆盖它。

## 6. 构建前检查

1. 工程只有 CubeMX 生成的一个 `main` 和一组标准 IRQHandler。
2. Debug/Release 都定义了 `FERRIS_STM32_TARGET`。
3. 编译列表包含上面的 15 个课程 `.c`，不包含主机入口与模拟板卡。
4. `.ioc` 仍显示 STM32F103C8T6、HSI 8 MHz 和课程参考引脚。
5. Clean/Build 后没有重复符号、未定义引用或隐式声明。

完成这些检查只能证明工程结构正确；ARM 构建、ST-LINK 下载、引脚电平、PWM 波形和传感器通信仍需在安装 STM32CubeF1 的真实环境取证。
