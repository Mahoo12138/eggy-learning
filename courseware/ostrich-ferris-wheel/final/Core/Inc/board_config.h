#ifndef FERRIS_BOARD_CONFIG_H
#define FERRIS_BOARD_CONFIG_H

#include <stdint.h>
#include <stdbool.h>

enum {
    BOARD_PWM_MAX_PERMILLE = 1000,
    BOARD_BUTTON_DEBOUNCE_MS = 25,
    BOARD_HEARTBEAT_PERIOD_MS = 500,
    BOARD_DOOR_READING_MAX_AGE_MS = 250,
    BOARD_ANALOG_ENTER_OVERLOAD = 820,
    BOARD_ANALOG_EXIT_OVERLOAD = 760
};

#define BOARD_LED_ACTIVE_LOW 1
#define BOARD_BUTTON_ACTIVE_LOW 1

#define FERRIS_FIRMWARE_VERSION "ostrich-reference-1.0.0"

/* STM32F103C8T6 reference wiring. See docs/wiring.md before connecting hardware. */
#define BOARD_MCU_PART_NUMBER "STM32F103C8T6"
#define BOARD_REFERENCE_CLOCK_HZ UINT32_C(8000000)

typedef struct {
    const char *mcu;
    uint32_t system_clock_hz;
    uint32_t pwm_frequency_hz;
    uint32_t scheduler_frequency_hz;
    uint32_t uart_baud;
    uint32_t i2c_frequency_hz;
} BoardReferenceProfile;

const BoardReferenceProfile *board_reference_profile(void);
bool board_reference_profile_valid(void);

#if defined(FERRIS_STM32_TARGET)
#include "stm32f1xx_hal.h"
#define BOARD_LED_PORT GPIOC
#define BOARD_LED_PIN GPIO_PIN_13
#define BOARD_BUTTON_PORT GPIOB
#define BOARD_BUTTON_PIN GPIO_PIN_12
#define BOARD_SAFETY_ENABLE_PORT GPIOB
#define BOARD_SAFETY_ENABLE_PIN GPIO_PIN_13
#endif

#endif
