#include "drive_output.h"

#include "board_config.h"

#include <stddef.h>

static uint16_t clamp_permille(int32_t value) {
    if (value <= 0) {
        return 0U;
    }
    if (value >= BOARD_PWM_MAX_PERMILLE) {
        return BOARD_PWM_MAX_PERMILLE;
    }
    return (uint16_t)value;
}

void drive_output_init(DriveOutput *drive, uint16_t step_permille) {
    if (drive == NULL) {
        return;
    }
    drive->current_permille = 0U;
    drive->target_permille = 0U;
    drive->step_permille = step_permille == 0U ? 1U : step_permille;
}

void drive_output_set_target(DriveOutput *drive, int32_t target_permille) {
    if (drive != NULL) {
        drive->target_permille = clamp_permille(target_permille);
    }
}

uint16_t drive_output_update(DriveOutput *drive) {
    if (drive == NULL) {
        return 0U;
    }
    if (drive->current_permille < drive->target_permille) {
        const uint16_t remaining = drive->target_permille - drive->current_permille;
        drive->current_permille += remaining < drive->step_permille
                                        ? remaining
                                        : drive->step_permille;
    } else if (drive->current_permille > drive->target_permille) {
        const uint16_t remaining = drive->current_permille - drive->target_permille;
        drive->current_permille -= remaining < drive->step_permille
                                        ? remaining
                                        : drive->step_permille;
    }
    return drive->current_permille;
}

void drive_output_stop_immediately(DriveOutput *drive) {
    if (drive != NULL) {
        drive->current_permille = 0U;
        drive->target_permille = 0U;
    }
}
