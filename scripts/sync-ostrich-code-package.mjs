// Publish the STM32F103C8T6 ferris-wheel reference project as a complete
// starter scaffold plus 33 bounded, observable experiments. Every milestone
// remains a full runnable tree; target hardware claims stay explicitly separate
// from the host and HAL-stub evidence available in this repository.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishProjectCode } from '../lib/project-code-publisher.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check')) throw new Error('仅支持 --check');
const root = fileURLToPath(new URL('..', import.meta.url));
const projectId = 'ostrich-ferris-wheel-project';
const sourceRoot = join(root, 'courseware/ostrich-ferris-wheel/final');
const excludedDirectories = new Set(['build']);

async function readTree(directory, prefix = '') {
  const result = {};
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isDirectory() && (excludedDirectories.has(entry.name) || entry.name.endsWith('.dSYM'))) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await readTree(directory, path));
    else if (entry.isFile()) result[path] = await readFile(join(directory, path), 'utf8');
  }
  return result;
}

const learnerChanges = {
  'bringup-01': [{
    file: 'Core/Src/main.c',
    anchor: '"host-sim"',
    instruction: '把启动横幅的板卡摘要从 host-sim 改成 host-sim-f103-course，重新运行 demo；只改展示值，确认完整脚手架确实由你构建并执行。',
    expectedFragment: '"host-sim-f103-course"'
  }],
  'bringup-02': [{
    file: 'Core/Src/main.c',
    anchor: '"power-on"',
    instruction: '把主机演示的复位原因改成 software-reset，再运行 demo 对照启动横幅；借这个可见变化区分手写调用点和库实现。',
    expectedFragment: '"software-reset"'
  }],
  'bringup-03': [{
    file: 'Core/Src/main.c',
    anchor: 'int main(void) {\n    BoardSim board;',
    instruction: '在 main 第一行加入 volatile boot_probe，并把它打印为 0x13572468；主机先确认输出，上板时再在同一行设置断点和 Watch。',
    expectedFragment: 'volatile uint32_t boot_probe = UINT32_C(0x13572468);\n    printf("boot probe=0x%08lx\\n", (unsigned long)boot_probe);'
  }],
  'gpio-01': [{
    file: 'FerrisControl.ioc',
    anchor: 'PB12.GPIO_Label=BUTTON_ACTIVE_LOW',
    instruction: '把 PB12 的 CubeMX 标签改成 START_BUTTON_ACTIVE_LOW，重新打开 Pinout 视图确认标签落在 PB12；不要移动引脚或改变电气模式。',
    expectedFragment: 'PB12.GPIO_Label=START_BUTTON_ACTIVE_LOW'
  }],
  'gpio-02': [{
    file: 'FerrisControl.ioc',
    anchor: 'PC13-TAMPER-RTC.PinState=GPIO_PIN_SET',
    instruction: '仅在断开功率级的 LED 实验中把 PC13 初始值改为 RESET，预测复位灯亮后再观察；完成比较后恢复参考安全值 SET。',
    expectedFragment: 'PC13-TAMPER-RTC.PinState=GPIO_PIN_RESET'
  }],
  'gpio-03': [{
    file: 'tests/test_board_io.c',
    anchor: 'TEST_ASSERT(board_sim_status_led_on(&sim));',
    instruction: '在“点亮”断言后再调用 board_status_led_set(&io, false)，并断言模拟灯熄灭；测试只表达开关语义，不复制有效电平取反。',
    expectedFragment: 'board_status_led_set(&io, false);\n    TEST_ASSERT(!board_sim_status_led_on(&sim));'
  }],
  'gpio-input-01': [{
    file: 'FerrisControl.ioc',
    anchor: 'PB12.GPIO_PuPd=GPIO_PULLUP',
    instruction: '只在 PB12 未接外设且已确认 3.3V 安全时，把内部上拉临时改为 NOPULL，用 Watch 记录浮空读数；随后恢复 PULLUP，不把读数当成默认值。',
    expectedFragment: 'PB12.GPIO_PuPd=GPIO_NOPULL'
  }],
  'gpio-input-02': [{
    file: 'Core/Src/main.c',
    anchor: 'const bool first_press = now_ms >= 100U && now_ms < 180U;',
    instruction: '把第一次模拟按键窗口整体后移 20ms，重新运行 demo；确认 READY→RUNNING 的日志也随稳定按下时间后移，而不是固定在旧时刻。',
    expectedFragment: 'const bool first_press = now_ms >= 120U && now_ms < 200U;'
  }],
  'gpio-input-03': [{
    file: 'tests/test_board_io.c',
    anchor: 'TEST_ASSERT(board_button_pressed(&io));',
    instruction: '在按下语义断言后增加 raw 断言，明确参考接线按下时原始电平为低，但业务层 pressed 为 true。',
    expectedFragment: 'TEST_ASSERT(!board_button_raw(&io));'
  }],
  'debounce-01': [{
    file: 'tests/test_button.c',
    anchor: 'TEST_ASSERT_EQ(BUTTON_EVENT_NONE, button_update(&button, true, 20U));',
    instruction: '在 20ms 与 44ms 两次采样之间再重放一次相同的 true 样本；断言仍无事件，证明相同候选值不会重置稳定计时。',
    expectedFragment: 'TEST_ASSERT_EQ(BUTTON_EVENT_NONE, button_update(&button, true, 30U));'
  }],
  'debounce-02': [{
    file: 'tests/test_button.c',
    anchor: 'button_init(&button, false, 0U, 25U);',
    instruction: '把去抖阈值改为 30ms；同步把 44/45 改为 49/50、释放点 2075 改为 2080，并把循环中的 +25 改为 +30、+65 改为 +70。完整测试仍须通过。',
    expectedFragment: 'button_init(&button, false, 0U, 30U);'
  }],
  'debounce-03': [{
    file: 'tests/test_button.c',
    anchor: 'for (int i = 0; i < 3; ++i) {',
    instruction: '把快速连按从 3 组扩成 4 组，并把最终 press_count 期望从 4 改为 5；每组仍只能产生一次 PRESS。',
    expectedFragment: 'for (int i = 0; i < 4; ++i) {'
  }],
  'time-01': [{
    file: 'tests/test_time.c',
    anchor: 'TEST_ASSERT_EQ(32, app_elapsed(0x00000010U, 0xFFFFFFF0U));',
    instruction: '在跨回绕的 32ms 到期断言前增加 31ms 尚未到期的边界断言，证明判断没有把回绕误当成巨大超时。',
    expectedFragment: 'TEST_ASSERT(!app_due(0x0000000FU, 0xFFFFFFF0U, 32U));'
  }],
  'time-02': [{
    file: 'tests/test_time.c',
    anchor: 'heartbeat_init(&heartbeat, UINT32_MAX - 10U, 20U);',
    instruction: '把心跳周期改为 25ms，同时把首次到期点从 9 改为 14、后续跨两周期采样从 49 改为 64；测试应继续证明无等待和跨回绕。',
    expectedFragment: 'heartbeat_init(&heartbeat, UINT32_MAX - 10U, 25U);'
  }],
  'time-03': [{
    file: 'Core/Src/main.c',
    anchor: 'now_ms += 10U',
    instruction: '把主机协作循环的模拟步长从 10ms 改成 20ms，运行 demo 并对照状态时间戳；按钮、停靠和故障仍应全部发生。',
    expectedFragment: 'now_ms += 20U'
  }],
  'pwm-01': [
    {
      file: 'FerrisControl.ioc',
      anchor: 'TIM3.Prescaler=7',
      instruction: '把 TIM3 PSC 从 7 改成 15，ARR 保持 999；先算出新频率，再在 CubeMX 参数视图确认，不靠试值。',
      expectedFragment: 'TIM3.Prescaler=15'
    },
    {
      file: 'docs/timing.md',
      anchor: '`PWM = 8,000,000 / (7 + 1) / (999 + 1) = 1,000 Hz`',
      instruction: '同步把公式写成 PSC=15 对应的 500Hz，确保文档与实验配置一致；实验结束后恢复 1kHz 参考值。',
      expectedFragment: '`PWM = 8,000,000 / (15 + 1) / (999 + 1) = 500 Hz`'
    }
  ],
  'pwm-02': [{
    file: 'tests/test_drive_output.c',
    anchor: 'drive_output_set_target(&drive, 1200);',
    instruction: '把越界目标从 1200 提高到 1400，保持钳位期望为 1000；用另一组越界值证明结果来自通用范围规则。',
    expectedFragment: 'drive_output_set_target(&drive, 1400);'
  }],
  'pwm-03': [{
    file: 'tests/test_drive_output.c',
    anchor: 'drive_output_init(&drive, 100U);',
    instruction: '把每轮斜坡步长改成 125：首次期望改为 125，上升循环由 9 改为 7，下降序列改为 875、750、650 并删除多余的第四次更新；最终不得越过目标。',
    expectedFragment: 'drive_output_init(&drive, 125U);'
  }],
  'irq-01': [{
    file: 'FerrisControl.ioc',
    anchor: 'NVIC.TIM2_IRQn=true\\:6\\:0',
    instruction: '把 TIM2 抢占优先级从 6 改成 7，重新打开 NVIC 配置核对；只比较优先级配置，不在 ISR 增加日志或业务。',
    expectedFragment: 'NVIC.TIM2_IRQn=true\\:7\\:0'
  }],
  'irq-02': [{
    file: 'tests/test_app_events.c',
    anchor: 'app_events_isr_fault(&events, 0x04U);',
    instruction: '再累积一次 0x08 故障位，并把快照期望从 5 改成 13；证明位图能同时保留三种不同事件。',
    expectedFragment: 'app_events_isr_fault(&events, 0x08U);'
  }],
  'irq-03': [{
    file: 'tests/test_app_events.c',
    anchor: 'TEST_ASSERT_EQ(0, events.tick_count);',
    instruction: '取得一次快照后立刻再取第二次，并断言 tick、fault 和 dropped 全为 0；验证短临界区执行的是复制后清空。',
    expectedFragment: 'const AppEventSnapshot drained = app_events_take(&events);\n    TEST_ASSERT_EQ(0, drained.tick_count);'
  }],
  'uart-01': [{
    file: 'Core/Src/diagnostics.c',
    anchor: '"FerrisControl %s | reset=%s | board=%s"',
    instruction: '把横幅产品名改成 EggyFerrisControl，运行 demo 检查版本、复位原因和板卡摘要仍只出现一次。',
    expectedFragment: '"EggyFerrisControl %s | reset=%s | board=%s"'
  }],
  'uart-02': [{
    file: 'Core/Src/diagnostics.c',
    anchor: '"[%lu ms] state %d -> %d reason=%s error=%d"',
    instruction: '把事件字段名 state 改成 transition，运行 test_diagnostics 和 demo；时间、旧态、新态、原因和错误码仍必须完整。',
    expectedFragment: '"[%lu ms] transition %d -> %d reason=%s error=%d"'
  }],
  'uart-03': [{
    file: 'tests/test_uart_rx.c',
    anchor: 'TEST_ASSERT_EQ(UART_COMMAND_UNKNOWN, command.type);',
    instruction: '追加一行大写 STATUS，并断言仍为 UNKNOWN；明确协议只接受文档列出的三个小写命令。',
    expectedFragment: 'push_text(&rx, "STATUS\\n");\n    TEST_ASSERT(uart_rx_poll(&rx, &command));\n    TEST_ASSERT_EQ(UART_COMMAND_UNKNOWN, command.type);'
  }],
  'adc-01': [
    {
      file: 'Core/Src/main.c',
      anchor: 'analog_sensor_init(&analog, 500U, 3500U, 4U)',
      instruction: '把主机实验标定端点改成 400 与 3600，运行 demo；这只是安全模拟数据，不可直接替代实物 30 次采样。',
      expectedFragment: 'analog_sensor_init(&analog, 400U, 3600U, 4U)'
    },
    {
      file: 'docs/calibration.md',
      anchor: '参考工程默认把原始值 500 映射到 0‰，3500 映射到 1000‰。',
      instruction: '把实验记录同步写成 400→0‰、3600→1000‰，避免代码和标定文档表达两套量程。',
      expectedFragment: '本次安全模拟实验把原始值 400 映射到 0‰，3600 映射到 1000‰。'
    }
  ],
  'adc-02': [{
    file: 'tests/test_analog_sensor.c',
    anchor: 'TEST_ASSERT(analog_sensor_init(&sensor, 500U, 3500U, 1U));',
    instruction: '在单样本窗口初始化后输入低于 raw_min 的 100，并断言有效结果饱和到 0‰；随后原有滞回序列仍须通过。',
    expectedFragment: 'reading = analog_sensor_add(&sensor, 100U, SENSOR_ERROR_NONE);\n    TEST_ASSERT(reading.valid);\n    TEST_ASSERT_EQ(0, reading.value_permille);'
  }],
  'adc-03': [{
    file: 'tests/test_analog_sensor.c',
    anchor: 'TEST_ASSERT_EQ(2, transitions);',
    instruction: '在滞回序列后送入一次 DISCONNECTED 读数，断言状态保持且 changed=false；无效采样不能制造新的阈值转换。',
    expectedFragment: 'reading = analog_sensor_add(&sensor, 4095U, SENSOR_ERROR_DISCONNECTED);\n    TEST_ASSERT(!overload_update(&detector, &reading, &changed));\n    TEST_ASSERT(!changed);'
  }],
  'bus-01': [
    {
      file: 'Core/Inc/door_sensor.h',
      anchor: 'DOOR_SENSOR_ADDRESS = 0x32',
      instruction: '把课程协议的 7 位地址临时改成 0x33，运行主机与 HAL stub 测试；所有调用都应从同一 profile 常量取得地址。',
      expectedFragment: 'DOOR_SENSOR_ADDRESS = 0x33'
    },
    {
      file: 'docs/sensor-profile.md',
      anchor: '7 位 I²C 地址：`0x32`',
      instruction: '同步把协议档案地址改成 0x33；实验结束后恢复 0x32，选定真实模块后再以其数据手册为准。',
      expectedFragment: '7 位 I²C 地址：`0x33`'
    }
  ],
  'bus-02': [{
    file: 'tests/test_door_sensor.c',
    anchor: 'TEST_ASSERT(fake_door_bus_add(&fake, DOOR_BUS_OK, DOOR_SENSOR_EXPECTED_ID, 0x80U, 2U));',
    instruction: '再给 FakeDoorBus 排入一次 DOOR_BUS_IO_ERROR；在 INVALID_STATUS 读取之后再调用 door_sensor_read，并断言映射为 DOOR_ERROR_IO。测试无需开发板。',
    expectedFragment: 'TEST_ASSERT(fake_door_bus_add(&fake, DOOR_BUS_IO_ERROR, 0U, 0U, 0U));'
  }],
  'bus-03': [{
    file: 'tests/test_door_sensor.c',
    anchor: 'TEST_ASSERT(!door_reading_is_fresh(&reading, 10U, 20U));',
    instruction: '增加 NULL 读数的 freshness 断言，证明缺失数据与过期数据一样不能被解释成“门已锁”。',
    expectedFragment: 'TEST_ASSERT(!door_reading_is_fresh(NULL, 10U, 20U));'
  }],
  'safe-01': [
    {
      file: 'Core/Src/ferris_controller.c',
      anchor: '? 650U',
      instruction: '把 RUNNING 请求从 650‰ 改成 600‰，同步更新控制器测试；只改状态动作，不绕过 drive_output 的钳位和安全停机。',
      expectedFragment: '? 600U'
    },
    {
      file: 'tests/test_ferris_controller.c',
      anchor: 'TEST_ASSERT_EQ(650, controller.requested_drive_permille);',
      instruction: '把 RUNNING 的期望命令同步改成 600，故障态仍必须立即回到 0。',
      expectedFragment: 'TEST_ASSERT_EQ(600, controller.requested_drive_permille);'
    }
  ],
  'safe-02': [{
    file: 'tests/test_ferris_controller.c',
    anchor: 'TEST_ASSERT(fault_supervisor_clear_latch(&supervisor, &faults));',
    instruction: '清除第一次锁存后构造“急停+门未锁+过载”组合，断言 active 与 latched 都选择 EMERGENCY_STOP；随后执行 faults = healthy_inputs() 并再次 clear_latch，避免污染后续状态机测试。',
    expectedFragment: 'faults.emergency_stop = true;\n    faults.door_locked = false;\n    faults.overloaded = true;\n    snapshot = fault_supervisor_evaluate(&supervisor, &faults, 120U);\n    TEST_ASSERT_EQ(FERRIS_FAULT_EMERGENCY_STOP, snapshot.active);'
  }],
  'safe-03': [{
    file: 'tests/test_ferris_app.c',
    anchor: 'i2c.response[1] = 0U;',
    instruction: '在注入门未锁之前保存 watchdog.refresh_count，故障周期后断言计数仍增加；看门狗监督软件健康链，功能故障则由状态机保持安全输出。',
    expectedFragment: 'const uint32_t refresh_before_fault = watchdog.refresh_count;\n    i2c.response[1] = 0U;'
  }]
};

