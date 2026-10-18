#include "stm32f1xx_hal.h"

#include <stddef.h>
#include <string.h>

GPIO_TypeDef ferris_stub_gpio_b;
GPIO_TypeDef ferris_stub_gpio_c;
uint32_t ferris_stub_tick_count;
uint32_t ferris_stub_systick_irq_count;
bool ferris_stub_irq_disabled;
uint32_t ferris_stub_primask;
uint32_t ferris_stub_disable_irq_count;
uint32_t ferris_stub_set_primask_count;

static unsigned pin_index(uint16_t pin) {
    for (unsigned index = 0U; index < 16U; ++index) {
        if (pin == (uint16_t)(UINT16_C(1) << index)) {
            return index;
        }
    }
    return 0U;
}

GPIO_PinState HAL_GPIO_ReadPin(GPIO_TypeDef *port, uint16_t pin) {
    return port->input[pin_index(pin)];
}

void HAL_GPIO_WritePin(GPIO_TypeDef *port, uint16_t pin, GPIO_PinState state) {
    port->output[pin_index(pin)] = state;
}

HAL_StatusTypeDef HAL_ADC_Start(ADC_HandleTypeDef *adc) {
    return adc->start_result;
}

HAL_StatusTypeDef HAL_ADC_PollForConversion(ADC_HandleTypeDef *adc, uint32_t timeout_ms) {
    (void)timeout_ms;
    return adc->poll_result;
}

uint32_t HAL_ADC_GetValue(ADC_HandleTypeDef *adc) {
    return adc->value;
}

HAL_StatusTypeDef HAL_ADC_Stop(ADC_HandleTypeDef *adc) {
    (void)adc;
    return HAL_OK;
}

HAL_StatusTypeDef HAL_I2C_Mem_Read(I2C_HandleTypeDef *i2c,
                                  uint16_t device_address,
                                  uint16_t memory_address,
                                  uint16_t memory_address_size,
                                  uint8_t *output,
                                  uint16_t size,
                                  uint32_t timeout_ms) {
    (void)memory_address_size;
    (void)timeout_ms;
    i2c->last_address = device_address;
    i2c->last_memory_address = memory_address;
    if (i2c->result == HAL_OK && output != NULL && size >= 2U) {
        output[0] = i2c->response[0];
        output[1] = i2c->response[1];
    }
    return i2c->result;
}

HAL_StatusTypeDef HAL_I2C_Mem_Write(I2C_HandleTypeDef *i2c,
                                   uint16_t device_address,
                                   uint16_t memory_address,
                                   uint16_t memory_address_size,
                                   uint8_t *data,
                                   uint16_t size,
                                   uint32_t timeout_ms) {
    (void)memory_address_size;
    (void)data;
    (void)size;
    (void)timeout_ms;
    i2c->last_address = device_address;
    i2c->last_memory_address = memory_address;
    return i2c->result;
}

uint32_t HAL_I2C_GetError(I2C_HandleTypeDef *i2c) {
    return i2c->error;
}

HAL_StatusTypeDef HAL_UART_Receive_IT(UART_HandleTypeDef *uart,
                                    uint8_t *buffer,
                                    uint16_t size) {
    uart->receive_buffer = buffer;
    uart->receive_size = size;
    return uart->receive_result;
}

HAL_StatusTypeDef HAL_UART_Transmit(UART_HandleTypeDef *uart,
                                   uint8_t *data,
                                   uint16_t size,
                                   uint32_t timeout_ms) {
    (void)timeout_ms;
    if (uart == NULL || data == NULL ||
        (size_t)uart->transmitted_length + size > sizeof(uart->transmitted)) {
        return HAL_ERROR;
    }
    if (uart->transmit_result == HAL_OK) {
        memcpy(&uart->transmitted[uart->transmitted_length], data, size);
        uart->transmitted_length = (uint16_t)(uart->transmitted_length + size);
    }
    return uart->transmit_result;
}

HAL_StatusTypeDef HAL_TIM_PWM_Start(TIM_HandleTypeDef *timer, uint32_t channel) {
    (void)channel;
    timer->pwm_start_count++;
    return timer->pwm_start_result;
}

HAL_StatusTypeDef HAL_TIM_Base_Start_IT(TIM_HandleTypeDef *timer) {
    timer->base_start_count++;
    return timer->base_start_result;
}

HAL_StatusTypeDef HAL_IWDG_Refresh(IWDG_HandleTypeDef *watchdog) {
    watchdog->refresh_count++;
    return watchdog->refresh_result;
}

void HAL_TIM_IRQHandler(TIM_HandleTypeDef *timer) {
    timer->irq_count++;
    HAL_TIM_PeriodElapsedCallback(timer);
}

void HAL_UART_IRQHandler(UART_HandleTypeDef *uart) {
    uart->irq_count++;
    HAL_UART_RxCpltCallback(uart);
}

void HAL_IncTick(void) {
    ferris_stub_tick_count++;
}

void HAL_SYSTICK_IRQHandler(void) {
    ferris_stub_systick_irq_count++;
}

void ferris_stub_disable_irq(void) {
    ferris_stub_primask = 1U;
    ferris_stub_irq_disabled = true;
    ferris_stub_disable_irq_count++;
}

uint32_t ferris_stub_get_primask(void) {
    return ferris_stub_primask;
}

void ferris_stub_set_primask(uint32_t value) {
    ferris_stub_primask = value & 1U;
    ferris_stub_irq_disabled = ferris_stub_primask != 0U;
    ferris_stub_set_primask_count++;
}

void ferris_stub_nop(void) {
    static volatile uint32_t nop_count;
    nop_count++;
}
