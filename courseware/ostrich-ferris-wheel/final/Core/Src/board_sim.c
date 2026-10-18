#include "board_sim.h"

#include "board_config.h"

#include <stddef.h>

static bool sim_read_button(void *context) {
    return ((const BoardSim *)context)->button_level_high;
}

static bool sim_read_adc(void *context, uint16_t *raw) {
    if (context == NULL || raw == NULL) {
        return false;
    }
    *raw = ((const BoardSim *)context)->adc_raw;
    return true;
}

static void sim_write_led(void *context, bool high) {
    ((BoardSim *)context)->led_level_high = high;
}

static void sim_write_drive(void *context, uint16_t permille) {
    ((BoardSim *)context)->drive_permille = permille;
}

void board_sim_init(BoardSim *sim) {
    if (sim == NULL) {
        return;
    }
    sim->button_level_high = BOARD_BUTTON_ACTIVE_LOW != 0;
    sim->adc_raw = 0U;
    sim->led_level_high = BOARD_LED_ACTIVE_LOW != 0;
    sim->drive_permille = 0U;
}

BoardIo board_sim_io(BoardSim *sim) {
    const BoardIo io = {
        .read_button_level = sim_read_button,
        .read_adc_raw = sim_read_adc,
        .write_led_level = sim_write_led,
        .write_drive_permille = sim_write_drive,
        .context = sim,
    };
    return io;
}

void board_sim_set_button_pressed(BoardSim *sim, bool pressed) {
    if (sim != NULL) {
        sim->button_level_high = BOARD_BUTTON_ACTIVE_LOW ? !pressed : pressed;
    }
}

void board_sim_set_adc_raw(BoardSim *sim, uint16_t raw) {
    if (sim != NULL) {
        sim->adc_raw = raw;
    }
}

bool board_sim_status_led_on(const BoardSim *sim) {
    if (sim == NULL) {
        return false;
    }
    return BOARD_LED_ACTIVE_LOW ? !sim->led_level_high : sim->led_level_high;
}
