#ifndef FERRIS_BOARD_IO_H
#define FERRIS_BOARD_IO_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    bool (*read_button_level)(void *context);
    bool (*read_adc_raw)(void *context, uint16_t *raw);
    void (*write_led_level)(void *context, bool high);
    void (*write_drive_permille)(void *context, uint16_t permille);
    void *context;
} BoardIo;

bool board_io_valid(const BoardIo *io);
bool board_button_raw(const BoardIo *io);
bool board_button_pressed(const BoardIo *io);
bool board_adc_read(const BoardIo *io, uint16_t *raw);
uint16_t board_adc_raw(const BoardIo *io);
void board_status_led_set(const BoardIo *io, bool on);
void board_drive_set(const BoardIo *io, uint16_t permille);
void board_outputs_safe(const BoardIo *io);

#endif
