#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))

paths = set()
for module in manifest["modules"]:
    paths.update(module["files"])
paths.update(manifest["tests"])
paths.update(manifest["documentation"])
paths.update(manifest["packageSupport"])
paths.update(manifest["courseTargetFiles"])
paths.update(manifest["entrypoints"].values())
paths.add(manifest["target"]["cubeConfig"])
target_integration = manifest["targetIntegration"]
paths.update(target_integration["compileCourseSources"])

missing = sorted(path for path in paths if not (ROOT / path).is_file())
if missing:
    raise SystemExit("manifest references missing files:\n" + "\n".join(missing))

ioc = (ROOT / "FerrisControl.ioc").read_text(encoding="utf-8")
required_ioc_values = {
    "Mcu.CPN": "STM32F103C8T6",
    "PA1.Signal": "ADCx_IN1",
    "PA6.Signal": "S_TIM3_CH1",
    "PA9.Signal": "USART1_TX",
    "PA10.Signal": "USART1_RX",
    "PB6.Signal": "I2C1_SCL",
    "PB7.Signal": "I2C1_SDA",
    "PB12.Signal": "GPIO_Input",
    "PB13.Signal": "GPIO_Output",
    "PC13-TAMPER-RTC.Signal": "GPIO_Output",
    "RCC.SYSCLKSource": "RCC_SYSCLKSOURCE_HSI",
}
actual = {}
for line in ioc.splitlines():
    if "=" in line:
        key, value = line.split("=", 1)
        actual[key] = value
errors = [f"{key}: expected {value}, got {actual.get(key)!r}"
          for key, value in required_ioc_values.items()
          if actual.get(key) != value]
if errors:
    raise SystemExit("invalid FerrisControl.ioc reference profile:\n" + "\n".join(errors))

target_sources = target_integration["compileCourseSources"]
required_target_sources = {
    "Core/Src/board_stm32f1.c",
    "Core/Src/ferris_app.c",
    "Core/Src/ferris_interrupts.c",
}
forbidden_target_sources = {
    "Core/Src/main.c",
    "Core/Src/board_sim.c",
}
if len(target_sources) != len(set(target_sources)):
    raise SystemExit("target integration contains duplicate course sources")
if not required_target_sources.issubset(target_sources):
    raise SystemExit("target integration is missing STM32 application sources")
if forbidden_target_sources.intersection(target_sources):
    raise SystemExit("target integration includes host-only sources")

interrupt_glue = (ROOT / "Core/Src/ferris_interrupts.c").read_text(encoding="utf-8")
standard_handlers = [
    "TIM2_IRQHandler",
    "USART1_IRQHandler",
    "SysTick_Handler",
    "HardFault_Handler",
]
duplicates = [name for name in standard_handlers if name in interrupt_glue]
if duplicates:
    raise SystemExit("interrupt glue duplicates CubeMX handlers: " + ", ".join(duplicates))

print(f"MANIFEST PASS: {len(paths)} referenced files exist; STM32F103C8T6 pin profile is consistent.")
