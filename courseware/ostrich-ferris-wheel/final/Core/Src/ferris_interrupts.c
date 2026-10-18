#include "ferris_interrupts.h"

#if defined(FERRIS_STM32_TARGET)

#include <stddef.h>

static AppEvents *bound_events;
static TIM_HandleTypeDef *bound_scheduler_timer;
static UART_HandleTypeDef *bound_diagnostic_uart;
static UartRx *bound_uart_rx;
static uint8_t uart_rx_byte;

void ferris_interrupts_bind(AppEvents *events,
                            TIM_HandleTypeDef *scheduler_timer,
                            UART_HandleTypeDef *diagnostic_uart,
                            UartRx *uart_rx) {
    bound_events = events;
    bound_scheduler_timer = scheduler_timer;
    bound_diagnostic_uart = diagnostic_uart;
    bound_uart_rx = uart_rx;
    uart_rx_byte = 0U;
}

bool ferris_uart_receive_start(void) {
    return bound_diagnostic_uart != NULL && bound_uart_rx != NULL &&
           HAL_UART_Receive_IT(bound_diagnostic_uart, &uart_rx_byte, 1U) == HAL_OK;
}

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *timer) {
    if (timer == bound_scheduler_timer && bound_events != NULL) {
        app_events_isr_tick(bound_events);
    }
}

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *uart) {
    if (uart != bound_diagnostic_uart || bound_uart_rx == NULL) {
        return;
    }
    if (!uart_rx_isr_push(bound_uart_rx, uart_rx_byte) && bound_events != NULL) {
        app_events_isr_fault(bound_events, FERRIS_IRQ_FAULT_UART_OVERFLOW);
    }
    if (HAL_UART_Receive_IT(bound_diagnostic_uart, &uart_rx_byte, 1U) != HAL_OK &&
        bound_events != NULL) {
        app_events_isr_fault(bound_events, FERRIS_IRQ_FAULT_UART_ERROR);
    }
}

void HAL_UART_ErrorCallback(UART_HandleTypeDef *uart) {
    if (uart == bound_diagnostic_uart && bound_events != NULL) {
        app_events_isr_fault(bound_events, FERRIS_IRQ_FAULT_UART_ERROR);
    }
    if (uart == bound_diagnostic_uart) {
        (void)HAL_UART_Receive_IT(bound_diagnostic_uart, &uart_rx_byte, 1U);
    }
}

#endif

#if !defined(FERRIS_STM32_TARGET)
typedef int ferris_interrupts_host_translation_unit;
#endif
