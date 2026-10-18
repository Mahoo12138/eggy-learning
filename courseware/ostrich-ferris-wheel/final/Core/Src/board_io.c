#include "board_io.h"

#include "board_config.h"

#include <stddef.h>

bool board_io_valid(const BoardIo *io) {
    return io != NULL && io->read_button_level != NULL && io->read_adc_raw != NULL &&
           io->write_led_level != NULL && io->write_drive_permille != NULL;
}

bool board_button_raw(const BoardIo *io) {
    return io != NULL && io->read_button_level != NULL
               ? io->read_button_level(io->context)
               : false;
}

bool board_button_pressed(const BoardIo *io) {
    if (io == NULL || io->read_button_level == NULL) {
        return false;
    }
    const bool raw_high = board_button_raw(io);
    return BOARD_BUTTON_ACTIVE_LOW ? !raw_high : raw_high;
}

uint16_t board_adc_raw(const BoardIo *io) {
    uint16_t raw = 0U;
    (void)board_adc_read(io, &raw);
    return raw;
}

bool board_adc_read(const BoardIo *io, uint16_t *raw) {
    if (io == NULL || io->read_adc_raw == NULL || raw == NULL) {
        return false;
    }
    return io->read_adc_raw(io->context, raw);
}

void board_status_led_set(const BoardIo *io, bool on) {
    if (io != NULL && io->write_led_level != NULL) {
        const bool level_high = BOARD_LED_ACTIVE_LOW ? !on : on;
        io->write_led_level(io->context, level_high);
    }
}

void board_drive_set(const BoardIo *io, uint16_t permille) {
    if (io != NULL && io->write_drive_permille != NULL) {
        const uint16_t safe_value = permille > BOARD_PWM_MAX_PERMILLE
                                        ? BOARD_PWM_MAX_PERMILLE
                                        : permille;
        io->write_drive_permille(io->context, safe_value);
    }
}

void board_outputs_safe(const BoardIo *io) {
    board_drive_set(io, 0U);
    board_status_led_set(io, false);
}
