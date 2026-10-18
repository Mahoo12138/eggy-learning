#include "test_support.h"
#include "uart_rx.h"

#include <string.h>

static void push_text(UartRx *rx, const char *text) {
    while (*text != '\0') {
        TEST_ASSERT(uart_rx_isr_push(rx, (uint8_t)*text));
        ++text;
    }
}

int main(void) {
    UartRx rx;
    UartCommand command;
    uart_rx_init(&rx);

    push_text(&rx, "sta");
    TEST_ASSERT(!uart_rx_poll(&rx, &command));
    push_text(&rx, "tus\r\nstop\nreset\nwhat\n");
    TEST_ASSERT(uart_rx_poll(&rx, &command));
    TEST_ASSERT_EQ(UART_COMMAND_STATUS, command.type);
    TEST_ASSERT(strcmp(command.text, "status") == 0);
    TEST_ASSERT(uart_rx_poll(&rx, &command));
    TEST_ASSERT_EQ(UART_COMMAND_STOP, command.type);
    TEST_ASSERT(uart_rx_poll(&rx, &command));
    TEST_ASSERT_EQ(UART_COMMAND_RESET, command.type);
    TEST_ASSERT(uart_rx_poll(&rx, &command));
    TEST_ASSERT_EQ(UART_COMMAND_UNKNOWN, command.type);

    push_text(&rx, "012345678901234567890123456789012345\n");
    TEST_ASSERT(uart_rx_poll(&rx, &command));
    TEST_ASSERT_EQ(UART_COMMAND_LINE_TOO_LONG, command.type);

    uart_rx_init(&rx);
    for (int i = 0; i < UART_RX_RING_CAPACITY + 5; ++i) {
        (void)uart_rx_isr_push(&rx, (uint8_t)'x');
    }
    TEST_ASSERT(rx.dropped_bytes > 0U);
    TEST_ASSERT(uart_rx_poll(&rx, &command));
    TEST_ASSERT_EQ(UART_COMMAND_RX_OVERFLOW, command.type);
    TEST_PASS();
}