function addTarget(step, ...paths) {
  for (const path of paths) if (!step.targetFiles.includes(path)) step.targetFiles.push(path);
}

function repairProject(project) {
  const renamedTargetFiles = new Map([
    ['Core/Inc/stm32xx_it.h', 'Core/Inc/ferris_interrupts.h'],
    ['Core/Src/stm32xx_it.c', 'Core/Src/ferris_interrupts.c']
  ]);
  for (const chapter of project.chapters) {
    chapter.filesTouched = [...new Set(chapter.filesTouched.map(path => renamedTargetFiles.get(path) || path))];
    for (const step of chapter.guidedSteps) {
      step.targetFiles = [...new Set(step.targetFiles.map(path => renamedTargetFiles.get(path) || path))];
    }
  }
  project.version = 4;
  project.environment.platform = 'STM32F103C8T6（LQFP48）+ ST-LINK/SWD + 3.3V USB-UART + 课程参考外设；主机可运行完整仿真与 HAL stub';
  project.environment.toolchain = 'STM32CubeIDE + STM32CubeMX/STM32CubeF1 HAL + Arm GNU Toolchain；主机验证使用 C17 编译器与 Make';
  project.environment.buildSystem = 'CubeIDE managed target build + Make 主机侧纯逻辑测试、仿真与 HAL-stub 集成测试';
  project.environment.outputBackend = 'PC13 安全状态灯 + PA6/TIM3_CH1 PWM + PB13 安全使能 + PA9/USART1 诊断';
  project.environment.inputBackend = 'PB12 上拉按钮 + TIM2 事件 + PA1/ADC1_IN1 + PB6/PB7 I2C1 门锁协议';
  project.environment.requirements = [
    '固定 MCU：STM32F103C8T6；参考时钟使用片内 HSI 8MHz，具体引脚以 FerrisControl.ioc 与 docs/wiring.md 为准',
    'ST-LINK/SWD 与 3.3V USB-UART；所有模块共地，接线修改前断电',
    'PC13 小电流状态灯、PB12 按钮、PA6 PWM、PB13 安全使能、PA1 安全模拟输入',
    'PB6/PB7 I2C1 使用 3.3V 上拉；真实门锁模块尚未指定，地址与寄存器必须在上板前按数据手册替换',
    '真实电机只能连接额定且隔离的驱动模块控制端，并保留独立急停链路',
    '代码包的 Core/Src/main.c 与 board_sim.c 只用于主机演示；CubeMX 生成的目标 main.c 与 stm32f1xx_it.c 必须保留，并按 docs/cubemx-integration.md 接入 15 个课程源文件',
    '主机阶段先执行 ./scripts/verify.sh；CubeMX 生成、ARM 构建、下载与实物测量必须在具备硬件和 ST 工具的环境另行验收'
  ];
  project.artifact.entryFile = 'Core/Src/ferris_app.c';
  project.artifact.runTarget = 'STM32F103C8T6 CubeIDE 固件 + 主机仿真/HAL-stub 验证';
  project.artifact.hardwareProfile.strategy = '课程固定 STM32F103C8T6 与参考引脚，统一由 FerrisControl.ioc、board_config 和 sensor profile 表达；真实 I2C 模块选定后只替换 profile，不让学习者猜板卡和寄存器';
  const firmwareComponent = project.artifact.components.find(item => item.id === 'firmware-app');
  if (firmwareComponent) firmwareComponent.entryFile = 'Core/Src/ferris_app.c';
  project.artifact.requiredDeliverables = [
    '完整可运行主机工程、FerrisControl.ioc、完整目标端 ferris_app、中断回调、CubeMX 接入清单与全部手写 C 源码',
    '固定 STM32F103C8T6 引脚表、断电接线表与真实 I2C 模块 profile',
    '12 个主机/HAL-stub 测试、完整 demo 与每章绿色验证记录',
    'CubeMX 生成、ARM Debug/Release 构建、ST-LINK 下载、UART/Watch/测量证据',
    '正常运行、组合故障、看门狗复位和安全恢复轨迹'
  ];
  project.coreContract[0] = 'STM32F103C8T6、参考引脚、有效电平和外设实例集中在 .ioc、board_config 与 sensor profile；每步从完整脚手架做有界实验，不让学习者猜硬件';
  project.guidancePolicy.codeDeliveryContractVersion = 1;
  project.guidancePolicy.fullSolutionScope = '第一步先提供可构建、可运行的完整工程树；之后每个引导步骤提供本步全部完整文件、一个可观察小改动、构建/测试命令和硬件验证边界，章末保留完整 snapshot。';
  project.guidancePolicy.learnerFreedomBoundary = '11 个章节都基于固定 STM32F103C8T6 参考工程做课程已解释的有界变式；实验后可恢复完整参考文件。真实 I2C 模块 profile 需由管理者按数据手册固定，最终自主发挥只属于无敌凤凰蛋。';

  const first = project.chapters[0].guidedSteps[0];
  first.title = '取得完整脚手架并建立绿色基线';
  first.instruction = '先下载代码包的完整起始脚手架，执行 ./scripts/verify.sh，确认 12 个测试与 demo 全绿；再用 CubeMX 打开固定为 STM32F103C8T6 的 FerrisControl.ioc，按 docs/cubemx-integration.md 区分主机入口与 CubeMX 生成入口。本步不声称已完成 ARM 构建或真机下载。';
  first.verify = '主机严格编译、12 个测试和 demo 全部通过；.ioc 显示 STM32F103C8T6。CubeMX 生成、ARM 构建、ST-LINK 下载和真机证据只有实际执行后才能填写。';

  const steps = new Map(project.chapters.flatMap(chapter => chapter.guidedSteps.map(step => [step.id, step])));
  for (const step of steps.values()) {
    if (step.targetFiles.includes('Core/Src/main.c')) {
      addTarget(step, 'docs/cubemx-integration.md');
      const entryGuidance = '代码包中的 Core/Src/main.c 是可直接运行的主机演示入口；目标板只修改 CubeMX 生成的 main.c，并完整照 docs/cubemx-integration.md 的 USER CODE 片段接入，不能用两个 main.c 互相覆盖。';
      if (!step.instruction.includes(entryGuidance)) step.instruction += ` ${entryGuidance}`;
    }
  }
  addTarget(steps.get('irq-01'),
            'Core/Inc/ferris_interrupts.h',
            'Core/Src/ferris_interrupts.c',
            'docs/cubemx-integration.md');
  addTarget(steps.get('gpio-03'), 'tests/test_board_io.c');
  addTarget(steps.get('gpio-input-03'), 'tests/test_board_io.c');
  addTarget(steps.get('time-02'), 'tests/test_time.c');
  addTarget(steps.get('adc-01'), 'Core/Src/main.c');
  addTarget(steps.get('safe-03'),
            'Core/Inc/ferris_app.h',
            'Core/Src/ferris_app.c',
            'Core/Inc/ferris_interrupts.h',
            'Core/Src/ferris_interrupts.c',
            'docs/cubemx-integration.md',
            'tests/test_ferris_app.c');
  const safeFinal = steps.get('safe-03');
  safeFinal.title = '接通完整目标端循环与看门狗健康链';
  safeFinal.instruction = '复制 ferris_app、ferris_interrupts、适配层、CubeMX 接入清单和测试的完整版本。初始化先应用安全输出；事件快照用保存/恢复 PRIMASK 的短临界区，CubeMX 保留唯一一组生成的 IRQHandler；只有按钮、事件、ADC 和控制器本周期都完成时刷新 IWDG。主机先用 HAL stub 注入门未锁验证 PWM 归零，再到真机故意停止一个健康环节观察复位。';
  safeFinal.verify = 'test_ferris_app 证明外设启动、事件快照恢复原中断状态、READY→RUNNING→FAULT、PWM 安全归零、UART 诊断与 IWDG 健康刷新；manifest 检查目标构建不含主机 main 或重复 IRQHandler；真机证据仍需实际板卡。';
  for (const chapter of project.chapters) {
    for (const step of chapter.guidedSteps) {
      for (const path of step.targetFiles) if (!chapter.filesTouched.includes(path)) chapter.filesTouched.push(path);
    }
  }
}

