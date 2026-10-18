CC ?= cc
CFLAGS ?= -std=c17 -O2 -g -Wall -Wextra -Werror -Wconversion -Wshadow -Wstrict-prototypes -pedantic
CPPFLAGS ?= -ICore/Inc -Itests
LDFLAGS ?=

CORE_SOURCES := $(filter-out Core/Src/main.c Core/Src/board_stm32f1.c,$(wildcard Core/Src/*.c))
TEST_SUPPORT_SOURCE := tests/fake_door_bus.c
TEST_NAMES := board_io board_stm32f1 ferris_app button time drive_output app_events diagnostics uart_rx analog_sensor door_sensor ferris_controller
TEST_BINS := $(addprefix build/test_,$(TEST_NAMES))

.PHONY: all demo test sanitize clean

all: build/ferris_demo $(TEST_BINS)

build:
	mkdir -p build

build/ferris_demo: Core/Src/main.c $(CORE_SOURCES) | build
	$(CC) $(CPPFLAGS) $(CFLAGS) $^ $(LDFLAGS) -o $@

build/test_%: tests/test_%.c $(TEST_SUPPORT_SOURCE) $(CORE_SOURCES) | build
	$(CC) $(CPPFLAGS) $(CFLAGS) $^ $(LDFLAGS) -o $@

build/test_board_stm32f1: tests/test_board_stm32f1.c tests/stm32_hal_stub/stm32f1xx_hal.c Core/Src/board_io.c Core/Src/board_config.c Core/Src/board_stm32f1.c Core/Src/door_sensor_i2c.c Core/Src/app_time.c Core/Src/app_events.c Core/Src/uart_rx.c Core/Src/ferris_interrupts.c | build
	$(CC) -DFERRIS_STM32_TARGET $(CPPFLAGS) -Itests/stm32_hal_stub $(CFLAGS) $^ $(LDFLAGS) -o $@

build/test_ferris_app: tests/test_ferris_app.c tests/stm32_hal_stub/stm32f1xx_hal.c Core/Src/analog_sensor.c Core/Src/app_events.c Core/Src/app_time.c Core/Src/board_config.c Core/Src/board_io.c Core/Src/board_stm32f1.c Core/Src/button.c Core/Src/diagnostics.c Core/Src/door_sensor_i2c.c Core/Src/drive_output.c Core/Src/fault_supervisor.c Core/Src/ferris_app.c Core/Src/ferris_controller.c Core/Src/ferris_interrupts.c Core/Src/uart_rx.c | build
	$(CC) -DFERRIS_STM32_TARGET $(CPPFLAGS) -Itests/stm32_hal_stub $(CFLAGS) $^ $(LDFLAGS) -o $@

demo: build/ferris_demo
	./build/ferris_demo

test: $(TEST_BINS)
	@set -e; for test_bin in $(TEST_BINS); do "$$test_bin"; done

sanitize: CFLAGS += -O1 -fsanitize=address,undefined -fno-omit-frame-pointer
sanitize: LDFLAGS += -fsanitize=address,undefined
sanitize: clean all test demo

clean:
	rm -rf build
