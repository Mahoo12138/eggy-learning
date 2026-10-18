#ifndef FERRIS_UART_RX_H
#define FERRIS_UART_RX_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum {
    UART_RX_RING_CAPACITY = 64,
    UART_RX_LINE_CAPACITY = 32
};

typedef enum {
    UART_COMMAND_NONE = 0,
    UART_COMMAND_STATUS,
    UART_COMMAND_STOP,
    UART_COMMAND_RESET,
    UART_COMMAND_UNKNOWN,
    UART_COMMAND_LINE_TOO_LONG,
    UART_COMMAND_RX_OVERFLOW
} UartCommandType;

typedef struct {
    UartCommandType type;
    char text[UART_RX_LINE_CAPACITY];
} UartCommand;

typedef struct {
    uint8_t ring[UART_RX_RING_CAPACITY];
    volatile uint16_t head;
    volatile uint16_t tail;
    volatile uint32_t dropped_bytes;
    uint32_t reported_dropped_bytes;
    char line[UART_RX_LINE_CAPACITY];
    size_t line_length;
    bool discarding_line;
    bool previous_was_cr;
} UartRx;

void uart_rx_init(UartRx *rx);
bool uart_rx_isr_push(UartRx *rx, uint8_t byte);
bool uart_rx_poll(UartRx *rx, UartCommand *command);

#endif