function changesFor(step, files) {
  const items = learnerChanges[step.id];
  if (!items?.length) throw new Error(`${step.id} 缺少有意义的学习者改动`);
  return items.map((source, index) => {
    if (!step.targetFiles.includes(source.file)) throw new Error(`${step.id} 的改动文件不属于本步目标：${source.file}`);
    const content = files[source.file];
    if (typeof content !== 'string' || !content.includes(source.anchor)) throw new Error(`${step.id}/${source.file} 找不到改动锚点：${source.anchor}`);
    if (content.includes(source.expectedFragment)) throw new Error(`${step.id}/${source.file} 的学习者改动已经出现在完整参考代码中`);
    return { id: `${step.id}-bounded-variant-${index + 1}`, ...source };
  });
}

const result = await publishProjectCode({
  root, projectId, check: args.includes('--check'),
  build: async ({ project }) => {
    repairProject(project);
    const files = await readTree(sourceRoot);
    if (!Object.keys(files).length) throw new Error(`参考工程为空：${relative(root, sourceRoot)}`);
    if (Object.keys(files).some(path => path === 'build' || path.startsWith('build/') || path.includes('.dSYM/'))) {
      throw new Error('代码包不能包含构建产物');
    }

    const states = [{ id: 'ostrich-f103-complete-scaffold', files }];
    const steps = [];
    let previousStateId = states[0].id;
    for (const chapter of project.chapters) {
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
          learnerChanges: changesFor(step, files),
          intentionalGaps: [],
          verification: {
            commands: [
              'make clean all',
              'make test',
              'make demo'
            ],
            expected: [
              '严格 C17 编译无警告，12 个主机/HAL-stub 测试全部通过。',
              '集成 demo 经过 RUNNING、PARKING、FAULT，最终 PWM=0 并输出 DEMO PASS。',
              step.verify,
              '涉及 .ioc、下载、SWD、串口或电气现象的结论必须在装有 STM32CubeF1/STM32CubeIDE 且连接实物后单独取证；主机通过不冒充真机通过。'
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
          './scripts/verify.sh',
          'make clean all'
        ],
        runCommands: [
          'make test',
          'make demo'
        ],
        expected: [
          '12 个主机/HAL-stub 测试全部通过，包含完整 ferris_app 目标循环的外设启动、状态转换、诊断、安全输出与看门狗刷新验证。',
          '主机 demo 经过 BOOT→SELF_TEST→READY→RUNNING→PARKING→READY→RUNNING→FAULT，最终 PWM=0 且输出 DEMO PASS。',
          '完整工程不含待补实现、伪代码、空业务函数、构建二进制或需要学习者猜测的运行胶水。',
          'CubeMX 生成、Arm 交叉构建、ST-LINK 下载和实物外设验收未在当前主机完成，必须按 README 在真实环境补充证据。'
        ]
      }
    };

    return { project, codePackage };
  }
});
console.log(`${result.check ? '校验通过，未写入' : result.written ? '已发布' : '内容未变，未写入'}：${result.chapters} 章、${result.steps} 步、${result.states} 个完整快照，课程版本 ${result.publishedRevision}。`);
console.log(`代码包 ${result.packageBytes} bytes，SHA-256 ${result.packageSha256}`);
