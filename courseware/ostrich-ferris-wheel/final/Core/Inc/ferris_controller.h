#ifndef FERRIS_CONTROLLER_H
#define FERRIS_CONTROLLER_H

#include "fault_supervisor.h"

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    FERRIS_STATE_BOOT = 0,
    FERRIS_STATE_SELF_TEST,
    FERRIS_STATE_READY,
    FERRIS_STATE_RUNNING,
    FERRIS_STATE_PARKING,
    FERRIS_STATE_FAULT,
    FERRIS_STATE_RESETTING
} FerrisState;

typedef struct {
    bool self_test_complete;
    bool self_test_ok;
    bool start_requested;
    bool stop_requested;
    bool reset_requested;
    bool parked;
    FaultSnapshot fault;
} FerrisControllerInputs;

typedef struct {
    FerrisState state;
    uint16_t requested_drive_permille;
    FerrisFault fault_latch;
} FerrisController;

void ferris_controller_init(FerrisController *controller);
bool ferris_controller_update(FerrisController *controller,
                              const FerrisControllerInputs *inputs);
const char *ferris_state_name(FerrisState state);

#endif
