#ifndef FERRIS_DRIVE_OUTPUT_H
#define FERRIS_DRIVE_OUTPUT_H

#include <stdint.h>

typedef struct {
    uint16_t current_permille;
    uint16_t target_permille;
    uint16_t step_permille;
} DriveOutput;

void drive_output_init(DriveOutput *drive, uint16_t step_permille);
void drive_output_set_target(DriveOutput *drive, int32_t target_permille);
uint16_t drive_output_update(DriveOutput *drive);
void drive_output_stop_immediately(DriveOutput *drive);

#endif
