#include "uart_rx.h"

#include <stdio.h>
#include <string.h>

void uart_rx_init(UartRx *rx) {
    if (rx == NULL) {
        return;
    }
    rx->head = 0U;
    rx->tail = 0U;
    rx->dropped_bytes = 0U;
    rx->reported_dropped_bytes = 0U;
    rx->line[0] = '\0';
    rx->line_length = 0U;
    rx->discarding_line = false;
    rx->previous_was_cr = false;
}

bool uart_rx_isr_push(UartRx *rx, uint8_t byte) {
    if (rx == NULL) {
        return false;
    }
    const uint16_t next = (uint16_t)((rx->head + 1U) % UART_RX_RING_CAPACITY);
    if (next == rx->tail) {
        if (rx->dropped_bytes != UINT32_MAX) {
            rx->dropped_bytes++;
        }
        return false;
    }
    rx->ring[rx->head] = byte;
    rx->head = next;
    return true;
}

static UartCommandType parse_command(const char *line) {
    if (strcmp(line, "status") == 0) {
        return UART_COMMAND_STATUS;
    }
    if (strcmp(line, "stop") == 0) {
        return UART_COMMAND_STOP;
    }
    if (strcmp(line, "reset") == 0) {
        return UART_COMMAND_RESET;
    }
    return UART_COMMAND_UNKNOWN;
}

static void set_command(UartCommand *command, UartCommandType type, const char *text) {
    command->type = type;
    if (text == NULL) {
        command->text[0] = '\0';
        return;
    }
    (void)snprintf(command->text, sizeof(command->text), "%s", text);
}

bool uart_rx_poll(UartRx *rx, UartCommand *command) {
    if (rx == NULL || command == NULL) {
        return false;
    }
    if (rx->reported_dropped_bytes != rx->dropped_bytes) {
        rx->reported_dropped_bytes = rx->dropped_bytes;
        set_command(command, UART_COMMAND_RX_OVERFLOW, "rx-overflow");
        return true;
    }
    while (rx->tail != rx->head) {
        const char byte = (char)rx->ring[rx->tail];
        rx->tail = (uint16_t)((rx->tail + 1U) % UART_RX_RING_CAPACITY);

        if (byte == '\n' && rx->previous_was_cr) {
            rx->previous_was_cr = false;
            continue;
        }
        const bool is_newline = byte == '\r' || byte == '\n';
        rx->previous_was_cr = byte == '\r';
        if (!is_newline) {
            if (rx->discarding_line) {
                continue;
            }
            if (rx->line_length + 1U >= UART_RX_LINE_CAPACITY) {
                rx->discarding_line = true;
            } else {
                rx->line[rx->line_length++] = byte;
                rx->line[rx->line_length] = '\0';
            }
            continue;
        }
        if (rx->discarding_line) {
            rx->discarding_line = false;
            rx->line_length = 0U;
            rx->line[0] = '\0';
            set_command(command, UART_COMMAND_LINE_TOO_LONG, "line-too-long");
            return true;
        }
        if (rx->line_length == 0U) {
            continue;
        }
        set_command(command, parse_command(rx->line), rx->line);
        rx->line_length = 0U;
        rx->line[0] = '\0';
        return true;
    }
    return false;
}
