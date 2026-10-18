#ifndef FERRIS_BOARD_SIM_H
#define FERRIS_BOARD_SIM_H

#include "board_io.h"

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    bool button_level_high;
    uint16_t adc_raw;
    bool led_level_high;
    uint16_t drive_permille;
} BoardSim;

void board_sim_init(BoardSim *sim);
BoardIo board_sim_io(BoardSim *sim);
void board_sim_set_button_pressed(BoardSim *sim, bool pressed);
void board_sim_set_adc_raw(BoardSim *sim, uint16_t raw);
bool board_sim_status_led_on(const BoardSim *sim);

#endif
