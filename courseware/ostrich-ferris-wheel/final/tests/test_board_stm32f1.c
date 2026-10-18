#include "board_config.h"
#include "board_io.h"
#include "board_stm32f1.h"
#include "door_sensor.h"
#include "app_events.h"
#include "ferris_interrupts.h"
#include "test_support.h"
#include "uart_rx.h"

#include <string.h>

int main(void) {
    memset(&ferris_stub_gpio_b, 0, sizeof(ferris_stub_gpio_b));
    memset(&ferris_stub_gpio_c, 0, sizeof(ferris_stub_gpio_c));
    ferris_stub_gpio_b.input[12] = GPIO_PIN_SET;

    ADC_HandleTypeDef adc = {.start_result = HAL_OK, .poll_result = HAL_OK, .value = 2048U};
    TIM_HandleTypeDef timer = {.autoreload = 999U, .compare = 0U, .irq_count = 0U};
    I2C_HandleTypeDef i2c = {
        .result = HAL_OK,
        .error = 0U,
        .response = {DOOR_SENSOR_EXPECTED_ID, DOOR_SENSOR_LOCKED_MASK},
        .last_address = 0U,
        .last_memory_address = 0U,
    };
    BoardStm32f1 board;
    board_stm32f1_init(&board, &adc, &timer, TIM_CHANNEL_1, &i2c);
    const BoardIo io = board_stm32f1_io(&board);
    TEST_ASSERT(!board_button_pressed(&io));
    ferris_stub_gpio_b.input[12] = GPIO_PIN_RESET;
    TEST_ASSERT(board_button_pressed(&io));
    uint16_t raw = 0U;
    TEST_ASSERT(board_adc_read(&io, &raw));
    TEST_ASSERT_EQ(2048, raw);
    adc.poll_result = HAL_TIMEOUT;
    TEST_ASSERT(!board_adc_read(&io, &raw));
    adc.poll_result = HAL_OK;

    board_status_led_set(&io, true);
    TEST_ASSERT_EQ(GPIO_PIN_RESET, ferris_stub_gpio_c.output[13]);
    board_drive_set(&io, 500U);
    TEST_ASSERT_EQ(500, timer.compare);
    TEST_ASSERT_EQ(GPIO_PIN_SET, ferris_stub_gpio_b.output[13]);
    board_outputs_safe(&io);
    TEST_ASSERT_EQ(0, timer.compare);
    TEST_ASSERT_EQ(GPIO_PIN_RESET, ferris_stub_gpio_b.output[13]);

    const DoorBus bus = board_stm32f1_door_bus(&board);
    const uint8_t configuration = 0x12U;
    TEST_ASSERT_EQ(DOOR_BUS_OK,
                   bus.write(bus.context,
                             DOOR_SENSOR_ADDRESS,
                             0x02U,
                             &configuration,
                             1U,
                             5U));
    const DoorReading reading = door_sensor_read(&bus, 100U, 5U);
    TEST_ASSERT(reading.valid && reading.locked);
    TEST_ASSERT_EQ(DOOR_SENSOR_ADDRESS << 1U, i2c.last_address);
    TEST_ASSERT_EQ(DOOR_SENSOR_STATUS_REGISTER, i2c.last_memory_address);

    i2c.result = HAL_ERROR;
    i2c.error = HAL_I2C_ERROR_AF;
    TEST_ASSERT_EQ(DOOR_ERROR_NACK, door_sensor_read(&bus, 110U, 5U).error);
    i2c.result = HAL_TIMEOUT;
    TEST_ASSERT_EQ(DOOR_ERROR_TIMEOUT, door_sensor_read(&bus, 120U, 5U).error);

    AppEvents events;
    app_events_init(&events, NULL, NULL, NULL);
    UartRx rx;
    uart_rx_init(&rx);
    UART_HandleTypeDef uart = {
        .receive_result = HAL_OK,
        .receive_buffer = NULL,
        .receive_size = 0U,
        .irq_count = 0U,
    };
    ferris_interrupts_bind(&events, &timer, &uart, &rx);
    TEST_ASSERT(ferris_uart_receive_start());
    TEST_ASSERT_EQ(1, uart.receive_size);
    HAL_TIM_IRQHandler(&timer);
    TEST_ASSERT_EQ(1, timer.irq_count);
    AppEventSnapshot event_snapshot = app_events_take(&events);
    TEST_ASSERT_EQ(1, event_snapshot.tick_count);

    const char command_text[] = "status\n";
    for (size_t index = 0U; index < sizeof(command_text) - 1U; ++index) {
        *uart.receive_buffer = (uint8_t)command_text[index];
        HAL_UART_IRQHandler(&uart);
    }
    UartCommand command;
    TEST_ASSERT(uart_rx_poll(&rx, &command));
    TEST_ASSERT_EQ(UART_COMMAND_STATUS, command.type);
    TEST_ASSERT_EQ(sizeof(command_text) - 1U, uart.irq_count);

    HAL_IncTick();
    HAL_SYSTICK_IRQHandler();
    TEST_ASSERT_EQ(1, ferris_stub_tick_count);
    TEST_ASSERT_EQ(1, ferris_stub_systick_irq_count);
    TEST_PASS();
}
