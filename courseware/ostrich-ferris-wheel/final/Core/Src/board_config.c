#include "board_config.h"

#include <string.h>

static const BoardReferenceProfile reference_profile = {
    .mcu = BOARD_MCU_PART_NUMBER,
    .system_clock_hz = BOARD_REFERENCE_CLOCK_HZ,
    .pwm_frequency_hz = 1000U,
    .scheduler_frequency_hz = 100U,
    .uart_baud = 115200U,
    .i2c_frequency_hz = 100000U,
};

const BoardReferenceProfile *board_reference_profile(void) {
    return &reference_profile;
}

bool board_reference_profile_valid(void) {
    const BoardReferenceProfile *profile = board_reference_profile();
    return profile != NULL && strcmp(profile->mcu, "STM32F103C8T6") == 0 &&
           profile->system_clock_hz == UINT32_C(8000000) &&
           profile->pwm_frequency_hz == 1000U &&
           profile->scheduler_frequency_hz == 100U &&
           profile->uart_baud == 115200U && profile->i2c_frequency_hz == 100000U &&
           BOARD_ANALOG_EXIT_OVERLOAD < BOARD_ANALOG_ENTER_OVERLOAD &&
           BOARD_PWM_MAX_PERMILLE == 1000;
}
