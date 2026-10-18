#ifndef FERRIS_INTERRUPTS_H
#define FERRIS_INTERRUPTS_H

#if defined(FERRIS_STM32_TARGET)

#include "app_events.h"
#include "stm32f1xx_hal.h"
#include "uart_rx.h"

#include <stdbool.h>

enum {
    FERRIS_IRQ_FAULT_UART_ERROR = 1U << 0,
    FERRIS_IRQ_FAULT_UART_OVERFLOW = 1U << 1
};

void ferris_interrupts_bind(AppEvents *events,
                            TIM_HandleTypeDef *scheduler_timer,
                            UART_HandleTypeDef *diagnostic_uart,
                            UartRx *uart_rx);
bool ferris_uart_receive_start(void);

#endif

#endif
