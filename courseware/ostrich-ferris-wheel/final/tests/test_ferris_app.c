#include "ferris_app.h"
#include "ferris_interrupts.h"
#include "test_support.h"

#include <string.h>

static void scheduler_tick(FerrisApp *app, uint32_t now_ms) {
    HAL_TIM_IRQHandler(app->scheduler_timer);
    ferris_app_poll(app, now_ms);
}

int main(void) {
    memset(&ferris_stub_gpio_b, 0, sizeof(ferris_stub_gpio_b));
    memset(&ferris_stub_gpio_c, 0, sizeof(ferris_stub_gpio_c));
    ferris_stub_primask = 0U;
    ferris_stub_disable_irq_count = 0U;
    ferris_stub_set_primask_count = 0U;
    ferris_stub_gpio_b.input[12] = GPIO_PIN_SET;

    ADC_HandleTypeDef adc = {
        .start_result = HAL_OK,
        .poll_result = HAL_OK,
        .value = 1700U,
    };
    TIM_HandleTypeDef pwm = {
        .autoreload = 999U,
        .pwm_start_result = HAL_OK,
        .base_start_result = HAL_OK,
    };
    TIM_HandleTypeDef scheduler = {
        .autoreload = 9U,
        .pwm_start_result = HAL_OK,
        .base_start_result = HAL_OK,
    };
    I2C_HandleTypeDef i2c = {
        .result = HAL_OK,
        .response = {DOOR_SENSOR_EXPECTED_ID, DOOR_SENSOR_LOCKED_MASK},
    };
    UART_HandleTypeDef uart = {
        .receive_result = HAL_OK,
        .transmit_result = HAL_OK,
    };
    IWDG_HandleTypeDef watchdog = {.refresh_result = HAL_OK};
    FerrisApp app;

    TEST_ASSERT(ferris_app_init(&app,
                                &adc,
                                &pwm,
                                TIM_CHANNEL_1,
                                &scheduler,
                                &i2c,
                                &uart,
                                &watchdog,
                                0U,
                                "test-reset"));
    TEST_ASSERT(app.initialized);
    TEST_ASSERT_EQ(1, pwm.pwm_start_count);
    TEST_ASSERT_EQ(1, scheduler.base_start_count);
    TEST_ASSERT_EQ(1, uart.receive_size);
    TEST_ASSERT_EQ(0, pwm.compare);
    TEST_ASSERT_EQ(GPIO_PIN_RESET, ferris_stub_gpio_b.output[13]);
    TEST_ASSERT(uart.transmitted_length > 0U);
    TEST_ASSERT(strstr((const char *)uart.transmitted, "STM32F103C8T6") != NULL);

    scheduler_tick(&app, 0U);
    TEST_ASSERT_EQ(FERRIS_STATE_SELF_TEST, app.controller.state);
    TEST_ASSERT_EQ(1, ferris_stub_disable_irq_count);
    TEST_ASSERT_EQ(1, ferris_stub_set_primask_count);
    TEST_ASSERT_EQ(0, ferris_stub_primask);

    app_events_isr_tick(&app.events);
    ferris_stub_primask = 1U;
    ferris_app_poll(&app, 10U);
    TEST_ASSERT_EQ(FERRIS_STATE_READY, app.controller.state);
    TEST_ASSERT_EQ(2, ferris_stub_disable_irq_count);
    TEST_ASSERT_EQ(2, ferris_stub_set_primask_count);
    TEST_ASSERT_EQ(1, ferris_stub_primask);
    ferris_stub_primask = 0U;

    ferris_stub_gpio_b.input[12] = GPIO_PIN_RESET;
    scheduler_tick(&app, 20U);
    scheduler_tick(&app, 50U);
    TEST_ASSERT_EQ(FERRIS_STATE_RUNNING, app.controller.state);
    TEST_ASSERT(pwm.compare > 0U);
    TEST_ASSERT_EQ(GPIO_PIN_SET, ferris_stub_gpio_b.output[13]);
    TEST_ASSERT(watchdog.refresh_count >= 4U);

    i2c.response[1] = 0U;
    scheduler_tick(&app, 100U);
    TEST_ASSERT_EQ(FERRIS_STATE_FAULT, app.controller.state);
    TEST_ASSERT_EQ(FERRIS_FAULT_DOOR_UNLOCKED, app.controller.fault_latch);
    TEST_ASSERT_EQ(0, pwm.compare);
    TEST_ASSERT_EQ(GPIO_PIN_RESET, ferris_stub_gpio_b.output[13]);
    TEST_ASSERT(strstr((const char *)uart.transmitted, "reason=fault") != NULL);
    TEST_PASS();
}
